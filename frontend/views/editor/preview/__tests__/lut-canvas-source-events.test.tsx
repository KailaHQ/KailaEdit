// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LutCanvas } from '../LutCanvas'

/**
 * The canvas is the ONLY picture on screen for a clip whose background is removed — the
 * raw `<video>` underneath is hidden, or the removed background shows through the
 * cut-out. So a canvas that does not redraw is a black monitor.
 *
 * `draw` gives up when the source video has no frame yet (`readyState < 2`), and while
 * paused nothing calls it again: `renderNow()` fires once, from the frame-render path.
 * Opening a project and dragging the playhead both hit exactly that window, and the
 * preview stayed black until the user pressed play and the rAF loop took over.
 *
 * So the source video has to say when it has a frame. These are the events that say it.
 */

// No WebGL in happy-dom. `draw` bails immediately, which is fine — what is under test is
// whether the component subscribes to its source at all.
vi.mock('../MatteEngine', () => ({
  matteEngine: {
    getCachedResult: () => undefined,
    processFrame: () => Promise.resolve(null),
    getProvider: () => 'wasm',
  },
}))

/** A real `<video>` (so the `instanceof` check passes) with its subscriptions tracked. */
function fakeSourceVideo() {
  const el = document.createElement('video')
  const listeners = new Map<string, Set<EventListener>>()
  const add = el.addEventListener.bind(el)
  const remove = el.removeEventListener.bind(el)
  el.addEventListener = (type: string, fn: any, opts?: any) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(fn)
    add(type, fn, opts)
  }
  el.removeEventListener = (type: string, fn: any, opts?: any) => {
    listeners.get(type)?.delete(fn)
    remove(type, fn, opts)
  }
  return { listeners, el }
}

describe('LutCanvas source-video readiness', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (source: HTMLVideoElement) =>
    act(() => {
      root.render(
        <LutCanvas
          sourceElement={source}
          autoMatte={{ enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', featherEdge: 0, cleanEdge: 0 } as any}
          clipId="clip-1"
          isPlaying={false}
        />,
      )
    })

  it('subscribes to the events that mean "there is a frame now"', () => {
    const { el, listeners } = fakeSourceVideo()
    render(el)

    // loadeddata: the project was just opened and the pooled video was still at 0.
    expect(listeners.get('loadeddata')?.size).toBeGreaterThan(0)
    // seeked: the playhead was dragged and the video was still seeking.
    expect(listeners.get('seeked')?.size).toBeGreaterThan(0)
    expect(listeners.get('canplay')?.size).toBeGreaterThan(0)
  })

  it('lets go of them when the source changes, so nothing redraws for a dead clip', () => {
    const first = fakeSourceVideo()
    render(first.el)
    expect(first.listeners.get('seeked')?.size).toBeGreaterThan(0)

    const second = fakeSourceVideo()
    render(second.el)

    expect(first.listeners.get('seeked')?.size ?? 0).toBe(0)
    expect(second.listeners.get('seeked')?.size).toBeGreaterThan(0)
  })
})
