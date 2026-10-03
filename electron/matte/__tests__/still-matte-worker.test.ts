import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'module'
import { MatteWorkerHost, matteSingleFrame, probeProvidersInWorker, releaseStillMatteWorker, type MatteWorkerHostConfig } from '../matte-worker-host'
import { resolveModelPath } from '../onnx-session'

const require = createRequire(import.meta.url)

const W = 64
const H = 64
const PIXELS = W * H

function syntheticRgb(seed: number): Uint8Array {
  const rgb = new Uint8Array(PIXELS * 3)
  for (let i = 0; i < PIXELS; i++) {
    rgb[i * 3] = (i * 7 + seed) % 256
    rgb[i * 3 + 1] = (i * 13 + seed * 3) % 256
    rgb[i * 3 + 2] = (i * 19 + seed * 5) % 256
  }
  return rgb
}

const cpuConfig: MatteWorkerHostConfig = {
  modelPath: resolveModelPath('rvm_mobilenetv3'),
  modelName: 'rvm_mobilenetv3',
  device: 'cpu',
  providerChain: ['cpu'],
  inferW: W,
  inferH: H,
  downsampleRatio: 0.25,
  warmupFrames: 8,
  intraOpNumThreads: 1,
}

/** What image-matte computed on the main process before inference moved to a worker. */
async function mainProcessReference(rgb: Uint8Array): Promise<Buffer> {
  const ort: typeof import('onnxruntime-node') = require('onnxruntime-node')
  const session = await ort.InferenceSession.create(cpuConfig.modelPath, { executionProviders: ['cpu'], intraOpNumThreads: 1 })
  const planar = new Float32Array(3 * PIXELS)
  for (let i = 0; i < PIXELS; i++) {
    planar[i] = rgb[i * 3] / 255.0
    planar[PIXELS + i] = rgb[i * 3 + 1] / 255.0
    planar[2 * PIXELS + i] = rgb[i * 3 + 2] / 255.0
  }
  const src = new ort.Tensor('float32', planar, [1, 3, H, W])
  const ds = new ort.Tensor('float32', new Float32Array([cpuConfig.downsampleRatio]), [1])
  let r: any[] = [0, 0, 0, 0].map(() => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]))
  const feeds = () => ({ src, r1i: r[0], r2i: r[1], r3i: r[2], r4i: r[3], downsample_ratio: ds })
  for (let w = 0; w < 8; w++) {
    const res = await session.run(feeds(), ['r1o', 'r2o', 'r3o', 'r4o'])
    r = [res.r1o, res.r2o, res.r3o, res.r4o]
  }
  const pha = (await session.run(feeds(), ['pha'])).pha.data as Float32Array
  const out = Buffer.alloc(PIXELS)
  for (let i = 0; i < PIXELS; i++) out[i] = Math.round(Math.max(0, Math.min(1, pha[i])) * 255)
  return out
}

function maxDifference(a: Buffer, b: Buffer): number {
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]))
  return max
}

describe('still-image matte on a worker thread', () => {
  afterEach(() => releaseStillMatteWorker())

  it('gives the mask the main process used to compute', async () => {
    const rgb = syntheticRgb(0)
    const expected = await mainProcessReference(rgb)
    const { alpha: actual, provider } = await matteSingleFrame(cpuConfig, new Uint8Array(rgb).buffer as ArrayBuffer)
    expect(provider).toBe('cpu')
    expect(actual.length).toBe(PIXELS)
    // Same model, inputs and passes; only the float→byte rounding differs, on exact halves.
    expect(maxDifference(actual, expected)).toBeLessThanOrEqual(1)
  }, 30_000)

  it('carries nothing from one image into the next on a reused worker', async () => {
    const first = syntheticRgb(1)
    const second = syntheticRgb(2)
    const { alpha: secondAlone } = await matteSingleFrame(cpuConfig, new Uint8Array(second).buffer as ArrayBuffer)
    releaseStillMatteWorker()
    // Same worker for both of these: the second must start from a reset state.
    await matteSingleFrame(cpuConfig, new Uint8Array(first).buffer as ArrayBuffer)
    const { alpha: secondAfterFirst } = await matteSingleFrame(cpuConfig, new Uint8Array(second).buffer as ArrayBuffer)
    expect(Buffer.compare(secondAfterFirst, secondAlone)).toBe(0)
  }, 30_000)

  it('runs images sent at once one after another, each with its own mask', async () => {
    const images = [syntheticRgb(3), syntheticRgb(4), syntheticRgb(3)]
    const results = await Promise.all(images.map(rgb => matteSingleFrame(cpuConfig, new Uint8Array(rgb).buffer as ArrayBuffer)))
    expect(Buffer.compare(results[0].alpha, results[2].alpha)).toBe(0)
    expect(Buffer.compare(results[0].alpha, results[1].alpha)).not.toBe(0)
  }, 30_000)

  it('knows when its worker has died on its own, so a kept host is not reused', async () => {
    const host = await MatteWorkerHost.create(cpuConfig)
    const errors: Error[] = []
    host.onError(err => errors.push(err))
    expect(host.isAlive()).toBe(true)
    // Stopped from outside the host, as a crash would.
    await (host as unknown as { worker: { terminate(): Promise<number> } }).worker.terminate()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(host.isAlive()).toBe(false)
    expect(errors[0]?.message).toMatch(/exited unexpectedly/)
  }, 30_000)

  it('finds the providers that can load the model, CPU at least', async () => {
    const { available } = await probeProvidersInWorker(cpuConfig.modelPath, ['cpu'])
    expect(available).toEqual(['cpu'])
  }, 30_000)

  it('reports a provider that cannot load instead of failing the probe', async () => {
    const { available, failures } = await probeProvidersInWorker(cpuConfig.modelPath, ['no-such-provider', 'cpu'])
    expect(available).toEqual(['cpu'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/^no-such-provider:/)
  }, 30_000)
})
