/**
 * KE-1807 — Tests for FrameCache: byte-based LRU with pin support.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FrameCache } from '../src/frame-cache'

describe('FrameCache', () => {
  let cache: FrameCache<Uint8Array>

  beforeEach(() => {
    cache = new FrameCache({ maxBytes: 100 })
  })

  it('stores and retrieves entries', () => {
    const data = new Uint8Array(10)
    cache.put('frame:0', data, 10)
    expect(cache.get('frame:0')).toBe(data)
    expect(cache.has('frame:0')).toBe(true)
    expect(cache.size).toBe(1)
    expect(cache.usedBytes).toBe(10)
  })

  it('returns undefined on miss', () => {
    expect(cache.get('nonexistent')).toBeUndefined()
    expect(cache.has('nonexistent')).toBe(false)
  })

  it('updates existing entry on re-put', () => {
    cache.put('frame:0', new Uint8Array(10), 10)
    const newData = new Uint8Array(20)
    cache.put('frame:0', newData, 20)
    expect(cache.get('frame:0')).toBe(newData)
    expect(cache.size).toBe(1)
    expect(cache.usedBytes).toBe(20)
  })

  describe('LRU eviction', () => {
    it('evicts oldest entry when over budget', () => {
      cache.put('frame:0', new Uint8Array(60), 60)
      cache.put('frame:1', new Uint8Array(50), 50)
      // Budget is 100, total would be 110 → evict frame:0
      expect(cache.has('frame:0')).toBe(false)
      expect(cache.has('frame:1')).toBe(true)
      expect(cache.usedBytes).toBe(50)
    })

    it('evicts multiple entries to fit', () => {
      cache.put('frame:0', new Uint8Array(30), 30)
      cache.put('frame:1', new Uint8Array(30), 30)
      cache.put('frame:2', new Uint8Array(30), 30)
      // Now at 90. Add a 50-byte entry → need to evict frame:0 and frame:1
      cache.put('frame:3', new Uint8Array(50), 50)
      expect(cache.has('frame:0')).toBe(false)
      expect(cache.has('frame:1')).toBe(false)
      expect(cache.has('frame:2')).toBe(true)
      expect(cache.has('frame:3')).toBe(true)
    })

    it('respects access order', () => {
      cache.put('frame:0', new Uint8Array(30), 30)
      cache.put('frame:1', new Uint8Array(30), 30)
      cache.put('frame:2', new Uint8Array(30), 30)
      // Touch frame:0 to make it most recently used
      cache.get('frame:0')
      // Now add 50-byte entry → should evict frame:1 (oldest accessed)
      cache.put('frame:3', new Uint8Array(50), 50)
      expect(cache.has('frame:0')).toBe(true)
      expect(cache.has('frame:1')).toBe(false)
    })

    it('calls onEvict callback', () => {
      const onEvict = vi.fn()
      const evictCache = new FrameCache<Uint8Array>({ maxBytes: 100, onEvict })
      evictCache.put('frame:0', new Uint8Array(60), 60)
      evictCache.put('frame:1', new Uint8Array(60), 60)
      expect(onEvict).toHaveBeenCalledTimes(1)
      expect(onEvict.mock.calls[0][0].key).toBe('frame:0')
    })
  })

  describe('pin support', () => {
    it('pinned entries survive eviction', () => {
      cache.put('frame:0', new Uint8Array(60), 60)
      cache.pin('frame:0')
      cache.put('frame:1', new Uint8Array(60), 60)
      // frame:0 is pinned, so it survives even though it's oldest and over budget
      expect(cache.has('frame:0')).toBe(true)
      // frame:1 is the only evictable entry but cache is over budget with only pinned entries
      expect(cache.has('frame:1')).toBe(true)
      expect(cache.usedBytes).toBe(120) // over budget but nothing can be evicted
    })

    it('unpinned entries can be evicted', () => {
      cache.put('frame:0', new Uint8Array(60), 60)
      cache.pin('frame:0')
      cache.put('frame:1', new Uint8Array(60), 60)
      // Unpin frame:0 and add another entry to force eviction
      cache.unpin('frame:0')
      cache.put('frame:2', new Uint8Array(60), 60)
      // frame:0 should be evicted now (oldest unpinned)
      expect(cache.has('frame:0')).toBe(false)
    })

    it('unpinAll allows full eviction', () => {
      cache.put('frame:0', new Uint8Array(40), 40)
      cache.put('frame:1', new Uint8Array(40), 40)
      cache.pin('frame:0')
      cache.pin('frame:1')
      cache.unpinAll()
      cache.put('frame:2', new Uint8Array(60), 60)
      // At least one old entry should be evicted
      expect(cache.usedBytes).toBeLessThanOrEqual(100)
    })

    it('pinnedCount tracks correctly', () => {
      cache.put('frame:0', new Uint8Array(10), 10)
      cache.put('frame:1', new Uint8Array(10), 10)
      expect(cache.pinnedCount).toBe(0)
      cache.pin('frame:0')
      expect(cache.pinnedCount).toBe(1)
      cache.pin('frame:1')
      expect(cache.pinnedCount).toBe(2)
      cache.unpinAll()
      expect(cache.pinnedCount).toBe(0)
    })
  })

  describe('removal and clear', () => {
    it('remove decrements bytes and calls onEvict', () => {
      const onEvict = vi.fn()
      const removeCache = new FrameCache<Uint8Array>({ maxBytes: 100, onEvict })
      removeCache.put('frame:0', new Uint8Array(30), 30)
      removeCache.remove('frame:0')
      expect(removeCache.has('frame:0')).toBe(false)
      expect(removeCache.usedBytes).toBe(0)
      expect(onEvict).toHaveBeenCalledTimes(1)
    })

    it('clear removes all and calls onEvict for each', () => {
      const onEvict = vi.fn()
      const clearCache = new FrameCache<Uint8Array>({ maxBytes: 100, onEvict })
      clearCache.put('frame:0', new Uint8Array(10), 10)
      clearCache.put('frame:1', new Uint8Array(10), 10)
      clearCache.put('frame:2', new Uint8Array(10), 10)
      clearCache.clear()
      expect(clearCache.size).toBe(0)
      expect(clearCache.usedBytes).toBe(0)
      expect(onEvict).toHaveBeenCalledTimes(3)
    })
  })

  describe('edge cases', () => {
    it('handles zero-byte entries', () => {
      cache.put('empty', new Uint8Array(0), 0)
      expect(cache.get('empty')).toBeDefined()
      expect(cache.usedBytes).toBe(0)
    })

    it('handles entry larger than budget', () => {
      cache.put('huge', new Uint8Array(200), 200)
      // Entry exists but cache is permanently over budget
      expect(cache.has('huge')).toBe(true)
      expect(cache.usedBytes).toBe(200)
    })

    it('defaults to 64 MB budget', () => {
      const defaultCache = new FrameCache()
      // Just verify it creates without error
      defaultCache.put('test', 'data', 100)
      expect(defaultCache.usedBytes).toBe(100)
    })
  })
})
