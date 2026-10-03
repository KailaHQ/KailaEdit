import os from 'os'
import { logger } from '../logger'
import { runFfmpegCapture } from './ffmpeg-utils'

export interface HardwareEncoderCapabilities {
  availableEncoders: string[]
  preferredEncoder: string | null
  hardwareAccelerationSupported: boolean
  probedAt: number
}

let cachedCapabilities: HardwareEncoderCapabilities | null = null

export function getHardwareEncoderCandidates(platform = os.platform()): string[] {
  if (platform === 'darwin') {
    return ['h264_videotoolbox']
  }
  if (platform === 'win32') {
    return ['h264_nvenc', 'h264_qsv', 'h264_amf']
  }
  // Linux & other Unix
  return ['h264_nvenc', 'h264_qsv', 'h264_vaapi']
}

export async function testEncoderAvailable(ffmpegPath: string, encoder: string): Promise<boolean> {
  try {
    // Note: NVIDIA NVENC requires a minimum resolution (usually >= 144x144).
    // Using 256x256 ensures hardware encoders initialize without "Frame Dimension less than minimum supported value" errors.
    const result = await runFfmpegCapture(
      ffmpegPath,
      ['-hide_banner', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.04', '-c:v', encoder, '-f', 'null', '-'],
      4000,
    )
    return result.status === 0
  } catch (err) {
    logger.warn(`[hardware-encoder] Probe failed for ${encoder}: ${String(err)}`)
    return false
  }
}

let probeInFlight: Promise<HardwareEncoderCapabilities> | null = null

/**
 * Finds the hardware encoders that actually work on this machine.
 *
 * Async because it runs at startup: through spawnSync, up to three ffmpeg probes (4 s
 * timeout each) froze the main process — the window included — right as the app opened.
 * The candidates are probed together; their order still decides which one is preferred.
 * An export that asks while the startup probe is running waits for that probe instead of
 * starting a second one.
 */
export function detectHardwareEncoders(
  ffmpegPath: string,
  forceRecheck = false,
  probeFn: (ffmpegPath: string, encoder: string) => Promise<boolean> | boolean = testEncoderAvailable,
): Promise<HardwareEncoderCapabilities> {
  if (cachedCapabilities && !forceRecheck) {
    return Promise.resolve(cachedCapabilities)
  }
  if (probeInFlight && !forceRecheck) {
    return probeInFlight
  }

  const probe = (async () => {
    logger.info('[hardware-encoder] Probing available hardware encoders...')
    const candidates = getHardwareEncoderCandidates()
    const results = await Promise.all(candidates.map(candidate => probeFn(ffmpegPath, candidate)))
    const availableEncoders = candidates.filter((_, index) => results[index])
    for (const encoder of availableEncoders) {
      logger.info(`[hardware-encoder] Hardware encoder confirmed available: ${encoder}`)
    }

    const preferredEncoder = availableEncoders.length > 0 ? availableEncoders[0] : null
    const hardwareAccelerationSupported = preferredEncoder !== null

    const capabilities: HardwareEncoderCapabilities = {
      availableEncoders,
      preferredEncoder,
      hardwareAccelerationSupported,
      probedAt: Date.now(),
    }
    cachedCapabilities = capabilities

    if (hardwareAccelerationSupported) {
      logger.info(`[hardware-encoder] Hardware acceleration enabled with encoder: ${preferredEncoder}`)
    } else {
      logger.info('[hardware-encoder] No operational hardware encoder found. Defaulting to libx264 (CPU).')
    }

    return capabilities
  })()

  probeInFlight = probe
  // Only the latest probe clears the slot; a forced recheck may have replaced it meanwhile.
  probe.finally(() => {
    if (probeInFlight === probe) probeInFlight = null
  }).catch(() => {}) // the caller handles a failed probe; this chain only clears the slot
  return probe
}

export function getCachedHardwareCapabilities(): HardwareEncoderCapabilities | null {
  return cachedCapabilities
}

export function setCachedHardwareCapabilitiesForTest(caps: HardwareEncoderCapabilities | null): void {
  cachedCapabilities = caps
}

export function getEncoderDisplayName(encoder: string | null | undefined): string {
  if (!encoder) return 'Software only (CPU: libx264)'
  switch (encoder) {
    case 'h264_nvenc':
      return 'NVIDIA NVENC (H.264)'
    case 'h264_qsv':
      return 'Intel Quick Sync (H.264)'
    case 'h264_videotoolbox':
      return 'Apple VideoToolbox (H.264)'
    case 'h264_amf':
      return 'AMD AMF (H.264)'
    case 'libx264':
      return 'CPU (libx264)'
    default:
      return encoder
  }
}

/**
 * Returns encoding arguments tailored to the given encoder.
 * Designed to preserve visual quality parity with libx264 at matching bitrates.
 */
export function getEncoderArgs(encoder: string, quality = 18, preset?: string): string[] {
  switch (encoder) {
    case 'h264_nvenc': {
      // NVENC uses -cq for Constant Quality (recommended values ~19-23)
      const cq = Math.max(1, Math.min(51, quality ? quality + 2 : 20))
      return ['-c:v', 'h264_nvenc', '-preset', preset || 'p4', '-cq', String(cq), '-pix_fmt', 'yuv420p']
    }
    case 'h264_qsv': {
      // Intel QSV uses -global_quality
      const gq = Math.max(1, Math.min(51, quality ? quality + 2 : 20))
      return ['-c:v', 'h264_qsv', '-preset', preset || 'medium', '-global_quality', String(gq), '-pix_fmt', 'yuv420p']
    }
    case 'h264_videotoolbox': {
      // macOS VideoToolbox quality is scale 1-100 (higher is better)
      const qv = Math.max(30, Math.min(100, Math.round(100 - (quality || 18) * 1.5)))
      return ['-c:v', 'h264_videotoolbox', '-q:v', String(qv), '-pix_fmt', 'yuv420p']
    }
    case 'h264_amf': {
      // AMD AMF Constant QP
      const qp = Math.max(1, Math.min(51, quality ? quality + 2 : 20))
      return ['-c:v', 'h264_amf', '-quality', preset || 'speed', '-rc', 'cqp', '-qp_p', String(qp), '-qp_i', String(qp), '-pix_fmt', 'yuv420p']
    }
    case 'libx264':
    default: {
      return ['-c:v', 'libx264', '-preset', preset || 'fast', '-crf', String(quality || 18), '-pix_fmt', 'yuv420p']
    }
  }
}