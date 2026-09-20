import { useRef, useEffect, useCallback } from 'react'

interface UseTimelineScrubParams {
  trackContainerRef: React.RefObject<HTMLDivElement>
  timelineRef: React.RefObject<HTMLDivElement>
  rulerScrollRef?: React.RefObject<HTMLDivElement>
  pixelsPerSecond: number
  totalDuration: number
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
}

export function useTimelineScrub({
  trackContainerRef,
  timelineRef,
  rulerScrollRef,
  pixelsPerSecond,
  totalDuration,
  setCurrentTime,
  setIsPlaying,
}: UseTimelineScrubParams) {
  const isScrubbing = useRef(false)
  const autoScrollRaf = useRef<number | null>(null)
  const scrubRaf = useRef<number | null>(null)
  const scrubClientXRef = useRef<number>(0)

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
    const container = trackContainerRef.current || (timelineRef.current?.parentElement as HTMLDivElement | null)
    if (!container) return
    const rect = container.getBoundingClientRect()
    // Clamp clientX strictly within container bounds [0, rect.width]
    const clampedOffset = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const time = (container.scrollLeft + clampedOffset) / pixelsPerSecond
    setCurrentTime(Math.max(0, Math.min(totalDuration, time)))
  }, [pixelsPerSecond, setCurrentTime, timelineRef, totalDuration, trackContainerRef])

  const scrubFromEvent = useCallback((clientX: number) => {
    scrubAtClientX(clientX)
  }, [scrubAtClientX])

  const startScrubbing = useCallback((initialClientX: number) => {
    isScrubbing.current = true
    setIsPlaying(false)
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
            setCurrentTime(Math.max(0, Math.min(totalDuration, time)))
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
      document.body.style.cursor = prevCursor
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [pixelsPerSecond, rulerScrollRef, scrubAtClientX, setCurrentTime, setIsPlaying, stopAutoScroll, stopScrubRaf, timelineRef, totalDuration, trackContainerRef])

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    startScrubbing(e.clientX)
  }, [startScrubbing])

  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    startScrubbing(e.clientX)
  }, [startScrubbing])

  return {
    isScrubbing,
    scrubFromEvent,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
  }
}
