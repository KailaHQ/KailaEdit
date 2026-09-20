import { useState, useRef, useCallback } from 'react'
import type { TimelineClip } from '../../../types/project-model'

export interface LassoRect {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface UseTimelineLassoParams {
  clips: TimelineClip[]
  pixelsPerSecond: number
  getTrackHeight: (trackIndex: number) => number
  trackTopPx: (realTrackIndex: number, padding?: number) => number
  trackContainerRef: React.RefObject<HTMLDivElement>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  expandWithLinkedClips: (ids: Set<string>) => Set<string>
}

export function useTimelineLasso({
  clips,
  pixelsPerSecond,
  getTrackHeight,
  trackTopPx,
  trackContainerRef,
  setSelectedClipIds,
  expandWithLinkedClips,
}: UseTimelineLassoParams) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null)
  const lassoOriginRef = useRef<{ scrollLeft: number; containerLeft: number; containerTop: number } | null>(null)

  const handleLassoMove = useCallback((e: MouseEvent) => {
    if (lassoRect) {
      setLassoRect(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null)
      return true
    }
    return false
  }, [lassoRect])

  const handleLassoUp = useCallback((e?: MouseEvent | Event) => {
    if (lassoRect && trackContainerRef.current) {
      const origin = lassoOriginRef.current
      if (origin) {
        const container = trackContainerRef.current
        const scrollLeft = container.scrollLeft
        const scrollTop = container.scrollTop

        // Compute lasso rectangle in timeline-local coordinates
        const lx1 = Math.min(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
        const lx2 = Math.max(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
        const ly1 = Math.min(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
        const ly2 = Math.max(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop

        // Convert to time/track
        const timeStart = lx1 / pixelsPerSecond
        const timeEnd = lx2 / pixelsPerSecond
        const newSelection = new Set<string>()
        for (const clip of clips) {
          const clipLeft = clip.startTime
          const clipRight = clip.startTime + clip.duration
          const th = getTrackHeight(clip.trackIndex)
          const clipTop = trackTopPx(clip.trackIndex) + 4
          const clipBottom = clipTop + (th - 8) // clip height = trackHeight - 8px padding

          // Check overlap between lasso rect and clip rect
          if (clipRight > timeStart && clipLeft < timeEnd && clipBottom > ly1 && clipTop < ly2) {
            newSelection.add(clip.id)
          }
        }
        // Alt/Option held: select only what's in the lasso (skip linked clips)
        const altHeld = e instanceof MouseEvent && e.altKey
        setSelectedClipIds(altHeld ? newSelection : expandWithLinkedClips(newSelection))
      }
      setLassoRect(null)
      lassoOriginRef.current = null
      return true
    }
    return false
  }, [lassoRect, trackContainerRef, pixelsPerSecond, clips, getTrackHeight, trackTopPx, setSelectedClipIds, expandWithLinkedClips])

  return {
    lassoRect,
    setLassoRect,
    lassoOriginRef,
    handleLassoMove,
    handleLassoUp,
  }
}
