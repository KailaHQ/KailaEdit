import os from 'os'
import path from 'path'
import fs from 'fs'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { logger } from '../logger'
import type { ClipStroke } from '../../core/src/project-model'
import type { StrokeWorkerTask, StrokeWorkerResult } from './stroke-worker'

export function resolveStrokeWorkerPath(): string | null {
  // 1. Packaged electron resources under app.asar.unpacked
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'stroke-worker.js')
    if (fs.existsSync(unpacked)) return unpacked

    const direct = path.join(process.resourcesPath, 'dist-electron', 'stroke-worker.js')
    if (fs.existsSync(direct)) return direct
  }

  // 2. Relative to import.meta.url in ESM contexts
  try {
    const metaUrl = fileURLToPath(new URL(/* @vite-ignore */ './stroke-worker.js', import.meta.url))
    if (fs.existsSync(metaUrl)) return metaUrl

    const parentMetaUrl = fileURLToPath(new URL(/* @vite-ignore */ '../stroke-worker.js', import.meta.url))
    if (fs.existsSync(parentMetaUrl)) return parentMetaUrl
  } catch {
    // Ignore in non-ESM environments
  }

  // 3. Relative to process.cwd() (dev mode)
  const devDistPath = path.resolve(process.cwd(), 'dist-electron', 'stroke-worker.js')
  if (fs.existsSync(devDistPath)) return devDistPath

  // 4. Fallback relative to __dirname
  try {
    if (typeof __dirname !== 'undefined') {
      const dirPath = path.resolve(__dirname, 'stroke-worker.js')
      if (fs.existsSync(dirPath)) return dirPath

      const parentDirPath = path.resolve(__dirname, '..', 'stroke-worker.js')
      if (fs.existsSync(parentDirPath)) return parentDirPath
    }
  } catch {
    // Ignore
  }

  return null
}

interface WorkerEntry {
  worker: Worker
  busy: boolean
  currentResolve: ((rgba: Buffer) => void) | null
  currentReject: ((err: Error) => void) | null
  currentFrameIndex: number | null
}

interface QueuedTask {
  task: StrokeWorkerTask
  resolve: (rgba: Buffer) => void
  reject: (err: Error) => void
  /** Which bake asked for this frame, so one bake's cancellation only drops its own. */
  owner?: string
}

export class StrokeWorkerPool {
  private workers: WorkerEntry[] = []
  private taskQueue: QueuedTask[] = []
  private workerPath: string | null = null
  private poolSize: number
  private isTerminated = false

  constructor(customPoolSize?: number) {
    const cores = os.cpus()?.length || 4
    // min(8, cores/2), minimum 1
    this.poolSize = customPoolSize ?? Math.max(1, Math.min(8, Math.floor(cores / 2)))
  }

  getPoolSize(): number {
    return this.poolSize
  }

  getActiveWorkerCount(): number {
    return this.workers.length
  }

  isAvailable(): boolean {
    if (!this.workerPath) {
      this.workerPath = resolveStrokeWorkerPath()
    }
    return this.workerPath !== null
  }

  private initWorkersIfNeeded(): void {
    if (this.isTerminated) {
      this.isTerminated = false
    }

    if (this.workers.length >= this.poolSize) {
      return
    }

    if (!this.workerPath) {
      this.workerPath = resolveStrokeWorkerPath()
    }

    if (!this.workerPath) {
      throw new Error('stroke-worker.js could not be resolved on disk')
    }

    while (this.workers.length < this.poolSize) {
      this.spawnWorker()
    }
  }

  private spawnWorker(): WorkerEntry {
    const worker = new Worker(this.workerPath!)
    const entry: WorkerEntry = {
      worker,
      busy: false,
      currentResolve: null,
      currentReject: null,
      currentFrameIndex: null,
    }

    worker.on('message', (res: StrokeWorkerResult) => {
      const resolve = entry.currentResolve
      const reject = entry.currentReject

      entry.busy = false
      entry.currentResolve = null
      entry.currentReject = null
      entry.currentFrameIndex = null

      if ('error' in res && res.error) {
        if (reject) reject(new Error(`Worker failed on frame ${res.frameIndex}: ${res.error}`))
      } else if ('rgba' in res && res.rgba) {
        const rgbaBuf = Buffer.from(res.rgba)
        if (resolve) resolve(rgbaBuf)
      } else {
        if (reject) reject(new Error(`Invalid worker response on frame ${res.frameIndex}`))
      }

      // Check next task in queue
      this.drainQueue()
    })

    worker.on('error', (err) => {
      logger.error(`[stroke-worker-pool] Worker error: ${err.message}`)
      const reject = entry.currentReject
      entry.busy = false
      entry.currentResolve = null
      entry.currentReject = null
      entry.currentFrameIndex = null

      if (reject) {
        reject(err)
      }

      this.removeWorker(entry)
      if (!this.isTerminated) {
        this.spawnWorker()
        this.drainQueue()
      }
    })

    worker.on('exit', (code) => {
      if (entry.currentReject && code !== 0) {
        entry.currentReject(new Error(`Worker stopped unexpectedly with exit code ${code}`))
      }
      this.removeWorker(entry)
      if (!this.isTerminated && this.workers.length < this.poolSize) {
        this.spawnWorker()
        this.drainQueue()
      }
    })

    this.workers.push(entry)
    return entry
  }

  private removeWorker(entry: WorkerEntry): void {
    const idx = this.workers.indexOf(entry)
    if (idx >= 0) {
      this.workers.splice(idx, 1)
    }
  }

  private drainQueue(): void {
    if (this.taskQueue.length === 0 || this.isTerminated) return

    const idleWorker = this.workers.find((w) => !w.busy)
    if (!idleWorker) return

    const item = this.taskQueue.shift()
    if (!item) return

    this.dispatchTask(idleWorker, item)
  }

  private dispatchTask(entry: WorkerEntry, item: QueuedTask): void {
    entry.busy = true
    entry.currentResolve = item.resolve
    entry.currentReject = item.reject
    entry.currentFrameIndex = item.task.frameIndex

    entry.worker.postMessage(item.task, [item.task.alpha])
  }

  /**
   * Render a single stroke frame asynchronously using a worker thread.
   * `alpha` is transferred to the worker with zero-copy.
   */
  renderFrame(
    frameIndex: number,
    alpha: ArrayBuffer,
    width: number,
    height: number,
    stroke: ClipStroke,
    owner?: string,
  ): Promise<Buffer> {
    if (this.isTerminated) {
      this.initWorkersIfNeeded()
    }

    this.initWorkersIfNeeded()

    const task: StrokeWorkerTask = {
      frameIndex,
      alpha,
      width,
      height,
      stroke,
    }

    return new Promise<Buffer>((resolve, reject) => {
      const idleWorker = this.workers.find((w) => !w.busy)
      const queuedTask: QueuedTask = { task, resolve, reject, owner }

      if (idleWorker) {
        this.dispatchTask(idleWorker, queuedTask)
      } else {
        this.taskQueue.push(queuedTask)
      }
    })
  }

  /**
   * Terminate all workers immediately.
   */
  /**
   * Drops the queued frames belonging to one bake, and leaves everything else alone.
   *
   * Cancelling a bake used to call `terminate()`, which killed the whole pool — a pool
   * shared by every clip. The next bake then had to spawn eight workers again before it
   * could draw a single frame: one frame of a still image took 10.5 seconds that way,
   * against 0.4 seconds on a warm pool. It also rejected the queued frames of any *other*
   * bake running at the time, so cancelling one clip killed another clip's work.
   *
   * Frames already dispatched to a worker are left to finish. They take well under a
   * second and their results are discarded by the caller; interrupting them would mean
   * tearing the worker down, which is the cost this is avoiding.
   */
  cancelTasksFor(owner: string): void {
    if (this.taskQueue.length === 0) return
    const keep: QueuedTask[] = []
    for (const item of this.taskQueue) {
      if (item.owner === owner) item.reject(new Error('Stroke bake cancelled'))
      else keep.push(item)
    }
    this.taskQueue = keep
  }

  terminate(): void {
    this.isTerminated = true

    // Reject queued tasks
    while (this.taskQueue.length > 0) {
      const item = this.taskQueue.shift()
      if (item) {
        item.reject(new Error('Stroke worker pool terminated'))
      }
    }

    // Terminate all workers
    const entries = [...this.workers]
    this.workers = []

    for (const entry of entries) {
      if (entry.currentReject) {
        entry.currentReject(new Error('Stroke worker pool terminated'))
      }
      entry.worker.terminate().catch(() => {})
    }
  }
}

// Global shared worker pool singleton for stroke rendering
export const strokeWorkerPool = new StrokeWorkerPool()
