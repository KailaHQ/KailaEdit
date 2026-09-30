import type { FfmpegProcessHandle } from './ffmpeg-utils'
import type { ExportMarkerParam } from './chapter-utils'

export type RenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Read the job's status without TypeScript's stale narrowing.
 *
 * `runJob` assigns `status = 'running'`, after which control-flow analysis
 * treats the property as that literal for the rest of the function — even
 * across `await`. But `cancelJob` mutates the same object from outside, so the
 * cancel checks really are reachable. Reading through a function parameter
 * gives the comparison the full union again.
 */
export function isCancelled(job: { status: RenderJobStatus }): boolean {
  const status: RenderJobStatus = job.status
  return status === 'cancelled'
}

export interface RenderJob {
  id: string
  status: RenderJobStatus
  percent: number
  outputPath?: string
  duration?: number
  error?: string
  stderr?: string
  activeHandle?: FfmpegProcessHandle | null
  cleanup?: () => void
  createdAt: number
  onFinishListeners?: Array<(job: RenderJob) => void>
}

export interface RenderStartParams {
  clips: any[]
  outputPath: string
  codec: string
  width: number
  height: number
  fps: number
  quality?: number
  background?: any
  letterbox?: { ratio: number; color: string; opacity: number }
  subtitles?: any[]
  transitions?: any[]
  hardwareAcceleration?: boolean
  /** Which processor runs background removal for clips that need a matte baked. */
  autoMatteDevice?: 'auto' | 'gpu' | 'cpu'
  markers?: ExportMarkerParam[]
  videoBitrate?: number
  audioBitrate?: number
}

export interface RenderPreviewParams {
  clips: any[]
  startTime?: number
  endTime?: number
  duration?: number
  resolution?: '480p' | '360p' | '720p'
  /** Timeline width / height. Omitted means 16:9. */
  aspectRatio?: number
  outputPath?: string
  fps?: number
  background?: any
  letterbox?: { ratio: number; color: string; opacity: number }
  subtitles?: any[]
  transitions?: any[]
}

/** Longest range one preview render will produce. */
export const PREVIEW_MAX_SECONDS = 60

export function sliceClipsForPreview(
  clips: any[],
  startTime: number,
  duration: number,
): any[] {
  const endTime = startTime + duration
  const sliced: any[] = []

  for (const clip of clips) {
    const clipStart = typeof clip.startTime === 'number' ? clip.startTime : (clip.timelineStart ?? 0)
    const clipDuration = typeof clip.duration === 'number' ? clip.duration : (clip.timelineEnd ? clip.timelineEnd - clipStart : 0)
    const clipEnd = clipStart + clipDuration

    if (clipEnd <= startTime || clipStart >= endTime) {
      continue
    }

    const overlapStart = Math.max(clipStart, startTime)
    const overlapEnd = Math.min(clipEnd, endTime)
    const trimmedDuration = overlapEnd - overlapStart

    if (trimmedDuration <= 0) continue

    const newStartTime = Math.max(0, overlapStart - startTime)
    const trimDelta = overlapStart - clipStart
    const originalTrimStart = typeof clip.trimStart === 'number' ? clip.trimStart : 0
    const newTrimStart = originalTrimStart + trimDelta

    const clipPath = clip.path || clip.asset?.path || ''

    sliced.push({
      ...clip,
      path: clipPath,
      startTime: newStartTime,
      duration: trimmedDuration,
      trimStart: newTrimStart,
      trimEnd: newTrimStart + trimmedDuration,
    })
  }

  return sliced
}
