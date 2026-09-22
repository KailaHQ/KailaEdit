/**
 * KE-1807 — FrameCache: byte-based LRU cache for decoded video frames.
 *
 * The preview renderer decodes matte and source frames asynchronously. Without
 * a cache, each scrub position triggers a full decode. This cache holds decoded
 * frames (alpha masks, typically) with a byte-based budget and LRU eviction.
 *
 * Design constraints:
 * - Budget is in bytes, not frame count (4K alpha = 8 MB, 720p = 1 MB).
 * - Pinned entries survive eviction (the currently displayed frame is pinned).
 * - Eviction never removes pinned entries even if over budget.
 * - Lives in core/ for testability without browser APIs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedFrame<T = unknown> {
  /** Unique cache key (e.g. `${clipId}:${frameId}` or `bake:${ordinal}`). */
  key: string
  /** The frame payload (e.g. alpha mask Uint8Array, VideoFrame handle). */
  data: T
  /** Size of this entry in bytes. */
  sizeBytes: number
  /** Last access timestamp (monotonic). */
  lastAccessedAt: number
  /** Pinned entries are immune to eviction. */
  pinned: boolean
}

export interface FrameCacheOptions {
  /** Maximum cache size in bytes. Default: 64 MB. */
  maxBytes?: number
  /** Called when an entry is evicted, so the caller can release GPU resources. */
  onEvict?: (entry: CachedFrame) => void
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024 // 64 MB

export class FrameCache<T = unknown> {
  private entries = new Map<string, CachedFrame<T>>()
  private currentBytes = 0
  private readonly maxBytes: number
  private readonly onEvict?: (entry: CachedFrame<T>) => void
  private accessCounter = 0

  constructor(options?: FrameCacheOptions) {
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES
    this.onEvict = options?.onEvict as ((entry: CachedFrame<T>) => void) | undefined
  }

  /** Store a frame in the cache. Evicts LRU entries if over budget. */
  put(key: string, data: T, sizeBytes: number): void {
    // If key exists, remove old entry first
    const existing = this.entries.get(key)
    if (existing) {
      this.currentBytes -= existing.sizeBytes
      this.entries.delete(key)
    }

    const entry: CachedFrame<T> = {
      key,
      data,
      sizeBytes,
      lastAccessedAt: ++this.accessCounter,
      pinned: false,
    }

    this.entries.set(key, entry)
    this.currentBytes += sizeBytes

    // Evict until under budget (never evict the entry we just inserted)
    this.evict(key)
  }

  /** Get a frame from the cache. Returns undefined on miss. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    entry.lastAccessedAt = ++this.accessCounter
    return entry.data
  }

  /** Check if a key exists without updating access time. */
  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** Pin an entry (immune to eviction). */
  pin(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.pinned = true
  }

  /** Unpin an entry (can be evicted again). */
  unpin(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.pinned = false
  }

  /** Unpin all entries. Call before switching clips/generation. */
  unpinAll(): void {
    for (const entry of this.entries.values()) {
      entry.pinned = false
    }
  }

  /** Remove a specific entry. */
  remove(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      this.currentBytes -= entry.sizeBytes
      this.entries.delete(key)
      this.onEvict?.(entry)
    }
  }

  /** Clear all entries. */
  clear(): void {
    for (const entry of this.entries.values()) {
      this.onEvict?.(entry)
    }
    this.entries.clear()
    this.currentBytes = 0
  }

  /** Current cache size in bytes. */
  get usedBytes(): number {
    return this.currentBytes
  }

  /** Number of entries. */
  get size(): number {
    return this.entries.size
  }

  /** Number of pinned entries. */
  get pinnedCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.pinned) count++
    }
    return count
  }

  /** Evict LRU unpinned entries until under budget. */
  private evict(protectedKey?: string): void {
    while (this.currentBytes > this.maxBytes) {
      // Find the oldest unpinned entry (excluding protected key)
      let oldest: CachedFrame<T> | null = null
      for (const entry of this.entries.values()) {
        if (entry.pinned) continue
        if (entry.key === protectedKey) continue
        if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
          oldest = entry
        }
      }

      if (!oldest) {
        // All remaining entries are pinned or protected — over budget but can't evict
        break
      }

      this.currentBytes -= oldest.sizeBytes
      this.entries.delete(oldest.key)
      this.onEvict?.(oldest)
    }
  }
}
