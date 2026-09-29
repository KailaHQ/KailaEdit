import { useState, useEffect } from 'react'
import type { TimelineClip, Asset } from '@/types/project-model'

const clipThumbnailCache = new Map<string, string>()
const inFlightRequests = new Map<string, Promise<string | null>>()

/**
 * The picture for a clip box: the asset's own thumbnail, or — for a video trimmed past
 * its first frame — a frame from where the clip actually starts.
 *
 * The hooks run on every render, whatever the clip is. They used to sit behind early
 * returns for "not a video" and "starts at the beginning", so a clip crossing either line
 * — trimmed back to its first frame, or given new media by Replace clip — changed the
 * number of hooks between renders and React took the whole timeline down with it.
 */
export function useClipThumbnail(
  clip: TimelineClip,
  liveAsset: Asset | null | undefined,
): string | undefined {
  const fallback = liveAsset?.smallThumbnailPath || liveAsset?.path
  // Only a video trimmed past its first frame needs a frame of its own.
  const needsFrame = Boolean(liveAsset && clip.type === 'video' && clip.trimStart && clip.trimStart > 0.05)
  const roundedTrim = Math.round((clip.trimStart || 0) * 10) / 10
  const cacheKey = needsFrame && liveAsset ? `${liveAsset.path}:${roundedTrim}` : ''

  const [thumbPath, setThumbPath] = useState<string | undefined>(
    () => (cacheKey && clipThumbnailCache.get(cacheKey)) || liveAsset?.smallThumbnailPath,
  )

  useEffect(() => {
    if (!cacheKey || !liveAsset) return

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
  }, [cacheKey, liveAsset?.path, liveAsset?.smallThumbnailPath, clip.trimStart])

  return needsFrame ? thumbPath : fallback
}
