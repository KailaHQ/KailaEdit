// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import { useTimelineResize } from '../useTimelineResize'
import type { TimelineClip, Track, Asset } from '../../../../types/project-model'

describe('useTimelineResize on Layer 1 (magnetic main video track)', () => {
  const tracks: Track[] = [
    { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
  ]
  const asset1 = {
    id: 'asset-1',
    type: 'video',
    duration: 30, // 30s source media
    path: '/path/to/IMG_4692.MOV',
    prompt: '',
    resolution: '1920x1080',
    createdAt: Date.now(),
  } as Asset

  const createClip = (overrides: Partial<TimelineClip>): TimelineClip => ({
    id: 'c1',
    trackIndex: 0,
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    assetId: 'asset-1',
    type: 'video',
    reversed: false,
    muted: false,
    volume: 1,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: null as any,
    transitionOut: null as any,
    colorCorrection: null as any,
    transform: null as any,
    opacity: 1,
    ...overrides,
  } as TimelineClip)

  function setupTest(initialClips: TimelineClip[]) {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    const root = createRoot(host)

    let resizeHook!: ReturnType<typeof useTimelineResize>
    let currentClips = initialClips
    const setClips = vi.fn((updater: any) => {
      currentClips = typeof updater === 'function' ? updater(currentClips) : updater
    })
    const setCurrentTime = vi.fn()

    function Harness() {
      resizeHook = useTimelineResize({
        clips: currentClips,
        setClips,
        tracks,
        pixelsPerSecond: 100, // 100px = 1s
        snapEnabled: false,
        getCurrentTime: () => 0,
        getMaxClipDuration: () => 30,
        assets: [asset1],
        activeTool: 'select',
        setSelectedClipIds: vi.fn(),
        expandWithLinkedClips: (ids) => ids,
        activeTimeline: { transitions: [] },
        setCurrentTime,
      })
      return null
    }

    act(() => root.render(<Harness />))

    return {
      getHook: () => resizeHook,
      getClips: () => currentClips,
      setClips,
      setCurrentTime,
    }
  }

  it('pushes right edge left: cuts video from right and ripples downstream clips left in real time', () => {
    const clip1 = createClip({ id: 'c1', startTime: 0, duration: 10, trimStart: 0, trimEnd: 20 })
    const clip2 = createClip({ id: 'c2', startTime: 10, duration: 5, trimStart: 0, trimEnd: 25 })

    const { getHook, getClips } = setupTest([clip1, clip2])

    // Start resizing right edge of c1 at x=1000 (10s)
    act(() => {
      getHook().handleResizeStart({ stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 1000 } as any, clip1, 'right')
    })

    // Drag left by 200px (2s cut off tail: duration 10s -> 8s)
    act(() => {
      getHook().handleResizeMove({ clientX: 800 } as any)
    })

    const clipsAfterMove = getClips()
    const updatedC1 = clipsAfterMove.find(c => c.id === 'c1')!
    const updatedC2 = clipsAfterMove.find(c => c.id === 'c2')!

    expect(updatedC1.duration).toBe(8)
    // Clip 2 must ripple left by 2s in real-time
    expect(updatedC2.startTime).toBe(8)
  })

  it('pulls right edge right: restores cut video at tail up to source media end', () => {
    // c1 is 10s long, but source is 30s. trimStart = 0, so max possible duration is 30s.
    const clip1 = createClip({ id: 'c1', startTime: 0, duration: 10, trimStart: 0, trimEnd: 20 })
    const clip2 = createClip({ id: 'c2', startTime: 10, duration: 5, trimStart: 0, trimEnd: 25 })

    const { getHook, getClips } = setupTest([clip1, clip2])

    act(() => {
      getHook().handleResizeStart({ stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 1000 } as any, clip1, 'right')
    })

    // Drag right by 500px (5s restored at tail: duration 10s -> 15s)
    act(() => {
      getHook().handleResizeMove({ clientX: 1500 } as any)
    })

    const clipsAfterMove = getClips()
    const updatedC1 = clipsAfterMove.find(c => c.id === 'c1')!
    const updatedC2 = clipsAfterMove.find(c => c.id === 'c2')!

    expect(updatedC1.duration).toBe(15)
    // Clip 2 ripples right by 5s to make room
    expect(updatedC2.startTime).toBe(15)

    // Drag way beyond source end (e.g. +3000px, 30s extra): must clamp to source media end (30s)
    act(() => {
      getHook().handleResizeMove({ clientX: 4500 } as any)
    })
    const clampedC1 = getClips().find(c => c.id === 'c1')!
    expect(clampedC1.duration).toBe(30)
  })

  it('pushes left edge right: cuts video from start (increases trimStart, decreases duration)', () => {
    const clip1 = createClip({ id: 'c1', startTime: 0, duration: 10, trimStart: 0, trimEnd: 20 })

    const { getHook, getClips } = setupTest([clip1])

    act(() => {
      getHook().handleResizeStart({ stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 0 } as any, clip1, 'left')
    })

    // Push right by 300px (3s cut off head: trimStart -> 3s, duration -> 7s)
    act(() => {
      getHook().handleResizeMove({ clientX: 300 } as any)
    })

    const updatedC1 = getClips().find(c => c.id === 'c1')!
    expect(updatedC1.trimStart).toBe(3)
    expect(updatedC1.duration).toBe(7)
  })

  it('pulls left edge left: restores cut video from start until trimStart reaches 0', () => {
    // c1 was previously cut with trimStart = 5s
    const clip1 = createClip({ id: 'c1', startTime: 0, duration: 10, trimStart: 5, trimEnd: 15 })

    const { getHook, getClips } = setupTest([clip1])

    act(() => {
      getHook().handleResizeStart({ stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 0 } as any, clip1, 'left')
    })

    // Pull left by 300px (-3s): restores 3s from the head (trimStart 5s -> 2s, duration 10s -> 13s)
    act(() => {
      getHook().handleResizeMove({ clientX: -300 } as any)
    })

    const updatedC1 = getClips().find(c => c.id === 'c1')!
    expect(updatedC1.trimStart).toBe(2)
    expect(updatedC1.duration).toBe(13)

    // Pull left beyond start (e.g. -800px, -8s): must stop at trimStart = 0
    act(() => {
      getHook().handleResizeMove({ clientX: -800 } as any)
    })

    const clampedC1 = getClips().find(c => c.id === 'c1')!
    expect(clampedC1.trimStart).toBe(0)
    expect(clampedC1.duration).toBe(15) // Restored full 5s
  })

  it('finalizes resize: packs Track 1 seamlessly from 0s maintaining clip sequence', () => {
    const clip1 = createClip({ id: 'c1', startTime: 0, duration: 10, trimStart: 5, trimEnd: 15 })
    const clip2 = createClip({ id: 'c2', startTime: 10, duration: 5, trimStart: 0, trimEnd: 25 })

    const { getHook, getClips } = setupTest([clip1, clip2])

    // Pull left edge of c1 left by 200px (restores 2s, duration becomes 12s)
    act(() => {
      getHook().handleResizeStart({ stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 0 } as any, clip1, 'left')
    })
    act(() => {
      getHook().handleResizeMove({ clientX: -200 } as any)
    })
    act(() => {
      getHook().finalizeResize()
    })

    const finalClips = getClips()
    const finalC1 = finalClips.find(c => c.id === 'c1')!
    const finalC2 = finalClips.find(c => c.id === 'c2')!

    expect(finalC1.startTime).toBe(0)
    expect(finalC1.duration).toBe(12)
    expect(finalC1.trimStart).toBe(3)
    expect(finalC2.startTime).toBe(12)
    expect(finalC2.duration).toBe(5)
  })
})
