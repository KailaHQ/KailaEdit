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
  /** The monitor's own <video> for a source; loading waits until it shows a frame. */
  getMonitorVideo?: (path: string) => HTMLVideoElement | undefined
}

/** Longest the decoder waits on the monitor before loading anyway (a file <video> can't play). */
const MONITOR_PICTURE_WAIT_MS = 4000
const MONITOR_POLL_MS = 50

/**
 * Calls `onReady` once the monitor's <video> has a decoded frame, or after a timeout.
 * The element may not exist yet when this starts: the pool creates it on the first render.
 */
export function waitForMonitorPicture(
  getVideo: () => HTMLVideoElement | undefined,
  onReady: () => void,
): () => void {
  let done = false
  let video: HTMLVideoElement | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    if (done) return
    done = true
    cleanup()
    onReady()
  }
  const cleanup = () => {
    clearTimeout(pollTimer)
    clearTimeout(timeout)
    video?.removeEventListener('loadeddata', finish)
    video?.removeEventListener('error', finish)
  }
  const poll = () => {
    video = getVideo()
    if (!video) {
      pollTimer = setTimeout(poll, MONITOR_POLL_MS)
      return
    }
    if (video.readyState >= 2) {
      finish()
      return
    }
    video.addEventListener('loadeddata', finish)
    video.addEventListener('error', finish)
  }
  const timeout = setTimeout(finish, MONITOR_PICTURE_WAIT_MS)
  poll()
  return () => {
    done = true
    cleanup()
  }
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
  getMonitorVideo,
}: UseWebCodecsPreviewOptions): UseWebCodecsPreviewResult {
  const playerRef = useRef<WebCodecsPlayer | null>(null)
  const getMonitorVideoRef = useRef(getMonitorVideo)
  getMonitorVideoRef.current = getMonitorVideo
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
    let started = false

    const start = () => {
      if (isCancelled || started) return
      started = true
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
    }

    // `load` reads the WHOLE source into memory before the first frame can decode. Started
    // together with the monitor's own <video>, both hit the same file at once and the
    // monitor stayed black for seconds after a project opened. This decoder only speeds
    // up scrubbing, so it waits until the monitor has its picture.
    const stopWaiting = getMonitorVideoRef.current
      ? waitForMonitorPicture(() => getMonitorVideoRef.current?.(clipPath), start)
      : (start(), () => {})

    return () => {
      isCancelled = true
      stopWaiting()
      if (!started && lastLoadedPathRef.current === clipPath) lastLoadedPathRef.current = ''
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
