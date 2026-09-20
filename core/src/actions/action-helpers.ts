import type { SetStateAction } from 'react'
import type {
  Asset,
  AssetBins,
  Timeline,
  TimelineClip,
  Track,
} from '../project-model'
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_LETTERBOX,
} from '../project-model'
import { makeId } from '../id-generator'
import { mainVideoTrackIndex } from '../video-editor-utils'
import type { EditorModel, EditorState } from '../editor-state'
import {
  getActiveTimelineFromEditorModel,
  selectClips,
  selectTracks,
  selectCurrentTime,
} from '../editor-selectors'
import type { SourceEditParams } from './types'

export function deleteBinEntry(bins: AssetBins, binId: string): AssetBins {
  const { [binId]: _removed, ...rest } = bins
  return rest
}

export function markEditorModelDirty(state: EditorState): EditorState {
  if (state.projectSync.dirty) return state
  return {
    ...state,
    projectSync: {
      ...state.projectSync,
      dirty: true,
    },
  }
}

export function cloneClipIds(ids: Set<string>): Set<string> {
  return new Set(ids)
}

export function applyStateAction<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === 'function'
    ? (value as (prevState: T) => T)(current)
    : value
}

export function updateEditorModel(state: EditorState, updater: (editorModel: EditorModel) => EditorModel): EditorState {
  const nextEditorModel = updater(state.editorModel)
  if (nextEditorModel === state.editorModel) return state
  return markEditorModelDirty({
    ...state,
    editorModel: nextEditorModel,
  })
}

export function updateSession(state: EditorState, updater: (session: EditorState['session']) => EditorState['session']): EditorState {
  const nextSession = updater(state.session)
  if (nextSession === state.session) return state
  return {
    ...state,
    session: nextSession,
  }
}

export function withActiveTimeline(editorModel: EditorModel, updater: (timeline: Timeline) => Timeline): EditorModel {
  const activeTimeline = getActiveTimelineFromEditorModel(editorModel)
  if (!activeTimeline) return editorModel
  return {
    ...editorModel,
    timelines: editorModel.timelines.map(timeline => (
      timeline.id === activeTimeline.id ? updater(timeline) : timeline
    )),
  }
}

export function activeTrackStartTime(state: EditorState, trackIndex: number): number {
  return selectClips(state)
    .filter(clip => clip.trackIndex === trackIndex)
    .reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
}

export function createTimelineClipFromAsset(asset: Asset, trackIndex: number, startTime: number): TimelineClip {
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

export type DroppedAssetInsertion = {
  tracks: Track[]
  clips: TimelineClip[]
  duration: number
}

export function buildDroppedVisualClipInsertion(
  asset: Asset,
  trackIndex: number,
  startTime: number,
  tracks: Track[],
): DroppedAssetInsertion {
  let nextTracks = tracks
  let visualTrackIndex = trackIndex
  let track = nextTracks[visualTrackIndex]

  if (!track || track.locked || track.kind !== 'video' || track.type === 'subtitle') {
    const mainIdx = mainVideoTrackIndex(nextTracks)
    if (mainIdx >= 0 && !nextTracks[mainIdx]?.locked) {
      visualTrackIndex = mainIdx
    } else {
      visualTrackIndex = nextTracks.findIndex(t => t.kind === 'video' && t.type !== 'subtitle' && !t.locked)
    }
    if (visualTrackIndex < 0) {
      const videoTrackCount = nextTracks.filter(candidate => candidate.kind === 'video' && candidate.type !== 'subtitle').length
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

export function buildDroppedAudioClipInsertion(
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

export function buildDroppedAssetInsertion(
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

export function getNextAdjustmentLayerName(assets: Asset[]): string {
  const count = assets.filter(asset => asset.type === 'adjustment').length
  return count > 0 ? `Adjustment Layer ${count + 1}` : 'Adjustment Layer'
}

export function createAdjustmentAsset(name = 'Adjustment Layer'): Asset {
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

export function createAdjustmentClip(asset: Asset, startTime = 0, trackIndex = 0, duration = 10): TimelineClip {
  return {
    ...createTimelineClipFromAsset(asset, trackIndex, startTime),
    type: 'adjustment',
    duration,
    letterbox: { ...DEFAULT_LETTERBOX },
  }
}

export function buildSourceRequestClips(state: EditorState, params: SourceEditParams): {
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
    ? tracks.find(track => !track.locked && track.sourcePatched !== false && track.kind === 'video' && track.type !== 'subtitle')
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

