// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TimelineClip } from '../../../../types/project-model'
import { createMockClip } from '../../../../../core/tests/edit-patch-test-helpers'
import {
  TextPropertiesTab,
  applyTextCase,
  parseColor,
  textCaseOf,
  withAlpha,
} from '../TextPropertiesTab'
import { TEXT_STYLE_PRESETS } from '../text-style-presets'

const updateClip = vi.hoisted(() => vi.fn())
vi.mock('../../editor-store', () => ({ useEditorActions: () => ({ updateClip }) }))
vi.mock('../../FontPicker', () => ({ FontPicker: () => null }))

function textClip(style: Partial<typeof DEFAULT_TEXT_STYLE> = {}): TimelineClip {
  return createMockClip({
    id: 'txt', type: 'text', assetId: null, trackIndex: 1, startTime: 0, duration: 3,
    textStyle: { ...DEFAULT_TEXT_STYLE, text: 'hello world', ...style },
  })
}

async function render(clip: TimelineClip) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<TextPropertiesTab selectedClip={clip} />) })
  const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('control not found')
    await act(async () => { (el as HTMLElement).click() })
  }
  const button = (title: string) => host.querySelector(`button[title="${title}"]`)
  const lastStyle = () => updateClip.mock.calls.at(-1)?.[1].textStyle
  return { host, root, click, button, lastStyle }
}

describe('TextPropertiesTab', () => {
  it('toggles bold, underline and italic', async () => {
    updateClip.mockClear()
    const ui = await render(textClip({ fontWeight: 'normal' }))
    await ui.click(ui.button('Bold'))
    expect(ui.lastStyle().fontWeight).toBe('bold')
    await ui.click(ui.button('Underline'))
    expect(ui.lastStyle().underline).toBe(true)
    await ui.click(ui.button('Italic'))
    expect(ui.lastStyle().fontStyle).toBe('italic')
    await act(async () => { ui.root.unmount() })
  })

  it('changes the case of the words themselves', async () => {
    updateClip.mockClear()
    const ui = await render(textClip())
    await ui.click(ui.button('Uppercase'))
    expect(ui.lastStyle().text).toBe('HELLO WORLD')
    await ui.click(ui.button('Capitalize each word'))
    expect(ui.lastStyle().text).toBe('Hello World')
    await act(async () => { ui.root.unmount() })
  })

  it('applies a preset look without touching size, font or position', async () => {
    updateClip.mockClear()
    const ui = await render(textClip({ fontSize: 99, positionX: 12, positionY: 34, fontFamily: 'Georgia' }))
    const preset = TEXT_STYLE_PRESETS.find(p => p.id === 'black-on-yellow')!
    await ui.click(ui.host.querySelector(`[data-text-look="${preset.id}"]`))
    const style = ui.lastStyle()
    expect(style).toMatchObject(preset.look)
    expect(style).toMatchObject({ fontSize: 99, positionX: 12, positionY: 34, fontFamily: 'Georgia', text: 'hello world' })
    await act(async () => { ui.root.unmount() })
  })

  it('shows the Bubble and Effects controls on their own sub-tabs', async () => {
    const ui = await render(textClip())
    expect(ui.host.textContent).toContain('Preset style')
    await ui.click([...ui.host.querySelectorAll('button')].find(b => b.textContent === 'Bubble'))
    expect(ui.host.textContent).toContain('Background')
    expect(ui.host.textContent).not.toContain('Preset style')
    await ui.click([...ui.host.querySelectorAll('button')].find(b => b.textContent === 'Effects'))
    expect(ui.host.textContent).toContain('Stroke')
    expect(ui.host.textContent).toContain('Shadow')
    await act(async () => { ui.root.unmount() })
  })
})

describe('text panel helpers', () => {
  it('reads and writes colours with their opacity', () => {
    expect(parseColor('transparent')).toEqual({ hex: '#000000', alpha: 0 })
    expect(parseColor('#FFE600')).toEqual({ hex: '#ffe600', alpha: 1 })
    expect(parseColor('#00000080').alpha).toBeCloseTo(0.5, 2)
    expect(parseColor('rgba(0,0,0,0.6)')).toEqual({ hex: '#000000', alpha: 0.6 })
    expect(withAlpha('#112233', 1)).toBe('#112233ff')
    expect(withAlpha('#112233', 0)).toBe('#11223300')
  })

  it('knows which case a text is in, including Vietnamese', () => {
    expect(applyTextCase('bí quyết cho người', 'title')).toBe('Bí Quyết Cho Người')
    expect(textCaseOf('BÍ QUYẾT')).toBe('upper')
    expect(textCaseOf('bí quyết')).toBe('lower')
    expect(textCaseOf('Bí Quyết')).toBe('title')
    expect(textCaseOf('bÍ quyết')).toBeNull()
    expect(textCaseOf('123')).toBeNull()
  })
})
