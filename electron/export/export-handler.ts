import fs from 'fs'
import { logger } from '../logger'
import { handle } from '../ipc/typed-handle'

export interface ExportSizeEstimateParams {
  width: number
  height: number
  fps: number
  durationSec: number
}

/**
 * Pure function: Estimate required temporary intermediate space for export (MKV libx264 -crf 16 + audio buffers).
 * Uses a conservative 0.28 bits-per-pixel-per-frame model + PCM audio buffer overhead + 20% safety margin.
 * E.g., 4K 30fps 1hr ~ 39 GB (matches 25-36+ GB requirement).
 * Used by renderQueue and disk-space-estimate tests.
 */
export function estimateExportIntermediateSize({ width, height, fps, durationSec }: ExportSizeEstimateParams): number {
  if (width <= 0 || height <= 0 || fps <= 0 || durationSec <= 0) return 0

  const totalPixels = width * height * fps * durationSec
  // CRF 16 conservative visual bitrate: ~0.28 bpp
  const estimatedVideoBytes = (totalPixels * 0.28) / 8

  // Raw PCM intermediate + WAV file: 48kHz stereo 16-bit is 192KB/s each (total 384KB/s)
  const audioBytesPerSec = 48000 * 2 * 2 * 2
  const estimatedAudioBytes = audioBytesPerSec * durationSec

  const safetyMultiplier = 1.2
  return Math.ceil((estimatedVideoBytes + estimatedAudioBytes) * safetyMultiplier)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

export interface DiskSpaceCheckResult {
  sufficient: boolean
  requiredBytes: number
  availableBytes: number
}

export function checkDiskSpaceForExport(dirPath: string, requiredBytes: number): DiskSpaceCheckResult {
  try {
    const stat = fs.statfsSync(dirPath)
    const availableBytes = Number(stat.bavail) * Number(stat.bsize)
    return {
      sufficient: availableBytes >= requiredBytes,
      requiredBytes,
      availableBytes,
    }
  } catch (error) {
    logger.warn(`[Export] Failed to query disk space with fs.statfsSync: ${error}`)
    return {
      sufficient: true,
      requiredBytes,
      availableBytes: Number.MAX_SAFE_INTEGER,
    }
  }
}

export function registerExportHandlers(): void {
  // Asynchronous render queue handlers (the unified export pipeline)
  handle('render.start', async params => {
    const { renderQueue } = await import('./render-queue')
    return renderQueue.startJob(params)
  })

  handle('render.status', async ({ jobId }) => {
    const { renderQueue } = await import('./render-queue')
    const job = renderQueue.getJob(jobId)
    if (!job) return { success: false, error: `Job ${jobId} not found` }
    return {
      success: true,
      status: job.status,
      percent: job.percent,
      error: job.error,
    }
  })

  handle('render.cancel', async ({ jobId }) => {
    const { renderQueue } = await import('./render-queue')
    renderQueue.cancelJob(jobId)
    return { success: true }
  })

  handle('render.preview', async params => {
    const { renderQueue } = await import('./render-queue')
    return renderQueue.startPreviewJob(params)
  })

  handle('getHardwareEncoderCapabilities', async ({ forceRecheck }) => {
    const { findFfmpegPath } = await import('./ffmpeg-utils')
    const { detectHardwareEncoders, getEncoderDisplayName } = await import('./hardware-encoder')
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return {
        availableEncoders: [],
        preferredEncoder: null,
        preferredEncoderDisplayName: getEncoderDisplayName(null),
        hardwareAccelerationSupported: false,
      }
    }
    const caps = detectHardwareEncoders(ffmpegPath, forceRecheck)
    return {
      availableEncoders: caps.availableEncoders,
      preferredEncoder: caps.preferredEncoder,
      preferredEncoderDisplayName: getEncoderDisplayName(caps.preferredEncoder),
      hardwareAccelerationSupported: caps.hardwareAccelerationSupported,
    }
  })
}
