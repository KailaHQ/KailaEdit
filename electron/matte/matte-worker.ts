import { parentPort } from 'worker_threads'
import { createRequire } from 'module'
import type { AutoMatteDevice } from '../../core/src/project-model'

const require = createRequire(import.meta.url)

export interface MatteWorkerInitMessage {
  type: 'init'
  modelPath: string
  modelName: string
  device: AutoMatteDevice
  providerChain: string[]
  inferW: number
  inferH: number
  downsampleRatio: number
  warmupFrames?: number
  intraOpNumThreads?: number
}

export interface MatteWorkerFrameMessage {
  type: 'frame'
  frameIndex: number
  rgb: ArrayBuffer
  /**
   * Start this frame from a clean recurrent state, warming up again as after init. For an
   * unrelated picture — a still image on a reused worker — not for the next video frame.
   */
  resetState?: boolean
}

export interface MatteWorkerDisposeMessage {
  type: 'dispose'
}

/** Which execution providers can load the model here. Answered without an init. */
export interface MatteWorkerProbeMessage {
  type: 'probe'
  modelPath: string
  candidates: string[]
}

export type MatteWorkerInboundMessage =
  | MatteWorkerInitMessage
  | MatteWorkerFrameMessage
  | MatteWorkerDisposeMessage
  | MatteWorkerProbeMessage

export interface MatteWorkerReadyMessage {
  type: 'ready'
  provider: string
}

export interface MatteWorkerAlphaMessage {
  type: 'alpha'
  frameIndex: number
  alpha: ArrayBuffer
}

export interface MatteWorkerErrorMessage {
  type: 'error'
  frameIndex?: number
  error: string
}

export interface MatteWorkerProbeResultMessage {
  type: 'probe-result'
  available: string[]
  failures: string[]
}

/** The session is released and no inference is running: the worker can be stopped safely. */
export interface MatteWorkerDisposedMessage {
  type: 'disposed'
}

export type MatteWorkerOutboundMessage =
  | MatteWorkerDisposedMessage
  | MatteWorkerReadyMessage
  | MatteWorkerAlphaMessage
  | MatteWorkerErrorMessage
  | MatteWorkerProbeResultMessage

/** byte -> 0..1 lookup table so hot loop avoids divisions */
const BYTE_TO_UNIT = new Float32Array(256)
for (let i = 0; i < 256; i++) BYTE_TO_UNIT[i] = i / 255

const MATTE_FETCH_OUTPUTS = ['pha', 'r1o', 'r2o', 'r3o', 'r4o']
const MATTE_FETCH_WARMUP = ['r1o', 'r2o', 'r3o', 'r4o']

let ort: typeof import('onnxruntime-node') | null = null
let session: import('onnxruntime-node').InferenceSession | null = null
let usedProvider: string | null = null

let planarData: Float32Array | null = null
let srcTensor: import('onnxruntime-node').Tensor | null = null
let dsTensor: import('onnxruntime-node').Tensor | null = null
let r1: import('onnxruntime-node').Tensor | null = null
let r2: import('onnxruntime-node').Tensor | null = null
let r3: import('onnxruntime-node').Tensor | null = null
let r4: import('onnxruntime-node').Tensor | null = null

let totalPixels = 0
let configuredWarmupFrames = 0
let warmupFramesRemaining = 0
let isInitialized = false

// Inbound frame queue for sequential processing
const frameQueue: MatteWorkerFrameMessage[] = []
let isProcessingQueue = false

// Stopping. A worker thread must not be killed while the session is running a model: that is a
// native call into onnxruntime and, on DirectML, into the GPU driver, and tearing the thread down
// under it crashed the whole app. So a stop is a request: nothing new is started, what is running
// finishes, the session is released, and only then is `disposed` sent for the host to terminate.
let disposeRequested = false
let disposeAcknowledged = false
let initializing = false

function finishDispose(): void {
  if (disposeAcknowledged) return
  disposeAcknowledged = true
  disposeSession()
  parentPort!.postMessage({ type: 'disposed' } satisfies MatteWorkerDisposedMessage)
}

function requestDispose(): void {
  disposeRequested = true
  frameQueue.length = 0
  if (!isProcessingQueue && !initializing) finishDispose()
}

async function initSession(msg: MatteWorkerInitMessage): Promise<void> {
  initializing = true
  try {
    await createSession(msg)
  } catch (err) {
    // Asked to stop while the model was loading: there is nobody left to tell it failed.
    if (!disposeRequested) throw err
  } finally {
    initializing = false
    if (disposeRequested) finishDispose()
  }
}

async function createSession(msg: MatteWorkerInitMessage): Promise<void> {
  if (!ort) {
    ort = require('onnxruntime-node')
  }

  const {
    modelPath,
    modelName,
    device,
    providerChain,
    inferW,
    inferH,
    downsampleRatio,
    warmupFrames = 10,
    intraOpNumThreads = 2,
  } = msg

  totalPixels = inferW * inferH
  planarData = new Float32Array(3 * totalPixels)
  srcTensor = new ort!.Tensor('float32', planarData, [1, 3, inferH, inferW])
  dsTensor = new ort!.Tensor('float32', new Float32Array([downsampleRatio]), [1])

  const zeroState = new ort!.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
  r1 = zeroState
  r2 = zeroState
  r3 = zeroState
  r4 = zeroState

  configuredWarmupFrames = warmupFrames
  warmupFramesRemaining = warmupFrames

  const failures: string[] = []
  for (const ep of providerChain) {
    try {
      session = await ort!.InferenceSession.create(modelPath, {
        executionProviders: [ep] as never,
        intraOpNumThreads,
      })
      usedProvider = ep
      break
    } catch (err) {
      failures.push(`${ep}: ${String(err).slice(0, 200)}`)
    }
  }

  if (!session || !usedProvider) {
    throw new Error(
      device === 'gpu'
        ? `GPU not usable for background removal (${failures.join(' | ')}). Switch setting to Auto or CPU.`
        : `Could not create inference session for ${modelName} (${failures.join(' | ')})`,
    )
  }

  if (disposeRequested) return
  isInitialized = true
  parentPort!.postMessage({
    type: 'ready',
    provider: usedProvider,
  } satisfies MatteWorkerReadyMessage)
}

async function processSingleFrame(task: MatteWorkerFrameMessage): Promise<void> {
  if (!session || !srcTensor || !dsTensor || !r1 || !r2 || !r3 || !r4 || !planarData) {
    throw new Error('Matte worker received frame before initialization was completed')
  }

  const { frameIndex, rgb } = task
  if (task.resetState) {
    const zeroState = new ort!.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    r1 = zeroState
    r2 = zeroState
    r3 = zeroState
    r4 = zeroState
    warmupFramesRemaining = configuredWarmupFrames
  }
  const src = new Uint8Array(rgb)
  const offsetG = totalPixels
  const offsetB = 2 * totalPixels

  let j = 0
  for (let i = 0; i < totalPixels; i++) {
    planarData[i] = BYTE_TO_UNIT[src[j]]
    planarData[offsetG + i] = BYTE_TO_UNIT[src[j + 1]]
    planarData[offsetB + i] = BYTE_TO_UNIT[src[j + 2]]
    j += 3
  }

  // Recurrent warmup on the first frame
  while (warmupFramesRemaining > 0 && !disposeRequested) {
    warmupFramesRemaining--
    const warmupFeeds: Record<string, import('onnxruntime-node').Tensor> = {
      src: srcTensor,
      r1i: r1,
      r2i: r2,
      r3i: r3,
      r4i: r4,
      downsample_ratio: dsTensor,
    }
    const warmupResults = await session.run(warmupFeeds, MATTE_FETCH_WARMUP)
    r1 = warmupResults.r1o
    r2 = warmupResults.r2o
    r3 = warmupResults.r3o
    r4 = warmupResults.r4o
  }

  const feeds: Record<string, import('onnxruntime-node').Tensor> = {
    src: srcTensor,
    r1i: r1,
    r2i: r2,
    r3i: r3,
    r4i: r4,
    downsample_ratio: dsTensor,
  }

  if (disposeRequested) return
  const results = await session.run(feeds, MATTE_FETCH_OUTPUTS)
  r1 = results.r1o
  r2 = results.r2o
  r3 = results.r3o
  r4 = results.r4o

  const phaData = results.pha.data as Float32Array
  const alphaArray = new Uint8ClampedArray(totalPixels)
  for (let i = 0; i < totalPixels; i++) {
    alphaArray[i] = phaData[i] * 255
  }

  const alphaBuffer = alphaArray.buffer as ArrayBuffer
  parentPort!.postMessage(
    {
      type: 'alpha',
      frameIndex,
      alpha: alphaBuffer,
    } satisfies MatteWorkerAlphaMessage,
    [alphaBuffer],
  )
}

async function drainQueue(): Promise<void> {
  if (isProcessingQueue) return
  isProcessingQueue = true

  while (frameQueue.length > 0 && !disposeRequested) {
    const task = frameQueue.shift()!
    try {
      await processSingleFrame(task)
    } catch (err: any) {
      parentPort!.postMessage({
        type: 'error',
        frameIndex: task.frameIndex,
        error: err?.message || String(err),
      } satisfies MatteWorkerErrorMessage)
    }
  }

  isProcessingQueue = false
  if (disposeRequested) finishDispose()
}

/**
 * Loads the model once per candidate provider and keeps the ones that succeed. Creating a
 * DirectML session takes long enough to freeze whatever thread does it, so it happens here.
 */
async function probeProviders(msg: MatteWorkerProbeMessage): Promise<void> {
  if (!ort) {
    ort = require('onnxruntime-node')
  }
  const available: string[] = []
  const failures: string[] = []
  for (const ep of msg.candidates) {
    try {
      const probe = await ort!.InferenceSession.create(msg.modelPath, {
        executionProviders: [ep] as never,
        intraOpNumThreads: 1,
      })
      available.push(ep)
      try {
        if (typeof (probe as any).release === 'function') (probe as any).release()
      } catch {}
    } catch (err) {
      failures.push(`${ep}: ${String(err).slice(0, 160)}`)
    }
  }
  parentPort!.postMessage({ type: 'probe-result', available, failures } satisfies MatteWorkerProbeResultMessage)
}

function disposeSession(): void {
  if (session) {
    try {
      if (typeof (session as any).release === 'function') {
        ;(session as any).release()
      }
    } catch {}
    session = null
  }
  planarData = null
  srcTensor = null
  dsTensor = null
  r1 = null
  r2 = null
  r3 = null
  r4 = null
  isInitialized = false
}

if (parentPort) {
  parentPort.on('message', (msg: MatteWorkerInboundMessage) => {
    if (msg.type === 'init') {
      initSession(msg).catch((err) => {
        parentPort!.postMessage({
          type: 'error',
          error: err?.message || String(err),
        } satisfies MatteWorkerErrorMessage)
      })
    } else if (msg.type === 'frame') {
      if (disposeRequested) return
      frameQueue.push(msg)
      drainQueue().catch((err) => {
        parentPort!.postMessage({
          type: 'error',
          error: err?.message || String(err),
        } satisfies MatteWorkerErrorMessage)
      })
    } else if (msg.type === 'dispose') {
      requestDispose()
    } else if (msg.type === 'probe') {
      probeProviders(msg).catch((err) => {
        parentPort!.postMessage({
          type: 'error',
          error: err?.message || String(err),
        } satisfies MatteWorkerErrorMessage)
      })
    }
  })
}
