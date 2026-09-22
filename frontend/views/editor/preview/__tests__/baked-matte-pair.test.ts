// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BakedMattePair } from '../BakedMattePair'

const mock = vi.hoisted(() => ({ seek: vi.fn(), load: vi.fn(), destroy: vi.fn() }))
vi.mock('../webcodecs/WebCodecsPlayer', () => ({ WebCodecsPlayer: class {
  load = mock.load
  seek = mock.seek
  destroy = mock.destroy
} }))

class Frame {
  format: string | null = 'I420'
  constructor(public timestamp: number) {}
  clone() { return new Frame(this.timestamp) }
  close() { this.format = null }
}
const frame = (seconds: number) => new Frame(seconds * 1e6) as unknown as VideoFrame
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('baked matte snapshot pairing', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoFrame', Frame)
    mock.seek.mockReset()
    mock.load.mockResolvedValue(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('requests the paused quality path even when play stops on the same frame', async () => {
    mock.seek.mockImplementation(async (time: number) => frame(time))
    const pairs = new BakedMattePair('matte.mp4', vi.fn())
    await flush()
    pairs.request(frame(1), 1, 1, true)
    await flush()
    pairs.request(frame(1), 1, 1, false)
    await flush()
    expect(mock.seek).toHaveBeenCalledTimes(2)
    expect(pairs.getCurrentPair()?.sourceTime).toBe(1)
    pairs.destroy()
  })

  it('keeps the source that requested alpha, even if playback has moved on', async () => {
    let finish!: (f: VideoFrame) => void
    mock.seek.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockImplementation(() => new Promise(() => {}))
    const pairs = new BakedMattePair('matte.mp4', vi.fn())
    await flush()
    pairs.request(frame(1), 1, 0.5, true)
    pairs.request(frame(2), 2, 1, true)
    finish(frame(0.5))
    await flush()
    const pair = pairs.request(frame(2), 2, 1, true)
    expect(pair?.source.timestamp).toBe(1e6)
    expect(pair?.alpha.timestamp).toBe(0.5e6)
    pairs.destroy()
    expect(pair?.source.format).toBeNull()
    expect(pair?.alpha.format).toBeNull()
  })

  it('coalesces paused seeks and discards old results, including after dispose', async () => {
    const finish: Array<(f: VideoFrame) => void> = []
    mock.seek.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
    const redraw = vi.fn()
    const pairs = new BakedMattePair('matte.mp4', redraw)
    await flush()
    pairs.request(frame(1), 1, 1, false)
    pairs.request(frame(2), 2, 2, false)
    pairs.request(frame(3), 3, 3, false)
    finish[0](frame(1))
    await flush()
    expect(mock.seek.mock.calls.map(call => call[0])).toEqual([1, 3])
    expect(pairs.request(frame(3), 3, 3, false)).toBeNull()
    pairs.destroy()
    redraw.mockClear()
    finish[1](frame(3))
    await flush()
    expect(redraw).not.toHaveBeenCalled()
  })

  it('rejects a pre-seek completion even when the old request was playing', async () => {
    const finish: Array<(f: VideoFrame) => void> = []
    mock.seek.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
    const pairs = new BakedMattePair('matte.mp4', vi.fn())
    await flush()
    pairs.request(frame(4), 4, 4, true)
    pairs.invalidate()
    pairs.request(frame(1), 1, 1, true)
    finish[0](frame(4))
    await flush()
    expect(pairs.getCurrentPair()).toBeNull()
    finish[1](frame(1))
    await flush()
    expect(pairs.getCurrentPair()?.source.timestamp).toBe(1e6)
    pairs.destroy()
  })

  it('presents completed scrub pairs while newer pointer targets are queued, then settles on the latest', async () => {
    const finish: Array<(f: VideoFrame) => void> = []
    mock.seek.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
    const pairs = new BakedMattePair('matte.mp4', vi.fn())
    await flush()
    pairs.request(frame(1), 1, 1, false, undefined, true)
    pairs.request(frame(2), 2, 2, false, undefined, true)
    pairs.request(frame(3), 3, 3, false, undefined, true)
    finish[0](frame(1))
    await flush()
    expect(pairs.getCurrentPair()?.source.timestamp).toBe(1e6)
    expect(mock.seek.mock.calls.map(call => call[0])).toEqual([1, 3])
    finish[1](frame(3))
    await flush()
    expect(pairs.getCurrentPair()?.source.timestamp).toBe(3e6)
    expect(pairs.getCurrentPair()?.alpha.timestamp).toBe(3e6)
    pairs.destroy()
  })
})
