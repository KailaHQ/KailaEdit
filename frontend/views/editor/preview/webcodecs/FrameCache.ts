/**
 * LRU In-Memory Frame Cache for WebCodecs VideoFrame objects.
 *
 * VideoFrames reside on the GPU (VRAM). Keeping an LRU pool of 30-60 frames
 * provides instant O(1) scrubbing when dragging across a small time range
 * (e.g. razor cuts, trim adjustments).
 *
 * CRITICAL: Whenever a frame is evicted or cleared, frame.close() must be called
 * to release GPU texture memory immediately and avoid memory leaks.
 */

export class FrameCache {
  private cache = new Map<number, VideoFrame>()
  private maxFrames: number

  constructor(maxFrames = 45) {
    this.maxFrames = maxFrames
  }

  private timeToKey(seconds: number): number {
    return Math.round(seconds * 1000)
  }

  get(seconds: number, toleranceSeconds = 0.015): VideoFrame | null {
    const targetKey = this.timeToKey(seconds)
    if (this.cache.has(targetKey)) {
      const frame = this.cache.get(targetKey)!
      // Refresh LRU order (re-insert)
      this.cache.delete(targetKey)
      this.cache.set(targetKey, frame)
      return frame
    }

    // Check with tolerance
    const toleranceMs = toleranceSeconds * 1000
    for (const [key, frame] of this.cache.entries()) {
      if (Math.abs(key - targetKey) <= toleranceMs) {
        this.cache.delete(key)
        this.cache.set(key, frame)
        return frame
      }
    }

    return null
  }

  set(seconds: number, frame: VideoFrame): void {
    const key = this.timeToKey(seconds)

    if (this.cache.has(key)) {
      const old = this.cache.get(key)!
      if (old !== frame) {
        old.close()
      }
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxFrames) {
      // Evict oldest entry (first item in Map)
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        const oldestFrame = this.cache.get(oldestKey)
        oldestFrame?.close()
        this.cache.delete(oldestKey)
      }
    }

    // Clone if needed or store directly (caller passes ownership)
    this.cache.set(key, frame)
  }

  has(seconds: number, toleranceSeconds = 0.015): boolean {
    const targetKey = this.timeToKey(seconds)
    if (this.cache.has(targetKey)) return true

    const toleranceMs = toleranceSeconds * 1000
    for (const key of this.cache.keys()) {
      if (Math.abs(key - targetKey) <= toleranceMs) return true
    }
    return false
  }

  clear(): void {
    for (const frame of this.cache.values()) {
      try {
        frame.close()
      } catch {
        // already closed
      }
    }
    this.cache.clear()
  }

  destroy(): void {
    this.clear()
  }

  get size(): number {
    return this.cache.size
  }
}
