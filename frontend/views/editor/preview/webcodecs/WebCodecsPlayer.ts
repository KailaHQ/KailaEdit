import { VideoDemuxer } from './VideoDemuxer'
import { HardwareVideoDecoder } from './HardwareVideoDecoder'
import { FrameCache } from './FrameCache'
import type { DemuxedVideoMetadata } from './types'

export class WebCodecsPlayer {
  private demuxer: VideoDemuxer = new VideoDemuxer()
  private frameCache: FrameCache = new FrameCache(60)
  private decoder: HardwareVideoDecoder
  private currentFrame: VideoFrame | null = null
  private metadata: DemuxedVideoMetadata | null = null
  private isLoaded = false
  private currentPath = ''

  constructor() {
    this.decoder = new HardwareVideoDecoder({
      frameCache: this.frameCache,
      preferHardware: true,
    })
  }

  async load(filePathOrUrl: string): Promise<boolean> {
    if (this.currentPath === filePathOrUrl && this.isLoaded) {
      return true
    }

    this.destroy()
    this.currentPath = filePathOrUrl

    try {
      this.metadata = await this.demuxer.demux(filePathOrUrl)
      if (!this.metadata || !this.metadata.trackInfo) {
        return false
      }

      const configured = await this.decoder.configure(this.metadata.trackInfo)
      this.isLoaded = configured
      return configured
    } catch (err) {
      console.warn('[WebCodecsPlayer] Failed to load video with WebCodecs:', err)
      this.isLoaded = false
      return false
    }
  }

  async seek(timestampSec: number): Promise<VideoFrame | null> {
    if (!this.isLoaded || !this.metadata) {
      return null
    }

    // 1. Check LRU Frame Cache first (0ms instantaneous lookup)
    const cached = this.frameCache.get(timestampSec)
    if (cached) {
      if (this.currentFrame && this.currentFrame !== cached) {
        // We do not close currentFrame if it's referenced in the cache
      }
      this.currentFrame = cached
      return cached
    }

    // 2. Fetch chunks from nearest keyframe
    const chunks = this.demuxer.getChunksForTimestamp(timestampSec)
    if (chunks.length === 0) {
      return null
    }

    // 3. Decode chunks via hardware
    const frame = await this.decoder.decodeChunks(chunks, timestampSec)
    if (frame) {
      this.currentFrame = frame
    }
    return frame
  }

  getCurrentFrame(): VideoFrame | null {
    return this.currentFrame
  }

  getMetadata(): DemuxedVideoMetadata | null {
    return this.metadata
  }

  isReady(): boolean {
    return this.isLoaded
  }

  destroy(): void {
    this.isLoaded = false
    this.currentPath = ''
    this.currentFrame = null
    this.decoder.close()
    this.frameCache.clear()
    this.metadata = null
  }
}
