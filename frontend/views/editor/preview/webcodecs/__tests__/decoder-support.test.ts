import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HardwareVideoDecoder } from '../HardwareVideoDecoder'
import type { VideoDemuxTrackInfo } from '../types'

describe('HardwareVideoDecoder support and fallback', () => {
  const originalVideoDecoder = globalThis.VideoDecoder

  beforeEach(() => {
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
        this.state = 'configured'
      })
      close = vi.fn(() => {
        this.state = 'closed'
      })
    }
  })

  afterEach(() => {
    ;(globalThis as any).VideoDecoder = originalVideoDecoder
  })

  it('checks if track codec is supported', async () => {
    const supportedTrack: VideoDemuxTrackInfo = {
      id: 1,
      codec: 'avc1.4d401f',
      width: 1920,
      height: 1080,
      duration: 10,
      timescale: 1000,
      nb_samples: 300,
    }

    const unsupportedTrack: VideoDemuxTrackInfo = {
      id: 2,
      codec: 'unknown_codec',
      width: 1920,
      height: 1080,
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
      duration: 5,
      timescale: 1000,
      nb_samples: 150,
    }

    const success = await decoder.configure(track)
    expect(success).toBe(true)
    decoder.destroy()
  })
})
