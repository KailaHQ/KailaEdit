import { useEffect, useRef, useState } from 'react'
import type { TimelineClip } from '@/types/project-model'
import { WebCodecsPlayer } from './WebCodecsPlayer'
import { getClipTargetTime } from '../preview-frame-engine'

export interface UseWebCodecsPreviewOptions {
  activeClip: TimelineClip | null
  currentTime: number
  isPlaying: boolean
  resolveClipPath: (clip: TimelineClip) => string
  enabled?: boolean
}

export interface UseWebCodecsPreviewResult {
  videoFrame: VideoFrame | null
  isSupported: boolean
  isReady: boolean
}

export function useWebCodecsPreview({
  activeClip,
  currentTime,
  isPlaying,
  resolveClipPath,
  enabled = true,
}: UseWebCodecsPreviewOptions): UseWebCodecsPreviewResult {
  const playerRef = useRef<WebCodecsPlayer | null>(null)
  const [videoFrame, setVideoFrame] = useState<VideoFrame | null>(null)
  const [isReady, setIsReady] = useState(false)
  const lastLoadedPathRef = useRef('')
  const isSupported = typeof VideoDecoder !== 'undefined'
  const clipPath = enabled && activeClip?.asset?.type === 'video' ? resolveClipPath(activeClip) : ''

  // Initialize WebCodecsPlayer
  useEffect(() => {
    if (!isSupported || !enabled) return

    const player = new WebCodecsPlayer()
    playerRef.current = player

    return () => {
      player.destroy()
      playerRef.current = null
      setVideoFrame(null)
      setIsReady(false)
      lastLoadedPathRef.current = ''
    }
  }, [enabled, isSupported])

  // Load active video clip
  useEffect(() => {
    const player = playerRef.current
    if (!player || !enabled || !activeClip || activeClip.asset?.type !== 'video') {
      lastLoadedPathRef.current = ''
      setIsReady(false)
      setVideoFrame(null)
      return
    }

    if (!clipPath || clipPath === lastLoadedPathRef.current) return

    lastLoadedPathRef.current = clipPath
    setIsReady(false)
    setVideoFrame(null)
    let isCancelled = false

    player.load(clipPath).then((success) => {
      if (isCancelled) return
      setIsReady(success)
      if (!success) {
        setVideoFrame(null)
      }
    }).catch(() => {
      if (!isCancelled) {
        setIsReady(false)
        setVideoFrame(null)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [clipPath, enabled])

  // Seek on scrubbing / paused playhead updates
  useEffect(() => {
    const player = playerRef.current
    // When playing normally, clear videoFrame so the standard video pool handles A/V sync playback
    if (isPlaying || !enabled || !isReady || !player || !activeClip || activeClip.asset?.type !== 'video') {
      // Dropping the reference is enough; the cache still owns the frame and will close
      // it in its own time. See the note on ownership below.
      if (videoFrame && isPlaying) {
        setVideoFrame(null)
      }
      return
    }

    const duration = player.getMetadata()?.duration ?? activeClip.asset?.duration ?? activeClip.duration ?? 0
    const targetTime = getClipTargetTime(activeClip, duration, currentTime)
    let isCancelled = false

    player.seek(targetTime).then((frame) => {
      if (isCancelled || !frame) return
      // React owns a clone, so a subsequent seek/cache eviction cannot detach
      // the frame still being displayed. Release it after React replaces it.
      setVideoFrame(frame.clone())
    }).catch(() => {})

    return () => {
      isCancelled = true
    }
  }, [activeClip, currentTime, enabled, isPlaying, isReady])

  useEffect(() => () => videoFrame?.close(), [videoFrame])

  return {
    videoFrame,
    isSupported,
    isReady,
  }
}
