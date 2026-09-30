import { useEffect, useRef } from 'react'
import type { TimelineClip } from '@core/project-model'
import { setCustomMatteMotion } from '@core/editor-actions'
import { selectClips } from '@core/editor-selectors'
import { motionCovers } from '@core/matte-motion'
import { useEditorStore, useEditorStoreApi } from '../views/editor/editor-store'

/*
 * Keeps every video clip with custom-matte strokes supplied with the motion of its picture.
 *
 * A stroke is painted on one frame; on a shot where the camera pans or zooms the picture then
 * slides out from under it while the clip plays. The motion, tracked once in the main process,
 * is what lets the matte follow. Clips that already have motion covering what they show are
 * left alone; a clip trimmed past its motion gets it tracked again.
 */

/** Source seconds a clip shows, from its trim. */
function sourceSpanOf(clip: TimelineClip): { from: number; to: number } {
  const from = Math.max(0, clip.trimStart || 0)
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  return { from, to: from + Math.max(0.1, clip.duration || 0) * speed }
}

function needsMotion(clip: TimelineClip): boolean {
  const matte = clip.customMatte
  if (clip.type !== 'video' || !matte?.enabled || !matte.strokes?.length) return false
  if (!clip.asset?.path) return false
  const { from, to } = sourceSpanOf(clip)
  return !motionCovers(matte.motion, from, to)
}

/** Requests in flight, and clips that failed for a given range (not retried until the range changes). */
const inFlight = new Set<string>()
const failed = new Set<string>()

export function useMatteMotionKeeper(): void {
  const clips = useEditorStore(selectClips)
  const store = useEditorStoreApi()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const track = window.electronAPI?.trackMatteMotion
    if (!track) return
    for (const clip of clips) {
      if (!needsMotion(clip)) continue
      const path = clip.asset!.path
      const { from, to } = sourceSpanOf(clip)
      const key = `${clip.id}:${path}:${from.toFixed(2)}:${to.toFixed(2)}`
      if (inFlight.has(key) || failed.has(key)) continue
      inFlight.add(key)
      track({ filePath: path, startTime: from, duration: to - from })
        .then(motion => {
          if (!motion) { failed.add(key); return }
          store.getState().setStateWithoutHistory(prev => setCustomMatteMotion(prev, clip.id, motion))
        })
        .catch(err => {
          failed.add(key)
          console.warn('[matte-motion] Could not follow the camera:', err)
        })
        .finally(() => { inFlight.delete(key) })
    }
  }, [clips, store])
}
