import fs from 'fs'
import path from 'path'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntryQuietly } from '../storage/remove-entry'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import {
  autoMatteBakeKey,
  autoMatteSourceRange,
  computeAutoMatteFingerprint,
  snapAutoMatteRange,
} from '../../core/src/auto-matte'
import type { AutoMatteModel, AutoMatteQuality } from '../../core/src/project-model'
import { probeVideo } from '../media/probe'
import {
  findCoveringBake,
  normalizeAssetKey,
  STILL_BAKE_SPAN_SECONDS,
  type MatteBakeJobParams,
  type MatteJobStatus,
  type MatteBakeDescriptor,
  type ActiveBakeRecord,
} from './matte-cache-lookup'
import { executeMatteBakePipeline } from './matte-bake-pipeline'

export * from './matte-cache-lookup'

export class MatteService {
  private static instance: MatteService | null = null
  private jobs = new Map<string, ActiveBakeRecord>()
  private bakeChain: Promise<unknown> = Promise.resolve()

  static getInstance(): MatteService {
    if (!MatteService.instance) {
      MatteService.instance = new MatteService()
    }
    return MatteService.instance
  }

  getJobStatus(jobId: string): MatteJobStatus {
    const job = this.jobs.get(jobId)
    if (!job) {
      return { status: 'idle', percent: 0 }
    }
    return { ...job.status }
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false

    if (job.status.status === 'done' || job.status.status === 'cancelled') {
      return false
    }

    job.cancelled = true
    job.status = {
      status: 'cancelled',
      percent: 0,
      phase: 'cancelled',
    }

    if (job.decodeProcess) {
      try {
        job.decodeProcess.kill('SIGKILL')
      } catch {}
      job.decodeProcess = null
    }

    if (job.encodeProcess) {
      try {
        job.encodeProcess.kill('SIGKILL')
      } catch {}
      job.encodeProcess = null
    }

    if (job.workerHost) {
      try {
        job.workerHost.terminate()
      } catch {}
      job.workerHost = null
    }

    // Clean up partial file and its manifest safely
    if (job.partPath) {
      removeEntryQuietly(job.partPath)
      removeEntryQuietly(job.partPath.replace(/\.mp4$/, '.manifest.json'))
    }
    if (job.finalPath) {
      removeEntryQuietly(job.finalPath.replace(/\.mp4$/, '.manifest.json'))
    }

    emitToRenderer('matte:progress', {
      jobId,
      percent: 0,
      phase: 'cancelled',
    })

    logger.info(`[matte-service] Job ${jobId} cancelled and cleaned up`)
    return true
  }

  async startBake(params: MatteBakeJobParams): Promise<{
    started: boolean
    cached?: boolean
    path?: string
    fingerprint?: string
    frameCount?: number
    provider?: string
    error?: string
    bake?: MatteBakeDescriptor
  }> {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return { started: false, error: 'FFmpeg binary not found' }
    }

    if (!fs.existsSync(params.filePath)) {
      return { started: false, error: `Media file does not exist: ${params.filePath}` }
    }

    const model = (params.model as AutoMatteModel) || 'rvm-mobilenetv3'
    const quality = (params.quality as AutoMatteQuality) || 'standard'
    const speed = 1
    const reversed = Boolean(params.reversed)

    const assetKey = normalizeAssetKey(params.filePath)
    const needed = autoMatteSourceRange(params)
    const cacheDir = renderCacheManager.getCacheDir()

    const probe = await probeVideo(ffmpegPath, params.filePath)
    const fps = probe.fps
    const clipW = probe.width
    const clipH = probe.height

    const groupKey = autoMatteBakeKey({
      assetKey,
      speed,
      reversed,
      model,
      quality,
      frameSize: `${clipW}x${clipH}`,
    })

    const reusable = findCoveringBake(cacheDir, groupKey, needed, reversed)
    if (reusable) {
      renderCacheManager.touch(reusable.path)
      const frames = Math.max(1, Math.round((reusable.range.sourceSpan / speed) * fps))
      const descriptor: MatteBakeDescriptor = {
        path: reusable.path,
        fingerprint: reusable.fingerprint,
        frameCount: frames,
        sourceStart: reusable.range.sourceStart,
        sourceSpan: reusable.range.sourceSpan,
        speed,
        reversed,
        model,
        quality,
        assetKey,
      }

      logger.info(
        `[matte-service] Reusing bake ${reusable.fingerprint} for clip ${params.clipId}: ` +
          `covers [${reusable.range.sourceStart.toFixed(2)}s, ` +
          `${(reusable.range.sourceStart + reusable.range.sourceSpan).toFixed(2)}s] ` +
          `of the [${needed.sourceStart.toFixed(2)}s, ` +
          `${(needed.sourceStart + needed.sourceSpan).toFixed(2)}s] it needs`,
      )

      this.jobs.set(params.jobId, {
        jobId: params.jobId,
        clipId: params.clipId,
        fingerprint: reusable.fingerprint,
        decodeProcess: null,
        encodeProcess: null,
        workerHost: null,
        cancelled: false,
        partPath: path.join(cacheDir, `${reusable.fingerprint}.part.mp4`),
        finalPath: reusable.path,
        status: {
          status: 'done',
          percent: 100,
          phase: 'done',
          mattePath: reusable.path,
          fingerprint: reusable.fingerprint,
          frameCount: frames,
          bake: descriptor,
        },
        totalFrames: frames,
        currentFrame: frames,
      })

      emitToRenderer('matte:progress', {
        jobId: params.jobId,
        percent: 100,
        phase: 'done',
        frame: frames,
        totalFrames: frames,
      })

      return {
        started: true,
        cached: true,
        path: reusable.path,
        fingerprint: reusable.fingerprint,
        frameCount: frames,
        bake: descriptor,
      }
    }

    const bakeRange = params.still
      ? { sourceStart: 0, sourceSpan: STILL_BAKE_SPAN_SECONDS }
      : reversed
        ? needed
        : snapAutoMatteRange(needed, probe.duration)
    const fingerprint = computeAutoMatteFingerprint({
      assetKey,
      trimStart: params.trimStart,
      duration: params.duration,
      speed,
      reversed,
      model,
      quality,
      frameSize: `${clipW}x${clipH}`,
      sourceStart: bakeRange.sourceStart,
      sourceSpan: bakeRange.sourceSpan,
    })
    const finalPath = path.join(cacheDir, `${fingerprint}.mp4`)
    const partPath = path.join(cacheDir, `${fingerprint}.part.mp4`)
    const expectedFrames = params.still
      ? 1
      : Math.max(1, Math.round((bakeRange.sourceSpan / speed) * fps))
    const bakeDescriptor: MatteBakeDescriptor = {
      path: finalPath,
      fingerprint,
      frameCount: expectedFrames,
      sourceStart: bakeRange.sourceStart,
      sourceSpan: bakeRange.sourceSpan,
      speed,
      reversed,
      model,
      quality,
      assetKey,
    }

    removeEntryQuietly(partPath)

    const activeJob: ActiveBakeRecord = {
      jobId: params.jobId,
      clipId: params.clipId,
      fingerprint,
      decodeProcess: null,
      encodeProcess: null,
      workerHost: null,
      cancelled: false,
      partPath,
      finalPath,
      status: {
        status: 'running',
        percent: 0,
        phase: 'extracting',
      },
      totalFrames: expectedFrames,
      currentFrame: 0,
    }

    this.jobs.set(params.jobId, activeJob)

    const queueTask = async () => {
      if (activeJob.cancelled) {
        logger.info(`[matte-service] Job ${activeJob.jobId} was cancelled while queued; skipping bake`)
        return
      }

      const reusableNow = findCoveringBake(cacheDir, groupKey, needed, reversed)
      if (reusableNow) {
        logger.info(
          `[matte-service] Reusing newly completed bake ${reusableNow.fingerprint} for queued clip ${params.clipId}: ` +
            `covers [${reusableNow.range.sourceStart.toFixed(2)}s, ` +
            `${(reusableNow.range.sourceStart + reusableNow.range.sourceSpan).toFixed(2)}s]`,
        )
        renderCacheManager.touch(reusableNow.path)
        const frames = Math.max(1, Math.round((reusableNow.range.sourceSpan / speed) * fps))
        const descriptor: MatteBakeDescriptor = {
          path: reusableNow.path,
          fingerprint: reusableNow.fingerprint,
          frameCount: frames,
          sourceStart: reusableNow.range.sourceStart,
          sourceSpan: reusableNow.range.sourceSpan,
          speed,
          reversed,
          model,
          quality,
          assetKey,
        }

        activeJob.status = {
          status: 'done',
          percent: 100,
          phase: 'done',
          mattePath: reusableNow.path,
          fingerprint: reusableNow.fingerprint,
          frameCount: frames,
          bake: descriptor,
        }
        activeJob.finalPath = reusableNow.path
        activeJob.totalFrames = frames
        activeJob.currentFrame = frames
        activeJob.fingerprint = reusableNow.fingerprint

        emitToRenderer('matte:progress', {
          jobId: activeJob.jobId,
          percent: 100,
          phase: 'done',
          frame: frames,
          totalFrames: frames,
        })
        return
      }

      await this.executeBake(
        { ...params, speed },
        activeJob,
        ffmpegPath,
        clipW,
        clipH,
        fps,
        expectedFrames,
        bakeRange,
      )
    }

    const chained = this.bakeChain.then(queueTask, queueTask)
    this.bakeChain = chained.catch(() => undefined)
    chained.catch((err) => {
      logger.error(`[matte-service] Bake execution failed for ${params.jobId}: ${String(err)}`)
      if (!activeJob.cancelled) {
        activeJob.status = {
          status: 'error',
          percent: 0,
          phase: 'error',
          error: String(err),
        }
        emitToRenderer('matte:progress', {
          jobId: params.jobId,
          percent: 0,
          phase: 'error',
          error: String(err),
        })
        removeEntryQuietly(partPath)
      }
    })

    return { started: true, cached: false, fingerprint, frameCount: expectedFrames, bake: bakeDescriptor }
  }

  protected async executeBake(
    params: MatteBakeJobParams,
    activeJob: ActiveBakeRecord,
    ffmpegPath: string,
    clipW: number,
    clipH: number,
    fps: number,
    expectedFrames: number,
    bakeRange: { sourceStart: number; sourceSpan: number },
  ): Promise<void> {
    return executeMatteBakePipeline(
      params,
      activeJob,
      ffmpegPath,
      clipW,
      clipH,
      fps,
      expectedFrames,
      bakeRange,
    )
  }

  async ensureBake(
    params: MatteBakeJobParams,
    onProgress?: (percent: number, phase: string) => void,
  ): Promise<{
    success: boolean
    mattePath?: string
    fingerprint?: string
    frameCount?: number
    error?: string
    bake?: MatteBakeDescriptor
  }> {
    const startRes = await this.startBake(params)
    if (startRes.cached && startRes.path) {
      if (onProgress) onProgress(100, 'done')
      return {
        success: true,
        mattePath: startRes.path,
        fingerprint: startRes.fingerprint,
        frameCount: startRes.frameCount,
        bake: startRes.bake,
      }
    }
    if (!startRes.started) {
      return { success: false, error: startRes.error || 'Failed to start bake job' }
    }

    const jobId = params.jobId
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const job = this.jobs.get(jobId)
        if (!job) {
          clearInterval(checkInterval)
          resolve({ success: false, error: 'Bake job was removed' })
          return
        }

        if (onProgress) {
          onProgress(job.status.percent, job.status.phase || 'inferring')
        }

        if (job.status.status === 'done' && job.status.mattePath) {
          clearInterval(checkInterval)
          resolve({
            success: true,
            mattePath: job.status.mattePath,
            fingerprint: job.status.fingerprint,
            frameCount: job.status.frameCount,
            bake: job.status.bake,
          })
        } else if (job.status.status === 'error') {
          clearInterval(checkInterval)
          resolve({ success: false, error: job.status.error || 'Bake failed' })
        } else if (job.status.status === 'cancelled') {
          clearInterval(checkInterval)
          resolve({ success: false, error: 'Bake job was cancelled' })
        }
      }, 100)
    })
  }
}

export const matteService = MatteService.getInstance()
