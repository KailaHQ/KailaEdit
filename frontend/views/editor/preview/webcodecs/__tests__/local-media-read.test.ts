// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readLocalMedia, fileUrlToPath } from '../VideoDemuxer'
import { pathToFileUrl } from '@/lib/file-url'

/**
 * The demuxer reads local media through the main process, not `fetch('file://…')`.
 *
 * The renderer's CSP allows `file:` for `img-src` and `media-src` but not for
 * `connect-src`, so the fetch was refused every single time: `WebCodecsPlayer.load`
 * returned false, and the whole hardware-decode path fell back to <video> silently. It
 * stayed invisible until the <video> path broke too and the monitor went black.
 *
 * Widening `connect-src` to `file:` would have fixed it in one line and handed the
 * renderer the ability to read any local file. These tests pin the other choice: the read
 * happens in main, behind `validatePath`.
 */
describe('reading local media for demuxing', () => {
  const originalApi = (window as any).electronAPI

  beforeEach(() => {
    delete (window as any).electronAPI
  })

  afterEach(() => {
    ;(window as any).electronAPI = originalApi
    vi.restoreAllMocks()
  })

  function mockApi(bytes: Uint8Array, chunkLimit = 8 * 1024 * 1024) {
    const readMediaChunk = vi.fn(async ({ offset, length }: { filePath: string; offset: number; length: number }) => {
      const start = Math.min(offset, bytes.byteLength)
      const end = Math.min(start + Math.min(length, chunkLimit), bytes.byteLength)
      return { data: bytes.slice(start, end), totalSize: bytes.byteLength }
    })
    ;(window as any).electronAPI = { readMediaChunk }
    return readMediaChunk
  }

  it('reassembles a file that spans several chunks, byte for byte', async () => {
    const bytes = new Uint8Array(1000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const readMediaChunk = mockApi(bytes, 256) // force 4 round trips

    const out = new Uint8Array(await readLocalMedia('C:\\media\\a.mov'))

    expect(out.byteLength).toBe(bytes.byteLength)
    expect(Array.from(out)).toEqual(Array.from(bytes))
    expect(readMediaChunk.mock.calls.length).toBeGreaterThan(1)
    // Ranges must be contiguous and forward-only, or the buffer is silently corrupt.
    let expectedOffset = 0
    for (const [input] of readMediaChunk.mock.calls) {
      expect(input.offset).toBe(expectedOffset)
      expectedOffset += 256
    }
  })

  it('handles a file that fits in one chunk', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const readMediaChunk = mockApi(bytes)
    const out = new Uint8Array(await readLocalMedia('/media/a.mov'))
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
    expect(readMediaChunk).toHaveBeenCalledTimes(1)
  })

  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockApi(new Uint8Array([9]))
    await readLocalMedia('C:\\media\\a.mov')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails loudly when the bridge is missing rather than falling back to fetch', async () => {
    await expect(readLocalMedia('C:\\media\\a.mov')).rejects.toThrow(/readMediaChunk is unavailable/)
  })

  it('rejects an empty or unreadable file instead of demuxing nothing', async () => {
    mockApi(new Uint8Array(0))
    await expect(readLocalMedia('C:\\media\\a.mov')).rejects.toThrow(/empty or unreadable/)
  })

  it('accepts a file:// URL, undoing what pathToFileUrl produced', async () => {
    const readMediaChunk = mockApi(new Uint8Array([7]))
    const winPath = 'C:\\media\\a b.mov'
    await readLocalMedia(pathToFileUrl(winPath))
    expect(readMediaChunk.mock.calls[0][0].filePath).toBe(winPath)
  })
})

describe('fileUrlToPath', () => {
  it('round-trips a Windows path through pathToFileUrl', () => {
    const p = 'C:\\Users\\me\\My Media\\clip.mov'
    expect(fileUrlToPath(pathToFileUrl(p))).toBe(p)
  })

  it('round-trips a POSIX path', () => {
    const p = '/home/me/My Media/clip.mov'
    expect(fileUrlToPath(pathToFileUrl(p))).toBe(p)
  })
})
