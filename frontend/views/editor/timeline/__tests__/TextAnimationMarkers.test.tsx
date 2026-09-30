// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createTextClipWithPreset, applyTextAnimation } from '@core/text-presets'
import { TextAnimationMarkers } from '../TextAnimationMarkers'

vi.mock('../../../../i18n/I18nContext', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

async function render(clip: ReturnType<typeof createTextClipWithPreset>, pixelsPerSecond = 100) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<TextAnimationMarkers clip={clip} pixelsPerSecond={pixelsPerSecond} clipWidthPx={clip.duration * pixelsPerSecond} />)
  })
  return { host, root }
}

describe('TextAnimationMarkers', () => {
  it('draws nothing for a clip without an animation', async () => {
    const ui = await render(createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 4))
    expect(ui.host.querySelector('[data-text-animation-markers]')).toBeNull()
    await act(async () => { ui.root.unmount() })
  })

  it('draws an entrance arrow and an exit arrow as long as their animations take', async () => {
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 4)
    clip = applyTextAnimation(clip, 'fade-in') // 0.6s
    clip = applyTextAnimation(clip, 'fade-out') // 0.6s
    const ui = await render(clip, 100)
    const lines = [...ui.host.querySelectorAll('line')]
    expect(lines).toHaveLength(2)
    const [entrance, exit] = lines
    expect(Number(entrance.getAttribute('x2')) - Number(entrance.getAttribute('x1'))).toBeCloseTo(58, 0)
    expect(Number(exit.getAttribute('x2')) - Number(exit.getAttribute('x1'))).toBeCloseTo(58, 0)
    expect(Number(exit.getAttribute('x2'))).toBeGreaterThan(Number(entrance.getAttribute('x2')))
    await act(async () => { ui.root.unmount() })
  })
})
