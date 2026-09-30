import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { samEncoderSize, samMaskFromLogits, samplePoints, samPromptTensors } from '../src/sam-prompt'

describe('sam prompt', () => {
  it('scales the longest side to 1024 and keeps proportions', () => {
    expect(samEncoderSize(298, 394)).toEqual({ width: 774, height: 1024 })
    expect(samEncoderSize(1920, 1080)).toEqual({ width: 1024, height: 576 })
  })

  it('takes a few evenly spread points from a long stroke', () => {
    const stroke = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5] as [number, number])
    const pts = samplePoints(stroke, 5)
    expect(pts).toHaveLength(5)
    expect(pts[0][0]).toBeCloseTo(0, 5)
    expect(pts[2][0]).toBeCloseTo(0.5, 2)
    expect(pts[4][0]).toBeCloseTo(1, 5)
  })

  it('puts points in the 1024-scaled picture, labels them, and pads', () => {
    const p = samPromptTensors([{ x: 0.5, y: 0.25, positive: false }, { x: 1, y: 1, positive: true }], 500, 1000)
    expect(p.count).toBe(3)
    expect(Array.from(p.labels)).toEqual([1, 0, -1])
    expect(Array.from(p.coords.slice(0, 4))).toEqual([512, 1024, 256, 256])
  })

  it('keeps only the piece holding a positive point, and fills a small hole in it', () => {
    const W = 20
    const H = 20
    const logits = new Float32Array(W * H).fill(-5)
    for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) logits[y * W + x] = 5
    logits[6 * W + 6] = -5 // a hole
    for (let y = 15; y < 18; y++) for (let x = 15; x < 18; x++) logits[y * W + x] = 5 // an island
    const mask = samMaskFromLogits(logits, W, H, [{ x: 0.2, y: 0.2, positive: true }])
    expect(mask[6 * W + 6]).toBeGreaterThanOrEqual(128)
    expect(mask[16 * W + 16]).toBe(0)
    expect(mask[4 * W + 4]).toBe(255)
  })

  it('does not leave a filled hole or an unsure patch inside the object half transparent', () => {
    const W = 20
    const H = 20
    const logits = new Float32Array(W * H).fill(-5)
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) logits[y * W + x] = 5
    logits[6 * W + 6] = -5 // a hole the model hedged on
    logits[9 * W + 9] = 0.3 // a pixel it barely believed in
    logits[2 * W + 5] = 0.4 // on the outline
    const mask = samMaskFromLogits(logits, W, H, [{ x: 0.2, y: 0.2, positive: true }])
    expect(mask[6 * W + 6]).toBe(255)
    expect(mask[9 * W + 9]).toBe(255)
    // the outline keeps its soft edge
    expect(mask[2 * W + 5]).toBeLessThan(255)
  })
})

// The real model, when its files are in the tree: a tap on an object selects that object.
const require = createRequire(import.meta.url)
const encoderPath = 'resources/models/mobile_sam_image_encoder.onnx'
const decoderPath = 'resources/models/sam_mask_decoder_single.onnx'
const hasModel = existsSync(encoderPath) && existsSync(decoderPath)

describe.skipIf(!hasModel)('MobileSAM on a picture', () => {
  it('selects the whole orange from one tap, and nothing of the table', async () => {
    const ort = require('onnxruntime-node')
    const W = 400
    const H = 300
    const inOrange = (x: number, y: number) => (x - 200) ** 2 + (y - 150) ** 2 <= 90 ** 2
    const { width: EW, height: EH } = samEncoderSize(W, H)
    const image = new Float32Array(EW * EH * 3)
    for (let y = 0; y < EH; y++) {
      for (let x = 0; x < EW; x++) {
        const sx = (x / EW) * W
        const sy = (y / EH) * H
        const i = (y * EW + x) * 3
        if (inOrange(sx, sy)) {
          const light = 1.15 - ((sx - 140) + (sy - 90)) / 400
          image[i] = Math.min(255, 240 * light); image[i + 1] = Math.min(255, 130 * light); image[i + 2] = 30 * light
        } else {
          image[i] = 90; image[i + 1] = 110 + (sy > 220 ? 40 : 0); image[i + 2] = 150
        }
      }
    }
    const encoder = await ort.InferenceSession.create(encoderPath)
    const decoder = await ort.InferenceSession.create(decoderPath)
    const { image_embeddings } = await encoder.run({ input_image: new ort.Tensor('float32', image, [EH, EW, 3]) })
    const points = [{ x: 0.45, y: 0.4, positive: true }]
    const p = samPromptTensors(points, W, H)
    const out = await decoder.run({
      image_embeddings,
      point_coords: new ort.Tensor('float32', p.coords, [1, p.count, 2]),
      point_labels: new ort.Tensor('float32', p.labels, [1, p.count]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
      orig_im_size: new ort.Tensor('float32', new Float32Array([H, W]), [2]),
    })
    const mask = samMaskFromLogits(out.masks.data, W, H, points)
    let inside = 0, hit = 0, outside = 0, leak = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const on = mask[y * W + x] > 127
      if (inOrange(x, y)) { inside++; if (on) hit++ } else { outside++; if (on) leak++ }
    }
    expect(hit / inside).toBeGreaterThan(0.95)
    expect(leak / outside).toBeLessThan(0.02)
  }, 120000)
})
