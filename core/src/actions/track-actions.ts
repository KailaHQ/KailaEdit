import type { Track } from '../project-model'
import type { EditorState } from '../editor-state'
import { selectActiveTimeline, selectTracks } from '../editor-selectors'
import { makeId } from '../id-generator'
import {
  setTransitionAtCut,
  removeTransitionById,
} from '../timeline-transitions'
import { replaceActiveTimeline, mapClips, mapTracks } from './timeline-actions'

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

