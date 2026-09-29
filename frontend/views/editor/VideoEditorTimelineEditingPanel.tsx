import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasMediaFiles, isExternalFileDrag } from './external-file-drop'
import { ClipContextMenu } from './ClipContextMenu'
import { ReplaceClipModal } from './ReplaceClipModal'
import { replaceClipRefusal, replacementSlack, replacementSourceSpan } from '@core/clip-replace'
import type { TimelineClip, Track, SubtitleClip, Asset, TextOverlayStyle } from '../../types/project-model'
import {
  packMainVideoTrack,
  pruneEmptyOverlayTracks,
  type ToolType,
} from './video-editor-utils'
import { applyStateAction } from './editor-actions'
import { CUT_TOLERANCE, findCutPoints, findJunctionNear, findJunctions, nearestCut } from '@core/timeline-cuts'
import { trackRowHeight } from '@core/timeline-rows'
import { planBorrow } from '@core/timeline-transitions'
import {
  DEFAULT_TRANSITION_DURATION,
  MIN_TRANSITION_DURATION,
  maxTransitionDuration,
} from '@core/transitions'
import { useTranslation } from '../../i18n/I18nContext'
import type { TimelineTransition } from '../../types/project-model'

/** Stable empty array so the cut memo does not rerun on every render. */
const EMPTY_TRANSITIONS: TimelineTransition[] = []

/**
 * How wide a gap between two clips may *look* on screen and still be closed by
 * dropping a transition on it. Pixels, not seconds, because the judgement being
 * made is "those two look like they meet" — which is a matter of zoom.
 */
const TRANSITION_GAP_SNAP_PX = 48

/**
 * ...but zoomed far enough out, 48px is half a minute, and closing that would
 * throw the rest of the track forward by more than the user could have meant.
 */
const TRANSITION_GAP_SNAP_MAX_SECONDS = 1
import {
  selectActiveTimeline,
  selectAssets,
  selectCanUseClipboard,
  selectClipMaxDurationFromAssets,
  selectClipPathFromAssets,
  selectClipResolutionFromAssets,
  selectClips,
  selectCurrentTime,
  selectEditingSubtitleId,
  selectIsPlaying,
  selectLastTrimTool,
  selectLiveAssetForClipFromAssets,
  selectPixelsPerSecond,
  selectSelectedClipForProperties,
  selectTimelines,
  selectSelectedClipIds,
  selectSelectedSubtitleId,
  selectShowPropertiesPanel,
  selectSnapEnabled,
  selectSubtitleTrackStyleIdx,
  selectSubtitles,
  selectTotalDuration,
  selectTracks,
  selectZoom,
  selectActiveTool,
} from './editor-selectors'
import { useTimelineDrag } from './useTimelineDrag'
import { useEditorActions, useEditorGetState, useEditorStore, useEditorSubscribeToSlice } from './editor-store'
import { TimelineToolbar } from './timeline/TimelineToolbar'
import { TimelineRuler } from './timeline/TimelineRuler'
import { TimelineTrackHeaders } from './timeline/TimelineTrackHeaders'
import { TimelineCoverGutter } from './timeline/TimelineCoverGutter'
import { TimelineTracksView } from './timeline/TimelineTracksView'
import { CoverPickerModal } from './cover/CoverPickerModal'
import { CoverDesignModal } from './cover/CoverDesignModal'
import { coverElementsToOverlays } from './cover/cover-to-overlay'
import type { CoverElement } from './cover/types'
import { addVisualAssetToProject } from '../../lib/asset-copy'
import type { TimelineCover } from '@core/project-model'
import { useTimelinePlayheadSync } from './timeline/useTimelinePlayheadSync'
import { useTimelineContextMenu } from './timeline/useTimelineContextMenu'
import { useSettings } from '../../contexts/SettingsContext'

export interface VideoEditorTimelineEditingPanelProps {
  /** Import media files dragged in from the OS file manager. */
  importFiles: (files: FileList | File[]) => Promise<Asset[]>
  currentProjectId: string | null
  playbackTimeRef: React.MutableRefObject<number>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  getMinZoom: () => number
  kbLayout: any
  subtitleFileInputRef: React.RefObject<HTMLInputElement>
  handleImportSrt: (e: React.ChangeEvent<HTMLInputElement>) => void
  timelineRefBridge: React.MutableRefObject<HTMLDivElement | null>
  trackContainerRefBridge: React.MutableRefObject<HTMLDivElement | null>
  trackHeadersRefBridge: React.MutableRefObject<HTMLDivElement | null>
  rulerScrollRefBridge: React.MutableRefObject<HTMLDivElement | null>
  /** Timeline position under the pointer, for shortcuts that cut where you hover. */
  timelineHoverRef: React.MutableRefObject<{ time: number; trackIndex: number } | null>
  bladeShiftHeld: boolean
  fitToViewRef: React.MutableRefObject<() => void>
  onRevealAsset: (assetId: string) => void
}

export function VideoEditorTimelineEditingPanel(props: VideoEditorTimelineEditingPanelProps) {
  const {
    importFiles,
    currentProjectId,
    playbackTimeRef,
    centerOnPlayheadRef,
    getMinZoom,
    kbLayout,
    subtitleFileInputRef,
    handleImportSrt,
    timelineRefBridge,
    trackContainerRefBridge,
    trackHeadersRefBridge,
    rulerScrollRefBridge,
    timelineHoverRef,
    bladeShiftHeld,
    fitToViewRef,
    onRevealAsset,
  } = props

  const actions = useEditorActions()
  const { t } = useTranslation()
  const { settings } = useSettings()

  const assets = useEditorStore(selectAssets)
  const timelines = useEditorStore(selectTimelines)
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const totalDuration = useEditorStore(selectTotalDuration)
  const pixelsPerSecond = useEditorStore(selectPixelsPerSecond)
  const getEditorState = useEditorGetState()
  const subscribeToSlice = useEditorSubscribeToSlice()
  const currentTimeRef = useRef(selectCurrentTime(getEditorState()))
  const getCurrentTime = useCallback(() => currentTimeRef.current, [])
  const isPlayingRef = useRef(false)
  const isPlaying = useEditorStore(selectIsPlaying)
  isPlayingRef.current = isPlaying
  const zoom = useEditorStore(selectZoom)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const activeTool = useEditorStore(selectActiveTool)
  const lastTrimTool = useEditorStore(selectLastTrimTool)
  const snapEnabled = useEditorStore(selectSnapEnabled)
  const showPropertiesPanel = useEditorStore(selectShowPropertiesPanel)
  const subtitleTrackStyleIdx = useEditorStore(selectSubtitleTrackStyleIdx)
  const selectedSubtitleId = useEditorStore(selectSelectedSubtitleId)
  const editingSubtitleId = useEditorStore(selectEditingSubtitleId)
  const hasClipboard = useEditorStore(selectCanUseClipboard)

  const setClips = useCallback((value: React.SetStateAction<TimelineClip[]>) => {
    actions.setTimelineClips(value)
  }, [actions])

  const setTracks = useCallback((value: React.SetStateAction<Track[]>) => {
    actions.setTimelineTracks(value)
  }, [actions])

  const setSubtitles = useCallback((value: React.SetStateAction<SubtitleClip[]>) => {
    actions.setTimelineSubtitles(value)
  }, [actions])

  /** Tracks, clips and subtitles written together, as one undo step. */
  const replaceTimelineDocument = useCallback((snapshot: {
    tracks: Track[]
    clips: TimelineClip[]
    subtitles: SubtitleClip[]
  }) => {
    actions.replaceActiveTimelineDocument(snapshot)
  }, [actions])

  const setCurrentTime = useCallback((time: number) => {
    actions.setCurrentTime(time)
  }, [actions])

  // The scrub draws the playhead through this before the store hears of the time. The
  // drawing functions come from the playhead sync, set up after the drag hooks.
  const previewPlayheadRef = useRef<((time: number) => void) | null>(null)
  const previewPlayhead = useCallback((time: number) => previewPlayheadRef.current?.(time), [])

  const setIsPlaying = useCallback((playing: boolean) => {
    if (playing) actions.play()
    else actions.pause()
  }, [actions])

  const setZoom = useCallback((value: React.SetStateAction<number>) => {
    actions.setZoom(applyStateAction(value, zoom))
  }, [actions, zoom])

  const setSelectedClipIds = useCallback((value: React.SetStateAction<Set<string>>) => {
    actions.setSelectedClipIds(value)
  }, [actions])

  const setActiveTool = useCallback((tool: ToolType) => {
    actions.setActiveTool(tool)
  }, [actions])

  const setLastTrimTool = useCallback((tool: ToolType) => {
    actions.setLastTrimTool(tool)
  }, [actions])

  const setSnapEnabled = useCallback((enabled: boolean) => {
    actions.setSnapEnabled(enabled)
  }, [actions])

  const setShowPropertiesPanel = useCallback((value: React.SetStateAction<boolean>) => {
    actions.setShowPropertiesPanel(applyStateAction(value, showPropertiesPanel))
  }, [actions, showPropertiesPanel])

  // Cover modal states
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false)
  /** The clip whose media the Replace clip picker is swapping, while it is open. */
  const [replaceClipId, setReplaceClipId] = useState<string | null>(null)
  /** Media dropped onto a clip that needs its start chosen: the picker opens on that step. */
  const [replaceSegmentAsset, setReplaceSegmentAsset] = useState<Asset | null>(null)
  const [isCoverDesignOpen, setIsCoverDesignOpen] = useState(false)
  const [coverFrameUrl, setCoverFrameUrl] = useState('')
  const [coverSelectedTime, setCoverSelectedTime] = useState(0)
  const [coverIsLocal, setCoverIsLocal] = useState(false)

  const handleOpenCoverPicker = useCallback(() => {
    setIsCoverPickerOpen(true)
  }, [])

  const handleOpenCoverDesign = useCallback((initialFrameDataUrl: string, selectedTime: number, isLocalImage: boolean) => {
    const finalUrl =
      initialFrameDataUrl ||
      activeTimeline?.cover?.customImagePath ||
      activeTimeline?.cover?.thumbnailDataUrl ||
      ''
    setCoverFrameUrl(finalUrl)
    setCoverSelectedTime(selectedTime)
    setCoverIsLocal(isLocalImage)
    setIsCoverPickerOpen(false)
    setIsCoverDesignOpen(true)
  }, [activeTimeline?.cover])

  const handleSaveCover = useCallback((cover: TimelineCover) => {
    actions.setTimelineCover(cover)
  }, [actions])

  const handleRemoveCover = useCallback(() => {
    actions.setTimelineCover(undefined)
  }, [actions])

  /**
   * Ctrl+C in the cover studio: the picked elements go on the editor's clipboard, where
   * the next Ctrl+V lays them onto the timeline. An image is written to a file first —
   * the cover holds it as a data URL, which the export cannot read.
   */
  const handleCopyCoverElements = useCallback(async (elements: CoverElement[]): Promise<number> => {
    const items = await coverElementsToOverlays(elements, async ({ dataUrl, width, height, name }) => {
      const asset: Asset = {
        id: `asset-cover-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'image',
        path: dataUrl,
        prompt: name,
        resolution: `${width}x${height}`,
        width,
        height,
        createdAt: Date.now(),
      }
      const api = window.electronAPI
      // The renderer on its own (no Electron) can still show a data URL.
      if (!api?.saveTempShapeImage) return asset
      const saved = await api.saveTempShapeImage({ clipId: 'cover', data: dataUrl.slice(dataUrl.indexOf(',') + 1) })
      if (!saved.success) throw new Error(saved.error)
      if (!currentProjectId) return { ...asset, path: saved.path }
      const copied = await addVisualAssetToProject(saved.path, currentProjectId, 'image')
      return copied
        ? {
          ...asset,
          path: copied.path,
          bigThumbnailPath: copied.bigThumbnailPath,
          smallThumbnailPath: copied.smallThumbnailPath,
          width: copied.width || width,
          height: copied.height || height,
        }
        : { ...asset, path: saved.path }
    })
    if (items.length > 0) actions.copyOverlays(items)
    return items.length
  }, [actions, currentProjectId])

  const handleCopy = useCallback(() => { actions.copySelection() }, [actions])
  const handleCut = useCallback(() => { actions.cutSelection() }, [actions])
  const handlePaste = useCallback(() => { actions.pasteSelection() }, [actions])
  const addSubtitleTrack = useCallback(() => { actions.addSubtitleTrack() }, [actions])
  const createAdjustmentLayerAsset = useCallback(() => { actions.createAdjustmentLayerAsset() }, [actions])
  const addTextClip = useCallback((style?: Partial<TextOverlayStyle>, startTime?: number, trackIdx?: number) => {
    actions.addTextClip({ style, startTime, trackIndex: trackIdx })
  }, [actions])
  const duplicateClip = useCallback((clipId: string) => { actions.duplicateClips([clipId]) }, [actions])
  const splitClipAtPlayhead = useCallback((clipId: string, atTime?: number, batchClipIds?: string[]) => {
    // While playing, the store's currentTime lags the drawn playhead — cut
    // where the red line actually is.
    const playhead = isPlayingRef.current ? playbackTimeRef.current : getCurrentTime()
    actions.splitClipsAtTime(batchClipIds ?? [clipId], atTime ?? playhead)
  }, [actions, getCurrentTime, playbackTimeRef])
  const updateClip = useCallback((id: string, patch: Partial<TimelineClip>) => { actions.updateClip(id, patch) }, [actions])
  const setClipSpeed = useCallback((id: string, speed: number, duration?: number) => {
    actions.setClipSpeed(id, speed, duration)
  }, [actions])
  const updateAsset = useCallback((_projectId: string, assetId: string, updates: Partial<Asset>) => {
    actions.updateAsset(assetId, updates)
  }, [actions])
  const addClipToTimeline = useCallback((asset: Asset, trackIndex?: number, startTime?: number) => {
    // Add puts the asset in front of the existing edit on V1.
    actions.setPreviewAssetId(null)
    actions.insertAssetsToTimeline({ assets: [asset], trackIndex, startTime, position: 'start' })
  }, [actions])
  const resolveClipPath = useCallback((clip: TimelineClip | null) => clip ? selectClipPathFromAssets(assets, clip) : '', [assets])
  const getMaxClipDuration = useCallback((clip: TimelineClip) => selectClipMaxDurationFromAssets(assets, clip), [assets])
  const setSubtitleTrackStyleIdx = useCallback((idx: number | null) => {
    actions.setSubtitleTrackStyleEditorTrack(idx ?? undefined)
  }, [actions])
  const setSelectedSubtitleId = useCallback((id: string | null) => {
    if (id) actions.setSelectedSubtitle(id)
    else actions.clearSelectedSubtitle()
  }, [actions])
  const setEditingSubtitleId = useCallback((value: React.SetStateAction<string | null>) => {
    actions.setEditingSubtitleId(value)
  }, [actions])
  const updateSubtitle = useCallback((id: string, patch: Partial<SubtitleClip>) => {
    actions.updateSubtitle(id, patch)
  }, [actions])
  const getClipPath = useCallback((clip: TimelineClip) => selectClipPathFromAssets(assets, clip), [assets])
  const getClipResolution = useCallback((clip: TimelineClip) => selectClipResolutionFromAssets(assets, clip), [assets])
  const getLiveAsset = useCallback((clip: TimelineClip) => selectLiveAssetForClipFromAssets(assets, clip) ?? null, [assets])

  const [bladeHoverInfo, setBladeHoverInfo] = useState<{ clipId: string; offsetX: number; time: number } | null>(null)
  const [hoveredCutPoint, setHoveredCutPoint] = useState<{
    leftClipId: string; rightClipId: string; time: number; trackIndex: number
  } | null>(null)

  const [videoTrackHeight, setVideoTrackHeight] = useState(56)
  const [audioTrackHeight, setAudioTrackHeight] = useState(56)
  const [subtitleTrackHeight, setSubtitleTrackHeight] = useState(40)
  // Shorter on purpose: a sticker row carries a small overlay, not footage, and
  // a project often stacks several of them. Fixed rather than resizable — there
  // is nothing inside a sticker clip that rewards extra height.
  const stickerTrackHeight = 34
  const addTrack = useCallback((kind: 'video' | 'audio') => { actions.addTrack(kind) }, [actions])
  const deleteTrack = useCallback((idx: number) => {
    if (tracks.length <= 1) return
    const firstVideoTrackIndex = tracks.findIndex(t => t.kind === 'video' && t.type !== 'subtitle')
    if (idx === firstVideoTrackIndex) return // Video track 1 (V1) is default and protected from deletion

    const nextClips = clips
      .filter(clip => clip.trackIndex !== idx)
      .map(clip => clip.trackIndex > idx ? { ...clip, trackIndex: clip.trackIndex - 1 } : clip)
    const nextSubtitles = subtitles
      .filter(subtitle => subtitle.trackIndex !== idx)
      .map(subtitle => subtitle.trackIndex > idx ? { ...subtitle, trackIndex: subtitle.trackIndex - 1 } : subtitle)
    const remainingTracks = tracks.filter((_, trackIndex) => trackIndex !== idx)

    let videoCounter = 1
    let audioCounter = 1
    let stickerCounter = 1
    const nextTracks = remainingTracks.map(track => {
      if (track.type === 'subtitle') return track
      if (track.kind === 'audio') return { ...track, name: `A${audioCounter++}` }
      if (track.kind === 'sticker') return { ...track, name: `S${stickerCounter++}` }
      return { ...track, name: `V${videoCounter++}` }
    })

    setClips(nextClips)
    setSubtitles(nextSubtitles)
    setTracks(nextTracks)
  }, [clips, setClips, setSubtitles, setTracks, tracks])

  // No effect keeping a spare audio row here on purpose. A new project opens
  // with the video track only; dropping audio builds the track it needs
  // (buildDroppedAudioClipInsertion) and +A adds one by hand.

  const addSubtitleClip = useCallback((trackIndex: number) => {
    const subtitle: SubtitleClip = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: 'New subtitle',
      startTime: getCurrentTime(),
      endTime: getCurrentTime() + 3,
      trackIndex,
    }
    setSubtitles(prev => [...prev, subtitle])
    setSelectedSubtitleId(subtitle.id)
    setEditingSubtitleId(subtitle.id)
  }, [getCurrentTime, setEditingSubtitleId, setSelectedSubtitleId, setSubtitles])

  const setTransition = useCallback((
    leftClipId: string,
    rightClipId: string,
    type: string,
    duration: number,
  ) => {
    actions.setTimelineTransition(leftClipId, rightClipId, type, duration)
  }, [actions])

  const removeTransition = useCallback((transitionId: string) => {
    actions.removeTimelineTransition(transitionId)
  }, [actions])

  /** Parking the playhead on a cut is what tells the library where to apply. */
  const focusCut = useCallback((time: number) => {
    setCurrentTime(time)
  }, [setCurrentTime])

  const removeClip = useCallback((clipId: string) => {
    const clip = clips.find(candidate => candidate.id === clipId)
    if (clip && tracks[clip.trackIndex]?.locked) return
    const removeIds = new Set([clipId])
    clip?.linkedClipIds?.forEach(linkedId => removeIds.add(linkedId))
    const filtered = clips.filter(candidate => !removeIds.has(candidate.id))
    const packed = packMainVideoTrack(tracks, filtered, activeTimeline?.transitions ?? [])
    const pruned = pruneEmptyOverlayTracks(tracks, packed, subtitles)
    if (pruned.tracks.length !== tracks.length) {
      setTracks(pruned.tracks)
      setSubtitles(pruned.subtitles)
    }
    setClips(pruned.clips)
    setSelectedClipIds(prev => {
      const next = new Set(prev)
      removeIds.forEach(id => next.delete(id))
      return next
    })
  }, [clips, setClips, setSelectedClipIds, setSubtitles, setTracks, subtitles, tracks, activeTimeline])

  const timelineRef = useRef<HTMLDivElement>(null)
  const trackContainerRef = useRef<HTMLDivElement>(null)
  const trackHeadersRef = useRef<HTMLDivElement>(null)
  const coverGutterRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  const trackContentRef = useRef<HTMLDivElement>(null)
  const playheadRulerRef = useRef<HTMLDivElement>(null)
  const playheadOverlayRef = useRef<HTMLDivElement>(null)
  const timelineTimecodeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (timelineRefBridge) timelineRefBridge.current = timelineRef.current
    if (trackContainerRefBridge) trackContainerRefBridge.current = trackContainerRef.current
    if (trackHeadersRefBridge) trackHeadersRefBridge.current = trackHeadersRef.current
    if (rulerScrollRefBridge) rulerScrollRefBridge.current = rulerScrollRef.current
  })

  const orderedTracks: { track: Track; realIndex: number; displayRow: number }[] = useMemo(() => {
    const videoTracks: { track: Track; realIndex: number }[] = []
    const audioTracks: { track: Track; realIndex: number }[] = []
    const subtitleTracks: { track: Track; realIndex: number }[] = []

    tracks.forEach((track: Track, i: number) => {
      if (track.type === 'subtitle') subtitleTracks.push({ track, realIndex: i })
      else if (track.kind === 'audio') audioTracks.push({ track, realIndex: i })
      else videoTracks.push({ track, realIndex: i })
    })

    videoTracks.reverse()
    const ordered = [...subtitleTracks, ...videoTracks, ...audioTracks]
    return ordered.map((entry, displayRow) => ({ ...entry, displayRow }))
  }, [tracks])

  const trackDisplayRow = useMemo(() => {
    const map = new Map<number, number>()
    orderedTracks.forEach(entry => map.set(entry.realIndex, entry.displayRow))
    return map
  }, [orderedTracks])

  const rowHeights = useMemo(() => ({
    video: videoTrackHeight,
    audio: audioTrackHeight,
    subtitle: subtitleTrackHeight,
    sticker: stickerTrackHeight,
  }), [videoTrackHeight, audioTrackHeight, subtitleTrackHeight, stickerTrackHeight])

  const getTrackHeight = useCallback((trackIndex: number): number =>
    trackRowHeight(tracks[trackIndex], rowHeights), [tracks, rowHeights])

  const trackTopPx = useCallback((realTrackIndex: number, padding = 0): number => {
    const displayRow = trackDisplayRow.get(realTrackIndex) ?? realTrackIndex
    let top = 0
    for (let r = 0; r < displayRow; r++) {
      const entry = orderedTracks[r]
      if (entry) {
        top += trackRowHeight(entry.track, rowHeights)
      }
    }
    return top + padding
  }, [trackDisplayRow, orderedTracks, videoTrackHeight, audioTrackHeight, subtitleTrackHeight, stickerTrackHeight])

  // Cut detection lives in core because the transitions library needs the same
  // answer to work out which junction a click should land on.
  const timelineTransitions = useEditorStore(state => selectActiveTimeline(state)?.transitions ?? EMPTY_TRANSITIONS)
  const cutPoints = useMemo(
    () => findCutPoints(clips, timelineTransitions),
    [clips, timelineTransitions],
  )

  /** How wide a gap may be and still be closed by a transition drop, in seconds. */
  const transitionGapLimit = useMemo(
    () => Math.min(TRANSITION_GAP_SNAP_PX / pixelsPerSecond, TRANSITION_GAP_SNAP_MAX_SECONDS),
    [pixelsPerSecond],
  )

  /**
   * The markers a dragged transition can be dropped on: every real cut, plus the
   * junctions that are only *nearly* cuts.
   *
   * Without the second half, an overlay track offers nothing to aim at — no
   * marker lights up between two clips that do not quite touch, so the drop
   * looks refused before it is even attempted. The drop itself closes the gap.
   */
  const transitionDropTargets = useMemo(() => {
    const nearlyCuts = findJunctions(clips, transitionGapLimit)
      .filter(junction => junction.gap >= CUT_TOLERANCE)
      .map(junction => ({
        leftClip: junction.leftClip,
        rightClip: junction.rightClip,
        trackIndex: junction.trackIndex,
        time: junction.time,
        overlapStart: junction.time,
        overlapEnd: junction.time,
        transition: null,
      }))
    return nearlyCuts.length > 0 ? [...cutPoints, ...nearlyCuts] : cutPoints
  }, [clips, cutPoints, transitionGapLimit])

  /**
   * A refusal the user needs to see.
   *
   * A dropped transition that quietly does nothing is indistinguishable from a
   * broken feature — which is exactly how the overlay-track case was reported.
   * Every path that declines to place one says why instead.
   */
  const [timelineNotice, setTimelineNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const showTimelineNotice = useCallback((message: string) => {
    setTimelineNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setTimelineNotice(null), 5000)
  }, [])
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const replaceTarget = replaceClipId ? clips.find(clip => clip.id === replaceClipId) ?? null : null
  /**
   * Swap the picked media into the clip being replaced. A refusal — media too short, a
   * locked track — is said out loud rather than leaving the click looking dead.
   */
  /**
   * Says why `asset` cannot go into `clip`, and returns false — or returns true when it
   * can. A refusal is spoken rather than leaving a click or a drop looking dead.
   */
  const acceptReplacement = useCallback((clip: TimelineClip, asset: Asset): boolean => {
    const refusal = replaceClipRefusal(clip, asset, tracks)
    if (refusal === 'too-short') {
      showTimelineNotice(t('replaceClip.tooShort', {
        media: `${(asset.duration ?? 0).toFixed(1)}s`,
        clip: `${replacementSourceSpan(clip).toFixed(1)}s`,
      }))
      return false
    }
    if (refusal === 'locked') { showTimelineNotice(t('replaceClip.locked')); return false }
    if (refusal === 'not-replaceable' || refusal === 'unsupported-media') {
      showTimelineNotice(t('replaceClip.notReplaceable'))
      return false
    }
    return refusal !== 'same-media'
  }, [showTimelineNotice, t, tracks])

  const closeReplace = useCallback(() => {
    setReplaceClipId(null)
    setReplaceSegmentAsset(null)
  }, [])

  const replaceWith = useCallback((asset: Asset, sourceStart = 0) => {
    const clip = replaceClipId ? clips.find(c => c.id === replaceClipId) : undefined
    if (!clip) { closeReplace(); return }
    const refusal = replaceClipRefusal(clip, asset, tracks)
    if (refusal === 'same-media') { closeReplace(); return }
    if (!acceptReplacement(clip, asset)) return
    actions.replaceClipMedia(clip.id, asset.id, sourceStart)
    showTimelineNotice(t('replaceClip.replaced'))
    closeReplace()
  }, [acceptReplacement, actions, clips, closeReplace, replaceClipId, showTimelineNotice, t, tracks])

  /**
   * Media Alt-dropped onto a clip. A still, or a video that fits exactly, goes straight
   * in; a longer video opens the picker on its "choose the part" step; files from the
   * system are imported into the library first.
   */
  const handleDropReplace = useCallback(async (clipId: string, payload: { assetId?: string; files?: FileList }) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    let asset: Asset | undefined
    if (payload.assetId) {
      asset = assets.find(a => a.id === payload.assetId)
    } else if (payload.files && payload.files.length > 0) {
      try {
        const imported = await importFiles(payload.files)
        asset = imported.find(a => a.type === 'video' || a.type === 'image')
      } catch {
        asset = undefined
      }
      if (!asset) { showTimelineNotice(t('replaceClip.importFailed')); return }
    }
    if (!asset || !acceptReplacement(clip, asset)) return
    if (replacementSlack(clip, asset) > 0.05) {
      setReplaceSegmentAsset(asset)
      setReplaceClipId(clipId)
      return
    }
    actions.replaceClipMedia(clipId, asset.id, 0)
    showTimelineNotice(t('replaceClip.replaced'))
  }, [acceptReplacement, actions, assets, clips, importFiles, showTimelineNotice, t])

  /**
   * The overlap is normally paid for out of media both clips are already
   * trimming away, which is why they hold still while it is re-timed. Footage
   * with nothing spare cannot do that, and the clips close up instead — a
   * visible jump, so it gets said rather than left to puzzle.
   */
  const shiftWarnedRef = useRef(false)
  const warnIfClipsWillShift = useCallback((
    leftClip: TimelineClip,
    rightClip: TimelineClip,
    duration: number,
  ) => {
    if (planBorrow(leftClip, rightClip, duration).shortfall <= 0) return
    // Untrimmed footage has no spare frames at all, so this would otherwise
    // fire on every single transition. Once per session is a fact worth
    // knowing; on every drop it is noise the user learns to click past.
    if (shiftWarnedRef.current) return
    shiftWarnedRef.current = true
    showTimelineNotice(t('transitions.clipsWillShift'))
  }, [showTimelineNotice, t])

  /**
   * Where a transition dropped at (track, time) actually lands.
   *
   * One funnel for every drop target — the clip body, the track lane, the cut
   * marker — because they used to disagree: each searched `cutPoints` on its
   * own, and a cut only exists where two clips touch exactly. That holds on the
   * magnetic main track and essentially never on an overlay track, so dropping
   * a transition on V2 did nothing at all. When no cut is found, the nearby
   * junction is closed first (see `SetTransitionOptions.closeGapUpTo`).
   *
   * Returns false when nothing was close enough, so a caller can tell the
   * difference between "applied" and "aimed at empty space".
   */
  const applyTransitionAtPoint = useCallback((
    trackIndex: number,
    time: number,
    type: string,
    snapSeconds: number,
  ): boolean => {
    const trackCuts = cutPoints.filter(cut => cut.trackIndex === trackIndex)
    const cut = nearestCut(trackCuts, time, snapSeconds)
    if (cut) {
      if (maxTransitionDuration(
        cut.leftClip.duration,
        cut.rightClip.duration,
      ) < MIN_TRANSITION_DURATION) {
        showTimelineNotice(t('transitions.clipsTooShort'))
        return false
      }
      const duration = cut.transition?.duration ?? settings.defaultTransitionDuration ?? DEFAULT_TRANSITION_DURATION
      actions.setTimelineTransition(cut.leftClip.id, cut.rightClip.id, type, duration)
      focusCut(cut.time)
      warnIfClipsWillShift(cut.leftClip, cut.rightClip, duration)
      return true
    }

    const junction = findJunctionNear(clips, trackIndex, time, snapSeconds, transitionGapLimit)
    if (!junction) {
      showTimelineNotice(t('transitions.noJunctionHere'))
      return false
    }

    // Core would refuse this pair anyway; saying so beats a drop that vanishes.
    if (maxTransitionDuration(
      junction.leftClip.duration,
      junction.rightClip.duration,
    ) < MIN_TRANSITION_DURATION) {
      showTimelineNotice(t('transitions.clipsTooShort'))
      return false
    }

    const defaultDuration = settings.defaultTransitionDuration ?? DEFAULT_TRANSITION_DURATION
    actions.setTimelineTransition(
      junction.leftClip.id,
      junction.rightClip.id,
      type,
      defaultDuration,
      // Licence to close exactly the gap that was measured, and no more.
      junction.gap,
    )
    focusCut(junction.leftClip.startTime + junction.leftClip.duration)
    if (junction.gap > 0) showTimelineNotice(t('transitions.gapClosed'))
    warnIfClipsWillShift(junction.leftClip, junction.rightClip, defaultDuration)
    return true
  }, [actions, clips, cutPoints, focusCut, settings.defaultTransitionDuration, showTimelineNotice, t, transitionGapLimit, warnIfClipsWillShift])

  const {
    draggingClip,
    resizingClip,
    slipSlideClip,
    lassoRect, setLassoRect,
    scrubFromEvent,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
    expandWithLinkedClips,
    handleClipMouseDown,
    handleResizeStart,
    handleTrackDrop,
    lassoOriginRef,
    snapGuideTime,
  } = useTimelineDrag({
    activeTool, setActiveTool, lastTrimTool, setLastTrimTool,
    pixelsPerSecond, totalDuration,
    clips, setClips, tracks, subtitles, replaceTimelineDocument,
    selectedClipIds, setSelectedClipIds,
    getCurrentTime, setCurrentTime, setIsPlaying,
    snapEnabled, resolveClipPath, getMaxClipDuration, addClipToTimeline,
    assets, timelines, activeTimeline, currentProjectId,
    timelineRef, rulerScrollRef, trackContainerRef, trackContentRef,
    orderedTracks, getTrackHeight, trackTopPx,
    splitClipAtPlayhead, setSelectedSubtitleId,
    audioTrackHeight, videoTrackHeight, subtitleTrackHeight, stickerTrackHeight,
    applyTransitionAtPoint,
    addFilterClip: actions.addFilterClip,
    previewPlayhead,
  })

  const { handleTimelineScroll, handleFitToView, syncPlayheadPosition, syncTimelineTimecode } = useTimelinePlayheadSync({
    pixelsPerSecond,
    totalDuration,
    isPlaying,
    playbackTimeRef,
    currentTimeRef,
    isPlayingRef,
    centerOnPlayheadRef,
    fitToViewRef,
    trackContainerRef,
    trackHeadersRef,
    coverGutterRef,
    rulerScrollRef,
    playheadRulerRef,
    playheadOverlayRef,
    timelineTimecodeRef,
    getMinZoom,
    setZoom,
    subscribeToSlice,
    fps: activeTimeline?.fps ?? settings.defaultFps ?? 30,
    timecodeFormat: settings.timecodeFormat,
  })
  previewPlayheadRef.current = (time: number) => {
    syncPlayheadPosition(time)
    syncTimelineTimecode(time)
  }

  const {
    clipContextMenu,
    setClipContextMenu,
    clipContextMenuRef,
    contextClip,
    handleClipContextMenu,
    handleTimelineBgContextMenu,
  } = useTimelineContextMenu({
    clips,
    selectedClipIds,
    setSelectedClipIds,
    expandWithLinkedClips,
    pixelsPerSecond,
    setCurrentTime,
  })

  const handleGeneralTimelineDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const content = trackContentRef.current ?? trackContainerRef.current
    if (!content) return
    const contentRect = content.getBoundingClientRect()
    const yInContainer = e.clientY - contentRect.top
    const dropX = e.clientX - contentRect.left
    const dropTime = Math.max(0, dropX / pixelsPerSecond)

    let droppedTrackIndex = -1
    if (yInContainer >= 0) {
      let accY = 0
      let matched = false
      for (const entry of orderedTracks) {
        const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
        if (yInContainer >= accY && yInContainer < accY + th) {
          droppedTrackIndex = entry.realIndex
          matched = true
          break
        }
        accY += th
      }
      if (!matched) {
        droppedTrackIndex = orderedTracks[orderedTracks.length - 1]?.realIndex ?? 0
      }
    } else {
      droppedTrackIndex = -1
    }

    if (isExternalFileDrag(e)) {
      const files = e.dataTransfer.files
      if (!hasMediaFiles(files)) return
      void importFiles(files).then(imported => {
        if (imported.length > 0) {
          actions.setPreviewAssetId(null)
          actions.insertAssetsToTimeline({
            assets: imported,
            trackIndex: droppedTrackIndex,
            startTime: dropTime,
          })
        }
      })
      return
    }
    handleTrackDrop(e, droppedTrackIndex)
  }, [actions, audioTrackHeight, handleTrackDrop, importFiles, orderedTracks, pixelsPerSecond, subtitleTrackHeight, videoTrackHeight])

  const startSelectionLasso = useCallback((clientX: number, clientY: number, shiftKey: boolean) => {
    setSelectedSubtitleId(null)
    setEditingSubtitleId(null)
    if (!shiftKey) setSelectedClipIds(new Set())
    const container = trackContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const content = trackContentRef.current
    const contentRect = content?.getBoundingClientRect()
    lassoOriginRef.current = {
      scrollLeft: container.scrollLeft,
      containerLeft: (contentRect?.left ?? rect.left) + container.scrollLeft,
      containerTop: (contentRect?.top ?? rect.top) + container.scrollTop,
    }
    setLassoRect({ startX: clientX, startY: clientY, currentX: clientX, currentY: clientY })
  }, [lassoOriginRef, setEditingSubtitleId, setLassoRect, setSelectedClipIds, setSelectedSubtitleId])

  return (
    <>
      <div className="relative h-full min-h-0 flex flex-col">
        {timelineNotice && (
          <div className="pointer-events-none absolute inset-x-0 top-9 z-[80] flex justify-center">
            <p
              role="status"
              className="pointer-events-auto max-w-lg rounded-md border border-amber-800/70 bg-amber-950/95 px-3 py-2 text-[11px] leading-relaxed text-amber-100 shadow-lg shadow-black/40"
              onClick={() => setTimelineNotice(null)}
            >
              {timelineNotice}
            </p>
          </div>
        )}
        {/* Toolbar */}
        <TimelineToolbar
          kbLayout={kbLayout}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          lastTrimTool={lastTrimTool}
          setLastTrimTool={setLastTrimTool}
          addTextClip={addTextClip}
          undo={() => actions.undo()}
          redo={() => actions.redo()}
          selectedClip={selectedClip}
          selectedClipIds={selectedClipIds}
          splitClipAtPlayhead={splitClipAtPlayhead}
          deleteClips={(clipIds) => actions.deleteClips(clipIds)}
          updateClip={updateClip}
          toggleClipMute={(clipId) => actions.toggleClipMute(clipId)}
          duplicateClip={duplicateClip}
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          showPropertiesPanel={showPropertiesPanel}
          setShowPropertiesPanel={setShowPropertiesPanel}
          zoom={zoom}
          setZoom={setZoom}
          getMinZoom={getMinZoom}
          centerOnPlayheadRef={centerOnPlayheadRef}
          handleFitToView={handleFitToView}
        />

        {/* Timeline with Tools */}
        <div className="bg-zinc-950 flex overflow-hidden flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Ruler row */}
            <TimelineRuler
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              isPlaying={isPlaying}
              playbackTimeRef={playbackTimeRef}
              currentTimeRef={currentTimeRef}
              setCurrentTime={setCurrentTime}
              timelineRef={timelineRef}
              rulerScrollRef={rulerScrollRef}
              playheadRulerRef={playheadRulerRef}
              timelineTimecodeRef={timelineTimecodeRef}
              handleRulerMouseDown={handleRulerMouseDown}
            />

            {/* Tracks body */}
            <div className="flex flex-1 min-h-0 flex-col">
              <div className="flex flex-1 min-h-0">
                {/* Track headers column */}
                <TimelineTrackHeaders
                  trackHeadersRef={trackHeadersRef}
                  orderedTracks={orderedTracks}
                  tracks={tracks}
                  clips={clips}
                  setTracks={setTracks}
                  addTrack={addTrack}
                  addSubtitleTrack={addSubtitleTrack}
                  createAdjustmentLayerAsset={createAdjustmentLayerAsset}
                  deleteTrack={deleteTrack}
                  subtitleTrackStyleIdx={subtitleTrackStyleIdx}
                  setSubtitleTrackStyleIdx={setSubtitleTrackStyleIdx}
                  addSubtitleClip={addSubtitleClip}
                  setSubtitles={setSubtitles}
                  videoTrackHeight={videoTrackHeight}
                  audioTrackHeight={audioTrackHeight}
                  subtitleTrackHeight={subtitleTrackHeight}
                  stickerTrackHeight={stickerTrackHeight}
                  setVideoTrackHeight={setVideoTrackHeight}
                  setAudioTrackHeight={setAudioTrackHeight}
                  setSubtitleTrackHeight={setSubtitleTrackHeight}
                />

                {/* Timeline Cover gutter on timeline side */}
                <TimelineCoverGutter
                  coverGutterRef={coverGutterRef}
                  orderedTracks={orderedTracks}
                  tracks={tracks}
                  rowHeights={rowHeights}
                  cover={activeTimeline?.cover}
                  onOpenCoverPicker={handleOpenCoverPicker}
                  onRemoveCover={handleRemoveCover}
                />

                {/* Track content area */}
                <TimelineTracksView
                  trackContainerRef={trackContainerRef}
                  trackContentRef={trackContentRef}
                  playheadOverlayRef={playheadOverlayRef}
                  currentTimeRef={currentTimeRef}
                  pixelsPerSecond={pixelsPerSecond}
                  totalDuration={totalDuration}
                  activeTool={activeTool}
                  bladeShiftHeld={bladeShiftHeld}
                  orderedTracks={orderedTracks}
                  tracks={tracks}
                  clips={clips}
                  subtitles={subtitles}
                  cutPoints={transitionDropTargets}
                  selectedClipIds={selectedClipIds}
                  selectedSubtitleId={selectedSubtitleId}
                  editingSubtitleId={editingSubtitleId}
                  draggingClip={draggingClip}
                  slipSlideClip={slipSlideClip}
                  resizingClip={resizingClip}
                  snapGuideTime={snapGuideTime}
                  bladeHoverInfo={bladeHoverInfo}
                  hoveredCutPoint={hoveredCutPoint}
                  lassoRect={lassoRect}
                  lassoOriginRef={lassoOriginRef}
                  timelineHoverRef={timelineHoverRef}
                  assets={assets}
                  videoTrackHeight={videoTrackHeight}
                  audioTrackHeight={audioTrackHeight}
                  subtitleTrackHeight={subtitleTrackHeight}
                  stickerTrackHeight={stickerTrackHeight}
                  trackTopPx={trackTopPx}
                  getTrackHeight={getTrackHeight}
                  handleTimelineScroll={handleTimelineScroll}
                  handleGeneralTimelineDrop={handleGeneralTimelineDrop}
                  handleTimelineBgContextMenu={handleTimelineBgContextMenu}
                  startSelectionLasso={startSelectionLasso}
                  scrubFromEvent={scrubFromEvent}
                  handlePlayheadMouseDown={handlePlayheadMouseDown}
                  setIsPlaying={setIsPlaying}
                  setSelectedClipIds={setSelectedClipIds}
                  setSelectedSubtitleId={setSelectedSubtitleId}
                  setEditingSubtitleId={setEditingSubtitleId}
                  handleTrackDrop={handleTrackDrop}
                  addSubtitleClip={addSubtitleClip}
                  importFiles={importFiles}
                  insertAssetsToTimeline={(params) => actions.insertAssetsToTimeline(params)}
                  handleClipMouseDown={handleClipMouseDown}
                  handleClipContextMenu={handleClipContextMenu}
                  handleResizeStart={handleResizeStart}
                  onClipDoubleClick={(clip) => {
                    setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                    setShowPropertiesPanel(true)
                  }}
                  setBladeHoverInfo={setBladeHoverInfo}
                  setHoveredCutPoint={setHoveredCutPoint}
                  addClipEffect={(clipId, effectType) => actions.addClipEffect(clipId, effectType)}
                  getClipPath={getClipPath}
                  getLiveAsset={getLiveAsset}
                  getClipResolution={getClipResolution}
                  updateSubtitle={updateSubtitle}
                  setTransition={setTransition}
                  applyTransitionAtPoint={applyTransitionAtPoint}
                  onDropReplace={handleDropReplace}
                  removeTransition={removeTransition}
                  onFocusCut={focusCut}
                  setClips={setClips}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Hidden SRT file input */}
        <input
          ref={subtitleFileInputRef}
          type="file"
          accept=".srt"
          onChange={handleImportSrt}
          className="hidden"
        />
      </div>

      {clipContextMenu && (
        <ClipContextMenu
          clipContextMenu={clipContextMenu}
          contextClip={contextClip}
          clipContextMenuRef={clipContextMenuRef}
          clips={clips}
          tracks={tracks}
          selectedClipIds={selectedClipIds}
          setSelectedClipIds={setSelectedClipIds}
          currentTime={currentTimeRef.current}
          hasClipboard={hasClipboard}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy}
          handleCut={handleCut}
          handlePaste={handlePaste}
          setClipContextMenu={setClipContextMenu}
          addTextClip={addTextClip}
          setClips={setClips}
          duplicateClip={duplicateClip}
          splitClipAtPlayhead={splitClipAtPlayhead}
          removeClip={removeClip}
          updateClip={updateClip}
          setClipSpeed={setClipSpeed}
          getLiveAsset={getLiveAsset}
          getMaxClipDuration={getMaxClipDuration}
          onRevealAsset={onRevealAsset}
          onReplaceClip={setReplaceClipId}
        />
      )}

      {replaceTarget && (
        <ReplaceClipModal
          clip={replaceTarget}
          assets={assets}
          tracks={tracks}
          onReplace={replaceWith}
          onImportFiles={files => importFiles(files)}
          onNotice={showTimelineNotice}
          initialSegmentAsset={replaceSegmentAsset}
          onClose={closeReplace}
        />
      )}

      {/* Cover Picker & Design Modals */}
      {isCoverPickerOpen && (
        <CoverPickerModal
          isOpen={isCoverPickerOpen}
          onClose={() => setIsCoverPickerOpen(false)}
          onOpenDesign={handleOpenCoverDesign}
          onRemoveCover={handleRemoveCover}
          activeTimeline={activeTimeline}
          assets={assets}
        />
      )}

      {isCoverDesignOpen && (
        <CoverDesignModal
          isOpen={isCoverDesignOpen}
          onClose={() => setIsCoverDesignOpen(false)}
          onSave={handleSaveCover}
          onDeleteCover={handleRemoveCover}
          initialFrameDataUrl={coverFrameUrl}
          selectedTime={coverSelectedTime}
          isLocalImage={coverIsLocal}
          currentCover={activeTimeline?.cover}
          projectName={activeTimeline?.name || 'Project'}
          onCopyElements={handleCopyCoverElements}
        />
      )}
    </>
  )
}
