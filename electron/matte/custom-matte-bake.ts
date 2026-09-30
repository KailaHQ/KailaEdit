import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntryQuietly } from '../storage/remove-entry'
import { quietChildStdio } from '../process/quiet-child-stdio'
import { logger } from '../logger'
import { rasterizeStrokes, blendCustomMatte, computeStrokesHash, customMatteStartsEmpty, warpMask } from '../../core/src/custom-matte'
import { frameToReference, motionHash, strokeToReference, type MatteMotion } from '../../core/src/matte-motion'
import { isNearIdentity } from '../../core/src/global-motion'
import type { BrushStroke } from '../../core/src/project-model'
import { probeVideo } from '../media/probe'

export interface CustomMatteBakeParams {
  clipId: string
  baseMattePath?: string
  baseMatteFingerprint?: string
  filePath?: string
  trimStart?: number
  duration: number
  speed?: number
  /** Seconds into the base matte where this clip begins. See autoMatteBakeOffset. */
  baseMatteOffset?: number
  baseMattePlaybackRate?: number
  strokes: BrushStroke[]
  /** How the picture moves over the source, when the camera does. See core/matte-motion. */
  motion?: MatteMotion
  onProgress?: (percent: number) => void
}

export function computeCustomMatteFingerprint(
  clipId: string,
  strokes: BrushStroke[],
  baseFingerprint?: string,
  /**
   * Where this bake sits inside its base matte, and how long it is.
   *
   * The base matte is shared between trims now, so its fingerprint no longer says which
   * frames were used. Without the window in here, two different trims of one clip would
   * hash the same and the second would be served the first one's file.
   */
  window?: { offset: number; duration: number; playbackRate?: number },
  /** The picture's motion, and where the clip sits in its source: both change every frame of the bake. */
  motion?: { motion: MatteMotion; trimStart: number; speed: number },
): string {
  const strokesHash = computeStrokesHash(strokes)
  const windowKey = window
    ? `${window.offset.toFixed(4)}:${window.duration.toFixed(4)}:${(window.playbackRate ?? 1).toFixed(4)}`
    : 'full'
  // `v2`: a brush with no base matte keeps only what it paints; earlier bakes kept everything.
  // `v3`: a shot with camera motion carries the matte along with it.
  const motionKey = motion
    ? `${motionHash(motion.motion)}:${motion.trimStart.toFixed(4)}:${motion.speed.toFixed(4)}`
    : ''
  const payload = [motion ? 'v3' : 'v2', clipId, strokesHash, baseFingerprint || 'no-base', windowKey, motionKey].join(':')
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16)
}



export interface CustomMatteBakeResult {
  success: boolean
  mattePath?: string
  fingerprint?: string
  frameCount?: number
  error?: string
}

export class CustomMatteBakeService {
  public async ensureBake(params: CustomMatteBakeParams): Promise<CustomMatteBakeResult> {
    const { clipId, baseMattePath, baseMatteFingerprint, filePath, duration, strokes, motion, onProgress } = params
    const trimStart = params.trimStart ?? 0
    const clipSpeed = params.speed ?? 1
    const baseMatteOffset = Math.max(0, params.baseMatteOffset ?? 0)
    const baseMattePlaybackRate = params.baseMattePlaybackRate ?? 1

    if (!strokes || strokes.length === 0) {
      if (baseMattePath) {
        return { success: true, mattePath: baseMattePath, fingerprint: baseMatteFingerprint }
      }
      return { success: false, error: 'No strokes or base matte provided' }
    }

    const fingerprint = computeCustomMatteFingerprint(clipId, strokes, baseMatteFingerprint, {
      offset: baseMatteOffset,
      duration,
      playbackRate: baseMattePlaybackRate,
    }, motion ? { motion, trimStart, speed: clipSpeed } : undefined)
    const cacheDir = renderCacheManager.getCacheDir()
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    const finalPath = path.join(cacheDir, `custom_matte_${clipId}_${fingerprint}.mp4`)
    const partPath = `${finalPath}.part.mp4`

    if (fs.existsSync(finalPath)) {
      const stats = fs.statSync(finalPath)
      if (stats.size > 0) {
        logger.info(`[custom-matte-bake] Using cached custom matte: ${finalPath}`)
        if (onProgress) onProgress(100)
        return { success: true, mattePath: finalPath, fingerprint }
      }
    }

    removeEntryQuietly(partPath)

    const probeSource = baseMattePath || filePath
    if (!probeSource || !fs.existsSync(probeSource)) {
      return { success: false, error: `Cannot probe source media for custom matte: ${probeSource}` }
    }

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return { success: false, error: 'FFmpeg binary not found' }
    }

    const probe = await probeVideo(ffmpegPath, probeSource)
    const width = probe.width
    const height = probe.height
    const fps = probe.fps || 30
    const effDuration = duration > 0 ? duration : (probe.duration || 5)
    const frameSize = width * height
    const expectedFrames = Math.max(1, Math.round(effDuration * fps))

    logger.info(
      `[custom-matte-bake] Baking custom matte for ${clipId} (${width}x${height} @ ${fps}fps, ${strokes.length} strokes) -> ${partPath}`,
    )

    // Pre-rasterize strokes into width x height mask
    const raster = rasterizeStrokes(strokes, width, height, {
      toReference: motion ? paintedAt => strokeToReference(motion, paintedAt, trimStart, clipSpeed) : undefined,
    })
    // The masks as they lie on this frame of the clip. A still, or a shot the camera does not
    // move in, is the same for every frame.
    const scratch = { brush: new Uint8Array(frameSize), eraser: new Uint8Array(frameSize) }
    const masksForFrame = (frameIndex: number): { brushMask: Uint8Array; eraserMask: Uint8Array } => {
      if (!motion) return raster
      const sourceTime = trimStart + (frameIndex / fps) * clipSpeed
      const toRef = frameToReference(motion, sourceTime)
      if (isNearIdentity(toRef, 5e-4)) return raster
      return {
        brushMask: warpMask(raster.brushMask, width, height, toRef, scratch.brush),
        eraserMask: warpMask(raster.eraserMask, width, height, toRef, scratch.eraser),
      }
    }

    // Output video encoder
    const encodeProcess: any = spawn(
      ffmpegPath,
      [
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-s',
        `${width}x${height}`,
        '-r',
        `${fps}`,
        '-i',
        'pipe:0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-an',
        partPath,
      ],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
    )
    quietChildStdio(encodeProcess, 'custom-matte encode')

    if (baseMattePath && fs.existsSync(baseMattePath)) {
      // Decode existing base matte frames and blend
      const decodeProcess: any = spawn(
        ffmpegPath,
        [
          '-y',
          // The base matte may cover more than this clip — start where the clip does.
          ...(baseMatteOffset > 0.0005 ? ['-ss', baseMatteOffset.toFixed(6)] : []),
          '-i',
          baseMattePath,
          '-vf',
          `setpts=(PTS-STARTPTS)/${baseMattePlaybackRate.toFixed(6)},fps=${fps}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          '-an',
          'pipe:1',
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      quietChildStdio(decodeProcess, 'custom-matte decode')

      return new Promise((resolve) => {
        let frameIndex = 0
        let leftover: Buffer = Buffer.alloc(0)

        decodeProcess.stdout.on('data', async (chunk: Buffer) => {
          decodeProcess.stdout.pause()
          const combined = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk
          let offset = 0

          while (offset + frameSize <= combined.length) {
            const alphaFrame = new Uint8Array(combined.buffer, combined.byteOffset + offset, frameSize)
            const masks = masksForFrame(frameIndex)
            const blended = blendCustomMatte(alphaFrame, masks.brushMask, masks.eraserMask, width, height)
            const outBuf = Buffer.from(blended.buffer as ArrayBuffer, blended.byteOffset, blended.byteLength)

            if (!encodeProcess.stdin.destroyed) {
              const canWrite = encodeProcess.stdin.write(outBuf)
              if (!canWrite) {
                await new Promise<void>((r) => encodeProcess.stdin.once('drain', r))
              }
            }

            frameIndex++
            offset += frameSize

            if (onProgress && expectedFrames > 0) {
              const percent = Math.min(99, Math.round((frameIndex / expectedFrames) * 100))
              onProgress(percent)
            }
          }

          leftover = Buffer.from(combined.subarray(offset))
          decodeProcess.stdout.resume()
        })

        decodeProcess.on('close', () => {
          encodeProcess.stdin.end()
        })

        encodeProcess.on('close', (code: number | null) => {
          if (code === 0 && fs.existsSync(partPath)) {
            try {
              fs.renameSync(partPath, finalPath)
              if (onProgress) onProgress(100)
              resolve({ success: true, mattePath: finalPath, fingerprint, frameCount: expectedFrames })
            } catch (err: any) {
              resolve({ success: false, error: err.message })
            }
          } else {
            removeEntryQuietly(partPath)
            resolve({ success: false, error: `Encoding failed with code ${code}` })
          }
        })
      })
    } else {
      // No base matte: initialize solid opaque base (255) and blend
      return new Promise((resolve) => {
        const startsEmpty = customMatteStartsEmpty(strokes, false)
        const solidFrame = (index: number): Buffer => {
          const masks = masksForFrame(index)
          const blended = blendCustomMatte(null, masks.brushMask, masks.eraserMask, width, height, startsEmpty)
          return Buffer.from(blended.buffer, blended.byteOffset, blended.byteLength)
        }
        // With no motion every frame is the same, so it is built once.
        const staticBuf: Buffer | null = motion ? null : solidFrame(0)

        let written = 0
        const writeFrames = async () => {
          while (written < expectedFrames) {
            if (encodeProcess.stdin.destroyed) break
            const canWrite = encodeProcess.stdin.write(staticBuf ?? solidFrame(written))
            written++

            if (onProgress && expectedFrames > 0) {
              onProgress(Math.min(99, Math.round((written / expectedFrames) * 100)))
            }

            if (!canWrite) {
              await new Promise<void>((r) => encodeProcess.stdin.once('drain', r))
            }
          }
          encodeProcess.stdin.end()
        }

        writeFrames().catch((err) => {
          logger.warn(`[custom-matte-bake] Frame write error: ${err}`)
          encodeProcess.stdin.end()
        })

        encodeProcess.on('close', (code: number | null) => {
          if (code === 0 && fs.existsSync(partPath)) {
            try {
              fs.renameSync(partPath, finalPath)
              if (onProgress) onProgress(100)
              resolve({ success: true, mattePath: finalPath, fingerprint, frameCount: expectedFrames })
            } catch (err: any) {
              resolve({ success: false, error: err.message })
            }
          } else {
            removeEntryQuietly(partPath)
            resolve({ success: false, error: `Encoding solid matte failed with code ${code}` })
          }
        })
      })
    }
  }
}

export const customMatteBakeService = new CustomMatteBakeService()
