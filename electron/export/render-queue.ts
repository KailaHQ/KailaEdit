import path from 'path'
import fs from 'fs'
import os from 'os'
import { getAllowedRoots } from '../config'
import { validatePath } from '../path-validation'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { previewFrameSize } from '../../core/src/render-cache'
import { findFfmpegPath } from './ffmpeg-utils'
import { getTimelineDuration } from './timeline'
import { resolveStickerPath } from './sticker-utils'
import { resolveSfxPath } from './sfx-utils'
import {
  estimateExportIntermediateSize,
  checkDiskSpaceForExport,
  formatBytes,
} from './export-handler'
import {
  isCancelled,
  type RenderJob,
  type RenderStartParams,
  type RenderPreviewParams,
  PREVIEW_MAX_SECONDS,
  sliceClipsForPreview,
} from './render-job-types'
import { executeRenderJob } from './render-executor'
import { prepareExportMattes } from './render-matte-prep'

export * from './render-job-types'

class RenderQueueManager {
  private jobs = new Map<string, RenderJob>()

  public getJob(jobId: string): RenderJob | undefined {
    return this.jobs.get(jobId)
  }

  public getActiveJobCount(): number {
    let count = 0
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'queued') count++
    }
    return count
  }

  private notifyFinish(job: RenderJob): void {
    if (job.onFinishListeners) {
      const listeners = [...job.onFinishListeners]
      job.onFinishListeners = []
      for (const listener of listeners) {
        try {
          listener(job)
        } catch (err) {
          logger.warn(`[RenderQueue] Finish listener threw: ${err}`)
        }
      }
    }
  }

  public async waitForJob(jobId: string, timeoutMs = 60000): Promise<RenderJob> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`Job "${jobId}" not found`)
    if (job.status === 'completed' || job.status === 'failed' || isCancelled(job)) {
      return job
    }

    return new Promise<RenderJob>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for render job "${jobId}" after ${timeoutMs}ms`))
      }, timeoutMs)

      if (!job.onFinishListeners) job.onFinishListeners = []
      job.onFinishListeners.push(finishedJob => {
        clearTimeout(timer)
        resolve(finishedJob)
      })
    })
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false

    if (job.status === 'running' || job.status === 'queued') {
      logger.info(`[RenderQueue] Cancelling job ${jobId}`)
      job.status = 'cancelled'
      job.error = 'Export cancelled'
      if (job.activeHandle) {
        job.activeHandle.kill()
      }
      if (job.cleanup) {
        job.cleanup()
      }
      this.notifyFinish(job)
      emitToRenderer('render:error', {
        jobId,
        error: 'Export cancelled',
      })
      return true
    }

    return false
  }

  public startPreviewJob(params: RenderPreviewParams): {
    success: true
    jobId: string
    outputPath: string
    duration: number
  } | {
    success: false
    error: string
  } {
    const startTime = Math.max(0, params.startTime ?? 0)
    const duration = params.duration ?? (params.endTime !== undefined ? Math.max(0.1, params.endTime - startTime) : 10)
    const previewDuration = Math.min(PREVIEW_MAX_SECONDS, Math.max(0.1, duration))
    if (duration > PREVIEW_MAX_SECONDS) {
      logger.warn(
        `[RenderQueue] Preview range ${duration.toFixed(2)}s exceeds the ${PREVIEW_MAX_SECONDS}s limit and was clamped to ${previewDuration.toFixed(2)}s`,
      )
    }

    const slicedClips = sliceClipsForPreview(params.clips || [], startTime, previewDuration)
    if (slicedClips.length === 0) {
      return {
        success: false,
        error: `No clips found in preview range [${startTime}s, ${(startTime + previewDuration).toFixed(2)}s]`,
      }
    }

    const res = previewFrameSize(params.resolution || '480p', params.aspectRatio)

    const previewDir = path.join(os.tmpdir(), 'komfyedit-previews')
    try {
      fs.mkdirSync(previewDir, { recursive: true })
    } catch {}

    const finalOutputPath = params.outputPath || path.join(
      previewDir,
      `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    )

    const jobResult = this.startJob({
      clips: slicedClips,
      outputPath: finalOutputPath,
      codec: 'libx264',
      width: res.width,
      height: res.height,
      fps: params.fps || 30,
      quality: 24,
      background: params.background,
      letterbox: params.letterbox,
      subtitles: params.subtitles,
      transitions: params.transitions,
    })

    if (!jobResult.success) {
      return jobResult
    }

    return {
      success: true,
      jobId: jobResult.jobId,
      outputPath: finalOutputPath,
      duration: previewDuration,
    }
  }

  public startJob(params: RenderStartParams): { success: true; jobId: string } | { success: false; error: string } {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return { success: false, error: 'FFmpeg not found' }

    const { clips: rawClips, outputPath, codec, width, height, fps } = params

    // Stickers (`stickers/fire.png`) and sound effects (`sfx/whoosh.wav`) are
    // stored as relative paths because they ship inside the app rather than
    // living in the user's project. Resolve them to absolute packaged/dev paths.
    const clips = rawClips.map(clip => {
      if (clip.path && !path.isAbsolute(clip.path)) {
        const norm = clip.path.replace(/\\/g, '/')
        if (norm.startsWith('sfx/') || clip.type === 'audio') {
          return { ...clip, path: resolveSfxPath(clip.path) }
        }
        return { ...clip, path: resolveStickerPath(clip.path) }
      }
      return clip
    })

    try {
      validatePath(outputPath, getAllowedRoots())
      for (const clip of clips) {
        const fp = clip.path
        if (fp) validatePath(fp, getAllowedRoots())
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }

    const isAudioOnly = codec === 'wav' || codec === 'mp3' || codec === 'aac'
    const visualClips = clips.filter(clip => clip.type === 'video' || clip.type === 'image')
    const textClips = clips.filter(clip => clip.type === 'text')
    const audioClips = clips.filter(clip => clip.type === 'audio' || (clip.type === 'video' && !clip.muted))

    if (!isAudioOnly && visualClips.length === 0 && textClips.length === 0) {
      return { success: false, error: 'No clips to export' }
    }
    if (isAudioOnly && audioClips.length === 0) {
      return { success: false, error: 'No audio clips to export' }
    }

    for (const clip of clips) {
      if (clip.path && clip.type !== 'text' && !fs.existsSync(clip.path)) {
        return { success: false, error: `Source file not found: ${path.basename(clip.path)}` }
      }
    }

    const timelineDuration = getTimelineDuration(clips)
    if (timelineDuration <= 0) return { success: false, error: 'Timeline is empty' }

    const tmpDir = os.tmpdir()
    const requiredBytes = estimateExportIntermediateSize({
      width,
      height,
      fps,
      durationSec: timelineDuration,
    })

    const diskCheck = checkDiskSpaceForExport(tmpDir, requiredBytes)
    if (!diskCheck.sufficient) {
      return {
        success: false,
        error: `Insufficient disk space in temp directory. Required: ${formatBytes(diskCheck.requiredBytes)} (~${Math.ceil(diskCheck.requiredBytes / (1024 * 1024))} MB), Available: ${formatBytes(diskCheck.availableBytes)} (~${Math.floor(diskCheck.availableBytes / (1024 * 1024))} MB)`,
      }
    }

    const jobId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const job: RenderJob = {
      id: jobId,
      status: 'queued',
      percent: 0,
      createdAt: Date.now(),
    }
    this.jobs.set(jobId, job)

    // Execute job asynchronously without blocking return
    executeRenderJob(
      job,
      params,
      ffmpegPath,
      timelineDuration,
      tmpDir,
      finishedJob => {
        this.notifyFinish(finishedJob)
      },
      (j, c, d) => this.prepareMattes(j, c, d),
    )

    return { success: true, jobId }
  }

  private prepareMattes(
    job: RenderJob,
    clips: any[],
    device: 'auto' | 'gpu' | 'cpu' = 'auto',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return prepareExportMattes(job, clips, device)
  }
}

export const renderQueue = new RenderQueueManager()
