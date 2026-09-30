import React from 'react'

export function useSourceSync(
  sourceElement: HTMLVideoElement | HTMLImageElement | VideoFrame | null,
  drawRef: React.MutableRefObject<(presentOnly?: boolean) => void>,
  sourceDecodedTimeRef: React.MutableRefObject<number>,
  lastSourceSeekAtRef: React.MutableRefObject<number>,
  isPlayingRef: React.MutableRefObject<boolean>,
) {
  // Still image load listener
  React.useEffect(() => {
    if (!(sourceElement instanceof HTMLImageElement)) return
    const image = sourceElement
    const onLoad = () => drawRef.current()
    image.addEventListener('load', onLoad)
    return () => image.removeEventListener('load', onLoad)
  }, [drawRef, sourceElement])

  // Video element load/seek/canplay listeners
  React.useEffect(() => {
    if (!(sourceElement instanceof HTMLVideoElement)) return
    const video = sourceElement
    const redraw = () => {
      sourceDecodedTimeRef.current = video.currentTime
      lastSourceSeekAtRef.current = performance.now()
      if (!isPlayingRef.current) drawRef.current()
    }
    if (video.readyState >= 2) redraw()
    video.addEventListener('loadeddata', redraw)
    video.addEventListener('seeked', redraw)
    video.addEventListener('canplay', redraw)
    return () => {
      video.removeEventListener('loadeddata', redraw)
      video.removeEventListener('seeked', redraw)
      video.removeEventListener('canplay', redraw)
    }
  }, [sourceElement, drawRef, sourceDecodedTimeRef, lastSourceSeekAtRef, isPlayingRef])

  // VideoFrame timestamp sync
  React.useEffect(() => {
    if (typeof VideoFrame !== 'undefined' && sourceElement instanceof VideoFrame) {
      sourceDecodedTimeRef.current = sourceElement.timestamp / 1_000_000
      lastSourceSeekAtRef.current = performance.now()
      if (!isPlayingRef.current) drawRef.current()
    }
  }, [sourceElement, drawRef, sourceDecodedTimeRef, lastSourceSeekAtRef, isPlayingRef])
}
