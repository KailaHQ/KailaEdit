import { useState, useRef, useEffect, useCallback } from 'react'
import type { Asset, SubtitleClip, TimelineClip, Track } from '../../types/project-model'
import { flushSync } from 'react-dom'
import { rowIndexAtY, stableRowIndexAtY, type TimelineRowBox } from '@core/timeline-rows'
import { resolveOverlaps, packMainVideoTrack, pruneEmptyOverlayTracks, mainVideoTrackIndex, liftCollidingClipsToNewTracks, type ToolType } from './video-editor-utils'
import { createTrackDropHandler } from './timeline/createTrackDropHandler'
import { createClipMouseDownHandler } from './timeline/createClipMouseDownHandler'
import { useTimelineScrub } from './timeline/useTimelineScrub'
import { useTimelineSlipSlide, type SlipSlideClipState } from './timeline/useTimelineSlipSlide'
import { useTimelineResize, type ResizingClipState } from './timeline/useTimelineResize'
import { useTimelineLasso, type LassoRect } from './timeline/useTimelineLasso'
import {
  collectPlayheadSnapTargets,
  collectTimelineSnapTargets,
  snapClipMove,
  computeSnapThresholdSeconds,
  type SnapTarget,
} from '@core/timeline-snap'

export type { SlipSlideClipState, ResizingClipState, LassoRect }



interface DragPreviewPosition {
  startTime: number
  trackIndex: number
}

interface DragPreviewNode {
  el: HTMLElement
  transform: string
  zIndex: string
  willChange: string
}

export interface DraggingClipState {
  clipId: string
  startX: number
  startY: number
  originalStartTime: number
  originalTrackIndex: number
  originalPositions: Record<string, { startTime: number; trackIndex: number }>
  isDuplicate?: boolean
  altHeld?: boolean
}

interface UseTimelineDragParams {
  activeTool: ToolType
  setActiveTool: (tool: ToolType) => void
  lastTrimTool: ToolType
  setLastTrimTool: (tool: ToolType) => void
  pixelsPerSecond: number
  totalDuration: number
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  /**
   * Read the playhead lazily. It is not a render prop because the timeline panel
   * deliberately does not re-render as the playhead moves.
   */
  getCurrentTime: () => number
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  snapEnabled: boolean
  resolveClipPath: (clip: TimelineClip | null) => string
  getMaxClipDuration: (clip: TimelineClip) => number
  addClipToTimeline: (asset: Asset, trackIndex?: number, startTime?: number) => void
  assets: Asset[]
  timelines: any[]
  activeTimeline: any
  currentProjectId: string | null
  timelineRef: React.RefObject<HTMLDivElement>
  rulerScrollRef?: React.RefObject<HTMLDivElement>
  trackContainerRef: React.RefObject<HTMLDivElement>
  trackContentRef?: React.RefObject<HTMLDivElement>
  orderedTracks: { track: Track; realIndex: number; displayRow: number }[]
  getTrackHeight: (trackIndex: number) => number
  trackTopPx: (realTrackIndex: number, padding?: number) => number
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  setSelectedSubtitleId: (id: string | null) => void
  audioTrackHeight: number
  videoTrackHeight: number
  subtitleTrackHeight: number
  stickerTrackHeight?: number
  subtitles: SubtitleClip[]
  /**
   * Place a transition at a point on a track, closing a small gap first when the
   * two clips there do not quite touch. Returns false when nothing was in range.
   */
  applyTransitionAtPoint?: (trackIndex: number, time: number, type: string, snapSeconds: number) => boolean
  /**
   * Write tracks, clips and subtitles in a single store update.
   *
   * A drag can add or remove a track *and* move clips onto it. Those have to
   * land together: dispatching them as two updates — worse, nesting one inside
   * the other's updater — lets the second write overwrite the first, leaving
   * clips pointing at a track index that no longer exists.
   */
  replaceTimelineDocument: (snapshot: {
    tracks: Track[]
    clips: TimelineClip[]
    subtitles: SubtitleClip[]
  }) => void
  addFilterClip?: (params: { filterId: string; startTime?: number; trackIndex?: number }) => void
  /** Draws the playhead at a time without going through the store (see useTimelineScrub). */
  previewPlayhead?: (time: number) => void
}

export function useTimelineDrag(params: UseTimelineDragParams) {
  const {
    activeTool,
    pixelsPerSecond, totalDuration,
    clips, setClips, tracks, subtitles, replaceTimelineDocument,
    selectedClipIds, setSelectedClipIds,
    getCurrentTime, setCurrentTime, setIsPlaying,
    snapEnabled, getMaxClipDuration, addClipToTimeline,
    assets, timelines, activeTimeline, applyTransitionAtPoint,
    timelineRef, rulerScrollRef, trackContainerRef, trackContentRef,
    orderedTracks, getTrackHeight, trackTopPx,
    splitClipAtPlayhead, setSelectedSubtitleId,
    videoTrackHeight,
    audioTrackHeight,
    stickerTrackHeight = 44,
    addFilterClip,
    previewPlayhead,
  } = params

  const [draggingClip, setDraggingClip] = useState<DraggingClipState | null>(null)
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null)
  const dragPreviewRef = useRef<Record<string, DragPreviewPosition> | null>(null)
  const dragPreviewNodesRef = useRef<Map<string, DragPreviewNode>>(new Map())
  const dragPreviewRafRef = useRef<number | null>(null)
  /** Row the drag last settled on, so a pointer on a boundary stops flickering. */
  const dragRowRef = useRef<number | null>(null)
  /** Container box captured at mousedown: re-reading it every move would force
      a layout right after the preview writes a transform. */
  const dragContainerRectRef = useRef<DOMRect | null>(null)

  /** Dashed rows marking where a new track will appear, by track kind. Imperative, like the drag preview. */
  const newTrackHintsRef = useRef<Map<string, HTMLDivElement>>(new Map())

  const clearDragPreviewDom = useCallback(() => {
    if (dragPreviewRafRef.current !== null) {
      cancelAnimationFrame(dragPreviewRafRef.current)
      dragPreviewRafRef.current = null
    }
    for (const node of dragPreviewNodesRef.current.values()) {
      node.el.style.transform = node.transform
      node.el.style.zIndex = node.zIndex
      node.el.style.willChange = node.willChange
    }
    dragPreviewNodesRef.current.clear()
    for (const hint of newTrackHintsRef.current.values()) hint.remove()
    newTrackHintsRef.current.clear()
    dragPreviewRef.current = null
    dragRowRef.current = null
    dragContainerRectRef.current = null
  }, [])

  // What a dragged playhead catches on: clip edges on every track, cuts and markers.
  // Read through a ref so the scrub handlers are not rebuilt on every clip change.
  const playheadSnapSourceRef = useRef({ clips, activeTimeline, snapEnabled })
  playheadSnapSourceRef.current = { clips, activeTimeline, snapEnabled }
  const getPlayheadSnapTargets = useCallback(() => {
    const source = playheadSnapSourceRef.current
    if (!source.snapEnabled) return null
    return collectPlayheadSnapTargets({
      clips: source.clips,
      transitions: source.activeTimeline?.transitions,
      markers: source.activeTimeline?.markers,
    })
  }, [])

  // Sub-hook: Scrubbing & auto-scrolling
  const {
    isScrubbing,
    scrubFromEvent,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
  } = useTimelineScrub({
    trackContainerRef,
    timelineRef,
    rulerScrollRef,
    pixelsPerSecond,
    totalDuration,
    setCurrentTime,
    setIsPlaying,
    getSnapTargets: getPlayheadSnapTargets,
    onScrubPreview: previewPlayhead,
    onSnapGuideChange: setSnapGuideTime,
  })

  // Helper: expand a set of clip IDs to include their linked counterparts (audio ↔ video)
  const expandWithLinkedClips = useCallback((ids: Set<string>): Set<string> => {
    const expanded = new Set(ids)
    const queue = [...ids]
    while (queue.length > 0) {
      const id = queue.pop()!
      const c = clips.find(cl => cl.id === id)
      if (c?.linkedClipIds) {
        for (const lid of c.linkedClipIds) {
          if (!expanded.has(lid) && clips.some(cl => cl.id === lid)) {
            expanded.add(lid)
            queue.push(lid)
          }
        }
      }
    }
    return expanded
  }, [clips])

  // Sub-hook: Marquee / Lasso selection
  const {
    lassoRect,
    setLassoRect,
    lassoOriginRef,
    handleLassoMove,
    handleLassoUp,
  } = useTimelineLasso({
    clips,
    pixelsPerSecond,
    getTrackHeight,
    trackTopPx,
    trackContainerRef,
    setSelectedClipIds,
    expandWithLinkedClips,
  })

  // Sub-hook: Slip & Slide
  const {
    slipSlideClip,
    setSlipSlideClip,
    handleSlipSlideMove,
    handleSlipSlideUp,
  } = useTimelineSlipSlide({
    clips,
    setClips,
    pixelsPerSecond,
  })

  // Sub-hook: Trimming & Resize
  const {
    resizingClip,
    setResizingClip,
    handleResizeStart,
    handleResizeMove,
  } = useTimelineResize({
    clips,
    setClips,
    tracks,
    pixelsPerSecond,
    snapEnabled,
    getCurrentTime,
    getMaxClipDuration,
    assets,
    activeTool,
    setSelectedClipIds,
    expandWithLinkedClips,
    activeTimeline,
    setCurrentTime,
    onSnapGuideChange: setSnapGuideTime,
  })

  const handleClipMouseDown = createClipMouseDownHandler({
    activeTool,
    clips,
    tracks,
    selectedClipIds,
    setSelectedClipIds,
    setCurrentTime,
    pixelsPerSecond,
    splitClipAtPlayhead,
    expandWithLinkedClips,
    setSlipSlideClip,
    setDraggingClip,
    setSelectedSubtitleId,
    trackContainerRef,
    trackContentRef,
    dragContainerRectRef,
    dragRowRef,
  })
  

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Handle lasso dragging
    if (handleLassoMove(e)) return

    if (!draggingClip || !trackContainerRef.current) return

    // Alt+drag: create duplicates on first significant movement (deferred from mouseDown)
    if (draggingClip.altHeld && !draggingClip.isDuplicate) {
      const dx = e.clientX - draggingClip.startX
      const dy = e.clientY - draggingClip.startY
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return

      const idMap = new Map<string, string>()
      const duplicateClips: TimelineClip[] = []
      for (const c of clips) {
        if (!draggingClip.originalPositions[c.id]) continue
        const newId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        idMap.set(c.id, newId)
        duplicateClips.push({ ...c, id: newId })
      }
      setClips(prev => [...prev, ...duplicateClips])

      const dupOrigPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      for (const [oldId, pos] of Object.entries(draggingClip.originalPositions)) {
        const newId = idMap.get(oldId)
        if (newId) dupOrigPositions[newId] = { ...pos }
      }
      const newPrimaryId = idMap.get(draggingClip.clipId) || draggingClip.clipId
      setSelectedClipIds(new Set(Object.keys(dupOrigPositions)))
      setDraggingClip({
        ...draggingClip,
        clipId: newPrimaryId,
        originalPositions: dupOrigPositions,
        isDuplicate: true,
        altHeld: false,
      })
      return
    }
    
    const primaryClip = clips.find(c => c.id === draggingClip.clipId)
    if (!primaryClip) return
    
    const deltaX = e.clientX - draggingClip.startX
    
    // Compute the primary clip's new position
    let newStartTime = draggingClip.originalStartTime + deltaX / pixelsPerSecond
    newStartTime = Math.max(0, newStartTime)
    
    // Snap the primary clip (skip other clips in the drag group for snapping)
    const origPositions = draggingClip.originalPositions
    let activeSnappedTarget: SnapTarget | null = null

    if (snapEnabled) {
      const snapThreshold = computeSnapThresholdSeconds(pixelsPerSecond)
      const ignoreClipIds = new Set(Object.keys(origPositions))
      const targets = collectTimelineSnapTargets({
        clips,
        transitions: activeTimeline?.transitions,
        currentTime: getCurrentTime(),
        markers: activeTimeline?.markers,
        ignoreClipIds,
      })

      const snapResult = snapClipMove({
        proposedStartTime: newStartTime,
        duration: primaryClip.duration,
        targets,
        snapThreshold,
      })

      newStartTime = snapResult.snappedTime
      activeSnappedTarget = snapResult.snappedTarget
    }

    setSnapGuideTime(activeSnappedTarget ? activeSnappedTarget.time : null)
    
    // Which row is the pointer over?
    //
    // Hit-test the real row boxes rather than dividing the drag distance by an
    // average row height: rows differ in height, so the average matched no row
    // and the target drifted further the further you dragged. Both the start
    // point and the current point go through the same test, so wherever inside
    // the clip you grabbed it stays put under the cursor.
    const container = trackContainerRef.current
    const contentEl = trackContentRef?.current ?? (container.querySelector('[data-track-bg="true"]')?.parentElement as HTMLElement | null) ?? container
    const contentRect = contentEl ? contentEl.getBoundingClientRect() : (dragContainerRectRef.current ?? container.getBoundingClientRect())
    const toLocalY = (clientY: number) => clientY - contentRect.top

    const rowBoxes: TimelineRowBox[] = orderedTracks.map(entry => ({
      top: trackTopPx(entry.realIndex),
      height: getTrackHeight(entry.realIndex),
    }))

    const startRow = rowIndexAtY(rowBoxes, toLocalY(draggingClip.startY))
    const pointerRow = stableRowIndexAtY(rowBoxes, toLocalY(e.clientY), dragRowRef.current)
    dragRowRef.current = pointerRow
    const rawDisplayDelta = pointerRow - startRow
    
    // Convert display-row delta to real-trackIndex delta for the primary clip.
    // orderedTracks maps displayRow → realIndex, so we find the primary clip's
    // current display row, offset it by the Y-delta, and look up the real index.
    const primaryRealIndex = draggingClip.originalTrackIndex
    // (primaryDisplayRow, targetDisplayRow, targetRealIndex used for debugging; trackIndexDelta removed — per-clip resolution below)
    
    
    // Compute raw deltas relative to primary clip's original position
    let timeDelta = newStartTime - draggingClip.originalStartTime
    
    // Clamp time delta so no clip goes before time 0
    for (const orig of Object.values(origPositions)) {
      if (orig.startTime + timeDelta < 0) {
        timeDelta = -orig.startTime
      }
    }
    
    // Premiere-style linked clip movement (mirrored around divider):
    //
    // Display layout (orderedTracks):
    //   row 0: V3  (top)       ← away from divider
    //   row 1: V2
    //   row 2: V1              ← nearest to divider
    //   --- divider ---
    //   row 3: A1              ← nearest to divider
    //   row 4: A2
    //   row 5: A3  (bottom)    ← away from divider
    //
    // The video and audio sections MIRROR around the divider. When you drag a
    // video clip "down" (toward divider), the linked audio should move "up"
    // (also toward divider). When you drag "up" (away from divider), audio
    // moves "down" (also away from divider). They move symmetrically relative
    // to the divider, not in the same screen direction.
    //
    // Implementation: the primary clip (being dragged) uses rawDisplayDelta.
    // Linked clips of the OPPOSITE kind get the delta INVERTED.
    // Each clip is independently clamped within its kind — if one hits its
    // boundary the other can still move.
    
    const primaryTrack = tracks[primaryRealIndex]
    const primaryKind = primaryTrack?.kind || 'video'
    
    // Build per-kind ordered lists (in display order)
    const videoDisplayRows = orderedTracks
      .filter(e => e.track.kind === 'video' && e.track.type !== 'subtitle')
      .map(e => ({ displayRow: e.displayRow, realIndex: e.realIndex }))
    const audioDisplayRows = orderedTracks
      .filter(e => e.track.kind === 'audio')
      .map(e => ({ displayRow: e.displayRow, realIndex: e.realIndex }))
    // Sticker rows move within their own kind too. Without this list a sticker
    // clip looked for itself among the video rows, never found itself, and was
    // left where it was — the clip simply refused to move to another row.
    const stickerDisplayRows = orderedTracks
      .filter(e => e.track.kind === 'sticker')
      .map(e => ({ displayRow: e.displayRow, realIndex: e.realIndex }))
    
    // Helper: resolve a clip's target track within its own kind
    const resolveTrackForClip = (origTrackIndex: number): number => {
      if (rawDisplayDelta === 0) return origTrackIndex
      
      const origTrack = tracks[origTrackIndex]
      const clipKind = origTrack?.kind || 'video'
      const kindRows = clipKind === 'audio'
        ? audioDisplayRows
        : clipKind === 'sticker' ? stickerDisplayRows : videoDisplayRows
      
      // Find this clip's position within its kind's ordered list
      const posInKind = kindRows.findIndex(r => r.realIndex === origTrackIndex)
      if (posInKind === -1) return origTrackIndex
      
      // Primary kind follows the drag direction; opposite kind mirrors (inverted delta)
      const effectiveDelta = clipKind === primaryKind ? rawDisplayDelta : -rawDisplayDelta
      
      const newPosInKind = posInKind + effectiveDelta
      if (newPosInKind < 0 && clipKind === 'video') {
        // Dragged ABOVE the top video track -> request new video track
        return -1
      }
      if (newPosInKind >= kindRows.length && clipKind === 'audio') {
        // Dragged BELOW the bottom audio track -> request new audio track
        return -2
      }
      if (newPosInKind < 0 && clipKind === 'sticker') {
        // Dragged ABOVE the top sticker track -> request new sticker track
        return -3
      }
      
      const clampedPos = Math.max(0, Math.min(kindRows.length - 1, newPosInKind))
      const newTrackIndex = kindRows[clampedPos].realIndex
      
      // Check if target track is locked
      if (tracks[newTrackIndex]?.locked) return origTrackIndex
      
      return newTrackIndex
    }
    
    const previewById: Record<string, DragPreviewPosition> = {}
    for (const [clipId, orig] of Object.entries(origPositions)) {
      previewById[clipId] = {
        startTime: orig.startTime + timeDelta,
        trackIndex: resolveTrackForClip(orig.trackIndex),
      }
    }
    dragPreviewRef.current = previewById

    if (dragPreviewRafRef.current === null) {
      dragPreviewRafRef.current = requestAnimationFrame(() => {
        dragPreviewRafRef.current = null
        if (!trackContainerRef.current) return
        const preview = dragPreviewRef.current
        if (!preview) return

        // A drop here onto other clips on an overlay track would send the dragged clips up
        // to a new track (liftCollidingClipsToNewTracks, which the drop itself runs too).
        // Showing them there while dragging means the release holds no surprise.
        const movedIdSet = new Set(Object.keys(preview))
        const positioned = clips.map(clip => {
          const target = preview[clip.id]
          return target && target.trackIndex >= 0
            ? { ...clip, startTime: target.startTime, trackIndex: target.trackIndex }
            : clip
        })
        const lifted = liftCollidingClipsToNewTracks(
          tracks, positioned, movedIdSet, activeTimeline?.transitions ?? [], mainVideoTrackIndex(tracks))
        const liftedKind = new Map<string, string>()
        if (lifted.clips !== positioned) {
          for (const clip of lifted.clips) {
            if (movedIdSet.has(clip.id) && clip.trackIndex >= tracks.length) {
              liftedKind.set(clip.id, lifted.tracks[clip.trackIndex]?.kind ?? 'video')
            }
          }
        }

        // Where a new track of each kind appears: above the video and sticker stacks,
        // below the audio stack — where an appended track is displayed.
        const newTrackSlot = (kind: string): { top: number; height: number } => {
          if (kind === 'audio') {
            const last = audioDisplayRows[audioDisplayRows.length - 1]
            const lastTop = last ? trackTopPx(last.realIndex) : 0
            const lastHeight = last ? getTrackHeight(last.realIndex) : audioTrackHeight
            return { top: lastTop + lastHeight, height: audioTrackHeight }
          }
          if (kind === 'sticker') {
            const top = stickerDisplayRows[0]
            const height = top ? getTrackHeight(top.realIndex) : stickerTrackHeight
            return { top: (top ? trackTopPx(top.realIndex) : 0) - height, height }
          }
          const top = videoDisplayRows[0]
          return { top: (top ? trackTopPx(top.realIndex) : 0) - videoTrackHeight, height: videoTrackHeight }
        }
        const slotKindFor = (clipId: string, trackIndex: number): string | undefined =>
          trackIndex === -1 ? 'video' : trackIndex === -2 ? 'audio' : trackIndex === -3 ? 'sticker' : liftedKind.get(clipId)
        const hintKinds = new Set<string>()
        let hintParent: HTMLElement | null = null

        for (const [clipId, target] of Object.entries(preview)) {
          const original = origPositions[clipId]
          if (!original) continue

          let node = dragPreviewNodesRef.current.get(clipId)
          if (!node || !node.el.isConnected) {
            const el = trackContainerRef.current.querySelector(`[data-clip-id="${clipId}"]`) as HTMLElement | null
            if (!el) continue
            node = {
              el,
              transform: el.style.transform,
              zIndex: el.style.zIndex,
              willChange: el.style.willChange,
            }
            dragPreviewNodesRef.current.set(clipId, node)
          }

          const xPx = (target.startTime - original.startTime) * pixelsPerSecond
          const slotKind = slotKindFor(clipId, target.trackIndex)
          let yPx: number
          if (slotKind) {
            yPx = (newTrackSlot(slotKind).top + 4) - trackTopPx(original.trackIndex, 4)
            hintKinds.add(slotKind)
            hintParent = hintParent ?? node.el.parentElement
          } else {
            yPx = trackTopPx(target.trackIndex, 4) - trackTopPx(original.trackIndex, 4)
          }
          node.el.style.transform = `translate3d(${xPx}px, ${yPx}px, 0)`
          node.el.style.zIndex = '40'
          node.el.style.willChange = 'transform'
        }

        // The rows themselves: one dashed slot per kind a new track is coming for.
        const hints = newTrackHintsRef.current
        for (const [kind, hint] of hints) {
          if (!hintKinds.has(kind)) { hint.remove(); hints.delete(kind) }
        }
        for (const kind of hintKinds) {
          const slot = newTrackSlot(kind)
          let hint = hints.get(kind)
          if (!hint || !hint.isConnected) {
            if (!hintParent) break
            hint = document.createElement('div')
            hint.dataset.newTrackHint = kind
            hint.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none;z-index:35;'
              + 'border:1px dashed rgba(34,211,238,0.75);border-radius:4px;background:rgba(34,211,238,0.08);'
            hintParent.appendChild(hint)
            hints.set(kind, hint)
          }
          hint.style.top = `${slot.top + 2}px`
          hint.style.height = `${Math.max(4, slot.height - 4)}px`
        }
      })
    }
  }, [draggingClip, clips, pixelsPerSecond, snapEnabled, tracks, getCurrentTime, lassoRect, orderedTracks, trackContainerRef, trackTopPx, videoTrackHeight, audioTrackHeight, stickerTrackHeight, getTrackHeight, activeTimeline])
  

  const handleMouseUp = useCallback((e?: MouseEvent | Event) => {
    setSnapGuideTime(null)
    // Finalize lasso selection
    if (handleLassoUp(e)) return

    // Commit drag result once (positions + overlap resolution) so history records one drag step.
    if (draggingClip) {
      const preview = dragPreviewRef.current
      const originalPositions = draggingClip.originalPositions
      const movedIds = new Set(Object.keys(originalPositions))

      const hasMoved = Boolean(
        draggingClip.isDuplicate ||
        (preview && Object.entries(preview).some(([clipId, target]) => {
          const orig = originalPositions[clipId]
          if (!orig) return true
          return Math.abs(target.startTime - orig.startTime) > 0.001 || target.trackIndex !== orig.trackIndex
        }))
      )

      if (!hasMoved) {
        clearDragPreviewDom()
        setDraggingClip(null)
        setResizingClip(null)
        return
      }

      const needsNewVideoTrack = preview
        ? Object.values(preview).some(target => target.trackIndex === -1)
        : false
      const needsNewAudioTrack = preview
        ? Object.values(preview).some(target => target.trackIndex === -2)
        : false
      const needsNewStickerTrack = preview
        ? Object.values(preview).some(target => target.trackIndex === -3)
        : false

      let newTrack: Track | null = null
      let newTrackIndex = -1
      if (needsNewVideoTrack) {
        const videoTrackCount = tracks.filter(t => t.kind === 'video' && t.type !== 'subtitle').length
        newTrack = {
          id: `track-video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: `V${videoTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'video',
        }
        newTrackIndex = tracks.length
      } else if (needsNewAudioTrack) {
        const audioTrackCount = tracks.filter(t => t.kind === 'audio').length
        newTrack = {
          id: `track-audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: `A${audioTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'audio',
        }
        newTrackIndex = tracks.length
      } else if (needsNewStickerTrack) {
        const stickerTrackCount = tracks.filter(t => t.kind === 'sticker').length
        newTrack = {
          id: `track-sticker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: `S${stickerTrackCount + 1}`,
          muted: false,
          locked: false,
          kind: 'sticker',
        }
        newTrackIndex = tracks.length
      }

      const allTracks = newTrack ? [...tracks, newTrack] : tracks

      const positioned = clips.map(clip => {
        const target = preview?.[clip.id]
        if (!target) return clip
        const assignedTrackIndex = (target.trackIndex === -1 || target.trackIndex === -2 || target.trackIndex === -3)
          ? (newTrackIndex >= 0 ? newTrackIndex : clip.trackIndex)
          : target.trackIndex
        return {
          ...clip,
          startTime: target.startTime,
          trackIndex: assignedTrackIndex,
        }
      })
      const currentTransitions = activeTimeline?.transitions ?? []
      const mainIndex = mainVideoTrackIndex(allTracks)
      // Landing on other clips on an overlay track sends the dragged clips up to a new
      // track rather than overwriting what is there — so resolveOverlaps below finds
      // nothing on an overlay track left to trim. The main track keeps its magnet.
      const lifted = liftCollidingClipsToNewTracks(allTracks, positioned, movedIds, currentTransitions, mainIndex)
      const resolved = resolveOverlaps(lifted.clips, movedIds, currentTransitions, mainIndex >= 0 ? mainIndex : 0)
      const packed = packMainVideoTrack(lifted.tracks, resolved, currentTransitions)
      const pruned = pruneEmptyOverlayTracks(lifted.tracks, packed, subtitles)
      flushSync(() => {
        replaceTimelineDocument({
          tracks: pruned.tracks,
          clips: pruned.clips,
          subtitles: pruned.subtitles,
        })
      })
      clearDragPreviewDom()
    }

    setDraggingClip(null)
    setResizingClip(null)
  }, [handleLassoUp, draggingClip, clips, pixelsPerSecond, setResizingClip, clearDragPreviewDom, replaceTimelineDocument, subtitles, tracks, activeTimeline])

  useEffect(() => {
    if (draggingClip || lassoRect) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggingClip, lassoRect, handleMouseMove, handleMouseUp])

  useEffect(() => {
    return () => {
      clearDragPreviewDom()
    }
  }, [clearDragPreviewDom])

  const handleTrackDrop = createTrackDropHandler({
    pixelsPerSecond,
    clips,
    setClips,
    tracks,
    assets,
    timelines,
    activeTimeline,
    trackContainerRef,
    addClipToTimeline,
    applyTransitionAtPoint,
    addFilterClip,
  })
  

  return {
    draggingClip, setDraggingClip,
    resizingClip, setResizingClip,
    slipSlideClip, setSlipSlideClip,
    lassoRect, setLassoRect,
    isScrubbing,
    scrubFromEvent,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
    expandWithLinkedClips,
    handleClipMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleResizeMove,
    handleResizeStart,
    handleSlipSlideMove,
    handleSlipSlideUp,
    handleTrackDrop,
    lassoOriginRef,
    snapGuideTime,
    setSnapGuideTime,
  }
}
