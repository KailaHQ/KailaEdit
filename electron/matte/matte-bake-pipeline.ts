import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntryQuietly } from '../storage/remove-entry'
import { safeRename } from '../storage/safe-rename'
import { quietChildStdio } from '../process/quiet-child-stdio'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { onnxSessionManager, getProviderChain, resolveModelPath } from './onnx-session'
import { MatteWorkerHost } from './matte-worker-host'
import {
  BAKE_MANIFEST_VERSION,
  type BakeManifestV2,
  type BakeFrameMapEntry,
} from '../../core/src/source-frame-index'
import type { AutoMatteSourceRange } from '../../core/src/auto-matte'
import {
  getInferDimensions,
  MATTE_WARMUP_FRAMES,
  normalizeAssetKey,
  type MatteBakeJobParams,
  type ActiveBakeRecord,
} from './matte-cache-lookup'

export async function executeMatteBakePipeline(
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

  // Cancelled while the worker was starting: `cancelJob` found no host to stop, so this one
  // has to be stopped here, or the whole bake would run on after being cancelled.
  if (job.cancelled) {
    workerHost.terminate()
    return
  }

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
    '-crf',
    '1',
    '-profile:v',
    'high',
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
  quietChildStdio(encodeProcess, 'matte encode')

  job.decodeProcess = decodeProcess
  job.encodeProcess = encodeProcess

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

  // KE-1804: Write BakeManifestV2 alongside the MP4
  const actualSourceSpan = (encodedFrames / fps) * speed
  const frameDurationUs = Math.round(1_000_000 / fps)
  const frameMap: BakeFrameMapEntry[] = []
  for (let i = 0; i < encodedFrames; i++) {
    const sourcePts = Math.round(bakeRange.sourceStart * 1_000_000) + i * frameDurationUs
    frameMap.push({
      ordinal: i,
      sourceFrameId: i,
      sourcePts,
    })
  }

  const manifestV2: BakeManifestV2 = {
    version: BAKE_MANIFEST_VERSION,
    assetRevision: normalizeAssetKey(params.filePath),
    model: (params.model as string) || 'rvm-mobilenetv3',
    modelHash: '',
    pipelineVersion: 1,
    geometry: `${clipW}x${clipH}`,
    rotation: 0,
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
