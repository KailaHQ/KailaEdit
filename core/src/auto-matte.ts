import { fastHash64 } from './render-cache'
import type { AutoMatteModel, AutoMatteQuality, AutoMatteBake } from './project-model'

export interface AutoMatteFingerprintParams {
  /**
   * How the clip uses its media. A bake is identified by the SOURCE range it covers, not
   * by the clip that asked for it.
   *
   * It used to be keyed on `clipId + trimStart + duration`, which meant every trim threw
   * the matte away — and worse, the render cache re-cuts clips to fit a preview window
   * (`sliceClipsForPreview`), so a cached segment asked for a range the editor had
   * already matted and got a whole second bake of the same footage. One small project
   * ended up with nine near-identical mattes of one clip, ~400 MB, each of them minutes
   * of GPU time. A matte depends on the frames, so it is keyed on the frames.
   */
  trimStart: number
  duration: number
  speed?: number
  reversed?: boolean
  model: AutoMatteModel | string
  quality: AutoMatteQuality | string
  /** The media file the matte is of. Only compared when the caller has it. */
  assetKey?: string | null
  /**
   * The size of the frames the matte was made from, as `WxH`.
   *
   * A matte is alpha for one exact frame geometry: `alphamerge` refuses a mask that is
   * not the same size as the picture, and the whole render dies with it. Keeping the
   * geometry in the identity means a matte made for a different reading of the media —
   * a rotated phone clip probed as landscape, say — can never be picked up for it.
   */
  frameSize?: string | null
}

/** Tolerance for range comparisons, well under one frame. */
const RANGE_EPSILON = 1e-3

export interface AutoMatteSourceRange {
  /** Seconds into the SOURCE media where the matte starts. */
  sourceStart: number
  /** How many seconds of SOURCE media it covers. */
  sourceSpan: number
}

/**
 * The source range a clip needs matted.
 *
 * `duration` is timeline seconds; at 2x a three-second clip eats six seconds of source.
 */
export function autoMatteSourceRange(params: {
  trimStart: number
  duration: number
  speed?: number
}): AutoMatteSourceRange {
  const speed = Number.isFinite(params.speed) && (params.speed as number) > 0 ? (params.speed as number) : 1
  return {
    sourceStart: Math.max(0, params.trimStart || 0),
    sourceSpan: Math.max(0, (params.duration || 0) * speed),
  }
}

/**
 * Bakes are snapped out to this grid, in source seconds.
 *
 * Exact ranges almost never repeat — a trim handle dragged by two frames asks for a range
 * no existing bake covers, and the model runs again over footage it has already seen.
 * Rounding the request outward means the neighbourhood of requests around one edit
 * collapses onto a single bake. The cost is bounded: at most one block of extra footage
 * at each end.
 */
export const MATTE_BAKE_BLOCK_SECONDS = 10

/** Rounds a range outward to the block grid, without running past the end of the media. */
export function snapAutoMatteRange(
  range: AutoMatteSourceRange,
  mediaDuration?: number,
): AutoMatteSourceRange {
  const block = MATTE_BAKE_BLOCK_SECONDS
  const start = Math.max(0, Math.floor(range.sourceStart / block) * block)
  let end = Math.ceil((range.sourceStart + range.sourceSpan) / block) * block
  if (Number.isFinite(mediaDuration) && (mediaDuration as number) > 0) {
    end = Math.min(end, mediaDuration as number)
  }
  // Never snap to less than what was asked for.
  end = Math.max(end, range.sourceStart + range.sourceSpan)
  return {
    sourceStart: Number(start.toFixed(3)),
    sourceSpan: Number((end - start).toFixed(3)),
  }
}

/**
 * Everything that changes a matte's pixels except which stretch of media it covers.
 *
 * Two bakes sharing this key are interchangeable wherever their ranges overlap, which is
 * what makes reuse across trims possible.
 */
export function autoMatteBakeKey(params: {
  assetKey?: string | null
  speed?: number
  reversed?: boolean
  model: AutoMatteModel | string
  quality: AutoMatteQuality | string
  frameSize?: string | null
}): string {
  const canonical = [
    params.assetKey ?? '',
    Number(params.speed ?? 1).toFixed(4),
    params.reversed ? '1' : '0',
    params.model,
    params.quality,
    params.frameSize ?? '',
  ].join(':')
  return fastHash64(canonical)
}

/**
 * Identity of one baked range — also its file name stem, so the range can be read back
 * off disk without an index to keep in sync.
 */
export function computeAutoMatteFingerprint(
  params: AutoMatteFingerprintParams & Partial<AutoMatteSourceRange>,
): string {
  const range: AutoMatteSourceRange =
    params.sourceStart !== undefined && params.sourceSpan !== undefined
      ? { sourceStart: params.sourceStart, sourceSpan: params.sourceSpan }
      : autoMatteSourceRange(params)

  const key = autoMatteBakeKey(params)
  const startMs = Math.round(range.sourceStart * 1000)
  const spanMs = Math.round(range.sourceSpan * 1000)
  return `matte_${key}_${startMs}_${spanMs}`
}

/** Reads a fingerprint back into the range it stands for, or null if it is not one. */
export function parseAutoMatteFingerprint(
  fingerprint: string,
): { key: string; range: AutoMatteSourceRange } | null {
  const m = /^matte_([0-9a-f]{16})_(\d+)_(\d+)$/.exec(fingerprint)
  if (!m) return null
  return {
    key: m[1],
    range: { sourceStart: Number(m[2]) / 1000, sourceSpan: Number(m[3]) / 1000 },
  }
}

/** Whether `have` spans the whole of `need`. */
export function autoMatteRangeCovers(have: AutoMatteSourceRange, need: AutoMatteSourceRange): boolean {
  return (
    have.sourceStart <= need.sourceStart + RANGE_EPSILON &&
    have.sourceStart + have.sourceSpan >= need.sourceStart + need.sourceSpan - RANGE_EPSILON
  )
}

/**
 * Whether an existing bake can serve a clip.
 *
 * A bake is usable when it was made the same way and COVERS the range the clip needs —
 * it does not have to match it. Trimming inwards, or a preview window cut out of the
 * middle, both land inside a bake that is already on disk; the consumer seeks to
 * `autoMatteBakeOffset` instead of assuming the matte starts on the clip's first frame.
 *
 * A bake from before ranges were recorded has no `sourceStart`, so nothing can be said
 * about what it covers and it is rejected — one re-bake, once.
 */
export function isAutoMatteBakeValid(
  bake: AutoMatteBake | undefined | null,
  params: AutoMatteFingerprintParams,
): boolean {
  if (!bake || !bake.path || !bake.fingerprint) return false
  if (bake.sourceStart === undefined || bake.sourceSpan === undefined) return false

  if ((bake.model ?? 'rvm-mobilenetv3') !== params.model) return false
  if ((bake.quality ?? 'standard') !== params.quality) return false
  if (Number(bake.speed ?? 1) !== Number(params.speed ?? 1)) return false
  if (Boolean(bake.reversed) !== Boolean(params.reversed)) return false
  if (params.assetKey && bake.assetKey && bake.assetKey !== params.assetKey) return false

  const have = { sourceStart: bake.sourceStart, sourceSpan: bake.sourceSpan }
  const need = autoMatteSourceRange(params)

  // A reversed bake runs backwards, so matte time 0 is the END of its range and a clip
  // sitting inside it is not at `sourceStart` seconds in. Rather than carry a second
  // offset rule for a rare case, a reversed bake has to match the range exactly.
  if (params.reversed) {
    return (
      Math.abs(have.sourceStart - need.sourceStart) < RANGE_EPSILON &&
      Math.abs(have.sourceSpan - need.sourceSpan) < RANGE_EPSILON
    )
  }

  return autoMatteRangeCovers(have, need)
}

/**
 * Where the clip's first frame sits inside the baked matte, in MATTE seconds.
 *
 * The bake has the clip's speed applied to it, so one matte second is `speed` seconds of
 * source — the same conversion `matteTimeForSourceTime` does.
 */
export function autoMatteBakeOffset(
  bake: { sourceStart?: number } | undefined | null,
  trimStart: number,
  speed: number = 1,
): number {
  if (!bake || bake.sourceStart === undefined) return 0
  return matteTimeForSourceTime(trimStart || 0, bake.sourceStart, speed)
}


/**
 * Where to seek the baked matte for a given position in the SOURCE media.
 *
 * The matte is baked from the trimmed, speed-adjusted range: ffmpeg is given
 * `-ss trimStart -t duration*speed` and then `setpts=PTS/speed`, so matte time 0 is source
 * time `trimStart`, and one second of matte covers `speed` seconds of source.
 *
 * Seeking it with the raw source time — which is what the preview did — puts the matte
 * ahead of the picture by exactly `trimStart`, and off by the speed factor on top. On an
 * untrimmed clip at 1x the two happen to agree, which is why this survived.
 */
export function matteTimeForSourceTime(
  sourceTime: number,
  matteSourceStart: number,
  speed: number = 1,
): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1
  return Math.max(0, (sourceTime - (matteSourceStart || 0)) / safeSpeed)
}

/**
 * The size the matting model's segmentation stage should work at.
 *
 * RVM's own inference guide: "Set `downsample_ratio` so that the downsampled resolution is
 * between 256 and 512." The published table lines up with targeting the top of that range:
 *
 * | Input | Guide (portrait / full body) | 512 / long side |
 * |---|---|---|
 * | 1920x1080 | 0.25 / 0.4 | 0.267 |
 * | 1280x720 | 0.375 / 0.6 | 0.400 |
 * | 512x512 | 1 | 1.000 |
 * | 3840x2160 | 0.125 / 0.2 | 0.133 |
 *
 * https://github.com/PeterL1n/RobustVideoMatting/blob/master/documentation/inference.md
 */
export const MATTE_SEGMENTATION_TARGET_PX = 512

/**
 * Picks `downsample_ratio` for a frame that is about to be fed to the model.
 *
 * Takes the size the model will actually receive — not the size of the original media.
 * Both callers here already scale frames down before inference, and passing the ratio for
 * the original resolution on top of that downsamples twice: at one point the bake fed the
 * model 960px frames with a ratio meant for 1080p, so the segmentation stage ran at 240px
 * and the preview's ran at 96px, both below the range the model was trained for. That is
 * what left whole slabs of background attached to the subject.
 */
export function downsampleRatioForInferenceSize(longestSidePx: number): number {
  if (!Number.isFinite(longestSidePx) || longestSidePx <= 0) return 1
  const ratio = MATTE_SEGMENTATION_TARGET_PX / longestSidePx
  return Math.max(0.125, Math.min(1, ratio))
}
