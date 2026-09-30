import { refitTextAnimations } from '../text-animations'
import type { SetStateAction } from 'react'
import type {
  Timeline,
  TimelineClip,
  Track,
  TimelineMarker,
  TimelineBackground,
  TimelineCover,
  SubtitleClip,
  Asset,
} from '../project-model'
import {
  createDefaultTimeline,
  createAssetBinId,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
} from '../project-model'
import { validateTimeline, setLastTimelineValidationError } from '../validator'
import type { EditorState, EditorModel } from '../editor-state'
import {
  selectActiveTimeline,
  selectActiveTimelineId,
  selectCurrentTime,
  selectContentDuration,
} from '../editor-selectors'
import type { ParsedTimeline } from '../timeline-import'
import { makeId } from '../id-generator'
import { pruneOrphanTransitions } from '../timeline-transitions'
import {
  updateEditorModel,
  updateSession,
  withActiveTimeline,
  markEditorModelDirty,
  applyStateAction,
} from './action-helpers'
import type { AddMarkerParams } from './types'

/** The frame's width over its height, when the timeline records one. */
export function frameAspectOf(timeline: Pick<Timeline, 'width' | 'height'>): number | undefined {
  return timeline.width && timeline.height ? timeline.width / timeline.height : undefined
}

export function replaceActiveTimeline(state: EditorState, updater: (timeline: Timeline) => Timeline): EditorState {
  const active = selectActiveTimeline(state)
  if (!active) return state
  const drafted = updater(active)
  const refitted = refitTextAnimations(drafted.clips, frameAspectOf(drafted))
  const updated = refitted === drafted.clips ? drafted : { ...drafted, clips: refitted }
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
    return updateSession(withClearedRejected, s => ({ ...s, transport: { ...s.transport, currentTime: contentDuration } }))
  }

  return withClearedRejected
}


export function mapClips(state: EditorState, mapper: (clip: TimelineClip) => TimelineClip): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips.map(mapper),
  }))
}

export function mapTracks(state: EditorState, mapper: (track: Track, index: number) => Track): EditorState {
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


/**
 * Applies a saved template as a NEW timeline beside the current one.
 *
 * Never in place. A template rewrites the frame size, every clip and every
 * transition, so applying it over the timeline the user is working in would be
 * an undoable-but-alarming wipe of their edit. A new timeline lets them play
 * both and keep the one they prefer — the same reasoning as timeline variants,
 * which is why the result carries a `variantTag`.
 */

export function setTimelineCover(state: EditorState, cover: TimelineCover | undefined): EditorState {
  return updateEditorModel(state, editorModel => withActiveTimeline(editorModel, timeline => ({
    ...timeline,
    cover,
  })))
}
