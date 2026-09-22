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
  private decodeGeneration = 0
  private targetTimestamp = 0
  private configuredConfig: VideoDecoderConfig | null = null

  /**
   * Rotation canvas used to blit decoded frames into the correct orientation
   * when the container carries a non-zero `tkhd` rotation.
   *
   * Created lazily in `rotateFrame` and sized once per `configure`.
   */
  private rotationCanvas: OffscreenCanvas | null = null

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
        codedWidth: trackInfo.codedWidth,
        codedHeight: trackInfo.codedHeight,
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
      codedWidth: trackInfo.codedWidth,
      codedHeight: trackInfo.codedHeight,
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
      this.configuredConfig = config
      this.isConfigured = true

      // Pre-create the rotation canvas when needed.
      this.rotationCanvas = new OffscreenCanvas(trackInfo.width, trackInfo.height)

      return true
    } catch (err) {
      console.error('[HardwareVideoDecoder] Failed to configure VideoDecoder:', err)
      return false
    }
  }

  /**
   * Rotates a decoded `VideoFrame` according to `trackInfo.rotation`.
   *
   * The decoder always outputs frames at the **coded** dimensions (e.g.
   * 1920×1080 landscape for a phone video). This method draws the frame onto
   * an `OffscreenCanvas` at the display dimensions (e.g. 1080×1920) with the
   * correct rotation applied, then wraps the result in a new `VideoFrame`.
   */
  private rotateFrame(frame: VideoFrame): VideoFrame {
    const rotation = this.trackInfo?.rotation ?? 0

    const canvas = this.rotationCanvas!
    const ctx = canvas.getContext('2d')!

    const displayW = this.trackInfo!.width
    const displayH = this.trackInfo!.height

    // Ensure canvas matches display size (should already be correct from configure)
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW
      canvas.height = displayH
    }

    ctx.clearRect(0, 0, displayW, displayH)
    ctx.save()

    // Move origin to centre, rotate, then draw the frame centred.
    ctx.translate(displayW / 2, displayH / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    // After rotation the frame's coded dimensions are centred at the origin.
    ctx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2)
    ctx.restore()

    const rotated = new VideoFrame(canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    })

    frame.close()
    return rotated
  }

  private handleDecodedFrame(frame: VideoFrame): void {
    // Earlier GOP frames are decode dependencies, not presentation candidates.
    // Copying each one to a full-size RGBA canvas dominates random-seek latency
    // and evicts useful target frames. Release them directly; retain target/lookahead.
    if (frame.timestamp < this.targetTimestamp - 1) {
      frame.close()
      return
    }
    // Detach from the decoder's finite output-surface pool before caching. Keeping
    // clones of a whole GOP can exhaust that pool and make flush() wait forever.
    const finalFrame = this.rotationCanvas ? this.rotateFrame(frame) : frame

    const timestampSec = finalFrame.timestamp / 1_000_000

    // Store in LRU frame cache so nearby frames are available for O(1) retrieval
    if (this.frameCache) {
      // Clone frame for cache if this is not the final frame, or store directly
      try {
        const cloned = finalFrame.clone()
        this.frameCache.set(timestampSec, cloned)
      } catch {
        // clone failed
      }
    }

    if (Math.abs(finalFrame.timestamp - this.targetTimestamp) <= 1) {
      this.latestDecodedFrame?.close()
      this.latestDecodedFrame = finalFrame
    } else {
      finalFrame.close()
    }
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
      const cached = this.frameCache.get(targetTimeSec, 0)
      if (cached) {
        try {
          return cached.clone()
        } catch {
          return null
        }
      }
    }

    // A completed flush accepts another keyframe directly. All-intra scrub
    // proxies can reuse the decoder without rebuilding its hardware session.
    const reuseSession = this.pendingResolves.length === 0 && chunks.length === 1 && chunks[0].type === 'key'
    const generation = ++this.decodeGeneration
    this.resolvePending(null)
    this.targetTimestamp = Math.round(targetTimeSec * 1_000_000)
    // 2. Reset decoder state to discard older in-flight frames if scrubbing fast
    if (this.decoder.state === 'configured' && !reuseSession) {
      try {
        this.decoder.reset()
        // Re-configure after reset — uses coded dimensions, not display.
        if (this.configuredConfig) {
          this.decoder.configure(this.configuredConfig)
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
            if (generation !== this.decodeGeneration) return
            const result = this.latestDecodedFrame
            this.latestDecodedFrame = null
            this.resolvePending(result)
          })
          .catch((err) => {
            if (generation !== this.decodeGeneration) return
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
    this.decodeGeneration++
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
    this.rotationCanvas = null
  }

  destroy(): void {
    this.close()
  }
}
