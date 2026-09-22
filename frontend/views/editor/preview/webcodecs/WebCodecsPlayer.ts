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
  private generation = 0

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
    const generation = this.generation
    this.currentPath = filePathOrUrl

    try {
      const demuxer = new VideoDemuxer()
      const metadata = await demuxer.demux(filePathOrUrl)
      if (generation !== this.generation) return false
      this.demuxer = demuxer
      this.metadata = metadata
      if (!this.metadata || !this.metadata.trackInfo) {
        return false
      }

      const configured = await this.decoder.configure(this.metadata.trackInfo)
      if (generation !== this.generation) return false
      this.isLoaded = configured
      return configured
    } catch (err) {
      console.warn('[WebCodecsPlayer] Failed to load video with WebCodecs:', err)
      this.isLoaded = false
      return false
    }
  }

  async seek(timestampSec: number, independentLookahead = 0): Promise<VideoFrame | null> {
    if (!this.isLoaded || !this.metadata) {
      return null
    }

    // 1. Check LRU Frame Cache first (0ms instantaneous lookup)
    const sample = this.demuxer.getSampleForTimestamp(timestampSec)
    if (!sample) return null
    const generation = this.generation
    const cached = this.frameCache.get(sample.pts, 0)
    if (cached) {
      this.currentFrame?.close()
      this.currentFrame = cached.clone()
      return this.currentFrame
    }

    // 2. Fetch chunks from nearest keyframe
    const chunks = this.demuxer.getChunksForTimestamp(timestampSec, independentLookahead)
    if (chunks.length === 0) {
      return null
    }

    // 3. Decode chunks via hardware
    const frame = await this.decoder.decodeChunks(chunks, sample.pts)
    if (generation !== this.generation) {
      frame?.close()
      return null
    }
    if (frame) {
      this.currentFrame?.close()
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

  getSampleForTime(time: number) {
    return this.demuxer.getSampleForTimestamp(time)
  }

  pin(timestampSec: number): void {
    this.frameCache.pin(timestampSec)
  }

  unpin(timestampSec: number): void {
    this.frameCache.unpin(timestampSec)
  }

  isReady(): boolean {
    return this.isLoaded
  }

  destroy(): void {
    this.generation++
    this.isLoaded = false
    this.currentPath = ''
    this.currentFrame?.close()
    this.currentFrame = null
    this.decoder.close()
    this.frameCache.destroy()
    this.metadata = null
  }
}
