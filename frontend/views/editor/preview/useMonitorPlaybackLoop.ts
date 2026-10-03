import React from 'react'
import type { TimelineClip } from '../../../types/project-model'
import { applyPlaybackResolution, type FrameRenderState, type MonitorRenderMode } from './preview-frame-engine'
import type { LutCanvasRef } from './LutCanvas'

export interface UseMonitorPlaybackLoopOptions {
  isPlaying: boolean
  playbackTimeRef: React.MutableRefObject<number>
  currentTime: number
  clips: TimelineClip[]
  subtitles: unknown[]
  tracks: unknown[]
  isPreviewingVideo: boolean
  playbackResolution: 1 | 0.5 | 0.25
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  cachedVideoRefA: React.MutableRefObject<HTMLVideoElement | null>
  cachedVideoRefB: React.MutableRefObject<HTMLVideoElement | null>
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
  lutCanvasRef: React.RefObject<LutCanvasRef | null>
  destroyPoolVideo: (path: string) => void
  renderFrame: (time: number, mode: MonitorRenderMode) => void
  applyFrameVisuals: (state: FrameRenderState, mode: MonitorRenderMode) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  setIsFullscreen: (val: boolean) => void
  // Shortcuts
  selectedClip: TimelineClip | null | undefined
  cropMode: boolean
  eyedropperMode: boolean
  toggleCropMode: () => void
  setCropMode: (val: boolean) => void
  setEyedropperMode: (val: boolean) => void
  setPreviewAssetId: (id: string | null) => void
}

export function useMonitorPlaybackLoop({
  isPlaying,
  playbackTimeRef,
  currentTime,
  clips,
  subtitles,
  tracks,
  isPreviewingVideo,
  playbackResolution,
  videoPoolRef,
  cachedVideoRefA,
  cachedVideoRefB,
  lastFrameRequestRef,
  lutCanvasRef,
  destroyPoolVideo,
  renderFrame,
  applyFrameVisuals,
  containerRef,
  setIsFullscreen,
  selectedClip,
  cropMode,
  eyedropperMode,
  toggleCropMode,
  setCropMode,
  setEyedropperMode,
  setPreviewAssetId,
}: UseMonitorPlaybackLoopOptions) {
  // Apply resolution to video pool elements and cached videos
  React.useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      applyPlaybackResolution(video, playbackResolution)
    }
    if (cachedVideoRefA.current) {
      applyPlaybackResolution(cachedVideoRefA.current, playbackResolution)
    }
    if (cachedVideoRefB.current) {
      applyPlaybackResolution(cachedVideoRefB.current, playbackResolution)
    }
  }, [playbackResolution, videoPoolRef, cachedVideoRefA, cachedVideoRefB])

  // Pause cached videos when playback stops
  React.useEffect(() => {
    if (!isPlaying) {
      if (cachedVideoRefA.current && !cachedVideoRefA.current.paused) {
        cachedVideoRefA.current.pause()
      }
      if (cachedVideoRefB.current && !cachedVideoRefB.current.paused) {
        cachedVideoRefB.current.pause()
      }
    }
  }, [isPlaying, cachedVideoRefA, cachedVideoRefB])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      for (const poolPath of Array.from(videoPoolRef.current.keys())) {
        destroyPoolVideo(poolPath)
      }
      for (const ref of [cachedVideoRefA, cachedVideoRefB]) {
        if (ref.current) {
          ref.current.pause()
          ref.current.removeAttribute('src')
          ref.current.load()
        }
      }
    }
  }, [destroyPoolVideo, videoPoolRef, cachedVideoRefA, cachedVideoRefB])

  // Playback animation frame loop
  React.useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      renderFrame(playbackTimeRef.current, 'playback')
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, playbackTimeRef, renderFrame])

  // Scrub render on position / content update
  React.useEffect(() => {
    if (isPlaying) return
    renderFrame(currentTime, 'scrub')
  }, [clips, currentTime, isPlaying, renderFrame, subtitles, tracks])

  // Re-sync timeline visuals when exiting video preview mode.
  // Never while playing: then `currentTime` reaches the store every 250 ms, and each pass
  // re-rendered the frame in 'scrub' mode, which hard-seeks the playing video to the
  // playhead — a hitch four times a second.
  React.useEffect(() => {
    if (!isPreviewingVideo && !isPlaying) {
      lastFrameRequestRef.current = null
      renderFrame(currentTime, 'scrub')
      requestAnimationFrame(() => {
        lutCanvasRef.current?.renderNow()
        const last = lastFrameRequestRef.current
        if (last) {
          applyFrameVisuals(last.state, last.mode)
        }
      })
    }
  }, [isPreviewingVideo, isPlaying, currentTime, renderFrame, applyFrameVisuals, lastFrameRequestRef, lutCanvasRef])

  // Fullscreen change listener
  React.useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [containerRef, setIsFullscreen])

  // Key shortcuts: 'C' for crop, 'Escape' to exit modes
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        if (selectedClip && (selectedClip.type === 'video' || selectedClip.type === 'image')) {
          e.preventDefault()
          toggleCropMode()
        }
      } else if (e.key === 'Escape') {
        if (cropMode) {
          e.preventDefault()
          setCropMode(false)
        }
        if (eyedropperMode) {
          e.preventDefault()
          setEyedropperMode(false)
        }
        if (isPreviewingVideo) {
          e.preventDefault()
          setPreviewAssetId(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cropMode, eyedropperMode, isPreviewingVideo, selectedClip, setCropMode, setEyedropperMode, setPreviewAssetId, toggleCropMode])
}
