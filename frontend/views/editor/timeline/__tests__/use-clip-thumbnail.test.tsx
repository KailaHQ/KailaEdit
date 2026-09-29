// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Asset, TimelineClip } from '../../../../types/project-model'
import { createMockClip } from '../../../../../core/tests/edit-patch-test-helpers'
import { useClipThumbnail } from '../useClipThumbnail'

const video: Asset = { id: 'v', type: 'video', path: 'C:/m/v.mp4', smallThumbnailPath: 'C:/m/v.jpg', prompt: '', resolution: '', duration: 60, createdAt: 0 }
const photo: Asset = { id: 'p', type: 'image', path: 'C:/m/p.png', prompt: '', resolution: '', createdAt: 0 }

it('survives a clip crossing between "own frame" and "asset thumbnail" — trims, and media swapped by Replace clip', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  ;(window as any).electronAPI = { extractVideoFrame: vi.fn(async () => ({ path: 'C:/cache/frame.jpg' })) }
  const seen: Array<string | undefined> = []
  function Probe({ clip, asset }: { clip: TimelineClip; asset: Asset | null }) {
    seen.push(useClipThumbnail(clip, asset))
    // A hook after it, as in TimelineClipItem: a changing hook count shows up here.
    useState(0)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const render = async (clip: TimelineClip, asset: Asset | null) => {
    await act(async () => { root.render(<Probe clip={clip} asset={asset} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  }
  try {
    const clip = createMockClip({ id: 'c', type: 'video', assetId: 'v', trimStart: 10 })
    await render(clip, video)
    expect(seen.at(-1)).toBe('C:/cache/frame.jpg')
    // Trimmed back to the first frame: the asset thumbnail, and no crash.
    await render({ ...clip, trimStart: 0 }, video)
    expect(seen.at(-1)).toBe('C:/m/v.jpg')
    // Replaced by a picture.
    await render({ ...clip, type: 'image', assetId: 'p', trimStart: 0 }, photo)
    expect(seen.at(-1)).toBe('C:/m/p.png')
    // And back to a trimmed video.
    await render({ ...clip, trimStart: 12 }, video)
    expect(seen.at(-1)).toBe('C:/cache/frame.jpg')
    expect(errors.mock.calls.filter(call => /hook/i.test(String(call[0])))).toEqual([])
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
    errors.mockRestore()
    delete (window as any).electronAPI
  }
})
