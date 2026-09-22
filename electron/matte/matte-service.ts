import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { createRequire } from 'module'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntryQuietly } from '../storage/remove-entry'
import { safeRename } from '../storage/safe-rename'
import { quietChildStdio } from '../process/quiet-child-stdio'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { onnxSessionManager, getProviderChain, resolveModelPath } from './onnx-session'
import { MatteWorkerHost } from './matte-worker-host'
import {
  autoMatteBakeKey,
  autoMatteRangeCovers,
  autoMatteSourceRange,
  computeAutoMatteFingerprint,
  downsampleRatioForInferenceSize,
  parseAutoMatteFingerprint,
  snapAutoMatteRange,
  type AutoMatteSourceRange,
} from '../../core/src/auto-matte'
import {
  BAKE_MANIFEST_VERSION,
  hasBakeManifestV2,
  validateBakeManifestV2,
  type BakeManifestV2,
  type BakeFrameMapEntry,
} from '../../core/src/source-frame-index'
import type { AutoMatteModel, AutoMatteQuality, AutoMatteDevice } from '../../core/src/project-model'
import { probeVideo } from '../media/probe'

const require = createRequire(import.meta.url)

export interface MatteBakeJobParams {
  jobId: string
  clipId: string
  filePath: string
  trimStart: number
  duration: number
  speed?: number
  reversed?: boolean
  model?: AutoMatteModel | string
  quality?: AutoMatteQuality | string
  /** Which processor to run the model on. Machine preference, not part of the fingerprint. */
  device?: AutoMatteDevice
  /** The media is a still. One frame to matte, and it never goes out of date. */
  still?: boolean
}

export interface MatteJobStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  percent: number
  phase?: 'extracting' | 'inferring' | 'encoding' | 'done' | 'error' | 'cancelled'
  mattePath?: string
  fingerprint?: string
  frameCount?: number
  error?: string
  /** What the produced file covers and how — mirrors AutoMatteBake. */
  bake?: MatteBakeDescriptor
}

/** Everything a consumer needs to place a baked matte against a clip. */
export interface MatteBakeDescriptor {
  path: string
  fingerprint: string
  frameCount: number
  sourceStart: number
  sourceSpan: number
  speed: number
  reversed: boolean
  model: string
  quality: string
  assetKey: string
  manifestPath?: string
  status?: 'complete' | 'partial' | 'error'
  coverageActual?: {
    sourceStart: number
    sourceSpan: number
  }
}

interface ActiveBakeRecord {
  jobId: string
  clipId: string
  fingerprint: string
  decodeProcess: ChildProcess | null
  encodeProcess: ChildProcess | null
  workerHost: MatteWorkerHost | null
  cancelled: boolean
  partPath: string
  finalPath: string
  status: MatteJobStatus
  totalFrames: number
  currentFrame: number
}



/**
 * Largest frame fed to the matting model.
 *
 * The frame goes in at its own size up to this cap, and is NOT shrunk first. That matters
 * because of how the model is built: `downsample_ratio` already shrinks the segmentation
 * stage internally (see `downsampleRatioForInferenceSize`), while the refiner that
 * recovers hair and soft edges works at whatever resolution it was handed. RVM's own
 * guidance is written for full-resolution input — its table maps 1920x1080 and 3840x2160
 * straight to a ratio.
 *
 * Shrinking to 960 first meant the refiner never saw the detail that was in the clip, and
 * the matte was then scaled back up, which softens and haloes every edge. Feeding the
 * clip's own resolution is what closes the gap on hair.
 *
 * The cap exists only so 4K does not run unbounded; the segmentation stage costs the same
 * either way, so the extra time is spent entirely on edge quality.
/**
 * Maximum dimension fed to the matting model, per quality level:
 * - draft: 960 (fastest inference, good for quick review)
 * - standard: 1280 (balanced speed and fidelity, ~20ms/frame)
 * - high: 1920 (maximum hair and edge detail, feeds full 1080p/4K scaled down to 1080p)
 *
 * The frame goes in at its own size up to this cap, and is NOT shrunk first. That matters
 * because of how the model is built: `downsample_ratio` already shrinks the segmentation
 * stage internally (see `downsampleRatioForInferenceSize`), while the refiner that
 * recovers hair and soft edges works at whatever resolution it was handed. RVM's own
 * guidance is written for full-resolution input — its table maps 1920x1080 and 3840x2160
 * straight to a ratio.
 *
 * Shrinking to 960 first meant the refiner never saw the detail that was in the clip, and
 * the matte was then scaled back up, which softens and haloes every edge. Feeding the
 * clip's own resolution is what closes the gap on hair.
 *
 * The cap exists only so 4K does not run unbounded; the segmentation stage costs the same
 * either way, so the extra time is spent entirely on edge quality.
 */
export const MATTE_INFER_MAX_DIMS: Record<AutoMatteQuality, number> = {
  draft: 960,
  standard: 1280,
  high: 1920,
}

export function getMaxDimForQuality(quality?: AutoMatteQuality | string): number {
  if (quality === 'draft') return MATTE_INFER_MAX_DIMS.draft
  if (quality === 'high') return MATTE_INFER_MAX_DIMS.high
  return MATTE_INFER_MAX_DIMS.standard // 1280
}

/**
 * Passes over the opening frame before the first matte is written, to let the model's
 * recurrent state settle. Discarded output — see the note where it is used.
 */
const MATTE_WARMUP_FRAMES = 10



export function getInferDimensions(
  srcW: number,
  srcH: number,
  quality?: AutoMatteQuality | string,
): { inferW: number; inferH: number; downsampleRatio: number } {
  const maxDim = getMaxDimForQuality(quality)

  const aspect = srcW / srcH
  let inferW = srcW
  let inferH = srcH

  if (inferW > maxDim || inferH > maxDim) {
    if (aspect >= 1) {
      inferW = maxDim
      inferH = Math.round(maxDim / aspect)
    } else {
      inferH = maxDim
      inferW = Math.round(maxDim * aspect)
    }
  }

  // Enforce even dimensions for ffmpeg compatibility
  inferW = Math.max(16, Math.round(inferW / 2) * 2)
  inferH = Math.max(16, Math.round(inferH / 2) * 2)

  return {
    inferW,
    inferH,
    // Derived from the size the model actually receives, not from the media's own size.
    downsampleRatio: downsampleRatioForInferenceSize(Math.max(inferW, inferH)),
  }
}

/**
 * An existing bake in the same group that already covers `need`, if there is one.
 *
 * The cache directory is the index: a matte's file name carries its group and its range
 * (see computeAutoMatteFingerprint), so this is a directory listing and some arithmetic
 * rather than a database that could drift out of step with the files.
 *
 * The smallest covering candidate wins — a tighter matte decodes less to seek through.
 */
function findCoveringBake(
  cacheDir: string,
  groupKey: string,
  need: AutoMatteSourceRange,
  /** A reversed bake plays backwards, so only an exact range can stand in. */
  exactOnly = false,
): { path: string; fingerprint: string; range: AutoMatteSourceRange } | null {
  let best: { path: string; fingerprint: string; range: AutoMatteSourceRange } | null = null
  try {
    for (const name of fs.readdirSync(cacheDir)) {
      if (!name.startsWith(`matte_${groupKey}_`) || !name.endsWith('.mp4')) continue
      if (name.includes('.part')) continue

      const fingerprint = name.slice(0, -'.mp4'.length)
      const parsed = parseAutoMatteFingerprint(fingerprint)
      if (!parsed || parsed.key !== groupKey) continue
      if (exactOnly) {
        if (
          Math.abs(parsed.range.sourceStart - need.sourceStart) > 1e-3 ||
          Math.abs(parsed.range.sourceSpan - need.sourceSpan) > 1e-3
        ) {
          continue
        }
      } else if (!autoMatteRangeCovers(parsed.range, need)) {
        continue
      }

      const full = path.join(cacheDir, name)
      try {
        if (fs.statSync(full).size <= 1000) continue
      } catch {
        continue
      }

      // KE-1804: Validate sidecar manifest if present
      let effectiveRange = parsed.range
      const manifestPath = full.replace(/\.mp4$/, '.manifest.json')
      if (fs.existsSync(manifestPath)) {
        try {
          const raw = fs.readFileSync(manifestPath, 'utf-8')
          const manifest = JSON.parse(raw)
          if (hasBakeManifestV2(manifest)) {
            const issues = validateBakeManifestV2(manifest)
            if (issues.length > 0) {
              logger.warn(`[matte-service] Skipping bake with invalid manifest ${manifestPath}: ${issues.join(', ')}`)
              continue
            }
            if (manifest.status === 'partial') {
              effectiveRange = manifest.coverageActual
              if (!autoMatteRangeCovers(effectiveRange, need)) {
                continue
              }
            }
          }
        } catch {
          // Corrupted manifest — skip this unverified bake
          continue
        }
      }

      if (!best || effectiveRange.sourceSpan < best.range.sourceSpan) {
        best = { path: full, fingerprint, range: effectiveRange }
      }
    }
  } catch {
    return null
  }
  return best
}

/**
 * The source range recorded for a still's matte.
 *
 * A still has one frame, and that frame is the matte for every second the clip is on
 * screen — there is no "later part of the media" that could be missing. Claiming a day of
 * coverage means stretching or shortening the clip never asks for another bake, which
 * would otherwise produce a second identical one-frame file.
 */
const STILL_BAKE_SPAN_SECONDS = 86400

/** Stable identity for a media file, for grouping the bakes made from it. */
function normalizeAssetKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

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
      // If the final MP4 was never completed, clean its manifest too
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
    // Still part of the fingerprint so bakes made before the picker was removed keep
    // validating; it no longer changes how the model runs.
    const quality = (params.quality as AutoMatteQuality) || 'standard'
    // Segment at source rate. Playback speed must never discard source alpha frames
    // or create a different cache group for the same source range.
    const speed = 1
    const reversed = Boolean(params.reversed)

    // Windows paths are case-insensitive; elsewhere two names differing in case are two
    // different files and must not share a matte.
    const assetKey = normalizeAssetKey(params.filePath)
    const needed = autoMatteSourceRange(params)

    const cacheDir = renderCacheManager.getCacheDir()

    // Probe media specs
    const probe = await probeVideo(ffmpegPath, params.filePath)
    const fps = probe.fps
    const clipW = probe.width
    const clipH = probe.height

    // After the probe: the frame geometry is part of what makes two bakes interchangeable.
    const groupKey = autoMatteBakeKey({
      assetKey,
      speed,
      reversed,
      model,
      quality,
      frameSize: `${clipW}x${clipH}`,
    })

    // Cache hit: any bake made the same way that already covers this stretch of media.
    // It does not have to be the same clip, the same trim, or the same length — which is
    // the whole point, because the render cache asks for windows the editor has already
    // matted.
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

    // Nothing covers it, so bake — but bake the range rounded outward to the block grid,
    // so the next trim of this clip lands inside what is produced here instead of asking
    // for its own copy.
    // A reversed bake cannot be shared, so there is nothing to gain from baking more of
    // the media than the clip asks for.
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
    // A still decodes exactly one frame however long the clip is; asking for a frame per
    // timeline frame left the progress bar reporting 1 of 250 and then jumping to done.
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

    // Clean up any stale partial files from prior interrupted attempts
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

    // Run execution through the promise queue (one bake at a time)
    const queueTask = async () => {
      // 1. If job was cancelled while waiting in the queue, do not run
      if (activeJob.cancelled) {
        logger.info(`[matte-service] Job ${activeJob.jobId} was cancelled while queued; skipping bake`)
        return
      }

      // 2. Re-check findCoveringBake immediately before starting.
      // An earlier job in the queue may have just completed and written a bake covering this range!
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

      // 3. Otherwise execute the bake
      await this.executeBake({ ...params, speed }, activeJob, ffmpegPath, clipW, clipH, fps, expectedFrames, bakeRange)
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

  private async executeBake(
    params: MatteBakeJobParams,
    job: ActiveBakeRecord,
    ffmpegPath: string,
    clipW: number,
    clipH: number,
    fps: number,
    expectedFrames: number,
    bakeRange: AutoMatteSourceRange,
  ): Promise<void> {
    if (job.cancelled) return

    const speed = params.speed && params.speed > 0 ? params.speed : 1
    const reversed = Boolean(params.reversed)

    const { inferW, inferH, downsampleRatio } = getInferDimensions(clipW, clipH, params.quality)
    const frameByteSize = inferW * inferH * 3 // RGB24 size in bytes

    const modelName = params.model === 'modnet' ? 'modnet' : 'rvm_mobilenetv3'
    const modelPath = resolveModelPath(modelName)
    const numCpus = os.cpus()?.length || 4
    const intraOpNumThreads = Math.max(1, Math.floor(numCpus / 2))

    const workerHost = await MatteWorkerHost.create({
      modelPath,
      modelName,
      device: params.device ?? 'auto',
      providerChain: getProviderChain(params.device ?? 'auto'),
      inferW,
      inferH,
      downsampleRatio,
      warmupFrames: MATTE_WARMUP_FRAMES,
      intraOpNumThreads,
    })

    job.workerHost = workerHost
    const provider = workerHost.getProvider()
    onnxSessionManager.setActiveProvider(provider)
    logger.info(`[matte-service] Job ${job.jobId} running on provider '${provider ?? 'unknown'}' (worker thread)`)

    logger.info(
      `[matte-service] Starting bake for clip ${params.clipId} ` +
        `(source [${bakeRange.sourceStart.toFixed(2)}s, ` +
        `${(bakeRange.sourceStart + bakeRange.sourceSpan).toFixed(2)}s], ` +
        `frames: ${expectedFrames}, infer: ${inferW}x${inferH}, out: ${clipW}x${clipH}, fps: ${fps})`,
    )

    // 1. Decoder process: Decode video stream into raw RGB24 frames
    const decodeArgs: string[] = params.still
      ? ['-hide_banner', '-i', params.filePath]
      : [
          '-hide_banner',
          // The BAKE's range, which is the clip's range rounded outward — not the clip's.
          '-ss',
          bakeRange.sourceStart.toFixed(6),
          '-t',
          bakeRange.sourceSpan.toFixed(6),
          '-i',
          params.filePath,
        ]

    const vfFilters: string[] = []
    if (!params.still && speed !== 1) {
      vfFilters.push(`setpts=PTS/${speed.toFixed(6)}`)
    }
    if (!params.still && reversed) {
      vfFilters.push('reverse')
    }
    if (!params.still) vfFilters.push(`fps=${fps}`)
    vfFilters.push(`scale=${inferW}:${inferH}`)

    decodeArgs.push(
      '-vf',
      vfFilters.join(','),
      '-frames:v',
      String(expectedFrames),
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    )

    // 2. Encoder process: Encode raw grayscale alpha frames into h264 MP4
    const encodeArgs: string[] = [
      '-hide_banner',
      '-f',
      'rawvideo',
      // 8-bit, NOT grayf32le. Handing ffmpeg the model's float alpha directly would save
      // the conversion below, but converting float -> yuv420p applies a limited-to-full
      // range expansion: a 0..1 ramp came back a mean of 9.6/255 too bright, so every
      // matte would have been quietly over-opaque. `scale=in_range=full:out_range=full`
      // fixes that but still rounds half the pixels up, and it leaves the matte's
      // correctness resting on an ffmpeg range default. Not worth ~3 ms a frame.
      '-pix_fmt',
      'gray',
      '-s',
      `${inferW}x${inferH}`,
      '-r',
      String(fps),
      '-i',
      'pipe:0',
    ]

    if (inferW !== clipW || inferH !== clipH) {
      encodeArgs.push('-vf', `scale=${clipW}:${clipH}:flags=bicubic`)
    }

    encodeArgs.push(
      '-c:v',
      'libx264',
      // NOT `-crf 0`, however tempting lossless is for a mask.
      //
      // x264 in lossless mode emits High 4:4:4 Predictive, whatever pixel format it was
      // handed. Chromium's H.264 decoder does not support that profile, so the `<video>`
      // element the preview loads the matte into could never decode a single frame: the
      // panel said "matte ready", the export was correct, and the preview showed the
      // background. The reasoning behind lossless was sound — ringing lands exactly on the
      // subject's edge — but a matte the preview cannot read is worth nothing.
      //
      // `-crf 1` stays in plain High profile. Measured against the lossless file on a real
      // 1080x1920 matte: mean error 0.013/255, worst pixel 9/255, and the file is smaller.
      // `-profile:v high` is stated rather than assumed, so a future default cannot quietly
      // put us back on 4:4:4.
      '-crf',
      '1',
      '-profile:v',
      'high',
      // A keyframe every second. The preview seeks this file to pull the matte back in
      // step with the picture, and with the default interval each correction had to decode
      // from a keyframe up to eight seconds back — long enough that the matte spent much of
      // its time behind, which is what made the cut-out come and go during playback.
      '-g',
      '30',
      '-sc_threshold',
      '0',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-frames:v',
      String(expectedFrames),
      '-y',
      job.partPath,
    )

    const decodeProcess = spawn(ffmpegPath, decodeArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const encodeProcess = spawn(ffmpegPath, encodeArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    quietChildStdio(decodeProcess, 'matte decode')
    // Cancelling a bake kills this encoder with alpha frames still queued for its stdin.
    // See quietChildStdio for why guarding the write() call cannot catch that.
    quietChildStdio(encodeProcess, 'matte encode')

    job.decodeProcess = decodeProcess
    job.encodeProcess = encodeProcess

    // Queue-based backpressure pipeline between ffmpeg decode, worker inference, and ffmpeg encode.
    //
    // Note on earlier measurement: The previous comment noted read-ahead was no faster
    // because session.run on Node's main thread blocked the event loop. Now that the model
    // and pixel loops live in matte-worker.ts, decoding overlaps freely with inference
    // without starving the main thread.
    const MAX_IN_FLIGHT = 6
    let inFlightCount = 0
    let isDecodePaused = false
    let decodeFinished = false
    let currentFrameIndex = 0
    let encodedFrames = 0

    let currentFrameBuffer = new Uint8Array(frameByteSize)
    let filled = 0
    const stdin = encodeProcess.stdin!

    decodeProcess.stderr.on('data', (d) => {
      const msg = d.toString()
      if (msg.includes('Error') || msg.includes('fatal')) {
        logger.warn(`[matte-service] Decoder stderr: ${msg.slice(0, 200)}`)
      }
    })

    encodeProcess.stderr.on('data', (d) => {
      const msg = d.toString()
      if (msg.includes('Error') || msg.includes('fatal')) {
        logger.warn(`[matte-service] Encoder stderr: ${msg.slice(0, 200)}`)
      }
    })

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false

        const fail = (err: any) => {
          if (settled) return
          settled = true
          reject(err)
        }

        const succeed = () => {
          if (settled) return
          settled = true
          resolve()
        }

        workerHost.onError((err) => {
          fail(err)
        })

        workerHost.onAlpha(async (_frameIdx, alphaBuffer) => {
          if (job.cancelled || settled) return

          try {
            // Write alpha mask to encoder stdin
            if (!stdin.destroyed && !job.cancelled) {
              const canWrite = stdin.write(alphaBuffer)
              if (!canWrite) {
                if (!isDecodePaused && decodeProcess.stdout) {
                  decodeProcess.stdout.pause()
                  isDecodePaused = true
                }
                await new Promise<void>((r) => stdin.once('drain', r))
              }
            }

            encodedFrames++
            inFlightCount--

            // Resume decoder if backpressure eases
            if (isDecodePaused && inFlightCount < MAX_IN_FLIGHT && !decodeFinished && decodeProcess.stdout) {
              decodeProcess.stdout.resume()
              isDecodePaused = false
            }

            job.currentFrame = encodedFrames
            const percent = Math.min(99, Math.round((encodedFrames / expectedFrames) * 100))

            job.status = {
              status: 'running',
              percent,
              phase: 'inferring',
            }

            // Throttled progress report every 5 frames or on final frame
            if (encodedFrames % 5 === 0 || encodedFrames >= expectedFrames) {
              emitToRenderer('matte:progress', {
                jobId: job.jobId,
                percent,
                phase: 'inferring',
                frame: encodedFrames,
                totalFrames: expectedFrames,
              })
            }

            if (encodedFrames >= expectedFrames || (decodeFinished && inFlightCount === 0)) {
              succeed()
            }
          } catch (err) {
            fail(err)
          }
        })

        decodeProcess.stdout?.on('data', (chunk: Buffer) => {
          if (job.cancelled || settled) return

          let offset = 0
          while (offset < chunk.length && currentFrameIndex < expectedFrames) {
            const take = Math.min(frameByteSize - filled, chunk.length - offset)
            const chunkView = new Uint8Array(chunk.buffer, chunk.byteOffset + offset, take)
            currentFrameBuffer.set(chunkView, filled)
            filled += take
            offset += take

            if (filled === frameByteSize) {
              const frameBuf = currentFrameBuffer
              currentFrameBuffer = new Uint8Array(frameByteSize)
              filled = 0

              const thisFrameIdx = currentFrameIndex++
              inFlightCount++
              workerHost.sendFrame(thisFrameIdx, frameBuf.buffer)

              if (inFlightCount >= MAX_IN_FLIGHT && !isDecodePaused) {
                decodeProcess.stdout?.pause()
                isDecodePaused = true
              }

              if (currentFrameIndex >= expectedFrames) {
                decodeProcess.stdout?.pause()
                isDecodePaused = true
                break
              }
            }
          }
        })

        decodeProcess.stdout?.on('end', () => {
          decodeFinished = true
          if (inFlightCount === 0) {
            succeed()
          }
        })

        decodeProcess.on('error', fail)
        encodeProcess.on('error', fail)
      })
    } finally {
      try {
        workerHost.terminate()
      } catch {}
      job.workerHost = null
    }

    if (job.cancelled) return

    // End encoder stdin and wait for encoder process to finish cleanly
    stdin.end()

    await new Promise<void>((resolve, reject) => {
      encodeProcess.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Encoder process exited with non-zero code ${code}`))
      })
      encodeProcess.on('error', reject)
    })

    if (job.cancelled) return

    // Atomic move of temporary part file to final cache file
    if (fs.existsSync(job.partPath)) {
      try {
        await safeRename(job.partPath, job.finalPath)
      } catch (err: any) {
        logger.error(`[MatteService] Failed to rename ${job.partPath} to ${job.finalPath}: ${err}`)
        job.status = { status: 'error', percent: 0, error: err.message, phase: 'error' }
        emitToRenderer('matte:progress', {
          jobId: job.jobId,
          percent: 0,
          phase: 'error',
          error: err.message,
        })
        return
      }
    }

    // KE-1804: Write BakeManifestV2 alongside the MP4.
    // Records ACTUAL coverage (encodedFrames, not expectedFrames) so the consumer
    // knows exactly which source frames this bake file covers.
    const actualSourceSpan = (encodedFrames / fps) * speed
    const frameDurationUs = Math.round(1_000_000 / fps)
    const frameMap: BakeFrameMapEntry[] = []
    for (let i = 0; i < encodedFrames; i++) {
      // Source PTS: each bake ordinal maps to a source frame at the bake's fps
      // The bake is in source-frame order (speed and reverse are already applied by ffmpeg)
      const sourcePts = Math.round(bakeRange.sourceStart * 1_000_000) + i * frameDurationUs
      frameMap.push({
        ordinal: i,
        sourceFrameId: i, // ordinal == source frame id within the bake's range
        sourcePts,
      })
    }

    const manifestV2: BakeManifestV2 = {
      version: BAKE_MANIFEST_VERSION,
      assetRevision: normalizeAssetKey(params.filePath),
      model: (params.model as string) || 'rvm-mobilenetv3',
      modelHash: '', // Will be populated when model integrity checking is added
      pipelineVersion: 1,
      geometry: `${clipW}x${clipH}`,
      rotation: 0, // TODO: read from probe when rotation support lands
      timebase: [1, fps],
      alphaRange: [0, 255],
      frameMap,
      coverageActual: {
        sourceStart: bakeRange.sourceStart,
        sourceSpan: actualSourceSpan,
      },
      status: encodedFrames >= expectedFrames ? 'complete' : 'partial',
      completedAt: new Date().toISOString(),
    }

    const manifestPath = job.finalPath.replace(/\.mp4$/, '.manifest.json')
    const tmpManifestPath = `${manifestPath}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tmpManifestPath, JSON.stringify(manifestV2, null, 2), 'utf-8')
      safeRename(tmpManifestPath, manifestPath)
    } catch (err) {
      removeEntryQuietly(tmpManifestPath)
      // Non-fatal: the bake MP4 is still usable without the manifest (v1 fallback)
      logger.warn(`[matte-service] Failed to write manifest atomically: ${err}`)
    }

    job.status = {
      status: 'done',
      percent: 100,
      phase: 'done',
      mattePath: job.finalPath,
      fingerprint: job.fingerprint,
      frameCount: encodedFrames,
      bake: {
        path: job.finalPath,
        fingerprint: job.fingerprint,
        frameCount: encodedFrames,
        sourceStart: bakeRange.sourceStart,
        sourceSpan: actualSourceSpan,
        speed,
        reversed,
        model: (params.model as string) || 'rvm-mobilenetv3',
        quality: (params.quality as string) || 'standard',
        assetKey: normalizeAssetKey(params.filePath),
        manifestPath,
        status: manifestV2.status,
        coverageActual: manifestV2.coverageActual,
      },
    }

    renderCacheManager.enforceSizeLimit()

    emitToRenderer('matte:progress', {
      jobId: job.jobId,
      percent: 100,
      phase: 'done',
      frame: encodedFrames,
      totalFrames: expectedFrames,
    })

    logger.info(
      `[matte-service] Bake completed successfully for ${job.jobId} ` +
        `(${encodedFrames} frames encoded to ${job.finalPath}, manifest: ${manifestPath})`,
    )
  }

  /**
   * Ensures that a clip's matte is baked and cached.
   * If already cached, returns immediately; otherwise waits until the bake completes.
   */
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
