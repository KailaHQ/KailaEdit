import React from 'react'
import { pathToFileUrl } from '../../../../lib/file-url'
import type { AutoMatte } from '@core/project-model'

export function useBakeVideo(
  bakeVideoPath: string | undefined,
  autoMatte: AutoMatte | undefined,
  drawRef: React.MutableRefObject<(presentOnly?: boolean) => void>,
  isPlayingRef: React.MutableRefObject<boolean>,
  bakeVideoRef: React.MutableRefObject<HTMLVideoElement | null>,
  bakeFailedRef: React.MutableRefObject<boolean>,
  bakeDecodedTimeRef: React.MutableRefObject<number>,
  lastMatteSeekAtRef: React.MutableRefObject<number>,
  pendingMatteSeekRef: React.MutableRefObject<number | null>,
) {
  React.useEffect(() => {
    bakeFailedRef.current = false
    // The paired decoder owns fallback too. Do not load a duplicate matte stream.
    if (bakeVideoPath && autoMatte?.enabled && typeof VideoDecoder !== 'undefined') return
    if (!bakeVideoPath || !autoMatte?.enabled) {
      if (bakeVideoRef.current) {
        bakeVideoRef.current.pause()
        if (!bakeVideoPath) {
          bakeVideoRef.current.src = ''
          bakeVideoRef.current = null
        }
      }
      if (!bakeVideoPath) return
    }

    let video = bakeVideoRef.current
    if (!video) {
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      bakeVideoRef.current = video
    }

    const videoUrl = pathToFileUrl(bakeVideoPath)
    if (video.src !== videoUrl) {
      video.src = videoUrl
      video.load()
    }

    const redrawWhenReady = () => {
      bakeFailedRef.current = false
      if (bakeVideoRef.current) {
        bakeDecodedTimeRef.current = bakeVideoRef.current.currentTime
      }
      lastMatteSeekAtRef.current = performance.now()
      if (!isPlayingRef.current) drawRef.current()
      if (pendingMatteSeekRef.current !== null && bakeVideoRef.current && !bakeVideoRef.current.seeking) {
        const nextTime = pendingMatteSeekRef.current
        pendingMatteSeekRef.current = null
        bakeVideoRef.current.currentTime = nextTime
        lastMatteSeekAtRef.current = performance.now()
      }
    }
    const onError = () => {
      console.warn('[LutCanvas] Bake video failed to load, falling back to live inference:', bakeVideoPath)
      bakeFailedRef.current = true
      if (!isPlayingRef.current) drawRef.current()
    }
    video.addEventListener('loadeddata', redrawWhenReady)
    video.addEventListener('seeked', redrawWhenReady)
    video.addEventListener('error', onError)

    return () => {
      if (video) {
        video.removeEventListener('loadeddata', redrawWhenReady)
        video.removeEventListener('seeked', redrawWhenReady)
        video.removeEventListener('error', onError)
        video.pause()
        video.src = ''
      }
    }
  }, [
    bakeVideoPath,
    autoMatte?.enabled,
    drawRef,
    isPlayingRef,
    bakeVideoRef,
    bakeFailedRef,
    bakeDecodedTimeRef,
    lastMatteSeekAtRef,
    pendingMatteSeekRef,
  ])
}
