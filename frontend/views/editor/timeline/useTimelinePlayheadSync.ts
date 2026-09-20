import { useCallback, useEffect } from 'react'
import { formatTime } from '../video-editor-utils'
import { selectCurrentTime } from '../editor-selectors'

export interface UseTimelinePlayheadSyncOptions {
  pixelsPerSecond: number
  totalDuration: number
  isPlaying: boolean
  playbackTimeRef: React.MutableRefObject<number>
  currentTimeRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  fitToViewRef: React.MutableRefObject<() => void>
  trackContainerRef: React.RefObject<HTMLDivElement>
  trackHeadersRef: React.RefObject<HTMLDivElement>
  coverGutterRef?: React.RefObject<HTMLDivElement>
  rulerScrollRef: React.RefObject<HTMLDivElement>
  playheadRulerRef: React.RefObject<HTMLDivElement>
  playheadOverlayRef: React.RefObject<HTMLDivElement>
  timelineTimecodeRef: React.RefObject<HTMLSpanElement>
  getMinZoom: () => number
  setZoom: (updater: (prev: number) => number) => void
  subscribeToSlice: (selector: any, listener: (value: any) => void) => () => void
  fps?: number
  timecodeFormat?: 'timecode' | 'frames'
}

export function useTimelinePlayheadSync(options: UseTimelinePlayheadSyncOptions) {
  const {
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
    fps = 24,
    timecodeFormat = 'timecode',
  } = options

  const getCurrentTime = useCallback(() => currentTimeRef.current, [currentTimeRef])

  const syncPlayheadPosition = useCallback((time: number) => {
    const container = trackContainerRef.current
    const scrollLeft = container?.scrollLeft || 0
    const clientWidth = container?.clientWidth || 0
    const leftPx = time * pixelsPerSecond

    if (playheadRulerRef.current) {
      playheadRulerRef.current.style.left = `${leftPx}px`
    }
    if (playheadOverlayRef.current) {
      const visibleX = leftPx - scrollLeft
      // Strictly clamp overlay playhead within visible tracks container bounds
      const clampedX = Math.max(0, Math.min(clientWidth, visibleX))
      playheadOverlayRef.current.style.left = `${clampedX}px`
      playheadOverlayRef.current.style.display = (visibleX < -2 || visibleX > clientWidth + 2) ? 'none' : ''
    }
  }, [pixelsPerSecond, playheadOverlayRef, playheadRulerRef, trackContainerRef])

  const syncTimelineTimecode = useCallback((time: number) => {
    if (timelineTimecodeRef.current) {
      timelineTimecodeRef.current.textContent = formatTime(time, fps, timecodeFormat)
    }
  }, [fps, timecodeFormat, timelineTimecodeRef])

  /**
   * Reserve the horizontal scrollbar's height in the track-header column too.
   */
  useEffect(() => {
    const scroller = trackContainerRef.current
    const headers = trackHeadersRef.current
    if (!scroller || !headers) return

    const matchScrollbarGutter = () => {
      const scrollbarHeight = scroller.offsetHeight - scroller.clientHeight
      headers.style.paddingBottom = scrollbarHeight > 0 ? `${scrollbarHeight}px` : ''
      if (coverGutterRef?.current) {
        coverGutterRef.current.style.paddingBottom = scrollbarHeight > 0 ? `${scrollbarHeight}px` : ''
      }
    }

    matchScrollbarGutter()
    const observer = new ResizeObserver(matchScrollbarGutter)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [totalDuration, pixelsPerSecond, trackContainerRef, trackHeadersRef, coverGutterRef])

  const syncTimelineScrollMirrors = useCallback(() => {
    const container = trackContainerRef.current
    if (!container) return

    if (trackHeadersRef.current) {
      trackHeadersRef.current.scrollTop = container.scrollTop
    }
    if (coverGutterRef?.current) {
      coverGutterRef.current.scrollTop = container.scrollTop
    }
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
  }, [rulerScrollRef, trackContainerRef, trackHeadersRef, coverGutterRef])

  const centrePlayheadInView = useCallback((time: number) => {
    const container = trackContainerRef.current
    if (!container) return

    const playheadX = time * pixelsPerSecond
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
    const nextScrollLeft = Math.max(0, Math.min(maxScroll, playheadX - container.clientWidth / 2))

    if (Math.abs(nextScrollLeft - container.scrollLeft) < 0.5) return
    container.scrollLeft = nextScrollLeft
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = nextScrollLeft
    }
  }, [pixelsPerSecond, rulerScrollRef, trackContainerRef])

  const handleTimelineScroll = useCallback(() => {
    syncTimelineScrollMirrors()
    syncPlayheadPosition(isPlaying ? playbackTimeRef.current : getCurrentTime())
  }, [getCurrentTime, isPlaying, playbackTimeRef, syncPlayheadPosition, syncTimelineScrollMirrors])

  const handleFitToView = useCallback(() => {
    const container = trackContainerRef.current
    if (!container || totalDuration <= 0) return
    const containerWidth = container.clientWidth - 20
    const idealZoom = containerWidth / (totalDuration * 100)
    setZoom(() => Math.min(4, Math.max(getMinZoom(), +idealZoom.toFixed(2))))
  }, [totalDuration, setZoom, getMinZoom, trackContainerRef])

  useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      const playheadTime = playbackTimeRef.current
      centrePlayheadInView(playheadTime)
      syncPlayheadPosition(playheadTime)
      syncTimelineTimecode(playheadTime)
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, centrePlayheadInView, playbackTimeRef, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    return subscribeToSlice(selectCurrentTime, (time: number) => {
      currentTimeRef.current = time
      if (isPlayingRef.current) return
      syncPlayheadPosition(time)
      syncTimelineTimecode(time)
    })
  }, [currentTimeRef, isPlayingRef, subscribeToSlice, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    if (isPlaying) return
    syncPlayheadPosition(currentTimeRef.current)
    syncTimelineTimecode(currentTimeRef.current)
  }, [isPlaying, currentTimeRef, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    if (!centerOnPlayheadRef.current) return
    centerOnPlayheadRef.current = false

    const container = trackContainerRef.current
    if (!container) return

    const playheadTime = isPlaying ? playbackTimeRef.current : currentTimeRef.current
    const playheadX = playheadTime * pixelsPerSecond
    const centerScroll = playheadX - container.clientWidth / 2
    container.scrollLeft = Math.max(0, centerScroll)
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
    syncPlayheadPosition(playheadTime)
    syncTimelineTimecode(playheadTime)
  }, [centerOnPlayheadRef, currentTimeRef, isPlaying, pixelsPerSecond, playbackTimeRef, rulerScrollRef, syncPlayheadPosition, syncTimelineTimecode, trackContainerRef])

  useEffect(() => {
    syncTimelineTimecode(currentTimeRef.current)
  }, [currentTimeRef, syncTimelineTimecode])

  useEffect(() => {
    const container = trackContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        centerOnPlayheadRef.current = true
        const delta = e.deltaY > 0 ? -0.15 : 0.15
        setZoom((prev: number) => Math.min(4, Math.max(getMinZoom(), +(prev + delta).toFixed(2))))
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [setZoom, centerOnPlayheadRef, getMinZoom, trackContainerRef])

  useEffect(() => {
    fitToViewRef.current = handleFitToView
  }, [fitToViewRef, handleFitToView])

  return {
    handleTimelineScroll,
    handleFitToView,
    syncPlayheadPosition,
    syncTimelineTimecode,
  }
}
