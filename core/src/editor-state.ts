import type {
  Asset,
  AssetBins,
  KeyframeProperty,
  SubtitleClip,
  SubtitleStyle,
  Timeline,
  TimelineClip,
  Track,
} from './project-model'
import type { AssetTranscript } from './transcript-store'
import {
  DEFAULT_LAYOUT,
  type EditorLayout,
  type ToolType,
} from './video-editor-utils'

export interface EditorModel {
  assets: Asset[]
  bins: AssetBins
  timelines: Timeline[]
  activeTimelineId: string | null
  /** What Whisper heard, shared by captions, highlights and B-roll. */
  transcripts?: AssetTranscript[]
}

export interface TimelineGapSelection {
  trackIndex: number
  startTime: number
  endTime: number
}

export interface TimelineInOutRange {
  inPoint: number | null
  outPoint: number | null
}

export interface EditorUndoSnapshot {
  assets: Asset[]
  bins: AssetBins
  timelines: Timeline[]
}

export interface EditorClipboardState {
  kind: 'clips' | null
  clips: TimelineClip[]
  copiedFromTimelineId: string | null
}

export interface EditorHistoryState {
  undoStack: EditorUndoSnapshot[]
  redoStack: EditorUndoSnapshot[]
}

export interface EditorProjectSyncState {
  dirty: boolean
  isAgentSessionActive?: boolean
}

export interface KeyframeSelection {
  clipId: string
  t: number
  property?: KeyframeProperty
}

export interface EditorSelectionState {
  clipIds: Set<string>
  subtitleId: string | null
  editingSubtitleId: string | null
  gap: TimelineGapSelection | null
  selectedKeyframe: KeyframeSelection | null
}

export interface EditorTransportState {
  currentTime: number
  isPlaying: boolean
  shuttleSpeed: number
  playingInOut: boolean
  timelineInOutMap: Record<string, TimelineInOutRange>
}

export interface EditorToolsState {
  zoom: number
  snapEnabled: boolean
  activeTool: ToolType
  lastTrimTool: ToolType
}

/**
 * The tabs on the rail under the title bar. Whichever one is active
 * decides both the sub-nav pills in the narrow left column and what the
 * library panel next to them renders.
 */
export type LibraryTab =
  | 'media'
  | 'audio'
  | 'text'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'captions'
  | 'filters'
  | 'adjust'
  | 'templates'

export interface EditorUiState {
  libraryTab: LibraryTab
  /** Selected pill within the active tab's sub-nav, e.g. 'import' under Media. */
  librarySection: string
  showImportTimelineModal: boolean
  showExportModal: boolean
  showProjectSettingsModal: boolean
  showSourceMonitor: boolean
  showPropertiesPanel: boolean
  showEffectsBrowser: boolean
  /** The EditPilot chat panel, docked on the right. Closed until asked for. */
  showEditPilot: boolean
  activeFocusArea: 'source' | 'timeline'
  sourceSplitPercent: number
  hasSourceAsset: boolean
  previewAssetId: string | null
  openTimelineIds: Set<string>
  renamingTimelineId: string | null
  renameValue: string
  renameSource: 'tab' | 'panel'
  layout: EditorLayout
  subtitleTrackStyleIdx: number | null
  cropMode: boolean
  maskMode: boolean
  eyedropperMode: boolean
  /**
   * Why the last edit was refused, or null when nothing was.
   *
   * The timeline validator turns down edits that would break an invariant —
   * a gap on the magnetic track, a write to a locked one. That rejection used
   * to be recorded in a module variable nothing read, so from the user's side
   * the control simply did nothing. Keeping it in session state lets the UI
   * say what happened.
   */
  lastRejectedEdit: { rule: string; message: string } | null
}

export interface EditorSessionState {
  selection: EditorSelectionState
  transport: EditorTransportState
  tools: EditorToolsState
  ui: EditorUiState
  clipboard: EditorClipboardState
}

export const MAX_UNDO_HISTORY = 50

export interface EditorTransactionState {
  id: string
  baseState: EditorState
  baseSnapshot: EditorUndoSnapshot
  startedAt: number
}

export interface EditorState {
  editorModel: EditorModel
  session: EditorSessionState
  history: EditorHistoryState
  projectSync: EditorProjectSyncState
  transaction?: EditorTransactionState | null
}

export interface TimelineListItem {
  timeline: Timeline
  isActive: boolean
  isOpen: boolean
  isRenaming: boolean
  clipCount: number
  duration: number
}

export interface ClipDimensions {
  width: number
  height: number
}

export interface ClipResolutionInfo {
  label: string
  color: string
  height: number
  displayName: string
}

export interface OrderedTrackEntry {
  track: Track
  realIndex: number
  displayRow: number
}

export interface TimelineCutPoint {
  leftClip: TimelineClip
  rightClip: TimelineClip
  time: number
  trackIndex: number
  hasDissolve: boolean
}

export interface ClipMetadata {
  liveAsset: Asset | null | undefined
  dimensions: ClipDimensions | null
  resolution: ClipResolutionInfo | null
  filePath: string
  isUpscaled: boolean
}

export interface ClipCapabilities {
  isVideo: boolean
  isImage: boolean
  isAudio: boolean
  isAdjustment: boolean
  isText: boolean
}

export interface SelectedClipPropertiesModel {
  clip: TimelineClip
  metadata: ClipMetadata
  capabilities: ClipCapabilities
}

export interface SelectedSubtitleEditorModel {
  subtitle: SubtitleClip
  track: Track | undefined
  effectiveStyle: Partial<SubtitleStyle>
}

export interface SubtitleTrackStyleEditorModel {
  trackIndex: number
  track: Track
  style: SubtitleStyle
}

export interface KeyboardCommandContext {
  clips: TimelineClip[]
  selectedClipIds: Set<string>
  totalDuration: number
  currentTime: number
  inPoint: number | null
  outPoint: number | null
}

export interface MenuState {
  selectedClip: TimelineClip | null
  selectedClipIds: Set<string>
  clips: TimelineClip[]
  tracks: Track[]
  subtitles: SubtitleClip[]
  snapEnabled: boolean
  showEffectsBrowser: boolean
  showSourceMonitor: boolean
  showPropertiesPanel: boolean
  hasSourceAsset: boolean
  activeTool: ToolType
  activeTimeline: Timeline | null
  timelines: Timeline[]
}

export interface AssetListFilters {
  assetFilter?: Asset['type'] | 'all'
  selectedBinId?: string | null
  assetViewMode?: 'grid' | 'list'
  listSortCol?: 'name' | 'type' | 'duration' | 'resolution' | 'date' | 'color'
  listSortDir?: 'asc' | 'desc'
}

export const EMPTY_IN_OUT_RANGE: TimelineInOutRange = {
  inPoint: null,
  outPoint: null,
}

export function createInitialEditorState(
  editorModel: EditorModel,
  layout: EditorLayout = DEFAULT_LAYOUT,
): EditorState {
  return {
    editorModel,
    session: {
      selection: {
        clipIds: new Set(),
        subtitleId: null,
        editingSubtitleId: null,
        gap: null,
        selectedKeyframe: null,
      },
      transport: {
        currentTime: 0,
        isPlaying: false,
        shuttleSpeed: 0,
        playingInOut: false,
        timelineInOutMap: {},
      },
      tools: {
        zoom: 1,
        snapEnabled: true,
        activeTool: 'select',
        lastTrimTool: 'ripple',
      },
      ui: {
        libraryTab: 'media',
        librarySection: 'import',
        showImportTimelineModal: false,
        showExportModal: false,
        showProjectSettingsModal: false,
        showSourceMonitor: false,
        // Open by default: it is the only place clip volume, transform and
        // colour live, and a hidden panel made them undiscoverable.
        showPropertiesPanel: true,
        showEffectsBrowser: false,
        showEditPilot: false,
        activeFocusArea: 'timeline',
        sourceSplitPercent: 50,
        hasSourceAsset: false,
        previewAssetId: null,
        openTimelineIds: editorModel.activeTimelineId ? new Set([editorModel.activeTimelineId]) : new Set(),
        renamingTimelineId: null,
        renameValue: '',
        renameSource: 'tab',
        layout,
        subtitleTrackStyleIdx: null,
        cropMode: false,
        maskMode: false,
        eyedropperMode: false,
        lastRejectedEdit: null,
      },
      clipboard: {
        kind: null,
        clips: [],
        copiedFromTimelineId: null,
      },
    },
    history: {
      undoStack: [],
      redoStack: [],
    },
    projectSync: {
      dirty: false,
      isAgentSessionActive: false,
    },
    transaction: null,
  }
}

export function getUndoSnapshot(state: EditorState): EditorUndoSnapshot {
  return {
    assets: state.editorModel.assets,
    bins: state.editorModel.bins,
    timelines: state.editorModel.timelines,
  }
}

export function applyUndoSnapshot(
  state: EditorState,
  snapshot: EditorUndoSnapshot,
): EditorState {
  return {
    ...state,
    editorModel: {
      ...state.editorModel,
      assets: snapshot.assets,
      bins: snapshot.bins,
      timelines: snapshot.timelines,
    },
  }
}

export function equalUndoSnapshot(
  left: EditorUndoSnapshot,
  right: EditorUndoSnapshot,
): boolean {
  return left.assets === right.assets && left.bins === right.bins && left.timelines === right.timelines
}
