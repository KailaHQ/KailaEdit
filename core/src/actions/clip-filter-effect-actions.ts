import type {
  ClipEffect,
  EffectType,
  TimelineClip,
} from '../project-model'
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectTracks,
  selectCurrentTime,
  selectClipById,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import { getFilterDefinition } from '../filters'
import { mainVideoTrackIndex } from '../video-editor-utils'
import { replaceActiveTimeline } from './timeline-actions'
import { addTrack } from './track-actions'
import { updateClip } from './clip-core-actions'

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
