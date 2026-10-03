import path from 'path'
import fs from 'fs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { logger } from '../logger'
import type { AutoMatteDevice } from '../../core/src/project-model'
import type {
  MatteWorkerInboundMessage,
  MatteWorkerInitMessage,
  MatteWorkerOutboundMessage,
  MatteWorkerFrameMessage,
  MatteWorkerProbeMessage,
} from './matte-worker'

/** How long a worker told to stop may take to finish its run and release its session. */
const DISPOSE_GRACE_MS = 15_000

export function resolveMatteWorkerPath(): string | null {
  // 1. Packaged electron resources under app.asar.unpacked
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'matte-worker.js')
    if (fs.existsSync(unpacked)) return unpacked

    const direct = path.join(process.resourcesPath, 'dist-electron', 'matte-worker.js')
    if (fs.existsSync(direct)) return direct
  }

  // 2. Relative to import.meta.url in ESM contexts
  try {
    const metaUrl = fileURLToPath(new URL(/* @vite-ignore */ './matte-worker.js', import.meta.url))
    if (fs.existsSync(metaUrl)) return metaUrl

    const parentMetaUrl = fileURLToPath(new URL(/* @vite-ignore */ '../matte-worker.js', import.meta.url))
    if (fs.existsSync(parentMetaUrl)) return parentMetaUrl
  } catch {
    // Ignore in non-ESM environments
  }

  // 3. Relative to process.cwd() (dev mode)
  const devDistPath = path.resolve(process.cwd(), 'dist-electron', 'matte-worker.js')
  if (fs.existsSync(devDistPath)) return devDistPath

  // 4. Fallback relative to __dirname
  try {
    if (typeof __dirname !== 'undefined') {
      const dirPath = path.resolve(__dirname, 'matte-worker.js')
      if (fs.existsSync(dirPath)) return dirPath

      const parentDirPath = path.resolve(__dirname, '..', 'matte-worker.js')
      if (fs.existsSync(parentDirPath)) return parentDirPath
    }
  } catch {
    // Ignore
  }

  // 5. Fallback for test / dev environment before dist build: resolve TypeScript source
  try {
    const devTsPath = path.resolve(process.cwd(), 'electron', 'matte', 'matte-worker.ts')
    if (fs.existsSync(devTsPath)) return devTsPath
  } catch {
    // Ignore
  }

  try {
    const metaSource = fileURLToPath(new URL(/* @vite-ignore */ './matte-worker.ts', import.meta.url))
    if (fs.existsSync(metaSource)) return metaSource
  } catch {
    // Ignore
  }

  return null
}

function spawnMatteWorker(): Worker {
  const workerPath = resolveMatteWorkerPath()
  if (!workerPath) {
    throw new Error('[matte-worker-host] matte-worker.js could not be resolved on disk')
  }
  const workerOptions = workerPath.endsWith('.ts')
    ? { execArgv: ['--import', 'tsx'] }
    : undefined
  return new Worker(workerPath, workerOptions)
}

/**
 * Which execution providers can load the model, found on a worker thread.
 *
 * Loading the model on each provider — DirectML especially — blocked the main process for
 * about a second while it ran, freezing the window and the preview with it.
 */
export function probeProvidersInWorker(
  modelPath: string,
  candidates: string[],
): Promise<{ available: string[]; failures: string[] }> {
  const worker = spawnMatteWorker()
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      worker.removeAllListeners()
      worker.on('error', () => {}) // a late error from a worker being torn down is not news
      void worker.terminate().catch(() => {})
      settle()
    }
    worker.on('message', (msg: MatteWorkerOutboundMessage) => {
      if (msg.type === 'probe-result') finish(() => resolve({ available: msg.available, failures: msg.failures }))
      else if (msg.type === 'error') finish(() => reject(new Error(msg.error)))
    })
    worker.on('error', (err) => finish(() => reject(err)))
    worker.on('exit', (code) => finish(() => reject(new Error(`Matte worker exited with code ${code} while probing`))))
    worker.postMessage({ type: 'probe', modelPath, candidates } satisfies MatteWorkerProbeMessage)
  })
}

/** How long a still-image worker is kept loaded after its last use. */
const STILL_WORKER_IDLE_MS = 5 * 60 * 1000

let stillWorker: { key: string; host: MatteWorkerHost; idleTimer: NodeJS.Timeout | null } | null = null
let stillQueue: Promise<unknown> = Promise.resolve()

function stillWorkerKey(config: MatteWorkerHostConfig): string {
  return JSON.stringify([config.modelPath, config.providerChain, config.inferW, config.inferH,
    config.downsampleRatio, config.warmupFrames, config.intraOpNumThreads])
}

function dropStillWorker(): void {
  if (!stillWorker) return
  if (stillWorker.idleTimer) clearTimeout(stillWorker.idleTimer)
  stillWorker.host.terminate()
  stillWorker = null
}

/**
 * Mattes one still frame on a worker thread and returns its 8-bit alpha (inferW × inferH).
 *
 * Starting a worker and loading the model costs about a second on DirectML, so the worker
 * stays loaded for a few minutes for the next image of the same size. The model is
 * recurrent: each image starts from a reset state, or it would inherit the last picture's.
 * Images go through one at a time, as the worker answers frames in order.
 */
export function matteSingleFrame(
  config: MatteWorkerHostConfig,
  rgb: ArrayBuffer,
): Promise<{ alpha: Buffer; provider: string | null }> {
  const run = stillQueue.then(() => matteSingleFrameNow(config, rgb))
  stillQueue = run.catch(() => {})
  return run
}

async function matteSingleFrameNow(
  config: MatteWorkerHostConfig,
  rgb: ArrayBuffer,
): Promise<{ alpha: Buffer; provider: string | null }> {
  const key = stillWorkerKey(config)
  if (stillWorker && (stillWorker.key !== key || !stillWorker.host.isAlive())) dropStillWorker()

  const startedAt = Date.now()
  const reused = stillWorker !== null
  if (!stillWorker) {
    stillWorker = { key, host: await MatteWorkerHost.create(config), idleTimer: null }
  }
  const entry = stillWorker
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  const readyAt = Date.now()

  try {
    const alpha = await new Promise<Buffer>((resolve, reject) => {
      entry.host.onAlpha((_frameIndex, frameAlpha) => resolve(frameAlpha))
      entry.host.onError(reject)
      entry.host.sendFrame(0, rgb, { resetState: reused })
    })
    logger.info(
      `[matte-worker-host] Still frame ${config.inferW}x${config.inferH} on '${entry.host.getProvider()}': ` +
        `${reused ? 'reused worker' : `worker ready in ${readyAt - startedAt} ms`}, inference ${Date.now() - readyAt} ms`,
    )
    entry.idleTimer = setTimeout(() => {
      if (stillWorker === entry) dropStillWorker()
    }, STILL_WORKER_IDLE_MS)
    entry.idleTimer.unref?.()
    return { alpha, provider: entry.host.getProvider() }
  } catch (err) {
    // A worker that failed mid-frame is not trusted with the next image.
    if (stillWorker === entry) dropStillWorker()
    throw err
  }
}

/** Unloads the cached still-image worker now (tests, app shutdown). */
export function releaseStillMatteWorker(): void {
  dropStillWorker()
}

export interface MatteWorkerHostConfig {
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

export class MatteWorkerHost {
  private worker: Worker | null = null
  private provider: string | null = null
  private alphaListener: ((frameIndex: number, alpha: Buffer) => void) | null = null
  private errorListener: ((err: Error) => void) | null = null
  private isTerminated = false
  private stopped: Promise<void> | null = null
  private stoppedGracefully = false

  private constructor(worker: Worker) {
    this.worker = worker
  }

  static async create(config: MatteWorkerHostConfig): Promise<MatteWorkerHost> {
    const worker = spawnMatteWorker()
    const host = new MatteWorkerHost(worker)

    return new Promise<MatteWorkerHost>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        worker.removeListener('message', onInitMessage)
        worker.removeListener('error', onInitError)
      }

      const onInitMessage = (msg: MatteWorkerOutboundMessage) => {
        if (msg.type === 'ready') {
          if (!settled) {
            settled = true
            cleanup()
            host.provider = msg.provider
            host.attachListeners()
            resolve(host)
          }
        } else if (msg.type === 'error') {
          if (!settled) {
            settled = true
            cleanup()
            host.terminate()
            reject(new Error(msg.error))
          }
        }
      }

      const onInitError = (err: Error) => {
        if (!settled) {
          settled = true
          cleanup()
          host.terminate()
          reject(err)
        }
      }

      worker.on('message', onInitMessage)
      worker.on('error', onInitError)

      const initMsg: MatteWorkerInitMessage = {
        type: 'init',
        ...config,
      }
      worker.postMessage(initMsg)
    })
  }

  private attachListeners(): void {
    if (!this.worker || this.isTerminated) return

    this.worker.on('message', (msg: MatteWorkerOutboundMessage) => {
      if (this.isTerminated) return

      if (msg.type === 'alpha') {
        if (this.alphaListener) {
          const buf = Buffer.from(msg.alpha)
          this.alphaListener(msg.frameIndex, buf)
        }
      } else if (msg.type === 'error') {
        if (this.errorListener) {
          this.errorListener(new Error(`Worker error on frame ${msg.frameIndex ?? 'init'}: ${msg.error}`))
        }
      }
    })

    this.worker.on('error', (err: Error) => {
      if (this.isTerminated) return
      if (this.errorListener) {
        this.errorListener(err)
      }
    })

    this.worker.on('exit', (code) => {
      if (this.isTerminated) return
      // Gone on its own: mark it so, or a host kept for reuse would be sent frames nobody answers.
      const listener = this.errorListener
      this.isTerminated = true
      this.worker = null
      listener?.(new Error(`Matte worker exited unexpectedly with code ${code}`))
    })
  }

  onAlpha(cb: (frameIndex: number, alpha: Buffer) => void): void {
    this.alphaListener = cb
  }

  onError(cb: (err: Error) => void): void {
    this.errorListener = cb
  }

  sendFrame(frameIndex: number, rgb: ArrayBuffer, options: { resetState?: boolean } = {}): void {
    if (this.isTerminated || !this.worker) {
      throw new Error('[matte-worker-host] Attempted to send frame to terminated worker')
    }
    const msg: MatteWorkerFrameMessage = {
      type: 'frame',
      frameIndex,
      rgb,
      resetState: options.resetState,
    }
    this.worker.postMessage(msg, [rgb])
  }

  getProvider(): string | null {
    return this.provider
  }

  isAlive(): boolean {
    return !this.isTerminated && this.worker !== null
  }

  /**
   * Stops the worker, without waiting for it: returns at once and the host is dead to callers.
   *
   * The thread is not killed outright. If it is in the middle of a model run, which on DirectML
   * is a call into the GPU driver, killing it crashed the whole app (the log ends on "cancelled
   * and cleaned up" and the process is gone). The worker is asked to stop, finishes what it is
   * doing, releases its session and says so; only then is the thread terminated. A worker that
   * does not answer within `DISPOSE_GRACE_MS` is terminated anyway.
   */
  terminate(): void {
    if (this.isTerminated) return
    this.isTerminated = true
    this.alphaListener = null
    this.errorListener = null

    const worker = this.worker
    this.worker = null
    if (!worker) return

    this.stopped = new Promise<void>(resolve => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        resolve()
      }
      const forceStop = () => {
        try {
          void worker.terminate().catch(() => {})
        } catch (err) {
          logger.warn(`[matte-worker-host] Error terminating worker: ${String(err)}`)
        }
      }
      const timer = setTimeout(() => {
        logger.warn('[matte-worker-host] Worker did not release its session in time; terminating it')
        forceStop()
      }, DISPOSE_GRACE_MS)
      timer.unref?.()

      worker.on('message', (msg: MatteWorkerOutboundMessage) => {
        if (msg.type !== 'disposed') return
        this.stoppedGracefully = true
        forceStop()
      })
      worker.on('error', () => { /* a worker being stopped has nobody to report to */ })
      worker.on('exit', finish)

      try {
        worker.postMessage({ type: 'dispose' } satisfies MatteWorkerInboundMessage)
      } catch {
        forceStop()
      }
    })
  }

  /** Resolves once the worker thread is gone, however it was stopped. */
  whenStopped(): Promise<void> {
    return this.stopped ?? Promise.resolve()
  }

  /** Whether the worker released its session and said so before it was terminated. */
  wasStoppedGracefully(): boolean {
    return this.stoppedGracefully
  }
}
