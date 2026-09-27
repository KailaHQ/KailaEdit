// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import { TimelineKeyframeRow } from '../TimelineKeyframeRow'
import type { TimelineClip } from '../../../../types/project-model'

vi.mock('../../editor-store', () => ({
  useEditorStore: vi.fn(() => null),
  useEditorActions: vi.fn(() => ({
    moveKeyframeGroup: vi.fn(),
    setKeyframeEasing: vi.fn(),
    removeKeyframeAt: vi.fn(),
    setCurrentTime: vi.fn(),
    setSelectedKeyframe: vi.fn(),
    clearSelectedKeyframe: vi.fn(),
  })),
}))

vi.mock('../../editor-selectors', () => ({
  selectSelectedKeyframe: vi.fn(() => null),
}))

describe('TimelineKeyframeRow coordinate positioning and edge clamping', () => {
  const baseClip: TimelineClip = {
    id: 'clip-1',
    trackIndex: 1,
    startTime: 28,
    duration: 4,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    type: 'video',
    reversed: false,
    muted: false,
    volume: 1,
    keyframes: [
      {
        property: 'transform.scale',
        points: [
          { t: 0, value: 100, easing: 'linear' },
          { t: 1.25, value: 120, easing: 'linear' },
          { t: 4, value: 100, easing: 'linear' },
        ],
      },
    ],
  } as any

  it('correctly offsets diamond position by (drawnStart - clip.startTime) when transition exists', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    const root = createRoot(host)

    // Clip has a 0.25s transition head: drawnStart is 28.25s, clip.startTime is 28.0s
    // pixelsPerSecond = 100
    // Keyframe at t = 1.25s relative to clip.startTime:
    // (1.25 - 0.25) * 100 = 100px from left of drawn clip container
    await act(async () => {
      root.render(
        <TimelineKeyframeRow
          clip={baseClip}
          pixelsPerSecond={100}
          drawnStart={28.25}
          drawnDuration={3.5}
        />
      )
    })

    const diamondWrappers = host.querySelectorAll('.pointer-events-auto')
    expect(diamondWrappers.length).toBe(3)

    // Middle diamond (t = 1.25s): (1.25 - 0.25) * 100 = 100px
    const middleDiamond = diamondWrappers[1] as HTMLElement
    expect(middleDiamond.style.left).toBe('100px')

    // First diamond (t = 0): (0 - 0.25) * 100 = -25px -> clamped to 6px min
    const firstDiamond = diamondWrappers[0] as HTMLElement
    expect(firstDiamond.style.left).toBe('6px')

    // Last diamond (t = 4s): (4 - 0.25) * 100 = 375px -> clamped to clipWidthPx - 6 = 350 - 6 = 344px
    const lastDiamond = diamondWrappers[2] as HTMLElement
    expect(lastDiamond.style.left).toBe('344px')
  })

  it('renders diamonds accurately when no transition exists (drawnStart === clip.startTime)', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <TimelineKeyframeRow
          clip={baseClip}
          pixelsPerSecond={100}
          drawnStart={28}
          drawnDuration={4}
        />
      )
    })

    const diamondWrappers = host.querySelectorAll('.pointer-events-auto')
    expect(diamondWrappers.length).toBe(3)

    // Middle diamond (t = 1.25s): 1.25 * 100 = 125px
    const middleDiamond = diamondWrappers[1] as HTMLElement
    expect(middleDiamond.style.left).toBe('125px')

    // Edge diamond (t = 0): 0px -> clamped to 6px
    const firstDiamond = diamondWrappers[0] as HTMLElement
    expect(firstDiamond.style.left).toBe('6px')

    // Edge diamond (t = 4s): 400px -> clamped to clipWidth - 6 = 394px
    const lastDiamond = diamondWrappers[2] as HTMLElement
    expect(lastDiamond.style.left).toBe('394px')
  })
})
