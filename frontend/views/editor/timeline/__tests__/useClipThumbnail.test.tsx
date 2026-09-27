// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useClipThumbnail } from '../useClipThumbnail'
import type { TimelineClip, Asset } from '@/types/project-model'

describe('useClipThumbnail', () => {
  let container: HTMLDivElement
  let root: Root

  const mockAsset: Asset = {
    id: 'asset-1',
    type: 'video',
    path: 'C:/media/video1.mp4',
    smallThumbnailPath: 'C:/media/thumb0.png',
    createdAt: Date.now(),
    prompt: '',
    resolution: '',
  }

  const baseClip: TimelineClip = {
    id: 'clip-1',
    assetId: 'asset-1',
    type: 'video',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: 0,
    asset: mockAsset,
  } as unknown as TimelineClip

  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as any).electronAPI
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
    }
    container?.remove()
  })

  it('returns default smallThumbnailPath when trimStart is 0', () => {
    let thumb: string | undefined
    function TestComponent() {
      thumb = useClipThumbnail(baseClip, mockAsset)
      return null
    }

    act(() => {
      root.render(<TestComponent />)
    })

    expect(thumb).toBe('C:/media/thumb0.png')
  })

  it('returns asset path if smallThumbnailPath is absent', () => {
    const assetWithoutThumb = { ...mockAsset, smallThumbnailPath: undefined }
    let thumb: string | undefined
    function TestComponent() {
      thumb = useClipThumbnail(baseClip, assetWithoutThumb)
      return null
    }

    act(() => {
      root.render(<TestComponent />)
    })

    expect(thumb).toBe('C:/media/video1.mp4')
  })

  it('fetches extracted frame when trimStart > 0', async () => {
    const extractMock = vi.fn().mockResolvedValue({ path: 'C:/media/extracted_frame_12s.jpg' })
    ;(window as any).electronAPI = {
      extractVideoFrame: extractMock,
    }

    const cutClip: TimelineClip = {
      ...baseClip,
      id: 'clip-cut',
      trimStart: 12.5,
    }

    let thumb: string | undefined
    function TestComponent() {
      thumb = useClipThumbnail(cutClip, mockAsset)
      return null
    }

    act(() => {
      root.render(<TestComponent />)
    })

    // Initially shows fallback thumb0 while loading
    expect(thumb).toBe('C:/media/thumb0.png')

    // Wait for debounced extraction
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    expect(thumb).toBe('C:/media/extracted_frame_12s.jpg')
    expect(extractMock).toHaveBeenCalledWith({
      videoPath: 'C:/media/video1.mp4',
      seekTime: 12.5,
      width: 120,
      quality: 4,
    })
  })
})
