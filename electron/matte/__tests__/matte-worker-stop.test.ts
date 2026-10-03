import { describe, expect, it } from 'vitest'
import { Worker } from 'worker_threads'
import { MatteWorkerHost, resolveMatteWorkerPath } from '../matte-worker-host'
import { getProviderChain, resolveModelPath } from '../onnx-session'
import type { MatteWorkerOutboundMessage } from '../matte-worker'

/**
 * Stopping a matte worker must never kill its thread in the middle of a model run.
 *
 * Cancelling a background-removal job used to call `worker.terminate()` on the spot. When that
 * landed while onnxruntime was running the model on DirectML, the whole app died: the session
 * log ended on "cancelled and cleaned up" and the process was gone a third of a second later
 * (crashpad: "not connected"). A stop is now a request the worker answers once nothing is running
 * and its session is released. If this test file crashes the test runner, that has come back.
 */

const SIZE = 256
const modelPath = resolveModelPath('rvm_mobilenetv3')

const config = (warmupFrames: number) => ({
  modelPath,
  modelName: 'rvm_mobilenetv3',
  device: 'auto' as const,
  // The machine's own provider chain, so DirectML is the one under test where there is one.
  providerChain: getProviderChain('auto'),
  inferW: SIZE,
  inferH: SIZE,
  downsampleRatio: 0.25,
  warmupFrames,
  intraOpNumThreads: 1,
})

const rgbFrame = () => new Uint8Array(SIZE * SIZE * 3).fill(128).buffer as ArrayBuffer

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms)),
  ])
}

function rawWorker(): Worker {
  const path = resolveMatteWorkerPath()
  if (!path) throw new Error('matte worker not built')
  return new Worker(path, path.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : undefined)
}

function collect(worker: Worker): { messages: MatteWorkerOutboundMessage[]; waitFor: (type: string, ms?: number) => Promise<void> } {
  const messages: MatteWorkerOutboundMessage[] = []
  const listeners: Array<() => void> = []
  worker.on('message', (msg: MatteWorkerOutboundMessage) => {
    messages.push(msg)
    listeners.forEach(fn => fn())
  })
  return {
    messages,
    waitFor: (type, ms = 20_000) => withTimeout(new Promise<void>(resolve => {
      const check = () => { if (messages.some(m => m.type === type)) resolve() }
      listeners.push(check)
      check()
    }), ms, `a '${type}' message`),
  }
}

describe('stopping a matte worker', () => {
  it('lets a model run in progress finish, releases the session, then stops the thread', async () => {
    // Enough warmup passes that the run is certainly still going when the stop arrives.
    const host = await MatteWorkerHost.create(config(150))
    host.onError(() => {})
    host.sendFrame(0, rgbFrame())
    await new Promise(resolve => setTimeout(resolve, 300))

    const startedAt = Date.now()
    host.terminate()
    // The host is dead to callers at once, the thread is not.
    expect(Date.now() - startedAt).toBeLessThan(100)
    expect(() => host.sendFrame(1, rgbFrame())).toThrow('terminated worker')

    await withTimeout(host.whenStopped(), 30_000, 'the worker stopping')
    expect(host.wasStoppedGracefully()).toBe(true)
  }, 60_000)

  it('stops an idle worker straight away', async () => {
    const host = await MatteWorkerHost.create(config(1))
    host.terminate()
    await withTimeout(host.whenStopped(), 10_000, 'the worker stopping')
    expect(host.wasStoppedGracefully()).toBe(true)
  }, 60_000)

  it('is harmless to stop twice', async () => {
    const host = await MatteWorkerHost.create(config(1))
    host.terminate()
    expect(() => host.terminate()).not.toThrow()
    await withTimeout(host.whenStopped(), 10_000, 'the worker stopping')
  }, 60_000)

  it('honours a stop that arrives while the model is still loading: it never reports ready', async () => {
    const worker = rawWorker()
    const { messages, waitFor } = collect(worker)
    worker.postMessage({ type: 'init', ...config(5) })
    worker.postMessage({ type: 'dispose' })
    await waitFor('disposed')
    expect(messages.map(m => m.type)).not.toContain('ready')
    await worker.terminate()
  }, 60_000)

  it('does no more work once told to stop: frames that arrive after are ignored', async () => {
    const worker = rawWorker()
    const { messages, waitFor } = collect(worker)
    worker.postMessage({ type: 'init', ...config(1) })
    await waitFor('ready')
    worker.postMessage({ type: 'dispose' })
    const frame = rgbFrame()
    worker.postMessage({ type: 'frame', frameIndex: 0, rgb: frame }, [frame])
    await waitFor('disposed')
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(messages.map(m => m.type)).not.toContain('alpha')
    await worker.terminate()
  }, 60_000)

  it('stops sending alpha masks for frames still queued when the stop arrives', async () => {
    const worker = rawWorker()
    const { messages, waitFor } = collect(worker)
    worker.postMessage({ type: 'init', ...config(80) })
    await waitFor('ready')
    for (let i = 0; i < 5; i += 1) {
      const frame = rgbFrame()
      worker.postMessage({ type: 'frame', frameIndex: i, rgb: frame }, [frame])
    }
    await new Promise(resolve => setTimeout(resolve, 200))
    worker.postMessage({ type: 'dispose' })
    await waitFor('disposed')
    await new Promise(resolve => setTimeout(resolve, 500))
    // A frame that was mid-run when the stop came is abandoned too; none of the queue is served.
    expect(messages.filter(m => m.type === 'alpha').length).toBe(0)
    await worker.terminate()
  }, 60_000)
})
