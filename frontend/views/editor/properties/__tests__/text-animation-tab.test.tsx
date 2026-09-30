// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTextClipWithPreset } from '@core/text-presets'
import { TextAnimationTab } from '../TextAnimationTab'

const actions = vi.hoisted(() => ({
  setTextAnimationDurationOnClip: vi.fn(),
  applyTextAnimationToClip: vi.fn(),
  clearTextAnimationFromClip: vi.fn(),
  setCurrentTime: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
}))
vi.mock('../../editor-store', () => ({ useEditorActions: () => actions }))

describe('TextAnimationTab audition', () => {
  beforeEach(() => { vi.useFakeTimers(); Object.values(actions).forEach(fn => fn.mockClear()) })
  afterEach(() => { vi.useRealTimers() })

  async function mount(phase?: 'out') {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const clip = { ...createTextClipWithPreset('default', undefined, 'Hi', 3, 0, 6) }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TextAnimationTab selectedClip={clip} />) })
    if (phase) await act(async () => { (host.querySelector(`[data-animation-phase="${phase}"]`) as HTMLElement).click() })
    return { host, root, clip }
  }

  it('applies an entrance, jumps to the clip start, plays for its length, then stops', async () => {
    const ui = await mount()
    await act(async () => { (ui.host.querySelector('[data-animation-id="slide-in"]') as HTMLElement).click() })
    expect(actions.applyTextAnimationToClip).toHaveBeenCalledWith(ui.clip.id, 'slide-in')
    expect(actions.setCurrentTime).toHaveBeenCalledWith(3)
    expect(actions.play).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(actions.play).toHaveBeenCalledTimes(1)
    expect(actions.pause).toHaveBeenCalledTimes(1) // only the one before seeking

    await act(async () => { vi.advanceTimersByTime(1000) }) // slide-in takes 0.5s, plus a short tail
    expect(actions.pause).toHaveBeenCalledTimes(2)
    await act(async () => { ui.root.unmount() })
  })

  it('starts an exit just before it happens, at the tail of the clip', async () => {
    const ui = await mount('out')
    await act(async () => { (ui.host.querySelector('[data-animation-id="fade-out"]') as HTMLElement).click() })
    // clip runs 3s–9s, the exit takes 0.6s: start half a second ahead of 8.4s
    expect(actions.setCurrentTime.mock.calls.at(-1)?.[0]).toBeCloseTo(7.9, 2)
    await act(async () => { ui.root.unmount() })
  })

  it('a new pick cancels the previous audition', async () => {
    const ui = await mount()
    await act(async () => { (ui.host.querySelector('[data-animation-id="slide-in"]') as HTMLElement).click() })
    await act(async () => { (ui.host.querySelector('[data-animation-id="zoom-in"]') as HTMLElement).click() })
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(actions.play).toHaveBeenCalledTimes(1)
    await act(async () => { ui.root.unmount() })
  })

  it('has no templates list, and sets the entrance length from the slider handles', async () => {
    const ui = await mount()
    expect(ui.host.textContent).not.toContain('Templates')
    // With nothing chosen the handles are inert.
    const inHandle = ui.host.querySelector('[data-duration-thumb="in"]') as HTMLElement
    await act(async () => { inHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(actions.setTextAnimationDurationOnClip).not.toHaveBeenCalled()
    await act(async () => { (ui.host.querySelector('[data-animation-id="slide-in"]') as HTMLElement).click() })
  })
})
