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
  private pinnedKeys = new Set<number>()
  private maxFrames: number
  private readonly maxBytes = 96 * 1024 * 1024

  private get bytes(): number {
    let total = 0
    for (const frame of this.cache.values()) total += frame.displayWidth * frame.displayHeight * 4
    return total
  }

  constructor(maxFrames = 45) {
    this.maxFrames = maxFrames
  }

  private timeToKey(seconds: number): number {
    return Math.round(seconds * 1000)
  }

  pin(seconds: number): void {
    this.pinnedKeys.add(this.timeToKey(seconds))
  }

  unpin(seconds: number): void {
    this.pinnedKeys.delete(this.timeToKey(seconds))
  }

  isPinned(seconds: number): boolean {
    return this.pinnedKeys.has(this.timeToKey(seconds))
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
      if (old !== frame && !this.pinnedKeys.has(key)) {
        old.close()
      }
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxFrames) {
      // Evict oldest unpinned entry (first unpinned item in Map)
      let evictedKey: number | undefined
      for (const candidateKey of this.cache.keys()) {
        if (!this.pinnedKeys.has(candidateKey) && candidateKey !== key) {
          evictedKey = candidateKey
          break
        }
      }
      if (evictedKey !== undefined) {
        const oldestFrame = this.cache.get(evictedKey)
        oldestFrame?.close()
        this.cache.delete(evictedKey)
      }
    }

    // Clone if needed or store directly (caller passes ownership)
    this.cache.set(key, frame)
    while (this.cache.size > this.maxFrames || this.bytes > this.maxBytes) {
      const victim = [...this.cache.keys()].find(candidate => !this.pinnedKeys.has(candidate))
      if (victim === undefined) break
      this.cache.get(victim)?.close()
      this.cache.delete(victim)
    }
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

  clear(forceAll = false): void {
    for (const [key, frame] of [...this.cache.entries()]) {
      if (!forceAll && this.pinnedKeys.has(key)) {
        continue
      }
      try {
        frame.close()
      } catch {
        // already closed
      }
      this.cache.delete(key)
    }
    if (forceAll) {
      this.pinnedKeys.clear()
    }
  }

  destroy(): void {
    this.clear(true)
  }

  get size(): number {
    return this.cache.size
  }
}
