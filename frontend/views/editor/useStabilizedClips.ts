import { useMemo, useRef } from 'react'
import type { Asset, TimelineClip } from '@core/project-model'
import { resolveStabilizedClip, stabilizationContextForClip } from '@core/stabilization'

interface CachedResolution {
  mediaDuration: number | undefined
  resolved: TimelineClip
}

/**
 * The clip list as the monitor should play it: every stabilized clip swapped onto its
 * baked file, trims shifted to match.
 *
 * Each result is kept per source clip object, so a clip the edit did not touch comes back
 * as the same object it was last time. The monitor keys pooled video elements and sync
 * state off clips; handing it a fresh copy of every stabilized clip on each edit elsewhere
 * would churn all of that for nothing.
 */
export function useStabilizedClips(clips: TimelineClip[], assets: Asset[]): TimelineClip[] {
  const cacheRef = useRef(new WeakMap<TimelineClip, CachedResolution>())
  return useMemo(() => {
    const cache = cacheRef.current
    let changed = false
    const out = clips.map(clip => {
      if (!clip.stabilization?.bake) return clip
      const ctx = stabilizationContextForClip(clip, assets)
      const hit = cache.get(clip)
      if (hit && hit.mediaDuration === ctx.mediaDuration) {
        if (hit.resolved !== clip) changed = true
        return hit.resolved
      }
      const resolved = resolveStabilizedClip(clip, ctx)
      cache.set(clip, { mediaDuration: ctx.mediaDuration, resolved })
      if (resolved !== clip) changed = true
      return resolved
    })
    return changed ? out : clips
  }, [clips, assets])
}
