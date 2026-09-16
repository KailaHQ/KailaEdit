import React from 'react'
import {
  Layers, Video, Menu, ZoomIn,
  ChevronLeft, ChevronRight, Pause, Play,
  Expand, Shrink, Pipette, Shield, X,
} from 'lucide-react'
import { Tooltip } from '../../components/ui/tooltip'
import { AudioWaveform } from '../../components/AudioWaveform'
import { pathToFileUrl } from '../../lib/file-url'
import { DEFAULT_SUBTITLE_STYLE } from '../../types/project-model'
import type { Asset, TimelineClip, TimelineTransition, Track, SubtitleClip } from '../../types/project-model'
import { transitionLayerStyles } from '@core/transition-styles'
import { getEffectiveTimelineDimensions } from '@core/video-resolution'
import { sampleClipAt, hasKeyframesForProperty, computeMediaTimeFromTimelineTime } from '@core/keyframes'
import { getClipEffectStyles, getTransitionBgColor, formatTime, getShortcutLabel, tooltipLabel, resolveEffectiveClipFilter } from './video-editor-utils'
import { LutCanvas, type LutCanvasRef } from './preview/LutCanvas'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import { useSettings } from '../../contexts/SettingsContext'
import {
  selectActiveTimeline,
  selectAssets,
  selectClips,
  selectCropMode,
  selectCurrentTime,
  selectContentDuration,
  selectEyedropperMode,
  selectIsPlaying,
  selectMaskMode,
  selectPreviewAsset,
  selectSelectedClipForProperties,
  selectSelectedClipIds,
  selectSubtitles,
  selectTotalDuration,
  selectTracks,
} from './editor-selectors'
import { TransformBoundingBox } from './preview/TransformBoundingBox'
import { clipScreenBox } from '@core/video-editor-utils'
import { playbackDriveModeForSpeed } from '@core/clip-speed'
import { MaskBoundingBox } from './preview/MaskBoundingBox'
import { TextBoundingBox } from './preview/TextBoundingBox'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { useRenderCacheStore } from './render-cache-store'

type MonitorRenderMode = 'playback' | 'scrub'
type SyncTarget = 'active' | 'incoming' | 'compositing'
type VideoContributorRole = 'primary' | 'dissolveIncoming' | 'compositing'

interface ActiveLetterboxState {
  ratio: number
  color: string
  opacity: number
  key: string
}

interface AdjustmentEffectState {
  clip: TimelineClip
  filterStyle: React.CSSProperties
  hasVignette: boolean
  vignetteAmount: number
  hasGrain: boolean
  grainAmount: number
}

/** Stable reference: a fresh [] here would rebuild the frame cache every render. */
const EMPTY_TRANSITIONS: TimelineTransition[] = []

interface DissolvePair {
  outgoing: TimelineClip
  incoming: TimelineClip
}

interface ActiveVideoContributor {
  clip: TimelineClip
  target: SyncTarget
  role: VideoContributorRole
  opacity: number
}

interface FrameOverlayState {
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

interface FrameRenderState extends FrameOverlayState {
  atTime: number
  crossDissolveProgress: number
  activeVideoContributors: ActiveVideoContributor[]
}

interface FrameRenderCache {
  transitions: TimelineTransition[]
  mediaClips: TimelineClip[]
  videoClips: TimelineClip[]
  textClips: TimelineClip[]
  stickerClips: TimelineClip[]
  adjustmentClips: TimelineClip[]
  audioClips: TimelineClip[]
  subtitles: SubtitleClip[]
}

interface VideoContributorSyncState {
  lastAtTime: number | null
  pendingHardSync: boolean
}

const BASE_VIDEO_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;pointer-events:none;'
const VIDEO_POOL_PREROLL_SECONDS = 1.5
const MAX_COMPOSITING_CANVASES = 3

function resolveClipPathFromAssets(assets: Asset[], clip: TimelineClip, proxyEnabled = false): string {
  const liveAsset = clip.assetId
    ? assets.find(asset => asset.id === clip.assetId) || clip.asset
    : clip.asset
  if (!liveAsset) return ''
  if (proxyEnabled && liveAsset.type === 'video' && liveAsset.proxyPath) {
    return liveAsset.proxyPath
  }
  return liveAsset.path || ''
}

function createMonitorVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.muted = true
  video.style.cssText = BASE_VIDEO_STYLE
  video.src = pathToFileUrl(src)
  video.load()
  return video
}

function applyPlaybackResolution(video: HTMLVideoElement, playbackResolution: 1 | 0.5 | 0.25) {
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

function buildFrameRenderCache(
  clips: TimelineClip[],
  subtitles: SubtitleClip[],
  transitions: TimelineTransition[] = [],
): FrameRenderCache {
  return {
    transitions,
    mediaClips: clips.filter(clip =>
      clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text' && !isStickerClip(clip)),
    videoClips: clips.filter(clip => clip.asset?.type === 'video' && clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text'),
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
function isStickerClip(clip: TimelineClip): boolean {
  return Boolean(clip.stickerId)
}

function isImageClip(clip: TimelineClip | null | undefined): boolean {
  return Boolean(clip && (clip.asset?.type === 'image' || clip.type === 'image'))
}

function getClipTargetTime(clip: TimelineClip, mediaDuration: number, atTime: number): number {
  const timeInClip = atTime - clip.startTime
  const usableMediaDuration = mediaDuration - clip.trimStart - clip.trimEnd

  if (hasKeyframesForProperty(clip, 'speed')) {
    const elapsedMedia = computeMediaTimeFromTimelineTime(clip, timeInClip)
    return clip.reversed
      ? Math.max(0, Math.min(mediaDuration, clip.trimStart + usableMediaDuration - elapsedMedia))
      : Math.max(0, Math.min(mediaDuration, clip.trimStart + elapsedMedia))
  }

  return clip.reversed
    ? Math.max(0, Math.min(mediaDuration, clip.trimStart + usableMediaDuration - timeInClip * (clip.speed ?? 1)))
    : Math.max(0, Math.min(mediaDuration, clip.trimStart + timeInClip * (clip.speed ?? 1)))
}

function getTopVisibleClipAtTime(mediaClips: TimelineClip[], tracks: Track[], time: number): TimelineClip | null {
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
function getTransitionAtTime(
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

    const start = incoming.startTime
    const end = outgoing.startTime + outgoing.duration
    if (end <= start) continue
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
function getActiveOverlayClips(overlayClips: TimelineClip[], tracks: Track[], time: number): TimelineClip[] {
  return overlayClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
}

function getActiveSubtitles(subtitles: SubtitleClip[], tracks: Track[], time: number): SubtitleClip[] {
  return subtitles.filter(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return Boolean(track) && !track.muted && time >= subtitle.startTime && time < subtitle.endTime
  })
}

function getActiveLetterbox(adjustmentClips: TimelineClip[], tracks: Track[], time: number): ActiveLetterboxState | null {
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

function isNonOpaqueClip(clip: TimelineClip): boolean {
  if ((clip.opacity ?? 100) < 100) return true
  if (clip.chromaKey?.enabled) return true
  if (clip.blendMode && clip.blendMode !== 'normal') return true
  if (clip.mask && clip.mask.enabled !== false) return true
  if (clip.trackIndex > 0) return true
  if (isImageClip(clip)) return true
  if (clip.transform && (clip.transform.scale < 100 || clip.transform.positionX !== 0 || clip.transform.positionY !== 0)) return true
  return false
}

function getCompositingStack(mediaClips: TimelineClip[], tracks: Track[], activeClip: TimelineClip | null, time: number): TimelineClip[] {
  if (!activeClip || !isNonOpaqueClip(activeClip)) return []

  return mediaClips
    .filter(clip =>
      clip.id !== activeClip.id &&
      tracks[clip.trackIndex]?.enabled !== false &&
      clip.trackIndex < activeClip.trackIndex &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
}

function getStyleOpacity(style: React.CSSProperties): number {
  if (typeof style.opacity === 'number') return style.opacity
  if (typeof style.opacity === 'string') {
    const parsed = Number(style.opacity)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}

function toStyleValue(value: string | number | undefined): string {
  if (value === undefined) return ''
  return String(value)
}

function clearEffectStyle(element: HTMLElement): void {
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

function applyEffectStyle(
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

function getActiveVideoContributors(
  activeClip: TimelineClip | null,
  crossDissolve: DissolvePair | null,
  crossDissolveProgress: number,
  compositingStack: TimelineClip[],
  time: number,
): ActiveVideoContributor[] {
  const contributors: ActiveVideoContributor[] = []
  const primaryClip = crossDissolve?.outgoing ?? activeClip

  if (primaryClip?.asset?.type === 'video') {
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

  if (crossDissolve?.incoming.asset?.type === 'video') {
    contributors.push({
      clip: crossDissolve.incoming,
      target: 'incoming',
      role: 'dissolveIncoming',
      opacity: crossDissolveProgress * ((crossDissolve.incoming.opacity ?? 100) / 100),
    })
  }

  for (const clip of compositingStack) {
    if (clip.asset?.type !== 'video') continue
    contributors.push({
      clip,
      target: 'compositing',
      role: 'compositing',
      opacity: getStyleOpacity(getClipEffectStyles(clip, Math.max(0, time - clip.startTime))),
    })
  }

  return contributors
}

function getActiveAdjustmentEffects(adjustmentClips: TimelineClip[], tracks: Track[], time: number): AdjustmentEffectState[] {
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

function deriveFrameRenderState(cache: FrameRenderCache, tracks: Track[], time: number): FrameRenderState {
  let sampleTime = time
  let maxEnd = 0
  for (const c of cache.mediaClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const c of cache.textClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const c of cache.stickerClips) if (c.startTime + c.duration > maxEnd) maxEnd = c.startTime + c.duration
  for (const s of cache.subtitles) if (s.endTime > maxEnd) maxEnd = s.endTime
  if (maxEnd > 0 && sampleTime >= maxEnd) {
    sampleTime = Math.max(0, maxEnd - 0.001)
  }

  const dissolve = getTransitionAtTime(cache.mediaClips, cache.transitions, tracks, sampleTime)
  // Inside a transition the pair decides the two layers, not "topmost clip".
  // The clips genuinely overlap now, so the plain test picks the *incoming*
  // one as active — and the outgoing clip, which the effect is supposed to
  // reveal from under, would never get drawn at all.
  const activeClip = dissolve?.pair.outgoing ?? getTopVisibleClipAtTime(cache.mediaClips, tracks, sampleTime)
  const compositingStack = getCompositingStack(cache.mediaClips, tracks, activeClip, sampleTime)
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

function sameClipList(a: TimelineClip[], b: TimelineClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((clip, index) => clip === b[index])
}

function sameSubtitleList(a: SubtitleClip[], b: SubtitleClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((subtitle, index) => subtitle === b[index])
}

function sameLetterbox(a: ActiveLetterboxState | null, b: ActiveLetterboxState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.key === b.key
}

function sameDissolve(a: DissolvePair | null, b: DissolvePair | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.outgoing === b.outgoing && a.incoming === b.incoming
}

function sameAdjustmentEffects(a: AdjustmentEffectState[], b: AdjustmentEffectState[]): boolean {
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

function sameFilters(a: TimelineClip['filter'], b: TimelineClip['filter']): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.id === b.id && a.intensity === b.intensity
}

function sameCompositingFilters(
  a: Record<string, TimelineClip['filter']>,
  b: Record<string, TimelineClip['filter']>,
): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(k => sameFilters(a[k], b[k]))
}

function sameFrameOverlayState(a: FrameOverlayState, b: FrameOverlayState): boolean {
  return (
    a.activeClip === b.activeClip &&
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

function sameVideoContributors(a: ActiveVideoContributor[], b: ActiveVideoContributor[]): boolean {
  if (a.length !== b.length) return false
  return a.every((contributor, index) => {
    const candidate = b[index]
    return (
      contributor.clip === candidate.clip &&
      contributor.target === candidate.target &&
      contributor.role === candidate.role &&
      contributor.opacity === candidate.opacity
    )
  })
}

function sameFrameRenderState(a: FrameRenderState, b: FrameRenderState): boolean {
  return (
    a.atTime === b.atTime &&
    a.crossDissolveProgress === b.crossDissolveProgress &&
    sameFrameOverlayState(a, b) &&
    sameVideoContributors(a.activeVideoContributors, b.activeVideoContributors)
  )
}

export interface ProgramMonitorProps {
  playbackTimeRef: React.MutableRefObject<number>
  kbLayout: KeyboardLayout
}

export interface ProgramMonitorHandle {
  toggleFullscreen: () => void
}

export const ProgramMonitor = React.forwardRef<ProgramMonitorHandle, ProgramMonitorProps>(function ProgramMonitor({
  playbackTimeRef,
  kbLayout,
}: ProgramMonitorProps, ref) {
  const {
    clearClipSelection,
    pause,
    play,
    selectClip,
    setClipTextPosition,
    setClipTextStyleField,
    deleteClips,
    setCurrentTime,
    setShowPropertiesPanel,
    stepCurrentTime,
    openProjectSettingsModal,
    setClipTransform,
    setCropMode,
    toggleCropMode,
    setClipMask,
    setEyedropperMode,
    setClipChromaKey,
    setPreviewAssetId,
  } = useEditorActions()

  const currentTime = useEditorStore(selectCurrentTime)
  const totalDuration = useEditorStore(selectTotalDuration)
  const contentDuration = useEditorStore(selectContentDuration)
  const getEditorState = useEditorGetState()
  const isPlaying = useEditorStore(selectIsPlaying)
  const assets = useEditorStore(selectAssets)
  const previewAsset = useEditorStore(selectPreviewAsset)
  const isPreviewingVideo = Boolean(previewAsset && previewAsset.type === 'video')
  const [sourceVideoDimensions, setSourceVideoDimensions] = React.useState<{ width: number; height: number } | null>(null)
  const [previewVideoPlaying, setPreviewVideoPlaying] = React.useState(true)
  const [previewVideoCurrentTime, setPreviewVideoCurrentTime] = React.useState(0)
  const [previewVideoDuration, setPreviewVideoDuration] = React.useState(0)
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null)

  React.useEffect(() => {
    if (previewAsset && previewAsset.type === 'video') {
      if (previewAsset.width && previewAsset.height) {
        setSourceVideoDimensions({ width: previewAsset.width, height: previewAsset.height })
      } else {
        setSourceVideoDimensions(null)
      }
      setPreviewVideoPlaying(true)
      setPreviewVideoCurrentTime(0)
      setPreviewVideoDuration(previewAsset.duration || 0)
    } else {
      setSourceVideoDimensions(null)
      setPreviewVideoPlaying(false)
    }
  }, [previewAsset?.id, previewAsset?.type, previewAsset?.width, previewAsset?.height, previewAsset?.duration])

  React.useEffect(() => {
    const handleToggle = () => {
      if (!isPreviewingVideo || !previewVideoRef.current) return
      if (previewVideoRef.current.paused) {
        previewVideoRef.current.play().then(() => setPreviewVideoPlaying(true)).catch(() => {})
      } else {
        previewVideoRef.current.pause()
        setPreviewVideoPlaying(false)
      }
    }
    window.addEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
    return () => window.removeEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
  }, [isPreviewingVideo])

  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const { settings } = useSettings()
  const proxyEnabled = settings.proxyEnabled
  const getClipPath = React.useCallback(
    (clip: TimelineClip) => resolveClipPathFromAssets(assets, clip, proxyEnabled),
    [assets, proxyEnabled],
  )
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const cropMode = useEditorStore(selectCropMode)
  const maskMode = useEditorStore(selectMaskMode)
  const eyedropperMode = useEditorStore(selectEyedropperMode)
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const activeTimelineName = activeTimeline?.name ?? ''
  const activeTimelineFps = activeTimeline?.fps
  const fps = activeTimelineFps ?? settings.defaultFps ?? 30
  const timecodeFormat = settings.timecodeFormat ?? 'timecode'

  // Press 'C' to toggle Crop mode for selected visual clip, Esc to exit crop / eyedropper / preview
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        if (selectedClip && (selectedClip.type === 'video' || selectedClip.type === 'image')) {
          e.preventDefault()
          toggleCropMode()
        }
      } else if (e.key === 'Escape') {
        if (cropMode) {
          e.preventDefault()
          setCropMode(false)
        }
        if (eyedropperMode) {
          e.preventDefault()
          setEyedropperMode(false)
        }
        if (isPreviewingVideo) {
          e.preventDefault()
          setPreviewAssetId(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cropMode, eyedropperMode, isPreviewingVideo, selectedClip, setCropMode, setEyedropperMode, setPreviewAssetId, toggleCropMode])

  const effectiveDimensions = React.useMemo(() => {
    return getEffectiveTimelineDimensions(activeTimeline, assets, fps)
  }, [activeTimeline, assets, fps])

  // Flag to prevent the video frame wrapper's onClick from clearing selection
  // when the user clicked on a text overlay (mousedown fires first on the overlay,
  // but click may bubble up to the wrapper if the mouse moved slightly).
  const clickedTextOverlayRef = React.useRef(false)
  // Set while a transform handle is being used, so the click that ends the
  // drag does not re-run the selection hit test against a stale rectangle.
  const transformInteractionRef = React.useRef(false)
  const previewContainerRef = React.useRef<HTMLDivElement>(null)
  const videoFrameWrapperRef = React.useRef<HTMLDivElement>(null)
  const videoPoolContainerRef = React.useRef<HTMLDivElement>(null)
  const incomingDissolveVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const incomingDissolveImageRef = React.useRef<HTMLImageElement | null>(null)
  const activeImageRef = React.useRef<HTMLImageElement | null>(null)
  /**
   * The same element as `activeImageRef`, kept in state because the LUT canvas
   * needs it as a prop. A ref read during render is null on the very render
   * that mounts the image, and nothing re-renders when a ref is attached — so
   * the graded canvas was handed `null` and quietly drew nothing, which is why
   * a filter on a still looked like it had not been applied while the same
   * filter on a video (whose element comes from the imperative pool) worked.
   */
  const [activeImageEl, setActiveImageEl] = React.useState<HTMLImageElement | null>(null)
  const attachActiveImage = React.useCallback((element: HTMLImageElement | null) => {
    activeImageRef.current = element
    setActiveImageEl(element)
  }, [])
  const lutCanvasRef = React.useRef<LutCanvasRef>(null)
  const incomingLutCanvasRef = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef0 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef1 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef2 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRefs = React.useMemo(
    () => [compLutCanvasRef0, compLutCanvasRef1, compLutCanvasRef2],
    [],
  )
  const compositingSlotMapRef = React.useRef<Map<string, number>>(new Map())
  const blurCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const transitionBgRef = React.useRef<HTMLDivElement | null>(null)
  const videoPoolRef = React.useRef<Map<string, HTMLVideoElement>>(new Map())
  const compositingMediaRefs = React.useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  /** Sticker overlay images by clip id, styled per frame in applyFrameVisuals. */
  const stickerImageRefs = React.useRef<Map<string, HTMLImageElement>>(new Map())
  const activePoolPathRef = React.useRef('')
  const activePoolClipIdRef = React.useRef<string | null>(null)
  const contributorSyncStatesRef = React.useRef<Map<string, VideoContributorSyncState>>(new Map())
  const preSeekDoneRef = React.useRef<string | null>(null)
  const clipsRef = React.useRef(clips)
  const tracksRef = React.useRef(tracks)
  const getClipPathRef = React.useRef(getClipPath)
  const cachedSegments = useRenderCacheStore(state => state.segments)
  const cachedSegmentsRef = React.useRef(cachedSegments)
  cachedSegmentsRef.current = cachedSegments
  const cachedVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const [hasActiveCache, setHasActiveCache] = React.useState(false)
  const hasActiveCacheRef = React.useRef(false)
  const [previewZoom, setPreviewZoom] = React.useState<number | 'fit'>('fit')
  const [previewZoomOpen, setPreviewZoomOpen] = React.useState(false)
  const [previewPan, setPreviewPan] = React.useState({ x: 0, y: 0 })
  const previewPanRef = React.useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [playbackResOpen, setPlaybackResOpen] = React.useState(false)
  const [playbackResolution, setPlaybackResolution] = React.useState<1 | 0.5 | 0.25>(0.5)
  const [videoFrameSize, setVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [sourceVideoFrameSize, setSourceVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [showSafeZoneGuide, setShowSafeZoneGuide] = React.useState(false)

  React.useEffect(() => {
    const container = previewContainerRef.current
    if (!container) return

    const updateFrameSize = () => {
      const rect = container.getBoundingClientRect()
      const cw = rect.width
      const ch = rect.height
      if (cw <= 0 || ch <= 0) return
      const containerRatio = cw / ch

      // Timeline frame dimensions (always follows timeline resolution / ratio)
      const timelineRatio = effectiveDimensions.aspectRatio || 16 / 9
      let tfw: number
      let tfh: number
      if (containerRatio > timelineRatio) {
        tfh = ch
        tfw = ch * timelineRatio
      } else {
        tfw = cw
        tfh = cw / timelineRatio
      }
      const tw = Math.round(tfw)
      const th = Math.round(tfh)
      setVideoFrameSize(prev => (prev.width === tw && prev.height === th ? prev : { width: tw, height: th }))

      // Source video preview dimensions (always follows raw asset ratio)
      if (isPreviewingVideo) {
        const sourceRatio = sourceVideoDimensions
          ? sourceVideoDimensions.width / sourceVideoDimensions.height
          : (previewAsset?.width && previewAsset?.height ? previewAsset.width / previewAsset.height : 16 / 9)
        let sfw: number
        let sfh: number
        if (containerRatio > sourceRatio) {
          sfh = ch
          sfw = ch * sourceRatio
        } else {
          sfw = cw
          sfh = cw / sourceRatio
        }
        const sw = Math.round(sfw)
        const sh = Math.round(sfh)
        setSourceVideoFrameSize(prev => (prev.width === sw && prev.height === sh ? prev : { width: sw, height: sh }))
      }
    }

    updateFrameSize()

    const observer = new ResizeObserver(() => {
      updateFrameSize()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [effectiveDimensions.aspectRatio, isPreviewingVideo, sourceVideoDimensions, previewAsset?.width, previewAsset?.height])
  const timelineTransitions = useEditorStore(
    state => selectActiveTimeline(state)?.transitions ?? EMPTY_TRANSITIONS,
  )
  const frameRenderCache = React.useMemo(
    () => buildFrameRenderCache(clips, subtitles, timelineTransitions),
    [clips, subtitles, timelineTransitions],
  )
  const frameRenderCacheRef = React.useRef(frameRenderCache)
  const [frameScene, setFrameScene] = React.useState<FrameOverlayState>(() => {
    const initial = deriveFrameRenderState(frameRenderCache, tracks, currentTime)
    return {
      activeClip: initial.activeClip,
      crossDissolve: initial.crossDissolve,
      crossDissolveType: initial.crossDissolveType,
      compositingStack: initial.compositingStack,
      activeTextClips: initial.activeTextClips,
      activeStickerClips: initial.activeStickerClips,
      activeSubtitles: initial.activeSubtitles,
      activeLetterbox: initial.activeLetterbox,
      activeAdjustmentEffects: initial.activeAdjustmentEffects,
      activeFilter: initial.activeFilter,
      incomingFilter: initial.incomingFilter,
      compositingFilters: initial.compositingFilters,
      activeAdjustmentSources: initial.activeAdjustmentSources,
      audioOnlyClips: initial.audioOnlyClips,
    }
  })
  const frameSceneRef = React.useRef(frameScene)
  const lastFrameRequestRef = React.useRef<{ state: FrameRenderState; mode: MonitorRenderMode } | null>(null)
  const playbackTimecodeRef = React.useRef<HTMLSpanElement | null>(null)

  const toggleFullscreen = React.useCallback(() => {
    const el = previewContainerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {})
      return
    }
    el.requestFullscreen().catch(() => {})
  }, [])

  React.useImperativeHandle(ref, () => ({ toggleFullscreen }), [toggleFullscreen])

  React.useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  React.useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  React.useEffect(() => {
    getClipPathRef.current = getClipPath
  }, [getClipPath])

  React.useEffect(() => {
    frameRenderCacheRef.current = frameRenderCache
  }, [frameRenderCache])

  const resolveClipPathRef = React.useCallback((clip: TimelineClip): string => {
    const resolved = getClipPathRef.current(clip)
    return resolved || clip.asset?.path || ''
  }, [])

  const getNextVideoClipRef = React.useCallback((afterClip: TimelineClip): TimelineClip | null => {
    const all = clipsRef.current
    const endTime = afterClip.startTime + afterClip.duration
    let best: TimelineClip | null = null
    for (const clip of all) {
      if (clip.type === 'audio' || clip.type === 'adjustment' || clip.type === 'text') continue
      if (clip.asset?.type !== 'video') continue
      if (clip.startTime >= endTime - 0.01) {
        if (!best || clip.startTime < best.startTime) best = clip
      }
    }
    return best
  }, [])

  const syncFrameScene = React.useCallback((nextState: FrameRenderState) => {
    setFrameScene(prevState => {
      const nextOverlayState: FrameOverlayState = {
        activeClip: nextState.activeClip,
        crossDissolve: nextState.crossDissolve,
        crossDissolveType: nextState.crossDissolveType,
        compositingStack: nextState.compositingStack,
        activeTextClips: nextState.activeTextClips,
        activeStickerClips: nextState.activeStickerClips,
        activeSubtitles: nextState.activeSubtitles,
        activeLetterbox: nextState.activeLetterbox,
        activeAdjustmentEffects: nextState.activeAdjustmentEffects,
        activeFilter: nextState.activeFilter,
        incomingFilter: nextState.incomingFilter,
        compositingFilters: nextState.compositingFilters,
        activeAdjustmentSources: nextState.activeAdjustmentSources,
        audioOnlyClips: nextState.audioOnlyClips,
      }
      if (sameFrameOverlayState(prevState, nextOverlayState)) {
        frameSceneRef.current = prevState
        return prevState
      }
      frameSceneRef.current = nextOverlayState
      return nextOverlayState
    })
  }, [])

  const syncPlaybackTimecode = React.useCallback((time: number) => {
    const el = playbackTimecodeRef.current
    if (!el) return
    const nextText = formatTime(time, fps, timecodeFormat)
    if (el.textContent !== nextText) {
      el.textContent = nextText
    }
  }, [fps, timecodeFormat])

  const ensurePoolVideo = React.useCallback((filePath: string) => {
    let video = videoPoolRef.current.get(filePath)
    if (video) return video

    video = createMonitorVideoElement(filePath)
    applyPlaybackResolution(video, playbackResolution)
    videoPoolRef.current.set(filePath, video)
    if (videoPoolContainerRef.current) videoPoolContainerRef.current.appendChild(video)
    return video
  }, [playbackResolution])

  const destroyPoolVideo = React.useCallback((filePath: string) => {
    const video = videoPoolRef.current.get(filePath)
    if (!video) return

    video.pause()
    video.removeAttribute('src')
    video.load()
    if (video.parentElement) video.parentElement.removeChild(video)
    if (activePoolPathRef.current === filePath) activePoolPathRef.current = ''
    videoPoolRef.current.delete(filePath)
  }, [])

  const syncVideoElement = React.useCallback((
    video: HTMLVideoElement,
    clip: TimelineClip,
    atTime: number,
    options: { forceSeek?: boolean; paused?: boolean },
  ) => {
    const { forceSeek = false, paused = false } = options
    video.muted = true
    video.volume = 0

    if (!video.duration || Number.isNaN(video.duration)) {
      if (forceSeek) {
        video.play().then(() => { video.pause() }).catch(() => {})
      }
      return
    }

    const targetTime = getClipTargetTime(clip, video.duration, atTime)

    const currentSpeed = hasKeyframesForProperty(clip, 'speed')
      ? sampleClipAt(clip, Math.max(0, atTime - clip.startTime)).speed
      : (clip.speed ?? 1)

    // Past the element's rate ceiling there is no playing in real time, so the
    // clip is stepped by seeking instead. Letting it play on regardless left it
    // running far behind the playhead and showing frames from earlier in the
    // file, which looked like another part of the video cutting in.
    const drive = playbackDriveModeForSpeed(currentSpeed)
    const shouldPause = paused || clip.reversed || drive.seekDriven
    // Allow the browser video element to decode and play smoothly at high speeds (e.g. 10x)
    // without triggering false drift corrections every few milliseconds.
    const driftThreshold = shouldPause ? 0.04 : Math.max(0.4, 0.4 * currentSpeed)

    const desiredRate = clip.reversed || drive.seekDriven ? 1 : drive.rate
    if (video.playbackRate !== desiredRate) {
      video.playbackRate = desiredRate
    }

    const isSeeking = Boolean(video.seeking)
    if (!Number.isNaN(targetTime) && (forceSeek || Math.abs(video.currentTime - targetTime) > driftThreshold)) {
      if (!forceSeek && isSeeking) {
        // A seek is already in flight: do not interrupt ongoing frame decode
        return
      }
      if (forceSeek && Math.abs(video.currentTime - targetTime) < 0.001) {
        video.currentTime = targetTime + 0.001
      }
      video.currentTime = targetTime
    }

    if (shouldPause) {
      if (!video.paused) {
        video.pause()
      }
    } else if (video.paused) {
      video.play().catch(() => {})
    }
  }, [])

  const getContributorKey = React.useCallback((contributor: ActiveVideoContributor) => {
    return `${contributor.target}:${contributor.clip.id}`
  }, [])

  const ensureContributorSyncState = React.useCallback((contributor: ActiveVideoContributor) => {
    const key = `${contributor.target}:${contributor.clip.id}`
    let syncState = contributorSyncStatesRef.current.get(key)
    if (!syncState) {
      syncState = { lastAtTime: null, pendingHardSync: false }
      contributorSyncStatesRef.current.set(key, syncState)
    }
    return syncState
  }, [])

  const syncPlaybackContributorVideo = React.useCallback((
    video: HTMLVideoElement,
    fallbackContributor: ActiveVideoContributor,
    fallbackAtTime: number,
    fallbackMode: MonitorRenderMode,
  ) => {
    const lastFrame = lastFrameRequestRef.current
    const latestState = lastFrame?.state
    const latestMode = lastFrame?.mode ?? fallbackMode
    const latestContributor = latestState?.activeVideoContributors.find(contributor =>
      contributor.target === fallbackContributor.target && contributor.clip.id === fallbackContributor.clip.id
    ) ?? fallbackContributor
    if (latestContributor.clip.asset?.type !== 'video') return
    if (latestContributor.target === 'active' && resolveClipPathRef(latestContributor.clip) !== activePoolPathRef.current) return

    const syncState = ensureContributorSyncState(latestContributor)
    const atTime = latestMode === 'playback'
      ? playbackTimeRef.current
      : latestState?.atTime ?? fallbackAtTime

    syncVideoElement(video, latestContributor.clip, atTime, {
      forceSeek: syncState.pendingHardSync,
      paused: latestMode !== 'playback' || latestContributor.clip.reversed,
    })

    if (syncState.pendingHardSync) {
      syncState.pendingHardSync = false
    }
    syncState.lastAtTime = atTime
  }, [ensureContributorSyncState, playbackTimeRef, resolveClipPathRef, syncVideoElement])

  const syncRetainedPoolVideos = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    const desiredSources = new Set<string>()

    for (const contributor of state.activeVideoContributors) {
      if (contributor.clip.asset?.type !== 'video') continue
      const src = resolveClipPathRef(contributor.clip)
      if (src) desiredSources.add(src)
    }

    const activeVideoContributor = state.activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    if (mode === 'playback' && activeVideoContributor) {
      const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
      if (nextClip) {
        const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - state.atTime
        if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
          const nextSrc = resolveClipPathRef(nextClip)
          if (nextSrc) desiredSources.add(nextSrc)
        }
      }
    }

    for (const poolPath of Array.from(videoPoolRef.current.keys())) {
      if (!desiredSources.has(poolPath)) destroyPoolVideo(poolPath)
    }

    for (const src of desiredSources) {
      ensurePoolVideo(src)
    }
  }, [destroyPoolVideo, ensurePoolVideo, getNextVideoClipRef, resolveClipPathRef])

  const applyFrameVisuals = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    syncRetainedPoolVideos(state, mode)

    const { activeClip, crossDissolve, crossDissolveProgress, compositingStack, atTime, activeVideoContributors } = state
    const pool = videoPoolRef.current
    const poolContainer = videoPoolContainerRef.current
    const contributorsByKey = new Map(activeVideoContributors.map(contributor => [getContributorKey(contributor), contributor]))
    const activeVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    const incomingVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'incoming') ?? null
    const compositingVideoContributors = new Map(
      activeVideoContributors
        .filter(contributor => contributor.target === 'compositing')
        .map(contributor => [contributor.clip.id, contributor]),
    )

    for (const key of contributorSyncStatesRef.current.keys()) {
      if (!contributorsByKey.has(key)) contributorSyncStatesRef.current.delete(key)
    }

    if (poolContainer) {
      const shouldShowPool = activeClip?.asset?.type === 'video' || Boolean(crossDissolve?.outgoing.asset?.type === 'video')
      poolContainer.classList.toggle('hidden', !shouldShowPool)
    }

    const outgoingClip = crossDissolve?.outgoing ?? activeClip
    if (activeVideoContributor) {
      const clipPath = resolveClipPathRef(activeVideoContributor.clip)
      if (clipPath) {
        const video = ensurePoolVideo(clipPath)
        const contributorSyncState = ensureContributorSyncState(activeVideoContributor)
        const isNewClip = activePoolClipIdRef.current !== activeVideoContributor.clip.id
        const previousPoolPath = activePoolPathRef.current
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncActive = mode === 'scrub' || isNewClip || hasPlaybackJump
        if (poolContainer && !video.parentElement) poolContainer.appendChild(video)

        for (const [poolPath, pooledVideo] of pool) {
          if (poolPath === clipPath) continue
          pooledVideo.style.opacity = '0'
          pooledVideo.style.zIndex = '0'
        }

        if (clipPath !== previousPoolPath) {
          const oldVid = pool.get(previousPoolPath)
          if (oldVid) {
            oldVid.style.opacity = '0'
            oldVid.style.zIndex = '0'
            oldVid.pause()
          }
          activePoolPathRef.current = clipPath
          preSeekDoneRef.current = null
        }
        if (isNewClip) {
          activePoolClipIdRef.current = activeVideoContributor.clip.id
          preSeekDoneRef.current = null
        }
        video.style.opacity = '1'
        video.style.zIndex = '1'
        if (shouldForceSyncActive) {
          contributorSyncState.pendingHardSync = true
        }
        if (video.readyState >= 2) {
          syncPlaybackContributorVideo(video, activeVideoContributor, atTime, mode)
        } else if (!(video as { __pendingCanplay?: boolean }).__pendingCanplay) {
          ;(video as { __pendingCanplay?: boolean }).__pendingCanplay = true
          const onReady = () => {
            video.removeEventListener('canplay', onReady)
            ;(video as { __pendingCanplay?: boolean }).__pendingCanplay = false
            syncPlaybackContributorVideo(video, activeVideoContributor, atTime, mode)
          }
          video.addEventListener('canplay', onReady)
        }

        if (!crossDissolve && mode === 'playback') {
          const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
          if (nextClip && nextClip.id !== preSeekDoneRef.current) {
            const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - atTime
            if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
              const nextSrc = resolveClipPathRef(nextClip)
              const nextVideo = nextSrc ? ensurePoolVideo(nextSrc) : null
              if (nextVideo && nextVideo.readyState >= 1) {
                const nextTargetTime = nextClip.reversed
                  ? nextClip.trimStart + (nextVideo.duration || 0) - nextClip.trimStart - nextClip.trimEnd
                  : nextClip.trimStart
                if (!Number.isNaN(nextTargetTime)) {
                  if (typeof (nextVideo as { fastSeek?: (time: number) => void }).fastSeek === 'function') {
                    ;(nextVideo as { fastSeek: (time: number) => void }).fastSeek(nextTargetTime)
                  } else {
                    nextVideo.currentTime = nextTargetTime
                  }
                }
                preSeekDoneRef.current = nextClip.id
              }
            }
          }
        }
      }
    } else {
      const curVid = pool.get(activePoolPathRef.current)
      if (curVid) {
        curVid.style.opacity = '0'
        curVid.style.zIndex = '0'
        if (!curVid.paused) {
          curVid.pause()
        }
      }
      activePoolClipIdRef.current = null
    }

    // The transition's own geometry, shared with the exporter's xfade choice
    // and with the library thumbnails. `opacity` is only one of the ways an
    // effect hides a layer — a wipe clips it, a slide moves it — so the styles
    // are applied to the element rather than folded into an opacity number.
    const layerStyles = crossDissolve
      ? transitionLayerStyles(state.crossDissolveType, crossDissolveProgress)
      : null

    /**
     * Lays the transition's own movement over a layer that applyEffectStyle has
     * already positioned.
     *
     * `baseTransform` is what the clip's own transform produced. It has to be
     * passed back in and composed: this used to write `wanted.transform ?? ''`,
     * and outside a transition `layerStyles` is null, so every repaint wiped the
     * transform set one line earlier. Scale, position and rotation were dropped
     * on the floor — the bounding box moved, the picture never did.
     *
     * The transition part comes first so it reads as the outer transform: CSS
     * applies the list right to left, so the clip is placed, then the slide or
     * wipe moves the placed result.
     */
    const applyLayer = (
      el: HTMLElement | null,
      side: 'outgoing' | 'incoming',
      baseTransform?: React.CSSProperties['transform'],
    ) => {
      if (!el) return
      const wanted = layerStyles?.[side] ?? {}
      // Clear what a previous frame set, or a finished wipe leaves the clip
      // clipped forever.
      el.style.clipPath = wanted.clipPath ?? ''
      el.style.transform = [wanted.transform, baseTransform]
        .filter((part): part is string => Boolean(part))
        .join(' ')
      if (wanted.filter !== undefined) el.style.filter = wanted.filter
    }

    const hasChromaKey = Boolean(activeClip?.chromaKey?.enabled)
    const hasActiveLut = Boolean(state.activeFilter && (state.activeFilter.intensity ?? 100) > 0)
    const hasActiveCanvas = hasActiveLut || hasChromaKey

    // Everything the canvas grades takes its CSS without the LUT stand-in, or
    // the frame would carry the same look twice over.
    const gradedStyle = (clip: TimelineClip, at: number) =>
      getClipEffectStyles(clip, at, { lutApproximation: !hasActiveCanvas })

    if (poolContainer) {
      if (outgoingClip?.asset?.type === 'video') {
        const baseStyle = gradedStyle(outgoingClip, Math.max(0, atTime - outgoingClip.startTime))
        const outgoingOpacity = crossDissolve
          ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
          : baseStyle.opacity
        applyEffectStyle(poolContainer, baseStyle, typeof outgoingOpacity === 'number' ? outgoingOpacity : undefined)
        applyLayer(poolContainer, 'outgoing', baseStyle.transform)
        if (hasChromaKey) {
          poolContainer.style.opacity = '0'
        }
      } else {
        clearEffectStyle(poolContainer)
        poolContainer.style.opacity = '0'
      }
    }

    if (activeImageRef.current && activeClip && isImageClip(activeClip)) {
      activeImageRef.current.style.display = ''
      const baseStyle = gradedStyle(activeClip, Math.max(0, atTime - activeClip.startTime))
      const opacity = crossDissolve
        ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
        : baseStyle.opacity
      applyEffectStyle(activeImageRef.current, baseStyle, typeof opacity === 'number' ? opacity : undefined)
      applyLayer(activeImageRef.current, 'outgoing', baseStyle.transform)
      if (hasChromaKey) {
        activeImageRef.current.style.opacity = '0'
      }
    } else if (activeImageRef.current) {
      clearEffectStyle(activeImageRef.current)
      activeImageRef.current.style.opacity = '0'
      activeImageRef.current.style.display = 'none'
    }

    // Stickers sit above the picture and carry their own transform, opacity and
    // keyframes, exactly as they did when one of them was the active layer.
    for (const stickerClip of state.activeStickerClips) {
      const element = stickerImageRefs.current.get(stickerClip.id)
      if (!element) continue
      const baseStyle = gradedStyle(stickerClip, Math.max(0, atTime - stickerClip.startTime))
      applyEffectStyle(element, baseStyle, typeof baseStyle.opacity === 'number' ? baseStyle.opacity : undefined)
      element.style.transform = baseStyle.transform ? String(baseStyle.transform) : ''
    }

    const lutCanvas = lutCanvasRef.current?.getCanvas()
    if (lutCanvas) {
      if (activeClip && hasActiveCanvas && (activeClip.asset?.type === 'video' || isImageClip(activeClip))) {
        const baseStyle = gradedStyle(activeClip, Math.max(0, atTime - activeClip.startTime))
        const opacity = crossDissolve
          ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
          : baseStyle.opacity
        applyEffectStyle(lutCanvas, baseStyle, typeof opacity === 'number' ? opacity : undefined)
        applyLayer(lutCanvas, 'outgoing', baseStyle.transform)
        lutCanvasRef.current?.renderNow()
      } else {
        clearEffectStyle(lutCanvas)
        lutCanvasRef.current?.clear()
      }
    }

    if (blurCanvasRef.current && activeTimeline?.background?.type === 'blur') {
      const canvas = blurCanvasRef.current
      const ctx = canvas.getContext('2d')
      if (ctx) {
        let sourceEl: HTMLImageElement | HTMLVideoElement | null = null
        if (activeClip && isImageClip(activeClip)) {
          sourceEl = activeImageRef.current
        } else if (activeClip?.asset?.type === 'video') {
          sourceEl = videoPoolRef.current.get(activePoolPathRef.current) ?? null
        } else if (compositingStack.length > 0) {
          const topLower = compositingStack[compositingStack.length - 1]
          sourceEl = compositingMediaRefs.current.get(topLower.id) ?? null
        }

        if (sourceEl && ((sourceEl as HTMLVideoElement).readyState === undefined || (sourceEl as HTMLVideoElement).readyState >= 2)) {
          try {
            ctx.drawImage(sourceEl, 0, 0, canvas.width, canvas.height)
          } catch {
            // Source not ready yet
          }
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
    }

    if (transitionBgRef.current) {
      if (activeClip) {
        const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
        const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
        const bg = tInBg || tOutBg
        if (bg) {
          const effectStyles = getClipEffectStyles(activeClip, Math.max(0, atTime - activeClip.startTime))
          const overlayOpacity = effectStyles.opacity !== undefined ? 1 - (effectStyles.opacity as number) : 0
          transitionBgRef.current.style.backgroundColor = bg
          transitionBgRef.current.style.opacity = overlayOpacity > 0 ? String(overlayOpacity) : '0'
          transitionBgRef.current.style.display = overlayOpacity > 0 ? 'block' : 'none'
        } else {
          transitionBgRef.current.style.display = 'none'
        }
      } else {
        transitionBgRef.current.style.display = 'none'
      }
    }

    if (crossDissolve) {
      const incomingOffset = Math.max(0, atTime - crossDissolve.incoming.startTime)
      const incomingFilter = state.incomingFilter ?? resolveEffectiveClipFilter(
        crossDissolve.incoming,
        state.activeAdjustmentSources,
        tracksRef.current,
        incomingOffset,
      )
      const hasIncomingLut = Boolean(incomingFilter && (incomingFilter.intensity ?? 100) > 0)
      const hasIncomingChroma = Boolean(crossDissolve.incoming.chromaKey?.enabled)
      const hasIncomingCanvas = hasIncomingLut || hasIncomingChroma

      const baseIncomingStyle = getClipEffectStyles(
        incomingFilter === crossDissolve.incoming.filter
          ? crossDissolve.incoming
          : { ...crossDissolve.incoming, filter: incomingFilter },
        incomingOffset,
        { lutApproximation: !hasIncomingCanvas },
      )
      const incomingOpacity = String(
        Number(layerStyles?.incoming.opacity ?? 1) * ((crossDissolve.incoming.opacity ?? 100) / 100),
      )
      const inStyle = {
        ...baseIncomingStyle,
        opacity: incomingOpacity,
      }

      if (incomingVideoContributor && incomingDissolveVideoRef.current) {
        const incomingPath = resolveClipPathRef(incomingVideoContributor.clip)
        const video = incomingDissolveVideoRef.current
        const contributorSyncState = ensureContributorSyncState(incomingVideoContributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncIncoming = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        const incomingFileUrl = incomingPath ? pathToFileUrl(incomingPath) : ''
        if (incomingFileUrl && video.src !== incomingFileUrl && !video.src.endsWith(incomingFileUrl)) {
          video.src = incomingFileUrl
          video.load()
        }
        applyEffectStyle(video, inStyle)
        applyLayer(video, 'incoming', inStyle.transform)
        if (hasIncomingChroma) {
          video.style.opacity = '0'
        }
        if (shouldForceSyncIncoming) {
          contributorSyncState.pendingHardSync = true
        }
        if (video.readyState >= 2) {
          syncVideoElement(video, incomingVideoContributor.clip, atTime, {
            forceSeek: contributorSyncState.pendingHardSync,
            paused: true,
          })
          if (contributorSyncState.pendingHardSync) {
            contributorSyncState.pendingHardSync = false
          }
          contributorSyncState.lastAtTime = atTime
        } else if (!(video as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            video.removeEventListener('loadeddata', onLoaded)
            ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncVideoElement(video, incomingVideoContributor.clip, atTime, {
              forceSeek: contributorSyncState.pendingHardSync,
              paused: true,
            })
            if (contributorSyncState.pendingHardSync) {
              contributorSyncState.pendingHardSync = false
            }
            contributorSyncState.lastAtTime = atTime
          }
          video.addEventListener('loadeddata', onLoaded)
        }
      }

      if (crossDissolve.incoming.asset?.type === 'image' && incomingDissolveImageRef.current) {
        applyEffectStyle(incomingDissolveImageRef.current, inStyle)
        applyLayer(incomingDissolveImageRef.current, 'incoming', inStyle.transform)
        if (hasIncomingChroma) {
          incomingDissolveImageRef.current.style.opacity = '0'
        }
      }

      const incomingCanvas = incomingLutCanvasRef.current?.getCanvas()
      if (incomingCanvas) {
        if (hasIncomingCanvas) {
          applyEffectStyle(incomingCanvas, inStyle)
          applyLayer(incomingCanvas, 'incoming', inStyle.transform)
          incomingLutCanvasRef.current?.renderNow()
        } else {
          clearEffectStyle(incomingCanvas)
          incomingLutCanvasRef.current?.clear()
        }
      }

      if (crossDissolve.incoming.asset?.type === 'video') {
        const inPath = resolveClipPathRef(crossDissolve.incoming)
        if (inPath) ensurePoolVideo(inPath)
      }
    } else {
      if (incomingDissolveVideoRef.current) clearEffectStyle(incomingDissolveVideoRef.current)
      if (incomingDissolveImageRef.current) clearEffectStyle(incomingDissolveImageRef.current)
      const incomingCanvas = incomingLutCanvasRef.current?.getCanvas()
      if (incomingCanvas) {
        clearEffectStyle(incomingCanvas)
        incomingLutCanvasRef.current?.clear()
      }
    }

    const compositingIds = new Set(compositingStack.map(clip => clip.id))
    for (const [clipId, element] of compositingMediaRefs.current.entries()) {
      if (!compositingIds.has(clipId)) {
        clearEffectStyle(element)
        element.style.opacity = '0'
        element.style.display = 'none'
      }
    }

    // Pool assignment for compositing canvases:
    // Determine which lower clips have an active LUT or chromaKey
    const lowerClipsWithVisuals = compositingStack.filter(clip => {
      const filter = state.compositingFilters[clip.id]
      const hasLut = Boolean(filter && (filter.intensity ?? 100) > 0)
      const hasChroma = Boolean(clip.chromaKey?.enabled)
      return hasLut || hasChroma
    })

    const slotMap = compositingSlotMapRef.current
    const activeCompIds = new Set(lowerClipsWithVisuals.map(c => c.id))
    for (const clipId of Array.from(slotMap.keys())) {
      if (!activeCompIds.has(clipId)) {
        slotMap.delete(clipId)
      }
    }

    const occupiedSlots = new Set(slotMap.values())
    for (const clip of lowerClipsWithVisuals) {
      if (!slotMap.has(clip.id)) {
        for (let s = 0; s < MAX_COMPOSITING_CANVASES; s++) {
          if (!occupiedSlots.has(s)) {
            slotMap.set(clip.id, s)
            occupiedSlots.add(s)
            break
          }
        }
      }
    }

    for (const clip of compositingStack) {
      const element = compositingMediaRefs.current.get(clip.id)
      if (!element) continue
      element.style.display = ''

      const inherited = state.compositingFilters[clip.id]
      const assignedSlot = slotMap.get(clip.id)
      const hasCompCanvas = assignedSlot !== undefined
      const hasChroma = Boolean(clip.chromaKey?.enabled)

      const clipStyle = getClipEffectStyles(
        inherited === clip.filter ? clip : { ...clip, filter: inherited },
        Math.max(0, atTime - clip.startTime),
        { lutApproximation: !hasCompCanvas },
      )
      applyEffectStyle(element, clipStyle)
      if (hasChroma) {
        element.style.opacity = '0'
      }

      if (hasCompCanvas) {
        const compRef = compLutCanvasRefs[assignedSlot]
        const compCanvas = compRef?.current?.getCanvas()
        if (compCanvas) {
          applyEffectStyle(compCanvas, clipStyle)
          compRef?.current?.renderNow()
        }
      }

      if (element instanceof HTMLVideoElement) {
        const contributor = compositingVideoContributors.get(clip.id)
        if (!contributor) {
          if (!element.paused) {
            element.pause()
          }
          continue
        }
        const contributorSyncState = ensureContributorSyncState(contributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncCompositing = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        if (shouldForceSyncCompositing) {
          contributorSyncState.pendingHardSync = true
        }
        if (element.readyState >= 2) {
          syncPlaybackContributorVideo(element, contributor, atTime, mode)
        } else if (!(element as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            element.removeEventListener('loadeddata', onLoaded)
            ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncPlaybackContributorVideo(element, contributor, atTime, mode)
          }
          element.addEventListener('loadeddata', onLoaded)
        }
      }
    }

    // Clear unused compositing canvas slots
    for (let s = 0; s < MAX_COMPOSITING_CANVASES; s++) {
      if (!occupiedSlots.has(s)) {
        const compRef = compLutCanvasRefs[s]
        const compCanvas = compRef?.current?.getCanvas()
        if (compCanvas) {
          clearEffectStyle(compCanvas)
          compRef?.current?.clear()
        }
      }
    }

  }, [activeTimeline?.background, ensureContributorSyncState, ensurePoolVideo, getContributorKey, getNextVideoClipRef, resolveClipPathRef, syncPlaybackContributorVideo, syncRetainedPoolVideos])

  const renderFrame = React.useCallback((atTime: number, mode: MonitorRenderMode) => {
    // 1. Sync complex segment render cache if playhead is within a ready segment
    const activeCache = cachedSegmentsRef.current.find(
      s => s.ready && s.cachePath && atTime >= s.startTime && atTime < s.endTime,
    )

    if (activeCache && activeCache.cachePath) {
      if (!hasActiveCacheRef.current) {
        hasActiveCacheRef.current = true
        setHasActiveCache(true)
      }
      const cachedVid = cachedVideoRef.current
      if (cachedVid) {
        const fileUrl = pathToFileUrl(activeCache.cachePath)
        if (cachedVid.src !== fileUrl && !cachedVid.src.endsWith(fileUrl)) {
          cachedVid.src = fileUrl
          cachedVid.load()
        }
        applyPlaybackResolution(cachedVid, playbackResolution)
        const offset = Math.max(0, atTime - activeCache.startTime)
        if (mode === 'playback') {
          if (Math.abs(cachedVid.currentTime - offset) > 0.25) {
            cachedVid.currentTime = offset
          }
          if (cachedVid.paused) {
            cachedVid.play().catch(() => {})
          }
        } else {
          if (!cachedVid.paused) cachedVid.pause()
          if (Math.abs(cachedVid.currentTime - offset) > 0.04) {
            cachedVid.currentTime = offset
          }
        }
        // Pause underlying pool videos to avoid duplicate decoding during complex segment playback
        for (const [, pooledVideo] of videoPoolRef.current) {
          if (!pooledVideo.paused) pooledVideo.pause()
        }
        for (const [, compMedia] of compositingMediaRefs.current) {
          if (compMedia instanceof HTMLVideoElement && !compMedia.paused) compMedia.pause()
        }
      }
    } else {
      if (hasActiveCacheRef.current) {
        hasActiveCacheRef.current = false
        setHasActiveCache(false)
      }
      if (cachedVideoRef.current && !cachedVideoRef.current.paused) {
        cachedVideoRef.current.pause()
      }
    }

    const nextState = deriveFrameRenderState(frameRenderCacheRef.current, tracksRef.current, atTime)
    const lastFrame = lastFrameRequestRef.current

    if (lastFrame && lastFrame.mode === mode && sameFrameRenderState(lastFrame.state, nextState)) {
      syncPlaybackTimecode(atTime)
      return
    }

    lastFrameRequestRef.current = { state: nextState, mode }
    syncPlaybackTimecode(atTime)
    syncFrameScene(nextState)
    applyFrameVisuals(nextState, mode)
  }, [applyFrameVisuals, playbackResolution, syncFrameScene, syncPlaybackTimecode])

  React.useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      applyPlaybackResolution(video, playbackResolution)
    }
    if (cachedVideoRef.current) {
      applyPlaybackResolution(cachedVideoRef.current, playbackResolution)
    }
  }, [playbackResolution])

  React.useEffect(() => {
    if (!isPlaying && cachedVideoRef.current && !cachedVideoRef.current.paused) {
      cachedVideoRef.current.pause()
    }
  }, [isPlaying])

  React.useEffect(() => {
    return () => {
      for (const poolPath of Array.from(videoPoolRef.current.keys())) {
        destroyPoolVideo(poolPath)
      }
      if (cachedVideoRef.current) {
        cachedVideoRef.current.pause()
        cachedVideoRef.current.removeAttribute('src')
        cachedVideoRef.current.load()
      }
    }
  }, [destroyPoolVideo])

  React.useLayoutEffect(() => {
    const lastFrame = lastFrameRequestRef.current
    if (!lastFrame) return
    applyFrameVisuals(lastFrame.state, lastFrame.mode)
  }, [applyFrameVisuals, frameScene])

  React.useEffect(() => {
    syncPlaybackTimecode(currentTime)
  }, [currentTime, syncPlaybackTimecode])

  React.useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      renderFrame(playbackTimeRef.current, 'playback')
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, playbackTimeRef, renderFrame])

  React.useEffect(() => {
    if (isPlaying) return
    renderFrame(currentTime, 'scrub')
  }, [clips, currentTime, isPlaying, renderFrame, subtitles, tracks])

  // Re-sync timeline visuals when exiting video preview mode so there is never a black screen
  React.useEffect(() => {
    if (!isPreviewingVideo) {
      lastFrameRequestRef.current = null
      renderFrame(currentTime, 'scrub')
      requestAnimationFrame(() => {
        lutCanvasRef.current?.renderNow()
        const last = lastFrameRequestRef.current
        if (last) {
          applyFrameVisuals(last.state, last.mode)
        }
      })
    }
  }, [isPreviewingVideo, currentTime, renderFrame, applyFrameVisuals])

  React.useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === previewContainerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  React.useEffect(() => {
    if (!previewZoomOpen) return
    const handler = () => setPreviewZoomOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [previewZoomOpen])

  React.useEffect(() => {
    if (!playbackResOpen) return
    const handler = () => setPlaybackResOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [playbackResOpen])

  React.useEffect(() => {
    if (previewZoom === 'fit') {
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [previewZoom])

  React.useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setPreviewZoom(prev => {
        const current = prev === 'fit' ? 100 : prev
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        return Math.round(Math.min(1600, Math.max(10, current * delta)))
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])


  // Compositing stack video sync is handled inside renderFrame.

  const activeClip = frameScene.activeClip
  const monitorClip = activeClip
  const compositingStack = frameScene.compositingStack
  const activeTextClips = frameScene.activeTextClips
  const activeStickerClips = frameScene.activeStickerClips

  /**
   * Clicking the picture selects the clip under the pointer.
   *
   * Every visual clip is drawn with `pointer-events: none` so the compositing
   * layers never swallow a drag, which meant a click always landed on the frame
   * behind them and cleared the selection — selecting a sticker on the timeline
   * and then clicking it on screen made its transform handles disappear.
   *
   * Topmost first: the compositing stack is drawn lowest track first, so walking
   * it backwards picks what the user can actually see.
   */
  const selectVisualClipAtPoint = React.useCallback((event: React.MouseEvent) => {
    // A drag on the bounding box ends with a click here. The clip stays
    // selected: the user is working on it, and re-picking would hand focus to
    // whatever happens to sit under the pointer.
    if (transformInteractionRef.current) {
      transformInteractionRef.current = false
      return
    }

    const wrapper = videoFrameWrapperRef.current
    if (!wrapper) {
      clearClipSelection()
      return
    }

    const rect = wrapper.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const frame = { width: rect.width, height: rect.height }

    const candidates = [...compositingStack, ...(activeClip ? [activeClip] : []), ...activeStickerClips]
    for (let i = candidates.length - 1; i >= 0; i--) {
      const clip = candidates[i]
      if (!clip || clip.type === 'audio') continue
      const asset = clip.assetId ? assets.find(a => a.id === clip.assetId) : clip.asset
      const box = clipScreenBox(frame, asset, clip.transform)
      if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
        selectClip(clip.id)
        return
      }
    }

    clearClipSelection()
  }, [activeClip, activeStickerClips, assets, clearClipSelection, compositingStack, selectClip])
  const activeSubtitles = frameScene.activeSubtitles
  const activeLetterbox = frameScene.activeLetterbox
  const activeAdjustmentEffects = frameScene.activeAdjustmentEffects
  const crossDissolveState = frameScene.crossDissolve
    ? {
      ...frameScene.crossDissolve,
      progress: lastFrameRequestRef.current?.state.crossDissolveProgress ?? 0,
    }
    : null

  const sampleColorAtEvent = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedClip) {
      setEyedropperMode(false)
      return
    }

    const wrapper = videoFrameWrapperRef.current
    if (!wrapper) {
      setEyedropperMode(false)
      return
    }

    const rect = wrapper.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      setEyedropperMode(false)
      return
    }

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    let sourceEl: HTMLImageElement | HTMLVideoElement | null = null
    if (activeClip && isImageClip(activeClip)) {
      sourceEl = activeImageRef.current
    } else if (activeClip?.asset?.type === 'video') {
      sourceEl = videoPoolRef.current.get(activePoolPathRef.current) ?? null
    }

    if (!sourceEl) {
      setEyedropperMode(false)
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const sw = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.naturalWidth) || 640
      const sh = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.naturalHeight) || 360
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(sourceEl, 0, 0, sw, sh)
        const px = Math.min(sw - 1, Math.max(0, Math.floor(normX * sw)))
        const py = Math.min(sh - 1, Math.max(0, Math.floor(normY * sh)))
        const pixel = ctx.getImageData(px, py, 1, 1).data
        const r = pixel[0].toString(16).padStart(2, '0')
        const g = pixel[1].toString(16).padStart(2, '0')
        const b = pixel[2].toString(16).padStart(2, '0')
        const hex = `#${r}${g}${b}`.toUpperCase()
        setClipChromaKey(selectedClip.id, { color: hex, enabled: true })
      }
    } catch (err) {
      console.warn('[ProgramMonitor] Eyedropper sample failed:', err)
    } finally {
      setEyedropperMode(false)
    }
  }, [activeClip, selectedClip, setClipChromaKey, setEyedropperMode])

  return (
    // h-full, not flex-1: the resizable Panel that hosts this is a plain block,
    // so a flex-grow here would resolve against nothing and the preview would
    // collapse to its content height.
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-zinc-900">
        {/* Player header — names the pane after the timeline it plays. */}
        <div className="flex h-[34px] flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="truncate text-[13px] text-zinc-100 font-medium">
              Player{activeTimelineName ? ` - ${activeTimelineName}` : ''}
            </span>
            {isPreviewingVideo && sourceVideoDimensions ? (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-950/80 text-blue-300 border border-blue-500/40">
                Gốc: {sourceVideoDimensions.width}×{sourceVideoDimensions.height}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openProjectSettingsModal()}
                className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-teal-400 transition-colors border border-zinc-700/60"
                title="Change project / timeline dimensions"
              >
                {effectiveDimensions.aspectRatioLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSafeZoneGuide(prev => !prev)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                showSafeZoneGuide
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
              }`}
              title="Toggle TikTok / Reels 9:16 Safe Zone Guide"
            >
              <Shield className="h-3 w-3" />
              Safe Zone
            </button>
          </div>
          <button
            type="button"
            onClick={() => openProjectSettingsModal()}
            className="cc-icon-btn"
            title="Project / timeline settings"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>

        {/* Preview (existing) */}
        <div
          ref={previewContainerRef}
          className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${isFullscreen ? 'bg-black' : ''}`}
          style={{ backgroundColor: '#000', ...(previewZoom !== 'fit' ? { cursor: 'grab' } : {}) }}
          onClick={(e) => {
            if (isPreviewingVideo && !((e.target as HTMLElement).closest('[data-source-video-preview]'))) {
              setPreviewAssetId(null)
            }
          }}
          onMouseDown={(e) => {
            if (previewZoom === 'fit') return
            if (e.button !== 0 && e.button !== 1) return
            previewPanRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: previewPan.x, startPanY: previewPan.y }
          }}
          onMouseMove={(e) => {
            if (!previewPanRef.current.dragging) return
            setPreviewPan({
              x: previewPanRef.current.startPanX + (e.clientX - previewPanRef.current.startX),
              y: previewPanRef.current.startPanY + (e.clientY - previewPanRef.current.startY),
            })
          }}
          onMouseUp={() => { previewPanRef.current.dragging = false }}
          onMouseLeave={() => { previewPanRef.current.dragging = false }}
        >
          {clips.length === 0 && !isPreviewingVideo ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-48 h-28 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center mb-4 mx-auto">
                  <Layers className="h-8 w-8 text-zinc-600 mb-2" />
                  <p className="text-zinc-500 text-xs">Drop clips here</p>
                </div>
                <p className="text-zinc-600 text-xs">Click assets or drag them to the timeline</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={previewZoom !== 'fit' ? {
                transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${(previewZoom as number) / 100})`,
                transformOrigin: 'center center',
              } : undefined}
            >
              {/* Dedicated Source Video Preview (completely isolated from timeline overlays) */}
              {isPreviewingVideo && previewAsset && (
                <div
                  data-source-video-preview
                  className="relative bg-black overflow-hidden shadow-2xl flex items-center justify-center z-30"
                  style={{
                    ...(sourceVideoFrameSize.width > 0
                      ? { width: sourceVideoFrameSize.width, height: sourceVideoFrameSize.height }
                      : {
                          width: '100%',
                          aspectRatio: sourceVideoDimensions
                            ? `${sourceVideoDimensions.width} / ${sourceVideoDimensions.height}`
                            : `${previewAsset.width || 16} / ${previewAsset.height || 9}`,
                        }),
                  }}
                >
                  <video
                    ref={previewVideoRef}
                    src={pathToFileUrl(previewAsset.path)}
                    autoPlay
                    playsInline
                    loop
                    className="w-full h-full object-contain cursor-pointer"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget
                      if (v.videoWidth && v.videoHeight) {
                        setSourceVideoDimensions({ width: v.videoWidth, height: v.videoHeight })
                      }
                      setPreviewVideoDuration(v.duration || previewAsset.duration || 0)
                    }}
                    onTimeUpdate={(e) => {
                      setPreviewVideoCurrentTime(e.currentTarget.currentTime)
                    }}
                    onPlay={() => setPreviewVideoPlaying(true)}
                    onPause={() => setPreviewVideoPlaying(false)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (previewVideoRef.current) {
                        if (previewVideoRef.current.paused) {
                          previewVideoRef.current.play().catch(() => {})
                        } else {
                          previewVideoRef.current.pause()
                        }
                      }
                    }}
                  />
                  {/* Source Video Tag Badge with close button */}
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-30">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/85 border border-blue-500/50 text-blue-300 text-xs font-medium shadow-lg backdrop-blur-sm pointer-events-auto">
                      <Video className="w-3.5 h-3.5 text-blue-400" />
                      <span className="truncate max-w-[220px]">{previewAsset.path.split(/[/\\]/).pop() || previewAsset.path}</span>
                      {sourceVideoDimensions && (
                        <span className="text-[10px] text-zinc-400 border-l border-zinc-700 pl-1.5 ml-0.5 font-mono">
                          {sourceVideoDimensions.width}×{sourceVideoDimensions.height}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Đóng xem trước (Esc)"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewAssetId(null)
                      }}
                      className="p-1.5 rounded-md bg-black/80 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors pointer-events-auto shadow-lg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Eyedropper active banner */}
              {eyedropperMode && !isPreviewingVideo && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-600/90 text-white text-xs shadow-lg backdrop-blur-sm pointer-events-auto">
                  <Pipette className="h-3.5 w-3.5 animate-bounce" />
                  <span>Click video to sample chroma key background color (Esc to cancel)</span>
                  <button
                    type="button"
                    onClick={() => setEyedropperMode(false)}
                    className="ml-1 text-zinc-200 hover:text-white font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Video frame wrapper — background with exact timeline dimensions & aspect ratio */}
              <div
                ref={videoFrameWrapperRef}
                className={`relative bg-black overflow-hidden shadow-2xl ${isPreviewingVideo ? 'hidden' : ''}`}
                style={{
                  display: isPreviewingVideo ? 'none' : undefined,
                  cursor: eyedropperMode ? 'crosshair' : undefined,
                  ...(videoFrameSize.width > 0
                    ? { width: videoFrameSize.width, height: videoFrameSize.height }
                    : {
                        width: '100%',
                        aspectRatio: `${effectiveDimensions.width} / ${effectiveDimensions.height}`,
                      }),
                  backgroundColor:
                    activeTimeline?.background?.type === 'color' && activeTimeline.background.color
                      ? activeTimeline.background.color
                      : '#000000',
                }}
                onPointerDown={() => {
                  // The bounding box stops propagation on its own handles, so a
                  // press that reaches the frame is a press outside them. Clearing
                  // here keeps the flag from surviving a drag that ended off-frame
                  // and swallowing the next click.
                  transformInteractionRef.current = false
                }}
                onClick={(e) => {
                  if (clickedTextOverlayRef.current) {
                    return
                  }
                  if (eyedropperMode) {
                    e.stopPropagation()
                    sampleColorAtEvent(e)
                    return
                  }
                  selectVisualClipAtPoint(e)
                }}
              >
              {(() => {
                return (
                <>
                  {/* Timeline Background: custom image or blur layer behind composited clips */}
                  {activeTimeline?.background?.type === 'image' && activeTimeline.background.imagePath && (
                    <img
                      src={pathToFileUrl(activeTimeline.background.imagePath)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none z-[0]"
                    />
                  )}
                  {activeTimeline?.background?.type === 'blur' && (
                    <canvas
                      ref={blurCanvasRef}
                      width={Math.min(360, effectiveDimensions.width || 360)}
                      height={Math.round(Math.min(360, effectiveDimensions.width || 360) / (effectiveDimensions.aspectRatio || (16 / 9)))}
                      className="absolute inset-0 w-full h-full pointer-events-none z-[0]"
                      style={{
                        filter: `blur(${Math.max(2, Math.round((activeTimeline.background.blur ?? 40) * 0.35))}px)`,
                        transform: 'scale(1.15)',
                      }}
                    />
                  )}

                  {/* Compositing: render clips from lower tracks underneath the active clip */}
                  {compositingStack.map(lowerClip => {
                    const lowerPath = getClipPath(lowerClip) || lowerClip.asset?.path || ''
                    const lowerFileUrl = lowerPath ? pathToFileUrl(lowerPath) : ''
                    if (isImageClip(lowerClip)) {
                      return (
                        <img
                          key={`comp-${lowerClip.id}`}
                          src={lowerFileUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
                          onLoad={() => {
                            const slot = compositingSlotMapRef.current.get(lowerClip.id)
                            if (slot !== undefined) {
                              compLutCanvasRefs[slot]?.current?.renderNow()
                            }
                          }}
                          ref={(el) => {
                            if (el) compositingMediaRefs.current.set(lowerClip.id, el)
                            else compositingMediaRefs.current.delete(lowerClip.id)
                          }}
                        />
                      )
                    }
                    return (
                      <video
                        key={`comp-${lowerClip.id}`}
                        id={`comp-video-${lowerClip.id}`}
                        src={lowerFileUrl}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
                        muted
                        playsInline
                        preload="auto"
                        ref={(el) => {
                          if (el) {
                            compositingMediaRefs.current.set(lowerClip.id, el)
                            el.muted = true
                          } else {
                            compositingMediaRefs.current.delete(lowerClip.id)
                          }
                        }}
                      />
                    )
                  })}

                  {/* Pooled WebGL2 LUT canvases for lower compositing layers */}
                  {Array.from({ length: MAX_COMPOSITING_CANVASES }).map((_, slotIndex) => {
                    const assignedClipId = Array.from(compositingSlotMapRef.current.entries())
                      .find(([_, s]) => s === slotIndex)?.[0]
                    const assignedClip = assignedClipId ? compositingStack.find(c => c.id === assignedClipId) : null
                    const assignedFilter = assignedClip ? frameScene.compositingFilters[assignedClip.id] : undefined
                    const sourceEl = assignedClip ? compositingMediaRefs.current.get(assignedClip.id) ?? null : null

                    return (
                      <LutCanvas
                        key={`comp-lut-slot-${slotIndex}`}
                        ref={compLutCanvasRefs[slotIndex]}
                        sourceElement={sourceEl}
                        filterId={assignedFilter?.id}
                        intensity={assignedFilter?.intensity ?? 100}
                        chromaKey={assignedClip?.chromaKey}
                        isPlaying={isPlaying}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
                      />
                    )
                  })}

                  {/* Transition background overlay */}
                  {activeClip && (() => {
                    const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
                    const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
                    const bg = tInBg || tOutBg
                    if (!bg) return null
                    return <div ref={transitionBgRef} className="absolute inset-0 z-10 pointer-events-none hidden" />
                  })()}
                  {/* Video pool container — during dissolve, fade out with progress */}
                  <div
                    ref={videoPoolContainerRef}
                    className="absolute inset-0 w-full h-full pointer-events-none z-[2] hidden"
                  />

                  {activeClip && isImageClip(activeClip) && (
                    <img
                      ref={attachActiveImage}
                      src={pathToFileUrl(getClipPath(activeClip) || activeClip.asset?.path || '')}
                      alt=""
                      onLoad={() => {
                        lutCanvasRef.current?.renderNow()
                        if (blurCanvasRef.current && activeTimeline?.background?.type === 'blur') {
                          const last = lastFrameRequestRef.current
                          if (last) applyFrameVisuals(last.state, last.mode)
                        }
                      }}
                      className="absolute inset-0 w-full h-full object-contain z-[2]"
                    />
                  )}

                  {/* 3D LUT WebGL2 preview canvas */}
                  <LutCanvas
                    ref={lutCanvasRef}
                    sourceElement={
                      isImageClip(activeClip)
                        ? activeImageEl
                        : activePoolPathRef.current
                          ? videoPoolRef.current.get(activePoolPathRef.current) ?? null
                          : null
                    }
                    filterId={frameScene.activeFilter?.id}
                    intensity={frameScene.activeFilter?.intensity ?? 100}
                    chromaKey={activeClip?.chromaKey}
                    isPlaying={isPlaying}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[2]"
                  />

                  {/* Cross-dissolve incoming clip overlay */}
                  {crossDissolveState && (() => {
                    const { incoming } = crossDissolveState
                    const inPath = getClipPath(incoming) || incoming.asset?.path || ''
                    const inFileUrl = inPath ? pathToFileUrl(inPath) : ''
                    if (incoming.asset?.type === 'video') {
                      return (
                        <video
                          ref={incomingDissolveVideoRef}
                          key={`dissolve-in-${incoming.id}`}
                          src={inFileUrl}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
                          playsInline
                          muted
                          preload="auto"
                        />
                      )
                    }
                    if (incoming.asset?.type === 'image') {
                      return (
                        <img
                          ref={incomingDissolveImageRef}
                          key={`dissolve-in-${incoming.id}`}
                          src={inFileUrl}
                          alt=""
                          onLoad={() => {
                            incomingLutCanvasRef.current?.renderNow()
                          }}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
                        />
                      )
                    }
                    return null
                  })()}

                  {/* Cross-dissolve incoming WebGL2 LUT canvas */}
                  <LutCanvas
                    key="incoming-lut-canvas"
                    ref={incomingLutCanvasRef}
                    sourceElement={
                      crossDissolveState?.incoming.asset?.type === 'video'
                        ? incomingDissolveVideoRef.current
                        : incomingDissolveImageRef.current
                    }
                    filterId={frameScene.incomingFilter?.id}
                    intensity={frameScene.incomingFilter?.intensity ?? 100}
                    chromaKey={crossDissolveState?.incoming.chromaKey}
                    isPlaying={isPlaying}
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
                  />

                  {/* Note: Clip-level masks will be implemented in KE-501 (resolved in KE-106). */}

                  {/* Audio waveform or empty state when no video/image clip is visible */}
                  {!monitorClip && activeStickerClips.length === 0 && (() => {
                    const audioAtPlayhead = frameScene.audioOnlyClips
                    return audioAtPlayhead.length > 0 ? (
                      <div className="absolute inset-0">
                        <AudioWaveform
                          audioClips={audioAtPlayhead.map(c => ({
                            url: pathToFileUrl(getClipPath(c) || c.asset?.path || ''),
                            name: c.asset?.path || c.importedName || 'Audio',
                            startTime: c.startTime,
                            duration: c.duration,
                          }))}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                        />
                      </div>
                    ) : !isPlaying ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                          <Video className="h-8 w-8 text-zinc-600" />
                        </div>
                        <p className="text-zinc-500 text-sm">No clip at playhead</p>
                        <p className="text-zinc-600 text-xs mt-1">Move playhead over a clip to preview</p>
                      </div>
                    ) : null
                  })()}
                </>
                )
              })()}

              {/* Pre-rendered complex segment render cache overlay */}
              <video
                ref={cachedVideoRef}
                className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-[15] ${hasActiveCache ? '' : 'hidden'}`}
                muted
                playsInline
                preload="auto"
              />

              {/* Adjustment layer effects */}
              {activeAdjustmentEffects.map(({ clip: adjClip, filterStyle, hasVignette, vignetteAmount, hasGrain, grainAmount }) => {
                const backdropFilter = filterStyle.filter && filterStyle.filter !== 'none' ? String(filterStyle.filter) : undefined
                return (
                  <React.Fragment key={`adj-fx-${adjClip.id}`}>
                    {backdropFilter && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{ backdropFilter, WebkitBackdropFilter: backdropFilter }}
                      />
                    )}
                    {hasVignette && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{
                          background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${vignetteAmount}) 100%)`,
                        }}
                      />
                    )}
                    {hasGrain && (
                      <canvas
                        ref={(canvas) => {
                          if (!canvas) return
                          const ctx = canvas.getContext('2d')
                          if (!ctx) return
                          const w = canvas.width = 256
                          const h = canvas.height = 256
                          const imageData = ctx.createImageData(w, h)
                          for (let i = 0; i < imageData.data.length; i += 4) {
                            const v = Math.random() * 255
                            imageData.data[i] = v
                            imageData.data[i + 1] = v
                            imageData.data[i + 2] = v
                            imageData.data[i + 3] = (grainAmount / 100) * 80
                          }
                          ctx.putImageData(imageData, 0, 0)
                        }}
                        className="absolute inset-0 z-[22] pointer-events-none w-full h-full"
                        style={{ mixBlendMode: 'overlay', imageRendering: 'pixelated' }}
                      />
                    )}
                  </React.Fragment>
                )
              })}

              {/* Sticker overlay clips. Above the picture and any transition
                  between shots, but below the pre-rendered segment cache at
                  z-15, which already has the sticker composited into it. */}
              {activeStickerClips.map(sc => (
                <img
                  key={`sticker-${sc.id}`}
                  src={pathToFileUrl(getClipPath(sc) || sc.asset?.path || '')}
                  alt=""
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[14]"
                  ref={(el) => {
                    if (el) stickerImageRefs.current.set(sc.id, el)
                    else stickerImageRefs.current.delete(sc.id)
                  }}
                  onLoad={() => {
                    const last = lastFrameRequestRef.current
                    if (last) applyFrameVisuals(last.state, last.mode)
                  }}
                />
              ))}

              {/* Text overlay clips with bounding box & resize/scale/width/rotate handles */}
              {activeTextClips.map(tc => {
                const isSelected = selectedClipIds.has(tc.id)
                return (
                  <TextBoundingBox
                    key={`text-${tc.id}`}
                    clip={tc}
                    isSelected={isSelected}
                    currentTime={currentTime}
                    frameElement={videoFrameWrapperRef.current}
                    onSelect={() => {
                      clickedTextOverlayRef.current = true
                      selectClip(tc.id)
                    }}
                    onDoubleClick={() => {
                      selectClip(tc.id)
                      setShowPropertiesPanel(true)
                    }}
                    onUpdatePosition={(posX, posY) => {
                      setClipTextPosition(tc.id, posX, posY)
                    }}
                    onUpdateFontSize={(fontSize) => {
                      setClipTextStyleField(tc.id, 'fontSize', fontSize)
                    }}
                    onUpdateMaxWidth={(maxWidth) => {
                      setClipTextStyleField(tc.id, 'maxWidth', maxWidth)
                    }}
                    onUpdateRotation={(rotation) => {
                      setClipTransform(tc.id, { rotation })
                    }}
                    onDelete={() => {
                      deleteClips([tc.id])
                    }}
                    onInteractionStart={() => {
                      clickedTextOverlayRef.current = true
                    }}
                    onInteractionEnd={() => {
                      requestAnimationFrame(() => {
                        clickedTextOverlayRef.current = false
                      })
                    }}
                  />
                )
              })}

              {/* Subtitle overlay */}
              {activeSubtitles.length > 0 && (
                <div className="absolute inset-0 z-[25] pointer-events-none flex flex-col justify-end">
                  {activeSubtitles.map(sub => {
                    const track = tracks[sub.trackIndex]
                    const style = { ...DEFAULT_SUBTITLE_STYLE, ...(track?.subtitleStyle || {}), ...sub.style }
                    return (
                      <div
                        key={sub.id}
                        className={`w-full flex ${
                          style.position === 'top' ? 'self-start' : style.position === 'center' ? 'self-center absolute inset-0 items-center justify-center' : 'self-end'
                        }`}
                        style={style.position !== 'center' ? { padding: style.position === 'top' ? '12px 16px 0' : '0 16px 12px' } : undefined}
                      >
                        <span
                          className="inline-block max-w-[90%] text-center mx-auto rounded px-3 py-1.5 leading-snug whitespace-pre-wrap"
                          style={{
                            fontSize: `${style.fontSize}px`,
                            fontFamily: style.fontFamily,
                            fontWeight: style.fontWeight,
                            fontStyle: style.italic ? 'italic' : 'normal',
                            color: style.color,
                            backgroundColor: style.backgroundColor,
                            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                          }}
                        >
                          {sub.text}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Letterbox overlay from adjustment layers */}
              {activeLetterbox && (() => {
                const containerRatio = 16 / 9
                const targetRatio = activeLetterbox.ratio
                if (targetRatio >= containerRatio) {
                  const barPct = ((1 - containerRatio / targetRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute left-0 right-0 top-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute left-0 right-0 bottom-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                } else {
                  const barPct = ((1 - targetRatio / containerRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute top-0 bottom-0 right-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                }
              })()}
              {/* Note: Clip-level masks will be implemented in KE-501 (resolved in KE-106). */}

              {/* Transform Bounding Box for active selected visual clip */}
              <TransformBoundingBox
                selectedClip={selectedClip}
                onInteractionStart={() => { transformInteractionRef.current = true }}
                assets={assets}
                videoFrameSize={videoFrameSize}
                currentTime={currentTime}
                cropMode={cropMode}
                onToggleCropMode={() => toggleCropMode()}
                onUpdateTransform={(patch, options) => {
                  if (selectedClip) {
                    setClipTransform(selectedClip.id, patch, options)
                  }
                }}
              />

              {/* Mask Bounding Box for on-screen mask editing */}
              <MaskBoundingBox
                selectedClip={selectedClip}
                assets={assets}
                videoFrameSize={videoFrameSize}
                currentTime={currentTime}
                maskMode={maskMode}
                onUpdateMask={(patch) => {
                  if (selectedClip) {
                    setClipMask(selectedClip.id, patch)
                  }
                }}
              />

              {/* Safe Zone Guide overlay for 9:16 Shorts/Reels */}
              {showSafeZoneGuide && (
                <div className="absolute inset-0 pointer-events-none z-[28]">
                  {/* Top zone: ~12% */}
                  <div className="absolute top-0 left-0 right-0 h-[12%] border-b border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
                    <span className="text-[10px] text-red-300 font-mono bg-black/60 px-1.5 py-0.5 rounded">
                      Top UI / Header Zone (12%)
                    </span>
                  </div>
                  {/* Right zone: ~15% from 20% to 80% height */}
                  <div className="absolute top-[20%] bottom-[25%] right-0 w-[15%] border-l border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
                    <span className="text-[9px] text-red-300 font-mono bg-black/60 px-1 py-0.5 rounded -rotate-90">
                      Icons / Buttons (15%)
                    </span>
                  </div>
                  {/* Bottom zone: ~25% */}
                  <div className="absolute bottom-0 left-0 right-0 h-[25%] border-t border-dashed border-red-500/60 bg-red-500/10 flex items-center justify-center">
                    <span className="text-[10px] text-red-300 font-mono bg-black/60 px-1.5 py-0.5 rounded">
                      Bottom Description & Nav Zone (25%)
                    </span>
                  </div>
                  {/* Center recommended safe zone for subtitles: ~70-75% from top */}
                  <div className="absolute top-[68%] left-[10%] right-[18%] h-[8%] border border-teal-400/80 bg-teal-500/10 rounded flex items-center justify-center">
                    <span className="text-[10px] text-teal-300 font-mono bg-black/70 px-1.5 py-0.5 rounded font-bold">
                      ★ Recommended Subtitle Safe Zone (70–75%)
                    </span>
                  </div>
                </div>
              )}
              </div>{/* end video frame wrapper */}

              {/* Transparent overlay to prevent video element default interactions */}
              <div
                className="absolute inset-0 z-20 pointer-events-none"
              />
            </div>
          )}

          {/* Timecode + clip info moved to bottom status bar */}
        </div>

        {/* Transport row — keeps the player free of a scrub bar: the
            timeline below is the only scrubber, so this row is just timecode,
            play, and the view controls. */}
        <div data-source-video-preview className="flex h-[36px] flex-shrink-0 items-center gap-2 border-t border-zinc-800 px-4">
          {/* Left: current / total timecode */}
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <span
              ref={playbackTimecodeRef}
              className="select-none font-mono text-[12px] tabular-nums text-accent"
            >
              {isPreviewingVideo
                ? formatTime(previewVideoCurrentTime, fps, timecodeFormat)
                : formatTime(currentTime, fps, timecodeFormat)}
            </span>
            <span className="text-[12px] text-zinc-600">/</span>
            <span className="select-none font-mono text-[12px] tabular-nums text-zinc-400">
              {isPreviewingVideo
                ? formatTime(previewVideoDuration, fps, timecodeFormat)
                : formatTime(contentDuration > 0 ? contentDuration : totalDuration, fps, timecodeFormat)}
            </span>
          </div>

          {/* Centre: play / pause with frame stepping either side */}
          <div className="flex flex-1 items-center justify-center gap-1">
            <Tooltip content={tooltipLabel('Step Back', getShortcutLabel(kbLayout, 'transport.stepBackward'))} side="top">
              <button
                className="cc-icon-btn"
                onClick={() => {
                  if (isPreviewingVideo && previewVideoRef.current) {
                    previewVideoRef.current.pause()
                    previewVideoRef.current.currentTime = Math.max(0, previewVideoRef.current.currentTime - (1 / fps))
                  } else {
                    pause(); stepCurrentTime(-1 / fps)
                  }
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip content={tooltipLabel((isPreviewingVideo ? previewVideoPlaying : isPlaying) ? 'Pause' : 'Play', getShortcutLabel(kbLayout, 'transport.playPause'))} side="top">
              <button
                onClick={() => {
                  if (isPreviewingVideo && previewVideoRef.current) {
                    if (previewVideoRef.current.paused) {
                      previewVideoRef.current.play().catch(() => {})
                    } else {
                      previewVideoRef.current.pause()
                    }
                  } else {
                    if (isPlaying) {
                      pause()
                    } else {
                      const cd = selectContentDuration(getEditorState())
                      if (cd > 0 && (currentTime >= cd - 0.04 || playbackTimeRef.current >= cd - 0.04)) {
                        playbackTimeRef.current = 0
                        setCurrentTime(0)
                      }
                      play()
                    }
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-100 transition-colors hover:bg-zinc-800"
              >
                {(isPreviewingVideo ? previewVideoPlaying : isPlaying) ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
            </Tooltip>
            <Tooltip content={tooltipLabel('Step Forward', getShortcutLabel(kbLayout, 'transport.stepForward'))} side="top">
              <button
                className="cc-icon-btn"
                onClick={() => {
                  if (isPreviewingVideo && previewVideoRef.current) {
                    previewVideoRef.current.pause()
                    previewVideoRef.current.currentTime = Math.min(previewVideoDuration, previewVideoRef.current.currentTime + (1 / fps))
                  } else {
                    pause(); setCurrentTime(Math.min(contentDuration > 0 ? contentDuration : totalDuration, currentTime + (1 / fps)))
                  }
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>

          {/* Right: playback resolution, preview zoom, fullscreen */}
          <div className="flex flex-shrink-0 items-center gap-1">
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setPlaybackResOpen(prev => !prev) }}
                className={`h-6 rounded-[4px] px-2 text-[11px] transition-colors ${
                  playbackResOpen ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Playback resolution"
              >
                {playbackResolution === 1 ? 'Full' : playbackResolution === 0.5 ? '1/2' : '1/4'}
              </button>
              {playbackResOpen && (
                <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[130px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                  {([
                    { label: 'Full (1:1)', value: 1 as const },
                    { label: 'Half (1/2)', value: 0.5 as const },
                    { label: 'Quarter (1/4)', value: 0.25 as const },
                  ] as const).map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => { setPlaybackResolution(opt.value); setPlaybackResOpen(false) }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors ${
                        playbackResolution === opt.value ? 'text-accent' : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewZoomOpen(prev => !prev) }}
                className={`flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] tabular-nums transition-colors ${
                  previewZoomOpen ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Preview zoom"
              >
                <ZoomIn className="h-3.5 w-3.5" />
                {previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`}
              </button>
              {previewZoomOpen && (
                <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[100px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                  {[
                    { label: 'Fit', value: 'fit' as const },
                    { label: '25%', value: 25 },
                    { label: '50%', value: 50 },
                    { label: '100%', value: 100 },
                    { label: '200%', value: 200 },
                    { label: '400%', value: 400 },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => { setPreviewZoom(opt.value); setPreviewZoomOpen(false) }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors ${
                        previewZoom === opt.value ? 'text-accent' : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Tooltip content={tooltipLabel(isFullscreen ? 'Exit fullscreen' : 'Fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen'))} side="top">
              <button onClick={toggleFullscreen} className="cc-icon-btn">
                {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
  )
})
