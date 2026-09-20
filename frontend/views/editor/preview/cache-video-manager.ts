import { pathToFileUrl } from '../../../lib/file-url'
import { applyPlaybackResolution, type MonitorRenderMode } from './preview-frame-engine'
import type { CachedSegmentInfo } from '../render-cache-store'

export interface CacheSlotState {
  activeSlot: 0 | 1
  hasActiveCache: boolean
  slotCachePaths: { 0: string | null; 1: string | null }
}

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
): void {
  const activeCache = cachedSegments.find(
    s => s.ready && s.cachePath && atTime >= s.startTime && atTime < s.endTime,
  )

  if (activeCache && activeCache.cachePath) {
    if (!state.hasActiveCache) {
      state.hasActiveCache = true
      onActiveCacheChange?.(true)
    }

    const activeFileUrl = pathToFileUrl(activeCache.cachePath)
    const currentSlot = state.activeSlot
    const otherSlot: 0 | 1 = currentSlot === 0 ? 1 : 0
    const currentVid = currentSlot === 0 ? cachedVideoA : cachedVideoB
    const otherVid = otherSlot === 0 ? cachedVideoA : cachedVideoB

    let playingSlot: 0 | 1 = currentSlot
    let activeVid = currentVid

    if (state.slotCachePaths[currentSlot] === activeFileUrl) {
      // Current slot already has this segment loaded
      playingSlot = currentSlot
      activeVid = currentVid
    } else if (state.slotCachePaths[otherSlot] === activeFileUrl) {
      // Preloaded slot has this segment -> zero-delay swap!
      playingSlot = otherSlot
      activeVid = otherVid
      state.activeSlot = otherSlot
      onSlotChange?.(otherSlot)
      if (currentVid && !currentVid.paused) {
        currentVid.pause()
      }
      const offset = Math.max(0, atTime - activeCache.startTime)
      if (activeVid) {
        activeVid.currentTime = offset
      }
    } else {
      // Cache miss / seek: load active segment into current slot
      playingSlot = currentSlot
      activeVid = currentVid
      if (activeVid) {
        state.slotCachePaths[currentSlot] = activeFileUrl
        if (activeVid.src !== activeFileUrl && !activeVid.src.endsWith(activeFileUrl)) {
          activeVid.src = activeFileUrl
          activeVid.load()
        }
      }
      if (otherVid && !otherVid.paused) {
        otherVid.pause()
      }
    }

    if (activeVid) {
      applyPlaybackResolution(activeVid, playbackResolution)
      const offset = Math.max(0, atTime - activeCache.startTime)
      if (mode === 'playback') {
        if (Math.abs(activeVid.currentTime - offset) > 0.25) {
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
      state.hasActiveCache = false
      onActiveCacheChange?.(false)
    }
    if (cachedVideoA && !cachedVideoA.paused) {
      cachedVideoA.pause()
    }
    if (cachedVideoB && !cachedVideoB.paused) {
      cachedVideoB.pause()
    }
  }
}
