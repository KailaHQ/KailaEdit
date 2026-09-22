import React from 'react'
import type { TimelineClip } from '../../../types/project-model'
import { hasKeyframesForProperty, sampleClipAt } from '@core/keyframes'
import { playbackDriveModeForSpeed } from '@core/clip-speed'
import {
  type MonitorRenderMode,
  type ActiveVideoContributor,
  type VideoContributorSyncState,
  type FrameRenderState,
  VIDEO_POOL_PREROLL_SECONDS,
  createMonitorVideoElement,
  applyPlaybackResolution,
  getClipTargetTime,
} from './preview-frame-engine'

export interface VideoPoolRefs {
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  videoPoolContainerRef: React.RefObject<HTMLDivElement | null>
  activePoolPathRef: React.MutableRefObject<string>
  activePoolClipIdRef: React.MutableRefObject<string | null>
  contributorSyncStatesRef: React.MutableRefObject<Map<string, VideoContributorSyncState>>
  preSeekDoneRef: React.MutableRefObject<string | null>
  compositingMediaRefs: React.MutableRefObject<Map<string, HTMLVideoElement | HTMLImageElement>>
  clipsRef: React.MutableRefObject<TimelineClip[]>
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
}

export interface UseVideoPoolManagerResult {
  ensurePoolVideo: (filePath: string) => HTMLVideoElement
  destroyPoolVideo: (filePath: string) => void
  syncVideoElement: (
    video: HTMLVideoElement,
    clip: TimelineClip,
    atTime: number,
    options: { forceSeek?: boolean; paused?: boolean },
  ) => void
  getContributorKey: (contributor: ActiveVideoContributor) => string
  ensureContributorSyncState: (contributor: ActiveVideoContributor) => VideoContributorSyncState
  syncPlaybackContributorVideo: (
    video: HTMLVideoElement,
    fallbackContributor: ActiveVideoContributor,
    fallbackAtTime: number,
    fallbackMode: MonitorRenderMode,
  ) => void
  syncRetainedPoolVideos: (state: FrameRenderState, mode: MonitorRenderMode) => void
}

export function useVideoPoolManager(
  refs: VideoPoolRefs,
  resolveClipPathRef: (clip: TimelineClip) => string,
  getNextVideoClipRef: (afterClip: TimelineClip) => TimelineClip | null,
  playbackTimeRef: React.MutableRefObject<number>,
  playbackResolution: 1 | 0.5 | 0.25,
): UseVideoPoolManagerResult {
  const {
    videoPoolRef,
    videoPoolContainerRef,
    activePoolPathRef,
    contributorSyncStatesRef,
    lastFrameRequestRef,
  } = refs

  const ensurePoolVideo = React.useCallback((filePath: string) => {
    let video = videoPoolRef.current.get(filePath)
    if (video) return video

    video = createMonitorVideoElement(filePath)
    applyPlaybackResolution(video, playbackResolution)
    videoPoolRef.current.set(filePath, video)
    if (videoPoolContainerRef.current) videoPoolContainerRef.current.appendChild(video)
    return video
  }, [playbackResolution, videoPoolContainerRef, videoPoolRef])

  const destroyPoolVideo = React.useCallback((filePath: string) => {
    const video = videoPoolRef.current.get(filePath)
    if (!video) return

    video.pause()
    video.removeAttribute('src')
    video.load()
    if (video.parentElement) video.parentElement.removeChild(video)
    if (activePoolPathRef.current === filePath) activePoolPathRef.current = ''
    videoPoolRef.current.delete(filePath)
  }, [activePoolPathRef, videoPoolRef])

  const syncVideoElement = React.useCallback((
    video: HTMLVideoElement,
    clip: TimelineClip,
    atTime: number,
    options: { forceSeek?: boolean; paused?: boolean },
  ) => {
    const { forceSeek: requestedSeek = false, paused = false } = options
    const scrubOwned = video.dataset?.matteScrubOwned === 'true' && Boolean(clip.autoMatte?.enabled && clip.autoMatte.bake?.path)
    if (!scrubOwned && video.dataset) delete video.dataset.matteScrubOwned
    const forceSeek = requestedSeek || (!paused && scrubOwned)
    if (paused && scrubOwned) {
      video.pause()
      delete (video as { __pendingSeekTime?: number }).__pendingSeekTime
      return // The matte pair's independent decoder owns scrub; do not decode the hidden full-size pool too.
    }
    if (!paused && scrubOwned) delete video.dataset.matteScrubOwned
    video.muted = true
    video.volume = 0

    if (!video.duration || Number.isNaN(video.duration)) {
      if (forceSeek) {
        video.play().then(() => { video.pause() }).catch(() => {})
      }
      return
    }

    const targetTime = getClipTargetTime(clip, video.duration, atTime)

    const currentSpeed = hasKeyframesForProperty(clip, 'speed')
      ? sampleClipAt(clip, Math.max(0, atTime - clip.startTime)).speed
      : (clip.speed ?? 1)

    // Past the element's rate ceiling there is no playing in real time, so the
    // clip is stepped by seeking instead. Letting it play on regardless left it
    // running far behind the playhead and showing frames from earlier in the
    // file, which looked like another part of the video cutting in.
    const drive = playbackDriveModeForSpeed(currentSpeed)
    const shouldPause = paused || clip.reversed || drive.seekDriven
    // Allow the browser video element to decode and play smoothly at high speeds (e.g. 10x)
    // without triggering false drift corrections every few milliseconds.
    const driftThreshold = shouldPause ? 0.000001 : Math.max(0.4, 0.4 * currentSpeed)
    if (shouldPause && !video.paused) video.pause()

    const desiredRate = clip.reversed || drive.seekDriven ? 1 : drive.rate
    if (video.playbackRate !== desiredRate) {
      video.playbackRate = desiredRate
    }

    const isSeeking = Boolean(video.seeking)
    if (!Number.isNaN(targetTime) && (forceSeek || Math.abs(video.currentTime - targetTime) > driftThreshold)) {
      if (isSeeking) {
        // A seek is already in flight: do not interrupt ongoing frame decode
        ;(video as { __pendingSeekTime?: number }).__pendingSeekTime = targetTime
        if (!(video as { __hasPendingSeekListener?: boolean }).__hasPendingSeekListener) {
          ;(video as { __hasPendingSeekListener?: boolean }).__hasPendingSeekListener = true
          const onSeeked = () => {
            const next = (video as { __pendingSeekTime?: number }).__pendingSeekTime
            if (typeof next === 'number' && !Number.isNaN(next)) {
              delete (video as { __pendingSeekTime?: number }).__pendingSeekTime
              // This listener outlives the render that installed it. Never use an
              // old playback drift tolerance to discard a subsequent paused seek.
              if (Math.abs(video.currentTime - next) > 0.000001) {
                video.currentTime = next
              }
            }
          }
          video.addEventListener('seeked', onSeeked)
        }
        return
      }
      delete (video as { __pendingSeekTime?: number }).__pendingSeekTime
      video.currentTime = targetTime
    }

    if (shouldPause) {
      if (!video.paused) {
        video.pause()
      }
    } else if (video.paused) {
      video.play().catch(() => {})
    }
  }, [])

  const getContributorKey = React.useCallback((contributor: ActiveVideoContributor) => {
    return `${contributor.target}:${contributor.clip.id}`
  }, [])

  const ensureContributorSyncState = React.useCallback((contributor: ActiveVideoContributor) => {
    const key = `${contributor.target}:${contributor.clip.id}`
    let syncState = contributorSyncStatesRef.current.get(key)
    if (!syncState) {
      syncState = { lastAtTime: null, pendingHardSync: false }
      contributorSyncStatesRef.current.set(key, syncState)
    }
    return syncState
  }, [contributorSyncStatesRef])

  const syncPlaybackContributorVideo = React.useCallback((
    video: HTMLVideoElement,
    fallbackContributor: ActiveVideoContributor,
    fallbackAtTime: number,
    fallbackMode: MonitorRenderMode,
  ) => {
    const lastFrame = lastFrameRequestRef.current
    const latestState = lastFrame?.state
    const latestMode = lastFrame?.mode ?? fallbackMode
    const latestContributor = latestState?.activeVideoContributors.find(contributor =>
      contributor.target === fallbackContributor.target && contributor.clip.id === fallbackContributor.clip.id
    ) ?? fallbackContributor
    if (latestContributor.clip.asset?.type !== 'video') return
    if (latestContributor.target === 'active' && resolveClipPathRef(latestContributor.clip) !== activePoolPathRef.current) return

    const syncState = ensureContributorSyncState(latestContributor)
    const atTime = latestMode === 'playback'
      ? playbackTimeRef.current
      : latestState?.atTime ?? fallbackAtTime

    syncVideoElement(video, latestContributor.clip, atTime, {
      forceSeek: syncState.pendingHardSync,
      paused: latestMode !== 'playback' || latestContributor.clip.reversed,
    })

    if (syncState.pendingHardSync) {
      syncState.pendingHardSync = false
    }
    syncState.lastAtTime = atTime
  }, [activePoolPathRef, ensureContributorSyncState, lastFrameRequestRef, playbackTimeRef, resolveClipPathRef, syncVideoElement])

  const syncRetainedPoolVideos = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    const desiredSources = new Set<string>()

    for (const contributor of state.activeVideoContributors) {
      if (contributor.clip.asset?.type !== 'video') continue
      const src = resolveClipPathRef(contributor.clip)
      if (src) desiredSources.add(src)
    }

    const activeVideoContributor = state.activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    if (mode === 'playback' && activeVideoContributor) {
      const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
      if (nextClip) {
        const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - state.atTime
        if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
          const nextSrc = resolveClipPathRef(nextClip)
          if (nextSrc) desiredSources.add(nextSrc)
        }
      }
    }

    for (const poolPath of Array.from(videoPoolRef.current.keys())) {
      if (!desiredSources.has(poolPath)) destroyPoolVideo(poolPath)
    }

    for (const src of desiredSources) {
      ensurePoolVideo(src)
    }
  }, [destroyPoolVideo, ensurePoolVideo, getNextVideoClipRef, resolveClipPathRef, videoPoolRef])

  return {
    ensurePoolVideo,
    destroyPoolVideo,
    syncVideoElement,
    getContributorKey,
    ensureContributorSyncState,
    syncPlaybackContributorVideo,
    syncRetainedPoolVideos,
  }
}
