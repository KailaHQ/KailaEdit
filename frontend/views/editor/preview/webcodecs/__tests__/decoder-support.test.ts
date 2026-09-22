import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HardwareVideoDecoder } from '../HardwareVideoDecoder'
import type { VideoDemuxTrackInfo } from '../types'

describe('HardwareVideoDecoder support and fallback', () => {
  const originalVideoDecoder = globalThis.VideoDecoder
  const resetSpy = vi.fn()

  beforeEach(() => {
    resetSpy.mockClear()
    vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
    // Mock global VideoDecoder
    ;(globalThis as any).VideoDecoder = class MockVideoDecoder {
      static isConfigSupported = vi.fn().mockImplementation(async (cfg: any) => {
        if (cfg.codec.startsWith('avc1')) {
          return { supported: true, config: cfg }
        }
        return { supported: false, config: cfg }
      })

      state = 'unconfigured'
      configure = vi.fn(() => {
        this.state = 'configured'
      })
      decode = vi.fn()
      flush = vi.fn(async () => {})
      reset = vi.fn(() => {
        resetSpy()
        this.state = 'configured'
      })
      close = vi.fn(() => {
        this.state = 'closed'
      })
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    ;(globalThis as any).VideoDecoder = originalVideoDecoder
  })

  it('checks if track codec is supported', async () => {
    const supportedTrack: VideoDemuxTrackInfo = {
      id: 1,
      codec: 'avc1.4d401f',
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      rotation: 0,
      duration: 10,
      timescale: 1000,
      nb_samples: 300,
    }

    const unsupportedTrack: VideoDemuxTrackInfo = {
      id: 2,
      codec: 'unknown_codec',
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      rotation: 0,
      duration: 10,
      timescale: 1000,
      nb_samples: 300,
    }

    expect(await HardwareVideoDecoder.isSupported(supportedTrack)).toBe(true)
    expect(await HardwareVideoDecoder.isSupported(unsupportedTrack)).toBe(false)
  })

  it('configures decoder with hardware preference', async () => {
    const decoder = new HardwareVideoDecoder()
    const track: VideoDemuxTrackInfo = {
      id: 1,
      codec: 'avc1.4d401f',
      width: 1280,
      height: 720,
      codedWidth: 1280,
      codedHeight: 720,
      rotation: 0,
      duration: 5,
      timescale: 1000,
      nb_samples: 150,
    }

    const success = await decoder.configure(track)
    expect(success).toBe(true)
    decoder.destroy()
  })

  it('reuses completed all-intra seeks but resets overlapping requests and GOP seeks', async () => {
    const decoder = new HardwareVideoDecoder()
    await decoder.configure({ id: 1, codec: 'avc1.4d401f', width: 96, height: 64,
      codedWidth: 96, codedHeight: 64, rotation: 0, duration: 3, timescale: 30, nb_samples: 90 })
    const key = { type: 'key' } as EncodedVideoChunk
    const delta = { type: 'delta' } as EncodedVideoChunk
    await decoder.decodeChunks([key], 0)
    await decoder.decodeChunks([key], 2)
    expect(resetSpy).not.toHaveBeenCalled()
    await decoder.decodeChunks([key, delta], 1)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    const interrupted = decoder.decodeChunks([key], 0)
    const newest = decoder.decodeChunks([key], 2)
    await Promise.all([interrupted, newest])
    expect(resetSpy).toHaveBeenCalledTimes(2)
    decoder.destroy()
  })
})
