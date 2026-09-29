import { useRef, useEffect, useCallback } from 'react'
import { computePlayheadSnapThresholdSeconds, snapPlayheadTime, type SnapTarget } from '@core/timeline-snap'

interface UseTimelineScrubParams {
  trackContainerRef: React.RefObject<HTMLDivElement>
  timelineRef: React.RefObject<HTMLDivElement>
  rulerScrollRef?: React.RefObject<HTMLDivElement>
  pixelsPerSecond: number
  totalDuration: number
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  /**
   * What a dragged playhead catches on — clip edges on every track — read once when the
   * drag starts. Null (or absent) when snapping is off.
   */
  getSnapTargets?: () => ReadonlyArray<SnapTarget> | null
  /**
   * Draws the playhead (line + timecode) at a time straight away, without the store.
   * A scrub moves the line with this on every pointer event and commits the time — which
   * seeks the preview — at most once a frame, so the line never waits on the preview.
   */
  onScrubPreview?: (time: number) => void
  /** Shows (a time) or hides (null) the snap guide line while the playhead is caught. */
  onSnapGuideChange?: (time: number | null) => void
}

export function useTimelineScrub({
  trackContainerRef,
  timelineRef,
  rulerScrollRef,
  pixelsPerSecond,
  totalDuration,
  setCurrentTime,
  setIsPlaying,
  getSnapTargets,
  onScrubPreview,
  onSnapGuideChange,
}: UseTimelineScrubParams) {
  const isScrubbing = useRef(false)
  const autoScrollRaf = useRef<number | null>(null)
  const scrubRaf = useRef<number | null>(null)
  const scrubClientXRef = useRef<number>(0)
  /** Targets for the drag in progress; null outside a drag, or with snapping off. */
  const snapTargetsRef = useRef<ReadonlyArray<SnapTarget> | null>(null)
  /** Shift held: scrub freely past the edges. */
  const snapBypassRef = useRef(false)
  const snapGuideRef = useRef<number | null>(null)
  const onSnapGuideChangeRef = useRef(onSnapGuideChange)
  onSnapGuideChangeRef.current = onSnapGuideChange
  const onScrubPreviewRef = useRef(onScrubPreview)
  onScrubPreviewRef.current = onScrubPreview

  const setSnapGuide = useCallback((time: number | null) => {
    if (snapGuideRef.current === time) return
    snapGuideRef.current = time
    onSnapGuideChangeRef.current?.(time)
  }, [])

  /** Where the playhead goes for a pointer at `time`: clamped, and caught on a nearby clip edge. */
  const resolveScrubTime = useCallback((time: number) => {
    let next = Math.max(0, Math.min(totalDuration, time))
    const targets = snapTargetsRef.current
    if (targets && !snapBypassRef.current) {
      const snap = snapPlayheadTime({
        time: next,
        targets,
        snapThreshold: computePlayheadSnapThresholdSeconds(pixelsPerSecond),
      })
      if (snap.snappedTarget && snap.snappedTime <= totalDuration) {
        next = snap.snappedTime
        setSnapGuide(next)
      } else {
        setSnapGuide(null)
      }
    } else {
      setSnapGuide(null)
    }
    return next
  }, [pixelsPerSecond, setSnapGuide, totalDuration])

  /** Puts the playhead at `time` — in the store, which also seeks the preview. */
  const seekScrubbed = useCallback((time: number) => {
    setCurrentTime(resolveScrubTime(time))
  }, [resolveScrubTime, setCurrentTime])

  const timeAtClientX = useCallback((clientX: number): number | null => {
    const container = trackContainerRef.current || (timelineRef.current?.parentElement as HTMLDivElement | null)
    if (!container) return null
    const rect = container.getBoundingClientRect()
    // Clamp clientX strictly within container bounds [0, rect.width]
    const clampedOffset = Math.max(0, Math.min(rect.width, clientX - rect.left))
    return (container.scrollLeft + clampedOffset) / pixelsPerSecond
  }, [pixelsPerSecond, timelineRef, trackContainerRef])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = null
    }
  }, [])

  const stopScrubRaf = useCallback(() => {
    if (scrubRaf.current !== null) {
      cancelAnimationFrame(scrubRaf.current)
      scrubRaf.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopAutoScroll()
      stopScrubRaf()
    }
  }, [stopAutoScroll, stopScrubRaf])

  const scrubAtClientX = useCallback((clientX: number) => {
    const time = timeAtClientX(clientX)
    if (time !== null) seekScrubbed(time)
  }, [seekScrubbed, timeAtClientX])

  const scrubFromEvent = useCallback((clientX: number) => {
    scrubAtClientX(clientX)
  }, [scrubAtClientX])

  const startScrubbing = useCallback((initialClientX: number, shiftKey = false) => {
    isScrubbing.current = true
    setIsPlaying(false)
    snapTargetsRef.current = getSnapTargets?.() ?? null
    snapBypassRef.current = shiftKey
    scrubClientXRef.current = initialClientX
    scrubAtClientX(initialClientX)

    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const EDGE_ZONE = 40 // px from boundary where auto-scrolling activates

    const stepAutoScroll = () => {
      if (!isScrubbing.current) return
      const container = trackContainerRef.current || (timelineRef.current?.parentElement as HTMLDivElement | null)
      if (container) {
        const rect = container.getBoundingClientRect()
        const clientX = scrubClientXRef.current
        let scrollDelta = 0

        if (clientX < rect.left + EDGE_ZONE) {
          // Near or past left edge -> scroll left
          const dist = (rect.left + EDGE_ZONE) - clientX
          scrollDelta = -Math.min(35, Math.max(4, dist * 0.6))
        } else if (clientX > rect.right - EDGE_ZONE) {
          // Near or past right edge -> scroll right
          const dist = clientX - (rect.right - EDGE_ZONE)
          scrollDelta = Math.min(35, Math.max(4, dist * 0.6))
        }

        if (scrollDelta !== 0) {
          const prevScroll = container.scrollLeft
          const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
          const nextScroll = Math.max(0, Math.min(maxScroll, prevScroll + scrollDelta))
          if (nextScroll !== prevScroll) {
            container.scrollLeft = nextScroll
            if (rulerScrollRef?.current) {
              rulerScrollRef.current.scrollLeft = nextScroll
            }
            // Update time clamped to edge during scroll
            const clampedOffset = Math.max(0, Math.min(rect.width, clientX - rect.left))
            const time = (nextScroll + clampedOffset) / pixelsPerSecond
            seekScrubbed(time)
          }
        }
      }

      autoScrollRaf.current = requestAnimationFrame(stepAutoScroll)
    }

    stopAutoScroll()
    autoScrollRaf.current = requestAnimationFrame(stepAutoScroll)

    const onMove = (ev: MouseEvent) => {
      if (!isScrubbing.current) return
      ev.preventDefault()
      scrubClientXRef.current = ev.clientX
      snapBypassRef.current = ev.shiftKey
      // Move the line now, on this event. Waiting for the frame's commit put it a frame
      // (more, while the preview decoded) behind the pointer — the line trailed the mouse.
      const preview = onScrubPreviewRef.current
      if (preview) {
        const time = timeAtClientX(ev.clientX)
        if (time !== null) preview(resolveScrubTime(time))
      }
      if (scrubRaf.current === null) {
        scrubRaf.current = requestAnimationFrame(() => {
          scrubRaf.current = null
          if (isScrubbing.current) {
            scrubAtClientX(scrubClientXRef.current)
          }
        })
      }
    }

    const onUp = () => {
      isScrubbing.current = false
      stopAutoScroll()
      stopScrubRaf()
      scrubAtClientX(scrubClientXRef.current)
      snapTargetsRef.current = null
      setSnapGuide(null)
      document.body.style.cursor = prevCursor
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [getSnapTargets, pixelsPerSecond, resolveScrubTime, rulerScrollRef, scrubAtClientX, seekScrubbed, setIsPlaying, setSnapGuide, stopAutoScroll, stopScrubRaf, timeAtClientX, timelineRef, trackContainerRef])

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    startScrubbing(e.clientX, e.shiftKey)
  }, [startScrubbing])

  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    startScrubbing(e.clientX, e.shiftKey)
  }, [startScrubbing])

  return {
    isScrubbing,
    scrubFromEvent,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
  }
}
