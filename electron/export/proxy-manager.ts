import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
import { findFfmpegPath, runFfmpegCapture, runFfmpegWithProgress, type FfmpegProcessHandle } from './ffmpeg-utils'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { removeEntry } from '../storage/remove-entry'
import { resolveUserDataDir } from '../../core/src/app-paths'

export type ProxyStatus = 'none' | 'generating' | 'ready' | 'error'

export interface ProxyItemStatus {
  status: ProxyStatus
  progress: number
  proxyPath?: string
  error?: string
}

interface QueuedProxyJob {
  assetId: string
  filePath: string
  resolve: (result: { success: boolean; proxyPath?: string; error?: string }) => void
}

export class ProxyManager {
  private customDir?: string
  private queue: QueuedProxyJob[] = []
  /**
   * The job between leaving the queue and its ffmpeg starting, while its duration is probed.
   * Awaiting that probe left a moment where the job was neither queued nor active: a cancel
   * then was lost, and a second processNext could start another job alongside it.
   */
  private probingJob: { assetId: string; resolve: QueuedProxyJob['resolve']; cancelled: boolean } | null = null
  private activeJob: {
    assetId: string
    filePath: string
    handle: FfmpegProcessHandle
  } | null = null
  private statuses = new Map<string, ProxyItemStatus>()
  private initialized = false

  constructor(customDir?: string) {
    this.customDir = customDir
  }

  getProxyDir(): string {
    if (this.customDir) {
      if (!fs.existsSync(this.customDir)) {
        fs.mkdirSync(this.customDir, { recursive: true })
      }
      return this.customDir
    }

    let baseDir: string
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app } = require('electron')
      if (app && typeof app.getPath === 'function') {
        baseDir = path.join(app.getPath('userData'), 'proxy-cache')
      } else {
        baseDir = path.join(resolveUserDataDir(), 'proxy-cache')
      }
    } catch {
      baseDir = path.join(resolveUserDataDir(), 'proxy-cache')
    }

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }
    return baseDir
  }

  /**
   * Initializes the proxy manager and sweeps away any incomplete (.part) files
   * from previous crashes or abrupt app shutdowns.
   */
  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.cleanupInterruptedFiles()
  }

  cleanupInterruptedFiles(): void {
    const dir = this.getProxyDir()
    try {
      if (!fs.existsSync(dir)) return
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        if (file.endsWith('.part')) {
          try {
            fs.unlinkSync(fullPath)
            logger.info(`[proxy] cleaned up incomplete file: ${file}`)
          } catch (err) {
            logger.warn(`[proxy] failed to remove partial file ${file}: ${String(err)}`)
          }
        } else if (file.endsWith('.mp4')) {
          // Remove 0-byte corrupt files
          try {
            const stat = fs.statSync(fullPath)
            if (stat.size === 0) {
              fs.unlinkSync(fullPath)
              logger.info(`[proxy] cleaned up 0-byte file: ${file}`)
            }
          } catch {}
        }
      }
    } catch (err) {
      logger.error(`[proxy] error scanning proxy dir for cleanup: ${String(err)}`)
    }
  }

  getProxyPath(assetId: string): string {
    return path.join(this.getProxyDir(), `${assetId}_540p.mp4`)
  }

  getPartPath(assetId: string): string {
    // `.part.mp4`, for the reason spelled out in RenderCacheManager.getPartPath: ffmpeg
    // reads the muxer off the extension and will not write a `.part` file at all.
    return path.join(this.getProxyDir(), `${assetId}_540p.part.mp4`)
  }

  getProxyStatus(assetId: string): ProxyItemStatus {
    this.init()
    const memoryStatus = this.statuses.get(assetId)
    if (memoryStatus && (memoryStatus.status === 'generating' || memoryStatus.status === 'error')) {
      return memoryStatus
    }

    const proxyPath = this.getProxyPath(assetId)
    if (fs.existsSync(proxyPath)) {
      try {
        const stat = fs.statSync(proxyPath)
        if (stat.size > 0) {
          const readyStatus: ProxyItemStatus = {
            status: 'ready',
            progress: 100,
            proxyPath,
          }
          this.statuses.set(assetId, readyStatus)
          return readyStatus
        }
      } catch {}
    }

    return {
      status: 'none',
      progress: 0,
    }
  }

  enqueueProxy(assetId: string, filePath: string): Promise<{ success: boolean; proxyPath?: string; error?: string }> {
    this.init()

    // If proxy file already exists and is non-empty, return immediately
    const existing = this.getProxyStatus(assetId)
    if (existing.status === 'ready' && existing.proxyPath) {
      return Promise.resolve({ success: true, proxyPath: existing.proxyPath })
    }

    // If active or already in queue, return promise without duplicate enqueue
    if (this.activeJob && this.activeJob.assetId === assetId) {
      return Promise.resolve({ success: true })
    }
    const inQueue = this.queue.find(q => q.assetId === assetId)
    if (inQueue) {
      return Promise.resolve({ success: true })
    }

    if (!fs.existsSync(filePath)) {
      const err = `Source video not found: ${filePath}`
      this.statuses.set(assetId, { status: 'error', progress: 0, error: err })
      emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'error', error: err })
      return Promise.resolve({ success: false, error: err })
    }

    return new Promise((resolve) => {
      this.queue.push({ assetId, filePath, resolve })
      this.processNext()
    })
  }

  private processNext(): void {
    if (this.activeJob || this.probingJob || this.queue.length === 0) {
      return
    }

    const job = this.queue.shift()
    if (!job) return

    const { assetId, filePath, resolve } = job
    const ffmpegPath = findFfmpegPath()

    if (!ffmpegPath) {
      const err = 'ffmpeg binary not found'
      this.statuses.set(assetId, { status: 'error', progress: 0, error: err })
      emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'error', error: err })
      resolve({ success: false, error: err })
      this.processNext()
      return
    }

    // Remove any stale .part file before starting
    const partPath = this.getPartPath(assetId)
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
    } catch {}

    const probing = { assetId, resolve, cancelled: false }
    this.probingJob = probing
    void this.probeDuration(ffmpegPath, filePath).then((duration) => {
      this.probingJob = null
      if (probing.cancelled) {
        // cancelProxy already answered the caller.
        this.processNext()
        return
      }
      this.startJob(job, ffmpegPath, duration)
    })
  }

  /** Media duration for the progress percentage; a guess when it cannot be read. */
  private async probeDuration(ffmpegPath: string, filePath: string): Promise<number> {
    let duration = 0
    try {
      const probeRes = await runFfmpegCapture(ffmpegPath, ['-hide_banner', '-i', filePath], 10000)
      const probeOut = probeRes.stdout + probeRes.stderr
      const durMatch = probeOut.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
      if (durMatch) {
        duration = parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3])
      }
    } catch (err) {
      logger.warn(`[proxy] failed to probe duration for ${filePath}: ${String(err)}`)
    }

    if (duration <= 0) {
      duration = 10 // fallback duration estimate
    }
    return duration
  }

  private startJob(job: QueuedProxyJob, ffmpegPath: string, duration: number): void {
    const { assetId, filePath, resolve } = job
    const partPath = this.getPartPath(assetId)
    const finalPath = this.getProxyPath(assetId)

    // 540p H.264 proxy command:
    // Scale preserving aspect ratio: landscape -> 960x540, portrait -> 540x960
    // -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart
    const args: string[] = [
      '-y',
      '-i', filePath,
      '-vf', "scale='if(gte(iw,ih),-2,540)':'if(gte(iw,ih),540,-2)'",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      partPath,
    ]

    this.statuses.set(assetId, { status: 'generating', progress: 0 })
    emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'generating' })

    const handle = runFfmpegWithProgress(ffmpegPath, args, (progress) => {
      let percent = 0
      if (progress.outTimeUs && duration > 0) {
        const currentSec = progress.outTimeUs / 1_000_000
        percent = Math.min(99, Math.max(1, Math.round((currentSec / duration) * 100)))
      }
      this.statuses.set(assetId, { status: 'generating', progress: percent })
      emitToRenderer('proxy:progress', { assetId, progress: percent, status: 'generating' })
    })

    this.activeJob = { assetId, filePath, handle }

    handle.promise.then((res) => {
      if (res.success && fs.existsSync(partPath)) {
        try {
          // Atomic rename from .part to final .mp4
          if (fs.existsSync(finalPath)) {
            try { fs.unlinkSync(finalPath) } catch {}
          }
          fs.renameSync(partPath, finalPath)

          const readyStatus: ProxyItemStatus = {
            status: 'ready',
            progress: 100,
            proxyPath: finalPath,
          }
          this.statuses.set(assetId, readyStatus)
          emitToRenderer('proxy:progress', {
            assetId,
            progress: 100,
            status: 'ready',
            proxyPath: finalPath,
          })
          resolve({ success: true, proxyPath: finalPath })
        } catch (renameErr) {
          const err = `Failed to rename proxy file: ${String(renameErr)}`
          logger.error(`[proxy] ${err}`)
          this.statuses.set(assetId, { status: 'error', progress: 0, error: err })
          emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'error', error: err })
          resolve({ success: false, error: err })
        }
      } else {
        // Clean up partial file on failure
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
        } catch {}

        const err = res.error || 'FFmpeg failed to generate proxy'
        this.statuses.set(assetId, { status: 'error', progress: 0, error: err })
        emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'error', error: err })
        resolve({ success: false, error: err })
      }
    }).catch((err) => {
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {}
      const errMsg = String(err)
      this.statuses.set(assetId, { status: 'error', progress: 0, error: errMsg })
      emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'error', error: errMsg })
      resolve({ success: false, error: errMsg })
    }).finally(() => {
      this.activeJob = null
      this.processNext()
    })
  }

  cancelProxy(assetId: string): void {
    // If queued, remove it
    const queuedIdx = this.queue.findIndex(q => q.assetId === assetId)
    if (queuedIdx >= 0) {
      const removed = this.queue.splice(queuedIdx, 1)[0]
      removed?.resolve({ success: false, error: 'Cancelled' })
    }

    // If its duration is still being probed, it never starts
    if (this.probingJob && this.probingJob.assetId === assetId && !this.probingJob.cancelled) {
      this.probingJob.cancelled = true
      this.probingJob.resolve({ success: false, error: 'Cancelled' })
    }

    // If active, kill it
    if (this.activeJob && this.activeJob.assetId === assetId) {
      this.activeJob.handle.kill()
      this.activeJob = null
      const partPath = this.getPartPath(assetId)
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {}
    }

    this.statuses.delete(assetId)
    emitToRenderer('proxy:progress', { assetId, progress: 0, status: 'none' })
  }

  cancelAll(): void {
    if (this.probingJob && !this.probingJob.cancelled) {
      this.probingJob.cancelled = true
      this.probingJob.resolve({ success: false, error: 'Cancelled' })
    }

    if (this.activeJob) {
      this.activeJob.handle.kill()
      const partPath = this.getPartPath(this.activeJob.assetId)
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {}
      this.activeJob = null
    }

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      item?.resolve({ success: false, error: 'Cancelled' })
    }

    this.statuses.clear()
  }

  clearProxies(): number {
    this.cancelAll()
    const dir = this.getProxyDir()
    let freedBytes = 0

    if (fs.existsSync(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          try {
            if (entry.isFile()) {
              freedBytes += fs.statSync(fullPath).size
              fs.unlinkSync(fullPath)
            } else if (entry.isDirectory()) {
              removeEntry(fullPath)
            }
          } catch {}
        }
      } catch (err) {
        logger.error(`[proxy] error clearing proxy cache: ${String(err)}`)
      }
    }

    this.statuses.clear()
    return freedBytes
  }
}

export const proxyManager = new ProxyManager()
