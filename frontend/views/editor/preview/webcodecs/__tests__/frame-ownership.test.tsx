// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWebCodecsPreview } from '../useWebCodecsPreview'
import type { TimelineClip } from '@/types/project-model'

/**
 * Who closes a VideoFrame.
 *
 * `FrameCache.set` says it outright — "caller passes ownership" — and the cache closes
 * each frame when it evicts or replaces it. `WebCodecsPlayer.seek` hands back a frame
 * that is sitting in that cache, so a consumer that closes what it was handed detaches a
 * frame the cache still holds. The next cache hit then returns a closed frame, whose
 * `format` is null, and both consumers correctly skip it — so the failure does not look
 * like a crash. It looks like the WebCodecs path quietly dying: every seek falls through
 * to the pooled <video>, and wherever that is not ready either, the canvas draws nothing
 * and the monitor is black.
 *
 * A VideoFrame is a GPU handle with a hard outstanding-frame limit, so "just close it
 * defensively" is not a safe default here — it has to be owned in exactly one place.
 */

const closeSpy = vi.fn()
const frames: Array<{ timestamp: number; format: string | null; close: () => void }> = []

vi.mock('../WebCodecsPlayer', () => ({
  WebCodecsPlayer: class MockWebCodecsPlayer {
    load = vi.fn().mockResolvedValue(true)
    // A new frame each seek, as a real cache miss would produce.
    seek = vi.fn().mockImplementation(async (t: number) => {
      const frame = { timestamp: t * 1_000_000, format: 'I420', close: closeSpy, clone: () => ({ timestamp: t * 1_000_000, format: 'I420', close: vi.fn() }) }
      frames.push(frame)
      return frame as unknown as VideoFrame
    })
    getMetadata = vi.fn().mockReturnValue({ duration: 10 })
    destroy = vi.fn()
  },
}))

const clip = {
  id: 'clip-1',
  startTime: 0,
  duration: 10,
  trimStart: 0,
  trimEnd: 0,
  trackIndex: 0,
  speed: 1,
  asset: { id: 'asset-1', type: 'video', path: '/test.mp4', duration: 10 },
} as unknown as TimelineClip

describe('useWebCodecsPreview frame ownership', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    ;(globalThis as any).VideoDecoder = class MockVideoDecoder {}
    closeSpy.mockClear()
    frames.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('never closes a frame the player cache still owns', async () => {
    function TestComponent({ time }: { time: number }) {
      useWebCodecsPreview({
        activeClip: clip,
        currentTime: time,
        isPlaying: false,
        resolveClipPath: (c: TimelineClip) => c.asset?.path || '',
        enabled: true,
      })
      return null
    }

    // Scrub across several positions — every one of these is a fresh frame from the
    // player, and the previous one stays in its cache.
    for (const time of [1, 2, 3, 4]) {
      await act(async () => {
        root.render(<TestComponent time={time} />)
        await Promise.resolve()
      })
    }

    expect(frames.length).toBeGreaterThan(1)
    expect(closeSpy).not.toHaveBeenCalled()
  })
})
