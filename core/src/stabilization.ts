import { fastHash64 } from './render-cache'
import { clampClipSpeed } from './clip-speed'
import { clipTimeAtSourceOffset } from './speed-curve'
import type {
  Asset,
  ClipStabilization,
  StabilizationBake,
  StabilizationMode,
  StabilizationWarning,
  TimelineClip,
} from './project-model'
import { STABILIZATION_SMOOTHING_MAX, STABILIZATION_SMOOTHING_MIN } from './project-model'

/**
 * Bumped whenever the filter chain changes what a stabilized frame looks like, so bakes
 * made by an older chain are not mistaken for current ones.
 */
export const STABILIZATION_ALGORITHM_VERSION = 1

/**
 * Extra source seconds baked either side of what the clip uses.
 *
 * A trim handle nudged by a few frames then still lands inside the bake instead of
 * starting a new one. It is kept short on purpose: the static zoom is worked out over the
 * whole baked range, so a long handle would let a bump outside the clip crop the clip.
 */
export const STABILIZATION_HANDLE_SECONDS = 1

/** Zoom above which the crop is large enough to be worth telling the user about. */
export const STABILIZATION_HIGH_ZOOM_PERCENT = 12

/** Tolerance for range comparisons, well under one frame. */
const RANGE_EPSILON = 1e-3

export interface StabilizationSourceRange {
  /** Seconds into the SOURCE media. */
  sourceStart: number
  /** Seconds of SOURCE media. */
  sourceSpan: number
}

type ClipTiming = Pick<TimelineClip, 'trimStart' | 'trimEnd' | 'duration' | 'speed'>

/**
 * The stretch of source media a clip shows.
 *
 * With the media's length known this comes straight from the two trims, which stays right
 * under keyframed speed. Without it, `duration * speed` is the best available answer.
 */
export function clipSourceRange(clip: ClipTiming, mediaDuration?: number): StabilizationSourceRange {
  const sourceStart = Math.max(0, clip.trimStart || 0)
  const sourceEnd = isPositive(mediaDuration)
    ? mediaDuration - Math.max(0, clip.trimEnd || 0)
    : sourceStart + Math.max(0, clip.duration || 0) * clampClipSpeed(clip.speed ?? 1)
  return { sourceStart, sourceSpan: Math.max(0, sourceEnd - sourceStart) }
}

/** The range to bake for a clip: what it shows, plus a handle each side, inside the media. */
export function stabilizationBakeRange(
  need: StabilizationSourceRange,
  mediaDuration?: number,
  handleSec = STABILIZATION_HANDLE_SECONDS,
): StabilizationSourceRange {
  const start = Math.max(0, need.sourceStart - handleSec)
  let end = need.sourceStart + need.sourceSpan + handleSec
  if (isPositive(mediaDuration)) end = Math.min(end, mediaDuration)
  end = Math.max(end, need.sourceStart + need.sourceSpan)
  return { sourceStart: round3(start), sourceSpan: round3(end - start) }
}

/**
 * The settings half of a bake's identity.
 *
 * Which media was stabilized is deliberately not in here: the renderer has to be able to
 * recompute this key to judge a bake, and it cannot reproduce how the main process
 * normalizes a path. The media is pinned by `bake.assetKey` instead, and by the cache
 * file name, which the main process derives from the file itself.
 */
export interface StabilizationKeyParams {
  smoothing: number
  mode: StabilizationMode
}

/** Smoothing as the filter will actually get it: a whole number inside the allowed range. */
export function clampStabilizationSmoothing(smoothing: number): number {
  if (!Number.isFinite(smoothing)) return 20
  return Math.round(Math.min(STABILIZATION_SMOOTHING_MAX, Math.max(STABILIZATION_SMOOTHING_MIN, smoothing)))
}

/** Everything that changes a stabilized frame except which stretch of media it covers. */
export function stabilizationBakeKey(params: StabilizationKeyParams): string {
  const canonical = [
    `v${STABILIZATION_ALGORITHM_VERSION}`,
    clampStabilizationSmoothing(params.smoothing),
    params.mode,
  ].join(':')
  return fastHash64(canonical)
}

/** Identity of one baked range — also its file name stem in the cache. */
export function computeStabilizationFingerprint(
  params: StabilizationKeyParams & StabilizationSourceRange,
): string {
  const startMs = Math.round(params.sourceStart * 1000)
  const spanMs = Math.round(params.sourceSpan * 1000)
  return `stab_${stabilizationBakeKey(params)}_${startMs}_${spanMs}`
}

/** Reads a fingerprint back into its key and range, or null if it is not one. */
export function parseStabilizationFingerprint(
  fingerprint: string,
): { key: string; range: StabilizationSourceRange } | null {
  const m = /^stab_([0-9a-f]{16})_(\d+)_(\d+)$/.exec(fingerprint)
  if (!m) return null
  return {
    key: m[1],
    range: { sourceStart: Number(m[2]) / 1000, sourceSpan: Number(m[3]) / 1000 },
  }
}

export interface StabilizationValidityParams extends StabilizationKeyParams {
  /** The range the clip shows now. */
  need: StabilizationSourceRange
  /** The media the clip plays now; compared with `bake.assetKey` when both are known. */
  assetKey?: string | null
}

/**
 * Whether an existing bake can serve a clip: made from the same media with the same
 * settings, and covering every frame the clip shows. Trimming inwards keeps the bake;
 * trimming out past its handle needs a new one.
 */
export function isStabilizationBakeValid(
  bake: StabilizationBake | undefined | null,
  params: StabilizationValidityParams,
): boolean {
  if (!bake || !bake.path || !bake.fingerprint) return false
  const parsed = parseStabilizationFingerprint(bake.fingerprint)
  if (!parsed || parsed.key !== stabilizationBakeKey(params)) return false
  if (params.assetKey && bake.assetKey && bake.assetKey !== params.assetKey) return false
  return (
    bake.sourceStart <= params.need.sourceStart + RANGE_EPSILON &&
    bake.sourceStart + bake.sourceSpan >= params.need.sourceStart + params.need.sourceSpan - RANGE_EPSILON
  )
}

export interface StabilizationContext {
  /** Length of the ORIGINAL media, when known. */
  mediaDuration?: number
  /** Identity of the original media, when known. */
  assetKey?: string | null
}

/** The stabilization a clip is actually asking for, or null when it is off or not a video. */
export function activeClipStabilization(
  clip: Pick<TimelineClip, 'type' | 'stabilization'>,
): ClipStabilization | null {
  if (clip.type !== 'video') return null
  const stab = clip.stabilization
  return stab && stab.enabled ? stab : null
}

/** Whether a clip wants stabilizing and has no usable bake for what it shows now. */
export function clipNeedsStabilizationBake(clip: TimelineClip, ctx: StabilizationContext = {}): boolean {
  const stab = activeClipStabilization(clip)
  if (!stab) return false
  return !isStabilizationBakeValid(stab.bake, {
    assetKey: ctx.assetKey,
    smoothing: stab.smoothing,
    mode: stab.mode,
    need: clipSourceRange(clip, ctx.mediaDuration),
  })
}

export interface StabilizedSource {
  path: string
  /** The clip's trims, re-measured inside the stabilized file. */
  trimStart: number
  trimEnd: number
  /** Length of the stabilized file. */
  duration: number
}

/**
 * Where a clip's frames come from once it is stabilized, or null to play the original.
 *
 * The baked file starts at `sourceStart` and ends at `sourceStart + sourceSpan`, so both
 * trims are re-measured against it: `trimStart` from its first frame, `trimEnd` from its
 * last. `trimEnd` matters as much as `trimStart` — a reversed clip is placed by counting
 * back from the end of the file.
 */
export function stabilizedSourceForClip(
  clip: TimelineClip,
  ctx: StabilizationContext = {},
): StabilizedSource | null {
  const stab = activeClipStabilization(clip)
  if (!stab || !stab.bake) return null
  const need = clipSourceRange(clip, ctx.mediaDuration)
  const valid = isStabilizationBakeValid(stab.bake, {
    assetKey: ctx.assetKey,
    smoothing: stab.smoothing,
    mode: stab.mode,
    need,
  })
  if (!valid) return null
  const { sourceStart, sourceSpan, path } = stab.bake
  const bakeEnd = sourceStart + sourceSpan
  const needEnd = need.sourceStart + need.sourceSpan
  return {
    path,
    trimStart: round6(Math.max(0, need.sourceStart - sourceStart)),
    trimEnd: round6(Math.max(0, bakeEnd - needEnd)),
    duration: sourceSpan,
  }
}

/**
 * The clip as the renderer and the exporter should see it: pointing at the stabilized
 * file with its trims shifted into that file's time. Anything downstream — seeking,
 * transitions, keyframes, the filtergraph — needs no idea stabilization exists.
 *
 * Returns the same object when there is nothing to swap, so memoized callers keep
 * their identity.
 */
export function resolveStabilizedClip(clip: TimelineClip, ctx: StabilizationContext = {}): TimelineClip {
  const source = stabilizedSourceForClip(clip, ctx)
  if (!source) return clip
  return {
    ...clip,
    trimStart: source.trimStart,
    trimEnd: source.trimEnd,
    asset: clip.asset
      ? {
        ...clip.asset,
        path: source.path,
        duration: source.duration,
        // A proxy is of the original frames; the bake already is the clean picture.
        proxyPath: undefined,
        proxyStatus: undefined,
      }
      : clip.asset,
  }
}

/**
 * The stabilized file a clip plays, if `clip` is one `resolveStabilizedClip` produced.
 *
 * Path lookups find the clip's media through the live asset list by `assetId`, which
 * still points at the original — so on its own the swapped `clip.asset` would be ignored.
 * A resolved clip is recognisable because its own asset path IS its bake path; a clip
 * straight from the store never is, so nothing unresolved is ever redirected here.
 */
export function stabilizedClipPath(clip: TimelineClip | null | undefined): string | null {
  const bake = clip?.stabilization?.enabled ? clip.stabilization.bake : undefined
  if (!bake?.path || clip?.asset?.path !== bake.path) return null
  return bake.path
}

/** What `resolveStabilizedClip` needs to know about a clip's media, from the live assets. */
export function stabilizationContextForClip(
  clip: TimelineClip,
  assets: ReadonlyArray<Pick<Asset, 'id' | 'duration'>>,
): StabilizationContext {
  const live = clip.assetId ? assets.find(asset => asset.id === clip.assetId) : undefined
  return {
    mediaDuration: live?.duration ?? clip.asset?.duration,
    assetKey: clip.assetId ?? null,
  }
}

/** A clip as it actually plays, for callers holding a clip straight from the store. */
export function clipAsPlayed(
  clip: TimelineClip,
  assets: ReadonlyArray<Pick<Asset, 'id' | 'duration'>>,
): TimelineClip {
  if (!clip.stabilization?.bake) return clip
  return resolveStabilizedClip(clip, stabilizationContextForClip(clip, assets))
}

/**
 * Whether a clip is waiting on its stabilized file: stabilization is on, but nothing that
 * fits has been baked yet. Work that depends on the clip's frames — a matte — should wait
 * rather than be done on frames that are about to be replaced.
 */
export function isStabilizationPending(
  clip: TimelineClip,
  assets: ReadonlyArray<Pick<Asset, 'id' | 'duration'>>,
): boolean {
  return Boolean(activeClipStabilization(clip)) && clipAsPlayed(clip, assets) === clip
}

/** Where a SOURCE second lands on the timeline, or null when the clip does not show it. */
export function timelineTimeForSourceTime(
  clip: Pick<TimelineClip, 'startTime' | 'trimStart' | 'trimEnd' | 'duration' | 'speed' | 'speedCurve' | 'reversed'>,
  sourceTime: number,
  mediaDuration?: number,
): number | null {
  const range = clipSourceRange(clip, mediaDuration)
  const sourceEnd = range.sourceStart + range.sourceSpan
  if (sourceTime < range.sourceStart - RANGE_EPSILON || sourceTime > sourceEnd + RANGE_EPSILON) return null
  const offset = clip.reversed ? sourceEnd - sourceTime : sourceTime - range.sourceStart
  return Number((clip.startTime + clipTimeAtSourceOffset(clip, offset)).toFixed(3))
}

/**
 * - `off`: stabilization is not enabled.
 * - `pending`: no bake yet; the editor makes one in the background while it is open.
 * - `stale`: a bake exists but no longer fits the clip's settings or trim; also re-baked.
 * - `missing`: the recorded bake file is gone from disk (a cleared cache).
 * - `ready`: the clip plays, and exports, from its stabilized file.
 */
export type StabilizationStatus = 'off' | 'pending' | 'stale' | 'missing' | 'ready'

export interface StabilizationDescription {
  enabled: boolean
  smoothing: number
  mode: StabilizationMode
  status: StabilizationStatus
  bakeReady: boolean
  zoomPercent?: number
  warnings?: StabilizationWarning[]
  /** Timeline seconds of each occlusion this clip shows. */
  occlusionTimes?: number[]
  bakePath?: string
}

/**
 * The stabilization state of a clip, as the agent and QC should read it. `fileExists` is
 * optional because only a caller with a filesystem can say whether the bake survived.
 */
export function describeClipStabilization(
  clip: TimelineClip,
  assets: ReadonlyArray<Pick<Asset, 'id' | 'duration'>>,
  fileExists?: (path: string) => boolean,
): StabilizationDescription | null {
  const stab = clip.stabilization
  if (!stab || clip.type !== 'video') return null
  const ctx = stabilizationContextForClip(clip, assets)
  const bake = stab.bake
  let status: StabilizationStatus
  if (!stab.enabled) status = 'off'
  else if (!bake?.path) status = 'pending'
  else if (fileExists && !fileExists(bake.path)) status = 'missing'
  else if (!stabilizedSourceForClip(clip, ctx)) status = 'stale'
  else status = 'ready'

  const ready = status === 'ready'
  const occlusionTimes = ready && bake?.warnings?.includes('occlusion')
    ? (bake.warningTimes ?? [])
      .map(time => timelineTimeForSourceTime(clip, time, ctx.mediaDuration))
      .filter((time): time is number => time !== null)
      .sort((a, b) => a - b)
    : []
  return {
    enabled: stab.enabled,
    smoothing: stab.smoothing,
    mode: stab.mode,
    status,
    bakeReady: ready,
    ...(ready && bake?.zoomPercent != null ? { zoomPercent: bake.zoomPercent } : {}),
    ...(ready && bake?.warnings?.length ? { warnings: bake.warnings } : {}),
    ...(occlusionTimes.length ? { occlusionTimes } : {}),
    ...(bake?.path ? { bakePath: bake.path } : {}),
  }
}

/**
 * Every clip as the renderer and exporter should see it. Returns the input array itself
 * when no clip is stabilized, so a memoized consumer does not recompute for nothing.
 */
export function resolveStabilizedClips(
  clips: TimelineClip[],
  assets: ReadonlyArray<Pick<Asset, 'id' | 'duration'>>,
): TimelineClip[] {
  let changed = false
  const out = clips.map(clip => {
    if (!clip.stabilization?.bake) return clip
    const resolved = resolveStabilizedClip(clip, stabilizationContextForClip(clip, assets))
    if (resolved !== clip) changed = true
    return resolved
  })
  return changed ? out : clips
}

// ---------------------------------------------------------------------------
// ffmpeg filter construction
// ---------------------------------------------------------------------------

export interface VidstabParams {
  smoothing: number
  mode: StabilizationMode
}

/** Escapes a path for use as a filter option value. */
export function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
}

/**
 * Pass 1: measure the camera motion into `resultPath`.
 *
 * The values are the ones measured on real phone footage: shakiness 8 catches handheld
 * jitter, accuracy 15 is the maximum and costs little next to the encode that follows.
 */
export function buildVidstabDetectFilter(params: VidstabParams, resultPath: string): string {
  const opts = [
    'shakiness=8',
    'accuracy=15',
    `result=${escapeFilterPath(resultPath)}`,
  ]
  if (params.mode === 'tripod') opts.push('tripod=1')
  return `vidstabdetect=${opts.join(':')}`
}

/**
 * Pass 2: move each frame back onto the smoothed path, scale up just enough to hide the
 * moving edges, and sharpen back what the scale softened.
 *
 * `optzoom=1` is one zoom for the whole range: the adaptive mode crops a little less
 * but visibly breathes, and measured no smoother.
 *
 * Bilinear, not bicubic: vidstabtransform runs on a single thread, and on 1080x1920 phone
 * footage bicubic took 37 s for 11 s of video against 15 s for bilinear. After the
 * sharpen the two measured SSIM 0.988 / PSNR 41.9 dB apart — not visible side by side.
 */
export function buildVidstabTransformFilter(
  params: VidstabParams,
  inputPath: string,
  options: { debug?: boolean } = {},
): string {
  const opts = [
    `input=${escapeFilterPath(inputPath)}`,
    `smoothing=${clampStabilizationSmoothing(params.smoothing)}`,
    'optzoom=1',
    'interpol=bilinear',
  ]
  if (params.mode === 'tripod') opts.push('tripod=1')
  if (options.debug) opts.push('debug=1')
  return `vidstabtransform=${opts.join(':')},unsharp=5:5:0.8:3:3:0.4`
}

// ---------------------------------------------------------------------------
// Reading what the bake measured
// ---------------------------------------------------------------------------

/** Reads the zoom vidstabtransform settled on (`Final zoom: 2.35`) out of its log. */
export function parseVidstabFinalZoom(log: string): number | null {
  const matches = [...log.matchAll(/Final zoom:\s*(-?\d+(?:\.\d+)?)/g)]
  if (matches.length === 0) return null
  const value = Number(matches[matches.length - 1][1])
  return Number.isFinite(value) ? value : null
}

export interface GlobalMotion {
  /** Frame-to-frame shift, in pixels of the analysed frame. */
  dx: number
  dy: number
  /** Frame-to-frame rotation, in radians. */
  angle: number
}

/**
 * Parses the `global_motions.trf` vidstabtransform writes with `debug=1`: one line per
 * frame, `<n> <dx> <dy> <angle> <zoom> <barrel>`, with `#` lines for comments. A frame
 * the detector could not measure is written as `# no fields` and comes back as no
 * motion, so frame indices stay aligned with the video.
 */
export function parseVidstabGlobalMotions(text: string): GlobalMotion[] {
  const motions: GlobalMotion[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# no fields')) {
      motions.push({ dx: 0, dy: 0, angle: 0 })
      continue
    }
    if (line.startsWith('#')) continue
    const parts = line.split(/\s+/).map(Number)
    if (parts.length < 4 || parts.slice(0, 4).some(v => !Number.isFinite(v))) continue
    motions.push({ dx: parts[1], dy: parts[2], angle: parts[3] })
  }
  return motions
}

/** A frame-to-frame jump this share of the frame width is far past handheld jitter. */
const OCCLUSION_JUMP_RATIO = 0.04
/** ...and has to stand this far above the motion around it. */
const OCCLUSION_CONTRAST = 8
/** Frames either side used to judge "the motion around it". */
const OCCLUSION_NEIGHBOURHOOD = 15
/** Jumps closer together than this are one event. */
const OCCLUSION_MERGE_SECONDS = 1

export interface StabilizationReport {
  warnings: StabilizationWarning[]
  /** SOURCE seconds of each occlusion event. */
  warningTimes: number[]
}

/**
 * Looks for what a bake cannot be trusted with.
 *
 * An occlusion is a sudden jump that the frames around it do not share: the camera does
 * not teleport, so a hand or an object crossing close to the lens has been read as camera
 * motion and the stabilizer has shoved a still shot sideways to "correct" it. Tripod mode
 * or cutting the stretch out are the fixes, so it is worth pointing at.
 */
export function analyzeStabilization(params: {
  motions: GlobalMotion[]
  fps: number
  /** Width of the analysed frame, in the same pixels as the motions. */
  frameWidth: number
  /** Source second of the first motion. */
  sourceStart: number
  zoomPercent?: number | null
}): StabilizationReport {
  const { motions, fps, frameWidth, sourceStart } = params
  const warnings: StabilizationWarning[] = []
  const warningTimes: number[] = []

  if (motions.length > 0 && frameWidth > 0 && fps > 0) {
    const size = motions.map(m => Math.hypot(m.dx, m.dy))
    const threshold = frameWidth * OCCLUSION_JUMP_RATIO
    let lastEvent = -Infinity
    for (let i = 0; i < size.length; i++) {
      if (size[i] < threshold) continue
      const around: number[] = []
      for (let j = i - OCCLUSION_NEIGHBOURHOOD; j <= i + OCCLUSION_NEIGHBOURHOOD; j++) {
        if (j >= 0 && j < size.length && Math.abs(j - i) > 2) around.push(size[j])
      }
      const baseline = median(around)
      if (size[i] < baseline * OCCLUSION_CONTRAST) continue
      const t = sourceStart + i / fps
      if (t - lastEvent < OCCLUSION_MERGE_SECONDS) continue
      lastEvent = t
      warningTimes.push(round3(t))
    }
    if (warningTimes.length > 0) warnings.push('occlusion')
  }

  if (params.zoomPercent != null && params.zoomPercent > STABILIZATION_HIGH_ZOOM_PERCENT) {
    warnings.push('highZoom')
  }
  return { warnings, warningTimes }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function round3(value: number): number {
  return Number(value.toFixed(3))
}

function round6(value: number): number {
  return Number(value.toFixed(6))
}
