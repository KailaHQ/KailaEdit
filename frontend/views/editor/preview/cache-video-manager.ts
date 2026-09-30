import { pathToFileUrl } from '../../../lib/file-url'
import { applyPlaybackResolution, type MonitorRenderMode } from './preview-frame-engine'
import type { CachedSegmentInfo } from '../render-cache-store'

export interface CacheSlotState {
  activeSlot: 0 | 1
  hasActiveCache: boolean
  slotCachePaths: { 0: string | null; 1: string | null }
  /** Past the end of a segment but still showing its last frame, until the live picture is ready. */
  holding?: boolean
  holdSince?: number
}

/** The longest the last frame of a segment is held for the live picture to catch up. */
export const MAX_HOLD_MS = 600

export const PRELOAD_THRESHOLD_SECONDS = 2.0

/**
 * Manages double-buffered complex segment cache playback and preloading.
 * Ping-pongs between Slot 0 and Slot 1, preloading the next adjacent segment
 * ~2 seconds before crossing the segment boundary, eliminating frame drops.
 */
export function syncCachePlayback(
  atTime: number,
  mode: MonitorRenderMode,
  cachedSegments: CachedSegmentInfo[],
  cachedVideoA: HTMLVideoElement | null,
  cachedVideoB: HTMLVideoElement | null,
  state: CacheSlotState,
  playbackResolution: 1 | 0.5 | 0.25,
  onSlotChange?: (newSlot: 0 | 1) => void,
  onActiveCacheChange?: (hasActive: boolean) => void,
  /**
   * Whether the live layers under the cache are showing the right picture yet. Leaving a
   * segment while they are not shows them mid-seek, hidden — a black flash at the end of
   * every transition — so the segment's last frame stays up until they are (or MAX_HOLD_MS).
   */
  liveReady?: () => boolean,
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
): void {
  const activeCache = cachedSegments.find(
    s => s.ready && s.cachePath && atTime >= s.startTime && atTime < s.endTime,
  )

  if (activeCache && activeCache.cachePath) {
    state.holding = false
    state.holdSince = undefined
    const activeFileUrl = pathToFileUrl(activeCache.cachePath)
    const currentSlot = state.activeSlot
    const otherSlot: 0 | 1 = currentSlot === 0 ? 1 : 0
    const videoOf = (slot: 0 | 1) => (slot === 0 ? cachedVideoA : cachedVideoB)

    // Which slot is to play this segment.
    let playingSlot: 0 | 1
    if (state.slotCachePaths[currentSlot] === activeFileUrl) {
      playingSlot = currentSlot
    } else if (state.slotCachePaths[otherSlot] === activeFileUrl) {
      // Preloaded.
      playingSlot = otherSlot
    } else {
      // Cache miss / seek. What is on screen stays there until the new segment has a picture,
      // so it loads into the slot that is not showing; with nothing showing, into the current one.
      // (Scrubbing shows no cache layer, so there is nothing on screen to protect.)
      playingSlot = state.hasActiveCache && mode === 'playback' ? otherSlot : currentSlot
      const loading = videoOf(playingSlot)
      state.slotCachePaths[playingSlot] = activeFileUrl
      if (loading && loading.src !== activeFileUrl && !loading.src.endsWith(activeFileUrl)) {
        loading.src = activeFileUrl
        loading.load()
      }
    }
    const activeVid = videoOf(playingSlot)

    if (activeVid) {
      applyPlaybackResolution(activeVid, playbackResolution)
      const offset = Math.max(0, atTime - activeCache.startTime)
      if (mode === 'playback') {
        // Starting, the picture is put exactly where the playhead is; once running, it is left
        // alone unless it drifts a long way.
        if (Math.abs(activeVid.currentTime - offset) > (activeVid.paused ? 0.04 : 0.25)) {
          activeVid.currentTime = offset
        }
        if (activeVid.paused) {
          activeVid.play().catch(() => {})
        }
      } else {
        if (!activeVid.paused) activeVid.pause()
        if (Math.abs(activeVid.currentTime - offset) > 0.04) {
          activeVid.currentTime = offset
        }
      }
    }

    // Show the segment only once it has a picture to show. It sits over the live layers, so a
    // video that is still loading covers them with black: the flash at the start of a
    // transition, which is what these segments are for.
    const showing = state.hasActiveCache && state.activeSlot === playingSlot
    if (!showing && activeVid && activeVid.readyState >= 2 && !activeVid.seeking) {
      if (state.activeSlot !== playingSlot) {
        const previous = videoOf(state.activeSlot)
        state.activeSlot = playingSlot
        onSlotChange?.(playingSlot)
        if (previous && !previous.paused) previous.pause()
      }
      if (!state.hasActiveCache) {
        state.hasActiveCache = true
        onActiveCacheChange?.(true)
      }
    }

    // Preload next adjacent segment if playhead is within ~2 seconds of the segment boundary
    if (activeCache.endTime - atTime <= PRELOAD_THRESHOLD_SECONDS) {
      const nextCache = cachedSegments.find(
        s => s.ready && s.cachePath && Math.abs(s.startTime - activeCache.endTime) < 0.05,
      )
      if (nextCache && nextCache.cachePath) {
        const nextFileUrl = pathToFileUrl(nextCache.cachePath)
        const idleSlot: 0 | 1 = playingSlot === 0 ? 1 : 0
        const idleVid = idleSlot === 0 ? cachedVideoA : cachedVideoB

        if (idleVid && state.slotCachePaths[idleSlot] !== nextFileUrl) {
          state.slotCachePaths[idleSlot] = nextFileUrl
          if (idleVid.src !== nextFileUrl && !idleVid.src.endsWith(nextFileUrl)) {
            idleVid.src = nextFileUrl
            idleVid.load()
          }
          idleVid.currentTime = 0
          applyPlaybackResolution(idleVid, playbackResolution)
          if (!idleVid.paused) idleVid.pause()
        }
      }
    }
  } else {
    if (state.hasActiveCache) {
      const started = state.holdSince ?? now()
      if (mode === 'playback' && liveReady && !liveReady() && now() - started < MAX_HOLD_MS) {
        state.holding = true
        state.holdSince = started
        return
      }
      state.holding = false
      state.holdSince = undefined
      state.hasActiveCache = false
      onActiveCacheChange?.(false)
    }
    if (cachedVideoA && !cachedVideoA.paused) {
      cachedVideoA.pause()
    }
    if (cachedVideoB && !cachedVideoB.paused) {
      cachedVideoB.pause()
    }

    // A segment starting soon is loaded while the live picture still plays, so that reaching it
    // finds it ready. Preloading only from inside a neighbouring segment left every segment
    // that follows a stretch of ordinary playback to load on the spot.
    if (mode === 'playback') {
      const upcoming = cachedSegments
        .filter(s => s.ready && s.cachePath && s.startTime >= atTime && s.startTime - atTime <= PRELOAD_THRESHOLD_SECONDS)
        .sort((a, b) => a.startTime - b.startTime)[0]
      if (upcoming && upcoming.cachePath) {
        const upcomingUrl = pathToFileUrl(upcoming.cachePath)
        if (state.slotCachePaths[0] !== upcomingUrl && state.slotCachePaths[1] !== upcomingUrl) {
          const slot = state.activeSlot
          const vid = slot === 0 ? cachedVideoA : cachedVideoB
          if (vid) {
            state.slotCachePaths[slot] = upcomingUrl
            if (vid.src !== upcomingUrl && !vid.src.endsWith(upcomingUrl)) {
              vid.src = upcomingUrl
              vid.load()
            }
            vid.currentTime = 0
            applyPlaybackResolution(vid, playbackResolution)
            if (!vid.paused) vid.pause()
          }
        }
      }
    }
  }
}
