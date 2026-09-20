import { describe, it, expect } from 'vitest'
import {
  computeStrokesHash,
  rasterizeStrokes,
  computeRegionCriterion,
  growRegion,
  blendCustomMatte,
} from '../src/custom-matte'
import type { BrushStroke } from '../src/project-model'

describe('Custom Matte Pure Logic (KE-1409)', () => {
  describe('computeStrokesHash', () => {
    it('returns empty string for empty strokes list', () => {
      expect(computeStrokesHash([])).toBe('')
    })

    it('produces deterministic hash for identical strokes', () => {
      const strokes1: BrushStroke[] = [
        { mode: 'brush', size: 10, points: [[0.2, 0.3], [0.5, 0.6]], paintedAt: 1.5 },
      ]
      const strokes2: BrushStroke[] = [
        { mode: 'brush', size: 10, points: [[0.2, 0.3], [0.5, 0.6]], paintedAt: 1.5 },
      ]
      expect(computeStrokesHash(strokes1)).toBe(computeStrokesHash(strokes2))
      expect(computeStrokesHash(strokes1)).not.toBe('')
    })

    it('produces different hash when size, mode, or points change', () => {
      const base: BrushStroke = { mode: 'brush', size: 10, points: [[0.2, 0.3]], paintedAt: 0 }
      const diffSize: BrushStroke = { ...base, size: 15 }
      const diffMode: BrushStroke = { ...base, mode: 'eraser' }
      const diffPoint: BrushStroke = { ...base, points: [[0.2, 0.4]] }

      const hashBase = computeStrokesHash([base])
      expect(computeStrokesHash([diffSize])).not.toBe(hashBase)
      expect(computeStrokesHash([diffMode])).not.toBe(hashBase)
      expect(computeStrokesHash([diffPoint])).not.toBe(hashBase)
    })
  })

  describe('rasterizeStrokes', () => {
    it('returns zeroed masks when strokes array is empty', () => {
      const { brushMask, eraserMask } = rasterizeStrokes([], 100, 100)
      expect(brushMask.length).toBe(10000)
      expect(eraserMask.length).toBe(10000)
      expect(brushMask.every((v) => v === 0)).toBe(true)
      expect(eraserMask.every((v) => v === 0)).toBe(true)
    })

    it('rasterizes a single-dot brush stroke at normalized position', () => {
      // 100x100 frame, center dot at (0.5, 0.5), size 10% of short edge = radius 5px
      const strokes: BrushStroke[] = [
        { mode: 'brush', size: 10, points: [[0.5, 0.5]], paintedAt: 0 },
      ]
      const { brushMask, eraserMask } = rasterizeStrokes(strokes, 100, 100)

      // Center pixel (50, 50) must be 255
      expect(brushMask[50 * 100 + 50]).toBe(255)
      // Pixels 15px away should be 0
      expect(brushMask[50 * 100 + 65]).toBe(0)
      expect(eraserMask.every((v) => v === 0)).toBe(true)
    })

    it('rasterizes eraser stroke onto eraserMask', () => {
      const strokes: BrushStroke[] = [
        { mode: 'eraser', size: 20, points: [[0.5, 0.5]], paintedAt: 0 },
      ]
      const { brushMask, eraserMask } = rasterizeStrokes(strokes, 100, 100)

      expect(eraserMask[50 * 100 + 50]).toBe(255)
      expect(brushMask.every((v) => v === 0)).toBe(true)
    })

    it('connects polyline segments continuously', () => {
      // Line from (0.2, 0.5) to (0.8, 0.5)
      const strokes: BrushStroke[] = [
        {
          mode: 'brush',
          size: 10,
          points: [
            [0.2, 0.5],
            [0.8, 0.5],
          ],
          paintedAt: 0,
        },
      ]
      const { brushMask } = rasterizeStrokes(strokes, 100, 100)

      // Points along the horizontal line (x = 20, 50, 80 at y = 50) must be covered
      expect(brushMask[50 * 100 + 20]).toBe(255)
      expect(brushMask[50 * 100 + 50]).toBe(255)
      expect(brushMask[50 * 100 + 80]).toBe(255)
      // Far away in y (y = 20) should be 0
      expect(brushMask[20 * 100 + 50]).toBe(0)
    })

    it('supports filter option to separate regular from region strokes', () => {
      const strokes: BrushStroke[] = [
        { mode: 'brush', size: 10, points: [[0.5, 0.5]], paintedAt: 0 },
        { mode: 'region-brush', size: 10, points: [[0.2, 0.2]], paintedAt: 0 },
      ]

      const regOnly = rasterizeStrokes(strokes, 100, 100, { filter: 'regular' })
      expect(regOnly.brushMask[50 * 100 + 50]).toBe(255)
      expect(regOnly.brushMask[20 * 100 + 20]).toBe(0)

      const regionOnly = rasterizeStrokes(strokes, 100, 100, { filter: 'region' })
      expect(regionOnly.brushMask[50 * 100 + 50]).toBe(0)
      expect(regionOnly.brushMask[20 * 100 + 20]).toBe(255)
    })
  })

  describe('blendCustomMatte', () => {
    it('blends baseAlpha with brush (additive) and eraser (subtractive)', () => {
      const base = new Uint8Array([100, 200, 50])
      const brush = new Uint8Array([50, 0, 100])
      const eraser = new Uint8Array([0, 100, 0])

      const blended = blendCustomMatte(base, brush, eraser, 3, 1)
      expect(blended[0]).toBe(150) // 100 + 50 - 0 = 150
      expect(blended[1]).toBe(100) // 200 + 0 - 100 = 100
      expect(blended[2]).toBe(150) // 50 + 100 - 0 = 150
    })

    it('clamps saturation at 255 and lower bound at 0', () => {
      const base = new Uint8Array([200, 50])
      const brush = new Uint8Array([100, 0])
      const eraser = new Uint8Array([0, 200])

      const blended = blendCustomMatte(base, brush, eraser, 2, 1)
      expect(blended[0]).toBe(255) // clamped 300 -> 255
      expect(blended[1]).toBe(0) // clamped -150 -> 0
    })

    it('defaults baseAlpha to solid 255 when null or undefined', () => {
      const brush = new Uint8Array([0, 0])
      const eraser = new Uint8Array([50, 255])

      const blended = blendCustomMatte(null, brush, eraser, 2, 1)
      expect(blended[0]).toBe(205) // 255 - 50 = 205
      expect(blended[1]).toBe(0) // 255 - 255 = 0
    })
  })

  describe('growRegion and computeRegionCriterion', () => {
    it('computes color criterion from RGB image under seed mask', () => {
      const width = 10
      const height = 10
      const rgb = new Uint8Array(width * height * 3)

      // Set pixels to solid red (200, 50, 50)
      for (let i = 0; i < width * height; i++) {
        rgb[i * 3] = 200
        rgb[i * 3 + 1] = 50
        rgb[i * 3 + 2] = 50
      }

      const seed = new Uint8Array(width * height)
      seed[0] = 255
      seed[1] = 255

      const criterion = computeRegionCriterion(rgb, seed, width, height)
      expect(criterion.meanR).toBe(200)
      expect(criterion.meanG).toBe(50)
      expect(criterion.meanB).toBe(50)
    })

    it('floods contiguous pixels with similar color and stops at color boundary', () => {
      const width = 10
      const height = 10
      const rgb = new Uint8Array(width * height * 3)
      const alpha = new Uint8Array(width * height).fill(255)

      // Left half red, right half blue
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 3
          if (x < 5) {
            rgb[idx] = 220
            rgb[idx + 1] = 30
            rgb[idx + 2] = 30
          } else {
            rgb[idx] = 30
            rgb[idx + 1] = 30
            rgb[idx + 2] = 220
          }
        }
      }

      // Seed in the red half at (2, 5)
      const seed = new Uint8Array(width * height)
      seed[5 * width + 2] = 255

      const criterion = computeRegionCriterion(rgb, seed, width, height, 40)
      const grown = growRegion(rgb, alpha, width, height, seed, criterion)

      // Pixels in left (red) half should be filled
      expect(grown[5 * width + 1]).toBe(255)
      expect(grown[5 * width + 3]).toBe(255)
      // Pixels across the color boundary (x >= 5, blue) must NOT be filled
      expect(grown[5 * width + 6]).toBe(0)
    })

    it('stops at sharp existing alpha boundary', () => {
      const width = 10
      const height = 10
      const rgb = new Uint8Array(width * height * 3).fill(200) // uniform color everywhere
      const alpha = new Uint8Array(width * height)

      // Left half alpha = 255, right half alpha = 0 (subject edge)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          alpha[y * width + x] = x < 5 ? 255 : 0
        }
      }

      const seed = new Uint8Array(width * height)
      seed[5 * width + 2] = 255

      const criterion = computeRegionCriterion(rgb, seed, width, height, 50)
      const grown = growRegion(rgb, alpha, width, height, seed, criterion)

      // Even though RGB color is uniform everywhere, it stops crossing into the alpha=0 area
      expect(grown[5 * width + 2]).toBe(255)
      expect(grown[5 * width + 7]).toBe(0)
    })
  })
})
