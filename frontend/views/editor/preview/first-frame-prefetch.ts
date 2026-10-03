import { clipAsPlayed } from '@core/stabilization'
import { getActiveTimelineFromEditorModel } from '@core/editor-selectors'
import type { Project, TimelineClip } from '../../../types/project-model'
import { getEditorModel } from '../editor-project-bridging'
import {
  EMPTY_TRANSITIONS,
  buildFrameRenderCache,
  deriveFrameRenderState,
  getClipTargetTime,
  resolveClipPathFromAssets,
} from './preview-frame-engine'
import { getFirstFrameSource } from './webcodecs/FirstFrameSource'

/** A frame nobody asked for is released after this long. */
const PREPARED_TTL_MS = 60_000

interface Prepared {
  frame: Promise<VideoFrame | null>
  timer: ReturnType<typeof setTimeout>
}

const prepared = new Map<string, Prepared>()

const keyOf = (path: string, clipId: string, atTime: number) => `${path}|${clipId}|${atTime}`

function release(key: string): void {
  const entry = prepared.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  prepared.delete(key)
  void entry.frame.then(frame => frame?.close())
}

/**
 * Starts decoding the frame a monitor will show for a clip at a time, ahead of the monitor.
 * Whoever shows it asks for it with `getPreparedFrame`.
 */
export function prepareFirstFrame(path: string, clip: TimelineClip, atTime: number): void {
  const key = keyOf(path, clip.id, atTime)
  if (!path || prepared.has(key)) return
  const source = getFirstFrameSource(path)
  const frame = source
    .open()
    .then(index => source.frameAt(getClipTargetTime(clip, index.duration, atTime)))
    .catch(() => null)
  prepared.set(key, { frame, timer: setTimeout(() => release(key), PREPARED_TTL_MS) })
}

/**
 * A copy of the prepared frame for a clip at a time (the caller closes it); undefined if
 * none was prepared. The original is kept until it expires, because the monitor can ask
 * twice — React mounts a component, tears it down and mounts it again in development.
 */
export function getPreparedFrame(path: string, clipId: string, atTime: number): Promise<VideoFrame | null> | undefined {
  const entry = prepared.get(keyOf(path, clipId, atTime))
  if (!entry) return undefined
  return entry.frame.then(frame => {
    try {
      return frame ? frame.clone() : null
    } catch {
      return null
    }
  })
}

export function clearPreparedFrames(): void {
  for (const key of [...prepared.keys()]) release(key)
}

/**
 * Prepares what the monitor will show when this project opens: the video clip in front at the
 * start of the timeline, resolved the way the monitor resolves it (stabilized file, proxy or
 * original). Called as the project is opened, so the decode overlaps the editor's first render.
 * A guess that proves wrong only costs one decoded frame.
 */
export function prepareProjectFirstFrame(project: Project | null, proxyEnabled: boolean): void {
  if (!project) return
  try {
    const model = getEditorModel(project)
    const timeline = getActiveTimelineFromEditorModel(model)
    if (!timeline) return
    const clips = timeline.clips.map(clip => clipAsPlayed(clip, model.assets))
    const cache = buildFrameRenderCache(clips, timeline.subtitles ?? [], timeline.transitions ?? EMPTY_TRANSITIONS)
    const state = deriveFrameRenderState(cache, timeline.tracks, 0)
    const active = state.activeVideoContributors.find(contributor => contributor.target === 'active')
    if (!active || active.clip.asset?.type !== 'video') return
    prepareFirstFrame(resolveClipPathFromAssets(model.assets, active.clip, proxyEnabled), active.clip, 0)
  } catch {
    // Preparing is only ever an optimisation.
  }
}
