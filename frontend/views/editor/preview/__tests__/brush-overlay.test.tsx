// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createMockClip } from '../../../../../core/tests/edit-patch-test-helpers'
import { BrushOverlay } from '../BrushOverlay'

const store = vi.hoisted(() => ({
  mode: 'region-erase' as string | null,
  addCustomMatteStroke: vi.fn(),
  setCustomMatteBrushMode: vi.fn(),
}))

vi.mock('../../editor-store', () => ({
  useEditorStore: (selector: (state: unknown) => unknown) => selector({}),
  useEditorActions: () => ({
    addCustomMatteStroke: store.addCustomMatteStroke,
    setCustomMatteBrushMode: store.setCustomMatteBrushMode,
  }),
}))
vi.mock('../../../../i18n/I18nContext', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@core/editor-selectors', () => ({
  selectCustomMatteBrushMode: () => store.mode,
  selectCustomMatteBrushSize: () => 10,
}))

async function mount(props: Partial<Parameters<typeof BrushOverlay>[0]> = {}) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const clip = createMockClip({ id: 'v1', type: 'video', trackIndex: 0 })
  await act(async () => {
    root.render(<BrushOverlay selectedClip={clip} videoFrameSize={{ width: 200, height: 400 }} {...props} />)
  })
  return { host, root, clip }
}

function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }) as MouseEvent & { pointerId: number }
  event.pointerId = 1
  return event
}

describe('BrushOverlay', () => {
  it('draws nothing until a brush tool is picked', async () => {
    store.mode = null
    const ui = await mount()
    expect(ui.host.querySelector('[data-brush-overlay]')).toBeNull()
    await act(async () => { ui.root.unmount() })
    store.mode = 'region-erase'
  })

  it('records a stroke from a drag on the frame, without letting the click select another clip', async () => {
    store.mode = 'eraser'
    store.addCustomMatteStroke.mockClear()
    const ui = await mount()
    const overlay = ui.host.querySelector('[data-brush-overlay]') as HTMLElement
    const canvas = ui.host.querySelector('canvas') as HTMLCanvasElement
    canvas.setPointerCapture = () => {}
    canvas.releasePointerCapture = () => {}
    canvas.hasPointerCapture = () => true

    const frameClick = vi.fn()
    document.body.addEventListener('click', frameClick)

    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', 20, 40))
      canvas.dispatchEvent(pointer('pointermove', 60, 80))
      canvas.dispatchEvent(pointer('pointerup', 60, 80))
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(store.addCustomMatteStroke).toHaveBeenCalledTimes(1)
    const [clipId, stroke] = store.addCustomMatteStroke.mock.calls[0]
    expect(clipId).toBe('v1')
    expect(stroke.mode).toBe('eraser')
    expect(stroke.points.length).toBeGreaterThanOrEqual(2)
    expect(stroke.points[0]).toEqual([0.1, 0.1])
    expect(frameClick).not.toHaveBeenCalled()
    expect(overlay).toBeTruthy()
    await act(async () => { ui.root.unmount() })
  })

  it('records strokes as fractions of the picture, not of the frame around it', async () => {
    store.mode = 'brush'
    store.addCustomMatteStroke.mockClear()
    // A 300x400 photo in a 200x400 frame fills the width and 266.67px of the height,
    // centred: it starts 66.67px down.
    const photo = document.createElement('img')
    Object.defineProperty(photo, 'naturalWidth', { value: 300 })
    Object.defineProperty(photo, 'naturalHeight', { value: 400 })
    const ui = await mount({ sourceElement: photo })
    const canvas = ui.host.querySelector('canvas') as HTMLCanvasElement
    canvas.setPointerCapture = () => {}
    canvas.releasePointerCapture = () => {}
    canvas.hasPointerCapture = () => true
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', 100, 200))
      canvas.dispatchEvent(pointer('pointerup', 100, 200))
    })
    const [, stroke] = store.addCustomMatteStroke.mock.calls[0]
    expect(stroke.points[0][0]).toBeCloseTo(0.5, 3)
    expect(stroke.points[0][1]).toBeCloseTo(0.5, 3) // the middle of the photo, the middle of the frame
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', 100, 66.67))
      canvas.dispatchEvent(pointer('pointerup', 100, 66.67))
    })
    expect(store.addCustomMatteStroke.mock.calls[1][1].points[0][1]).toBeCloseTo(0, 2) // the photo's top edge
    await act(async () => { ui.root.unmount() })
  })

  it('a smart stroke is still recorded when the frame cannot be read', async () => {
    store.mode = 'region-brush'
    store.addCustomMatteStroke.mockClear()
    const photo = document.createElement('img')
    Object.defineProperty(photo, 'naturalWidth', { value: 200 })
    Object.defineProperty(photo, 'naturalHeight', { value: 400 })
    const ui = await mount({ sourceElement: photo })
    const canvas = ui.host.querySelector('canvas') as HTMLCanvasElement
    canvas.setPointerCapture = () => {}
    canvas.releasePointerCapture = () => {}
    canvas.hasPointerCapture = () => true
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', 100, 200))
      canvas.dispatchEvent(pointer('pointerup', 100, 200))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(store.addCustomMatteStroke).toHaveBeenCalledTimes(1)
    expect(store.addCustomMatteStroke.mock.calls[0][1].mode).toBe('region-brush')
    await act(async () => { ui.root.unmount() })
  })
})
