// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Asset, TimelineClip } from '../../../types/project-model'
import { createMockClip } from '../../../../core/tests/edit-patch-test-helpers'
import { ReplaceClipModal } from '../ReplaceClipModal'
import { I18nProvider } from '../../../i18n/I18nContext'

const video = (id: string, duration: number): Asset => ({ id, type: 'video', path: `C:/m/${id}.mp4`, prompt: '', resolution: '', duration, createdAt: 0 })
const LONG = video('long', 30)
const EXACT = video('exact', 4)
const PHOTO: Asset = { id: 'photo', type: 'image', path: 'C:/m/photo.png', prompt: '', resolution: '', createdAt: 0 }
const clip: TimelineClip = createMockClip({ id: 'c', type: 'video', assetId: 'old', duration: 4 })

let root: Root
let host: HTMLDivElement
const onReplace = vi.fn()
const onClose = vi.fn()

beforeEach(async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  // happy-dom has no media playback; the picker only needs these not to throw.
  HTMLMediaElement.prototype.play = vi.fn(async () => {}) as any
  HTMLMediaElement.prototype.pause = vi.fn() as any
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nProvider initialLanguage="en"><ReplaceClipModal
        clip={clip}
        assets={[LONG, EXACT, PHOTO]}
        tracks={[]}
        onReplace={onReplace}
        onImportFiles={async () => []}
        onNotice={() => {}}
        onClose={onClose}
      /></I18nProvider>,
    )
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null
const click = async (sel: string) => { await act(async () => { q(sel)!.click() }) }
const key = async (k: string, shiftKey = false) => {
  await act(async () => { q('[data-segment-bar]')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true })) })
}

it('asks where a longer video should start, then replaces from there', async () => {
  await click('[data-replace-asset="long"]')
  expect(onReplace).not.toHaveBeenCalled()
  expect(q('[data-segment-bar]')).not.toBeNull()
  await key('ArrowRight', true)
  await key('ArrowRight', true)
  await key('ArrowRight')
  expect(q('[data-segment-bar]')!.getAttribute('aria-valuenow')).toBe('2.1')
  await click('[data-segment-confirm]')
  expect(onReplace).toHaveBeenCalledTimes(1)
  expect(onReplace.mock.calls[0][0].id).toBe('long')
  expect(onReplace.mock.calls[0][1]).toBeCloseTo(2.1)
})

it('never lets the window run past the end of the video', async () => {
  await click('[data-replace-asset="long"]')
  await key('End')
  expect(q('[data-segment-bar]')!.getAttribute('aria-valuenow')).toBe('26')
  await key('ArrowRight', true)
  expect(q('[data-segment-bar]')!.getAttribute('aria-valuenow')).toBe('26')
  await key('Home')
  await key('ArrowLeft')
  expect(q('[data-segment-bar]')!.getAttribute('aria-valuenow')).toBe('0')
})

it('replaces straight away when there is nothing to choose', async () => {
  await click('[data-replace-asset="photo"]')
  expect(onReplace).toHaveBeenLastCalledWith(PHOTO, 0)
  await click('[data-replace-asset="exact"]')
  expect(onReplace).toHaveBeenLastCalledWith(EXACT, 0)
  expect(q('[data-segment-bar]')).toBeNull()
})

it('steps back to the list on Escape before closing', async () => {
  await click('[data-replace-asset="long"]')
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(q('[data-segment-bar]')).toBeNull()
  expect(q('[data-replace-asset="long"]')).not.toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(onClose).toHaveBeenCalledTimes(1)
})
