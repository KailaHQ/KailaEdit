import type { Asset, TimelineClip, Track } from './project-model'
import { mediaSecondsForTimelineSeconds } from './clip-speed'

/*
 * Replace clip: put different media into a clip that is already on the timeline, keeping
 * everything about the clip's place in the edit — its id, track, start, duration, speed,
 * transitions, keyframes, transform, grade, filter, effects, mask, blend and audio level.
 * Only what depends on the old media's frames changes: the asset, the clip type, the in
 * and out points, and bakes made from those frames.
 *
 * The duration never changes, so nothing around the clip moves. That is also why a video
 * shorter than the stretch the clip plays is refused rather than accepted and shortened.
 */

/** Why a replacement cannot be made, or null when it can. */
export type ReplaceClipRefusal =
  | 'not-replaceable'   // text, stickers, shapes, audio, adjustment layers
  | 'unsupported-media' // only video and image media can go in
  | 'same-media'        // it already is this media
  | 'too-short'         // a video that ends before the clip does
  | 'locked'            // the clip sits on a locked track

/** A clip that shows a video or picture of its own — the kind that can be replaced. */
export function isReplaceableClip(clip: TimelineClip | null | undefined): clip is TimelineClip {
  if (!clip) return false
  if (clip.type !== 'video' && clip.type !== 'image') return false
  // Stickers and shapes are images too, but they are generated overlays, not footage.
  return !clip.stickerId && !clip.shapeProperties
}

/** Seconds of source media the clip plays: its duration at its speed. */
export function replacementSourceSpan(clip: Pick<TimelineClip, 'duration' | 'speed'>): number {
  return mediaSecondsForTimelineSeconds(clip.duration, clip.speed)
}

/**
 * How many seconds a replacing video has to spare beyond the stretch the clip plays —
 * the room there is to choose where in it the clip starts. 0 for a still, or a video with
 * no known length.
 */
export function replacementSlack(
  clip: Pick<TimelineClip, 'duration' | 'speed'>,
  asset: Pick<Asset, 'type' | 'duration'>,
): number {
  if (asset.type !== 'video' || typeof asset.duration !== 'number' || !(asset.duration > 0)) return 0
  return Math.max(0, asset.duration - replacementSourceSpan(clip))
}

/** A start point in the replacing video, kept where the whole clip still fits. */
export function clampReplacementStart(
  start: number,
  clip: Pick<TimelineClip, 'duration' | 'speed'>,
  asset: Pick<Asset, 'type' | 'duration'>,
): number {
  if (!Number.isFinite(start)) return 0
  return Math.min(Math.max(0, start), replacementSlack(clip, asset))
}

/** Allowance for container durations that land a frame short of the clip. */
const DURATION_TOLERANCE = 0.02

export function replaceClipRefusal(
  clip: TimelineClip,
  asset: Pick<Asset, 'id' | 'type' | 'duration'>,
  tracks: ReadonlyArray<Pick<Track, 'locked'>> = [],
): ReplaceClipRefusal | null {
  if (!isReplaceableClip(clip)) return 'not-replaceable'
  if (tracks[clip.trackIndex]?.locked) return 'locked'
  if (asset.type !== 'video' && asset.type !== 'image') return 'unsupported-media'
  if (clip.assetId === asset.id) return 'same-media'
  if (asset.type === 'video' && typeof asset.duration === 'number' && asset.duration > 0
    && asset.duration + DURATION_TOLERANCE < replacementSourceSpan(clip)) {
    return 'too-short'
  }
  return null
}

/**
 * The clip with `asset` in it. `sourceStart` picks where in a video it starts (default:
 * the beginning), clamped so the whole clip still fits inside the media.
 */
export function buildReplacedClip(clip: TimelineClip, asset: Asset, sourceStart = 0): TimelineClip {
  const isVideo = asset.type === 'video'
  const span = replacementSourceSpan(clip)
  const mediaDuration = typeof asset.duration === 'number' && asset.duration > 0 ? asset.duration : undefined

  let trimStart = 0
  let trimEnd = 0
  if (isVideo) {
    const latestStart = mediaDuration !== undefined ? Math.max(0, mediaDuration - span) : Number.POSITIVE_INFINITY
    trimStart = Math.min(Math.max(0, sourceStart), latestStart)
    trimEnd = mediaDuration !== undefined ? Math.max(0, mediaDuration - trimStart - span) : 0
  }

  const next: TimelineClip = {
    ...clip,
    type: isVideo ? 'video' : 'image',
    assetId: asset.id,
    asset,
    trimStart,
    trimEnd,
    // A still has no direction to play in.
    reversed: isVideo ? clip.reversed : false,
    // The clip now shows the new media; its old name would only mislead.
    importedName: undefined,
  }

  // Bakes are of the old media's frames. The settings stay, so the editor makes them
  // again from the new media; the files do not.
  if (clip.autoMatte) next.autoMatte = { ...clip.autoMatte, bake: undefined }
  if (clip.customMatte) next.customMatte = { ...clip.customMatte, bake: undefined, appliedHash: undefined }
  if (clip.stabilization) {
    if (isVideo) next.stabilization = { ...clip.stabilization, bake: undefined }
    else delete next.stabilization // a still has no camera motion to take out
  }
  return next
}
