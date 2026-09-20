import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntryQuietly } from '../storage/remove-entry'
import { safeRename } from '../storage/safe-rename'
import { quietChildStdio } from '../process/quiet-child-stdio'
import { logger } from '../logger'
import { renderStroke } from '../../core/src/stroke-style'
import type { ClipStroke } from '../../core/src/project-model'
import { strokeWorkerPool } from './stroke-worker-pool'
import { probeVideo } from '../media/probe'

/**
 * KE-1508: Maximum bytes buffered across completedFrames + encoder writable
 * buffer before decode is paused.  64 MB ≈ 7–8 RGBA frames at 1080×1920.
 * This replaces the old per-frame await-drain pattern that serialised the
 * three pipeline stages.
 */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024

export interface StrokeBakeParams {
  clipId: string
  mattePath: string
  matteFingerprint: string
  stroke: ClipStroke
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

/**
 * A stroke bake is identified by the matte it was drawn from and the stroke's look —
 * nothing about the clip that asked for it, and no window into the matte.
 *
 * It used to carry the window, and that is what made background removal so slow to
 * recache. The render cache cuts a clip into segments and asks for each one separately,
 * so one 80-second clip produced three near-identical stroke bakes, each a full pass of
 * the stroke renderer at ~100 ms a frame — about four minutes of work for something that
 * takes eighty seconds once. Re-splitting the timeline, or trimming by two frames,
 * changed every window and re-baked all of them. One machine had 72 stroke bakes on disk,
 * 3.6 GB, for a project with a single clip.
 *
 * Now the stroke is baked across the WHOLE matte and every consumer seeks into it, which
 * is the same trade `snapAutoMatteRange` already makes for mattes: bake a little more
 * than any one caller needs, once, and share it. A stroke frame is derived from the matte
 * frame at the same instant, so stroke time and matte time are the same clock — the
 * consumer seeks the stroke by exactly the offset it seeks the matte by.
 */
export function computeStrokeFingerprint(
  clipId: string,
  stroke: ClipStroke,
  matteFingerprint: string,
): string {
  // Content-addressed: clipId is intentionally excluded so split segments or duplicated
  // clips with the same matte frames and stroke parameters reuse the baked stroke file.
  const payload = [
    matteFingerprint,
    stroke.style,
    stroke.color,
    stroke.width,
    stroke.opacity,
    stroke.offsetX,
    stroke.offsetY,
    stroke.glow,
    stroke.roughness,
    stroke.gap,
    stroke.seed,
  ].join(':')
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16)
}



interface ActiveBakeHandle {
  clipId: string
  cancel: () => void
}

export class StrokeBakeService {
  private activeBakes = new Map<string, ActiveBakeHandle>()

  /**
   * Cancel an active stroke bake, killing ffmpeg processes and terminating workers.
   */
  cancel(clipId?: string): void {
    if (clipId) {
      const handle = this.activeBakes.get(clipId)
      if (handle) {
        handle.cancel()
        this.activeBakes.delete(clipId)
      }
    } else {
      for (const handle of this.activeBakes.values()) {
        handle.cancel()
      }
      this.activeBakes.clear()
    }
  }

  async ensureBake(params: StrokeBakeParams): Promise<{ success: boolean; strokePath?: string; error?: string }> {
    const { clipId, mattePath, matteFingerprint, stroke, onProgress, signal } = params

    if (!stroke.enabled || stroke.style === 'none' || stroke.width <= 0) {
      return { success: true }
    }

    if (signal?.aborted) {
      return { success: false, error: 'Cancelled' }
    }

    if (!fs.existsSync(mattePath)) {
      return { success: false, error: `Matte path does not exist: ${mattePath}` }
    }

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return { success: false, error: 'FFmpeg binary not found' }
    }

    const fingerprint = computeStrokeFingerprint(clipId, stroke, matteFingerprint)
    const cacheDir = path.join(renderCacheManager.getCacheDir(), 'stroke')
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }

    const finalPath = path.join(cacheDir, `stroke-${fingerprint}.mov`)
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
      logger.info(`[stroke-bake] Cache hit for ${clipId}: ${finalPath}`)
      if (onProgress) onProgress(100)
      return { success: true, strokePath: finalPath }
    }

    const partPath = path.join(cacheDir, `stroke-${fingerprint}.part.mov`)
    removeEntryQuietly(partPath)

    const probe = await probeVideo(ffmpegPath, mattePath)
    const { width, height, fps } = probe
    const frameSize = width * height

    // The whole matte, always. Drawing only the caller's window is what used to produce
    // one bake per render-cache segment — see computeStrokeFingerprint.
    const drawDuration = probe.duration
    const expectedFrames = Math.max(1, Math.round(drawDuration * fps))

    const useWorkerPool = strokeWorkerPool.isAvailable()
    const poolSize = useWorkerPool ? strokeWorkerPool.getPoolSize() : 1
    const maxInFlight = Math.max(4, poolSize * 2)

    logger.info(
      `[stroke-bake] Starting stroke bake for ${clipId} (${width}x${height} @ ${fps}fps, style=${stroke.style}, workers=${poolSize}) -> ${partPath}`,
    )

    // Decode grayscale matte frames from mattePath
    const decodeProcess = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        mattePath,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-an',
        'pipe:1',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    quietChildStdio(decodeProcess, 'stroke-bake decode')

    // Encode RGBA stroke video into QuickTime MOV with png codec (lossless with alpha)
    const encodeProcess = spawn(
      ffmpegPath,
      [
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${width}x${height}`,
        '-r',
        `${fps}`,
        '-i',
        'pipe:0',
        '-c:v',
        'png',
        '-pix_fmt',
        'rgba',
        '-an',
        partPath,
      ],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
    )
    // Cancelling this bake SIGKILLs the encoder while frames are still queued for its
    // stdin. Without a listener that flush crashes the main process. See quietChildStdio.
    quietChildStdio(encodeProcess, 'stroke-bake encode')

    const startTime = process.hrtime.bigint()

    return new Promise((resolve) => {
      let isDone = false
      let isCancelled = false
      let frameIndex = 0
      let nextWriteIndex = 0
      let inFlightCount = 0
      let decodeClosed = false
      let leftover = Buffer.alloc(0)
      const completedFrames = new Map<number, Buffer>()
      let bufferedBytes = 0

      const cleanupAndFinish = (res: { success: boolean; strokePath?: string; error?: string }) => {
        if (isDone) return
        isDone = true
        this.activeBakes.delete(clipId)

        if (!res.success) {
          removeEntryQuietly(partPath)
        }
        resolve(res)
      }

      const doCancel = () => {
        if (isDone || isCancelled) return
        isCancelled = true
        logger.info(`[stroke-bake] Bake cancelled for ${clipId}`)

        try { decodeProcess.kill('SIGKILL') } catch {}
        try { encodeProcess.kill('SIGKILL') } catch {}

        if (useWorkerPool) {
          // Only this bake's queued frames. The pool is shared by every clip, and taking
          // it down here made the next bake pay a full eight-worker respawn.
          strokeWorkerPool.cancelTasksFor(clipId)
        }

        cleanupAndFinish({ success: false, error: 'Cancelled' })
      }

      this.activeBakes.set(clipId, { clipId, cancel: doCancel })
      if (signal) {
        signal.addEventListener('abort', doCancel, { once: true })
      }

      const checkAllWrittenAndEnd = () => {
        if (decodeClosed && inFlightCount === 0 && nextWriteIndex >= frameIndex) {
          if (!encodeProcess.stdin.destroyed) {
            encodeProcess.stdin.end()
          }
        }
      }

      // KE-1508: Synchronous, non-blocking write loop.  Frames are written to
      // the encoder in order without awaiting drain, so decode and stroke
      // rendering can overlap with encoding.  Memory-based backpressure
      // (manageBackpressure) replaces the per-frame drain wait.
      const flushFramesInOrder = () => {
        if (isDone || isCancelled) return

        while (completedFrames.has(nextWriteIndex) && !isCancelled) {
          const buf = completedFrames.get(nextWriteIndex)!
          completedFrames.delete(nextWriteIndex)
          bufferedBytes -= buf.length

          if (!encodeProcess.stdin.destroyed) {
            encodeProcess.stdin.write(buf)
          }

          nextWriteIndex++
          if (onProgress && expectedFrames > 0) {
            const percent = Math.min(99, Math.round((nextWriteIndex / expectedFrames) * 100))
            onProgress(percent)
          }
        }

        manageBackpressure()
        checkAllWrittenAndEnd()
      }

      // Unified backpressure: decode is paused when either the worker pool is
      // saturated or the combined memory in completedFrames + encoder's writable
      // buffer exceeds the threshold.  It is resumed only when BOTH are below
      // their respective limits.
      const manageBackpressure = () => {
        if (isDone || isCancelled) return
        const encoderPending = encodeProcess.stdin.writableLength ?? 0
        const totalBuffered = bufferedBytes + encoderPending
        const memoryOk = totalBuffered < MAX_BUFFERED_BYTES / 2
        const inFlightOk = inFlightCount < maxInFlight

        if (decodeProcess.stdout.isPaused() && memoryOk && inFlightOk) {
          decodeProcess.stdout.resume()
        } else if (!decodeProcess.stdout.isPaused() && (!memoryOk || !inFlightOk)) {
          decodeProcess.stdout.pause()
        }
      }

      // When the encoder drains its internal buffer, reassess whether decode
      // should be resumed — this is the signal that lets the pipeline overlap.
      encodeProcess.stdin.on('drain', () => {
        if (!isDone && !isCancelled) manageBackpressure()
      })

      decodeProcess.stdout.on('data', (chunk: Buffer) => {
        if (isDone || isCancelled) return

        const combined = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk
        let offset = 0

        while (offset + frameSize <= combined.length && !isCancelled) {
          const currentIndex = frameIndex++
          inFlightCount++

          if (useWorkerPool) {
            // Transferable zero-copy slice
            const alphaSub = combined.subarray(offset, offset + frameSize)
            const frameBuffer = alphaSub.buffer.slice(
              alphaSub.byteOffset,
              alphaSub.byteOffset + alphaSub.byteLength,
            ) as ArrayBuffer

            strokeWorkerPool.renderFrame(currentIndex, frameBuffer, width, height, stroke, clipId)
              .then((rgbaBuf) => {
                if (isDone || isCancelled) return
                completedFrames.set(currentIndex, rgbaBuf)
                bufferedBytes += rgbaBuf.length
                inFlightCount--

                flushFramesInOrder()
              })
              .catch((err) => {
                if (isDone || isCancelled) return
                logger.error(`[stroke-bake] Worker error on frame ${currentIndex}: ${err.message}`)
                decodeProcess.kill('SIGKILL')
                encodeProcess.kill('SIGKILL')
                cleanupAndFinish({ success: false, error: err.message })
              })
          } else {
            // Fallback: synchronous render on main thread
            const alphaFrame = new Uint8Array(combined.buffer, combined.byteOffset + offset, frameSize)
            const rgbaClamped = renderStroke(alphaFrame, width, height, stroke)
            const rgbaBuf = Buffer.from(rgbaClamped.buffer as ArrayBuffer, rgbaClamped.byteOffset, rgbaClamped.byteLength)
            completedFrames.set(currentIndex, rgbaBuf)
            bufferedBytes += rgbaBuf.length
            inFlightCount--
            flushFramesInOrder()
          }

          offset += frameSize

          // Pause decode eagerly if memory or in-flight limits are exceeded.
          // Resume is handled by manageBackpressure() in worker callbacks
          // and the encoder's drain event.
          if (!decodeProcess.stdout.isPaused()) {
            const totalBuffered = bufferedBytes + (encodeProcess.stdin.writableLength ?? 0)
            if (inFlightCount >= maxInFlight || totalBuffered > MAX_BUFFERED_BYTES) {
              decodeProcess.stdout.pause()
            }
          }
        }

        leftover = Buffer.from(combined.subarray(offset))
      })

      decodeProcess.on('error', (err) => {
        if (isDone || isCancelled) return
        logger.error(`[stroke-bake] Decode error: ${err}`)
        encodeProcess.stdin.end()
        cleanupAndFinish({ success: false, error: err.message })
      })

      decodeProcess.on('close', async () => {
        decodeClosed = true
        checkAllWrittenAndEnd()
      })

      encodeProcess.on('error', (err) => {
        if (isDone || isCancelled) return
        logger.error(`[stroke-bake] Encode error: ${err}`)
        cleanupAndFinish({ success: false, error: err.message })
      })

      encodeProcess.on('close', async (code) => {
        if (isDone || isCancelled) return

        // `frameIndex > 0` matters: an encoder handed no frames still exits 0 and still
        // leaves a container header on disk, which passed the size check and was cached as
        // a finished stroke. The clip then had a stroke file with nothing in it, and the
        // outline silently never appeared.
        if (code === 0 && frameIndex > 0 && fs.existsSync(partPath) && fs.statSync(partPath).size > 0) {
          try {
            await safeRename(partPath, finalPath)
            const elapsedMs = Number((process.hrtime.bigint() - startTime) / 1_000_000n)
            const msPerFrame = frameIndex > 0 ? (elapsedMs / frameIndex).toFixed(1) : '0'
            logger.info(
              `[stroke-bake] Successfully baked ${frameIndex} frames to ${finalPath} in ${elapsedMs}ms (${msPerFrame} ms/frame, workers=${poolSize})`,
            )
            if (onProgress) onProgress(100)
            cleanupAndFinish({ success: true, strokePath: finalPath })
          } catch (err: any) {
            logger.error(`[stroke-bake] Failed to rename baked file: ${err}`)
            cleanupAndFinish({ success: false, error: `Rename failed: ${err.message}` })
          }
        } else {
          const why = frameIndex === 0
            ? 'no frames were produced'
            : `encoder exited with code ${code}`
          logger.warn(`[stroke-bake] Bake for ${clipId} produced nothing: ${why}`)
          cleanupAndFinish({ success: false, error: `Stroke bake failed: ${why}` })
        }
      })
    })
  }
}

export const strokeBakeService = new StrokeBakeService()
