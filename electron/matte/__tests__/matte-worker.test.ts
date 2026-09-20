import { describe, expect, it } from 'vitest'
import { createRequire } from 'module'
import { resolveMatteWorkerPath, MatteWorkerHost } from '../matte-worker-host'
import { resolveModelPath, getProviderChain } from '../onnx-session'

const require = createRequire(import.meta.url)

describe('MatteWorker (KE-1502)', () => {
  it('resolves the compiled matte-worker.js file on disk', () => {
    const workerPath = resolveMatteWorkerPath()
    expect(workerPath).toBeTruthy()
  })

  it('spawns and initializes MatteWorkerHost successfully', async () => {
    const modelPath = resolveModelPath('rvm_mobilenetv3')
    const width = 64
    const height = 64

    const host = await MatteWorkerHost.create({
      modelPath,
      modelName: 'rvm_mobilenetv3',
      device: 'auto',
      providerChain: getProviderChain('auto'),
      inferW: width,
      inferH: height,
      downsampleRatio: 0.25,
      warmupFrames: 2,
      intraOpNumThreads: 1,
    })

    expect(host.getProvider()).toBeTruthy()
    host.terminate()
  })

  it('produces bit-identical alpha output compared to direct execution on the same inputs', async () => {
    const ort: typeof import('onnxruntime-node') = require('onnxruntime-node')
    const modelPath = resolveModelPath('rvm_mobilenetv3')
    const width = 64
    const height = 64
    const totalPixels = width * height
    const downsampleRatio = 0.25
    const warmupFrames = 2

    // Create deterministic synthetic RGB frame
    const rgbFrame = new Uint8Array(totalPixels * 3)
    for (let i = 0; i < totalPixels; i++) {
      rgbFrame[i * 3] = (i * 7) % 256
      rgbFrame[i * 3 + 1] = (i * 13) % 256
      rgbFrame[i * 3 + 2] = (i * 19) % 256
    }

    // 1. Direct synchronous ONNX execution (reference)
    const directSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      intraOpNumThreads: 1,
    })

    const planarData = new Float32Array(3 * totalPixels)
    const BYTE_TO_UNIT = new Float32Array(256)
    for (let i = 0; i < 256; i++) BYTE_TO_UNIT[i] = i / 255

    const offsetG = totalPixels
    const offsetB = 2 * totalPixels
    let j = 0
    for (let i = 0; i < totalPixels; i++) {
      planarData[i] = BYTE_TO_UNIT[rgbFrame[j]]
      planarData[offsetG + i] = BYTE_TO_UNIT[rgbFrame[j + 1]]
      planarData[offsetB + i] = BYTE_TO_UNIT[rgbFrame[j + 2]]
      j += 3
    }

    const srcTensor = new ort.Tensor('float32', planarData, [1, 3, height, width])
    const dsTensor = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1])
    const zeroState = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    let r1: any = zeroState
    let r2: any = zeroState
    let r3: any = zeroState
    let r4: any = zeroState

    // Reference warmup passes
    for (let w = 0; w < warmupFrames; w++) {
      const warmupFeeds = {
        src: srcTensor,
        r1i: r1,
        r2i: r2,
        r3i: r3,
        r4i: r4,
        downsample_ratio: dsTensor,
      }
      const res = await directSession.run(warmupFeeds, ['r1o', 'r2o', 'r3o', 'r4o'])
      r1 = res.r1o
      r2 = res.r2o
      r3 = res.r3o
      r4 = res.r4o
    }

    // Reference real pass
    const feeds = {
      src: srcTensor,
      r1i: r1,
      r2i: r2,
      r3i: r3,
      r4i: r4,
      downsample_ratio: dsTensor,
    }
    const realRes = await directSession.run(feeds, ['pha', 'r1o', 'r2o', 'r3o', 'r4o'])
    const directPha = realRes.pha.data as Float32Array
    const directClamped = new Uint8ClampedArray(totalPixels)
    for (let i = 0; i < totalPixels; i++) {
      directClamped[i] = directPha[i] * 255
    }
    const directBuffer = Buffer.from(directClamped.buffer, directClamped.byteOffset, directClamped.byteLength)

    // 2. MatteWorker execution (using cpu provider chain for identical cross-environment baseline)
    const host = await MatteWorkerHost.create({
      modelPath,
      modelName: 'rvm_mobilenetv3',
      device: 'cpu',
      providerChain: ['cpu'],
      inferW: width,
      inferH: height,
      downsampleRatio,
      warmupFrames,
      intraOpNumThreads: 1,
    })

    const rgbForWorker = new Uint8Array(rgbFrame)
    const workerAlphaBuffer = await new Promise<Buffer>((resolve, reject) => {
      host.onError(reject)
      host.onAlpha((frameIdx, alpha) => {
        resolve(alpha)
      })
      host.sendFrame(0, rgbForWorker.buffer as ArrayBuffer)
    })

    host.terminate()

    expect(workerAlphaBuffer.length).toBe(directBuffer.length)
    expect(Buffer.compare(directBuffer, workerAlphaBuffer)).toBe(0)
  })

  it('handles multiple concurrent workers without session conflicts', async () => {
    const modelPath = resolveModelPath('rvm_mobilenetv3')
    const width = 48
    const height = 48
    const totalPixels = width * height

    const [host1, host2] = await Promise.all([
      MatteWorkerHost.create({
        modelPath,
        modelName: 'rvm_mobilenetv3',
        device: 'auto',
        providerChain: getProviderChain('auto'),
        inferW: width,
        inferH: height,
        downsampleRatio: 0.25,
        warmupFrames: 1,
        intraOpNumThreads: 1,
      }),
      MatteWorkerHost.create({
        modelPath,
        modelName: 'rvm_mobilenetv3',
        device: 'auto',
        providerChain: getProviderChain('auto'),
        inferW: width,
        inferH: height,
        downsampleRatio: 0.25,
        warmupFrames: 1,
        intraOpNumThreads: 1,
      }),
    ])

    const frame1 = new Uint8Array(totalPixels * 3).fill(128)
    const frame2 = new Uint8Array(totalPixels * 3).fill(200)

    const [alpha1, alpha2] = await Promise.all([
      new Promise<Buffer>((resolve, reject) => {
        host1.onError(reject)
        host1.onAlpha((_idx, alpha) => resolve(alpha))
        host1.sendFrame(0, frame1.buffer as ArrayBuffer)
      }),
      new Promise<Buffer>((resolve, reject) => {
        host2.onError(reject)
        host2.onAlpha((_idx, alpha) => resolve(alpha))
        host2.sendFrame(0, frame2.buffer as ArrayBuffer)
      }),
    ])

    expect(alpha1.length).toBe(totalPixels)
    expect(alpha2.length).toBe(totalPixels)

    host1.terminate()
    host2.terminate()
  })

  it('terminates worker cleanly on cancellation', async () => {
    const modelPath = resolveModelPath('rvm_mobilenetv3')
    const width = 48
    const height = 48

    const host = await MatteWorkerHost.create({
      modelPath,
      modelName: 'rvm_mobilenetv3',
      device: 'auto',
      providerChain: getProviderChain('auto'),
      inferW: width,
      inferH: height,
      downsampleRatio: 0.25,
      warmupFrames: 1,
      intraOpNumThreads: 1,
    })

    // Calling terminate should kill worker without throwing
    expect(() => host.terminate()).not.toThrow()
    // Sending a frame to terminated host throws immediately
    expect(() => host.sendFrame(0, new ArrayBuffer(width * height * 3))).toThrowError('terminated worker')
  })
})
