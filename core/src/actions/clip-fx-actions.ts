import type {
  ClipMask,
  ChromaKey,
  AutoMatte,
  CustomMatte,
  BrushStroke,
  BrushMode,
  ClipStroke,
  ClipBlendMode,
  ClipEffect,
  EffectType,
  TimelineClip,
  Asset,
  ShapeProperties,
  ClipStabilization,
  StabilizationBake,
} from '../project-model'
import {
  DEFAULT_CLIP_MASK,
  DEFAULT_CHROMA_KEY,
  DEFAULT_AUTO_MATTE,
  DEFAULT_CUSTOM_MATTE,
  DEFAULT_CLIP_STROKE,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_STABILIZATION,
} from '../project-model'
import { clampStabilizationSmoothing } from '../stabilization'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectClips,
  selectTracks,
  selectCurrentTime,
  selectClipById,
  selectAssets,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import { getFilterDefinition } from '../filters'
import {
  getStickerDefinition,
  resolveStickerRelativePath,
  DEFAULT_STICKER_DURATION,
  DEFAULT_STICKER_SCALE,
  DEFAULT_STICKER_PIXELS,
} from '../stickers'
import { getSfxDefinition, resolveSfxRelativePath } from '../sfx'
import { applyTemplate, type TemplateBinding } from '../template-apply'
import type { KomfyTemplate } from '../template-model'
import { BROLL_TRACK_NAME } from '../broll-copilot'
import { mediaSecondsForTimelineSeconds } from '../clip-speed'
import { mainVideoTrackIndex } from '../video-editor-utils'
import { getEffectiveTimelineDimensions } from '../video-resolution'
import type { InsertBrollParams, FreezeFrameParams } from './types'
import {
  updateEditorModel,
  updateSession,
  markEditorModelDirty,
} from './action-helpers'
import { replaceActiveTimeline, switchActiveTimeline, setTimelineSettings } from './timeline-actions'
import { addTrack } from './track-actions'
import { updateClip } from './clip-core-actions'
import { addTextClip, setClipTransform } from './clip-style-actions'
import { addAssetToEditor } from './asset-actions'

export function setMaskMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      maskMode: enabled,
    },
  }))
}

export function toggleMaskMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      maskMode: !session.ui.maskMode,
    },
  }))
}

export function setEyedropperMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      eyedropperMode: enabled,
    },
  }))
}

export function toggleEyedropperMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      eyedropperMode: !session.ui.eyedropperMode,
    },
  }))
}

export function setCustomMatteBrushMode(state: EditorState, mode: BrushMode | null): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      customMatteBrushMode: mode,
    },
  }))
}

export function setCustomMatteBrushSize(state: EditorState, size: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      customMatteBrushSize: Math.max(0.1, Math.min(50, size)),
    },
  }))
}

export function setClipMask(state: EditorState, clipId: string, mask: Partial<ClipMask> | null): EditorState {
  if (!mask) return updateClip(state, clipId, { mask: undefined })
  const clip = selectClipById(state, clipId)
  const currentMask = clip?.mask || DEFAULT_CLIP_MASK
  return updateClip(state, clipId, {
    mask: {
      ...currentMask,
      ...mask,
    },
  })
}

export function setClipChromaKey(state: EditorState, clipId: string, chromaKey: Partial<ChromaKey> | null): EditorState {
  if (!chromaKey) return updateClip(state, clipId, { chromaKey: undefined })
  const clip = selectClipById(state, clipId)
  const currentChromaKey = clip?.chromaKey || DEFAULT_CHROMA_KEY
  return updateClip(state, clipId, {
    chromaKey: {
      ...currentChromaKey,
      ...chromaKey,
    },
  })
}

export function setClipAutoMatte(state: EditorState, clipId: string, autoMatte: Partial<AutoMatte> | null): EditorState {
  if (!autoMatte) return updateClip(state, clipId, { autoMatte: undefined })
  const clip = selectClipById(state, clipId)
  const currentAutoMatte = clip?.autoMatte || DEFAULT_AUTO_MATTE
  return updateClip(state, clipId, {
    autoMatte: {
      ...currentAutoMatte,
      ...autoMatte,
    },
  })
}

export function setClipCustomMatte(state: EditorState, clipId: string, customMatte: Partial<CustomMatte> | null): EditorState {
  if (!customMatte) return updateClip(state, clipId, { customMatte: undefined })
  const clip = selectClipById(state, clipId)
  const currentCustomMatte = clip?.customMatte || DEFAULT_CUSTOM_MATTE
  return updateClip(state, clipId, {
    customMatte: {
      ...currentCustomMatte,
      ...customMatte,
    },
  })
}

/**
 * Turns stabilization on, changes its settings, or (with null) removes it.
 *
 * Only video clips can be stabilized. Changing a setting keeps the old bake on the clip:
 * it no longer validates, so the clip plays the original until the new bake lands, and
 * turning the setting back finds the old bake still good.
 */
export function setClipStabilization(
  state: EditorState,
  clipId: string,
  stabilization: Partial<Omit<ClipStabilization, 'bake'>> | null,
): EditorState {
  if (!stabilization) return updateClip(state, clipId, { stabilization: undefined })
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'video') return state
  const current = clip.stabilization || DEFAULT_CLIP_STABILIZATION
  return updateClip(state, clipId, {
    stabilization: {
      ...current,
      ...stabilization,
      ...(stabilization.smoothing !== undefined
        ? { smoothing: clampStabilizationSmoothing(stabilization.smoothing) }
        : {}),
    },
  })
}

/**
 * Records (or with undefined, forgets) the bake a clip plays. Bookkeeping for the bake
 * keeper, not an edit: callers apply it without an undo step.
 */
export function setClipStabilizationBake(
  state: EditorState,
  clipId: string,
  bake: StabilizationBake | undefined,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.stabilization) return state
  if (clip.stabilization.bake === bake) return state
  return updateClip(state, clipId, { stabilization: { ...clip.stabilization, bake } })
}

export function addCustomMatteStroke(state: EditorState, clipId: string, stroke: BrushStroke): EditorState {
  const clip = selectClipById(state, clipId)
  const currentCustomMatte = clip?.customMatte || DEFAULT_CUSTOM_MATTE
  return updateClip(state, clipId, {
    customMatte: {
      ...currentCustomMatte,
      enabled: true,
      strokes: [...currentCustomMatte.strokes, stroke],
    },
  })
}

export function clearCustomMatteStrokes(state: EditorState, clipId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.customMatte) return state
  return updateClip(state, clipId, {
    customMatte: {
      ...clip.customMatte,
      strokes: [],
      appliedHash: undefined,
    },
  })
}

export function setClipStroke(state: EditorState, clipId: string, stroke: Partial<ClipStroke> | null): EditorState {
  if (!stroke) return updateClip(state, clipId, { stroke: undefined })
  const clip = selectClipById(state, clipId)
  const currentStroke = clip?.stroke || DEFAULT_CLIP_STROKE
  return updateClip(state, clipId, {
    stroke: {
      ...currentStroke,
      ...stroke,
    },
  })
}


export function setClipBlendMode(state: EditorState, clipId: string, blendMode?: ClipBlendMode): EditorState {
  return updateClip(state, clipId, { blendMode: blendMode ?? 'normal' })
}

/* =========================================================================
 * Filter Actions
 * ========================================================================= */

export function setClipFilter(state: EditorState, clipId: string, filterId: string, intensity: number = 100): EditorState {
  return updateClip(state, clipId, {
    filter: {
      id: filterId,
      intensity: Math.max(0, Math.min(100, intensity)),
    },
  })
}

export function removeClipFilter(state: EditorState, clipId: string): EditorState {
  return updateClip(state, clipId, { filter: undefined })
}

export function setClipFilterIntensity(state: EditorState, clipId: string, intensity: number): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.filter) return state
  return updateClip(state, clipId, {
    filter: {
      ...clip.filter,
      intensity: Math.max(0, Math.min(100, intensity)),
    },
  })
}

export interface AddFilterClipParams {
  filterId: string
  intensity?: number
  name?: string
  startTime?: number
  duration?: number
  trackIndex?: number
}

export function addFilterClip(state: EditorState, params: AddFilterClipParams): EditorState {
  let next = state
  let trackIdx = params.trackIndex

  const currentTracks = selectTracks(next)
  const mainIdx = mainVideoTrackIndex(currentTracks)

  // A filter is an adjustment layer that affects everything underneath it.
  // It must NEVER be placed on the main magnetic video track (track 0 / mainIdx).
  // If no track is specified, or if the specified track is the main track:
  if (trackIdx === undefined || trackIdx === mainIdx) {
    const overlayTrackIndices = currentTracks
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => (mainIdx >= 0 ? index !== mainIdx : index > 0) && track.kind === 'video' && track.type !== 'subtitle' && !track.locked)
      .map(({ index }) => index)

    const activeTimeline = selectActiveTimeline(next)
    const existingClips = activeTimeline?.clips || []

    const topOverlayIndex = overlayTrackIndices.length > 0 ? overlayTrackIndices[overlayTrackIndices.length - 1] : undefined
    const topOverlayHasClips = topOverlayIndex !== undefined ? existingClips.some(c => c.trackIndex === topOverlayIndex) : false

    if (topOverlayIndex !== undefined && !topOverlayHasClips) {
      trackIdx = topOverlayIndex
    } else {
      next = addTrack(next, 'video')
      trackIdx = selectTracks(next).length - 1
    }
  }

  const activeTimeline = selectActiveTimeline(next)
  const timelineDuration = activeTimeline?.clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0) ?? 0

  const duration = params.duration ?? (timelineDuration > 0 ? timelineDuration : 5.0)
  const startTime = params.startTime ?? (params.duration === undefined && timelineDuration > 0 ? 0 : selectCurrentTime(next))
  const filterDef = getFilterDefinition(params.filterId)
  const filterName = filterDef ? filterDef.name : params.filterId

  const filterClip: TimelineClip = {
    id: makeId('clip-filter'),
    assetId: null,
    type: 'adjustment',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex: trackIdx,
    asset: null,
    importedName: params.name ?? `Filter: ${filterName}`,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    filter: {
      id: params.filterId,
      intensity: params.intensity ?? 100,
    },
  }

  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: [...timeline.clips, filterClip],
  }))
}

/* =========================================================================
 * Clip Effects Actions
 * ========================================================================= */

export function addClipEffect(
  state: EditorState,
  clipId: string,
  type: EffectType,
  params?: Record<string, number>,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const effects = clip.effects || []
  const newEffect: ClipEffect = {
    id: makeId('effect'),
    type,
    enabled: true,
    params: params || {},
  }
  return updateClip(state, clipId, {
    effects: [...effects, newEffect],
  })
}

export function removeClipEffect(state: EditorState, clipId: string, effectId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.effects) return state
  return updateClip(state, clipId, {
    effects: clip.effects.filter(e => e.id !== effectId),
  })
}

export function setClipEffectEnabled(state: EditorState, clipId: string, effectId: string, enabled: boolean): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.effects) return state
  return updateClip(state, clipId, {
    effects: clip.effects.map(e => (e.id === effectId ? { ...e, enabled } : e)),
  })
}

export function setClipEffectParam(
  state: EditorState,
  clipId: string,
  effectId: string,
  param: string,
  value: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.effects) return state
  return updateClip(state, clipId, {
    effects: clip.effects.map(e =>
      e.id === effectId
        ? {
            ...e,
            params: {
              ...e.params,
              [param]: value,
            },
          }
        : e,
    ),
  })
}

export function clearClipEffects(state: EditorState, clipId: string): EditorState {
  return updateClip(state, clipId, { effects: [] })
}

/* =========================================================================
 * Sticker Actions
 * ========================================================================= */

export interface AddStickerClipParams {
  stickerId: string
  startTime?: number
  duration?: number
  trackIndex?: number
  imagePath?: string
  scale?: number
  positionX?: number
  positionY?: number
  rotation?: number
  opacity?: number
  shapeProperties?: ShapeProperties
}

/**
 * A playhead this close to the start counts as being at the start. The
 * transport reports a float, so it is rarely exactly zero.
 */
const STICKER_TIMELINE_START_EPSILON = 1e-3

/**
 * The scale a new sticker starts at, so it lands about DEFAULT_STICKER_PIXELS
 * across whatever the project's frame size is.
 *
 * A square sticker is fitted to the frame's short edge before `transform.scale`
 * is applied — that holds in the preview (object-contain then a CSS scale) and
 * in the export (force_original_aspect_ratio=decrease then the same factor) —
 * so the short edge is what the percentage has to be measured against.
 */
function defaultStickerScale(state: EditorState): number {
  const timeline = selectActiveTimeline(state)
  const dimensions = getEffectiveTimelineDimensions(timeline, selectAssets(state))
  const shortEdge = Math.min(dimensions.width, dimensions.height)
  if (!shortEdge || !Number.isFinite(shortEdge)) return DEFAULT_STICKER_SCALE
  // Clamped so an unusual frame size cannot produce a sticker too small to grab
  // by its handles, or one that fills the screen.
  return Math.max(2, Math.min(80, (DEFAULT_STICKER_PIXELS / shortEdge) * 100))
}

export function addStickerClip(state: EditorState, params: AddStickerClipParams): EditorState {
  let next = state
  const startTime = params.startTime ?? selectCurrentTime(next)
  const duration = params.duration ?? DEFAULT_STICKER_DURATION
  let trackIdx = params.trackIndex

  if (trackIdx === undefined) {
    // Stickers live on their own rows and nowhere else. Sharing an overlay row
    // with footage or text meant a sticker could land on top of a title, which
    // is why 'sticker' is its own track kind.
    //
    // Playhead at the start   -> a fresh sticker row every time. Stickers added
    //                            there all begin at 0, so sharing a row would
    //                            just pile them on top of each other.
    // Playhead anywhere else  -> the first sticker row, at that position.
    //
    // A row already busy at that moment is skipped rather than written over, and
    // if every one of them is busy a new row is added. Sticker rows are not
    // magnetic, so two clips at the same spot would silently overlap.
    const stickerRows = selectTracks(next)
      .map((track, idx) => ({ track, idx }))
      .filter(entry => entry.track.kind === 'sticker' && !entry.track.locked)
    const clips = selectClips(next)
    const isFreeAt = (idx: number) => !clips.some(clip =>
      clip.trackIndex === idx
      && clip.startTime < startTime + duration
      && clip.startTime + clip.duration > startTime)

    const target = startTime < STICKER_TIMELINE_START_EPSILON
      ? undefined
      : stickerRows.find(entry => isFreeAt(entry.idx))

    if (target) {
      trackIdx = target.idx
    } else {
      next = addTrack(next, 'sticker')
      trackIdx = selectTracks(next).length - 1
    }
  }

  const def = getStickerDefinition(params.stickerId)
  const imagePath = params.imagePath ?? (def ? `stickers/${def.filename}` : resolveStickerRelativePath(params.stickerId))
  const stickerName = def ? def.name : (params.stickerId || 'Sticker')

  const assetId = makeId('asset-sticker')
  const stickerWidth = def?.width || 512
  const stickerHeight = def?.height || 512
  const stickerAsset: Asset = {
    id: assetId,
    type: 'image',
    path: imagePath,
    prompt: `Sticker: ${stickerName}`,
    resolution: `${stickerWidth}x${stickerHeight}`,
    // Carry the dimensions as real fields, not just inside the resolution
    // string. An image asset missing width/height counts as needing the asset
    // metadata upgrade pass, and a sticker path is relative so that pass can
    // never complete for it.
    width: stickerWidth,
    height: stickerHeight,
    duration,
    createdAt: Date.now(),
    // The clip needs an asset, but the user never imported this file, so the
    // media panel leaves it out.
    source: 'sticker',
  }

  next = updateEditorModel(next, editorModel => ({
    ...editorModel,
    assets: [stickerAsset, ...editorModel.assets],
  }))

  const stickerClip: TimelineClip = {
    id: makeId('clip-sticker'),
    assetId: stickerAsset.id,
    type: 'image',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex: trackIdx,
    asset: stickerAsset,
    importedName: `Sticker: ${stickerName}`,
    stickerId: params.stickerId,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: {
      ...DEFAULT_CLIP_TRANSFORM,
      scale: params.scale ?? defaultStickerScale(next),
      ...(params.positionX !== undefined ? { positionX: params.positionX } : {}),
      ...(params.positionY !== undefined ? { positionY: params.positionY } : {}),
      ...(params.rotation !== undefined ? { rotation: params.rotation } : {}),
    },
    opacity: params.opacity ?? 100,
    ...(params.shapeProperties ? { shapeProperties: params.shapeProperties } : {}),
  }

  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: [...timeline.clips, stickerClip],
  }))
}

/* =========================================================================
 * Sound Effect (SFX) Actions
 * ========================================================================= */

export interface AddSfxClipParams {
  sfxId: string
  startTime?: number
  duration?: number
  trackIndex?: number
  audioPath?: string
  volume?: number
}

export function addSfxClip(state: EditorState, params: AddSfxClipParams): EditorState {
  let next = state
  const startTime = params.startTime ?? selectCurrentTime(next)
  const def = getSfxDefinition(params.sfxId)
  const duration = params.duration ?? def?.duration ?? 1.0
  const audioPath = params.audioPath ?? (def ? `sfx/${def.filename}` : resolveSfxRelativePath(params.sfxId))
  const sfxName = def ? def.name : (params.sfxId || 'Sound Effect')

  let trackIdx = params.trackIndex

  if (trackIdx === undefined) {
    const audioTrackEntries = selectTracks(next)
      .map((candidate, idx) => ({ track: candidate, idx }))
      .filter(entry => entry.track.kind === 'audio' && !entry.track.locked && entry.track.sourcePatched !== false)

    const clips = selectClips(next)
    const endTime = startTime + duration
    const isFreeAt = (idx: number) => !clips.some(c =>
      c.trackIndex === idx && c.startTime < endTime && (c.startTime + c.duration) > startTime,
    )

    // Prefer secondary audio tracks (A2+) if available and free to avoid cluttering primary audio/voiceover (A1)
    let target = audioTrackEntries.length >= 2 && isFreeAt(audioTrackEntries[1].idx)
      ? audioTrackEntries[1].idx
      : audioTrackEntries.find(entry => isFreeAt(entry.idx))?.idx

    if (target === undefined) {
      next = addTrack(next, 'audio')
      target = selectTracks(next).length - 1
    }
    trackIdx = target
  }

  const assetId = makeId('asset-sfx')
  const sfxAsset: Asset = {
    id: assetId,
    type: 'audio',
    path: audioPath,
    prompt: `SFX: ${sfxName}`,
    resolution: '',
    duration,
    createdAt: Date.now(),
    source: 'sfx',
  }

  next = updateEditorModel(next, editorModel => ({
    ...editorModel,
    assets: [sfxAsset, ...editorModel.assets],
  }))

  const sfxClip: TimelineClip = {
    id: makeId('clip-sfx'),
    assetId: sfxAsset.id,
    type: 'audio',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: params.volume ?? 1,
    trackIndex: trackIdx,
    asset: sfxAsset,
    importedName: `SFX: ${sfxName}`,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
  }

  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: [...timeline.clips, sfxClip],
  }))
}


/* =========================================================================
 * Text Preset & Animation Actions & addTextClip
 * ========================================================================= */


export function freezeFrame(state: EditorState, params: FreezeFrameParams): EditorState {
  const timeline = selectActiveTimeline(state)
  const targetClip = timeline?.clips.find(c => c.id === params.clipId)
  if (!targetClip) return state

  const atTime = params.time ?? selectCurrentTime(state)
  const freezeDuration = params.duration ?? 2.0
  const splitPoint = atTime - targetClip.startTime

  if (splitPoint <= 0.05 || splitPoint >= targetClip.duration - 0.05) {
    return state
  }

  let next = state
  const imageAsset = params.imageAsset ?? {
    id: makeId('asset-freeze'),
    type: 'image' as const,
    path: `freeze_${targetClip.id}.jpg`,
    prompt: 'Freeze Frame',
    resolution: targetClip.asset?.resolution || '1920x1080',
    duration: freezeDuration,
    createdAt: Date.now(),
  }

  next = addAssetToEditor(next, imageAsset)

  const secondHalfId = makeId('clip')
  const freezeClipId = makeId('clip-freeze')

  const firstHalf: TimelineClip = {
    ...targetClip,
    duration: splitPoint,
    trimEnd: targetClip.trimEnd + mediaSecondsForTimelineSeconds(targetClip.duration - splitPoint, targetClip.speed),
  }

  const freezeClip: TimelineClip = {
    id: freezeClipId,
    assetId: imageAsset.id,
    type: 'image',
    startTime: targetClip.startTime + splitPoint,
    duration: freezeDuration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex: targetClip.trackIndex,
    asset: imageAsset,
    flipH: targetClip.flipH,
    flipV: targetClip.flipV,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...(targetClip.colorCorrection || DEFAULT_COLOR_CORRECTION) },
    transform: { ...(targetClip.transform || DEFAULT_CLIP_TRANSFORM) },
    opacity: targetClip.opacity ?? 100,
    filter: targetClip.filter ? { ...targetClip.filter } : undefined,
  }

  const secondHalf: TimelineClip = {
    ...targetClip,
    id: secondHalfId,
    startTime: targetClip.startTime + splitPoint + freezeDuration,
    duration: targetClip.duration - splitPoint,
    trimStart: targetClip.trimStart + mediaSecondsForTimelineSeconds(splitPoint, targetClip.speed),
  }

  const rippleDelta = freezeDuration
  const otherClips = timeline!.clips.filter(c => c.id !== targetClip.id).map(c => {
    if (c.trackIndex === targetClip.trackIndex && c.startTime >= targetClip.startTime + splitPoint) {
      return { ...c, startTime: c.startTime + rippleDelta }
    }
    return c
  })

  return replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [...otherClips, firstHalf, freezeClip, secondHalf],
  }))
}

export function punchInClip(
  state: EditorState,
  clipId: string,
  options?: { scale?: number; positionX?: number; positionY?: number },
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const scale = options?.scale ?? 120
  return setClipTransform(state, clipId, {
    scale,
    ...(options?.positionX !== undefined ? { positionX: options.positionX } : {}),
    ...(options?.positionY !== undefined ? { positionY: options.positionY } : {}),
  })
}

export function punchInSequence(
  state: EditorState,
  options?: {
    trackIndex?: number
    scale?: number
    startWithZoom?: boolean
  },
): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return state

  const trackIndex = options?.trackIndex ?? 0
  const targetScale = options?.scale ?? 120
  let isZoomed = options?.startWithZoom ?? false

  const sortedClips = [...timeline.clips]
    .filter(c => c.trackIndex === trackIndex && (c.type === 'video' || c.type === 'image'))
    .sort((a, b) => a.startTime - b.startTime)

  let next = state
  for (const clip of sortedClips) {
    const scale = isZoomed ? targetScale : 100
    next = setClipTransform(next, clip.id, { scale })
    isZoomed = !isZoomed
  }

  return next
}

export interface CreateHighlightShortParams {
  sourceClipId: string
  startTime: number
  endTime: number
  hookText?: string
  hookPreset?: string
  hookDuration?: number
  targetDimensions?: { width: number; height: number }
}

export function createHighlightShort(
  state: EditorState,
  params: CreateHighlightShortParams,
): EditorState {
  const timeline = selectActiveTimeline(state)
  const sourceClip = timeline?.clips.find(c => c.id === params.sourceClipId)
  if (!timeline || !sourceClip) return state

  const clipStart = sourceClip.startTime
  const trimStart = sourceClip.trimStart + mediaSecondsForTimelineSeconds(params.startTime - clipStart, sourceClip.speed)
  const duration = params.endTime - params.startTime
  const dims = params.targetDimensions || { width: 1080, height: 1920 }

  let next = state
  next = setTimelineSettings(next, timeline.id, {
    width: dims.width,
    height: dims.height,
  })

  const shortVideoClip: TimelineClip = {
    ...sourceClip,
    id: makeId('clip-short'),
    startTime: 0,
    duration,
    trimStart,
    trimEnd: sourceClip.trimEnd,
    trackIndex: 0,
  }

  const hookDuration = params.hookDuration ?? 3.0
  const hookText = params.hookText || 'Viral Hook!'
  const hookPreset = params.hookPreset || 'headline-alert'

  next = replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [shortVideoClip],
  }))

  next = addTextClip(next, {
    startTime: 0,
    duration: hookDuration,
    trackIndex: 1,
    preset: hookPreset,
    style: { text: hookText },
  })

  return next
}

/* =========================================================================
 * UI & Project Settings Actions
 * ========================================================================= */


export function applyTemplateAsTimeline(
  state: EditorState,
  params: {
    template: KomfyTemplate
    bindings: ReadonlyArray<{ slotIndex: number; assetId: string }>
    name?: string
    variantTag?: string
  },
): EditorState {
  const assets = state.editorModel.assets
  const resolved: TemplateBinding[] = []
  for (const binding of params.bindings) {
    const asset = assets.find(candidate => candidate.id === binding.assetId)
    // A binding naming an asset this project does not have leaves its slot
    // empty rather than failing the whole apply: the rest of the edit is still
    // worth having, and the gap is visible on the timeline.
    if (asset) resolved.push({ slotIndex: binding.slotIndex, asset })
  }

  const applied = applyTemplate(params.template, resolved, {
    name: params.name ?? params.template.name,
    variantTag: params.variantTag ?? 'template',
  })

  const next = markEditorModelDirty({
    ...state,
    editorModel: {
      ...state.editorModel,
      timelines: [...state.editorModel.timelines, applied.timeline],
    },
  })

  return switchActiveTimeline(next, applied.timeline.id)
}

/**
 * The track B-roll goes on: its own, and only its own.
 *
 * Every attempt to reuse "some track above the footage" ended up somewhere
 * wrong. Index 0 is the subtitle track in any captioned project, and a video
 * clip parked among the captions is drawn by nothing — the insert reported
 * success and the picture never changed. The footage's own track is worse
 * still: the cutaway lands on the very thing it was meant to cut away from.
 *
 * So B-roll gets a dedicated track, created once and reused after that.
 * Everything it holds is then visible, movable and deletable as a group, and
 * nothing it does can disturb the captions or the footage.
 */
function resolveBrollTrack(state: EditorState): { state: EditorState; trackIndex: number } {
  const tracks = selectTracks(state)
  const existing = tracks.findIndex(
    track => track.name === BROLL_TRACK_NAME && track.kind === 'video' && track.type !== 'subtitle',
  )
  if (existing >= 0 && !tracks[existing].locked) {
    return { state, trackIndex: existing }
  }

  const next = replaceActiveTimeline(state, timeline => ({
    ...timeline,
    tracks: [...timeline.tracks, {
      id: makeId('track-broll'),
      name: BROLL_TRACK_NAME,
      muted: false,
      locked: false,
      kind: 'video' as const,
    }],
  }))
  return { state: next, trackIndex: selectTracks(next).length - 1 }
}

export function insertBrollClip(state: EditorState, params: InsertBrollParams): EditorState {
  let next = state
  let trackIdx = params.trackIndex
  if (trackIdx === undefined) {
    const resolved = resolveBrollTrack(next)
    next = resolved.state
    trackIdx = resolved.trackIndex
  }

  // Resolve or create asset
  let asset = params.assetId ? next.editorModel.assets.find(a => a.id === params.assetId) : undefined
  if (!asset && params.assetPath) {
    asset = next.editorModel.assets.find(a => a.path === params.assetPath)
    if (!asset) {
      const isImg = /\.(png|jpe?g|webp|gif)$/i.test(params.assetPath)
      const newAsset: Asset = {
        id: params.assetId || makeId('asset-broll'),
        type: isImg ? 'image' : 'video',
        path: params.assetPath,
        prompt: 'B-roll Footage',
        resolution: '1920x1080',
        duration: params.duration,
        createdAt: Date.now(),
      }
      next = updateEditorModel(next, model => ({
        ...model,
        assets: [newAsset, ...model.assets],
      }))
      asset = newAsset
    }
  }

  const fadeInDuration = params.fadeIn ?? 0.25
  const fadeOutDuration = params.fadeOut ?? 0.25
  const muteAudio = params.muteAudio ?? true

  const brollClip: TimelineClip = {
    id: makeId('clip-broll'),
    assetId: asset?.id ?? params.assetId ?? null,
    type: asset?.type ?? 'video',
    startTime: params.startTime,
    duration: params.duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: muteAudio,
    volume: muteAudio ? 0 : 1,
    trackIndex: trackIdx,
    asset: asset ?? null,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'dissolve', duration: fadeInDuration },
    transitionOut: { type: 'dissolve', duration: fadeOutDuration },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
  }

  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: [...timeline.clips, brollClip],
  }))
}

/** Dismisses the notice about the last refused edit. */
