import {
  COLOR_LABELS,
  CUT_POINT_TOLERANCE,
  type ToolType,
} from './video-editor-utils'
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TRACKS,
} from './project-model'
import type {
  Asset,
  ClipTransform,
  ColorCorrection,
  SubtitleClip,
  SubtitleStyle,
  Timeline,
  TimelineClip,
  TimelineMarker,
  Track,
  ClipMask,
  ChromaKey,
  ClipBlendMode,
} from './project-model'
import {
  namedResolutionDisplayName,
  namedResolutionTier,
} from './video-resolution'
import type {
  AssetListFilters,
  ClipCapabilities,
  ClipDimensions,
  ClipMetadata,
  ClipResolutionInfo,
  EditorModel,
  EditorState,
  KeyboardCommandContext,
  MenuState,
  OrderedTrackEntry,
  SelectedClipPropertiesModel,
  SelectedSubtitleEditorModel,
  SubtitleTrackStyleEditorModel,
  TimelineCutPoint,
  TimelineGapSelection,
  KeyframeSelection,
  TimelineInOutRange,
  TimelineListItem,
} from './editor-state'

export interface ExportLetterbox {
  ratio: number
  color: string
  opacity: number
}

export interface ExportClipData {
  path: string
  type: string
  startTime: number
  duration: number
  trimStart: number
  speed: number
  reversed: boolean
  flipH: boolean
  flipV: boolean
  opacity: number
  trackIndex: number
  muted: boolean
  volume: number
  id: string
  linkedClipIds?: string[]
  transform?: ClipTransform
  colorCorrection?: ColorCorrection
  transitionIn?: { type: string; duration: number }
  transitionOut?: { type: string; duration: number }
  effects?: Array<{ type: string; enabled: boolean; params: Record<string, number> }>
  textStyle?: {
    text: string
    fontSize: number
    color: string
    backgroundColor: string
    positionX: number
    positionY: number
    strokeColor: string
    strokeWidth: number
    padding: number
    opacity: number
  }
}

export interface ExportSubtitleData {
  text: string
  startTime: number
  endTime: number
  style: SubtitleStyle
}

export interface ExportModalModel {
  timeline: Timeline | null
  clips: TimelineClip[]
  tracks: Track[]
  exportClips: ExportClipData[]
  subtitleData: ExportSubtitleData[]
  letterbox: ExportLetterbox | null
}

export interface ClipAudioControlsModel {
  targetClipId: string
  muted: boolean
  volume: number
}

const EMPTY_CLIPS: TimelineClip[] = []
const EMPTY_SUBTITLES: SubtitleClip[] = []
const EMPTY_MARKERS: TimelineMarker[] = []
const DEFAULT_TIMELINE_TRACKS: Track[] = DEFAULT_TRACKS.map(track => ({ ...track }))
const EMPTY_TIMELINE_IN_OUT_RANGE: TimelineInOutRange = { inPoint: null, outPoint: null }
const LETTERBOX_RATIO_MAP: Record<string, number> = {
  '2.35:1': 2.35,
  '2.39:1': 2.39,
  '2.76:1': 2.76,
  '1.85:1': 1.85,
  '4:3': 4 / 3,
}

function parseResolutionHeight(resolution?: string): number {
  const match = resolution?.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

export function getActiveTimelineFromEditorModel(editorModel: EditorModel): Timeline | null {
  if (editorModel.timelines.length === 0) return null
  return editorModel.timelines.find(timeline => timeline.id === editorModel.activeTimelineId)
    || editorModel.timelines[0]
}

export function selectEditorModel(state: EditorState): EditorModel {
  return state.editorModel
}

export function selectSession(state: EditorState): EditorState['session'] {
  return state.session
}

export function selectHistory(state: EditorState): EditorState['history'] {
  return state.history
}

export function selectCanUndo(state: EditorState): boolean {
  return state.history.undoStack.length > 0
}

export function selectCanRedo(state: EditorState): boolean {
  return state.history.redoStack.length > 0
}

export function selectAssets(state: EditorState): Asset[] {
  return state.editorModel.assets
}

export function selectTimelines(state: EditorState): Timeline[] {
  return state.editorModel.timelines
}

export function selectActiveTimelineId(state: EditorState): string | null {
  return state.editorModel.activeTimelineId
}

export function selectActiveTimeline(state: EditorState): Timeline | null {
  return getActiveTimelineFromEditorModel(state.editorModel)
}

export function selectActiveTimelineFps(state: EditorState): number | undefined {
  return getActiveTimelineFromEditorModel(state.editorModel)?.fps
}

export function selectTimelineById(state: EditorState, timelineId: string): Timeline | undefined {
  return state.editorModel.timelines.find(timeline => timeline.id === timelineId)
}

export function selectClipById(state: EditorState, clipId: string | null | undefined): TimelineClip | undefined {
  if (!clipId) return undefined
  return selectClips(state).find(clip => clip.id === clipId)
}

export function selectClips(state: EditorState): TimelineClip[] {
  return selectActiveTimeline(state)?.clips || EMPTY_CLIPS
}

export function selectTracks(state: EditorState): Track[] {
  return selectActiveTimeline(state)?.tracks || DEFAULT_TIMELINE_TRACKS
}

export function selectSubtitles(state: EditorState): SubtitleClip[] {
  return selectActiveTimeline(state)?.subtitles || EMPTY_SUBTITLES
}

export function selectActiveTimelineClips(state: EditorState, timelineId?: string): TimelineClip[] {
  const timeline = timelineId ? selectTimelineById(state, timelineId) : selectActiveTimeline(state)
  return timeline?.clips || EMPTY_CLIPS
}

export function selectActiveTimelineTracks(state: EditorState, timelineId?: string): Track[] {
  const timeline = timelineId ? selectTimelineById(state, timelineId) : selectActiveTimeline(state)
  return timeline?.tracks || DEFAULT_TIMELINE_TRACKS
}

export function selectActiveTimelineSubtitles(state: EditorState, timelineId?: string): SubtitleClip[] {
  const timeline = timelineId ? selectTimelineById(state, timelineId) : selectActiveTimeline(state)
  return timeline?.subtitles || EMPTY_SUBTITLES
}

export function selectMarkers(state: EditorState): TimelineMarker[] {
  return selectActiveTimeline(state)?.markers || EMPTY_MARKERS
}

export function selectActiveTimelineMarkers(state: EditorState, timelineId?: string): TimelineMarker[] {
  const timeline = timelineId ? selectTimelineById(state, timelineId) : selectActiveTimeline(state)
  return timeline?.markers || EMPTY_MARKERS
}

export function selectMarkerById(state: EditorState, markerId: string): TimelineMarker | undefined {
  return selectMarkers(state).find(marker => marker.id === markerId)
}

export function selectSelectedClipIds(state: EditorState): Set<string> {
  return state.session.selection.clipIds
}

export function selectSelectedSubtitleId(state: EditorState): string | null {
  return state.session.selection.subtitleId
}

export function selectEditingSubtitleId(state: EditorState): string | null {
  return state.session.selection.editingSubtitleId
}

export function selectSelectedGap(state: EditorState): TimelineGapSelection | null {
  return state.session.selection.gap
}

export function selectSelectedKeyframe(state: EditorState): KeyframeSelection | null {
  return state.session.selection.selectedKeyframe ?? null
}

export function selectSelectedClips(state: EditorState): TimelineClip[] {
  const selectedIds = selectSelectedClipIds(state)
  return selectClips(state).filter(clip => selectedIds.has(clip.id))
}

export function selectSingleSelectedClip(state: EditorState): TimelineClip | null {
  const selectedIds = [...selectSelectedClipIds(state)]
  if (selectedIds.length !== 1) return null
  return selectClips(state).find(clip => clip.id === selectedIds[0]) ?? null
}

export function selectSelectedLinkedGroup(state: EditorState, clipId: string): TimelineClip[] {
  const clips = selectClips(state)
  const first = clips.find(clip => clip.id === clipId)
  if (!first) return []

  const linkedGroup = new Set([first.id])
  const queue = [first.id]
  while (queue.length > 0) {
    const id = queue.pop()!
    const clip = clips.find(candidate => candidate.id === id)
    if (!clip?.linkedClipIds) continue
    for (const linkedId of clip.linkedClipIds) {
      if (!linkedGroup.has(linkedId) && clips.some(candidate => candidate.id === linkedId)) {
        linkedGroup.add(linkedId)
        queue.push(linkedId)
      }
    }
  }

  return clips.filter(clip => linkedGroup.has(clip.id))
}

export function selectSelectedClipForProperties(state: EditorState): TimelineClip | null {
  const clips = selectClips(state)
  const selectedClipIds = selectSelectedClipIds(state)
  if (selectedClipIds.size === 0) return null
  if (selectedClipIds.size === 1) return clips.find(clip => clip.id === [...selectedClipIds][0]) ?? null

  const selectedIds = [...selectedClipIds]
  const first = clips.find(clip => clip.id === selectedIds[0])
  if (!first) return null

  const linkedGroup = selectSelectedLinkedGroup(state, first.id)
  const linkedIdSet = new Set(linkedGroup.map(clip => clip.id))
  const allInGroup = selectedIds.every(id => linkedIdSet.has(id)) && linkedIdSet.size === selectedClipIds.size
  if (!allInGroup) return null

  return linkedGroup.find(clip => clip.type === 'video' || clip.type === 'image') ?? first
}

export function selectClipAudioControls(
  state: EditorState,
  clipId: string | null | undefined,
): ClipAudioControlsModel | null {
  const clip = selectClipById(state, clipId)
  if (!clip) return null

  if (clip.type === 'audio') {
    return {
      targetClipId: clip.id,
      muted: clip.muted || false,
      volume: clip.volume ?? 1,
    }
  }

  const linkedAudioClip = (clip.linkedClipIds || [])
    .map(linkedId => selectClipById(state, linkedId))
    .find(candidate => candidate?.type === 'audio')

  const targetClip = linkedAudioClip ?? clip
  return {
    targetClipId: targetClip.id,
    muted: targetClip.muted || false,
    volume: targetClip.volume ?? 1,
  }
}

export function selectSelectedClipAudioControls(state: EditorState): ClipAudioControlsModel | null {
  const clip = selectSelectedClipForProperties(state)
  if (!clip) return null
  return selectClipAudioControls(state, clip.id)
}

export function selectSelectedSubtitle(state: EditorState): SubtitleClip | null {
  const subtitleId = selectSelectedSubtitleId(state)
  if (!subtitleId) return null
  return selectSubtitles(state).find(subtitle => subtitle.id === subtitleId) ?? null
}

export function selectOpenTimelines(state: EditorState): Timeline[] {
  const openIds = state.session.ui.openTimelineIds
  return state.editorModel.timelines.filter(timeline => openIds.has(timeline.id))
}

export function selectOpenTimelineIds(state: EditorState): Set<string> {
  return state.session.ui.openTimelineIds
}

export function selectTimelineListItems(state: EditorState): TimelineListItem[] {
  const activeTimelineId = selectActiveTimelineId(state)
  const openTimelineIds = state.session.ui.openTimelineIds
  const renamingTimelineId = state.session.ui.renamingTimelineId
  return state.editorModel.timelines.map(timeline => ({
    timeline,
    isActive: timeline.id === activeTimelineId,
    isOpen: openTimelineIds.has(timeline.id),
    isRenaming: renamingTimelineId === timeline.id,
    clipCount: timeline.clips.length,
    duration: timeline.clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0),
  }))
}

export function selectCurrentTime(state: EditorState): number {
  return state.session.transport.currentTime
}

export function selectIsPlaying(state: EditorState): boolean {
  return state.session.transport.isPlaying
}

export function selectShuttleSpeed(state: EditorState): number {
  return state.session.transport.shuttleSpeed
}

export function selectPlayingInOut(state: EditorState): boolean {
  return state.session.transport.playingInOut
}

export function selectTimelineInOutMap(state: EditorState): Record<string, TimelineInOutRange> {
  return state.session.transport.timelineInOutMap
}

export function selectActiveTimelineInOutRange(state: EditorState): TimelineInOutRange {
  const activeTimelineId = selectActiveTimelineId(state) || ''
  return state.session.transport.timelineInOutMap[activeTimelineId] || EMPTY_TIMELINE_IN_OUT_RANGE
}

export function selectActiveTimelineInPoint(state: EditorState): number | null {
  return selectActiveTimelineInOutRange(state).inPoint
}

export function selectActiveTimelineOutPoint(state: EditorState): number | null {
  return selectActiveTimelineInOutRange(state).outPoint
}

export function selectTotalDuration(state: EditorState): number {
  return Math.max(
    selectClips(state).reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0),
    30,
  )
}

/**
 * The actual content duration on the active timeline (end of the latest clip or subtitle).
 * Returns 0 if the timeline has no clips and no subtitles.
 */
export function selectContentDuration(state: EditorState): number {
  const clips = selectClips(state)
  const activeTimeline = selectActiveTimeline(state)
  const subtitles = activeTimeline?.subtitles || []
  let max = 0
  for (const clip of clips) {
    const end = clip.startTime + clip.duration
    if (end > max) max = end
  }
  for (const sub of subtitles) {
    const end = sub.endTime
    if (end > max) max = end
  }
  return max
}

export function selectZoom(state: EditorState): number {
  return state.session.tools.zoom
}

export function selectPixelsPerSecond(state: EditorState): number {
  return 100 * selectZoom(state)
}

export function selectSnapEnabled(state: EditorState): boolean {
  return state.session.tools.snapEnabled
}

export function selectActiveTool(state: EditorState): ToolType {
  return state.session.tools.activeTool
}

export function selectLastTrimTool(state: EditorState): ToolType {
  return state.session.tools.lastTrimTool
}

export function selectShowSourceMonitor(state: EditorState): boolean {
  return state.session.ui.showSourceMonitor
}

export function selectShowImportTimelineModal(state: EditorState): boolean {
  return state.session.ui.showImportTimelineModal
}

export function selectShowExportModal(state: EditorState): boolean {
  return state.session.ui.showExportModal
}

export function selectShowProjectSettingsModal(state: EditorState): boolean {
  return state.session.ui.showProjectSettingsModal
}

export function selectShowPropertiesPanel(state: EditorState): boolean {
  return state.session.ui.showPropertiesPanel
}

export function selectShowEditPilot(state: EditorState): boolean {
  return state.session.ui.showEditPilot
}

export function selectIsAgentSessionActive(state: EditorState): boolean {
  return Boolean(state.projectSync?.isAgentSessionActive)
}

export function selectShowEffectsBrowser(state: EditorState): boolean {
  return state.session.ui.showEffectsBrowser
}

export function selectActiveFocusArea(state: EditorState): 'source' | 'timeline' {
  return state.session.ui.activeFocusArea
}

export function selectSourceSplitPercent(state: EditorState): number {
  return state.session.ui.sourceSplitPercent
}

export function selectHasSourceAsset(state: EditorState): boolean {
  return state.session.ui.hasSourceAsset
}

export function selectPreviewAssetId(state: EditorState): string | null {
  return state.session.ui.previewAssetId ?? null
}

export function selectPreviewAsset(state: EditorState): Asset | null {
  const id = state.session.ui.previewAssetId
  if (!id) return null
  return state.editorModel.assets.find(a => a.id === id) ?? null
}

export function selectTimelineRenameState(state: EditorState): Pick<EditorState['session']['ui'], 'renamingTimelineId' | 'renameValue' | 'renameSource'> {
  return {
    renamingTimelineId: state.session.ui.renamingTimelineId,
    renameValue: state.session.ui.renameValue,
    renameSource: state.session.ui.renameSource,
  }
}

export function selectLayout(state: EditorState) {
  return state.session.ui.layout
}

export function selectLibraryTab(state: EditorState) {
  return state.session.ui.libraryTab
}

export function selectLibrarySection(state: EditorState) {
  return state.session.ui.librarySection
}

export function selectCropMode(state: EditorState): boolean {
  return state.session.ui.cropMode ?? false
}

export function selectMaskMode(state: EditorState): boolean {
  return state.session.ui.maskMode ?? false
}

export function selectEyedropperMode(state: EditorState): boolean {
  return state.session.ui.eyedropperMode ?? false
}

export function selectClipMask(state: EditorState, clipId: string): ClipMask | undefined {
  const timeline = selectActiveTimeline(state)
  return timeline?.clips.find(c => c.id === clipId)?.mask
}

export function selectClipChromaKey(state: EditorState, clipId: string): ChromaKey | undefined {
  const timeline = selectActiveTimeline(state)
  return timeline?.clips.find(c => c.id === clipId)?.chromaKey
}

export function selectClipBlendMode(state: EditorState, clipId: string): ClipBlendMode {
  const timeline = selectActiveTimeline(state)
  return timeline?.clips.find(c => c.id === clipId)?.blendMode ?? 'normal'
}

export function selectSubtitleTrackStyleIdx(state: EditorState): number | null {
  return state.session.ui.subtitleTrackStyleIdx
}

export function selectSubtitleTrackStyleEditorModel(state: EditorState): SubtitleTrackStyleEditorModel | null {
  const trackIndex = selectSubtitleTrackStyleIdx(state)
  if (trackIndex === null) return null
  const track = selectTracks(state)[trackIndex]
  if (!track || track.type !== 'subtitle') return null
  return {
    trackIndex,
    track,
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(track.subtitleStyle || {}),
    },
  }
}

export function selectAssetById(state: EditorState, assetId: string | null | undefined): Asset | undefined {
  if (!assetId) return undefined
  return state.editorModel.assets.find(asset => asset.id === assetId)
}

function findAssetById(assets: Asset[], assetId: string | null | undefined): Asset | undefined {
  if (!assetId) return undefined
  return assets.find(asset => asset.id === assetId)
}

export function selectLiveAssetForClipFromAssets(
  assets: Asset[],
  clip: TimelineClip | null | undefined,
): Asset | null | undefined {
  if (!clip) return null
  if (!clip.assetId) return clip.asset
  return findAssetById(assets, clip.assetId) || clip.asset
}

export function selectLiveAssetForClip(state: EditorState, clip: TimelineClip | null | undefined): Asset | null | undefined {
  return selectLiveAssetForClipFromAssets(selectAssets(state), clip)
}

export function selectClipPathFromAssets(assets: Asset[], clip: TimelineClip | null | undefined): string {
  if (!clip) return ''
  const liveAsset = selectLiveAssetForClipFromAssets(assets, clip)
  const src = liveAsset ? liveAsset.path : (clip.asset?.path || '')
  return src || ''
}

export function selectClipPath(state: EditorState, clip: TimelineClip | null | undefined): string {
  return selectClipPathFromAssets(selectAssets(state), clip)
}

export function selectClipDimensionsFromAssets(assets: Asset[], clip: TimelineClip): ClipDimensions | null {
  if (clip.type === 'audio') return null
  const liveAsset = selectLiveAssetForClipFromAssets(assets, clip)
  if (!liveAsset) return null

  if (liveAsset.width && liveAsset.height) {
    return { width: liveAsset.width, height: liveAsset.height }
  }

  return null
}

export function selectClipDimensions(state: EditorState, clip: TimelineClip): ClipDimensions | null {
  return selectClipDimensionsFromAssets(selectAssets(state), clip)
}

export function selectClipResolutionFromAssets(assets: Asset[], clip: TimelineClip): ClipResolutionInfo | null {
  const dims = selectClipDimensionsFromAssets(assets, clip)
  if (!dims) return null
  const tier = namedResolutionTier(Math.min(dims.width, dims.height))
  const displayName = namedResolutionDisplayName(tier)
  const color = tier >= 2160 ? '#22c55e' : tier >= 1080 ? '#3b82f6' : tier >= 720 ? '#f59e0b' : '#ef4444'
  return {
    label: `${displayName} (${dims.width}x${dims.height})`,
    color,
    height: dims.height,
    displayName,
  }
}

export function selectClipResolution(state: EditorState, clip: TimelineClip): ClipResolutionInfo | null {
  return selectClipResolutionFromAssets(selectAssets(state), clip)
}

export function selectClipColorLabel(state: EditorState, clip: TimelineClip): string | undefined {
  const liveAsset = selectLiveAssetForClip(state, clip)
  const label = clip.colorLabel || liveAsset?.colorLabel || clip.asset?.colorLabel
  return COLOR_LABELS.find((color) => color.id === label)?.id
}

/**
 * How long a clip may be stretched before it runs out of source media.
 *
 * Stills, text and adjustment layers have no intrinsic length and can be held
 * for as long as the user likes. Video *and audio* can't — audio used to be
 * unbounded here, so an mp3 could be dragged out well past the end of the file.
 */
export function selectClipMaxDurationFromAssets(assets: Asset[], clip: TimelineClip): number {
  const isTimeBasedMedia = clip.type === 'video' || clip.type === 'audio'
  const liveAsset = selectLiveAssetForClipFromAssets(assets, clip)
  if (!isTimeBasedMedia || !liveAsset?.duration) return Infinity
  const mediaDuration = liveAsset.duration
  const usableMedia = mediaDuration - clip.trimStart - clip.trimEnd
  return Math.max(0.5, usableMedia / clip.speed)
}

export function selectClipMaxDuration(state: EditorState, clip: TimelineClip): number {
  return selectClipMaxDurationFromAssets(selectAssets(state), clip)
}

export function selectOrderedTracks(state: EditorState): OrderedTrackEntry[] {
  const tracks = selectTracks(state)
  const videoTracks: { track: Track; realIndex: number }[] = []
  const audioTracks: { track: Track; realIndex: number }[] = []
  const subtitleTracks: { track: Track; realIndex: number }[] = []

  tracks.forEach((track, realIndex) => {
    if (track.type === 'subtitle') subtitleTracks.push({ track, realIndex })
    else if (track.kind === 'audio') audioTracks.push({ track, realIndex })
    else videoTracks.push({ track, realIndex })
  })

  videoTracks.reverse()
  return [...subtitleTracks, ...videoTracks, ...audioTracks].map((entry, displayRow) => ({
    ...entry,
    displayRow,
  }))
}

export function selectTrackDisplayRows(state: EditorState): Map<number, number> {
  const map = new Map<number, number>()
  selectOrderedTracks(state).forEach(entry => map.set(entry.realIndex, entry.displayRow))
  return map
}

export function selectAudioDividerDisplayRow(state: EditorState): number {
  const firstAudio = selectOrderedTracks(state).find(entry => entry.track.kind === 'audio')
  return firstAudio?.displayRow ?? -1
}

export function selectTimelineGaps(state: EditorState): TimelineGapSelection[] {
  const clips = selectClips(state)
  const tracks = selectTracks(state)
  const gaps: TimelineGapSelection[] = []

  tracks.forEach((track, trackIndex) => {
    if (track.type === 'subtitle') return
    const trackClips = clips
      .filter(clip => clip.trackIndex === trackIndex)
      .sort((a, b) => a.startTime - b.startTime)

    if (trackClips.length === 0) return

    if (trackClips[0].startTime > 0.05) {
      gaps.push({ trackIndex, startTime: 0, endTime: trackClips[0].startTime })
    }

    for (let i = 0; i < trackClips.length - 1; i++) {
      const currentEnd = trackClips[i].startTime + trackClips[i].duration
      const nextStart = trackClips[i + 1].startTime
      if (nextStart - currentEnd > 0.05) {
        gaps.push({ trackIndex, startTime: currentEnd, endTime: nextStart })
      }
    }
  })

  return gaps
}

export function selectCutPoints(state: EditorState): TimelineCutPoint[] {
  const clips = selectClips(state)
  const points: TimelineCutPoint[] = []
  const byTrack = new Map<number, TimelineClip[]>()

  for (const clip of clips) {
    if (!byTrack.has(clip.trackIndex)) byTrack.set(clip.trackIndex, [])
    byTrack.get(clip.trackIndex)!.push(clip)
  }

  for (const [trackIndex, trackClips] of byTrack) {
    const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime)
    for (let i = 0; i < sorted.length - 1; i++) {
      const leftClip = sorted[i]
      const rightClip = sorted[i + 1]
      const leftEnd = leftClip.startTime + leftClip.duration
      if (Math.abs(leftEnd - rightClip.startTime) < CUT_POINT_TOLERANCE) {
        points.push({
          leftClip,
          rightClip,
          time: leftEnd,
          trackIndex,
          hasDissolve: (leftClip.transitionOut?.type === 'dissolve') || (rightClip.transitionIn?.type === 'dissolve'),
        })
      }
    }
  }

  return points
}

export function selectKeyboardCommandContext(state: EditorState): KeyboardCommandContext {
  return {
    clips: selectClips(state),
    selectedClipIds: selectSelectedClipIds(state),
    totalDuration: selectTotalDuration(state),
    currentTime: selectCurrentTime(state),
    inPoint: selectActiveTimelineInPoint(state),
    outPoint: selectActiveTimelineOutPoint(state),
  }
}

export function selectMenuState(state: EditorState): MenuState {
  return {
    selectedClip: selectSelectedClipForProperties(state),
    selectedClipIds: selectSelectedClipIds(state),
    clips: selectClips(state),
    tracks: selectTracks(state),
    subtitles: selectSubtitles(state),
    snapEnabled: selectSnapEnabled(state),
    showEffectsBrowser: selectShowEffectsBrowser(state),
    showSourceMonitor: selectShowSourceMonitor(state),
    showPropertiesPanel: selectShowPropertiesPanel(state),
    hasSourceAsset: selectHasSourceAsset(state),
    activeTool: selectActiveTool(state),
    activeTimeline: selectActiveTimeline(state),
    timelines: selectTimelines(state),
  }
}

export function selectCanUseClipboard(state: EditorState): boolean {
  return state.session.clipboard.kind === 'clips' && state.session.clipboard.clips.length > 0
}

export function selectCanInsertEdit(state: EditorState): boolean {
  return selectHasSourceAsset(state)
}

export function selectCanOverwriteEdit(state: EditorState): boolean {
  return selectHasSourceAsset(state)
}

export function selectClipMetadata(state: EditorState, clip: TimelineClip): ClipMetadata {
  const liveAsset = selectLiveAssetForClip(state, clip)
  const resolution = selectClipResolution(state, clip)
  const dimensions = selectClipDimensions(state, clip)
  const filePath = liveAsset?.path || ''
  const originalRes = liveAsset?.resolution
  const isUpscaled = dimensions && originalRes
    ? namedResolutionTier(Math.min(dimensions.width, dimensions.height)) > parseInt(originalRes, 10)
    : false

  return {
    liveAsset,
    dimensions,
    resolution,
    filePath,
    isUpscaled,
  }
}

export function selectClipCapabilities(_state: EditorState, clip: TimelineClip): ClipCapabilities {
  return {
    isVideo: clip.type === 'video',
    isImage: clip.type === 'image',
    isAudio: clip.type === 'audio',
    isAdjustment: clip.type === 'adjustment',
    isText: clip.type === 'text',
  }
}

export function selectSelectedClipProperties(state: EditorState): SelectedClipPropertiesModel | null {
  const clip = selectSelectedClipForProperties(state)
  if (!clip) return null
  return {
    clip,
    metadata: selectClipMetadata(state, clip),
    capabilities: selectClipCapabilities(state, clip),
  }
}

export function selectSelectedSubtitleEditorModel(state: EditorState): SelectedSubtitleEditorModel | null {
  const subtitle = selectSelectedSubtitle(state)
  if (!subtitle) return null
  const track = selectTracks(state)[subtitle.trackIndex]
  const effectiveStyle: Partial<SubtitleStyle> = {
    ...(track?.subtitleStyle || {}),
    ...(subtitle.style || {}),
  }
  return { subtitle, track, effectiveStyle }
}

export function selectExportLetterbox(state: EditorState): ExportLetterbox | null {
  const clips = selectClips(state)
  const tracks = selectTracks(state)
  const adjustmentClips = clips.filter(
    clip =>
      clip.type === 'adjustment'
      && clip.letterbox?.enabled
      && tracks[clip.trackIndex]?.enabled !== false,
  )
  if (adjustmentClips.length === 0) return null

  const best = adjustmentClips.reduce((currentBest, candidate) => (
    candidate.duration > currentBest.duration ? candidate : currentBest
  ))
  const letterbox = best.letterbox!
  return {
    ratio: letterbox.aspectRatio === 'custom'
      ? (letterbox.customRatio || 2.35)
      : (LETTERBOX_RATIO_MAP[letterbox.aspectRatio] || 2.35),
    color: letterbox.color || '#000000',
    opacity: (letterbox.opacity ?? 100) / 100,
  }
}

export function selectExportClipData(state: EditorState): ExportClipData[] {
  const tracks = selectTracks(state)
  return selectClips(state)
    .filter(clip => clip.type === 'video' || clip.type === 'image' || clip.type === 'audio' || clip.type === 'text')
    .filter(clip => tracks[clip.trackIndex]?.enabled !== false)
    .map(clip => ({
      path: selectClipPath(state, clip),
      type: clip.type,
      startTime: clip.startTime,
      duration: clip.duration,
      trimStart: clip.trimStart,
      speed: clip.speed || 1,
      reversed: clip.reversed || false,
      flipH: clip.flipH || false,
      flipV: clip.flipV || false,
      opacity: clip.opacity ?? 100,
      trackIndex: clip.trackIndex,
      muted: clip.muted || false,
      volume: clip.volume ?? 1,
      id: clip.id,
      linkedClipIds: clip.linkedClipIds,
      transform: clip.transform ?? DEFAULT_CLIP_TRANSFORM,
      colorCorrection: clip.colorCorrection ?? DEFAULT_COLOR_CORRECTION,
      transitionIn: clip.transitionIn,
      transitionOut: clip.transitionOut,
      effects: clip.effects?.map(effect => ({
        type: effect.type,
        enabled: effect.enabled,
        params: effect.params,
      })),
      textStyle: clip.textStyle && {
        text: clip.textStyle.text,
        fontSize: clip.textStyle.fontSize,
        color: clip.textStyle.color,
        backgroundColor: clip.textStyle.backgroundColor,
        positionX: clip.textStyle.positionX,
        positionY: clip.textStyle.positionY,
        strokeColor: clip.textStyle.strokeColor,
        strokeWidth: clip.textStyle.strokeWidth,
        padding: clip.textStyle.padding,
        opacity: clip.textStyle.opacity,
      },
    }))
}

export function selectExportSubtitleData(state: EditorState): ExportSubtitleData[] {
  const subtitles = selectSubtitles(state)
  const tracks = selectTracks(state)
  return subtitles.map(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return {
      text: subtitle.text,
      startTime: subtitle.startTime,
      endTime: subtitle.endTime,
      style: {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(track?.subtitleStyle || {}),
        ...(subtitle.style || {}),
      },
    }
  })
}

export function selectExportModalModel(state: EditorState): ExportModalModel {
  return {
    timeline: selectActiveTimeline(state),
    clips: selectClips(state),
    tracks: selectTracks(state),
    exportClips: selectExportClipData(state),
    subtitleData: selectExportSubtitleData(state),
    letterbox: selectExportLetterbox(state),
  }
}

export interface AssetBinListItem {
  id: string
  name: string
  count: number
}

export function selectAssetBins(state: EditorState): AssetBinListItem[] {
  const assetCounts = state.editorModel.assets.reduce((counts, asset) => {
    if (!asset.binId) return counts
    counts.set(asset.binId, (counts.get(asset.binId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  return Object.entries(state.editorModel.bins)
    .map(([id, name]) => ({
      id,
      name,
      count: assetCounts.get(id) ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function equalAssetBins(left: AssetBinListItem[], right: AssetBinListItem[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false

  return left.every((bin, index) => {
    const other = right[index]
    return (
      bin.id === other.id
      && bin.name === other.name
      && bin.count === other.count
    )
  })
}

/**
 * The media panel is the list of files the user imported from their machine.
 * A sticker dropped on the timeline still needs an asset for clip lookups, but
 * showing it here left blank tiles the user never asked for. Projects saved
 * before `source` existed are recognised by the prompt addStickerClip writes.
 * Sound effect (SFX) clips ship with the app and should likewise never clutter
 * the user's imported media library.
 */
function isUserImportedAsset(asset: Asset): boolean {
  if (asset.source === 'sticker' || asset.source === 'sfx') return false
  if (asset.prompt.startsWith('Sticker: ') || asset.prompt.startsWith('SFX: ')) return false
  if (asset.path && (asset.path.startsWith('stickers/') || asset.path.startsWith('sfx/'))) return false
  return true
}

export function selectFilteredAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  let result = selectAssets(state).filter(isUserImportedAsset)
  if (filters.assetFilter && filters.assetFilter !== 'all') {
    result = result.filter(asset => asset.type === filters.assetFilter)
  }
  if (filters.selectedBinId !== undefined && filters.selectedBinId !== null) {
    result = result.filter(asset => asset.binId === filters.selectedBinId)
  }
  return result
}

export function selectSortedAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  const filteredAssets = selectFilteredAssets(state, filters)
  if (filters.assetViewMode !== 'list') return filteredAssets

  const sorted = [...filteredAssets]
  const dir = filters.listSortDir === 'desc' ? -1 : 1
  sorted.sort((a, b) => {
    switch (filters.listSortCol) {
      case 'type':
        return dir * a.type.localeCompare(b.type)
      case 'duration':
        return dir * ((a.duration ?? 0) - (b.duration ?? 0))
      case 'resolution':
        return dir * (parseResolutionHeight(a.resolution) - parseResolutionHeight(b.resolution))
      case 'date':
        return dir * (a.createdAt - b.createdAt)
      case 'color': {
        const order = COLOR_LABELS.map((color) => color.id)
        const idxA = a.colorLabel ? order.indexOf(a.colorLabel) : order.length
        const idxB = b.colorLabel ? order.indexOf(b.colorLabel) : order.length
        return dir * (idxA - idxB)
      }
      case 'name':
      default: {
        const nameA = (a.path?.split(/[/\\]/).pop() || a.type || '').toLowerCase()
        const nameB = (b.path?.split(/[/\\]/).pop() || b.type || '').toLowerCase()
        return dir * nameA.localeCompare(nameB)
      }
    }
  })
  return sorted
}

export function selectVisibleAssets(state: EditorState, filters: AssetListFilters): Asset[] {
  return selectSortedAssets(state, filters)
}

/** Why the last edit was refused, or null when nothing was. */
export function selectLastRejectedEdit(state: EditorState): { rule: string; message: string } | null {
  return state.session.ui.lastRejectedEdit
}
