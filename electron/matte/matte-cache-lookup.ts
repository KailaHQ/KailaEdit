import fs from 'fs'
import path from 'path'
import { ChildProcess } from 'child_process'
import { MatteWorkerHost } from './matte-worker-host'
import { logger } from '../logger'
import {
  autoMatteRangeCovers,
  downsampleRatioForInferenceSize,
  parseAutoMatteFingerprint,
  type AutoMatteSourceRange,
} from '../../core/src/auto-matte'
import {
  hasBakeManifestV2,
  validateBakeManifestV2,
} from '../../core/src/source-frame-index'
import type { AutoMatteModel, AutoMatteQuality, AutoMatteDevice } from '../../core/src/project-model'

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

export interface ActiveBakeRecord {
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
 * Maximum dimension fed to the matting model, per quality level:
 * - draft: 960 (fastest inference, good for quick review)
 * - standard: 1280 (balanced speed and fidelity, ~20ms/frame)
 * - high: 1920 (maximum hair and edge detail, feeds full 1080p/4K scaled down to 1080p)
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
 * recurrent state settle. Discarded output.
 */
export const MATTE_WARMUP_FRAMES = 10

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
export function findCoveringBake(
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
 * screen — there is no "later part of the media" that could be missing.
 */
export const STILL_BAKE_SPAN_SECONDS = 86400

/** Stable identity for a media file, for grouping the bakes made from it. */
export function normalizeAssetKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
