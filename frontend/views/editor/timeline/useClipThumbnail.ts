import { useState, useEffect } from 'react'
import type { TimelineClip, Asset } from '@/types/project-model'

const clipThumbnailCache = new Map<string, string>()
const inFlightRequests = new Map<string, Promise<string | null>>()

export function useClipThumbnail(
  clip: TimelineClip,
  liveAsset: Asset | null | undefined,
): string | undefined {
  if (!liveAsset || clip.type !== 'video') {
    return liveAsset?.smallThumbnailPath || liveAsset?.path
  }

  // If trimStart is at the very beginning (<= 0.05s), use asset's default smallThumbnailPath
  if (!clip.trimStart || clip.trimStart <= 0.05) {
    return liveAsset.smallThumbnailPath || liveAsset.path
  }

  const roundedTrim = Math.round(clip.trimStart * 10) / 10
  const cacheKey = `${liveAsset.path}:${roundedTrim}`

  const cached = clipThumbnailCache.get(cacheKey)
  const [thumbPath, setThumbPath] = useState<string | undefined>(cached || liveAsset.smallThumbnailPath)

  useEffect(() => {
    // If already in cache, use it immediately
    const existing = clipThumbnailCache.get(cacheKey)
    if (existing) {
      setThumbPath(existing)
      return
    }

    // Default to asset thumbnail while loading
    setThumbPath(liveAsset.smallThumbnailPath)

    let isCancelled = false

    const fetchFrame = async () => {
      let promise = inFlightRequests.get(cacheKey)
      if (!promise) {
        promise = (async () => {
          try {
            const res = await window.electronAPI?.extractVideoFrame({
              videoPath: liveAsset.path,
              seekTime: clip.trimStart,
              width: 120,
              quality: 4,
            })
            if (res?.path) {
              clipThumbnailCache.set(cacheKey, res.path)
              return res.path
            }
          } catch (err) {
            console.warn('[useClipThumbnail] Failed to extract clip frame:', err)
          } finally {
            inFlightRequests.delete(cacheKey)
          }
          return null
        })()
        inFlightRequests.set(cacheKey, promise)
      }

      const path = await promise
      if (!isCancelled && path) {
        setThumbPath(path)
      }
    }

    // Slight debounce so fast scrubbing/trimming doesn't fire redundant ffmpeg extractions
    const timer = setTimeout(fetchFrame, 100)

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [cacheKey, liveAsset.path, liveAsset.smallThumbnailPath, clip.trimStart])

  return thumbPath
}
