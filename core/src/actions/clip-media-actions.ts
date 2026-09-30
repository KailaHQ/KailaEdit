import type {
  TimelineClip,
  Asset,
  ShapeProperties,
} from '../project-model'
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectClips,
  selectTracks,
  selectCurrentTime,
  selectAssets,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import {
  getStickerDefinition,
  resolveStickerRelativePath,
  DEFAULT_STICKER_DURATION,
  DEFAULT_STICKER_SCALE,
  DEFAULT_STICKER_PIXELS,
} from '../stickers'
import { getSfxDefinition, resolveSfxRelativePath } from '../sfx'
import { BROLL_TRACK_NAME } from '../broll-copilot'
import { getEffectiveTimelineDimensions } from '../video-resolution'
import type { InsertBrollParams } from './types'
import { updateEditorModel } from './action-helpers'
import { replaceActiveTimeline } from './timeline-actions'
import { addTrack } from './track-actions'

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
 */
function defaultStickerScale(state: EditorState): number {
  const timeline = selectActiveTimeline(state)
  const dimensions = getEffectiveTimelineDimensions(timeline, selectAssets(state))
  const shortEdge = Math.min(dimensions.width, dimensions.height)
  if (!shortEdge || !Number.isFinite(shortEdge)) return DEFAULT_STICKER_SCALE
  return Math.max(2, Math.min(80, (DEFAULT_STICKER_PIXELS / shortEdge) * 100))
}

export function addStickerClip(state: EditorState, params: AddStickerClipParams): EditorState {
  let next = state
  const startTime = params.startTime ?? selectCurrentTime(next)
  const duration = params.duration ?? DEFAULT_STICKER_DURATION
  let trackIdx = params.trackIndex

  if (trackIdx === undefined) {
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
    width: stickerWidth,
    height: stickerHeight,
    duration,
    createdAt: Date.now(),
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
