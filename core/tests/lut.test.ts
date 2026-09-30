import { describe, it, expect } from 'vitest'
import {
  parseCubeLut,
  createIdentityCubeLut,
  serializeCubeLut,
  applyLutToRgb,
  LutParseError,
  type CubeLut,
} from '../src/lut'

describe('Sprint F0-1: 3D LUT Parser, Serializer, and Evaluator', () => {
  describe('createIdentityCubeLut', () => {
    it('creates an identity LUT with default size 33', () => {
      const lut = createIdentityCubeLut()
      expect(lut.size).toBe(33)
      expect(lut.domainMin).toEqual([0, 0, 0])
      expect(lut.domainMax).toEqual([1, 1, 1])
      expect(lut.data.length).toBe(33 * 33 * 33 * 3)

      // (0, 0, 0)
      expect(lut.data[0]).toBeCloseTo(0, 5)
      expect(lut.data[1]).toBeCloseTo(0, 5)
      expect(lut.data[2]).toBeCloseTo(0, 5)

      // (1, 1, 1) -> last entry
      const lastIdx = lut.data.length - 3
      expect(lut.data[lastIdx]).toBeCloseTo(1, 5)
      expect(lut.data[lastIdx + 1]).toBeCloseTo(1, 5)
      expect(lut.data[lastIdx + 2]).toBeCloseTo(1, 5)
    })

    it('creates identity LUTs of different sizes', () => {
      const lut2 = createIdentityCubeLut(2)
      expect(lut2.size).toBe(2)
      expect(lut2.data.length).toBe(2 * 2 * 2 * 3) // 24 floats
    })
  })

  describe('serializeCubeLut and parseCubeLut round-trip', () => {
    it('serializes and re-parses an identity LUT accurately', () => {
      const original = createIdentityCubeLut(4)
      original.title = 'Test Identity 4'
      const serialized = serializeCubeLut(original)
      const parsed = parseCubeLut(serialized)

      expect(parsed.title).toBe('Test Identity 4')
      expect(parsed.size).toBe(4)
      expect(parsed.domainMin).toEqual([0, 0, 0])
      expect(parsed.domainMax).toEqual([1, 1, 1])
      expect(parsed.data.length).toBe(original.data.length)

      for (let i = 0; i < original.data.length; i++) {
        expect(parsed.data[i]).toBeCloseTo(original.data[i], 4)
      }
    })

    it('parses .cube with comments and blank lines', () => {
      const cubeContent = `
# Created by Colorist
TITLE "Vintage Warmth"

# Dimensions
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

# RGB Table
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`
      const parsed = parseCubeLut(cubeContent)
      expect(parsed.title).toBe('Vintage Warmth')
      expect(parsed.size).toBe(2)
      expect(parsed.data.length).toBe(24)
    })
  })

  describe('parseCubeLut error handling', () => {
    it('throws LutParseError if LUT_3D_SIZE is missing', () => {
      const cube = `
TITLE "Missing Size"
0.0 0.0 0.0
1.0 1.0 1.0
`
      expect(() => parseCubeLut(cube)).toThrow(LutParseError)
      expect(() => parseCubeLut(cube)).toThrow(/missing the required LUT_3D_SIZE/)
    })

    it('rejects LUT_1D_SIZE', () => {
      const cube = `
LUT_1D_SIZE 256
0.0 0.0 0.0
`
      expect(() => parseCubeLut(cube)).toThrow(LutParseError)
      expect(() => parseCubeLut(cube)).toThrow(/Only 3D LUTs/)
    })

    it('rejects invalid or out of range LUT_3D_SIZE', () => {
      const cubeInvalid = `LUT_3D_SIZE abc\n`
      expect(() => parseCubeLut(cubeInvalid)).toThrow(LutParseError)

      const cubeTooSmall = `LUT_3D_SIZE 1\n`
      expect(() => parseCubeLut(cubeTooSmall)).toThrow(LutParseError)
    })

    it('throws when data rows do not match size^3', () => {
      const cube = `
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 1.0 1.0
` // Expected 8 points, only 2 provided
      expect(() => parseCubeLut(cube)).toThrow(LutParseError)
      expect(() => parseCubeLut(cube)).toThrow(/insufficient data/)
    })

    it('throws on non-numeric RGB lines', () => {
      const cube = `
LUT_3D_SIZE 2
0.0 0.0 notanumber
0.0 0.0 0.0
0.0 0.0 0.0
0.0 0.0 0.0
0.0 0.0 0.0
0.0 0.0 0.0
0.0 0.0 0.0
0.0 0.0 0.0
`
      expect(() => parseCubeLut(cube)).toThrow(LutParseError)
      expect(() => parseCubeLut(cube)).toThrow(/Invalid RGB value/)
    })
  })

  describe('applyLutToRgb', () => {
    it('identity LUT preserves colors with error < 1/255', () => {
      const lut = createIdentityCubeLut(17)
      const testColors: [number, number, number][] = [
        [0, 0, 0],
        [1, 1, 1],
        [0.5, 0.5, 0.5],
        [0.2, 0.7, 0.4],
        [0.85, 0.15, 0.65],
        [0.123, 0.456, 0.789],
      ]

      for (const [r, g, b] of testColors) {
        const [outR, outG, outB] = applyLutToRgb(lut, r, g, b, 1.0)
        expect(Math.abs(outR - r)).toBeLessThan(1 / 255)
        expect(Math.abs(outG - g)).toBeLessThan(1 / 255)
        expect(Math.abs(outB - b)).toBeLessThan(1 / 255)
      }
    })

    it('intensity = 0 returns input unmodified', () => {
      // Invert LUT
      const invertLut: CubeLut = {
        size: 2,
        domainMin: [0, 0, 0],
        domainMax: [1, 1, 1],
        data: new Float32Array([
          // r0, g0, b0 -> inverted
          1, 1, 1,
          0, 1, 1,
          1, 0, 1,
          0, 0, 1,
          1, 1, 0,
          0, 1, 0,
          1, 0, 0,
          0, 0, 0,
        ]),
      }

      const [outR, outG, outB] = applyLutToRgb(invertLut, 0.2, 0.4, 0.8, 0)
      expect(outR).toBeCloseTo(0.2, 5)
      expect(outG).toBeCloseTo(0.4, 5)
      expect(outB).toBeCloseTo(0.8, 5)
    })

    it('intensity = 0.5 linearly blends between input and LUT transformed', () => {
      // Create a LUT that turns everything red [1, 0, 0]
      const size = 2
      const redData = new Float32Array(size * size * size * 3)
      for (let i = 0; i < redData.length; i += 3) {
        redData[i] = 1.0
        redData[i + 1] = 0.0
        redData[i + 2] = 0.0
      }
      const redLut: CubeLut = {
        size,
        domainMin: [0, 0, 0],
        domainMax: [1, 1, 1],
        data: redData,
      }

      // Input color: [0, 1, 0] (pure green)
      // At intensity 0.5: R = 0.5, G = 0.5, B = 0.0
      const [r50, g50, b50] = applyLutToRgb(redLut, 0, 1, 0, 0.5)
      expect(r50).toBeCloseTo(0.5, 4)
      expect(g50).toBeCloseTo(0.5, 4)
      expect(b50).toBeCloseTo(0.0, 4)
    })

    it('clamps input values outside [0, 1] safely', () => {
      const lut = createIdentityCubeLut(8)
      const [r, g, b] = applyLutToRgb(lut, -0.5, 1.8, 0.5)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      expect(b).toBeCloseTo(0.5, 2)
    })
  })
})
