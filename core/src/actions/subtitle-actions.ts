import type {
  SubtitleClip,
  SubtitleStyle,
  Track,
} from '../project-model'
import type { SrtCue } from '../srt'
import {
  toTranscriptSegments,
  upsertAssetTranscript,
  type TranscriptSegment,
} from '../transcript-store'
import type { EditorState } from '../editor-state'
import {
  selectCurrentTime,
  selectTracks,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import type { AddSubtitleParams } from './types'
import {
  updateSession,
  markEditorModelDirty,
} from './action-helpers'
import { replaceActiveTimeline, setTimelineSubtitles, mapTracks } from './timeline-actions'

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

