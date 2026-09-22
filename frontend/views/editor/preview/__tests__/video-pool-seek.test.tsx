// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import { useVideoPoolManager, type UseVideoPoolManagerResult } from '../useVideoPoolManager'
import type { TimelineClip } from '../../../../types/project-model'

describe('paused playhead source seeks', () => {
  it('retains one-frame seeks and pauses before returning from a pending seek', () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    const root = createRoot(host)
    let manager!: UseVideoPoolManagerResult
    function Harness() {
      manager = useVideoPoolManager({} as any, () => '', () => null, { current: 0 }, 1)
      return null
    }
    act(() => root.render(<Harness />))
    const video = document.createElement('video')
    Object.defineProperty(video, 'duration', { value: 10 })
    Object.defineProperty(video, 'paused', { value: false })
    Object.defineProperty(video, 'seeking', { value: true, configurable: true })
    video.pause = vi.fn()
    video.currentTime = 1
    const clip = { startTime: 0, trimStart: 0, duration: 10, speed: 1 } as TimelineClip
    manager.syncVideoElement(video, clip, 1 + 1 / 30, { paused: true })
    expect(video.pause).toHaveBeenCalled()
    Object.defineProperty(video, 'seeking', { value: false })
    video.dispatchEvent(new Event('seeked'))
    expect(video.currentTime).toBeCloseTo(1 + 1 / 30)
    video.dataset.matteScrubOwned = 'true'
    const matted = { ...clip, autoMatte: { enabled: true, bake: { path: '/matte.mp4' } } } as TimelineClip
    manager.syncVideoElement(video, matted, 5, { paused: true })
    expect(video.currentTime).toBeCloseTo(1 + 1 / 30)
    // Resume must catch up even below the normal 400 ms playback tolerance.
    manager.syncVideoElement(video, matted, 1.2, { paused: false })
    expect(video.currentTime).toBeCloseTo(1.2)
    video.dataset.matteScrubOwned = 'true'
    manager.syncVideoElement(video, clip, 2, { paused: true })
    expect(video.currentTime).toBe(2)
    act(() => root.unmount())
  })
})
