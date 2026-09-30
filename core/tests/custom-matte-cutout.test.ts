import { describe, expect, it } from 'vitest'
import { blendCustomMatte, customMatteStartsEmpty, rasterizeStrokes } from '../src/custom-matte'
import type { BrushStroke } from '../src/project-model'
import { encodeRegionMask } from '../src/smart-select'

const stroke = (mode: BrushStroke['mode'], x: number, y: number): BrushStroke =>
  ({ mode, size: 20, points: [[x, y]], paintedAt: 0 })

describe('a brush with no automatic matte underneath', () => {
  it('keeps what is painted and removes the rest', () => {
    const strokes = [stroke('brush', 0.25, 0.5)]
    expect(customMatteStartsEmpty(strokes, false)).toBe(true)
    const { brushMask, eraserMask } = rasterizeStrokes(strokes, 40, 40)
    const alpha = blendCustomMatte(null, brushMask, eraserMask, 40, 40, true)
    expect(alpha[20 * 40 + 10]).toBe(255) // under the stroke
    expect(alpha[20 * 40 + 35]).toBe(0) // far from it
  })

  it('still lets the eraser cut a hole in what was painted', () => {
    const strokes = [stroke('brush', 0.5, 0.5), stroke('eraser', 0.5, 0.5)]
    const { brushMask, eraserMask } = rasterizeStrokes(strokes, 40, 40)
    expect(blendCustomMatte(null, brushMask, eraserMask, 40, 40, true)[20 * 40 + 20]).toBe(0)
  })

  it('starts from the whole picture when there is only erasing, or an automatic matte', () => {
    expect(customMatteStartsEmpty([stroke('eraser', 0.5, 0.5)], false)).toBe(false)
    expect(customMatteStartsEmpty([stroke('brush', 0.5, 0.5)], true)).toBe(false)
    const { brushMask, eraserMask } = rasterizeStrokes([stroke('eraser', 0.25, 0.5)], 40, 40)
    const alpha = blendCustomMatte(null, brushMask, eraserMask, 40, 40, false)
    expect(alpha[20 * 40 + 35]).toBe(255)
    expect(alpha[20 * 40 + 10]).toBe(0)
  })
})

describe('smart strokes that meet', () => {
  // A selection is stored small and read back larger, so its edge arrives as a ramp. A smart
  // eraser over a region and a smart brush over the same region afterwards never share an
  // outline exactly; the strip between them used to stay half erased.
  const SRC = 32
  const region = (edgeX: number, mode: BrushStroke['mode']): BrushStroke => {
    const mask = new Uint8Array(SRC * SRC)
    for (let y = 0; y < SRC; y++) for (let x = 0; x < SRC; x++) mask[y * SRC + x] = x < edgeX ? 255 : 0
    return { mode, size: 5, points: [[0.1, 0.5]], paintedAt: 0, region: encodeRegionMask(mask, SRC, SRC) }
  }

  it('leaves no translucent seam where an eraser is followed by a brush over nearly the same area', () => {
    const W = 128
    // whole picture kept, the left part erased, then painted back a source pixel narrower
    const strokes = [region(SRC, 'region-brush'), region(16, 'region-eraser'), region(15, 'region-brush')]
    const { brushMask, eraserMask } = rasterizeStrokes(strokes, W, W)
    const alpha = blendCustomMatte(null, brushMask, eraserMask, W, W, true)
    const row = 64 * W
    const partial = Array.from(alpha.slice(row, row + W)).filter(v => v > 16 && v < 239).length
    expect(partial).toBeLessThanOrEqual(3)
  })

  it('keeps an eraser from cutting past the outline it was taken over', () => {
    const W = 128
    const { brushMask, eraserMask } = rasterizeStrokes([region(SRC, 'region-brush'), region(16, 'region-eraser')], W, W)
    const alpha = blendCustomMatte(null, brushMask, eraserMask, W, W, true)
    const row = 64 * W
    expect(alpha[row + 30]).toBe(0) // well inside the erased side
    expect(alpha[row + 66]).toBe(255) // just past the outline, still kept
  })
})
