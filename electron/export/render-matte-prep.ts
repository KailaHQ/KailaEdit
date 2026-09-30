import path from 'path'
import fs from 'fs'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import {
  autoMatteBakeOffset,
  autoMatteRangeCovers,
  autoMatteSourceRange,
  isAutoMatteBakeValid,
  autoMattePlaybackRate,
} from '../../core/src/auto-matte'
import { isCancelled, type RenderJob } from './render-job-types'

/**
 * Step 0 — make sure every clip that needs an auto matte (and a stroke derived from it)
 * actually has one on disk before the filtergraph is built.
 *
 * Without this, a clip whose matte was never baked in the editor exports with its
 * background still in place, and a stroke never reaches the file at all because
 * `strokeBakePath` would stay empty. Baking here is cheap when the editor already did
 * it: `ensureBake` hits the fingerprint cache and returns immediately.
 *
 * Mutates the clips in place. That is safe here: `params.clips` arrives freshly
 * deserialized from IPC for this one render call, so nothing else in the main process
 * holds a reference to these objects.
 */
export async function prepareExportMattes(
  job: RenderJob,
  clips: any[],
  device: 'auto' | 'gpu' | 'cpu' = 'auto',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const targets = clips.filter(
    c =>
      (c.type === 'video' || c.type === 'image') &&
      (c.autoMatte?.enabled || (c.customMatte?.enabled && c.customMatte.strokes?.length > 0)),
  )
  if (targets.length === 0) return { ok: true }

  const { matteService } = await import('../matte/matte-service')
  const { strokeBakeService } = await import('../matte/stroke-bake')
  const { customMatteBakeService } = await import('../matte/custom-matte-bake')

  // Reserve the first slice of the progress bar for preparation.
  const PREP_END_PERCENT = 5

  logger.info(`[RenderQueue:${job.id}] Step 0: preparing auto/custom matte for ${targets.length} clip(s)`)

  for (let i = 0; i < targets.length; i++) {
    if (isCancelled(job)) return { ok: false, error: 'Cancelled' }

    const clip = targets[i]
    const clipId = clip.id || `export-clip-${i}`
    const matteJobId = `render-${job.id}-matte-${i}`
    const clipStart = (i / targets.length) * PREP_END_PERCENT
    const clipSpan = PREP_END_PERCENT / targets.length

    const report = (percent: number) => {
      if (isCancelled(job)) {
        matteService.cancelJob(matteJobId)
        return
      }
      job.percent = Number((clipStart + (percent / 100) * clipSpan).toFixed(1))
      emitToRenderer('render:progress', {
        jobId: job.id,
        percent: job.percent,
        timeSeconds: 0,
      })
    }

    let activeMattePath: string | undefined
    let activeFingerprint: string | undefined
    let activeFrameCount: number | undefined
    let activeBakeSpeed = 1
    let activeRange: { sourceStart: number; sourceSpan: number } | undefined
    const clipRange = autoMatteSourceRange({
      trimStart: clip.trimStart,
      duration: clip.duration,
      speed: clip.speed ?? 1,
    })

    if (clip.autoMatte?.enabled) {
      const existing = clip.autoMatte.bake
      const reusable = isAutoMatteBakeValid(existing, {
        trimStart: clip.trimStart,
        duration: clip.duration,
        speed: clip.speed,
        reversed: clip.reversed,
        model: clip.autoMatte.model || 'rvm-mobilenetv3',
        quality: clip.autoMatte.quality || 'standard',
        assetKey: process.platform === 'win32' ? path.resolve(clip.path).toLowerCase() : path.resolve(clip.path),
      }) && existing?.status !== 'error' && fs.existsSync(existing.path)
      const matteRes = reusable ? {
        success: true,
        mattePath: existing.path,
        fingerprint: existing.fingerprint,
        frameCount: existing.frameCount,
        bake: existing,
        error: undefined,
      } : await matteService.ensureBake(
        {
          jobId: matteJobId,
          clipId,
          filePath: clip.path,
          trimStart: clip.trimStart,
          duration: clip.duration,
          speed: clip.speed ?? 1,
          reversed: Boolean(clip.reversed),
          model: clip.autoMatte?.model,
          quality: clip.autoMatte?.quality,
          device,
          still: clip.type === 'image',
        },
        report,
      )

      if (isCancelled(job)) return { ok: false, error: 'Cancelled' }

      if (!matteRes.success || !matteRes.mattePath) {
        return {
          ok: false,
          error: `Background removal failed for clip ${clipId}: ${matteRes.error ?? 'unknown error'}`,
        }
      }

      if (matteRes.bake?.status === 'partial' && matteRes.bake?.coverageActual) {
        if (!autoMatteRangeCovers(matteRes.bake.coverageActual, clipRange)) {
          return {
            ok: false,
            error: `Background removal coverage incomplete for clip ${clipId}: covered ${matteRes.bake.coverageActual.sourceSpan.toFixed(2)}s, needed ${clipRange.sourceSpan.toFixed(2)}s`,
          }
        }
      }

      activeMattePath = matteRes.mattePath
      activeFingerprint = matteRes.fingerprint ?? ''
      activeFrameCount = matteRes.frameCount
      activeBakeSpeed = matteRes.bake?.speed ?? 1
      activeRange = matteRes.bake
        ? { sourceStart: matteRes.bake.sourceStart, sourceSpan: matteRes.bake.sourceSpan }
        : clipRange
    }

    if (clip.customMatte?.enabled && clip.customMatte.strokes && clip.customMatte.strokes.length > 0) {
      const customRes = await customMatteBakeService.ensureBake({
        clipId,
        baseMattePath: activeMattePath,
        baseMatteFingerprint: activeFingerprint,
        filePath: clip.path,
        trimStart: clip.trimStart,
        duration: clip.duration,
        speed: clip.speed ?? 1,
        baseMatteOffset: autoMatteBakeOffset(
          activeRange ? { sourceStart: activeRange.sourceStart, speed: activeBakeSpeed } : undefined,
          clip.trimStart,
          clip.speed ?? 1,
        ),
        baseMattePlaybackRate: autoMattePlaybackRate({ speed: activeBakeSpeed }, clip.speed ?? 1),
        strokes: clip.customMatte.strokes,
        motion: clip.customMatte.motion,
        onProgress: report,
      })

      if (isCancelled(job)) return { ok: false, error: 'Cancelled' }

      if (!customRes.success || !customRes.mattePath) {
        return {
          ok: false,
          error: `Custom matte bake failed for clip ${clipId}: ${customRes.error ?? 'unknown error'}`,
        }
      }

      activeMattePath = customRes.mattePath
      activeFingerprint = customRes.fingerprint ?? ''
      activeFrameCount = customRes.frameCount ?? activeFrameCount
      activeRange = clipRange
      activeBakeSpeed = clip.speed ?? 1
    }

    if (activeMattePath) {
      clip.autoMatte = {
        ...(clip.autoMatte || { enabled: true }),
        enabled: true,
        bake: {
          path: activeMattePath,
          fingerprint: activeFingerprint ?? '',
          frameCount: activeFrameCount ?? 0,
          createdAt: Date.now(),
          sourceStart: (activeRange ?? clipRange).sourceStart,
          sourceSpan: (activeRange ?? clipRange).sourceSpan,
          speed: activeBakeSpeed,
          reversed: Boolean(clip.reversed),
          model: clip.autoMatte?.model || 'rvm-mobilenetv3',
          quality: clip.autoMatte?.quality || 'standard',
        },
      }
    }

    const stroke = clip.stroke
    if (activeMattePath && stroke?.enabled && stroke.style !== 'none' && stroke.width > 0) {
      const prevCleanup = job.cleanup
      job.cleanup = () => {
        strokeBakeService.cancel(clipId)
        if (prevCleanup) prevCleanup()
      }

      const strokeRes = await strokeBakeService.ensureBake({
        clipId,
        mattePath: activeMattePath,
        matteFingerprint: activeFingerprint ?? '',
        stroke,
        onProgress: report,
      })

      job.cleanup = prevCleanup

      if (isCancelled(job)) return { ok: false, error: 'Cancelled' }

      if (!strokeRes.success) {
        return {
          ok: false,
          error: `Stroke rendering failed for clip ${clipId}: ${strokeRes.error ?? 'unknown error'}`,
        }
      }
      clip.strokeBakePath = strokeRes.strokePath
    }
  }

  job.percent = PREP_END_PERCENT
  emitToRenderer('render:progress', { jobId: job.id, percent: PREP_END_PERCENT, timeSeconds: 0 })
  return { ok: true }
}
