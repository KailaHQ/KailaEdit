// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstFramePoster } from '../first-frame-poster'
import type { FirstFrameSource } from '../webcodecs/FirstFrameSource'
import type { TimelineClip } from '../../../../types/project-model'

const clip = { id: 'c1', startTime: 0, trimStart: 0.62, trimEnd: 0, speed: 1, duration: 5, reversed: false } as unknown as TimelineClip

function fakeFrame(w = 1080, h = 1920) {
  return { displayWidth: w, displayHeight: h, close: vi.fn() } as unknown as VideoFrame & { close: ReturnType<typeof vi.fn> }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('first frame poster', () => {
  let drawImage: ReturnType<typeof vi.fn>
  let container: HTMLElement

  beforeEach(() => {
    drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    container = document.createElement('div')
  })

  function sourceOf(frames: Array<VideoFrame | null>, duration = 7.27) {
    const frameAt = vi.fn(async () => frames.shift() ?? null)
    const source = { open: vi.fn(async () => ({ duration })), frameAt } as unknown as FirstFrameSource
    return { source, frameAt }
  }

  it('asks for the frame the playhead is on, not frame 0 of the file', async () => {
    const frame = fakeFrame()
    const { source, frameAt } = sourceOf([frame])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    expect(frameAt).toHaveBeenCalledWith(0.62)
  })

  it('draws the frame into a canvas inside the container and releases the frame', async () => {
    const frame = fakeFrame()
    const { source } = sourceOf([frame])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()

    const canvas = container.querySelector('canvas')!
    expect(canvas).toBeTruthy()
    expect(canvas.style.display).toBe('')
    expect(canvas.style.objectFit).toBe('contain')
    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(1920)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect((frame as any).close).toHaveBeenCalledTimes(1)
  })

  it('caps the canvas size on its longest side', async () => {
    const { source } = sourceOf([fakeFrame(3840, 2160)])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(1920)
    expect(canvas.height).toBe(1080)
  })

  it('does nothing for a frame it is already showing or fetching', async () => {
    const { source, frameAt } = sourceOf([fakeFrame(), fakeFrame()])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    expect(frameAt).toHaveBeenCalledTimes(1)
  })

  it('does not draw a frame that arrives after it was hidden, and still releases it', async () => {
    const pending = deferred<VideoFrame | null>()
    const frame = fakeFrame()
    const source = { open: async () => ({ duration: 7 }), frameAt: () => pending.promise } as unknown as FirstFrameSource
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    poster.hide()
    pending.resolve(frame)
    await flush()
    expect(container.querySelector('canvas')).toBeNull()
    expect(drawImage).not.toHaveBeenCalled()
    expect((frame as any).close).toHaveBeenCalledTimes(1)
  })

  it('hides the canvas, and shows the next frame asked for', async () => {
    const { source } = sourceOf([fakeFrame(), fakeFrame()])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    const canvas = container.querySelector('canvas')!
    poster.hide()
    expect(canvas.style.display).toBe('none')

    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(canvas.style.display).toBe('')
  })

  it('shows nothing, quietly, when the file cannot be decoded', async () => {
    const source = { open: async () => { throw new Error('no moov') }, frameAt: vi.fn() } as unknown as FirstFrameSource
    const poster = new FirstFramePoster(() => source)
    expect(() => poster.show(container, { path: '/b.avi', clip, atTime: 0 })).not.toThrow()
    await flush()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('shows nothing when no frame comes back', async () => {
    const { source } = sourceOf([null])
    const poster = new FirstFramePoster(() => source)
    poster.show(container, { path: '/a.mp4', clip, atTime: 0 })
    await flush()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('hiding an idle poster costs nothing', () => {
    const poster = new FirstFramePoster(() => ({}) as FirstFrameSource)
    expect(() => { poster.hide(); poster.hide() }).not.toThrow()
  })
})
