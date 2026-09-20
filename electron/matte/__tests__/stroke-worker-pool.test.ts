import { describe, expect, it, afterAll } from 'vitest'
import { StrokeWorkerPool, strokeWorkerPool, resolveStrokeWorkerPath } from '../stroke-worker-pool'
import { renderStroke } from '../../../core/src/stroke-style'
import { DEFAULT_CLIP_STROKE } from '../../../core/src/project-model'
import type { ClipStroke } from '../../../core/src/project-model'
import { computeStrokeFingerprint } from '../stroke-bake'

describe('StrokeWorkerPool (KE-1501)', () => {
  afterAll(() => {
    strokeWorkerPool.terminate()
  })

  it('resolves the compiled stroke-worker.js file on disk', () => {
    const workerPath = resolveStrokeWorkerPath()
    expect(workerPath).toBeTruthy()
    expect(strokeWorkerPool.isAvailable()).toBe(true)
  })

  it('configures pool size according to min(8, cores/2)', () => {
    const poolSize = strokeWorkerPool.getPoolSize()
    expect(poolSize).toBeGreaterThanOrEqual(1)
    expect(poolSize).toBeLessThanOrEqual(8)
  })

  it('produces bit-identical RGBA output compared to synchronous renderStroke', async () => {
    const width = 120
    const height = 120
    const frameSize = width * height

    // Create a circular silhouette alpha mask
    const alphaDirect = new Uint8Array(frameSize)
    const centerX = 60
    const centerY = 60
    const radius = 30

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX
        const dy = y - centerY
        if (dx * dx + dy * dy <= radius * radius) {
          alphaDirect[y * width + x] = 255
        }
      }
    }

    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      enabled: true,
      style: 'solid',
      color: '#FF0055',
      width: 12,
      opacity: 0.9,
    }

    // 1. Direct synchronous execution
    const directClamped = renderStroke(alphaDirect, width, height, stroke)
    const directBuffer = Buffer.from(
      directClamped.buffer,
      directClamped.byteOffset,
      directClamped.byteLength,
    )

    // 2. Parallel worker execution
    const alphaForWorker = new Uint8Array(alphaDirect)
    const workerResultBuffer = await strokeWorkerPool.renderFrame(
      0,
      alphaForWorker.buffer as ArrayBuffer,
      width,
      height,
      stroke,
    )

    expect(workerResultBuffer.length).toBe(directBuffer.length)
    expect(Buffer.compare(directBuffer, workerResultBuffer)).toBe(0)
  })

  it('handles multiple concurrent frames and maintains pool reuse', async () => {
    const width = 80
    const height = 80
    const frameSize = width * height
    const frameCount = 12

    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      enabled: true,
      style: 'luminescence',
      color: '#00FFCC',
      width: 8,
      glow: 15,
    }

    // Batch 1: 12 frames
    const promises1 = Array.from({ length: frameCount }, (_, i) => {
      const alpha = new Uint8Array(frameSize).fill(i % 2 === 0 ? 255 : 0)
      return strokeWorkerPool.renderFrame(i, alpha.buffer as ArrayBuffer, width, height, stroke)
    })

    const results1 = await Promise.all(promises1)
    expect(results1).toHaveLength(frameCount)
    for (const res of results1) {
      expect(res.length).toBe(width * height * 4)
    }

    const activeWorkersAfterBatch1 = strokeWorkerPool.getActiveWorkerCount()
    expect(activeWorkersAfterBatch1).toBe(strokeWorkerPool.getPoolSize())

    // Batch 2: 12 more frames to confirm pool reuse without respawning
    const promises2 = Array.from({ length: frameCount }, (_, i) => {
      const alpha = new Uint8Array(frameSize).fill(200)
      return strokeWorkerPool.renderFrame(i + frameCount, alpha.buffer as ArrayBuffer, width, height, stroke)
    })

    const results2 = await Promise.all(promises2)
    expect(results2).toHaveLength(frameCount)
    expect(strokeWorkerPool.getActiveWorkerCount()).toBe(activeWorkersAfterBatch1)
  })

  /**
   * Added 18/09/2026, after one frame of a still image took 10.5 seconds to draw.
   *
   * Cancelling a bake called `terminate()` on the pool — a pool shared by every clip. The
   * next bake had to spawn eight workers again before drawing anything (10.5 s against
   * 0.4 s warm), and any other bake running at the time had its queued frames rejected
   * out from under it.
   */
  it('cancelling one bake keeps the pool alive and leaves other bakes alone', async () => {
    const pool = new StrokeWorkerPool(1)
    const width = 40
    const height = 40
    const frameSize = width * height
    const stroke: ClipStroke = { ...DEFAULT_CLIP_STROKE, enabled: true, style: 'solid', width: 4 }
    const frame = () => new Uint8Array(frameSize).fill(255).buffer as ArrayBuffer

    // One worker, so everything after the first frame waits in the queue.
    const busy = pool.renderFrame(0, frame(), width, height, stroke, 'clip-a')
    const doomed = pool.renderFrame(1, frame(), width, height, stroke, 'clip-a')
    const survivor = pool.renderFrame(2, frame(), width, height, stroke, 'clip-b')

    pool.cancelTasksFor('clip-a')

    await expect(doomed).rejects.toThrow(/cancelled/i)
    await expect(survivor).resolves.toBeInstanceOf(Buffer)
    await expect(busy).resolves.toBeInstanceOf(Buffer)

    // The pool itself is untouched, so the next bake does not pay for a respawn.
    expect(pool.getActiveWorkerCount()).toBe(1)
    const after = await pool.renderFrame(3, frame(), width, height, stroke, 'clip-c')
    expect(after).toBeInstanceOf(Buffer)

    pool.terminate()
  })

  it('terminates all workers cleanly without leaving processes alive', async () => {
    const customPool = new StrokeWorkerPool(2)
    const width = 50
    const height = 50
    const frameSize = width * height

    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      enabled: true,
      style: 'solid',
      width: 4,
    }

    // Run one task to ensure workers are spawned
    const alpha = new Uint8Array(frameSize).fill(255)
    await customPool.renderFrame(0, alpha.buffer as ArrayBuffer, width, height, stroke)
    expect(customPool.getActiveWorkerCount()).toBe(2)

    // Terminate
    customPool.terminate()
    expect(customPool.getActiveWorkerCount()).toBe(0)
  })

  it('computes content-addressed fingerprint that allows sharing between different clipIds (KE-1504)', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      enabled: true,
      style: 'solid',
      width: 8,
    }
    const fp1 = computeStrokeFingerprint('clip-1', stroke, 'matte_abc123')
    const fp2 = computeStrokeFingerprint('clip-2', stroke, 'matte_abc123')

    expect(fp1).toBe(fp2) // Reusable across different clips!
  })

  /**
   * This used to assert the opposite — that a different window of the same matte was a
   * different bake. That is what made a stroke cost one full bake per render-cache
   * segment: an 80-second clip is cut into three segments, so changing the stroke style
   * meant three ~80-second bakes of the same outline over the same footage.
   *
   * The stroke is now baked across the whole matte and seeked into, so every window of
   * one matte is one file. The seek lives in video-filter.ts and uses the same offset as
   * the matte input, because a stroke frame is drawn from the matte frame beside it.
   */
  it('depends on the matte and the look, and on nothing else (KE-1504)', () => {
    const stroke: ClipStroke = { ...DEFAULT_CLIP_STROKE, enabled: true, style: 'solid', width: 8 }

    expect(computeStrokeFingerprint('clip-1', stroke, 'matte_abc123'))
      .toBe(computeStrokeFingerprint('clip-1', stroke, 'matte_abc123'))

    // A different matte is still a different picture, so still a different bake.
    expect(computeStrokeFingerprint('clip-1', stroke, 'matte_abc123'))
      .not.toBe(computeStrokeFingerprint('clip-1', stroke, 'matte_def456'))

    // And so is a different look.
    expect(computeStrokeFingerprint('clip-1', stroke, 'matte_abc123'))
      .not.toBe(computeStrokeFingerprint('clip-1', { ...stroke, width: 9 }, 'matte_abc123'))
  })
})

