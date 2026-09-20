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
      setIsReady(false)
      setVideoFrame(null)
      return
    }

    const clipPath = resolveClipPath(activeClip)
    if (!clipPath || clipPath === lastLoadedPathRef.current) return

    lastLoadedPathRef.current = clipPath
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
  }, [activeClip, enabled, resolveClipPath])

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
      // NOT `prev.close()`.
      //
      // The frame belongs to the player's FrameCache — `set()` documents that the caller
      // passes ownership, and the cache closes each frame when it is evicted or
      // replaced. Closing it here too detached frames the cache was still holding, so a
      // later cache hit handed back a closed VideoFrame (`format === null`). Both
      // consumers check for that and skip it, which is why this showed up not as a crash
      // but as the WebCodecs path quietly going dead: every seek fell through to the
      // pooled <video>, and where that was not ready either the canvas drew nothing.
      setVideoFrame(frame)
    }).catch(() => {})

    return () => {
      isCancelled = true
    }
  }, [activeClip, currentTime, enabled, isPlaying, isReady])

  return {
    videoFrame,
    isSupported,
    isReady,
  }
}
