import { useEffect, useMemo, useRef } from 'react'
import { findComplexSegments, computeSegmentContentHash } from '@core/render-cache'
import { getEffectiveTimelineDimensions } from '@core/video-resolution'
import { useEditorStore } from './editor-store'
import { selectActiveTimeline, selectAssets } from './editor-selectors'
import { useRenderCacheStore, type CachedSegmentInfo } from './render-cache-store'

/** How long the timeline must sit still before the cache starts rendering segments. */
const RENDER_CACHE_IDLE_MS = 2500

export function useRenderCache() {
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const activeTimelineRef = useRef(activeTimeline)
  activeTimelineRef.current = activeTimeline
  const assets = useEditorStore(selectAssets)
  // The same frame the monitor draws into. Without it the segment was rendered 16:9
  // whatever the project was, and a 9:16 timeline played back scrambled.
  const aspectRatio = useMemo(
    () => getEffectiveTimelineDimensions(activeTimeline, assets).aspectRatio,
    [activeTimeline, assets],
  )

  // 1. Listen for background render-cache status events from Electron
  useEffect(() => {
    if (!window.electronAPI?.on) return

    const unsubscribe = window.electronAPI.on('render-cache:status', (event) => {
      useRenderCacheStore.getState().updateSegment(event.hash, {
        ready: event.ready,
        cachePath: event.cachePath,
        rendering: false,
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // 2. Scan timeline for complex segments, check cache status, and trigger background render
  useEffect(() => {
    if (!activeTimeline || !window.electronAPI?.renderCacheCheck || !window.electronAPI?.renderCacheRequest) {
      useRenderCacheStore.getState().setSegments([])
      return
    }

    const complexSegments = findComplexSegments(activeTimeline)
    if (complexSegments.length === 0) {
      useRenderCacheStore.getState().setSegments([])
      return
    }

    const segmentsWithHash = complexSegments.map((seg) => {
      const hash = computeSegmentContentHash(seg, activeTimeline, '480p', aspectRatio)
      return {
        ...seg,
        hash,
      }
    })

    const hashes = segmentsWithHash.map((s) => s.hash)

    let cancelled = false

    // Wait for the user to actually stop before starting background work.
    //
    // A segment render is not cheap: it prepares mattes, can pull a stroke bake behind it,
    // and every frame of that runs on the main process's own thread — so while it runs the
    // main process answers no IPC and the whole app stutters. At 250 ms this fired between
    // keystrokes: the user dragged a clip, the timeline changed, renders started, and by
    // the time they finished their result was already stale. Waiting for a real pause
    // costs nothing — the cache is an optimisation, and nobody is watching a segment that
    // is still being edited.
    const timer = setTimeout(() => {
      window.electronAPI.renderCacheCheck({ hashes })
        .then((statusMap) => {
          if (cancelled) return

          const currentTimeline = activeTimelineRef.current
          if (!currentTimeline) return

          const newSegments: CachedSegmentInfo[] = segmentsWithHash.map((seg) => {
            const status = statusMap[seg.hash]
            return {
              id: seg.id,
              startTime: seg.startTime,
              endTime: seg.endTime,
              duration: seg.duration,
              hash: seg.hash,
              ready: status?.ready ?? false,
              rendering: false,
              cachePath: status?.path,
              reasons: seg.reasons,
            }
          })

          useRenderCacheStore.getState().setSegments(newSegments)

          // Request render for any complex segment not yet ready
          for (const seg of newSegments) {
            if (!seg.ready && !seg.rendering) {
              useRenderCacheStore.getState().updateSegment(seg.hash, { rendering: true })

              window.electronAPI.renderCacheRequest({
                hash: seg.hash,
                startTime: seg.startTime,
                duration: seg.duration,
                clips: currentTimeline.clips || [],
                transitions: currentTimeline.transitions || [],
                background: currentTimeline.background,
                resolution: '480p',
                aspectRatio,
              }).then((res) => {
                if (cancelled) return
                if (res.success && res.cachePath) {
                  useRenderCacheStore.getState().updateSegment(seg.hash, {
                    ready: true,
                    cachePath: res.cachePath,
                    rendering: false,
                  })
                } else {
                  useRenderCacheStore.getState().updateSegment(seg.hash, {
                    ready: false,
                    rendering: false,
                  })
                }
              }).catch(() => {
                if (cancelled) return
                useRenderCacheStore.getState().updateSegment(seg.hash, {
                  ready: false,
                  rendering: false,
                })
              })
            }
          }
        })
        .catch(() => {})
    }, RENDER_CACHE_IDLE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeTimeline, aspectRatio])
}
