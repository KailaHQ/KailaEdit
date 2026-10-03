// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMonitorPlaybackLoop, type UseMonitorPlaybackLoopOptions } from '../useMonitorPlaybackLoop'

/**
 * While playing, the engine writes `currentTime` to the store every 250 ms. Each write used to
 * re-render the frame in 'scrub' mode, and a scrub render hard-seeks the playing video to the
 * playhead: a hitch four times a second, visible as a continuous flicker.
 */
describe('monitor playback loop while the transport time ticks', () => {
  let renderFrame: ReturnType<typeof vi.fn>
  let root: ReturnType<typeof createRoot>
  let host: HTMLElement

  const base = (): UseMonitorPlaybackLoopOptions => ({
    isPlaying: false,
    playbackTimeRef: { current: 0 },
    currentTime: 0,
    clips: [],
    subtitles: [],
    tracks: [],
    isPreviewingVideo: false,
    playbackResolution: 1,
    videoPoolRef: { current: new Map() },
    cachedVideoRefA: { current: null },
    cachedVideoRefB: { current: null },
    lastFrameRequestRef: { current: null },
    lutCanvasRef: { current: null },
    destroyPoolVideo: vi.fn(),
    renderFrame: renderFrame as unknown as UseMonitorPlaybackLoopOptions['renderFrame'],
    applyFrameVisuals: vi.fn(),
    containerRef: { current: null },
    setIsFullscreen: vi.fn(),
    selectedClip: null,
    cropMode: false,
    eyedropperMode: false,
    toggleCropMode: vi.fn(),
    setCropMode: vi.fn(),
    setEyedropperMode: vi.fn(),
    setPreviewAssetId: vi.fn(),
  })

  function Harness(props: UseMonitorPlaybackLoopOptions) {
    useMonitorPlaybackLoop(props)
    return null
  }

  const render = (options: Partial<UseMonitorPlaybackLoopOptions>) =>
    act(() => root.render(React.createElement(Harness, { ...base(), ...options })))

  const scrubCalls = () => renderFrame.mock.calls.filter(([, mode]) => mode === 'scrub').length

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    renderFrame = vi.fn()
    host = document.createElement('div')
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('does not re-render in scrub mode when the stored time ticks during playback', () => {
    render({ isPlaying: true, currentTime: 0 })
    const afterStart = scrubCalls()

    for (const time of [0.25, 0.5, 0.75, 1]) render({ isPlaying: true, currentTime: time })

    expect(scrubCalls()).toBe(afterStart)
  })

  it('still re-renders the frame when the playhead moves while paused', () => {
    render({ isPlaying: false, currentTime: 0 })
    const before = scrubCalls()
    render({ isPlaying: false, currentTime: 2 })
    expect(scrubCalls()).toBeGreaterThan(before)
    expect(renderFrame).toHaveBeenLastCalledWith(2, 'scrub')
  })

  it('shows the frame at the playhead once playback stops', () => {
    render({ isPlaying: true, currentTime: 1 })
    const whilePlaying = scrubCalls()
    render({ isPlaying: false, currentTime: 1.25 })
    expect(scrubCalls()).toBeGreaterThan(whilePlaying)
    expect(renderFrame).toHaveBeenLastCalledWith(1.25, 'scrub')
  })
})
