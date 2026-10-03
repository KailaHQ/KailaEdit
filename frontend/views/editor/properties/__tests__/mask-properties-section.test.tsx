// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineClip } from '../../../../types/project-model'
import { DEFAULT_CLIP_MASK } from '../../../../types/project-model'
import { MaskPropertiesSection } from '../MaskPropertiesSection'

const actions = vi.hoisted(() => ({
  addClipMask: vi.fn(),
  removeClipMask: vi.fn(),
  updateClipMask: vi.fn(),
  setClipMaskShape: vi.fn(),
  setActiveMaskId: vi.fn(),
  setClipMask: vi.fn(),
  setMaskMode: vi.fn(),
}))
let activeMaskId: string | null = null
vi.mock('../../editor-store', () => ({
  useEditorActions: () => actions,
  useEditorStore: () => activeMaskId,
}))

function clipWith(masks: Array<Partial<typeof DEFAULT_CLIP_MASK> & { id: string }> | undefined): TimelineClip {
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
    masks: masks?.map(mask => ({ ...DEFAULT_CLIP_MASK, ...mask })),
  } as unknown as TimelineClip
}

describe('MaskPropertiesSection', () => {
  beforeEach(() => {
    Object.values(actions).forEach(fn => fn.mockClear())
    activeMaskId = null
  })
  afterEach(() => { document.body.innerHTML = '' })

  async function mount(clip: TimelineClip) {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MaskPropertiesSection selectedClip={clip} />) })
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
    const button = (label: string) => host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
    const shapeButton = (label: string) =>
      host.querySelector<HTMLElement>(`button[aria-pressed][aria-label="${label}"]`)
    return { host, root, tabs, button, shapeButton }
  }

  it('lists a tab for every mask, numbered and named by shape, with the edited one selected', async () => {
    activeMaskId = 'b'
    const ui = await mount(clipWith([{ id: 'a', shape: 'ellipse' }, { id: 'b', shape: 'rectangle' }]))
    expect(ui.tabs().map(tab => tab.textContent)).toEqual(['Mask1 Circle', 'Mask2 Rectangle'])
    expect(ui.tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    await act(async () => { ui.root.unmount() })
  })

  it('falls back to the first mask when none is picked', async () => {
    const ui = await mount(clipWith([{ id: 'a', shape: 'star' }, { id: 'b', shape: 'heart' }]))
    expect(ui.tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    await act(async () => { ui.root.unmount() })
  })

  it('the plus button adds another mask', async () => {
    const ui = await mount(clipWith([{ id: 'a' }]))
    await act(async () => { ui.button('Add mask')!.click() })
    expect(actions.addClipMask).toHaveBeenCalledWith('c1', 'rectangle')
    expect(actions.setMaskMode).toHaveBeenCalledWith(true)
    await act(async () => { ui.root.unmount() })
  })

  it('clicking a tab picks that mask to edit', async () => {
    const ui = await mount(clipWith([{ id: 'a' }, { id: 'b', shape: 'ellipse' }]))
    await act(async () => { ui.tabs()[1].click() })
    expect(actions.setActiveMaskId).toHaveBeenCalledWith('b')
    await act(async () => { ui.root.unmount() })
  })

  it('picking a shape changes the edited mask in place', async () => {
    activeMaskId = 'b'
    const ui = await mount(clipWith([{ id: 'a', shape: 'rectangle' }, { id: 'b', shape: 'rectangle' }]))
    await act(async () => { ui.shapeButton('Heart')!.click() })
    expect(actions.setClipMaskShape).toHaveBeenCalledWith('c1', 'b', 'heart')
    expect(actions.addClipMask).not.toHaveBeenCalled()
    await act(async () => { ui.root.unmount() })
  })

  it('picking a shape on a clip with no mask adds one of that shape', async () => {
    const ui = await mount(clipWith(undefined))
    expect(ui.tabs()).toEqual([])
    await act(async () => { ui.shapeButton('Stars')!.click() })
    expect(actions.addClipMask).toHaveBeenCalledWith('c1', 'star')
    await act(async () => { ui.root.unmount() })
  })

  it('removes the selected mask from its tab', async () => {
    activeMaskId = 'a'
    const ui = await mount(clipWith([{ id: 'a' }, { id: 'b' }]))
    await act(async () => { ui.button('Remove this mask')!.click() })
    expect(actions.removeClipMask).toHaveBeenCalledWith('c1', 'a')
    await act(async () => { ui.root.unmount() })
  })

  it('shows round corners only for a rectangle', async () => {
    activeMaskId = 'a'
    const rectangle = await mount(clipWith([{ id: 'a', shape: 'rectangle' }]))
    expect(rectangle.host.textContent).toContain('Round corners')
    await act(async () => { rectangle.root.unmount() })

    const circle = await mount(clipWith([{ id: 'a', shape: 'ellipse' }]))
    expect(circle.host.textContent).not.toContain('Round corners')
    await act(async () => { circle.root.unmount() })
  })
})
