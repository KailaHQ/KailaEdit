// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client'
import React, { act } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWebCodecsPreview } from '../useWebCodecsPreview'
import type { TimelineClip } from '@/types/project-model'

vi.mock('../WebCodecsPlayer', () => {
  return {
    WebCodecsPlayer: class MockWebCodecsPlayer {
      load = vi.fn().mockResolvedValue(true)
      seek = vi.fn().mockResolvedValue({
        timestamp: 1000000,
        close: vi.fn(),
      } as unknown as VideoFrame)
      destroy = vi.fn()
    },
  }
})

describe('useWebCodecsPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    ;(globalThis as any).VideoDecoder = class MockVideoDecoder {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('initializes and reports supported status', () => {
    const clip: TimelineClip = {
      id: 'clip-1',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      trackIndex: 0,
      asset: { id: 'asset-1', type: 'video', path: '/test.mp4', duration: 5 },
    } as any

    let hookResult: any

    function TestComponent() {
      hookResult = useWebCodecsPreview({
        activeClip: clip,
        currentTime: 1.0,
        isPlaying: false,
        resolveClipPath: (c) => c.asset?.path || '',
        enabled: true,
      })
      return null
    }

    act(() => {
      root.render(React.createElement(TestComponent))
    })

    expect(hookResult.isSupported).toBe(true)
  })
})
