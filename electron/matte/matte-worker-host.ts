import path from 'path'
import fs from 'fs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { logger } from '../logger'
import type { AutoMatteDevice } from '../../core/src/project-model'
import type {
  MatteWorkerInitMessage,
  MatteWorkerOutboundMessage,
  MatteWorkerFrameMessage,
} from './matte-worker'

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

  return null
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

  private constructor(worker: Worker) {
    this.worker = worker
  }

  static async create(config: MatteWorkerHostConfig): Promise<MatteWorkerHost> {
    const workerPath = resolveMatteWorkerPath()
    if (!workerPath) {
      throw new Error('[matte-worker-host] matte-worker.js could not be resolved on disk')
    }

    const worker = new Worker(workerPath)
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
      if (!this.isTerminated && code !== 0) {
        if (this.errorListener) {
          this.errorListener(new Error(`Matte worker exited unexpectedly with code ${code}`))
        }
      }
    })
  }

  onAlpha(cb: (frameIndex: number, alpha: Buffer) => void): void {
    this.alphaListener = cb
  }

  onError(cb: (err: Error) => void): void {
    this.errorListener = cb
  }

  sendFrame(frameIndex: number, rgb: ArrayBuffer): void {
    if (this.isTerminated || !this.worker) {
      throw new Error('[matte-worker-host] Attempted to send frame to terminated worker')
    }
    const msg: MatteWorkerFrameMessage = {
      type: 'frame',
      frameIndex,
      rgb,
    }
    this.worker.postMessage(msg, [rgb])
  }

  getProvider(): string | null {
    return this.provider
  }

  terminate(): void {
    if (this.isTerminated) return
    this.isTerminated = true
    if (this.worker) {
      try {
        this.worker.terminate()
      } catch (err) {
        logger.warn(`[matte-worker-host] Error terminating worker: ${String(err)}`)
      }
      this.worker = null
    }
    this.alphaListener = null
    this.errorListener = null
  }
}
