import { describe, expect, it } from 'vitest'
import { rasterizeStrokes, warpMask } from '../src/custom-matte'
import { frameToReference, motionAt, motionCovers, strokeToReference, type MatteMotion } from '../src/matte-motion'
import { encodeRegionMask } from '../src/smart-select'
import type { BrushStroke } from '../src/project-model'

/** Two seconds of a picture that slides right by 0.2 of its width (in normalised units). */
const slide: MatteMotion = {
  t0: 1,
  step: 1,
  m: [1, 0, 0, 0, 1, 0, 1, 0, 0.1, 0, 1, 0, 1, 0, 0.2, 0, 1, 0],
}

describe('matte motion', () => {
  it('interpolates between samples and holds at the ends', () => {
    expect(motionAt(slide, 1)[2]).toBe(0)
    expect(motionAt(slide, 1.5)[2]).toBeCloseTo(0.05, 6)
    expect(motionAt(slide, 3)[2]).toBeCloseTo(0.2, 6)
    expect(motionAt(slide, 0)[2]).toBe(0)
    expect(motionAt(slide, 99)[2]).toBeCloseTo(0.2, 6)
    expect(motionAt(undefined, 2)).toEqual([1, 0, 0, 0, 1, 0])
  })

  it('knows whether it covers the stretch a clip shows', () => {
    expect(motionCovers(slide, 1, 3)).toBe(true)
    expect(motionCovers(slide, 0.5, 3)).toBe(false)
    expect(motionCovers(slide, 1, 6)).toBe(false)
    expect(motionCovers(undefined, 0, 1)).toBe(false)
  })

  it('maps a frame back to the reference, and a stroke painted mid-shot onto the reference', () => {
    // At source time 2 the picture has slid +0.1, so the frame's u=0.6 is the reference's u=0.5.
    expect(frameToReference(slide, 2)[2]).toBeCloseTo(-0.1, 6)
    // Painted at matte time 1 with trimStart 1, speed 1 -> source time 2.
    const toRef = strokeToReference(slide, 1, 1, 1)!
    expect(toRef[0] * 0.6 + toRef[2]).toBeCloseTo(0.5, 6)
    // No motion at the reference frame itself.
    expect(strokeToReference(slide, 0, 1, 1)).toBeNull()
  })

  it('lays a stroke painted on a moved frame onto the reference picture', () => {
    const stroke: BrushStroke = { mode: 'brush', size: 10, points: [[0.6, 0.5]], paintedAt: 1 }
    const W = 100
    const { brushMask } = rasterizeStrokes([stroke], W, W, { toReference: p => strokeToReference(slide, p, 1, 1) })
    // Painted at u=0.6 of a picture that had slid 0.1: it belongs at u=0.5 of the reference.
    expect(brushMask[50 * W + 50]).toBe(255)
    expect(brushMask[50 * W + 60]).toBe(0)
  })

  it('lays a smart stroke onto the reference the same way', () => {
    const SRC = 20
    const mask = new Uint8Array(SRC * SRC)
    for (let y = 0; y < SRC; y++) for (let x = 12; x < SRC; x++) mask[y * SRC + x] = 255 // right 40% of the frame
    const stroke: BrushStroke = { mode: 'region-brush', size: 5, points: [[0.8, 0.5]], paintedAt: 1, region: encodeRegionMask(mask, SRC, SRC) }
    const W = 100
    const { brushMask } = rasterizeStrokes([stroke], W, W, { toReference: p => strokeToReference(slide, p, 1, 1) })
    // The selection began at u=0.6 of the moved frame, i.e. u=0.5 of the reference.
    expect(brushMask[50 * W + 40]).toBe(0)
    expect(brushMask[50 * W + 60]).toBe(255)
    expect(brushMask[50 * W + 45]).toBe(0)
  })

  it('carries the matte along with the frame', () => {
    const W = 100
    const mask = new Uint8Array(W * W)
    for (let y = 0; y < W; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 255
    // At source time 3 the picture has slid 0.2: the object at u 0.2..0.4 now sits at 0.4..0.6.
    const warped = warpMask(mask, W, W, frameToReference(slide, 3))
    expect(warped[50 * W + 50]).toBe(255)
    expect(warped[50 * W + 30]).toBe(0)
    // What the reference did not cover is nothing.
    expect(warped[50 * W + 5]).toBe(0)
  })
})
