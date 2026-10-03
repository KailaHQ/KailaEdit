import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { findFfmpegPath, runFfmpegCapture, runFfmpegWithProgress, type FfmpegProcessHandle } from '../export/ffmpeg-utils'
import { parseFfmpegProbeOutput } from '../media/probe'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { removeEntry } from '../storage/remove-entry'
import { resolveUserDataDir } from '../../core/src/app-paths'
import { fastHash64 } from '../../core/src/render-cache'
import type { StabilizationBake, StabilizationMode } from '../../core/src/project-model'
import {
  analyzeStabilization,
  buildVidstabDetectFilter,
  buildVidstabTransformFilter,
  computeStabilizationFingerprint,
  parseVidstabFinalZoom,
  parseVidstabGlobalMotions,
  type StabilizationReport,
} from '../../core/src/stabilization'

const require = createRequire(import.meta.url)

export type HdrOutput = 'hevc' | 'sdr'

export interface StabilizeStartParams {
  jobId: string
  assetId: string
  filePath: string
  sourceStart: number
  sourceSpan: number
  smoothing: number
  mode: StabilizationMode
  hdrOutput?: HdrOutput
}

export interface StabilizeStartResult {
  started: boolean
  cached?: boolean
  bake?: StabilizationBake
  error?: string
}

export type StabilizeJobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface StabilizeStatusResult {
  status: StabilizeJobStatus
  percent: number
  bake?: StabilizationBake
  error?: string
}

type Phase = 'queued' | 'analyzing' | 'stabilizing' | 'done' | 'error' | 'cancelled'

/** Share of the progress bar given to the analysis pass; the encode is the slow half. */
const DETECT_SHARE = 45
/** Finished jobs kept for `status` queries after their last event. */
const MAX_FINISHED_RECORDS = 50
const MOTION_FILE = 'motion.trf'
/** Where vidstabtransform writes its per-frame motions with `debug=1`, relative to cwd. */
const GLOBAL_MOTIONS_FILE = 'global_motions.trf'
const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084'])

export interface SourceInfo {
  /** Display size — after the rotation a phone writes — which is what the filters see. */
  width: number
  height: number
  fps: number
  duration: number
  /** Transfer characteristic of an HDR source, or null for SDR. */
  hdrTransfer: string | null
}

/**
 * Reads what the bake needs to know about its source out of `ffmpeg -i` output.
 *
 * HDR is recognised by its transfer curve, not its bit depth: a 10-bit SDR file is still
 * SDR, and an HLG or PQ file tone-mapped as if it were BT.709 comes out grey and flat.
 */
export function parseSourceInfo(stderr: string): SourceInfo {
  const probe = parseFfmpegProbeOutput(stderr)
  const videoLine = stderr.split(/\r?\n/).find(line => /Stream #\d+:\d+.*Video:/.test(line)) ?? ''
  const color = /Video:.*?,\s*[a-z0-9_]+\(([^)]*)\)/i.exec(videoLine)?.[1] ?? ''
  const transfer = color.split(/[,/]/).map(s => s.trim()).find(s => HDR_TRANSFERS.has(s)) ?? null
  return {
    width: probe.width,
    height: probe.height,
    fps: probe.fps > 0 ? probe.fps : 30,
    duration: probe.duration,
    hdrTransfer: transfer,
  }
}

export type OutputColor = 'sdr' | 'hdr-hevc' | 'hdr-tonemap'

export function outputColorFor(source: Pick<SourceInfo, 'hdrTransfer'>, hdrOutput: HdrOutput): OutputColor {
  if (!source.hdrTransfer) return 'sdr'
  return hdrOutput === 'hevc' ? 'hdr-hevc' : 'hdr-tonemap'
}

/** HLG or PQ down to BT.709, the way the render pipeline expects SDR to look. */
const TONEMAP_TO_SDR = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
  + 'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'

/**
 * The two ffmpeg invocations of a bake.
 *
 * Both passes cut the SAME range with the same input-side seek, so frame N of the
 * analysis is frame N of the transform — vidstab matches its motion file to frames by
 * count, not by timestamp, and a pass that started one frame later would stabilize every
 * frame with its neighbour's correction. Both run in the job's work directory, so the
 * motion file is a plain relative name (no drive-colon escaping) and the debug motions
 * land somewhere this job owns.
 */
export function buildStabilizeArgs(params: {
  filePath: string
  sourceStart: number
  sourceSpan: number
  smoothing: number
  mode: StabilizationMode
  outputPath: string
  color: OutputColor
  hdrTransfer?: string | null
}): { detect: string[]; transform: string[] } {
  const input = [
    '-ss', params.sourceStart.toFixed(3),
    '-i', params.filePath,
    '-t', params.sourceSpan.toFixed(3),
  ]
  const vidstab = { smoothing: params.smoothing, mode: params.mode }

  const detect = [
    '-y', '-hide_banner',
    ...input,
    '-an', '-sn', '-dn',
    '-vf', buildVidstabDetectFilter(vidstab, MOTION_FILE),
    '-f', 'null', '-',
  ]

  let videoFilter = buildVidstabTransformFilter(vidstab, MOTION_FILE, { debug: true })
  let videoCodec: string[]
  if (params.color === 'hdr-hevc') {
    const trc = params.hdrTransfer ?? 'arib-std-b67'
    videoFilter += ',format=yuv420p10le'
    videoCodec = [
      '-c:v', 'libx265', '-preset', 'fast', '-crf', '18',
      '-x265-params', `log-level=error:colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc`,
      '-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc',
      '-tag:v', 'hvc1',
    ]
  } else {
    if (params.color === 'hdr-tonemap') videoFilter += `,${TONEMAP_TO_SDR}`
    videoFilter += ',format=yuv420p'
    videoCodec = [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    ]
  }

  const transform = [
    '-y', '-hide_banner',
    ...input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', videoFilter,
    ...videoCodec,
    // The audio is cut with the picture, so one file serves the clip whole.
    '-c:a', 'aac', '-b:a', '192k',
    '-map_metadata', '-1',
    '-movflags', '+faststart',
    params.outputPath,
  ]
  return { detect, transform }
}

interface JobRecord {
  /** Every renderer job id waiting on this run — identical requests share one bake. */
  jobIds: Set<string>
  params: StabilizeStartParams
  outputPath: string
  source: SourceInfo
  color: OutputColor
  status: StabilizeJobStatus
  phase: Phase
  percent: number
  bake?: StabilizationBake
  error?: string
  handle?: FfmpegProcessHandle
  cancelled: boolean
}

/**
 * Bakes stabilized copies of the source ranges clips use.
 *
 * One job at a time: both passes are CPU-bound and a second encode alongside only makes
 * both slower. Output lands under a `.part.mp4` name and is renamed once complete, with a
 * sidecar holding what the bake measured, so a file in the cache is always whole and a
 * crash never leaves one that looks finished.
 */
export class StabilizeService {
  private customDir?: string
  private queue: JobRecord[] = []
  private active: JobRecord | null = null
  /** Job id -> record, for events and status. */
  private jobs = new Map<string, JobRecord>()
  /** Jobs whose source is still being probed, with whether they were cancelled meanwhile. */
  private probing = new Map<string, boolean>()
  private finishedOrder: string[] = []
  private initialized = false

  constructor(customDir?: string) {
    this.customDir = customDir
  }

  getCacheDir(): string {
    let dir = this.customDir
    if (!dir) {
      try {
        const { app } = require('electron')
        dir = app && typeof app.getPath === 'function'
          ? path.join(app.getPath('userData'), 'stabilize-cache')
          : path.join(resolveUserDataDir(), 'stabilize-cache')
      } catch {
        dir = path.join(resolveUserDataDir(), 'stabilize-cache')
      }
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private getWorkRoot(): string {
    return path.join(this.getCacheDir(), 'work')
  }

  /** Sweeps what an interrupted run left behind: partial outputs and work directories. */
  init(): void {
    if (this.initialized) return
    this.initialized = true
    const dir = this.getCacheDir()
    try {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (name.endsWith('.part.mp4')) {
          try { fs.unlinkSync(full) } catch {}
        } else if (name.endsWith('.mp4')) {
          // A video without its sidecar never finished being recorded.
          if (!fs.existsSync(sidecarPath(full))) {
            try { fs.unlinkSync(full) } catch {}
          }
        }
      }
      const work = this.getWorkRoot()
      if (fs.existsSync(work)) removeEntry(work)
    } catch (err) {
      logger.warn(`[stabilize] cleanup failed: ${String(err)}`)
    }
  }

  /**
   * The cache file for a request. The media is identified by its path, size and
   * modification time, so an edited or replaced file never picks up a stale bake.
   */
  outputPathFor(params: StabilizeStartParams, color: OutputColor): string {
    const stat = fs.statSync(params.filePath)
    const mediaTag = fastHash64(`${normalizePath(params.filePath)}|${stat.size}|${Math.round(stat.mtimeMs)}`)
    const fingerprint = computeStabilizationFingerprint(params)
    return path.join(this.getCacheDir(), `${mediaTag}_${fingerprint}_${color}.mp4`)
  }

  async start(params: StabilizeStartParams): Promise<StabilizeStartResult> {
    this.init()
    if (!(params.sourceSpan > 0)) return { started: false, error: 'Empty source range' }
    if (!fs.existsSync(params.filePath)) {
      return { started: false, error: `Source video not found: ${params.filePath}` }
    }
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return { started: false, error: 'ffmpeg binary not found' }

    // The probe is awaited, so the job exists for a moment before it is queued. A cancel in
    // that window is remembered here and honoured once the probe returns.
    this.probing.set(params.jobId, false)
    const source = await probeSource(ffmpegPath, params.filePath) // never rejects
    const cancelledWhileProbing = this.probing.get(params.jobId) === true
    this.probing.delete(params.jobId)
    if (cancelledWhileProbing) return { started: false, error: 'Cancelled' }
    const color = outputColorFor(source, params.hdrOutput ?? 'sdr')
    const outputPath = this.outputPathFor(params, color)

    const cached = readCachedBake(outputPath, params.assetId)
    if (cached) return { started: false, cached: true, bake: cached }

    // Same output already queued or running: follow that run instead of starting another.
    const existing = [this.active, ...this.queue].find(r => r && !r.cancelled && r.outputPath === outputPath)
    if (existing) {
      existing.jobIds.add(params.jobId)
      this.jobs.set(params.jobId, existing)
      this.emit(existing, existing.phase)
      return { started: true }
    }

    const record: JobRecord = {
      jobIds: new Set([params.jobId]),
      params,
      outputPath,
      source,
      color,
      status: 'queued',
      phase: 'queued',
      percent: 0,
      cancelled: false,
    }
    this.jobs.set(params.jobId, record)
    this.queue.push(record)
    this.emit(record, 'queued')
    this.processNext(ffmpegPath)
    return { started: true }
  }

  /**
   * Stops waiting for a job. The run itself is only killed when nobody else is waiting
   * on it — two clips over the same range share one bake.
   */
  cancel(jobId: string): boolean {
    if (this.probing.has(jobId)) {
      this.probing.set(jobId, true)
      emitToRenderer('stabilize:progress', { jobId, percent: 0, phase: 'cancelled' })
      return true
    }
    const record = this.jobs.get(jobId)
    if (!record || record.status === 'done' || record.status === 'error' || record.status === 'cancelled') {
      return false
    }
    record.jobIds.delete(jobId)
    emitToRenderer('stabilize:progress', { jobId, percent: record.percent, phase: 'cancelled' })
    this.jobs.delete(jobId)
    if (record.jobIds.size > 0) return true

    record.cancelled = true
    record.status = 'cancelled'
    const queued = this.queue.indexOf(record)
    if (queued >= 0) this.queue.splice(queued, 1)
    record.handle?.kill()
    return true
  }

  cancelAll(): void {
    for (const jobId of [...this.probing.keys(), ...this.jobs.keys()]) this.cancel(jobId)
  }

  status(jobId: string): StabilizeStatusResult {
    const record = this.jobs.get(jobId)
    if (!record) return { status: 'idle', percent: 0 }
    return { status: record.status, percent: record.percent, bake: record.bake, error: record.error }
  }

  /** Deletes every bake. Running jobs are cancelled first. */
  clearCache(): number {
    this.cancelAll()
    const dir = this.getCacheDir()
    let freed = 0
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        try {
          if (entry.isFile()) {
            freed += fs.statSync(full).size
            fs.unlinkSync(full)
          } else if (entry.isDirectory()) {
            removeEntry(full)
          }
        } catch {}
      }
    } catch (err) {
      logger.error(`[stabilize] error clearing cache: ${String(err)}`)
    }
    return freed
  }

  private processNext(ffmpegPath: string): void {
    if (this.active || this.queue.length === 0) return
    const record = this.queue.shift()!
    this.active = record
    this.run(ffmpegPath, record)
      .catch(err => this.fail(record, String(err)))
      .finally(() => {
        this.active = null
        this.processNext(ffmpegPath)
      })
  }

  private async run(ffmpegPath: string, record: JobRecord): Promise<void> {
    const { params, source, color } = record
    const workDir = path.join(this.getWorkRoot(), fastHash64(record.outputPath))
    const partPath = record.outputPath.replace(/\.mp4$/, '.part.mp4')
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const args = buildStabilizeArgs({
        ...params,
        outputPath: partPath,
        color,
        hdrTransfer: source.hdrTransfer,
      })
      const spanUs = params.sourceSpan * 1_000_000

      record.status = 'running'
      this.setProgress(record, 0, 'analyzing')
      const detect = runFfmpegWithProgress(ffmpegPath, args.detect, info => {
        if (info.outTimeUs) this.setProgress(record, (info.outTimeUs / spanUs) * DETECT_SHARE, 'analyzing')
      }, { cwd: workDir })
      record.handle = detect
      const detected = await detect.promise
      if (record.cancelled) return
      if (!detected.success) throw new Error(detected.error || 'Motion analysis failed')

      this.setProgress(record, DETECT_SHARE, 'stabilizing')
      const transform = runFfmpegWithProgress(ffmpegPath, args.transform, info => {
        if (info.outTimeUs) {
          this.setProgress(record, DETECT_SHARE + (info.outTimeUs / spanUs) * (99 - DETECT_SHARE), 'stabilizing')
        }
      }, { cwd: workDir })
      record.handle = transform
      const transformed = await transform.promise
      if (record.cancelled) return
      if (!transformed.success || !fs.existsSync(partPath)) {
        throw new Error(transformed.error || 'Stabilization failed')
      }

      const zoomPercent = parseVidstabFinalZoom(transformed.stderr ?? '')
      let report: StabilizationReport = { warnings: [], warningTimes: [] }
      const motionsPath = path.join(workDir, GLOBAL_MOTIONS_FILE)
      if (fs.existsSync(motionsPath)) {
        report = analyzeStabilization({
          motions: parseVidstabGlobalMotions(fs.readFileSync(motionsPath, 'utf8')),
          fps: source.fps,
          frameWidth: source.width,
          sourceStart: params.sourceStart,
          zoomPercent,
        })
      }

      const bake: StabilizationBake = {
        path: record.outputPath,
        fingerprint: computeStabilizationFingerprint(params),
        createdAt: Date.now(),
        sourceStart: params.sourceStart,
        sourceSpan: params.sourceSpan,
        assetKey: params.assetId,
        ...(zoomPercent != null ? { zoomPercent: Number(zoomPercent.toFixed(2)) } : {}),
        ...(report.warnings.length > 0
          ? { warnings: report.warnings, warningTimes: report.warningTimes }
          : {}),
      }

      if (fs.existsSync(record.outputPath)) fs.unlinkSync(record.outputPath)
      fs.renameSync(partPath, record.outputPath)
      // The sidecar goes last: its presence is what marks the video as complete.
      fs.writeFileSync(sidecarPath(record.outputPath), JSON.stringify(bake))

      record.status = 'done'
      record.percent = 100
      record.bake = bake
      this.emit(record, 'done')
      this.retire(record)
      logger.info(`[stabilize] baked ${path.basename(record.outputPath)} zoom=${zoomPercent ?? '?'}% warnings=${bake.warnings?.join(',') ?? 'none'}`)
    } catch (err) {
      if (!record.cancelled) this.fail(record, err instanceof Error ? err.message : String(err))
    } finally {
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch {}
      try { removeEntry(workDir) } catch {}
      record.handle = undefined
    }
  }

  private fail(record: JobRecord, error: string): void {
    logger.error(`[stabilize] ${path.basename(record.outputPath)}: ${error}`)
    record.status = 'error'
    record.error = error
    this.emit(record, 'error')
    this.retire(record)
  }

  private setProgress(record: JobRecord, percent: number, phase: Phase): void {
    const next = Math.max(0, Math.min(99, Math.round(percent)))
    // Only a visible change is worth an IPC message; the clip list re-renders on each.
    if (next === record.percent && phase === record.phase) return
    record.percent = next
    this.emit(record, phase)
  }

  private emit(record: JobRecord, phase: Phase): void {
    record.phase = phase
    for (const jobId of record.jobIds) {
      emitToRenderer('stabilize:progress', {
        jobId,
        percent: record.percent,
        phase,
        ...(phase === 'done' && record.bake ? { bake: record.bake } : {}),
        ...(phase === 'error' && record.error ? { error: record.error } : {}),
      })
    }
  }

  /** Keeps a finished job answerable for a while, without growing forever. */
  private retire(record: JobRecord): void {
    for (const jobId of record.jobIds) this.finishedOrder.push(jobId)
    while (this.finishedOrder.length > MAX_FINISHED_RECORDS) {
      const old = this.finishedOrder.shift()!
      const oldRecord = this.jobs.get(old)
      if (oldRecord && oldRecord.status !== 'running' && oldRecord.status !== 'queued') this.jobs.delete(old)
    }
  }
}

function sidecarPath(videoPath: string): string {
  return videoPath.replace(/\.mp4$/, '.json')
}

function normalizePath(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function probeSource(ffmpegPath: string, filePath: string): Promise<SourceInfo> {
  try {
    const res = await runFfmpegCapture(ffmpegPath, ['-hide_banner', '-i', filePath], 10000)
    return parseSourceInfo(res.stdout + res.stderr)
  } catch (err) {
    logger.warn(`[stabilize] probe failed for ${filePath}: ${String(err)}`)
    return { width: 1920, height: 1080, fps: 30, duration: 0, hdrTransfer: null }
  }
}

/** A finished bake read back from disk, or null when it is missing or incomplete. */
function readCachedBake(outputPath: string, assetId: string): StabilizationBake | null {
  try {
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) return null
    const sidecar = sidecarPath(outputPath)
    if (!fs.existsSync(sidecar)) return null
    const bake = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as StabilizationBake
    // The same file and settings serve any asset that points at that file.
    return { ...bake, path: outputPath, assetKey: assetId }
  } catch {
    return null
  }
}

export const stabilizeService = new StabilizeService()
