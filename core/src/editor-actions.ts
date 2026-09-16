import type { SetStateAction } from 'react'
import type { ParsedTimeline } from './timeline-import'
import type { SrtCue } from './srt'
import {
  toTranscriptSegments,
  upsertAssetTranscript,
  type TranscriptSegment,
} from './transcript-store'
import { BROLL_TRACK_NAME } from './broll-copilot'
import { applyTemplate, type TemplateBinding } from './template-apply'
import type { KomfyTemplate } from './template-model'
import type {
  Asset,
  AssetBins,
  ColorCorrection,
  LetterboxSettings,
  Project,
  SubtitleClip,
  SubtitleStyle,
  TextOverlayStyle,
  Timeline,
  TimelineClip,
  Track,
  TimelineMarker,
  ClipMask,
  ChromaKey,
  ClipBlendMode,
  ClipEffect,
  EffectType,
  TimelineBackground,
  KeyframeProperty,
  KeyframeEasing,
  KeyframePoint,
  KeyframeTrack,
  ClipTransform,
} from './project-model'
import {
  createAssetBinId,
  createDefaultTimeline,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_LETTERBOX,
  DEFAULT_TEXT_STYLE,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_MASK,
  DEFAULT_CHROMA_KEY,
  MAX_CLIP_VOLUME,
} from './project-model'
import { validateTimeline, setLastTimelineValidationError } from './validator'
import { createTextClipWithPreset, applyTextPreset, applyTextAnimation } from './text-presets'
import { setTransitionAtCut, removeTransitionById, pruneOrphanTransitions } from './timeline-transitions'
import { makeId } from './id-generator'
import { applyDuckingKeyframes } from './audio-ducking'
import { getFilterDefinition } from './filters'
import {
  getStickerDefinition,
  resolveStickerRelativePath,
  DEFAULT_STICKER_DURATION,
  DEFAULT_STICKER_SCALE,
  DEFAULT_STICKER_PIXELS,
} from './stickers'
import { getSfxDefinition, resolveSfxRelativePath } from './sfx'
import { resolveOverlaps, packMainVideoTrack, mainVideoTrackIndex, pruneEmptyTracks, type EditorLayout, type ToolType } from './video-editor-utils'
import {
  applyUndoSnapshot,
  createInitialEditorState,
  equalUndoSnapshot,
  getUndoSnapshot,
  type EditorModel,
  type EditorState,
  type TimelineGapSelection,
  type KeyframeSelection,
} from './editor-state'
import {
  getActiveTimelineFromEditorModel,
  selectActiveTimeline,
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectActiveTimelineId,
  selectAssetById,
  selectAssets,
  selectCanUseClipboard,
  selectClipById,
  selectClips,
  selectContentDuration,
  selectCurrentTime,
  selectSelectedClipIds,
  selectTracks,
} from './editor-selectors'
import { getEditorModel, updatedProject } from './editor-project-bridging'
import { getEffectiveTimelineDimensions } from './video-resolution'
import { clampClipSpeed, mediaSecondsForTimelineSeconds } from './clip-speed'


export interface InsertAssetsToTimelineParams {
  assets: Asset[]
  trackIndex?: number
  startTime?: number
  /**
   * Where to drop the assets when no `startTime` is given.
   *
   * 'end' (the default) appends after whatever is already on the track, and
   * is what the MCP `insert_clip` operation relies on. 'start' puts them in
   * front of the existing edit and is what the Add button in the asset panel
   * asks for; it only applies to the magnetic main video track, because on
   * any other track resolveOverlaps would trim what it lands on rather than
   * push it aside.
   */
  position?: 'start' | 'end'
}

export interface AddTextClipParams {
  style?: Partial<TextOverlayStyle>
  startTime?: number
  trackIndex?: number
  duration?: number
  preset?: string
  animation?: string
}

export interface AddAdjustmentLayerParams {
  duration?: number
  trackIndex?: number
  startTime?: number
}

export interface MoveClipsParams {
  clipIds: string[]
  deltaTime?: number
  targetTrackIndex?: number
}

export interface ResizeClipParams {
  clipId: string
  edge: 'start' | 'end'
  deltaTime: number
}

export interface SlipClipParams {
  clipId: string
  deltaTime: number
}

export interface SlideClipParams {
  clipId: string
  deltaTime: number
}

export interface AddSubtitleParams {
  trackIndex: number
  text?: string
  startTime?: number
  endTime?: number
  style?: Partial<SubtitleStyle>
}

export interface InsertGeneratedGapAssetParams {
  gap: TimelineGapSelection
  asset: Asset
  createAudio: boolean
}

export interface SourceEditParams {
  asset: Asset
  sourceIn: number | null
  sourceOut: number | null
  sourceTime: number
}

export interface SelectClipMode {
  mode?: 'replace' | 'toggle' | 'add'
}


function deleteBinEntry(bins: AssetBins, binId: string): AssetBins {
  const { [binId]: _removed, ...rest } = bins
  return rest
}

function markEditorModelDirty(state: EditorState): EditorState {
  if (state.projectSync.dirty) return state
  return {
    ...state,
    projectSync: {
      ...state.projectSync,
      dirty: true,
    },
  }
}

function cloneClipIds(ids: Set<string>): Set<string> {
  return new Set(ids)
}

export function applyStateAction<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === 'function'
    ? (value as (prevState: T) => T)(current)
    : value
}

function updateEditorModel(state: EditorState, updater: (editorModel: EditorModel) => EditorModel): EditorState {
  const nextEditorModel = updater(state.editorModel)
  if (nextEditorModel === state.editorModel) return state
  return markEditorModelDirty({
    ...state,
    editorModel: nextEditorModel,
  })
}

function updateSession(state: EditorState, updater: (session: EditorState['session']) => EditorState['session']): EditorState {
  const nextSession = updater(state.session)
  if (nextSession === state.session) return state
  return {
    ...state,
    session: nextSession,
  }
}

function withActiveTimeline(editorModel: EditorModel, updater: (timeline: Timeline) => Timeline): EditorModel {
  const activeTimeline = getActiveTimelineFromEditorModel(editorModel)
  if (!activeTimeline) return editorModel
  return {
    ...editorModel,
    timelines: editorModel.timelines.map(timeline => (
      timeline.id === activeTimeline.id ? updater(timeline) : timeline
    )),
  }
}

function activeTrackStartTime(state: EditorState, trackIndex: number): number {
  return selectClips(state)
    .filter(clip => clip.trackIndex === trackIndex)
    .reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
}

function createTimelineClipFromAsset(asset: Asset, trackIndex: number, startTime: number): TimelineClip {
  return {
    id: makeId('clip'),
    assetId: asset.id,
    type: asset.type === 'adjustment' ? 'adjustment' : asset.type,
    startTime,
    duration: asset.duration || (asset.type === 'adjustment' ? 10 : 5),
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex,
    asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
  }
}

type DroppedAssetInsertion = {
  tracks: Track[]
  clips: TimelineClip[]
  duration: number
}

function buildDroppedVisualClipInsertion(
  asset: Asset,
  trackIndex: number,
  startTime: number,
  tracks: Track[],
): DroppedAssetInsertion {
  let nextTracks = tracks
  let visualTrackIndex = trackIndex
  let track = nextTracks[visualTrackIndex]

  if (!track || track.locked || track.kind !== 'video') {
    visualTrackIndex = nextTracks.findIndex(t => t.kind === 'video' && !t.locked)
    if (visualTrackIndex < 0) {
      const videoTrackCount = nextTracks.filter(candidate => candidate.kind === 'video').length
      nextTracks = [
        ...nextTracks,
        {
          id: makeId('track-video'),
          name: `V${videoTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'video',
        },
      ]
      visualTrackIndex = nextTracks.length - 1
    }
  }

  track = nextTracks[visualTrackIndex]
  const trackPatched = track.sourcePatched !== false
  const isAdjustment = asset.type === 'adjustment'
  const isVideoAsset = asset.type === 'video'
  const isImageAsset = asset.type === 'image'

  const createVisualClip = (isVideoAsset || isImageAsset || isAdjustment) && trackPatched
  // A video keeps its sound inside the video clip.
  // The preview and the exporter both already read audio straight off a video
  // clip that has no linked audio clip (isAudioSourceClip in
  // usePlaybackAudioSync, and the hasLinkedAudioClip guard in
  // electron/export/audio-mix.ts), so nothing downstream changes. Splitting
  // stays available on demand through Extract audio / MCP `detach_audio`.
  const needsLinkedAudioClip = false
  let audioTrackIndex = -1

  if (needsLinkedAudioClip) {
    audioTrackIndex = nextTracks.findIndex(
      (candidate, index) =>
        index > visualTrackIndex &&
        candidate.kind === 'audio' &&
        !candidate.locked &&
        candidate.sourcePatched !== false,
    )
    if (audioTrackIndex < 0) {
      audioTrackIndex = nextTracks.findIndex(
        candidate => candidate.kind === 'audio' && !candidate.locked && candidate.sourcePatched !== false,
      )
    }
    if (audioTrackIndex < 0) {
      const audioTrackCount = nextTracks.filter(candidate => candidate.kind === 'audio').length
      nextTracks = [
        ...nextTracks,
        {
          id: makeId('track-audio'),
          name: `A${audioTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'audio',
        },
      ]
      audioTrackIndex = nextTracks.length - 1
    }
  }

  const createAudioClip = needsLinkedAudioClip && audioTrackIndex >= 0
  if (!createVisualClip && !createAudioClip) {
    return { tracks: nextTracks, clips: [], duration: 0 }
  }

  const duration = asset.duration || (isAdjustment ? 10 : 5)
  const visualClipId = makeId('clip')
  const audioClipId = makeId('clip-audio')
  const clips: TimelineClip[] = []

  if (createVisualClip) {
    clips.push({
      id: visualClipId,
      assetId: asset.id,
      type: isAdjustment ? 'adjustment' : isVideoAsset ? 'video' : 'image',
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: visualTrackIndex,
      asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
      transitionOut: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      ...(isAdjustment ? { letterbox: { ...DEFAULT_LETTERBOX } } : {}),
      ...(createAudioClip ? { linkedClipIds: [audioClipId] } : {}),
    })
  }

  if (createAudioClip && audioTrackIndex >= 0) {
    clips.push({
      id: audioClipId,
      assetId: asset.id,
      type: 'audio',
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: audioTrackIndex,
      asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      ...(createVisualClip ? { linkedClipIds: [visualClipId] } : {}),
    })
  }

  return {
    tracks: nextTracks,
    clips,
    duration,
  }
}

function buildDroppedAudioClipInsertion(
  asset: Asset,
  trackIndex: number,
  startTime: number,
  tracks: Track[],
  existingClips: TimelineClip[] = [],
): DroppedAssetInsertion {
  let nextTracks = tracks
  let audioTrackIndex = -1
  const track = nextTracks[trackIndex]
  const duration = asset.duration || 5
  const endTime = startTime + duration

  if (track && track.kind === 'audio' && !track.locked) {
    audioTrackIndex = trackIndex
  } else {
    // Find unlocked, sourcePatched audio tracks
    const audioTrackEntries = nextTracks
      .map((candidate, idx) => ({ track: candidate, idx }))
      .filter(entry => entry.track.kind === 'audio' && !entry.track.locked && entry.track.sourcePatched !== false)

    // Check each audio track from top to bottom (A1, A2, A3...) for collision
    for (const entry of audioTrackEntries) {
      const hasOverlap = existingClips.some(
        c => c.trackIndex === entry.idx && c.startTime < endTime && (c.startTime + c.duration) > startTime,
      )
      if (!hasOverlap) {
        audioTrackIndex = entry.idx
        break
      }
    }

    // If all existing audio tracks are occupied at this time range, create a new audio track at the bottom
    if (audioTrackIndex < 0) {
      const audioTrackCount = nextTracks.filter(candidate => candidate.kind === 'audio').length
      nextTracks = [
        ...nextTracks,
        {
          id: makeId('track-audio'),
          name: `A${audioTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'audio',
        },
      ]
      audioTrackIndex = nextTracks.length - 1
    }
  }

  if (audioTrackIndex < 0) {
    return { tracks: nextTracks, clips: [], duration: 0 }
  }

  return {
    tracks: nextTracks,
    clips: [{
      id: makeId('clip-audio'),
      assetId: asset.id,
      type: 'audio',
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: audioTrackIndex,
      asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
    }],
    duration,
  }
}

function buildDroppedAssetInsertion(
  asset: Asset,
  trackIndex: number,
  startTime: number,
  tracks: Track[],
  existingClips: TimelineClip[] = [],
): DroppedAssetInsertion {
  if (asset.type === 'audio') {
    return buildDroppedAudioClipInsertion(asset, trackIndex, startTime, tracks, existingClips)
  }

  return buildDroppedVisualClipInsertion(asset, trackIndex, startTime, tracks)
}

function getNextAdjustmentLayerName(assets: Asset[]): string {
  const count = assets.filter(asset => asset.type === 'adjustment').length
  return count > 0 ? `Adjustment Layer ${count + 1}` : 'Adjustment Layer'
}

function createAdjustmentAsset(name = 'Adjustment Layer'): Asset {
  return {
    id: makeId('asset-adjustment'),
    type: 'adjustment',
    path: '',
    prompt: name,
    resolution: '',
    duration: 10,
    createdAt: Date.now(),
  }
}

function createAdjustmentClip(asset: Asset, startTime = 0, trackIndex = 0, duration = 10): TimelineClip {
  return {
    ...createTimelineClipFromAsset(asset, trackIndex, startTime),
    type: 'adjustment',
    duration,
    letterbox: { ...DEFAULT_LETTERBOX },
  }
}

function buildSourceRequestClips(state: EditorState, params: SourceEditParams): {
  newClips: TimelineClip[]
  insertDuration: number
  targetTrackIndices: number[]
  time: number
} | null {
  const { asset } = params
  const sourceIn = params.sourceIn ?? 0
  const sourceDuration = asset.duration || 5
  const sourceOut = params.sourceOut ?? sourceDuration
  const insertDuration = sourceOut - sourceIn
  if (insertDuration <= 0) return null

  const time = selectCurrentTime(state)
  const tracks = selectTracks(state)
  const isAudio = asset.type === 'audio'
  const videoTrack = !isAudio
    ? tracks.find(track => !track.locked && track.sourcePatched !== false && track.kind === 'video')
    : undefined
  const audioTrack = tracks.find(track => !track.locked && track.sourcePatched !== false && track.kind === 'audio')

  if (!videoTrack && !audioTrack) return null
  if (isAudio && !audioTrack) return null
  if (!isAudio && !videoTrack) return null

  const videoTrackIndex = videoTrack ? tracks.indexOf(videoTrack) : -1
  const audioTrackIndex = audioTrack ? tracks.indexOf(audioTrack) : -1
  const videoClipId = makeId('clip')
  const audioClipId = makeId('clip-audio')

  const baseClip = {
    assetId: asset.id,
    startTime: time,
    duration: insertDuration,
    trimStart: sourceIn,
    trimEnd: sourceDuration - sourceOut,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    asset,
    flipH: false as const,
    flipV: false as const,
    transitionIn: { type: 'none' as const, duration: 0.5 },
    transitionOut: { type: 'none' as const, duration: 0.5 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
  }

  const newClips: TimelineClip[] = []
  const targetTrackIndices: number[] = []

  if (isAudio) {
    newClips.push({
      ...baseClip,
      id: audioClipId,
      type: 'audio',
      trackIndex: audioTrackIndex,
    })
    targetTrackIndices.push(audioTrackIndex)
  } else {
    // Same rule as the drag-and-drop path above: no automatic audio split.
    const needsAudio = false
    newClips.push({
      ...baseClip,
      id: videoClipId,
      type: asset.type === 'video' ? 'video' : 'image',
      trackIndex: videoTrackIndex,
      ...(needsAudio ? { linkedClipIds: [audioClipId] } : {}),
    })
    targetTrackIndices.push(videoTrackIndex)
    if (needsAudio) {
      newClips.push({
        ...baseClip,
        id: audioClipId,
        type: 'audio',
        trackIndex: audioTrackIndex,
        linkedClipIds: [videoClipId],
      })
      targetTrackIndices.push(audioTrackIndex)
    }
  }

  return { newClips, insertDuration, targetTrackIndices, time }
}

export function replaceActiveTimeline(state: EditorState, updater: (timeline: Timeline) => Timeline): EditorState {
  const active = selectActiveTimeline(state)
  if (!active) return state
  const updated = updater(active)
  if (!state.transaction) {
    const validation = validateTimeline(updated, active)
    if (!validation.valid) {
      setLastTimelineValidationError(validation)
      // Refusing an edit is fine; refusing it in silence is not. The reason
      // rides back in session state so the editor can say what happened,
      // instead of the control appearing to be broken.
      const first = validation.errors[0]
      return updateSession(state, session => ({
        ...session,
        ui: {
          ...session.ui,
          lastRejectedEdit: first
            ? { rule: first.rule, message: first.message }
            : { rule: 'UNKNOWN', message: 'The timeline refused this change.' },
        },
      }))
    }
  }
  const committed = updateEditorModel(state, editorModel => withActiveTimeline(editorModel, () => updated))
  // A successful edit clears any complaint left over from the last one.
  const withClearedRejected = state.session.ui.lastRejectedEdit === null
    ? committed
    : updateSession(committed, session => ({ ...session, ui: { ...session.ui, lastRejectedEdit: null } }))

  // If the timeline content duration shrank and currentTime is beyond the new end of the video,
  // clamp currentTime to the new end so the playhead never hangs out in empty void.
  const contentDuration = selectContentDuration(withClearedRejected)
  if (withClearedRejected.session.transport.currentTime > contentDuration) {
    return setCurrentTime(withClearedRejected, contentDuration)
  }

  return withClearedRejected
}

function mapClips(state: EditorState, mapper: (clip: TimelineClip) => TimelineClip): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips.map(mapper),
  }))
}

function mapTracks(state: EditorState, mapper: (track: Track, index: number) => Track): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    tracks: timeline.tracks.map(mapper),
  }))
}

export function loadEditorDocument(state: EditorState, snapshot: EditorModel): EditorState {
  return markEditorModelDirty({
    ...state,
    editorModel: snapshot,
  })
}

export function replaceActiveTimelineDocument(
  state: EditorState,
  snapshot: Partial<Pick<Timeline, 'tracks' | 'clips' | 'subtitles'>>,
): EditorState {
  return replaceActiveTimeline(state, timeline => pruneOrphanTransitions({
    ...timeline,
    ...snapshot,
  }))
}

export function setTimelineClips(state: EditorState, value: SetStateAction<TimelineClip[]>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: applyStateAction(value, timeline.clips),
  }))
}

export function setTimelineTracks(state: EditorState, value: SetStateAction<Track[]>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    tracks: applyStateAction(value, timeline.tracks),
  }))
}

export function setTimelineSubtitles(state: EditorState, value: SetStateAction<SubtitleClip[]>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    subtitles: applyStateAction(value, timeline.subtitles || []),
  }))
}

export function commitEditorDocument(state: EditorState): EditorState {
  return state
}

export function switchActiveTimeline(state: EditorState, timelineId: string | null): EditorState {
  return {
    ...markEditorModelDirty({
      ...state,
      editorModel: {
        ...state.editorModel,
        activeTimelineId: timelineId,
      },
    }),
    session: {
      ...state.session,
      selection: {
        ...state.session.selection,
        clipIds: new Set(),
        subtitleId: null,
      },
      transport: {
        ...state.session.transport,
        currentTime: 0,
        isPlaying: false,
        playingInOut: false,
      },
      ui: {
        ...state.session.ui,
        openTimelineIds: timelineId
          ? new Set([...state.session.ui.openTimelineIds, timelineId])
          : new Set(state.session.ui.openTimelineIds),
      },
    },
  }
}

export function createTimeline(state: EditorState, name?: string): EditorState {
  const timeline = createDefaultTimeline(name)
  return {
    ...updateEditorModel(state, editorModel => ({
      ...editorModel,
      timelines: [...editorModel.timelines, timeline],
      activeTimelineId: timeline.id,
    })),
    session: {
      ...state.session,
      ui: {
        ...state.session.ui,
        openTimelineIds: new Set([...state.session.ui.openTimelineIds, timeline.id]),
      },
      selection: {
        ...state.session.selection,
        clipIds: new Set(),
        subtitleId: null,
      },
      transport: {
        ...state.session.transport,
        currentTime: 0,
        isPlaying: false,
        playingInOut: false,
      },
    },
  }
}

export function duplicateTimeline(
  state: EditorState,
  timelineId: string,
  name?: string,
  variantTag?: string,
): EditorState {
  const source = state.editorModel.timelines.find(timeline => timeline.id === timelineId)
  if (!source) return state

  // Create ID mapping for clips to preserve linked clips and transitions
  const clipIdMap = new Map<string, string>()
  for (const clip of source.clips) {
    clipIdMap.set(clip.id, makeId('clip'))
  }

  const newClips: TimelineClip[] = source.clips.map(clip => {
    const newId = clipIdMap.get(clip.id) || makeId('clip')
    const remappedLinkedIds = clip.linkedClipIds
      ? clip.linkedClipIds.map(oldId => clipIdMap.get(oldId) || oldId)
      : undefined

    return {
      ...clip,
      id: newId,
      linkedClipIds: remappedLinkedIds,
    }
  })

  // Remap transitions if present
  const newTransitions = source.transitions?.map(tr => ({
    ...tr,
    id: makeId('tr'),
    leftClipId: clipIdMap.get(tr.leftClipId) || tr.leftClipId,
    rightClipId: clipIdMap.get(tr.rightClipId) || tr.rightClipId,
  }))

  const duplicate: Timeline = {
    ...source,
    id: makeId('timeline'),
    name: name?.trim() || `${source.name} Copy`,
    variantTag: variantTag?.trim() || source.variantTag,
    createdAt: Date.now(),
    tracks: source.tracks.map(track => ({ ...track })),
    clips: newClips,
    subtitles: source.subtitles?.map(subtitle => ({ ...subtitle, id: makeId('sub') })),
    transitions: newTransitions,
    markers: source.markers?.map(m => ({ ...m, id: makeId('marker') })),
  }

  return {
    ...updateEditorModel(state, editorModel => ({
      ...editorModel,
      timelines: [...editorModel.timelines, duplicate],
      activeTimelineId: duplicate.id,
    })),
    session: {
      ...state.session,
      ui: {
        ...state.session.ui,
        openTimelineIds: new Set([...state.session.ui.openTimelineIds, duplicate.id]),
      },
      selection: {
        ...state.session.selection,
        clipIds: new Set(),
        subtitleId: null,
      },
      transport: {
        ...state.session.transport,
        currentTime: 0,
        isPlaying: false,
        playingInOut: false,
      },
    },
  }
}

export function setTimelineVariantInfo(
  state: EditorState,
  timelineId: string,
  info: { name?: string; variantTag?: string; description?: string },
): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    timelines: editorModel.timelines.map(timeline => {
      if (timeline.id !== timelineId) return timeline
      return {
        ...timeline,
        ...(info.name !== undefined ? { name: info.name } : {}),
        ...(info.variantTag !== undefined ? { variantTag: info.variantTag } : {}),
        ...(info.description !== undefined ? { description: info.description } : {}),
      }
    }),
  }))
}

export function renameTimeline(state: EditorState, timelineId: string, name: string): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    timelines: editorModel.timelines.map(timeline => (
      timeline.id === timelineId ? { ...timeline, name } : timeline
    )),
  }))
}

export function deleteTimeline(state: EditorState, timelineId: string): EditorState {
  const nextTimelines = state.editorModel.timelines.filter(timeline => timeline.id !== timelineId)
  const nextActiveTimelineId = state.editorModel.activeTimelineId === timelineId
    ? nextTimelines[0]?.id ?? null
    : state.editorModel.activeTimelineId

  return {
    ...markEditorModelDirty({
      ...state,
      editorModel: {
        ...state.editorModel,
        timelines: nextTimelines,
        activeTimelineId: nextActiveTimelineId,
      },
    }),
    session: {
      ...state.session,
      ui: {
        ...state.session.ui,
        openTimelineIds: new Set([...state.session.ui.openTimelineIds].filter(id => nextTimelines.some(timeline => timeline.id === id))),
      },
    },
  }
}

export function importParsedTimeline(state: EditorState, parsed: ParsedTimeline): EditorState {
  const importedBinId = Object.entries(state.editorModel.bins).find(([, name]) => name === 'Imported')?.[0]
    ?? createAssetBinId()
  const importedAssets: Asset[] = parsed.mediaRefs.map(ref => ({
    id: makeId('asset'),
    type: ref.type,
    path: ref.path,
    bigThumbnailPath: ref.bigThumbnailPath,
    smallThumbnailPath: ref.smallThumbnailPath,
    width: ref.width,
    height: ref.height,
    prompt: ref.name || ref.path.split(/[/\\]/).pop() || 'Imported media',
    resolution: ref.width && ref.height ? `${ref.width}x${ref.height}` : 'Unknown',
    duration: ref.duration || undefined,
    binId: importedBinId,
    createdAt: Date.now(),
  }))

  const assetByParsedId = new Map<string, Asset>()
  parsed.mediaRefs.forEach((ref, index) => {
    assetByParsedId.set(ref.id, importedAssets[index])
  })

  const totalTracks = Math.max(parsed.videoTrackCount + parsed.audioTrackCount, 1)
  const tracks: Track[] = []
  for (let index = 0; index < totalTracks; index++) {
    const isAudio = index >= parsed.videoTrackCount
    tracks.push({
      id: makeId('track'),
      name: isAudio ? `A${index - parsed.videoTrackCount + 1}` : `V${index + 1}`,
      muted: false,
      locked: false,
      kind: isAudio ? 'audio' : 'video',
    })
  }

  const clips: TimelineClip[] = []
  const parsedIndexToClipId = new Map<number, string>()
  for (let parsedIndex = 0; parsedIndex < parsed.clips.length; parsedIndex++) {
    const parsedClip = parsed.clips[parsedIndex]
    const asset = assetByParsedId.get(parsedClip.mediaRefId)
    if (!asset) continue

    const clipId = makeId('clip')
    parsedIndexToClipId.set(parsedIndex, clipId)
    clips.push({
      id: clipId,
      assetId: asset.id,
      type: parsedClip.trackType === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video',
      startTime: parsedClip.startTime,
      duration: parsedClip.duration,
      trimStart: parsedClip.sourceIn || 0,
      trimEnd: 0,
      speed: parsedClip.speed || 1,
      reversed: parsedClip.reversed || false,
      muted: parsedClip.muted || false,
      volume: parsedClip.volume !== undefined ? Math.min(1, Math.max(0, parsedClip.volume)) : 1,
      trackIndex: Math.min(parsedClip.trackIndex, totalTracks - 1),
      asset,
      importedName: parsedClip.name,
      flipH: parsedClip.flipH || false,
      flipV: parsedClip.flipV || false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: parsedClip.opacity !== undefined ? parsedClip.opacity : 100,
    })
  }

  for (let parsedIndex = 0; parsedIndex < parsed.clips.length; parsedIndex++) {
    const parsedClip = parsed.clips[parsedIndex]
    if (parsedClip.linkedVideoClipIndex === undefined) continue
    const audioClipId = parsedIndexToClipId.get(parsedIndex)
    const videoClipId = parsedIndexToClipId.get(parsedClip.linkedVideoClipIndex)
    if (!audioClipId || !videoClipId) continue
    const audioClip = clips.find(clip => clip.id === audioClipId)
    const videoClip = clips.find(clip => clip.id === videoClipId)
    if (!audioClip || !videoClip) continue
    if (!audioClip.linkedClipIds) audioClip.linkedClipIds = []
    if (!audioClip.linkedClipIds.includes(videoClipId)) audioClip.linkedClipIds.push(videoClipId)
    if (!videoClip.linkedClipIds) videoClip.linkedClipIds = []
    if (!videoClip.linkedClipIds.includes(audioClipId)) videoClip.linkedClipIds.push(audioClipId)
  }

  const timeline: Timeline = {
    id: makeId('timeline'),
    name: parsed.name || 'Imported Timeline',
    createdAt: Date.now(),
    tracks,
    clips,
    subtitles: [],
  }

  return {
    ...updateEditorModel(state, editorModel => ({
      ...editorModel,
      bins: {
        ...editorModel.bins,
        [importedBinId]: 'Imported',
      },
      assets: [...importedAssets, ...editorModel.assets],
      timelines: [...editorModel.timelines, timeline],
      activeTimelineId: timeline.id,
    })),
    session: {
      ...state.session,
      selection: {
        ...state.session.selection,
        clipIds: new Set(),
        subtitleId: null,
      },
      transport: {
        ...state.session.transport,
        currentTime: 0,
        isPlaying: false,
        playingInOut: false,
      },
      ui: {
        ...state.session.ui,
        openTimelineIds: new Set([...state.session.ui.openTimelineIds, timeline.id]),
      },
    },
  }
}

export function insertAssetsToTimeline(state: EditorState, params: InsertAssetsToTimelineParams): EditorState {
  const trackIndex = params.trackIndex ?? 0
  const activeTimeline = selectActiveTimeline(state)
  if (!activeTimeline) return state

  // position: 'start' puts the assets in front of what is already on the main
  // video track. V1 is the magnetic track: resolveOverlaps
  // pushes the clips it displaces to the right instead of trimming them, and
  // packMainVideoTrack closes the gap afterwards, so the existing edit survives
  // intact and simply starts later.
  //
  // Only for V1, and only when no explicit time was given. On any other track
  // resolveOverlaps trims and splits whatever it lands on, so prepending there
  // would destroy clips; drag-and-drop always passes its own startTime anyway.
  const mainTrackIndex = mainVideoTrackIndex(activeTimeline.tracks)
  const prependToMainTrack = params.position === 'start'
    && params.startTime === undefined
    && mainTrackIndex >= 0
    && trackIndex === mainTrackIndex
  const startCursor = params.startTime ?? (prependToMainTrack ? 0 : activeTrackStartTime(state, trackIndex))
  let cursor = startCursor
  let nextTracks = activeTimeline.tracks
  const insertedClips: TimelineClip[] = []

  for (const asset of params.assets) {
    const isAudioCascade = asset.type === 'audio' && !(nextTracks[trackIndex]?.kind === 'audio')
    const itemStartTime = isAudioCascade ? startCursor : cursor
    const insertion = buildDroppedAssetInsertion(asset, trackIndex, itemStartTime, nextTracks, [...activeTimeline.clips, ...insertedClips])
    nextTracks = insertion.tracks
    insertedClips.push(...insertion.clips)
    if (!isAudioCascade) {
      cursor += insertion.duration
    }
  }

  if (insertedClips.length === 0 && nextTracks === activeTimeline.tracks) {
    return state
  }

  const insertedIds = new Set(insertedClips.map(clip => clip.id))
  const insertedSpan = cursor - startCursor

  // Make room first rather than letting resolveOverlaps do it. That function
  // DELETES any clip the inserted range fully covers (the `cStart >= movedStart
  // && cEnd <= movedEnd` branch), which it checks before the magnetic-track
  // guard — so prepending a 12s asset in front of a 10s clip erased the 10s
  // clip and looked like the new asset had replaced it. Shifting by hand is
  // also exact: every displaced clip moves by the same amount, so relative
  // timing and any transitions between them survive.
  const shiftForPrepend = (clips: TimelineClip[]): TimelineClip[] => {
    if (!prependToMainTrack || insertedSpan <= 0) return clips
    const displaced = new Set(
      clips.filter(clip => clip.trackIndex === mainTrackIndex).map(clip => clip.id))
    if (displaced.size === 0) return clips
    // Linked clips (a legacy detached audio track) ride along, or they would
    // drift out of sync with the picture they belong to.
    for (const clip of clips) {
      if (!displaced.has(clip.id)) continue
      for (const linkedId of clip.linkedClipIds ?? []) displaced.add(linkedId)
    }
    return clips.map(clip => displaced.has(clip.id)
      ? { ...clip, startTime: clip.startTime + insertedSpan }
      : clip)
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    tracks: nextTracks,
    clips: packMainVideoTrack(
      nextTracks,
      resolveOverlaps([...shiftForPrepend(timeline.clips), ...insertedClips], insertedIds),
      timeline.transitions,
    ),
  }))
}

export function overwriteAssetsOnTimeline(state: EditorState, params: InsertAssetsToTimelineParams): EditorState {
  const afterInsert = insertAssetsToTimeline(state, params)
  const activeTimeline = selectActiveTimeline(afterInsert)
  if (!activeTimeline) return afterInsert
  const insertedIds = new Set<string>(
    activeTimeline.clips
      .slice(-params.assets.length * 2)
      .map((clip: TimelineClip) => clip.id),
  )
  return replaceActiveTimeline(afterInsert, timeline => ({
    ...timeline,
    clips: resolveOverlaps(timeline.clips, insertedIds),
  }))
}

export function insertSourceEdit(state: EditorState, params: SourceEditParams): EditorState {
  const result = buildSourceRequestClips(state, params)
  if (!result) return state
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: [
      ...timeline.clips.map(clip => (
        result.targetTrackIndices.includes(clip.trackIndex) && clip.startTime >= result.time
          ? { ...clip, startTime: clip.startTime + result.insertDuration }
          : clip
      )),
      ...result.newClips,
    ],
  }))
}

export function overwriteSourceEdit(state: EditorState, params: SourceEditParams): EditorState {
  const result = buildSourceRequestClips(state, params)
  if (!result) return state
  const insertedIds = new Set(result.newClips.map(clip => clip.id))
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: resolveOverlaps([...timeline.clips, ...result.newClips], insertedIds),
  }))
}

export function addTextClip(state: EditorState, params: AddTextClipParams = {}): EditorState {
  let next = state
  let trackIdx = params.trackIndex
  if (trackIdx === undefined) {
    const tracks = selectTracks(next)
    const mainIdx = mainVideoTrackIndex(tracks)
    const overlayTrackIndices = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => (mainIdx >= 0 ? index !== mainIdx : index > 0) && track.kind === 'video' && track.type !== 'subtitle' && !track.locked)
      .map(({ index }) => index)
    if (overlayTrackIndices.length > 0) {
      trackIdx = overlayTrackIndices[overlayTrackIndices.length - 1]
    } else {
      next = addTrack(next, 'video')
      trackIdx = selectTracks(next).length - 1
    }
  }

  const startTime = params.startTime ?? selectCurrentTime(next)
  const duration = params.duration ?? 4.0
  const text = params.style?.text ?? 'Title Text'

  let textClip: TimelineClip
  if (params.preset || params.animation) {
    textClip = createTextClipWithPreset(
      params.preset || 'default',
      params.animation,
      text,
      startTime,
      trackIdx,
      duration,
    )
    if (params.style) {
      textClip = {
        ...textClip,
        textStyle: {
          ...DEFAULT_TEXT_STYLE,
          ...textClip.textStyle,
          ...params.style,
          text,
        },
      }
    }
  } else {
    textClip = {
      id: makeId('clip-text'),
      assetId: null,
      type: 'text',
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
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      textStyle: {
        ...DEFAULT_TEXT_STYLE,
        ...(params.style || {}),
        text,
      },
    }
  }

  next = replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: resolveOverlaps([...timeline.clips, textClip], new Set([textClip.id])),
  }))
  next = setSelectedClipIds(next, new Set([textClip.id]))
  next = setCurrentTime(next, startTime + 0.1)
  return next
}

export function createAdjustmentLayerAsset(state: EditorState): EditorState {
  const name = getNextAdjustmentLayerName(state.editorModel.assets)
  const asset = createAdjustmentAsset(name)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}

export function addAdjustmentLayer(state: EditorState, params: AddAdjustmentLayerParams = {}): EditorState {
  const name = getNextAdjustmentLayerName(state.editorModel.assets)
  const asset = createAdjustmentAsset(name)
  const clip = createAdjustmentClip(asset, params.startTime ?? selectCurrentTime(state), params.trackIndex ?? 0, params.duration ?? 10)
  return updateEditorModel(replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: [...timeline.clips, clip],
  })), editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}

export function duplicateClips(state: EditorState, clipIds: string[]): EditorState {
  const clipSet = new Set(clipIds)
  return replaceActiveTimeline(state, timeline => {
    const duplicates = timeline.clips
      .filter(clip => clipSet.has(clip.id))
      .map(clip => ({
        ...clip,
        id: makeId('clip'),
        startTime: clip.startTime + clip.duration,
      }))
    return {
      ...timeline,
      clips: [...timeline.clips, ...duplicates],
    }
  })
}

export function unlinkClipGroup(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip?.linkedClipIds?.length) return state
  const linkedIds = new Set(clip.linkedClipIds)
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips.map(candidate => {
      if (candidate.id === clipId) {
        return { ...candidate, linkedClipIds: undefined }
      }
      if (!linkedIds.has(candidate.id) || !candidate.linkedClipIds?.length) {
        return candidate
      }
      const remaining = candidate.linkedClipIds.filter(id => id !== clipId)
      return { ...candidate, linkedClipIds: remaining.length > 0 ? remaining : undefined }
    }),
  }))
}

export function deleteClips(state: EditorState, clipIds: string[]): EditorState {
  const deleteSet = new Set(clipIds)
  let next = replaceActiveTimeline(state, timeline => {
    const remainingClips = timeline.clips
      .filter(clip => !deleteSet.has(clip.id))
      .map(clip => {
        if (!clip.linkedClipIds) return clip
        const remaining = clip.linkedClipIds.filter(id => !deleteSet.has(id))
        return { ...clip, linkedClipIds: remaining.length > 0 ? remaining : undefined }
      })
    // Deleting the last clip on a row leaves the row behind, so tidy up in the
    // same step. The user sees the row go with its contents rather than having
    // to remove it separately.
    const pruned = pruneEmptyTracks(
      timeline.tracks,
      packMainVideoTrack(timeline.tracks, remainingClips, timeline.transitions),
      timeline.subtitles || [],
    )
    return {
      ...timeline,
      tracks: pruned.tracks,
      clips: pruned.clips,
      subtitles: pruned.subtitles,
    }
  })
  next = updateSession(next, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: new Set([...session.selection.clipIds].filter(id => !deleteSet.has(id))),
    },
  }))
  return next
}

export function splitClipsAtTime(state: EditorState, clipIds: string[], time: number): EditorState {
  const clips = selectClips(state)
  const tracks = selectTracks(state)
  const splittable = clipIds.filter(id => {
    const clip = clips.find(candidate => candidate.id === id)
    if (!clip) return false
    if (tracks[clip.trackIndex]?.locked) return false
    const splitPoint = time - clip.startTime
    return splitPoint > 0.1 && splitPoint < clip.duration - 0.1
  })
  if (splittable.length === 0) return state

  return replaceActiveTimeline(state, timeline => {
    const alreadySplit = new Set<string>()
    let newClips = [...timeline.clips]

    for (const splitId of splittable) {
      if (alreadySplit.has(splitId)) continue

      const clip = newClips.find(candidate => candidate.id === splitId)
      if (!clip) continue

      const splitPoint = time - clip.startTime
      if (splitPoint <= 0.1 || splitPoint >= clip.duration - 0.1) continue

      alreadySplit.add(splitId)

      const firstHalfId = clip.id
      const secondHalfId = makeId('clip')
      const linkedClips = (clip.linkedClipIds || [])
        .map(linkedId => newClips.find(candidate => candidate.id === linkedId))
        .filter((linkedClip): linkedClip is TimelineClip => linkedClip != null)

      const firstHalf: TimelineClip = {
        ...clip,
        duration: splitPoint,
        trimEnd: clip.trimEnd + mediaSecondsForTimelineSeconds(clip.duration - splitPoint, clip.speed),
      }
      const secondHalf: TimelineClip = {
        ...clip,
        id: secondHalfId,
        startTime: clip.startTime + splitPoint,
        duration: clip.duration - splitPoint,
        trimStart: clip.trimStart + mediaSecondsForTimelineSeconds(splitPoint, clip.speed),
      }

      newClips = newClips.map(candidate => candidate.id === splitId ? firstHalf : candidate).concat(secondHalf)

      const firstHalfLinkedIds: string[] = []
      const secondHalfLinkedIds: string[] = []

      for (const linkedClip of linkedClips) {
        alreadySplit.add(linkedClip.id)

        const linkedSplitPoint = time - linkedClip.startTime
        if (linkedSplitPoint <= 0.01 || linkedSplitPoint >= linkedClip.duration - 0.01) {
          firstHalfLinkedIds.push(linkedClip.id)
          continue
        }

        const linkedSecondId = makeId('clip')
        firstHalfLinkedIds.push(linkedClip.id)
        secondHalfLinkedIds.push(linkedSecondId)

        const linkedFirstHalf: TimelineClip = {
          ...linkedClip,
          duration: linkedSplitPoint,
          trimEnd: linkedClip.trimEnd + mediaSecondsForTimelineSeconds(linkedClip.duration - linkedSplitPoint, linkedClip.speed),
          linkedClipIds: [firstHalfId],
        }
        const linkedSecondHalf: TimelineClip = {
          ...linkedClip,
          id: linkedSecondId,
          startTime: linkedClip.startTime + linkedSplitPoint,
          duration: linkedClip.duration - linkedSplitPoint,
          trimStart: linkedClip.trimStart + mediaSecondsForTimelineSeconds(linkedSplitPoint, linkedClip.speed),
          linkedClipIds: [secondHalfId],
        }

        newClips = newClips
          .map(candidate => candidate.id === linkedClip.id ? linkedFirstHalf : candidate)
          .concat(linkedSecondHalf)
      }

      firstHalf.linkedClipIds = firstHalfLinkedIds.length > 0 ? firstHalfLinkedIds : undefined
      secondHalf.linkedClipIds = secondHalfLinkedIds.length > 0 ? secondHalfLinkedIds : undefined
      newClips = newClips.map(candidate => (
        candidate.id === firstHalfId ? firstHalf : candidate.id === secondHalfId ? secondHalf : candidate
      ))
    }

    return {
      ...timeline,
      clips: newClips,
    }
  })
}

export function moveClips(state: EditorState, params: MoveClipsParams): EditorState {
  const clipSet = new Set(params.clipIds)
  return replaceActiveTimeline(state, timeline => {
    const moved = timeline.clips.map(clip => (
      clipSet.has(clip.id)
        ? {
            ...clip,
            startTime: Math.max(0, clip.startTime + (params.deltaTime ?? 0)),
            trackIndex: params.targetTrackIndex ?? clip.trackIndex,
          }
        : clip
    ))
    const packed = packMainVideoTrack(timeline.tracks, moved, timeline.transitions)
    const pruned = pruneEmptyTracks(timeline.tracks, packed, timeline.subtitles || [])
    return {
      ...timeline,
      tracks: pruned.tracks,
      clips: pruned.clips,
      subtitles: pruned.subtitles,
    }
  })
}

export function resizeClip(state: EditorState, params: ResizeClipParams): EditorState {
  return mapClips(state, clip => {
    if (clip.id !== params.clipId) return clip
    if (params.edge === 'start') {
      const nextStart = Math.max(0, clip.startTime + params.deltaTime)
      const delta = nextStart - clip.startTime
      const nextDuration = Math.max(0.1, clip.duration - delta)
      return {
        ...clip,
        startTime: nextStart,
        duration: nextDuration,
        trimStart: Math.max(0, clip.trimStart + delta * clip.speed),
      }
    }
    return {
      ...clip,
      duration: Math.max(0.1, clip.duration + params.deltaTime),
    }
  })
}

export function slipClip(state: EditorState, params: SlipClipParams): EditorState {
  return mapClips(state, clip => {
    if (clip.id !== params.clipId) return clip
    return {
      ...clip,
      trimStart: Math.max(0, clip.trimStart + params.deltaTime * clip.speed),
      trimEnd: Math.max(0, clip.trimEnd - params.deltaTime * clip.speed),
    }
  })
}

export function slideClip(state: EditorState, params: SlideClipParams): EditorState {
  return moveClips(state, { clipIds: [params.clipId], deltaTime: params.deltaTime })
}

export function updateClip(state: EditorState, clipId: string, patch: Partial<TimelineClip>): EditorState {
  return mapClips(state, clip => (clip.id === clipId ? { ...clip, ...patch } : clip))
}

/**
 * Re-times one clip and packs the magnetic track around it.
 *
 * Every edit that changes when a clip starts or how long it runs has to leave
 * V1 seamless, or `replaceActiveTimeline` throws the whole edit away. Patching
 * the clip on its own — which is all `updateClip` does — was enough to make the
 * Speed, Duration and Start Time controls do nothing at all whenever another
 * clip followed on the main track.
 */
function retimeClip(state: EditorState, clipId: string, patch: Partial<TimelineClip>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => (clip.id === clipId ? { ...clip, ...patch } : clip)),
      timeline.transitions,
    ),
  }))
}

/**
 * Note that on the magnetic track the pack decides the start time, so this can
 * only move a clip that sits on an overlay or audio row.
 */
export function setClipStartTime(state: EditorState, clipId: string, startTime: number): EditorState {
  return retimeClip(state, clipId, { startTime: Math.max(0, startTime) })
}

export function setClipDuration(state: EditorState, clipId: string, duration: number): EditorState {
  const targetClip = selectClipById(state, clipId)
  if (!targetClip) return state

  const safeDuration = Math.max(0.1, duration)
  const linkedIds = new Set(targetClip.linkedClipIds || [])
  const durationRatio = targetClip.duration > 0 ? safeDuration / targetClip.duration : 1

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => {
        if (clip.id === clipId) {
          return { ...clip, duration: safeDuration }
        }
        if (linkedIds.has(clip.id)) {
          return { ...clip, duration: Math.max(0.1, clip.duration * durationRatio) }
        }
        return clip
      }),
      timeline.transitions,
    ),
  }))
}

/**
 * Changes a clip's speed, and re-times the magnetic track around it.
 *
 * Speed and duration move together: playing the same media twice as fast takes
 * half the time. On V1 that shortens or lengthens the clip, which leaves every
 * clip after it starting at the wrong moment — and the timeline validator
 * rejects a V1 with a gap or an overlap (V1_NOT_SEAMLESS). `replaceActiveTimeline`
 * drops a rejected edit and returns the previous state without a word, so the
 * speed slider simply did nothing whenever another clip followed on V1.
 *
 * Packing the track in the same step is what makes the edit legal: the
 * following clips slide to meet the new duration.
 *
 * Any linked clips (such as linked audio from the same video file) are also
 * updated with the new speed and their durations scaled synchronously to prevent
 * desynchronization.
 */
export function setClipSpeed(
  state: EditorState,
  clipId: string,
  speed: number,
  duration?: number,
): EditorState {
  const targetClip = selectClipById(state, clipId)
  if (!targetClip) return state

  const safeSpeed = clampClipSpeed(speed)
  const safeDuration = duration !== undefined ? Math.max(0.1, duration) : undefined
  const linkedIds = new Set(targetClip.linkedClipIds || [])
  const durationRatio = safeDuration !== undefined && targetClip.duration > 0
    ? safeDuration / targetClip.duration
    : undefined

  const patchTarget = (clip: TimelineClip): TimelineClip => {
    if (clip.id === clipId) {
      return {
        ...clip,
        speed: safeSpeed,
        ...(safeDuration !== undefined ? { duration: safeDuration } : {}),
      }
    }
    if (linkedIds.has(clip.id)) {
      return {
        ...clip,
        speed: safeSpeed,
        ...(durationRatio !== undefined ? { duration: Math.max(0.1, clip.duration * durationRatio) } : {}),
      }
    }
    return clip
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(patchTarget),
      timeline.transitions,
    ),
  }))
}

/**
 * The same change across a selection, in one edit.
 *
 * Applying it clip by clip would leave a row of undo steps for what the user
 * did once, and each intermediate state would have to be seamless on its own —
 * which it is not, since the clips are re-timed one at a time.
 *
 * `durationFor` receives each clip and returns the length it should take at the
 * new speed; the caller owns that sum because it is the side that knows how
 * much media is left to play.
 */
export function setClipsSpeed(
  state: EditorState,
  clipIds: Iterable<string>,
  speed: number,
  durationFor?: (clip: TimelineClip) => number,
): EditorState {
  const targets = new Set(clipIds)
  if (targets.size === 0) return state
  const safeSpeed = clampClipSpeed(speed)

  const allClips = selectClips(state)
  const linkedToTargets = new Map<string, string>() // linkedId -> parentTargetId
  for (const clip of allClips) {
    if (targets.has(clip.id) && clip.linkedClipIds) {
      for (const lid of clip.linkedClipIds) {
        if (!targets.has(lid)) {
          linkedToTargets.set(lid, clip.id)
        }
      }
    }
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => {
        if (targets.has(clip.id)) {
          return {
            ...clip,
            speed: safeSpeed,
            ...(durationFor ? { duration: Math.max(0.1, durationFor(clip)) } : {}),
          }
        }
        const parentTargetId = linkedToTargets.get(clip.id)
        if (parentTargetId) {
          const parent = allClips.find(c => c.id === parentTargetId)
          const newParentDur = parent && durationFor ? durationFor(parent) : undefined
          const ratio = parent && newParentDur !== undefined && parent.duration > 0
            ? newParentDur / parent.duration
            : undefined
          return {
            ...clip,
            speed: safeSpeed,
            ...(ratio !== undefined ? { duration: Math.max(0.1, clip.duration * ratio) } : {}),
          }
        }
        return clip
      }),
      timeline.transitions,
    ),
  }))
}

function resolveClipAudioTargetId(state: EditorState, clipId: string): string | null {
  const clip = selectClipById(state, clipId)
  if (!clip) return null
  if (clip.type === 'audio') return clip.id

  const linkedAudioClip = (clip.linkedClipIds || [])
    .map(linkedId => selectClipById(state, linkedId))
    .find(candidate => candidate?.type === 'audio')

  return linkedAudioClip?.id ?? clip.id
}

export function setClipAudioLevel(state: EditorState, clipId: string, volume: number): EditorState {
  const targetClipId = resolveClipAudioTargetId(state, clipId)
  if (!targetClipId) return state
  // The ceiling is MAX_CLIP_VOLUME, not unity: the volume slider runs to 400%,
  // preview lifts anything past 100% through a Web Audio gain node and export
  // rides the peaks down with a look-ahead limiter. Clamping at 1 here meant
  // the slider sprang back to 100% and a clip could never be made louder.
  const clampedVolume = Math.max(0, Math.min(MAX_CLIP_VOLUME, volume))
  return updateClip(state, targetClipId, { volume: clampedVolume, muted: false })
}

export function setClipAudioMuted(state: EditorState, clipId: string, muted: boolean): EditorState {
  const targetClipId = resolveClipAudioTargetId(state, clipId)
  if (!targetClipId) return state
  return updateClip(state, targetClipId, { muted })
}

export function setClipVolume(state: EditorState, clipId: string, volume: number): EditorState {
  return updateClip(state, clipId, { volume })
}

export function toggleClipMute(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, { muted: !clip.muted })
}

export function toggleClipReverse(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, { reversed: !clip.reversed })
}

export function setClipOpacity(state: EditorState, clipId: string, opacity: number): EditorState {
  return updateClip(state, clipId, { opacity })
}

export function setClipFlipH(state: EditorState, clipId: string, value: boolean): EditorState {
  return updateClip(state, clipId, { flipH: value })
}

export function setClipFlipV(state: EditorState, clipId: string, value: boolean): EditorState {
  return updateClip(state, clipId, { flipV: value })
}

export function setClipColorLabel(state: EditorState, clipId: string, colorLabel?: string): EditorState {
  return updateClip(state, clipId, { colorLabel })
}


export function setClipColorCorrectionField<K extends keyof ColorCorrection>(
  state: EditorState,
  clipId: string,
  field: K,
  value: ColorCorrection[K],
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    colorCorrection: {
      ...(clip.colorCorrection || DEFAULT_COLOR_CORRECTION),
      [field]: value,
    },
  })
}

export function resetClipColorCorrection(state: EditorState, clipId: string): EditorState {
  return updateClip(state, clipId, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })
}

export function setClipLetterbox(state: EditorState, clipId: string, patch: Partial<LetterboxSettings>): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    letterbox: {
      ...(clip.letterbox || DEFAULT_LETTERBOX),
      ...patch,
    },
  })
}

export function setClipTextStyleField<K extends keyof TextOverlayStyle>(
  state: EditorState,
  clipId: string,
  field: K,
  value: TextOverlayStyle[K],
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    textStyle: {
      ...(clip.textStyle || DEFAULT_TEXT_STYLE),
      [field]: value,
    },
  })
}

export function updateClipTextStyle(
  state: EditorState,
  clipId: string,
  patch: Partial<TextOverlayStyle>,
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    textStyle: {
      ...(clip.textStyle || DEFAULT_TEXT_STYLE),
      ...patch,
    },
  })
}

export function setClipTextPosition(
  state: EditorState,
  clipId: string,
  positionX: number,
  positionY: number,
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip?.textStyle) return state
  const clamp = (value: number) => Math.max(0, Math.min(100, value))
  const round1 = (value: number) => Math.round(value * 10) / 10
  return updateClip(state, clipId, {
    textStyle: {
      ...clip.textStyle,
      positionX: round1(clamp(positionX)),
      positionY: round1(clamp(positionY)),
    },
  })
}

export function addCrossDissolve(state: EditorState, leftClipId: string, rightClipId: string): EditorState {
  return mapClips(state, clip => {
    if (clip.id === leftClipId) return { ...clip, transitionOut: { type: 'dissolve', duration: 0.5 } }
    if (clip.id === rightClipId) return { ...clip, transitionIn: { type: 'dissolve', duration: 0.5 } }
    return clip
  })
}

export function removeCrossDissolve(state: EditorState, leftClipId: string, rightClipId: string): EditorState {
  return mapClips(state, clip => {
    if (clip.id === leftClipId) return { ...clip, transitionOut: { type: 'none', duration: 0.5 } }
    if (clip.id === rightClipId) return { ...clip, transitionIn: { type: 'none', duration: 0.5 } }
    return clip
  })
}

export function addTrack(state: EditorState, kind: 'video' | 'audio' | 'sticker'): EditorState {
  const tracks = selectTracks(state)
  const sameKindCount = tracks.filter(track => track.kind === kind && track.type !== 'subtitle').length
  const prefix = kind === 'audio' ? 'A' : kind === 'sticker' ? 'S' : 'V'
  const newTrack: Track = {
    id: makeId('track'),
    name: `${prefix}${sameKindCount + 1}`,
    muted: false,
    locked: false,
    kind,
  }
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    tracks: [...timeline.tracks, newTrack],
  }))
}

export function deleteTrack(state: EditorState, trackId: string): EditorState {
  const tracks = selectTracks(state)
  const trackIndex = tracks.findIndex(track => track.id === trackId)
  if (trackIndex < 0 || tracks.length <= 1) return state
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips
      .filter(clip => clip.trackIndex !== trackIndex)
      .map(clip => clip.trackIndex > trackIndex ? { ...clip, trackIndex: clip.trackIndex - 1 } : clip),
    subtitles: (timeline.subtitles || [])
      .filter(subtitle => subtitle.trackIndex !== trackIndex)
      .map(subtitle => subtitle.trackIndex > trackIndex ? { ...subtitle, trackIndex: subtitle.trackIndex - 1 } : subtitle),
    tracks: timeline.tracks.filter((_, index) => index !== trackIndex),
  }))
}

export function renameTrack(state: EditorState, trackId: string, name: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, name } : track))
}

export function toggleTrackLock(state: EditorState, trackId: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, locked: !track.locked } : track))
}

export function toggleTrackMute(state: EditorState, trackId: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, muted: !track.muted } : track))
}

export function toggleTrackEnabled(state: EditorState, trackId: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, enabled: !(track.enabled ?? true) } : track))
}

export function toggleTrackSolo(state: EditorState, trackId: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, solo: !track.solo } : track))
}

export function toggleTrackSourcePatched(state: EditorState, trackId: string): EditorState {
  return mapTracks(state, track => (track.id === trackId ? { ...track, sourcePatched: !(track.sourcePatched ?? true) } : track))
}

export function addSubtitleTrack(state: EditorState): EditorState {
  const count = selectTracks(state).filter(track => track.type === 'subtitle').length
  const track: Track = {
    id: makeId('track-sub'),
    name: count > 0 ? `Subtitles ${count + 1}` : 'Subtitles',
    muted: false,
    locked: false,
    kind: 'video',
    type: 'subtitle',
  }
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips.map(clip => ({ ...clip, trackIndex: clip.trackIndex + 1 })),
    subtitles: (timeline.subtitles || []).map(subtitle => ({ ...subtitle, trackIndex: subtitle.trackIndex + 1 })),
    tracks: [track, ...timeline.tracks],
  }))
}

/**
 * Keeps what Whisper heard, so the next feature that needs it does not pay for
 * it again. Stored against the source media in the media's own seconds — see
 * transcript-store.ts — and replacing any earlier transcript of the same audio.
 */
export function storeAssetTranscript(
  state: EditorState,
  params: { assetPath: string; language?: string; segments: TranscriptSegment[] },
): EditorState {
  const segments = toTranscriptSegments(params.segments)
  if (segments.length === 0) return state

  return markEditorModelDirty({
    ...state,
    editorModel: {
      ...state.editorModel,
      transcripts: upsertAssetTranscript(state.editorModel.transcripts, {
        assetPath: params.assetPath,
        language: params.language ?? '',
        segments,
        createdAt: Date.now(),
      }),
    },
  })
}

export function importSrtCues(
  state: EditorState,
  cues: SrtCue[],
  options?: {
    targetTrackIndex?: number
    style?: Partial<SubtitleStyle>
  },
): EditorState {
  if (cues.length === 0) return state

  let next = state
  let subtitleTrackIndex = options?.targetTrackIndex ?? selectTracks(next).findIndex(track => track.type === 'subtitle')
  if (subtitleTrackIndex === -1) {
    next = addSubtitleTrack(next)
    subtitleTrackIndex = 0
  }

  const importedSubtitles: SubtitleClip[] = cues.map(cue => ({
    id: `${makeId('sub')}-${cue.index}`,
    text: cue.text,
    startTime: cue.startTime,
    endTime: cue.endTime,
    trackIndex: subtitleTrackIndex,
    ...(cue.color || options?.style ? { style: { ...(options?.style || {}), ...(cue.color ? { color: cue.color } : {}) } } : {}),
  }))

  return setTimelineSubtitles(next, prev => [
    ...prev.filter(subtitle => subtitle.trackIndex !== subtitleTrackIndex),
    ...importedSubtitles,
  ])
}

export function setSubtitleTrackStyle(state: EditorState, trackId: string, patch: Partial<SubtitleStyle>): EditorState {
  return mapTracks(state, track => (
    track.id === trackId
      ? { ...track, subtitleStyle: { ...(track.subtitleStyle || {}), ...patch } }
      : track
  ))
}

export function addSubtitle(state: EditorState, params: AddSubtitleParams): EditorState {
  const subtitle: SubtitleClip = {
    id: makeId('sub'),
    text: params.text || 'New subtitle',
    startTime: params.startTime ?? selectCurrentTime(state),
    endTime: params.endTime ?? (selectCurrentTime(state) + 3),
    trackIndex: params.trackIndex,
    ...(params.style ? { style: params.style } : {}),
  }
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    subtitles: [...(timeline.subtitles || []), subtitle],
  }))
}

export function deleteSubtitle(state: EditorState, subtitleId: string): EditorState {
  const next = replaceActiveTimeline(state, timeline => ({
    ...timeline,
    subtitles: (timeline.subtitles || []).filter(subtitle => subtitle.id !== subtitleId),
  }))
  return updateSession(next, session => ({
    ...session,
    selection: {
      ...session.selection,
      subtitleId: session.selection.subtitleId === subtitleId ? null : session.selection.subtitleId,
      editingSubtitleId: session.selection.editingSubtitleId === subtitleId ? null : session.selection.editingSubtitleId,
    },
  }))
}

export function updateSubtitle(state: EditorState, subtitleId: string, patch: Partial<SubtitleClip>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    subtitles: (timeline.subtitles || []).map(subtitle => (
      subtitle.id === subtitleId ? { ...subtitle, ...patch } : subtitle
    )),
  }))
}

export function setSubtitleText(state: EditorState, subtitleId: string, text: string): EditorState {
  return updateSubtitle(state, subtitleId, { text })
}

export function setSubtitleStart(state: EditorState, subtitleId: string, startTime: number): EditorState {
  return updateSubtitle(state, subtitleId, { startTime })
}

export function setSubtitleEnd(state: EditorState, subtitleId: string, endTime: number): EditorState {
  return updateSubtitle(state, subtitleId, { endTime })
}

export function setSubtitleStyleField<K extends keyof SubtitleStyle>(
  state: EditorState,
  subtitleId: string,
  field: K,
  value: SubtitleStyle[K],
): EditorState {
  const subtitle = state.editorModel.timelines.flatMap(timeline => timeline.subtitles || []).find(candidate => candidate.id === subtitleId)
  if (!subtitle) return state
  return updateSubtitle(state, subtitleId, {
    style: {
      ...(subtitle.style || {}),
      [field]: value,
    },
  })
}

/**
 * A new project takes its shape from the first video put into it.
 *
 * Until something is written here the preview falls back to the largest asset
 * in the project, which means the canvas can flip shape later when a bigger
 * clip is imported. Writing the size down on the first video settles it: the
 * project is that video's shape, and Project Settings shows what it is.
 *
 * Deliberately narrow — a timeline that already has a size keeps it, and so
 * does a project that already has another video in it.
 */
export function adoptTimelineSizeFromAsset(state: EditorState, asset: Asset): EditorState {
  if (asset.type !== 'video' || !asset.width || !asset.height) return state

  const timeline = selectActiveTimeline(state)
  if (!timeline || timeline.width || timeline.height) return state

  const hasOtherVideo = state.editorModel.assets.some(
    candidate => candidate.type === 'video' && candidate.id !== asset.id,
  )
  if (hasOtherVideo) return state

  return setTimelineSettings(state, timeline.id, { width: asset.width, height: asset.height })
}

export function addAssetToEditor(state: EditorState, asset: Asset): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}

export function addAssetsToEditor(state: EditorState, assets: Asset[]): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [...assets, ...editorModel.assets],
  }))
}

export function insertGeneratedGapAsset(state: EditorState, params: InsertGeneratedGapAssetParams): EditorState {
  let next = addAssetToEditor(state, params.asset)

  let audioTrackIndex = -1
  if (params.createAudio) {
    audioTrackIndex = selectTracks(next).findIndex(
      track => track.kind === 'audio' && !track.locked && track.sourcePatched !== false,
    )
    if (audioTrackIndex < 0) {
      next = addTrack(next, 'audio')
      audioTrackIndex = selectTracks(next).length - 1
    }
  }

  const gapDuration = params.gap.endTime - params.gap.startTime
  const videoClipId = makeId('clip')
  const audioClipId = makeId('clip-audio')
  const newClips: TimelineClip[] = [{
    id: videoClipId,
    assetId: params.asset.id,
    type: params.asset.type === 'image' ? 'image' : 'video',
    startTime: params.gap.startTime,
    duration: gapDuration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: params.gap.trackIndex,
    asset: params.asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    ...(params.createAudio && audioTrackIndex >= 0 ? { linkedClipIds: [audioClipId] } : {}),
  }]

  if (params.createAudio && audioTrackIndex >= 0) {
    newClips.push({
      id: audioClipId,
      assetId: params.asset.id,
      type: 'audio',
      startTime: params.gap.startTime,
      duration: gapDuration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: audioTrackIndex,
      asset: params.asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      linkedClipIds: [videoClipId],
    })
  }

  return setTimelineClips(next, prev => [...prev, ...newClips])
}

export function deleteAssets(state: EditorState, assetIds: string[]): EditorState {
  const deleteSet = new Set(assetIds)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.filter(asset => !deleteSet.has(asset.id)),
    timelines: editorModel.timelines.map(timeline => ({
      ...timeline,
      clips: timeline.clips.filter(clip => !clip.assetId || !deleteSet.has(clip.assetId)),
    })),
  }))
}

export function updateAsset(state: EditorState, assetId: string, patch: Partial<Asset>): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.map(asset => (asset.id === assetId ? { ...asset, ...patch } : asset)),
  }))
}

export function setAssetBin(state: EditorState, assetId: string, binId?: string): EditorState {
  return updateAsset(state, assetId, { binId })
}

export function createBin(state: EditorState, binId: string, name: string): EditorState {
  const trimmedName = name.trim()
  if (!trimmedName) return state

  return updateEditorModel(state, editorModel => (
    editorModel.bins[binId] || Object.values(editorModel.bins).includes(trimmedName)
      ? editorModel
      : {
          ...editorModel,
          bins: {
            ...editorModel.bins,
            [binId]: trimmedName,
          },
        }
  ))
}

export function assignAssetsToBin(state: EditorState, assetIds: string[], binId?: string): EditorState {
  const assetSet = new Set(assetIds)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: editorModel.assets.map(asset => (assetSet.has(asset.id) ? { ...asset, binId } : asset)),
  }))
}

export function renameBin(state: EditorState, binId: string, newName: string): EditorState {
  const trimmedName = newName.trim()
  if (!trimmedName) return state

  return updateEditorModel(state, editorModel => (
    !editorModel.bins[binId] || Object.entries(editorModel.bins).some(([id, name]) => id !== binId && name === trimmedName)
      ? editorModel
      : {
          ...editorModel,
          bins: {
            ...editorModel.bins,
            [binId]: trimmedName,
          },
        }
  ))
}

export function clearBin(state: EditorState, binId: string): EditorState {
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    bins: deleteBinEntry(editorModel.bins, binId),
    assets: editorModel.assets.map(asset => (asset.binId === binId ? { ...asset, binId: undefined } : asset)),
  }))
}

export function toggleAssetFavorite(state: EditorState, assetId: string): EditorState {
  const asset = selectAssetById(state, assetId)
  if (!asset) return state
  return updateAsset(state, assetId, { favorite: !asset.favorite })
}

export function setAssetColorLabel(state: EditorState, assetId: string, colorLabel?: string): EditorState {
  const next = updateAsset(state, assetId, { colorLabel })
  return replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: timeline.clips.map(clip => (
      clip.assetId === assetId
        ? { ...clip, colorLabel }
        : clip
    )),
  }))
}

export function selectClip(state: EditorState, clipId: string, options: SelectClipMode = {}): EditorState {
  const mode = options.mode ?? 'replace'
  const current = state.session.selection.clipIds
  const next = cloneClipIds(current)
  if (mode === 'replace') {
    next.clear()
    next.add(clipId)
  } else if (mode === 'toggle') {
    if (next.has(clipId)) next.delete(clipId)
    else next.add(clipId)
  } else {
    next.add(clipId)
  }
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: next,
      subtitleId: null,
    },
  }))
}

export function selectClipsById(state: EditorState, clipIds: string[], options: SelectClipMode = {}): EditorState {
  const mode = options.mode ?? 'replace'
  const next = mode === 'replace' ? new Set<string>() : cloneClipIds(state.session.selection.clipIds)
  for (const clipId of clipIds) {
    if (mode === 'toggle') {
      if (next.has(clipId)) next.delete(clipId)
      else next.add(clipId)
    } else {
      next.add(clipId)
    }
  }
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: next,
      subtitleId: null,
    },
  }))
}

export { selectClipsById as selectClips }

export function selectLinkedGroup(state: EditorState, clipId: string): EditorState {
  const clips = selectClips(state)
  const first = clips.find(clip => clip.id === clipId)
  if (!first) return state
  const linkedIds = new Set([first.id])
  const queue = [first]
  while (queue.length > 0) {
    const clip = queue.pop()!
    if (!clip.linkedClipIds) continue
    for (const linkedId of clip.linkedClipIds) {
      if (linkedIds.has(linkedId)) continue
      const linkedClip = clips.find(candidate => candidate.id === linkedId)
      if (!linkedClip) continue
      linkedIds.add(linkedId)
      queue.push(linkedClip)
    }
  }
  return selectClipsById(state, [...linkedIds])
}

export function selectAllClips(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: new Set(selectClips(state).map(clip => clip.id)),
      subtitleId: null,
    },
  }))
}

export function clearClipSelection(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: new Set(),
      selectedKeyframe: null,
    },
  }))
}

export function setSelectedKeyframe(state: EditorState, keyframe: KeyframeSelection | null): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      selectedKeyframe: keyframe,
    },
  }))
}

export function clearSelectedKeyframe(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      selectedKeyframe: null,
    },
  }))
}

export function setSelectedClipIds(state: EditorState, value: SetStateAction<Set<string>>): EditorState {
  return updateSession(state, session => {
    const nextClipIds = applyStateAction(value, session.selection.clipIds)
    const prevKf = session.selection.selectedKeyframe
    const keepKf = prevKf && nextClipIds.has(prevKf.clipId) ? prevKf : null
    return {
      ...session,
      selection: {
        ...session.selection,
        clipIds: nextClipIds,
        subtitleId: null,
        selectedKeyframe: keepKf,
      },
    }
  })
}

export function setSelectedSubtitle(state: EditorState, subtitleId?: string): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      subtitleId: subtitleId ?? null,
      clipIds: new Set(),
      selectedKeyframe: null,
    },
  }))
}

export function clearSelectedSubtitle(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      subtitleId: null,
      editingSubtitleId: null,
    },
  }))
}

export function setEditingSubtitleId(state: EditorState, value: SetStateAction<string | null>): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      editingSubtitleId: applyStateAction(value, session.selection.editingSubtitleId),
    },
  }))
}

export function setSelectedGap(state: EditorState, gap?: TimelineGapSelection): EditorState {
  return updateSession(state, session => ({
    ...session,
    selection: {
      ...session.selection,
      gap: gap ?? null,
    },
  }))
}

export function clearSelectedGap(state: EditorState): EditorState {
  return setSelectedGap(state, undefined)
}

export function setCurrentTime(state: EditorState, time: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      currentTime: Math.max(0, time),
    },
  }))
}

export function stepCurrentTime(state: EditorState, delta: number): EditorState {
  return setCurrentTime(state, Math.max(0, selectCurrentTime(state) + delta))
}

export function play(state: EditorState): EditorState {
  const contentDuration = selectContentDuration(state)
  const isAtEnd = contentDuration > 0 && state.session.transport.currentTime >= contentDuration - 0.04
  const targetTime = isAtEnd ? 0 : state.session.transport.currentTime
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      currentTime: targetTime,
      isPlaying: true,
    },
  }))
}

export function pause(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      isPlaying: false,
    },
  }))
}

export function togglePlayPause(state: EditorState): EditorState {
  if (state.session.transport.isPlaying) {
    return pause(state)
  }
  return play(state)
}

export function setShuttleSpeed(state: EditorState, speed: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      shuttleSpeed: speed,
    },
  }))
}

export function stopShuttle(state: EditorState): EditorState {
  return setShuttleSpeed(pause(state), 0)
}

export function setTimelineInPoint(state: EditorState, time?: number | null): EditorState {
  const activeTimelineId = selectActiveTimelineId(state) || ''
  if (!activeTimelineId) return state
  const current = state.session.transport.timelineInOutMap[activeTimelineId] || { inPoint: null, outPoint: null }
  let inPoint = time ?? null
  if (inPoint !== null && current.outPoint !== null && inPoint >= current.outPoint) {
    inPoint = current.outPoint - 0.01
  }
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      timelineInOutMap: {
        ...session.transport.timelineInOutMap,
        [activeTimelineId]: {
          ...current,
          inPoint,
        },
      },
    },
  }))
}

export function setTimelineOutPoint(state: EditorState, time?: number | null): EditorState {
  const activeTimelineId = selectActiveTimelineId(state) || ''
  if (!activeTimelineId) return state
  const current = state.session.transport.timelineInOutMap[activeTimelineId] || { inPoint: null, outPoint: null }
  let outPoint = time ?? null
  if (outPoint !== null && current.inPoint !== null && outPoint <= current.inPoint) {
    outPoint = current.inPoint + 0.01
  }
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      timelineInOutMap: {
        ...session.transport.timelineInOutMap,
        [activeTimelineId]: {
          ...current,
          outPoint,
        },
      },
    },
  }))
}

export function clearTimelineInPoint(state: EditorState): EditorState {
  return setTimelineInPoint(state, null)
}

export function clearTimelineOutPoint(state: EditorState): EditorState {
  return setTimelineOutPoint(state, null)
}

export function clearTimelineMarks(state: EditorState): EditorState {
  let next = clearTimelineInPoint(state)
  next = clearTimelineOutPoint(next)
  return updateSession(next, session => ({
    ...session,
    transport: {
      ...session.transport,
      playingInOut: false,
    },
  }))
}

export function goToInPoint(state: EditorState): EditorState {
  const inPoint = selectActiveTimelineInPoint(state)
  const target = inPoint ?? (selectClips(state).length > 0 ? Math.min(...selectClips(state).map(clip => clip.startTime)) : 0)
  return stopShuttle(setCurrentTime(state, target))
}

export function goToOutPoint(state: EditorState): EditorState {
  const outPoint = selectActiveTimelineOutPoint(state)
  const total = selectClips(state).length > 0
    ? Math.max(...selectClips(state).map(clip => clip.startTime + clip.duration))
    : 0
  return stopShuttle(setCurrentTime(state, outPoint ?? total))
}

export function goToPrevEdit(state: EditorState, anchorTime?: number): EditorState {
  const current = Math.round((anchorTime ?? selectCurrentTime(state)) * 1000) / 1000
  const points = new Set<number>([0])
  for (const clip of selectClips(state)) {
    points.add(Math.round(clip.startTime * 1000) / 1000)
    points.add(Math.round((clip.startTime + clip.duration) * 1000) / 1000)
  }
  const sorted = Array.from(points).sort((a, b) => a - b)
  let target = sorted[0] ?? 0
  for (const point of sorted) {
    if (point < current - 0.01) target = point
    else break
  }
  return setCurrentTime(state, target)
}

export function goToNextEdit(state: EditorState, anchorTime?: number): EditorState {
  const current = Math.round((anchorTime ?? selectCurrentTime(state)) * 1000) / 1000
  const points = new Set<number>()
  for (const clip of selectClips(state)) {
    points.add(Math.round(clip.startTime * 1000) / 1000)
    points.add(Math.round((clip.startTime + clip.duration) * 1000) / 1000)
  }
  const sorted = Array.from(points).sort((a, b) => a - b)
  let target = sorted.length > 0 ? sorted[sorted.length - 1] : selectCurrentTime(state)
  for (const point of sorted) {
    if (point > current + 0.01) {
      target = point
      break
    }
  }
  return setCurrentTime(state, target)
}

export function togglePlayInOut(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      playingInOut: !session.transport.playingInOut,
    },
  }))
}

export function setPlayingInOut(state: EditorState, value: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: {
      ...session.transport,
      playingInOut: value,
    },
  }))
}

export function setSnapEnabled(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    tools: {
      ...session.tools,
      snapEnabled: enabled,
    },
  }))
}

export function setZoom(state: EditorState, zoom: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    tools: {
      ...session.tools,
      zoom,
    },
  }))
}

export function zoomIn(state: EditorState): EditorState {
  return setZoom(state, Math.min(selectClips(state).length > 0 ? state.session.tools.zoom * 1.25 : 1.25, 10))
}

export function zoomOut(state: EditorState): EditorState {
  return setZoom(state, Math.max(state.session.tools.zoom / 1.25, 0.1))
}

export function fitTimelineToView(state: EditorState): EditorState {
  return state
}

export function toggleSnap(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    tools: {
      ...session.tools,
      snapEnabled: !session.tools.snapEnabled,
    },
  }))
}

export function setActiveTool(state: EditorState, tool: ToolType): EditorState {
  return updateSession(state, session => ({
    ...session,
    tools: {
      ...session.tools,
      activeTool: tool,
    },
  }))
}

export function setLastTrimTool(state: EditorState, tool: ToolType): EditorState {
  return updateSession(state, session => ({
    ...session,
    tools: {
      ...session.tools,
      lastTrimTool: tool,
    },
  }))
}

export function setShowSourceMonitor(state: EditorState, value: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showSourceMonitor: value,
    },
  }))
}

export function closeSourceMonitor(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showSourceMonitor: false,
      activeFocusArea: 'timeline',
      hasSourceAsset: false,
    },
  }))
}

export function setShowPropertiesPanel(state: EditorState, value: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showPropertiesPanel: value,
    },
  }))
}

export function setShowEffectsBrowser(state: EditorState, value: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showEffectsBrowser: value,
    },
  }))
}

export function setActiveFocusArea(state: EditorState, area: 'source' | 'timeline'): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      activeFocusArea: area,
    },
  }))
}

export function setSourceSplitPercent(state: EditorState, percent: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      sourceSplitPercent: percent,
    },
  }))
}

export function setHasSourceAsset(state: EditorState, value: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      hasSourceAsset: value,
    },
  }))
}

export function setPreviewAssetId(state: EditorState, assetId: string | null): EditorState {
  return updateSession(state, session => ({
    ...session,
    transport: assetId && session.transport.isPlaying ? { ...session.transport, isPlaying: false } : session.transport,
    ui: {
      ...session.ui,
      previewAssetId: assetId,
      hasSourceAsset: Boolean(assetId),
    },
  }))
}

export function openImportTimelineModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showImportTimelineModal: true,
    },
  }))
}

export function closeImportTimelineModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showImportTimelineModal: false,
    },
  }))
}

export function openExportModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showExportModal: true,
    },
  }))
}

export function closeExportModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showExportModal: false,
    },
  }))
}

export function setOpenTimelineIds(state: EditorState, ids: Set<string>): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      openTimelineIds: new Set(ids),
    },
  }))
}

export function openTimelineTab(state: EditorState, timelineId: string): EditorState {
  return setOpenTimelineIds(state, new Set([...state.session.ui.openTimelineIds, timelineId]))
}

export function closeTimelineTab(state: EditorState, timelineId: string): EditorState {
  return setOpenTimelineIds(state, new Set([...state.session.ui.openTimelineIds].filter(id => id !== timelineId)))
}

export function startTimelineRename(state: EditorState, timelineId: string, source: 'tab' | 'panel'): EditorState {
  const timeline = state.editorModel.timelines.find(candidate => candidate.id === timelineId)
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      renamingTimelineId: timelineId,
      renameValue: timeline?.name || '',
      renameSource: source,
    },
  }))
}

export function setTimelineRenameValue(state: EditorState, value: string): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      renameValue: value,
    },
  }))
}

export function commitTimelineRename(state: EditorState): EditorState {
  const { renamingTimelineId, renameValue } = state.session.ui
  if (!renamingTimelineId || !renameValue.trim()) return cancelTimelineRename(state)
  return cancelTimelineRename(renameTimeline(state, renamingTimelineId, renameValue.trim()))
}

export function cancelTimelineRename(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      renamingTimelineId: null,
      renameValue: '',
    },
  }))
}

export function setLayout(state: EditorState, layout: EditorLayout): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      layout,
    },
  }))
}

export function resetLayout(state: EditorState): EditorState {
  return setLayout(state, {
    leftPanelWidth: 288,
    rightPanelWidth: 256,
    timelineHeight: 224,
    assetsHeight: 0,
  })
}

export function setSubtitleTrackStyleEditorTrack(state: EditorState, trackIdx?: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      subtitleTrackStyleIdx: trackIdx ?? null,
    },
  }))
}

export function updateSubtitleTrackStyle(
  state: EditorState,
  trackIndex: number,
  patch: Partial<SubtitleStyle>,
): EditorState {
  return mapTracks(state, (track, index) => (
    index === trackIndex
      ? {
          ...track,
          subtitleStyle: {
            ...track.subtitleStyle,
            ...patch,
          },
        }
      : track
  ))
}

export function clearSubtitleOverridesForTrack(state: EditorState, trackIndex: number): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    subtitles: (timeline.subtitles || []).map(subtitle => (
      subtitle.trackIndex === trackIndex
        ? { ...subtitle, style: undefined }
        : subtitle
    )),
  }))
}

export function copySelection(state: EditorState): EditorState {
  const selectedIds = selectSelectedClipIds(state)
  const clips = selectClips(state).filter(clip => selectedIds.has(clip.id))
  return updateSession(state, session => ({
    ...session,
    clipboard: {
      kind: 'clips',
      clips,
      copiedFromTimelineId: selectActiveTimelineId(state),
    },
  }))
}

export function cutSelection(state: EditorState): EditorState {
  const copied = copySelection(state)
  return deleteClips(copied, [...selectSelectedClipIds(copied)])
}

export function pasteSelection(state: EditorState, atTime?: number): EditorState {
  if (!selectCanUseClipboard(state)) return state
  const clipboard = state.session.clipboard
  const earliestStart = clipboard.clips.reduce((min, clip) => Math.min(min, clip.startTime), Infinity)
  const pasteAt = atTime ?? selectCurrentTime(state)
  const duplicates = clipboard.clips
    .filter(clip => !clip.assetId || Boolean(selectAssetById(state, clip.assetId)))
    .map(clip => ({
      ...clip,
      id: makeId('clip'),
      startTime: pasteAt + (clip.startTime - earliestStart),
      linkedClipIds: undefined,
    }))
  if (duplicates.length === 0) return state

  let next = replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: [...timeline.clips, ...duplicates],
  }))
  next = setSelectedClipIds(next, new Set(duplicates.map(clip => clip.id)))
  return next
}

export function undo(state: EditorState): EditorState {
  const previous = state.history.undoStack[state.history.undoStack.length - 1]
  if (!previous) return state
  const currentSnapshot = getUndoSnapshot(state)
  const next = applyUndoSnapshot(state, previous)
  if (equalUndoSnapshot(previous, currentSnapshot)) {
    return {
      ...next,
      history: {
        undoStack: state.history.undoStack.slice(0, -1),
        redoStack: state.history.redoStack,
      },
    }
  }
  return {
    ...next,
    history: {
      undoStack: state.history.undoStack.slice(0, -1),
      redoStack: [...state.history.redoStack, currentSnapshot],
    },
  }
}

export function redo(state: EditorState): EditorState {
  const next = state.history.redoStack[state.history.redoStack.length - 1]
  if (!next) return state
  const currentSnapshot = getUndoSnapshot(state)
  const restored = applyUndoSnapshot(state, next)
  if (equalUndoSnapshot(next, currentSnapshot)) {
    return {
      ...restored,
      history: {
        undoStack: state.history.undoStack,
        redoStack: state.history.redoStack.slice(0, -1),
      },
    }
  }
  return {
    ...restored,
    history: {
      undoStack: [...state.history.undoStack, currentSnapshot],
      redoStack: state.history.redoStack.slice(0, -1),
    },
  }
}

export function initializeFromProject(project: Project, layout?: EditorLayout): EditorState {
  return createInitialEditorState(getEditorModel(project), layout)
}

export function deriveProjectPatch(state: EditorState): EditorModel {
  return state.editorModel
}

export function commitToProject(state: EditorState, baseProject: Project): Project {
  return updatedProject(baseProject, state.editorModel)
}

export function setDirty(state: EditorState, dirty: boolean): EditorState {
  return {
    ...state,
    projectSync: {
      ...state.projectSync,
      dirty,
    },
  }
}

export function markProjectDirty(state: EditorState): EditorState {
  return setDirty(state, true)
}

export function clearProjectDirty(state: EditorState): EditorState {
  return setDirty(state, false)
}

export { markProjectDirty as markDirty }
export { clearProjectDirty as clearDirty }


/* =========================================================================
 * Visual Transform & Crop / Mask / Chroma Key / Blend Mode Actions
 * ========================================================================= */

export function setClipTransform(
  state: EditorState,
  clipId: string,
  transform: Partial<ClipTransform>,
  options?: { recordKeyframeAt?: number },
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  let nextState = updateClip(state, clipId, {
    transform: {
      ...(clip.transform || DEFAULT_CLIP_TRANSFORM),
      ...transform,
    },
  })

  if (options?.recordKeyframeAt !== undefined) {
    const t = options.recordKeyframeAt
    for (const [key, value] of Object.entries(transform)) {
      if (value !== undefined && typeof value === 'number') {
        const prop = `transform.${key}` as KeyframeProperty
        const hasTrack = clip.keyframes?.some(tr => tr.property === prop)
        if (hasTrack) {
          nextState = setKeyframe(nextState, clipId, prop, t, value)
        }
      }
    }
  }

  return nextState
}

export function setCropMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      cropMode: enabled,
    },
  }))
}

export function toggleCropMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      cropMode: !session.ui.cropMode,
    },
  }))
}

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

export function applyTextPresetToClip(state: EditorState, clipId: string, presetId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'text') return state
  const updated = applyTextPreset(clip, presetId)
  return updateClip(state, clipId, updated)
}

export function applyTextAnimationToClip(state: EditorState, clipId: string, animationId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'text') return state
  const updated = applyTextAnimation(clip, animationId)
  return updateClip(state, clipId, updated)
}

/* =========================================================================
 * Keyframe Actions (KE-201)
 * ========================================================================= */

export function setKeyframe(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
  value: number,
  easing: KeyframeEasing = 'linear',
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const currentTracks = clip.keyframes ? [...clip.keyframes] : []
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  const clampedT = Math.max(0, Math.min(clip.duration, Math.round(t * 1000) / 1000))

  let targetTrack = trackIdx >= 0 ? { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] } : { property, points: [] }

  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - clampedT) <= 0.02)
  if (pointIdx >= 0) {
    targetTrack.points[pointIdx] = { t: clampedT, value, easing }
  } else {
    targetTrack.points.push({ t: clampedT, value, easing })
  }
  targetTrack.points.sort((a, b) => a.t - b.t)

  if (trackIdx >= 0) {
    currentTracks[trackIdx] = targetTrack
  } else {
    currentTracks.push(targetTrack)
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function setKeyframePoints(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  points: Array<{ t: number; value: number; easing?: KeyframeEasing }>,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const currentTracks = clip.keyframes ? [...clip.keyframes] : []
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  const sanitizedPoints: KeyframePoint[] = points.map(p => ({
    t: Math.max(0, Math.min(clip.duration, Math.round(p.t * 1000) / 1000)),
    value: p.value,
    easing: p.easing || 'linear',
  })).sort((a, b) => a.t - b.t)

  const targetTrack: KeyframeTrack = {
    property,
    points: sanitizedPoints,
  }

  if (trackIdx >= 0) {
    currentTracks[trackIdx] = targetTrack
  } else {
    currentTracks.push(targetTrack)
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function removeKeyframeAt(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = currentTracks[trackIdx]
  const filteredPoints = targetTrack.points.filter(p => Math.abs(p.t - t) > 0.04)

  if (filteredPoints.length === 0) {
    currentTracks.splice(trackIdx, 1)
  } else {
    currentTracks[trackIdx] = { ...targetTrack, points: filteredPoints }
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function removeKeyframeGroupAt(
  state: EditorState,
  clipId: string,
  t: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = clip.keyframes
    .map(track => ({
      ...track,
      points: track.points.filter(p => Math.abs(p.t - t) > 0.04),
    }))
    .filter(track => track.points.length > 0)

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function moveKeyframeGroup(
  state: EditorState,
  clipId: string,
  fromT: number,
  toT: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const clampedToT = Math.max(0, Math.min(clip.duration, Math.round(toT * 1000) / 1000))

  const currentTracks = clip.keyframes.map(track => {
    const pointIdx = track.points.findIndex(p => Math.abs(p.t - fromT) <= 0.04)
    if (pointIdx < 0) return track
    const newPoints = [...track.points]
    newPoints[pointIdx] = {
      ...newPoints[pointIdx],
      t: clampedToT,
    }
    newPoints.sort((a, b) => a.t - b.t)
    return {
      ...track,
      points: newPoints,
    }
  })

  let nextState = updateClip(state, clipId, { keyframes: currentTracks })
  nextState = updateSession(nextState, session => ({
    ...session,
    selection: {
      ...session.selection,
      selectedKeyframe: { clipId, t: clampedToT },
    },
  }))
  return nextState
}

export function moveKeyframe(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  fromT: number,
  toT: number,
  _tolerance?: number,
  newValue?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] }
  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - fromT) <= 0.04)
  if (pointIdx < 0) return state

  const clampedToT = Math.max(0, Math.min(clip.duration, Math.round(toT * 1000) / 1000))
  targetTrack.points[pointIdx] = {
    ...targetTrack.points[pointIdx],
    t: clampedToT,
    ...(newValue !== undefined ? { value: newValue } : {}),
  }
  targetTrack.points.sort((a, b) => a.t - b.t)
  currentTracks[trackIdx] = targetTrack

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function setKeyframeEasing(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
  easing: KeyframeEasing,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] }
  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - t) <= 0.04)
  if (pointIdx < 0) return state

  targetTrack.points[pointIdx] = { ...targetTrack.points[pointIdx], easing }
  currentTracks[trackIdx] = targetTrack

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function clearKeyframes(state: EditorState, clipId: string, property?: KeyframeProperty): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state
  if (!property) {
    return updateClip(state, clipId, { keyframes: undefined })
  }
  const filtered = clip.keyframes.filter(tr => tr.property !== property)
  return updateClip(state, clipId, {
    keyframes: filtered.length > 0 ? filtered : undefined,
  })
}

/* =========================================================================
 * Audio Fade, Normalization, Ducking & Detach Actions
 * ========================================================================= */

export function setAudioFade(
  state: EditorState,
  clipId: string,
  fadeIn?: number,
  fadeOut?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const duration = clip.duration
  const currentKeyframes = clip.keyframes ? [...clip.keyframes] : []

  if (fadeIn === 0 && fadeOut === 0) {
    const remainingTracks = currentKeyframes.filter(tr => tr.property !== 'volume')
    return updateClip(state, clipId, {
      keyframes: remainingTracks.length > 0 ? remainingTracks : undefined,
    })
  }
  let volumeTrackIdx = currentKeyframes.findIndex(tr => tr.property === 'volume')
  let points = volumeTrackIdx >= 0 ? [...currentKeyframes[volumeTrackIdx].points] : []

  const baseVolume = clip.volume ?? 1.0

  if (fadeIn !== undefined) {
    const fadeDuration = Math.max(0, Math.min(duration, fadeIn))
    points = points.filter(p => p.t > fadeDuration && Math.abs(p.t - 0) > 0.02)
    if (fadeDuration > 0) {
      points.push({ t: 0, value: 0, easing: 'linear' })
      points.push({ t: fadeDuration, value: baseVolume, easing: 'linear' })
    }
  }

  if (fadeOut !== undefined) {
    const fadeDuration = Math.max(0, Math.min(duration, fadeOut))
    const fadeStart = Math.max(0, duration - fadeDuration)
    points = points.filter(p => p.t < fadeStart && Math.abs(p.t - duration) > 0.02)
    if (fadeDuration > 0) {
      points.push({ t: fadeStart, value: baseVolume, easing: 'linear' })
      points.push({ t: duration, value: 0, easing: 'linear' })
    }
  }

  points.sort((a, b) => a.t - b.t)
  if (volumeTrackIdx >= 0) {
    currentKeyframes[volumeTrackIdx] = { property: 'volume', points }
  } else if (points.length > 0) {
    currentKeyframes.push({ property: 'volume', points })
  }

  return updateClip(state, clipId, { keyframes: currentKeyframes })
}

export function normalizeClipAudio(
  state: EditorState,
  clipId: string,
  targetLufs: number = -14,
  currentLufs?: number,
  gainDb?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  let calculatedGainDb = gainDb
  if (calculatedGainDb === undefined && currentLufs !== undefined) {
    calculatedGainDb = targetLufs - currentLufs
  }
  if (calculatedGainDb === undefined) {
    calculatedGainDb = 0
  }

  const multiplier = Math.pow(10, calculatedGainDb / 20)
  const currentVol = clip.volume ?? 1.0
  const nextVol = Math.max(0, Math.min(4.0, currentVol * multiplier))

  return updateClip(state, clipId, { volume: nextVol })
}

export function duckClipAudio(
  state: EditorState,
  musicClipId: string,
  speechIntervals: Array<{ start: number; end: number }>,
  options?: {
    duckingDb?: number
    attack?: number
    release?: number
  },
): EditorState {
  const clip = selectClipById(state, musicClipId)
  if (!clip) return state
  const ducked = applyDuckingKeyframes(clip, speechIntervals, options)
  return updateClip(state, musicClipId, ducked)
}

export function detachAudio(state: EditorState, clipId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'video' || clip.muted) return state

  let next = state
  const tracks = selectTracks(next)
  let audioTrackIndex = tracks.findIndex(t => t.kind === 'audio' && !t.locked)
  if (audioTrackIndex === -1) {
    next = addTrack(next, 'audio')
    audioTrackIndex = selectTracks(next).length - 1
  }

  const asset = clip.asset ?? (clip.assetId ? state.editorModel.assets.find(a => a.id === clip.assetId) ?? null : null)
  const audioClipId = makeId('clip-audio')
  const audioClip: TimelineClip = {
    id: audioClipId,
    assetId: clip.assetId,
    type: 'audio',
    startTime: clip.startTime,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    speed: clip.speed,
    reversed: clip.reversed,
    muted: false,
    volume: clip.volume ?? 1.0,
    trackIndex: audioTrackIndex,
    asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    linkedClipIds: [clip.id],
  }

  next = updateClip(next, clip.id, {
    muted: true,
    linkedClipIds: [...(clip.linkedClipIds || []), audioClipId],
  })

  return replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [...tl.clips, audioClip],
  }))
}

/* =========================================================================
 * Timeline Transitions Actions
 * ========================================================================= */

export function setTimelineTransition(
  state: EditorState,
  leftClipId: string,
  rightClipId: string,
  type: string,
  duration: number = 0.5,
  closeGapUpTo?: number,
): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return state

  const result = setTransitionAtCut(
    timeline,
    leftClipId,
    rightClipId,
    type,
    duration,
    () => makeId('transition'),
    { closeGapUpTo },
  )
  if (result.ok) {
    return replaceActiveTimeline(state, () => result.timeline)
  }
  return state
}

export function removeTimelineTransition(state: EditorState, transitionId: string): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return state
  return replaceActiveTimeline(state, tl => removeTransitionById(tl, transitionId))
}

/* =========================================================================
 * Marker Actions
 * ========================================================================= */

export interface AddMarkerParams {
  time?: number
  label?: string
  color?: string
  id?: string
}

export function addMarker(state: EditorState, params?: AddMarkerParams): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return state

  const time = params?.time ?? selectCurrentTime(state)
  const marker: TimelineMarker = {
    id: params?.id ?? makeId('marker'),
    time: Math.max(0, Math.round(time * 1000) / 1000),
    label: params?.label ?? '',
    color: params?.color ?? '#3b82f6',
  }

  const markers = [...(timeline.markers || []), marker].sort((a, b) => a.time - b.time)
  return replaceActiveTimeline(state, tl => ({
    ...tl,
    markers,
  }))
}

export function updateMarker(
  state: EditorState,
  markerId: string,
  patch: Partial<Omit<TimelineMarker, 'id'>>,
): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline || !timeline.markers) return state

  const markers = timeline.markers.map(m => {
    if (m.id !== markerId) return m
    return {
      ...m,
      ...patch,
      time: patch.time !== undefined ? Math.max(0, Math.round(patch.time * 1000) / 1000) : m.time,
    }
  }).sort((a, b) => a.time - b.time)

  return replaceActiveTimeline(state, tl => ({
    ...tl,
    markers,
  }))
}

export function deleteMarker(state: EditorState, markerId: string): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline || !timeline.markers) return state

  return replaceActiveTimeline(state, tl => ({
    ...tl,
    markers: tl.markers!.filter(m => m.id !== markerId),
  }))
}

export function goToPrevMarker(state: EditorState, currentTime?: number): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline || !timeline.markers || timeline.markers.length === 0) return state

  const t = currentTime ?? selectCurrentTime(state)
  const prev = [...timeline.markers].reverse().find(m => m.time < t - 0.05)
  if (prev) {
    return setCurrentTime(state, prev.time)
  }
  return state
}

export function goToNextMarker(state: EditorState, currentTime?: number): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline || !timeline.markers || timeline.markers.length === 0) return state

  const t = currentTime ?? selectCurrentTime(state)
  const next = timeline.markers.find(m => m.time > t + 0.05)
  if (next) {
    return setCurrentTime(state, next.time)
  }
  return state
}

/* =========================================================================
 * Freeze Frame, Punch In & Auto Highlights Actions
 * ========================================================================= */

export interface FreezeFrameParams {
  clipId: string
  time?: number
  duration?: number
  imageAsset?: Asset
}

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

export function setLibraryTab(state: EditorState, tab: any, section?: string): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      libraryTab: tab,
      ...(section ? { librarySection: section } : {}),
    },
  }))
}

export function setLibrarySection(state: EditorState, section: string): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      librarySection: section,
    },
  }))
}

export function setShowEditPilot(state: EditorState, show: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showEditPilot: show,
    },
  }))
}

export function toggleEditPilot(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showEditPilot: !session.ui.showEditPilot,
    },
  }))
}

export function openProjectSettingsModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showProjectSettingsModal: true,
    },
  }))
}

export function closeProjectSettingsModal(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      showProjectSettingsModal: false,
    },
  }))
}

export function setIsAgentSessionActive(state: EditorState, active: boolean): EditorState {
  return {
    ...state,
    projectSync: {
      ...state.projectSync,
      isAgentSessionActive: active,
    },
  }
}

export function replaceEditorModel(state: EditorState, editorModel: EditorModel): EditorState {
  return {
    ...state,
    editorModel,
  }
}

export function setTimelineSettings(
  state: EditorState,
  timelineId: string,
  settings: {
    name?: string
    width?: number
    height?: number
    fps?: number
    background?: TimelineBackground
  },
): EditorState {
  return updateEditorModel(state, model => ({
    ...model,
    timelines: model.timelines.map(tl => {
      if (tl.id !== timelineId) return tl
      return {
        ...tl,
        ...(settings.name !== undefined ? { name: settings.name } : {}),
        ...(settings.width !== undefined ? { width: settings.width } : {}),
        ...(settings.height !== undefined ? { height: settings.height } : {}),
        ...(settings.fps !== undefined ? { fps: settings.fps } : {}),
        ...(settings.background !== undefined ? { background: settings.background } : {}),
      }
    }),
  }))
}

export function setTimelineBackground(
  state: EditorState,
  timelineId: string,
  background?: TimelineBackground,
): EditorState {
  return setTimelineSettings(state, timelineId, { background })
}

/* =========================================================================
 * B-roll Copilot Actions (KE-904)
 * ========================================================================= */

export interface InsertBrollParams {
  assetId?: string
  assetPath?: string
  startTime: number
  duration: number
  trackIndex?: number
  fadeIn?: number
  fadeOut?: number
  muteAudio?: boolean
}

/**
 * Applies a saved template as a NEW timeline beside the current one.
 *
 * Never in place. A template rewrites the frame size, every clip and every
 * transition, so applying it over the timeline the user is working in would be
 * an undoable-but-alarming wipe of their edit. A new timeline lets them play
 * both and keep the one they prefer — the same reasoning as timeline variants,
 * which is why the result carries a `variantTag`.
 */
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
export function clearRejectedEdit(state: EditorState): EditorState {
  if (state.session.ui.lastRejectedEdit === null) return state
  return updateSession(state, session => ({
    ...session,
    ui: { ...session.ui, lastRejectedEdit: null },
  }))
}
