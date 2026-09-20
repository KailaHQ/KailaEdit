import React from 'react'
import type { TimelineClip, Track } from '../../../types/project-model'
import type { ToolType } from '../video-editor-utils'
import type { DraggingClipState } from '../useTimelineDrag'

export interface ClipMouseDownParams {
  activeTool: ToolType
  clips: TimelineClip[]
  tracks: Track[]
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setCurrentTime: (time: number) => void
  pixelsPerSecond: number
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  expandWithLinkedClips: (ids: Set<string>) => Set<string>
  setSlipSlideClip: (state: any) => void
  setDraggingClip: React.Dispatch<React.SetStateAction<DraggingClipState | null>>
  setSelectedSubtitleId: (id: string | null) => void
  setSelectedGap: (gap: any) => void
  trackContainerRef: React.RefObject<HTMLDivElement>
  trackContentRef?: React.RefObject<HTMLDivElement>
  dragContainerRectRef: React.MutableRefObject<DOMRect | null>
  dragRowRef: React.MutableRefObject<number | null>
}

/**
 * Creates the mouseDown handler for clips on the timeline.
 *
 * Dispatches to the correct tool behaviour: blade, slip, slide, trackForward,
 * or the default select/ripple/roll drag.
 */
export function createClipMouseDownHandler(params: ClipMouseDownParams) {
  const {
    activeTool,
    clips,
    tracks,
    selectedClipIds,
    setSelectedClipIds,
    setCurrentTime,
    splitClipAtPlayhead,
    expandWithLinkedClips,
    setSlipSlideClip,
    setDraggingClip,
    setSelectedSubtitleId,
    setSelectedGap,
    trackContainerRef,
    trackContentRef,
    dragContainerRectRef,
    dragRowRef,
  } = params

  return (e: React.MouseEvent, clip: TimelineClip) => {
    e.stopPropagation()
    
    // Prevent all interactions on locked tracks (except selection)
    const clipTrack = tracks[clip.trackIndex]
    if (clipTrack?.locked) {
      // Still allow selecting the clip visually
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
      return
    }
    
    if (activeTool === 'blade') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickTime = clip.startTime + (clickX / rect.width) * clip.duration
      
      setCurrentTime(clickTime)
      
      if (e.shiftKey) {
        // Shift+blade: cut ALL clips at this time across all unlocked tracks
        const clipIds = clips
          .filter(c =>
            clickTime > c.startTime + 0.1 &&
            clickTime < c.startTime + c.duration - 0.1 &&
            !tracks[c.trackIndex]?.locked
          )
          .map(c => c.id)
        if (clipIds.length > 0) {
          splitClipAtPlayhead(clipIds[0], clickTime, clipIds)
        }
      } else {
        // Normal blade: cut only the clicked clip
        splitClipAtPlayhead(clip.id, clickTime)
      }
      return
    }
    
    // --- Slip tool: shift source content within clip ---
    if (activeTool === 'slip') {
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
      setSlipSlideClip({
        clipId: clip.id,
        tool: 'slip',
        startX: e.clientX,
        originalTrimStart: clip.trimStart,
        originalTrimEnd: clip.trimEnd,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
      })
      return
    }
    
    // --- Slide tool: move clip, adjust neighbors ---
    if (activeTool === 'slide') {
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
      
      // Find the previous and next clips on the same track
      const sameTrack = clips
        .filter(c => c.trackIndex === clip.trackIndex && c.id !== clip.id)
        .sort((a, b) => a.startTime - b.startTime)
      const prevClip = sameTrack.filter(c => c.startTime + c.duration <= clip.startTime + 0.05).pop()
      const nextClip = sameTrack.find(c => c.startTime >= clip.startTime + clip.duration - 0.05)
      
      setSlipSlideClip({
        clipId: clip.id,
        tool: 'slide',
        startX: e.clientX,
        originalTrimStart: clip.trimStart,
        originalTrimEnd: clip.trimEnd,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        prevClipId: prevClip?.id,
        prevOrigDuration: prevClip?.duration,
        nextClipId: nextClip?.id,
        nextOrigStartTime: nextClip?.startTime,
        nextOrigDuration: nextClip?.duration,
        nextOrigTrimStart: nextClip?.trimStart,
      })
      return
    }
    
    // --- Track Select Forward: select this clip + all clips to the right ---
    if (activeTool === 'trackForward') {
      const forwardClips = clips.filter(c => {
        if (e.shiftKey) {
          // Shift held: select forward on SAME track only
          return c.trackIndex === clip.trackIndex && c.startTime >= clip.startTime
        } else {
          // Default: select forward on ALL tracks (like Premiere)
          return c.startTime >= clip.startTime
        }
      })
      const forwardIds = expandWithLinkedClips(new Set(forwardClips.map(c => c.id)))
      setSelectedClipIds(forwardIds)
      setSelectedSubtitleId(null)
      setSelectedGap(null)
      
      dragContainerRectRef.current = trackContainerRef.current?.getBoundingClientRect() ?? null
      dragRowRef.current = null
      // Start drag so the user can slide the whole forward selection
      const originalPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      clips.filter(c => forwardIds.has(c.id)).forEach(c => {
        originalPositions[c.id] = { startTime: c.startTime, trackIndex: c.trackIndex }
      })
      setDraggingClip({
        clipId: clip.id,
        startX: e.clientX,
        startY: e.clientY,
        originalStartTime: clip.startTime,
        originalTrackIndex: clip.trackIndex,
        originalPositions,
      })
      return
    }
    
    if (activeTool === 'select' || activeTool === 'ripple' || activeTool === 'roll') {
      // Compute the effective selection BEFORE React processes the state update
      let effectiveSelection: Set<string>
      if (e.shiftKey) {
        // Shift+click: toggle clip in/out of multi-selection (toggle linked group together)
        effectiveSelection = new Set(selectedClipIds)
        if (effectiveSelection.has(clip.id)) {
          effectiveSelection.delete(clip.id)
          if (!e.altKey && clip.linkedClipIds) clip.linkedClipIds.forEach(lid => effectiveSelection.delete(lid))
        } else {
          effectiveSelection.add(clip.id)
          if (!e.altKey && clip.linkedClipIds) clip.linkedClipIds.forEach(lid => {
            if (clips.some(c => c.id === lid)) effectiveSelection.add(lid)
          })
        }
        setSelectedClipIds(effectiveSelection)
      } else if (e.altKey) {
        // Alt+click: select ONLY this specific clip, ignoring linked clips (like Premiere)
        if (selectedClipIds.has(clip.id)) {
          effectiveSelection = selectedClipIds
        } else {
          effectiveSelection = new Set([clip.id])
          setSelectedClipIds(effectiveSelection)
        }
      } else {
        // Normal click: select this clip + its linked clips
        effectiveSelection = expandWithLinkedClips(new Set([clip.id]))
        setSelectedClipIds(effectiveSelection)
      }
      
      // Only drag clips that are in the effective (visual) selection.
      // This allows moving just the video or audio part of a linked clip
      // when only that part is selected (e.g. via Alt+lasso). Links are preserved.
      const originalPositions: Record<string, { startTime: number; trackIndex: number }> = {}
      for (const c of clips) {
        if (effectiveSelection.has(c.id)) {
          originalPositions[c.id] = { startTime: c.startTime, trackIndex: c.trackIndex }
        }
      }
      // Always ensure the clicked clip is in the group
      if (!originalPositions[clip.id]) {
        originalPositions[clip.id] = { startTime: clip.startTime, trackIndex: clip.trackIndex }
      }
      
      const contentEl = trackContentRef?.current ?? (trackContainerRef.current?.querySelector('[data-track-bg="true"]')?.parentElement as HTMLElement | null) ?? trackContainerRef.current
      dragContainerRectRef.current = contentEl?.getBoundingClientRect() ?? null
      dragRowRef.current = null
      // Set up dragging. Alt+drag duplication is deferred to first mouseMove
      // so that Alt+click (no drag) only changes selection without creating duplicates.
      setDraggingClip({
        clipId: clip.id,
        startX: e.clientX,
        startY: e.clientY,
        originalStartTime: clip.startTime,
        originalTrackIndex: clip.trackIndex,
        originalPositions,
        altHeld: e.altKey || undefined,
      })
    }
  }
}
