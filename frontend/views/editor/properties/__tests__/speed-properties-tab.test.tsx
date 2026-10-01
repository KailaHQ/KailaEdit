// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineClip } from '../../../../types/project-model'
import { curveMeanSpeed, durationForSpeedCurve, speedCurveForPreset } from '@core/speed-curve'
import { SpeedPropertiesTab } from '../SpeedPropertiesTab'

const actions = vi.hoisted(() => ({
  setClipStartTime: vi.fn(),
  setClipSpeed: vi.fn(),
  setClipSpeedCurve: vi.fn(),
  setCurrentTime: vi.fn(),
}))
const editorState = vi.hoisted(() => ({ session: { transport: { currentTime: 0 } } }))
vi.mock('../../editor-store', () => ({
  useEditorActions: () => actions,
  useEditorStore: () => [],
  useEditorGetState: () => () => editorState,
}))

function videoClip(extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'c1',
    assetId: null,
    type: 'video',
    startTime: 0,
    duration: 6,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: 0,
    asset: null,
    ...extra,
  } as unknown as TimelineClip
}

function curvedClip(): TimelineClip {
  const curve = speedCurveForPreset('bullet')
  return videoClip({ speedCurve: curve, speed: curveMeanSpeed(curve), duration: durationForSpeedCurve(6, curve) })
}

describe('SpeedPropertiesTab', () => {
  beforeEach(() => { Object.values(actions).forEach(fn => fn.mockClear()) })
  afterEach(() => { document.body.innerHTML = '' })

  async function mount(clip: TimelineClip) {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<SpeedPropertiesTab selectedClip={clip} />) })
    const q = (selector: string) => host.querySelector(selector) as HTMLElement | null
    return { host, root, q }
  }

  it('opens on Standard for a constant-speed clip and on Curve for a curved one', async () => {
    const plain = await mount(videoClip())
    expect(plain.q('[data-speed-subtab="standard"]')?.getAttribute('aria-selected')).toBe('true')
    expect(plain.q('[data-speed-curve-presets]')).toBeNull()
    await act(async () => { plain.root.unmount() })

    const curved = await mount(curvedClip())
    expect(curved.q('[data-speed-subtab="curve"]')?.getAttribute('aria-selected')).toBe('true')
    expect(curved.q('[data-speed-curve-preset="bullet"]')?.className).toContain('ring-cyan-400')
    expect(curved.q('[data-speed-curve-editor]')).not.toBeNull()
    await act(async () => { curved.root.unmount() })
  })

  it('applies a preset, and None removes the curve', async () => {
    const ui = await mount(videoClip())
    await act(async () => { ui.q('[data-speed-subtab="curve"]')!.click() })
    expect(ui.q('[data-speed-curve-editor]')).toBeNull() // no curve yet

    await act(async () => { ui.q('[data-speed-curve-preset="hero"]')!.click() })
    expect(actions.setClipSpeedCurve).toHaveBeenCalledWith('c1', speedCurveForPreset('hero'))

    await act(async () => { ui.q('[data-speed-curve-preset="none"]')!.click() })
    expect(actions.setClipSpeedCurve).toHaveBeenLastCalledWith('c1', null)
    await act(async () => { ui.root.unmount() })
  })

  it('shows the duration the curve gives', async () => {
    const ui = await mount(curvedClip())
    const text = ui.q('[data-speed-curve-duration]')!.textContent!
    expect(text).toContain('6.0s')
    expect(text).toContain(`${durationForSpeedCurve(6, speedCurveForPreset('bullet')).toFixed(1)}s`)
    await act(async () => { ui.root.unmount() })
  })

  it('commits a point drag once, on release', async () => {
    const ui = await mount(curvedClip())
    const svg = ui.host.querySelector('svg[class*="h-[170px]"]') as SVGSVGElement
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 170, right: 300, bottom: 170, x: 0, y: 0, toJSON() {} }) as DOMRect
    const point = ui.q('[data-speed-curve-point="2"]')!
    point.setPointerCapture = () => {}

    await act(async () => { point.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 126, clientY: 140, pointerId: 1 })) })
    await act(async () => { point.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 126, clientY: 120, pointerId: 1 })) })
    await act(async () => { point.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 126, clientY: 100, pointerId: 1 })) })
    expect(actions.setClipSpeedCurve).not.toHaveBeenCalled()

    await act(async () => { point.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 126, clientY: 100, pointerId: 1 })) })
    expect(actions.setClipSpeedCurve).toHaveBeenCalledTimes(1)
    const [, curve] = actions.setClipSpeedCurve.mock.calls[0]
    // Dragged up from the 0.2x dip: faster than it was, still a bullet curve.
    expect(curve.points[2].v).toBeGreaterThan(0.2)
    expect(curve.preset).toBe('bullet')
    await act(async () => { ui.root.unmount() })
  })

  it('Reset returns to the preset the curve came from', async () => {
    const ui = await mount(curvedClip())
    await act(async () => { ui.q('[data-speed-curve-reset]')!.click() })
    expect(actions.setClipSpeedCurve).toHaveBeenCalledWith('c1', speedCurveForPreset('bullet'))
    await act(async () => { ui.root.unmount() })
  })

  it('warns under Standard that a speed replaces the curve, and sets it through setClipSpeed', async () => {
    const ui = await mount(curvedClip())
    await act(async () => { ui.q('[data-speed-subtab="standard"]')!.click() })
    expect(ui.q('[data-speed-curve-replaced-note]')).not.toBeNull()
    const twoX = [...ui.host.querySelectorAll('button')].find(b => b.textContent === '2x')!
    await act(async () => { twoX.click() })
    expect(actions.setClipSpeed).toHaveBeenCalledTimes(1)
    expect(actions.setClipSpeed.mock.calls[0][1]).toBe(2)
    await act(async () => { ui.root.unmount() })
  })
})
