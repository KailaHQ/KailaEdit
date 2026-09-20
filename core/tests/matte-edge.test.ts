import { describe, it, expect } from 'vitest'
import {
  matteAlphaBand,
  matteFeatherSigma,
  hasMatteClean,
  hasMatteFeather,
  applyMatteAlphaBand,
} from '../src/matte-edge'

/**
 * These two sliders used to be defined separately by the preview shader and the export
 * filtergraph, and they ended up moving in opposite directions — `featherEdge` hardened
 * the edge in the preview (alpha 0.4 came out at 0.90 at featherEdge 50) while softening
 * it in the exported file (transition band 2.18% -> 3.76% of the frame). Whatever else
 * changes, the two have to keep deriving their numbers from here.
 */
describe('matte edge controls', () => {
  describe('cleanEdge', () => {
    it('does nothing at 0 — what every existing project uses', () => {
      const band = matteAlphaBand(0)
      expect(band).toEqual({ lo: 0, hi: 1 })
      expect(hasMatteClean(0)).toBe(false)
      for (const a of [0, 0.25, 0.5, 0.75, 1]) {
        expect(applyMatteAlphaBand(a, band)).toBeCloseTo(a, 6)
      }
    })

    it('treats a missing value as 0', () => {
      expect(matteAlphaBand(undefined)).toEqual({ lo: 0, hi: 1 })
      expect(hasMatteClean(undefined)).toBe(false)
    })

    it('raises the floor as it goes up, and never touches solid subject', () => {
      expect(matteAlphaBand(50).lo).toBeCloseTo(0.25, 6)
      expect(matteAlphaBand(100).lo).toBeCloseTo(0.5, 6)
      for (const clean of [0, 25, 50, 75, 100]) {
        const band = matteAlphaBand(clean)
        expect(band.hi).toBe(1)
        expect(applyMatteAlphaBand(1, band)).toBeCloseTo(1, 6)
        expect(applyMatteAlphaBand(0, band)).toBeCloseTo(clean === 0 ? 0 : 0, 6)
      }
    })

    it('is monotone: more clean never makes a pixel more opaque', () => {
      let previous = Infinity
      for (const clean of [0, 10, 25, 50, 75, 100]) {
        const out = applyMatteAlphaBand(0.4, matteAlphaBand(clean))
        expect(out).toBeLessThanOrEqual(previous + 1e-9)
        previous = out
      }
    })

    it('clamps out-of-range settings rather than inverting the band', () => {
      expect(matteAlphaBand(-40).lo).toBe(0)
      expect(matteAlphaBand(400).lo).toBeCloseTo(0.5, 6)
    })

    /**
     * Measured against both real implementations, on a 0..255 alpha ramp:
     * the WebGL shader matched these to 0/255 on every one of the 256 levels, and
     * ffmpeg's `lut` matched to 1/255 (rounding).
     */
    it('produces the curve both renderers were measured against', () => {
      const band = matteAlphaBand(50)
      const at = (v: number) => Math.round(applyMatteAlphaBand(v / 255, band) * 255)
      expect([0, 64, 128, 192, 255].map(at)).toEqual([0, 0, 86, 171, 255])
    })
  })

  describe('featherEdge', () => {
    it('does nothing at 0', () => {
      expect(matteFeatherSigma(0)).toBe(0)
      expect(matteFeatherSigma(undefined)).toBe(0)
      expect(hasMatteFeather(0)).toBe(false)
    })

    /**
     * Softening is spatial, so this is a blur radius rather than a curve — a pointwise
     * remap can sharpen an existing gradient but can never spread a hard edge over more
     * pixels. Preview and export both blur by this sigma; measured on a step edge they
     * produced transition bands of 10/10, 20/20 and 40/38 pixels at 25, 50 and 100.
     */
    it('grows the blur with the slider, on the scale the export already used', () => {
      expect(matteFeatherSigma(25)).toBeCloseTo(2.5, 6)
      expect(matteFeatherSigma(50)).toBeCloseTo(5, 6)
      expect(matteFeatherSigma(100)).toBeCloseTo(10, 6)
      expect(hasMatteFeather(25)).toBe(true)
    })

    it('clamps out-of-range settings', () => {
      expect(matteFeatherSigma(-10)).toBe(0)
      expect(matteFeatherSigma(1000)).toBeCloseTo(10, 6)
    })
  })
})
