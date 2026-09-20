import type { SetStateAction } from 'react'
import type { EditorLayout, ToolType } from '../video-editor-utils'
import type {
  EditorState,
  EditorModel,
  TimelineGapSelection,
  KeyframeSelection,
} from '../editor-state'
import {
  applyUndoSnapshot,
  equalUndoSnapshot,
  getUndoSnapshot,
  createInitialEditorState,
} from '../editor-state'
import type { Project } from '../project-model'
import {
  selectActiveTimeline,
  selectActiveTimelineId,
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectClips,
  selectContentDuration,
  selectCurrentTime,
  selectSelectedClipIds,
  selectCanUseClipboard,
  selectAssetById,
} from '../editor-selectors'
import { getEditorModel, updatedProject } from '../editor-project-bridging'
import { makeId } from '../id-generator'
import type { SelectClipMode } from './types'
import {
  updateSession,
  cloneClipIds,
  applyStateAction,
} from './action-helpers'
import { deleteClips } from './clip-core-actions'
import { replaceActiveTimeline } from './timeline-actions'

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


export function clearRejectedEdit(state: EditorState): EditorState {
  if (state.session.ui.lastRejectedEdit === null) return state
  return updateSession(state, session => ({
    ...session,
    ui: { ...session.ui, lastRejectedEdit: null },
  }))
}

/** Sets or updates the cover metadata for the active timeline. */
