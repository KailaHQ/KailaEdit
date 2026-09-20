import { describe, it, expect, vi } from 'vitest'
import { FrameCache } from '../FrameCache'

function fakeVideoFrame(timestamp: number) {
  return {
    timestamp: timestamp * 1_000_000,
    close: vi.fn(),
    clone: vi.fn(function (this: any) {
      return { ...this, close: vi.fn() }
    }),
  } as unknown as VideoFrame
}

describe('FrameCache LRU', () => {
  it('stores and retrieves frames by timestamp', () => {
    const cache = new FrameCache(10)
    const frame1 = fakeVideoFrame(1.0)
    const frame2 = fakeVideoFrame(2.0)

    cache.set(1.0, frame1)
    cache.set(2.0, frame2)

    expect(cache.get(1.0)).toBe(frame1)
    expect(cache.get(2.0)).toBe(frame2)
    expect(cache.get(3.0)).toBeNull()
  })

  it('retrieves frames within tolerance', () => {
    const cache = new FrameCache(10)
    const frame = fakeVideoFrame(1.02)
    cache.set(1.02, frame)

    // With 0.03s tolerance, 1.00 should match 1.02
    expect(cache.get(1.00, 0.03)).toBe(frame)
    // With 0.01s tolerance, 1.00 should not match
    expect(cache.get(1.00, 0.01)).toBeNull()
  })

  it('evicts oldest frame and calls frame.close() when exceeding capacity', () => {
    const cache = new FrameCache(2)
    const frame1 = fakeVideoFrame(1.0)
    const frame2 = fakeVideoFrame(2.0)
    const frame3 = fakeVideoFrame(3.0)

    cache.set(1.0, frame1)
    cache.set(2.0, frame2)
    expect(cache.size).toBe(2)

    // Inserting 3rd frame should evict frame1
    cache.set(3.0, frame3)
    expect(cache.size).toBe(2)
    expect(cache.get(1.0)).toBeNull()
    expect(frame1.close).toHaveBeenCalled()
    expect(cache.get(2.0)).toBe(frame2)
    expect(cache.get(3.0)).toBe(frame3)
  })

  it('closes all frames on clear() and destroy()', () => {
    const cache = new FrameCache(5)
    const frame1 = fakeVideoFrame(1.0)
    const frame2 = fakeVideoFrame(2.0)

    cache.set(1.0, frame1)
    cache.set(2.0, frame2)

    cache.clear()
    expect(frame1.close).toHaveBeenCalled()
    expect(frame2.close).toHaveBeenCalled()
    expect(cache.size).toBe(0)
  })
})
