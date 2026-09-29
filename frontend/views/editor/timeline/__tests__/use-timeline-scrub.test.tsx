// @vitest-environment happy-dom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { SnapTarget } from '@core/timeline-snap'
import { useTimelineScrub } from '../useTimelineScrub'

it('moves the playhead on the pointer event itself, snapped, and commits the time once a frame', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const runFrames = () => { for (const cb of frames.splice(0)) cb(0) }

  const container = document.createElement('div')
  container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 100, width: 1000, height: 100 } as DOMRect)
  const committed: number[] = []
  const previewed: number[] = []
  const guides: Array<number | null> = []
  const targets: SnapTarget[] = [{ time: 3.3, type: 'clip-start', trackIndex: 1 }]
  let handlers: ReturnType<typeof useTimelineScrub> | null = null

  function Probe() {
    const trackContainerRef = useRef<HTMLDivElement>(container)
    const timelineRef = useRef<HTMLDivElement>(null)
    handlers = useTimelineScrub({
      trackContainerRef, timelineRef, pixelsPerSecond: 100, totalDuration: 20,
      setCurrentTime: t => committed.push(t),
      setIsPlaying: () => {},
      getSnapTargets: () => targets,
      onScrubPreview: t => previewed.push(t),
      onSnapGuideChange: t => guides.push(t),
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => { root.render(<Probe />) })
  try {
    handlers!.handleRulerMouseDown({ button: 0, clientX: 100, shiftKey: false, preventDefault() {} } as any)
    expect(committed).toEqual([1])
    runFrames()

    const move = (clientX: number, shiftKey = false) =>
      window.dispatchEvent(new MouseEvent('mousemove', { clientX, shiftKey }))
    // Two events within one frame: the line follows both at once...
    move(200)
    move(326)
    expect(previewed).toEqual([2, 3.3]) // 3.26 caught on the edge at 3.3
    // ...and the store (which seeks the preview) hears only the latest, on the frame.
    expect(committed).toEqual([1])
    runFrames()
    expect(committed).toEqual([1, 3.3])
    expect(guides.at(-1)).toBe(3.3)

    // Shift scrubs freely past the edge.
    move(326, true)
    expect(previewed.at(-1)).toBeCloseTo(3.26)
    expect(guides.at(-1)).toBeNull()

    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(guides.at(-1)).toBeNull()
  } finally {
    await act(async () => { root.unmount() })
    vi.unstubAllGlobals()
  }
})
