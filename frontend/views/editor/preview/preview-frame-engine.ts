import type * as React from 'react'
import type { Asset, TimelineClip, TimelineTransition, Track, SubtitleClip, ChromaKey } from '../../../types/project-model'
import { hasActiveMask } from '../../../types/project-model'
import { sampleClipAt } from '@core/keyframes'
import { clipHasSpeedCurve, clipSourceTimeAt } from '@core/speed-curve'
import { stabilizedClipPath } from '@core/stabilization'
import { transitionOverlap } from '@core/timeline-transitions'
import { getClipEffectStyles, resolveEffectiveClipFilter } from '../video-editor-utils'
import { pathToFileUrl } from '../../../lib/file-url'

export type MonitorRenderMode = 'playback' | 'scrub'
export type SyncTarget = 'active' | 'incoming' | 'compositing'
export type VideoContributorRole = 'primary' | 'dissolveIncoming' | 'compositing'

export interface ActiveLetterboxState {
  ratio: number
  color: string
  opacity: number
  key: string
}

export interface AdjustmentEffectState {
  clip: TimelineClip
  filterStyle: React.CSSProperties
  hasVignette: boolean
  vignetteAmount: number
  hasGrain: boolean
  grainAmount: number
}

/** Stable reference: a fresh [] here would rebuild the frame cache every render. */
export const EMPTY_TRANSITIONS: TimelineTransition[] = []

export interface DissolvePair {
  outgoing: TimelineClip
  incoming: TimelineClip
}

export interface ActiveVideoContributor {
  clip: TimelineClip
  target: SyncTarget
  role: VideoContributorRole
  opacity: number
}

export interface FrameOverlayState {
  activeClip: TimelineClip | null
  crossDissolve: DissolvePair | null
  /** Which effect to draw across the overlap; 'dissolve' when unspecified. */
  crossDissolveType: string
  compositingStack: TimelineClip[]
  activeTextClips: TimelineClip[]
  /**
   * Stickers are overlays, never the program picture. Letting one become the
   * active clip swapped the video underneath between the compositing element
   * and the video pool every time a sticker began or ended, and the swap
   * showed as a flash in the middle of playback.
   */
  activeStickerClips: TimelineClip[]
  activeSubtitles: SubtitleClip[]
  activeLetterbox: ActiveLetterboxState | null
  activeAdjustmentEffects: AdjustmentEffectState[]
  /**
   * The LUT the active layer is graded with — its own, or the one an
   * adjustment layer lends it. Resolved once here so the WebGL canvas grades
   * the frame with the very file the exporter will use.
   */
  activeFilter: TimelineClip['filter']
  incomingFilter?: TimelineClip['filter']
  compositingFilters: Record<string, TimelineClip['filter']>
  /** The adjustment layers in force, for the layers that have no canvas. */
  activeAdjustmentSources: TimelineClip[]
  audioOnlyClips: TimelineClip[]
}

export interface FrameRenderState extends FrameOverlayState {
  atTime: number
  crossDissolveProgress: number
  activeVideoContributors: ActiveVideoContributor[]
}

export interface FrameRenderCache {
  transitions: TimelineTransition[]
  mediaClips: TimelineClip[]
  videoClips: TimelineClip[]
  textClips: TimelineClip[]
  stickerClips: TimelineClip[]
  adjustmentClips: TimelineClip[]
  audioClips: TimelineClip[]
  subtitles: SubtitleClip[]
  /** The frame's width over its height. Without it no clip can be known to cover the frame. */
  frameAspect?: number
}

export interface VideoContributorSyncState {
  lastAtTime: number | null
  pendingHardSync: boolean
}

export const BASE_VIDEO_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;pointer-events:none;'
export const VIDEO_POOL_PREROLL_SECONDS = 1.5
export const MAX_COMPOSITING_CANVASES = 3

export function resolveClipPathFromAssets(assets: Asset[], clip: TimelineClip, proxyEnabled = false): string {
  // Ahead of the proxy: a proxy is of the unstabilized frames.
  const stabilized = stabilizedClipPath(clip)
  if (stabilized) return stabilized
  const liveAsset = clip.assetId
    ? assets.find(asset => asset.id === clip.assetId) || clip.asset
    : clip.asset
  if (!liveAsset) return ''
  if (proxyEnabled && liveAsset.type === 'video' && liveAsset.proxyPath) {
    return liveAsset.proxyPath
  }
  return liveAsset.path || ''
}

export function createMonitorVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.muted = true
  video.style.cssText = BASE_VIDEO_STYLE
  video.src = pathToFileUrl(src)
  video.load()
  return video
}

export function applyPlaybackResolution(video: HTMLVideoElement, playbackResolution: 1 | 0.5 | 0.25) {
  if (playbackResolution < 1) {
    video.style.width = `${playbackResolution * 100}%`
    video.style.height = `${playbackResolution * 100}%`
    video.style.transform = `scale(${1 / playbackResolution})`
    video.style.transformOrigin = 'top left'
    return
  }

  video.style.width = '100%'
  video.style.height = '100%'
  video.style.transform = ''
  video.style.transformOrigin = ''
}

export function buildFrameRenderCache(
  clips: TimelineClip[],
  subtitles: SubtitleClip[],
  transitions: TimelineTransition[] = [],
  frameAspect?: number,
): FrameRenderCache {
  return {
    frameAspect,
    transitions,
    mediaClips: clips.filter(clip =>
      clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text' && !isStickerClip(clip)),
    videoClips: clips.filter(clip => isVideoClip(clip) && clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text'),
    textClips: clips.filter(clip => clip.type === 'text' && Boolean(clip.textStyle)),
    stickerClips: clips.filter(isStickerClip),
    adjustmentClips: clips.filter(clip => clip.type === 'adjustment'),
    audioClips: clips.filter(clip => clip.type === 'audio'),
    subtitles,
  }
}

/**
 * A still, however the clip came to be one.
 *
 * `clip.asset` is a snapshot taken when the clip was made, and a project whose
 * assets were re-linked can carry a clip that is plainly an image with no
 * snapshot on it. The compositing path has always allowed for that; the active
 * layer did not, so such a clip rendered nothing at all — and a filter applied
 * to it had nowhere to show, while the video underneath kept working.
 */
export function isStickerClip(clip: TimelineClip): boolean {
  return Boolean(clip.stickerId)
}

export function isImageClip(clip: TimelineClip | null | undefined): boolean {
  return Boolean(clip && (clip.asset?.type === 'image' || clip.type === 'image'))
}

export function isVideoClip(clip: TimelineClip | null | undefined): boolean {
  return Boolean(clip && (clip.asset?.type === 'video' || clip.type === 'video'))
}

export function getClipTargetTime(clip: TimelineClip, mediaDuration: number, atTime: number): number {
  const timeInClip = atTime - clip.startTime
  const usableMediaDuration = mediaDuration - clip.trimStart - clip.trimEnd

  if (clipHasSpeedCurve(clip)) {
    return Math.max(0, Math.min(mediaDuration, clipSourceTimeAt(clip, timeInClip, mediaDuration)))
  }

  return clip.reversed
    ? Math.max(0, Math.min(mediaDuration, clip.trimStart + usableMediaDuration - timeInClip * (clip.speed ?? 1)))
    : Math.max(0, Math.min(mediaDuration, clip.trimStart + timeInClip * (clip.speed ?? 1)))
}

/**
 * The video clips that start within `withinSeconds` after `afterTime`, soonest first.
 *
 * Each of these is a picture the monitor will need in a moment, whatever track it is on: the
 * clip that follows on the main track, but equally an overlay that starts at the same instant.
 */
export function upcomingVideoClips(clips: TimelineClip[], afterTime: number, withinSeconds: number): TimelineClip[] {
  return clips
    .filter(clip =>
      clip.asset?.type === 'video' &&
      clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text' &&
      clip.startTime > afterTime &&
      clip.startTime - afterTime <= withinSeconds)
    .sort((a, b) => a.startTime - b.startTime)
}

export function getTopVisibleClipAtTime(mediaClips: TimelineClip[], tracks: Track[], time: number): TimelineClip | null {
  let best: { clip: TimelineClip; arrayIndex: number } | null = null

  for (let arrayIndex = 0; arrayIndex < mediaClips.length; arrayIndex += 1) {
    const clip = mediaClips[arrayIndex]
    if (tracks[clip.trackIndex]?.enabled === false) continue
    if (time < clip.startTime || time >= clip.startTime + clip.duration) continue
    if (!best) {
      best = { clip, arrayIndex }
      continue
    }
    if (clip.trackIndex > best.clip.trackIndex || (clip.trackIndex === best.clip.trackIndex && arrayIndex > best.arrayIndex)) {
      best = { clip, arrayIndex }
    }
  }

  return best?.clip ?? null
}

/**
 * The transition covering this instant, if any.
 *
 * Clips joined by a transition genuinely overlap now, so the window is simply
 * the overlap: from where the incoming clip starts to where the outgoing one
 * ends. That is also exactly the window ffmpeg's xfade renders, which is what
 * keeps the preview and the export showing the same frame.
 */
export function getTransitionAtTime(
  mediaClips: TimelineClip[],
  transitions: TimelineTransition[],
  tracks: Track[],
  time: number,
): { pair: DissolvePair; progress: number; type: string } | null {
  for (const transition of transitions) {
    const outgoing = mediaClips.find(clip => clip.id === transition.leftClipId)
    const incoming = mediaClips.find(clip => clip.id === transition.rightClipId)
    if (!outgoing || !incoming) continue
    if (tracks[outgoing.trackIndex]?.enabled === false) continue
    if (tracks[incoming.trackIndex]?.enabled === false) continue

    // A record whose clips have swapped places (or no longer overlap) describes nothing. Taken
    // at its word it made a 12 s stretch of the timeline one dissolve: the wrong clip in front,
    // and every clip above it left undrawn. Projects saved that way still load this way.
    if (transitionOverlap(outgoing, incoming) <= 0) continue

    const start = incoming.startTime
    const end = outgoing.startTime + outgoing.duration
    if (time < start || time >= end) continue

    return {
      pair: { outgoing, incoming },
      progress: Math.max(0, Math.min(1, (time - start) / (end - start))),
      type: transition.type,
    }
  }
  return null
}

/** The overlay clips — text or sticker — covering this instant, lowest track first. */
export function getActiveOverlayClips(overlayClips: TimelineClip[], tracks: Track[], time: number): TimelineClip[] {
  return overlayClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
}

export function getActiveSubtitles(subtitles: SubtitleClip[], tracks: Track[], time: number): SubtitleClip[] {
  return subtitles.filter(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return Boolean(track) && !track.muted && time >= subtitle.startTime && time < subtitle.endTime
  })
}

export function getActiveLetterbox(adjustmentClips: TimelineClip[], tracks: Track[], time: number): ActiveLetterboxState | null {
  const ratioMap: Record<string, number> = {
    '2.35:1': 2.35,
    '2.39:1': 2.39,
    '2.76:1': 2.76,
    '1.85:1': 1.85,
    '4:3': 4 / 3,
  }

  const activeAdjustments = adjustmentClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => b.trackIndex - a.trackIndex)

  for (const clip of activeAdjustments) {
    if (!clip.letterbox?.enabled) continue
    const ratio = clip.letterbox.aspectRatio === 'custom'
      ? (clip.letterbox.customRatio || 2.35)
      : (ratioMap[clip.letterbox.aspectRatio] || 2.35)
    return {
      ratio,
      color: clip.letterbox.color || '#000000',
      opacity: (clip.letterbox.opacity ?? 100) / 100,
      key: `${clip.id}:${ratio}:${clip.letterbox.color || '#000000'}:${clip.letterbox.opacity ?? 100}`,
    }
  }

  return null
}

export function getSampledChromaKey(clip: TimelineClip | null | undefined, currentTime: number): ChromaKey | undefined {
  if (!clip?.chromaKey?.enabled) return clip?.chromaKey
  const timeInClip = Math.max(0, currentTime - clip.startTime)
  const sampled = sampleClipAt(clip, timeInClip)
  if (
    sampled.chromaKeySimilarity !== undefined ||
    sampled.chromaKeySmoothness !== undefined ||
    sampled.chromaKeySpill !== undefined ||
    sampled.chromaKeyFeatherEdge !== undefined ||
    sampled.chromaKeyCleanEdge !== undefined
  ) {
    return {
      ...clip.chromaKey,
      similarity: sampled.chromaKeySimilarity ?? clip.chromaKey.similarity,
      smoothness: sampled.chromaKeySmoothness ?? clip.chromaKey.smoothness,
      spill: sampled.chromaKeySpill ?? clip.chromaKey.spill,
      featherEdge: sampled.chromaKeyFeatherEdge ?? clip.chromaKey.featherEdge ?? 0,
      cleanEdge: sampled.chromaKeyCleanEdge ?? clip.chromaKey.cleanEdge ?? 0,
    }
  }
  return clip.chromaKey
}

/**
 * Whether this clip's picture is cut out by the WebGL canvas rather than shown whole.
 *
 * The raw `<video>`/`<img>` sits UNDER `LutCanvas`, and the canvas is transparent
 * wherever the shader removed something. So for every effect that punches holes in the
 * frame, the element underneath has to be hidden — otherwise the untouched picture shows
 * straight through the hole and the effect looks like it did nothing.
 *
 * Only chroma key was listed here, which is why background removal appeared to be off in
 * the preview: the cut-out was drawn correctly on the canvas, and the full frame,
 * background and all, was showing through it from the `<video>` below. It looked like it
 * worked only while a render-cache segment was ready, because that plays over the top of
 * everything at z-15. Reopening a project (new segment hashes, nothing cached yet) left
 * the preview with no cut-out at all until the cache caught up — and patchy while it did,
 * one segment at a time.
 *
 * This must stay in step with `LutCanvas`'s own list of things that make it draw.
 */
export function clipNeedsAlphaCanvas(clip: TimelineClip | null | undefined): boolean {
  if (!clip) return false
  if (clip.chromaKey?.enabled) return true
  if (clip.autoMatte?.enabled) return true
  if (clip.customMatte?.enabled && (clip.customMatte.strokes?.length ?? 0) > 0) return true
  if (clip.stroke?.enabled && clip.stroke.style !== 'none' && clip.stroke.width > 0) return true
  return false
}

export function isNonOpaqueClip(clip: TimelineClip): boolean {
  if ((clip.opacity ?? 100) < 100) return true
  if (clip.chromaKey?.enabled) return true
  if (clip.autoMatte?.enabled) return true
  if (clip.customMatte?.enabled) return true
  if (clip.stroke?.enabled && clip.stroke.style !== 'none' && clip.stroke.width > 0) return true
  if (clip.blendMode && clip.blendMode !== 'normal') return true
  if (hasActiveMask(clip)) return true
  if (clip.trackIndex > 0) return true
  if (isImageClip(clip)) return true
  if (clip.transform && (clip.transform.scale < 100 || clip.transform.positionX !== 0 || clip.transform.positionY !== 0)) return true
  return false
}

/** Files that cannot carry transparency: a still of one of these is opaque. */
const OPAQUE_STILL_EXTENSION = /\.(jpe?g|bmp)$/i

/** Short of this much of the frame left uncovered, a clip counts as covering it (0.5%). */
const COVER_TOLERANCE = 0.005

/**
 * Whether a clip, as the monitor draws it at that moment, hides everything under it: opaque,
 * and filling the whole frame.
 *
 * "Filling" is worked out the way the monitor draws: the picture is fitted inside the frame
 * (`object-fit: contain`), then scaled and moved by the clip's transform. A 9:16 clip in a 9:16
 * frame fills it; a 16:9 one leaves bars until it is scaled up past them. Anything that makes
 * part of the picture see-through — opacity, a blend mode, a mask, a key, a cut-out, a fade, a
 * rotation, a crop, a move that uncovers an edge — means it does not. So does anything not
 * known: a still that may carry an alpha channel, a size that was never measured.
 *
 * `timeInClip` is the playhead's time inside the clip, so keyframed scale, position and opacity
 * are taken where they stand now.
 */
export function clipCoversFrame(clip: TimelineClip, frameAspect: number | undefined, timeInClip: number): boolean {
  if (!frameAspect || !Number.isFinite(frameAspect) || frameAspect <= 0) return false
  if (clip.type === 'text' || clip.type === 'audio' || clip.type === 'adjustment') return false

  const asset = clip.asset
  const isStill = isImageClip(clip)
  if (isStill && !OPAQUE_STILL_EXTENSION.test(asset?.path ?? '')) return false
  // A video's size is only trusted once it has been measured the way a player shows it.
  if (!isStill && asset?.rotationChecked !== true) return false
  const width = asset?.width
  const height = asset?.height
  if (!width || !height || width <= 0 || height <= 0) return false

  if (clip.blendMode && clip.blendMode !== 'normal') return false
  if (hasActiveMask(clip)) return false
  if (clip.chromaKey?.enabled || clip.autoMatte?.enabled || clip.customMatte?.enabled) return false
  if (clip.stroke?.enabled && clip.stroke.style !== 'none' && clip.stroke.width > 0) return false

  const sampled = sampleClipAt(clip, Math.max(0, timeInClip))
  if (sampled.opacity < 100 - COVER_TOLERANCE) return false

  // Fades to black or white lower the clip's own opacity near its ends.
  const fadesIn = clip.transitionIn && clip.transitionIn.duration > 0 &&
    (clip.transitionIn.type === 'fade-to-black' || clip.transitionIn.type === 'fade-to-white')
  if (fadesIn && timeInClip < clip.transitionIn.duration) return false
  const fadesOut = clip.transitionOut && clip.transitionOut.duration > 0 &&
    (clip.transitionOut.type === 'fade-to-black' || clip.transitionOut.type === 'fade-to-white')
  if (fadesOut && clip.duration - timeInClip < clip.transitionOut.duration) return false

  const transform = clip.transform
  if (transform && (transform.cropTop || transform.cropRight || transform.cropBottom || transform.cropLeft)) return false
  if (Math.abs(sampled.rotation % 360) > 0.01) return false
  if (Math.abs(sampled.positionX) > 0.01 || Math.abs(sampled.positionY) > 0.01) return false

  // The frame is `frameAspect` wide and 1 high; the picture is fitted inside it.
  const pictureAspect = width / height
  const fittedWidth = pictureAspect >= frameAspect ? frameAspect : pictureAspect
  const fittedHeight = pictureAspect >= frameAspect ? frameAspect / pictureAspect : 1
  const scaleX = (sampled.scaleX ?? sampled.scale) / 100
  const scaleY = (sampled.scaleY ?? sampled.scale) / 100
  return fittedWidth * scaleX >= frameAspect * (1 - COVER_TOLERANCE) &&
    fittedHeight * scaleY >= 1 - COVER_TOLERANCE
}

/**
 * The layers drawn under the active clip, lowest first.
 *
 * Top down, each layer hides what is under it: once a layer covers the whole frame nothing below
 * it can be seen, so nothing below it is drawn. That is also what keeps the layers under an
 * overlay from showing for a moment while the overlay is still getting its picture.
 *
 * During a transition the active clip is fading, so it covers nothing. And when the frame's
 * shape is not known, a clip is judged by `isNonOpaqueClip` alone, as it always was.
 */
export function getCompositingStack(
  mediaClips: TimelineClip[],
  tracks: Track[],
  activeClip: TimelineClip | null,
  time: number,
  options: { frameAspect?: number; inTransition?: boolean } = {},
): TimelineClip[] {
  if (!activeClip) return []
  const { frameAspect, inTransition = false } = options

  const hidesWhatIsUnder = (clip: TimelineClip): boolean => {
    if (inTransition && clip.id === activeClip.id) return false
    return frameAspect
      ? clipCoversFrame(clip, frameAspect, time - clip.startTime)
      : !isNonOpaqueClip(clip)
  }
  if (hidesWhatIsUnder(activeClip)) return []

  const below = mediaClips
    .filter(clip =>
      clip.id !== activeClip.id &&
      tracks[clip.trackIndex]?.enabled !== false &&
      clip.trackIndex < activeClip.trackIndex &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => b.trackIndex - a.trackIndex)

  const stack: TimelineClip[] = []
  for (const clip of below) {
    stack.push(clip)
    if (hidesWhatIsUnder(clip)) break
  }
  return stack.reverse()
}

export function getStyleOpacity(style: React.CSSProperties): number {
  if (typeof style.opacity === 'number') return style.opacity
  if (typeof style.opacity === 'string') {
    const parsed = Number(style.opacity)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}

export function toStyleValue(value: string | number | undefined): string {
  if (value === undefined) return ''
  return String(value)
}

export function clearEffectStyle(element: HTMLElement): void {
  element.style.filter = ''
  element.style.transform = ''
  element.style.clipPath = ''
  element.style.opacity = ''
  element.style.maskImage = ''
  element.style.webkitMaskImage = ''
  element.style.maskSize = ''
  element.style.webkitMaskSize = ''
  element.style.maskRepeat = ''
  element.style.webkitMaskRepeat = ''
  element.style.maskPosition = ''
  element.style.webkitMaskPosition = ''
  element.style.mixBlendMode = ''
}

export function applyEffectStyle(
  element: HTMLElement,
  style: React.CSSProperties,
  opacityOverride?: number,
): void {
  element.style.filter = toStyleValue(style.filter as string | undefined)
  element.style.transform = toStyleValue(style.transform as string | undefined)
  element.style.clipPath = toStyleValue(style.clipPath as string | undefined)
  element.style.opacity = toStyleValue(
    opacityOverride !== undefined ? opacityOverride : (style.opacity as string | number | undefined),
  )
  const anyStyle = style as any
  element.style.maskImage = toStyleValue(style.maskImage as string | undefined)
  element.style.webkitMaskImage = toStyleValue((anyStyle.WebkitMaskImage ?? style.maskImage) as string | undefined)
  element.style.maskSize = toStyleValue((anyStyle.maskSize ?? '100% 100%') as string | undefined)
  element.style.webkitMaskSize = toStyleValue((anyStyle.WebkitMaskSize ?? anyStyle.maskSize ?? '100% 100%') as string | undefined)
  element.style.maskRepeat = toStyleValue((anyStyle.maskRepeat ?? 'no-repeat') as string | undefined)
  element.style.webkitMaskRepeat = toStyleValue((anyStyle.WebkitMaskRepeat ?? anyStyle.maskRepeat ?? 'no-repeat') as string | undefined)
  element.style.maskPosition = toStyleValue((anyStyle.maskPosition ?? 'center') as string | undefined)
  element.style.webkitMaskPosition = toStyleValue((anyStyle.WebkitMaskPosition ?? anyStyle.maskPosition ?? 'center') as string | undefined)
  element.style.mixBlendMode = toStyleValue(anyStyle.mixBlendMode as string | undefined)
}

export function getActiveVideoContributors(
  activeClip: TimelineClip | null,
  crossDissolve: DissolvePair | null,
  crossDissolveProgress: number,
  compositingStack: TimelineClip[],
  time: number,
): ActiveVideoContributor[] {
  const contributors: ActiveVideoContributor[] = []
  const primaryClip = crossDissolve?.outgoing ?? activeClip

  if (primaryClip && isVideoClip(primaryClip)) {
    const primaryOpacity = crossDissolve
      ? (1 - crossDissolveProgress) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
      : getStyleOpacity(getClipEffectStyles(primaryClip, Math.max(0, time - primaryClip.startTime)))
    contributors.push({
      clip: primaryClip,
      target: 'active',
      role: 'primary',
      opacity: primaryOpacity,
    })
  }

  if (crossDissolve && isVideoClip(crossDissolve.incoming)) {
    contributors.push({
      clip: crossDissolve.incoming,
      target: 'incoming',
      role: 'dissolveIncoming',
      opacity: crossDissolveProgress * ((crossDissolve.incoming.opacity ?? 100) / 100),
    })
  }

  for (const clip of compositingStack) {
    if (!isVideoClip(clip)) continue
    contributors.push({
      clip,
      target: 'compositing',
      role: 'compositing',
      opacity: getStyleOpacity(getClipEffectStyles(clip, Math.max(0, time - clip.startTime))),
    })
  }

  return contributors
}

export function getActiveAdjustmentEffects(adjustmentClips: TimelineClip[], tracks: Track[], time: number): AdjustmentEffectState[] {
  return adjustmentClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
    .map(clip => {
      // The layer's LUT is handed to the pictures it covers — as a real grade
      // on the active one, as an approximation on the rest — so the blanket
      // backdrop must not apply it a second time on top of them. What is left
      // here is what only a full-frame overlay can do: an adjustment layer's
      // own effects, its vignette, its grain.
      const filterStyle = getClipEffectStyles(clip, Math.max(0, time - clip.startTime), { lutApproximation: false })
      const effects = clip.effects || []
      const vignette = effects.find(e => e.type === 'vignette' && e.enabled)
      const grain = effects.find(e => e.type === 'grain' && e.enabled)
      return {
        clip,
        filterStyle: {
          filter: filterStyle.filter || 'none',
        },
        hasVignette: Boolean(vignette),
        vignetteAmount: (vignette?.params?.amount ?? 0) / 100,
        hasGrain: Boolean(grain),
        grainAmount: grain?.params?.amount ?? 0,
      }
    })
}

export function deriveFrameRenderState(cache: FrameRenderCache, tracks: Track[], time: number): FrameRenderState {
  let sampleTime = time
  let maxEnd = 0
  for (const c of cache.mediaClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const c of cache.textClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const c of cache.stickerClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const s of cache.subtitles) if (s.endTime > maxEnd) maxEnd = s.endTime
  if (maxEnd > 0 && sampleTime >= maxEnd) {
    sampleTime = Math.max(0, maxEnd - 0.001)
  }

  const topClip = getTopVisibleClipAtTime(cache.mediaClips, tracks, sampleTime)
  const transitionHere = getTransitionAtTime(cache.mediaClips, cache.transitions, tracks, sampleTime)
  // A transition belongs to its own track. A clip on a track above it that fills the frame hides
  // the whole thing, as it hides every layer under it: the transition is not drawn at all.
  const dissolve = transitionHere && topClip &&
    topClip.trackIndex > transitionHere.pair.outgoing.trackIndex &&
    clipCoversFrame(topClip, cache.frameAspect, sampleTime - topClip.startTime)
    ? null
    : transitionHere
  // Inside a transition the pair decides the two layers, not "topmost clip".
  // The clips genuinely overlap now, so the plain test picks the *incoming*
  // one as active — and the outgoing clip, which the effect is supposed to
  // reveal from under, would never get drawn at all.
  const activeClip = dissolve?.pair.outgoing ?? topClip
  const compositingStack = getCompositingStack(cache.mediaClips, tracks, activeClip, sampleTime, {
    frameAspect: cache.frameAspect,
    inTransition: Boolean(dissolve),
  })
  const adjustmentSources = cache.adjustmentClips.filter(clip =>
    tracks[clip.trackIndex]?.enabled !== false && clip.filter,
  )

  const incomingClip = dissolve?.pair.incoming ?? null
  const incomingFilter = incomingClip
    ? resolveEffectiveClipFilter(incomingClip, adjustmentSources, tracks, Math.max(0, sampleTime - incomingClip.startTime))
    : undefined

  const compositingFilters: Record<string, TimelineClip['filter']> = {}
  for (const clip of compositingStack) {
    compositingFilters[clip.id] = resolveEffectiveClipFilter(
      clip,
      adjustmentSources,
      tracks,
      Math.max(0, sampleTime - clip.startTime),
    )
  }

  return {
    atTime: time,
    activeClip,
    crossDissolve: dissolve?.pair ?? null,
    crossDissolveProgress: dissolve?.progress ?? 0,
    crossDissolveType: dissolve?.type ?? 'dissolve',
    compositingStack,
    activeTextClips: getActiveOverlayClips(cache.textClips, tracks, sampleTime),
    activeStickerClips: getActiveOverlayClips(cache.stickerClips, tracks, sampleTime),
    activeSubtitles: getActiveSubtitles(cache.subtitles, tracks, sampleTime),
    activeLetterbox: getActiveLetterbox(cache.adjustmentClips, tracks, sampleTime),
    activeAdjustmentEffects: getActiveAdjustmentEffects(cache.adjustmentClips, tracks, sampleTime),
    activeFilter: activeClip ? resolveEffectiveClipFilter(activeClip, adjustmentSources, tracks, Math.max(0, sampleTime - activeClip.startTime)) : undefined,
    incomingFilter,
    compositingFilters,
    activeAdjustmentSources: adjustmentSources,
    audioOnlyClips: cache.audioClips.filter(clip => sampleTime >= clip.startTime && sampleTime < clip.startTime + clip.duration),
    activeVideoContributors: getActiveVideoContributors(activeClip, dissolve?.pair ?? null, dissolve?.progress ?? 0, compositingStack, sampleTime),
  }
}

export function sameClipList(a: TimelineClip[], b: TimelineClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((clip, index) => clip === b[index])
}

export function sameSubtitleList(a: SubtitleClip[], b: SubtitleClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((subtitle, index) => subtitle === b[index])
}

export function sameLetterbox(a: ActiveLetterboxState | null, b: ActiveLetterboxState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.key === b.key
}

export function sameDissolve(a: DissolvePair | null, b: DissolvePair | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.outgoing === b.outgoing && a.incoming === b.incoming
}

export function sameAdjustmentEffects(a: AdjustmentEffectState[], b: AdjustmentEffectState[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, idx) => {
    const candidate = b[idx]
    return (
      item.clip.id === candidate.clip.id &&
      item.filterStyle.filter === candidate.filterStyle.filter &&
      item.hasVignette === candidate.hasVignette &&
      item.vignetteAmount === candidate.vignetteAmount &&
      item.hasGrain === candidate.hasGrain &&
      item.grainAmount === candidate.grainAmount
    )
  })
}

export function sameFilters(a: TimelineClip['filter'], b: TimelineClip['filter']): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.id === b.id && a.intensity === b.intensity
}

export function sameCompositingFilters(
  a: Record<string, TimelineClip['filter']>,
  b: Record<string, TimelineClip['filter']>,
): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(k => sameFilters(a[k], b[k]))
}

export function sameClipVisualProperties(a: TimelineClip | null, b: TimelineClip | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.startTime === b.startTime &&
    a.duration === b.duration &&
    a.trimStart === b.trimStart &&
    a.trimEnd === b.trimEnd &&
    a.speed === b.speed &&
    a.speedCurve === b.speedCurve &&
    a.reversed === b.reversed &&
    a.opacity === b.opacity &&
    a.autoMatte?.enabled === b.autoMatte?.enabled &&
    a.autoMatte?.cleanEdge === b.autoMatte?.cleanEdge &&
    a.autoMatte?.featherEdge === b.autoMatte?.featherEdge &&
    a.autoMatte?.bake?.path === b.autoMatte?.bake?.path &&
    a.chromaKey?.enabled === b.chromaKey?.enabled &&
    a.chromaKey?.color === b.chromaKey?.color &&
    a.chromaKey?.similarity === b.chromaKey?.similarity &&
    a.chromaKey?.smoothness === b.chromaKey?.smoothness &&
    a.chromaKey?.spill === b.chromaKey?.spill &&
    a.chromaKey?.cleanEdge === b.chromaKey?.cleanEdge &&
    a.chromaKey?.featherEdge === b.chromaKey?.featherEdge &&
    a.customMatte?.enabled === b.customMatte?.enabled &&
    a.customMatte?.appliedHash === b.customMatte?.appliedHash &&
    a.customMatte?.strokes?.length === b.customMatte?.strokes?.length &&
    a.stroke?.enabled === b.stroke?.enabled &&
    a.stroke?.style === b.stroke?.style &&
    a.stroke?.width === b.stroke?.width &&
    a.stroke?.color === b.stroke?.color &&
    a.stroke?.opacity === b.stroke?.opacity &&
    a.stroke?.offsetX === b.stroke?.offsetX &&
    a.stroke?.offsetY === b.stroke?.offsetY &&
    a.stroke?.glow === b.stroke?.glow &&
    a.stroke?.roughness === b.stroke?.roughness &&
    a.stroke?.gap === b.stroke?.gap &&
    a.stroke?.seed === b.stroke?.seed &&
    a.filter?.id === b.filter?.id &&
    a.filter?.intensity === b.filter?.intensity &&
    // Masks are replaced, never edited in place, so a changed mask is a new object. Leaving them
    // out kept the monitor on the clip as it was before the mask was added or moved.
    a.mask === b.mask &&
    a.masks === b.masks
  )
}

export function sameFrameOverlayState(a: FrameOverlayState, b: FrameOverlayState): boolean {
  return (
    sameClipVisualProperties(a.activeClip, b.activeClip) &&
    sameDissolve(a.crossDissolve, b.crossDissolve) &&
    sameClipList(a.compositingStack, b.compositingStack) &&
    sameClipList(a.activeTextClips, b.activeTextClips) &&
    sameClipList(a.activeStickerClips, b.activeStickerClips) &&
    sameSubtitleList(a.activeSubtitles, b.activeSubtitles) &&
    sameLetterbox(a.activeLetterbox, b.activeLetterbox) &&
    sameClipList(a.audioOnlyClips, b.audioOnlyClips) &&
    sameAdjustmentEffects(a.activeAdjustmentEffects, b.activeAdjustmentEffects) &&
    sameFilters(a.activeFilter, b.activeFilter) &&
    sameFilters(a.incomingFilter, b.incomingFilter) &&
    sameCompositingFilters(a.compositingFilters, b.compositingFilters) &&
    sameClipList(a.activeAdjustmentSources, b.activeAdjustmentSources)
  )
}

export function sameVideoContributors(a: ActiveVideoContributor[], b: ActiveVideoContributor[]): boolean {
  if (a.length !== b.length) return false
  return a.every((contributor, index) => {
    const candidate = b[index]
    return (
      sameClipVisualProperties(contributor.clip, candidate.clip) &&
      contributor.target === candidate.target &&
      contributor.role === candidate.role &&
      contributor.opacity === candidate.opacity
    )
  })
}

export function sameFrameRenderState(a: FrameRenderState, b: FrameRenderState): boolean {
  return (
    a.atTime === b.atTime &&
    a.crossDissolveProgress === b.crossDissolveProgress &&
    sameFrameOverlayState(a, b) &&
    sameVideoContributors(a.activeVideoContributors, b.activeVideoContributors)
  )
}