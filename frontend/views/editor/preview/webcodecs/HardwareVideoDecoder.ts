import type { VideoDemuxTrackInfo } from './types'
import type { FrameCache } from './FrameCache'

export interface DecoderOptions {
  frameCache?: FrameCache
  preferHardware?: boolean
}

export class HardwareVideoDecoder {
  private decoder: VideoDecoder | null = null
  private trackInfo: VideoDemuxTrackInfo | null = null
  private isConfigured = false
  private frameCache: FrameCache | null = null
  private preferHardware = true
  private latestDecodedFrame: VideoFrame | null = null
  private pendingResolves: Array<(frame: VideoFrame | null) => void> = []

  constructor(options?: DecoderOptions) {
    if (options?.frameCache) {
      this.frameCache = options.frameCache
    }
    if (options?.preferHardware !== undefined) {
      this.preferHardware = options.preferHardware
    }
  }

  static async isSupported(trackInfo: VideoDemuxTrackInfo): Promise<boolean> {
    if (typeof VideoDecoder === 'undefined') return false

    try {
      const config: VideoDecoderConfig = {
        codec: trackInfo.codec,
        codedWidth: trackInfo.width,
        codedHeight: trackInfo.height,
        description: trackInfo.description,
        hardwareAcceleration: 'prefer-hardware',
      }
      const res = await VideoDecoder.isConfigSupported(config)
      return Boolean(res.supported)
    } catch {
      return false
    }
  }

  async configure(trackInfo: VideoDemuxTrackInfo): Promise<boolean> {
    this.close()
    this.trackInfo = trackInfo

    const config: VideoDecoderConfig = {
      codec: trackInfo.codec,
      codedWidth: trackInfo.width,
      codedHeight: trackInfo.height,
      description: trackInfo.description,
      hardwareAcceleration: this.preferHardware ? 'prefer-hardware' : 'no-preference',
    }

    try {
      const support = await VideoDecoder.isConfigSupported(config)
      if (!support.supported) {
        console.warn('[HardwareVideoDecoder] Codec not supported by hardware, trying fallback:', trackInfo.codec)
        config.hardwareAcceleration = 'no-preference'
        const fallbackSupport = await VideoDecoder.isConfigSupported(config)
        if (!fallbackSupport.supported) {
          return false
        }
      }

      this.decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          this.handleDecodedFrame(frame)
        },
        error: (err: DOMException) => {
          console.error('[HardwareVideoDecoder] Decode error:', err)
          this.resolvePending(null)
        },
      })

      this.decoder.configure(config)
      this.isConfigured = true
      return true
    } catch (err) {
      console.error('[HardwareVideoDecoder] Failed to configure VideoDecoder:', err)
      return false
    }
  }

  private handleDecodedFrame(frame: VideoFrame): void {
    const timestampSec = frame.timestamp / 1_000_000

    // Store in LRU frame cache so nearby frames are available for O(1) retrieval
    if (this.frameCache) {
      // Clone frame for cache if this is not the final frame, or store directly
      try {
        const cloned = frame.clone()
        this.frameCache.set(timestampSec, cloned)
      } catch {
        // clone failed
      }
    }

    if (this.latestDecodedFrame) {
      this.latestDecodedFrame.close()
    }
    this.latestDecodedFrame = frame
  }

  private resolvePending(frame: VideoFrame | null): void {
    const callbacks = this.pendingResolves
    this.pendingResolves = []
    for (const resolve of callbacks) {
      resolve(frame)
    }
  }

  /**
   * Decodes a series of chunks (from keyframe to target time) and returns the final frame.
   * Resets any in-flight decoding to immediately prioritize the newest seek point.
   */
  async decodeChunks(chunks: EncodedVideoChunk[], targetTimeSec: number): Promise<VideoFrame | null> {
    if (!this.decoder || !this.isConfigured || chunks.length === 0) {
      return null
    }

    // 1. If we have the target frame in cache, return a clone immediately (0ms O(1))
    if (this.frameCache) {
      const cached = this.frameCache.get(targetTimeSec)
      if (cached) {
        try {
          return cached.clone()
        } catch {
          return null
        }
      }
    }

    // 2. Reset decoder state to discard older in-flight frames if scrubbing fast
    if (this.decoder.state === 'configured') {
      try {
        this.decoder.reset()
        // Re-configure after reset
        if (this.trackInfo) {
          this.decoder.configure({
            codec: this.trackInfo.codec,
            codedWidth: this.trackInfo.width,
            codedHeight: this.trackInfo.height,
            description: this.trackInfo.description,
            hardwareAcceleration: this.preferHardware ? 'prefer-hardware' : 'no-preference',
          })
        }
      } catch (err) {
        console.warn('[HardwareVideoDecoder] Reset error:', err)
      }
    }

    if (this.latestDecodedFrame) {
      this.latestDecodedFrame.close()
      this.latestDecodedFrame = null
    }

    return new Promise<VideoFrame | null>((resolve) => {
      this.pendingResolves.push(resolve)

      try {
        for (let i = 0; i < chunks.length; i++) {
          this.decoder!.decode(chunks[i])
        }

        this.decoder!.flush()
          .then(() => {
            const result = this.latestDecodedFrame
            this.latestDecodedFrame = null
            this.resolvePending(result)
          })
          .catch((err) => {
            console.warn('[HardwareVideoDecoder] Flush error:', err)
            this.resolvePending(null)
          })
      } catch (err) {
        console.error('[HardwareVideoDecoder] Decode call failed:', err)
        this.resolvePending(null)
      }
    })
  }

  close(): void {
    this.resolvePending(null)
    if (this.latestDecodedFrame) {
      this.latestDecodedFrame.close()
      this.latestDecodedFrame = null
    }
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        // ignore
      }
    }
    this.decoder = null
    this.isConfigured = false
  }

  destroy(): void {
    this.close()
  }
}
