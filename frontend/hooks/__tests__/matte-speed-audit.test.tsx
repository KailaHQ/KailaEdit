// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useMatteBakeAudit } from '../useMatteBake'

const fixture = vi.hoisted(() => ({ clips: [] as any[], setClipAutoMatte: vi.fn() }))
const getFixture = vi.hoisted(() => () => fixture)
vi.mock('../../views/editor/editor-store', () => ({
  useEditorActions: () => ({ setClipAutoMatte: fixture.setClipAutoMatte }),
  useEditorStore: (selector: (state: any) => any) => selector(fixture),
  useEditorGetState: () => getFixture,
}))
vi.mock('@core/editor-selectors', () => ({
  selectClips: (state: any) => state.clips,
  selectAssets: () => [],
  selectCurrentTime: () => 0,
  selectClipPathFromAssets: () => '/source.mp4',
}))
vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: () => ({ settings: { autoMatteDevice: 'auto' } }),
}))

it('the mounted audit never schedules another bake for speed-only edits, but still repairs missing coverage', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const start = vi.fn(async () => ({ error: 'test job intentionally not started' }))
  ;(window as any).electronAPI = {
    matteBakeStart: start,
    matteBakeMissing: vi.fn(async () => ({ missing: [] })),
  }
  const bake = { path: '/alpha.mp4', fingerprint: 'original', sourceStart: 0, sourceSpan: 80, speed: 1,
    createdAt: 0, frameCount: 2400 }
  const root = createRoot(document.createElement('div'))
  function Audit() { useMatteBakeAudit('speed-audit-project'); return null }
  try {
    for (const speed of [1, 0.25, 0.5, 2, 4, 1]) {
      fixture.clips = [{ id: 'speed-clip', type: 'video', startTime: 0, trimStart: 0,
        duration: 80 / speed, speed, autoMatte: { enabled: true, bake } }]
      await act(async () => { root.render(<Audit />) })
      expect(start).not.toHaveBeenCalled()
      expect(fixture.setClipAutoMatte).not.toHaveBeenCalled()
    }
    fixture.clips = [{ ...fixture.clips[0], duration: 90 }]
    await act(async () => { root.render(<Audit />) })
    expect(start).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    delete (window as any).electronAPI
  }
})
