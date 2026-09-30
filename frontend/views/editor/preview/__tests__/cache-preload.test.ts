import { describe, it, expect, vi } from 'vitest'
import { MAX_HOLD_MS, syncCachePlayback, type CacheSlotState } from '../cache-video-manager'
import type { CachedSegmentInfo } from '../../render-cache-store'

describe('syncCachePlayback - Double-buffered cache preload (KE-1505)', () => {
  function createMockVideoElement(): HTMLVideoElement {
    const el = {
      src: '',
      currentTime: 0,
      paused: true,
      readyState: 4,
      seeking: false,
      play: vi.fn(),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      style: {},
    }
    el.play = vi.fn(async () => {
      ;(el as any).paused = false
    })
    el.pause = vi.fn(() => {
      ;(el as any).paused = true
    })
    return el as unknown as HTMLVideoElement
  }

  function setupTest() {
    const videoA = createMockVideoElement()
    const videoB = createMockVideoElement()

    const segments: CachedSegmentInfo[] = [
      {
        id: 'seg-1',
        startTime: 0,
        endTime: 30,
        duration: 30,
        hash: 'hash-1',
        ready: true,
        rendering: false,
        reasons: ['complex'],
        cachePath: 'C:\\cache\\seg-1.mp4',
      },
      {
        id: 'seg-2',
        startTime: 30,
        endTime: 60,
        duration: 30,
        hash: 'hash-2',
        ready: true,
        rendering: false,
        reasons: ['complex'],
        cachePath: 'C:\\cache\\seg-2.mp4',
      },
      {
        id: 'seg-3',
        startTime: 60,
        endTime: 90,
        duration: 30,
        hash: 'hash-3',
        ready: true,
        rendering: false,
        reasons: ['complex'],
        cachePath: 'C:\\cache\\seg-3.mp4',
      },
    ]

    const state: CacheSlotState = {
      activeSlot: 0,
      hasActiveCache: false,
      slotCachePaths: { 0: null, 1: null },
    }

    const onSlotChange = vi.fn((slot: 0 | 1) => {
      state.activeSlot = slot
    })

    const onActiveCacheChange = vi.fn((hasActive: boolean) => {
      state.hasActiveCache = hasActive
    })

    return {
      videoA,
      videoB,
      segments,
      state,
      onSlotChange,
      onActiveCacheChange,
    }
  }

  it('plays segment 1 in slot 0 on initial playback', () => {
    const env = setupTest()

    syncCachePlayback(
      5,
      'playback',
      env.segments,
      env.videoA,
      env.videoB,
      env.state,
      0.5,
      env.onSlotChange,
      env.onActiveCacheChange,
    )

    expect(env.state.hasActiveCache).toBe(true)
    expect(env.onActiveCacheChange).toHaveBeenCalledWith(true)
    expect(env.state.activeSlot).toBe(0)
    expect(env.videoA.src).toContain('seg-1.mp4')
    expect(env.videoA.play).toHaveBeenCalled()
    expect(env.videoB.src).toBe('') // Slot 1 not yet touched
  })

  it('preloads segment 2 in slot 1 when within 2 seconds of boundary', () => {
    const env = setupTest()

    // Play at 20s (not near boundary)
    syncCachePlayback(20, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.videoB.src).toBe('')

    // Advance to 28.5s (within PRELOAD_THRESHOLD_SECONDS of 30s boundary)
    syncCachePlayback(28.5, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)

    // Slot 1 should have preloaded segment 2!
    expect(env.videoB.src).toContain('seg-2.mp4')
    expect(env.videoB.load).toHaveBeenCalled()
    expect(env.videoB.currentTime).toBe(0)
    expect(env.videoB.paused).toBe(true) // Paused while preloading
    expect(env.state.activeSlot).toBe(0) // Slot 0 is still the active visible slot
  })

  it('swaps active slot to slot 1 seamlessly when crossing boundary', () => {
    const env = setupTest()

    // Play at 29s -> preloads segment 2 into slot 1
    syncCachePlayback(29, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.videoB.src).toContain('seg-2.mp4')
    expect(env.state.activeSlot).toBe(0)

    // Advance across boundary to 30.1s
    syncCachePlayback(30.1, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)

    // Active slot should have swapped to slot 1!
    expect(env.state.activeSlot).toBe(1)
    expect(env.onSlotChange).toHaveBeenCalledWith(1)
    // Slot 1 should now be playing segment 2
    expect(env.videoB.play).toHaveBeenCalled()
    expect(env.videoB.currentTime).toBeCloseTo(0.1, 1)
    // Slot 0 should be paused
    expect(env.videoA.pause).toHaveBeenCalled()
  })

  it('ping-pongs and preloads segment 3 into slot 0 near the 60s boundary', () => {
    const env = setupTest()

    // 1. Play at 29s -> slot 1 preloads segment 2
    syncCachePlayback(29, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    // 2. Cross to 30.1s -> slot 1 active
    syncCachePlayback(30.1, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.activeSlot).toBe(1)

    // 3. Advance to 58.5s (near 60s boundary)
    syncCachePlayback(58.5, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)

    // Slot 0 should now preload segment 3!
    expect(env.videoA.src).toContain('seg-3.mp4')
    expect(env.videoA.currentTime).toBe(0)
    expect(env.state.activeSlot).toBe(1) // Slot 1 still active

    // 4. Cross into segment 3 at 60.1s
    syncCachePlayback(60.1, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)

    // Swapped back to Slot 0!
    expect(env.state.activeSlot).toBe(0)
    expect(env.onSlotChange).toHaveBeenCalledWith(0)
    expect(env.videoA.play).toHaveBeenCalled()
    expect(env.videoB.pause).toHaveBeenCalled()
  })

  it('handles scrub jumping across boundary without playing wrong segment', () => {
    const env = setupTest()

    // Scrub at 10s (segment 1)
    syncCachePlayback(10, 'scrub', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.activeSlot).toBe(0)
    expect(env.videoA.currentTime).toBe(10)

    // Jump scrub to 45s (middle of segment 2)
    syncCachePlayback(45, 'scrub', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    // Loads segment 2 at 15s offset
    expect(env.videoA.src).toContain('seg-2.mp4')
    expect(env.videoA.currentTime).toBe(15)
    expect(env.videoA.paused).toBe(true)
  })

  it('pauses both slots and hides cache when moving outside cached segments', () => {
    const env = setupTest()

    syncCachePlayback(20, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.hasActiveCache).toBe(true)
    ;(env.videoB as any).paused = false // simulate other slot was also running

    // Jump to 150s (not covered by any cached segment)
    syncCachePlayback(150, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.hasActiveCache).toBe(false)
    expect(env.onActiveCacheChange).toHaveBeenCalledWith(false)
    expect(env.videoA.pause).toHaveBeenCalled()
    expect(env.videoB.pause).toHaveBeenCalled()
  })

  it('keeps the live picture on screen until the segment has a picture to show', () => {
    const env = setupTest()
    ;(env.videoA as any).readyState = 0 // still loading

    syncCachePlayback(5, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    // Loading has begun, but the layer over the live picture is not raised: it would be black.
    expect(env.videoA.load).toHaveBeenCalled()
    expect(env.state.hasActiveCache).toBe(false)
    expect(env.onActiveCacheChange).not.toHaveBeenCalled()

    ;(env.videoA as any).readyState = 4
    syncCachePlayback(5.02, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.hasActiveCache).toBe(true)
  })

  it('does not swap to a preloaded slot until it has a picture, and leaves the old one showing', () => {
    const env = setupTest()
    syncCachePlayback(29, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    ;(env.videoB as any).readyState = 1

    syncCachePlayback(30.05, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.activeSlot).toBe(0)

    ;(env.videoB as any).readyState = 4
    syncCachePlayback(30.1, 'playback', env.segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.activeSlot).toBe(1)
  })

  it('loads a segment that starts soon while ordinary playback is still going on before it', () => {
    const env = setupTest()
    // A stretch with no cache, then one that starts at 100s.
    const segments: CachedSegmentInfo[] = [{
      id: 'seg-far', startTime: 100, endTime: 104, duration: 4, hash: 'h', ready: true, rendering: false,
      reasons: ['transition'], cachePath: 'C:\cache\seg-far.mp4',
    }]
    syncCachePlayback(90, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.videoA.src).toBe('')

    syncCachePlayback(98.5, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.videoA.src).toContain('seg-far.mp4')
    expect(env.videoA.paused).toBe(true)
    expect(env.state.hasActiveCache).toBe(false)

    // Reaching it finds it ready and shows it at once.
    syncCachePlayback(100.02, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.hasActiveCache).toBe(true)
    expect(env.videoA.play).toHaveBeenCalled()
  })

  it('keeps the last frame of a segment up until the live picture is ready, then lets go', () => {
    const env = setupTest()
    const segments = [env.segments[0]] // 0..30, nothing after
    syncCachePlayback(20, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    expect(env.state.hasActiveCache).toBe(true)
    env.onActiveCacheChange.mockClear()

    let ready = false
    let t = 1000
    const call = (at: number) => syncCachePlayback(at, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange, () => ready, () => t)

    call(30.02)
    expect(env.state.hasActiveCache).toBe(true) // still covering the live layers
    expect(env.state.holding).toBe(true)
    expect(env.onActiveCacheChange).not.toHaveBeenCalled()

    ready = true
    t += 50
    call(30.06)
    expect(env.state.hasActiveCache).toBe(false)
    expect(env.state.holding).toBe(false)
    expect(env.onActiveCacheChange).toHaveBeenCalledWith(false)
  })

  it('does not hold on forever for a live picture that never gets ready', () => {
    const env = setupTest()
    const segments = [env.segments[0]]
    syncCachePlayback(20, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange)
    let t = 1000
    const call = (at: number) => syncCachePlayback(at, 'playback', segments, env.videoA, env.videoB, env.state, 0.5, env.onSlotChange, env.onActiveCacheChange, () => false, () => t)
    call(30.02)
    expect(env.state.holding).toBe(true)
    t += MAX_HOLD_MS + 10
    call(30.5)
    expect(env.state.hasActiveCache).toBe(false)
  })
})
