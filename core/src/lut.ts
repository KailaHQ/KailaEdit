/**
 * Pure 3D LUT (Look-Up Table) parser, serializer, and evaluator.
 *
 * Implements the Adobe Cube LUT specification for 3D color grading.
 * Strictly pure TypeScript: no DOM, no React, no Node built-ins.
 * Can be run in Node, Web Workers, or the browser renderer.
 */

export interface CubeLut {
  title?: string
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** Flat RGB array of length size^3 * 3, indexed as (r + g * size + b * size^2) * 3 */
  data: Float32Array
}

export class LutParseError extends Error {
  constructor(message: string) {
    super(`[LutParseError] ${message}`)
    this.name = 'LutParseError'
  }
}

/**
 * Parses an Adobe .cube 3D LUT string into a CubeLut structure.
 */
export function parseCubeLut(content: string): CubeLut {
  const lines = content.split(/\r?\n/)
  let title: string | undefined
  let size = 0
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]

  const rawValues: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine || rawLine.startsWith('#')) continue

    const upper = rawLine.toUpperCase()

    if (upper.startsWith('TITLE')) {
      const match = rawLine.match(/^TITLE\s+"?([^"]*)"?$/i)
      if (match) title = match[1].trim()
      continue
    }

    if (upper.startsWith('LUT_3D_SIZE')) {
      const parts = rawLine.split(/\s+/)
      if (parts.length < 2) {
        throw new LutParseError(`Line ${i + 1}: LUT_3D_SIZE missing size parameter.`)
      }
      const parsedSize = parseInt(parts[1], 10)
      if (isNaN(parsedSize) || parsedSize < 2 || parsedSize > 256) {
        throw new LutParseError(`Line ${i + 1}: LUT_3D_SIZE '${parts[1]}' is invalid (must be between 2 and 256).`)
      }
      size = parsedSize
      continue
    }

    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new LutParseError(`Line ${i + 1}: Only 3D LUTs (.cube with LUT_3D_SIZE) are supported, 1D LUT is not supported.`)
    }

    if (upper.startsWith('DOMAIN_MIN')) {
      const parts = rawLine.split(/\s+/).slice(1).map(Number)
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        domainMin = [parts[0], parts[1], parts[2]]
      }
      continue
    }

    if (upper.startsWith('DOMAIN_MAX')) {
      const parts = rawLine.split(/\s+/).slice(1).map(Number)
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        domainMax = [parts[0], parts[1], parts[2]]
      }
      continue
    }

    // Numbers (RGB triple)
    const parts = rawLine.split(/\s+/)
    if (parts.length >= 3) {
      const r = parseFloat(parts[0])
      const g = parseFloat(parts[1])
      const b = parseFloat(parts[2])

      if (isNaN(r) || isNaN(g) || isNaN(b)) {
        throw new LutParseError(`Line ${i + 1}: Invalid RGB value '${rawLine}'.`)
      }

      rawValues.push(r, g, b)
    }
  }

  if (size === 0) {
    throw new LutParseError('The .cube file is missing the required LUT_3D_SIZE directive.')
  }

  const expectedEntries = size * size * size
  const expectedValues = expectedEntries * 3
  if (rawValues.length !== expectedValues) {
    throw new LutParseError(
      `The .cube file has insufficient data: expected ${expectedEntries} points (${expectedValues} values), but found ${rawValues.length / 3} points.`,
    )
  }

  const data = new Float32Array(rawValues)
  return { title, size, domainMin, domainMax, data }
}

/**
 * Creates an identity CubeLut of the given size (where output == input).
 */
export function createIdentityCubeLut(size = 33): CubeLut {
  const data = new Float32Array(size * size * size * 3)
  let idx = 0
  const denom = size - 1

  // Standard Adobe Cube order:
  // red moves fastest, then green, then blue
  for (let b = 0; b < size; b++) {
    const bv = b / denom
    for (let g = 0; g < size; g++) {
      const gv = g / denom
      for (let r = 0; r < size; r++) {
        const rv = r / denom
        data[idx++] = rv
        data[idx++] = gv
        data[idx++] = bv
      }
    }
  }

  return {
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  }
}

/**
 * Serializes a CubeLut to standard Adobe .cube text format.
 */
export function serializeCubeLut(lut: CubeLut): string {
  const lines: string[] = []
  if (lut.title) lines.push(`TITLE "${lut.title}"`)
  lines.push(`LUT_3D_SIZE ${lut.size}`)
  lines.push(`DOMAIN_MIN ${lut.domainMin[0]} ${lut.domainMin[1]} ${lut.domainMin[2]}`)
  lines.push(`DOMAIN_MAX ${lut.domainMax[0]} ${lut.domainMax[1]} ${lut.domainMax[2]}`)

  const data = lut.data
  for (let i = 0; i < data.length; i += 3) {
    lines.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`)
  }

  return lines.join('\n')
}

/**
 * Helper to sample RGB from the 3D lattice point (ri, gi, bi).
 */
function sampleLattice(lut: CubeLut, ri: number, gi: number, bi: number, out: [number, number, number]): void {
  const idx = (ri + gi * lut.size + bi * lut.size * lut.size) * 3
  out[0] = lut.data[idx]
  out[1] = lut.data[idx + 1]
  out[2] = lut.data[idx + 2]
}

/**
 * Applies a 3D LUT to an input RGB color using trilinear interpolation.
 *
 * @param lut Parsed 3D LUT
 * @param r Red component (0.0 to 1.0)
 * @param g Green component (0.0 to 1.0)
 * @param b Blue component (0.0 to 1.0)
 * @param intensity Mix intensity (0.0 = original color, 1.0 = full LUT color)
 * @returns [r, g, b] transformed color clamped to [0, 1]
 */
export function applyLutToRgb(
  lut: CubeLut,
  r: number,
  g: number,
  b: number,
  intensity = 1.0,
): [number, number, number] {
  // Clamp input into [0, 1]
  const inR = Math.max(0, Math.min(1, r))
  const inG = Math.max(0, Math.min(1, g))
  const inB = Math.max(0, Math.min(1, b))

  // If intensity is 0, return exactly original input
  if (intensity <= 0) {
    return [inR, inG, inB]
  }

  // Normalize by domain range
  const normR = lut.domainMax[0] > lut.domainMin[0]
    ? (inR - lut.domainMin[0]) / (lut.domainMax[0] - lut.domainMin[0])
    : inR
  const normG = lut.domainMax[1] > lut.domainMin[1]
    ? (inG - lut.domainMin[1]) / (lut.domainMax[1] - lut.domainMin[1])
    : inG
  const normB = lut.domainMax[2] > lut.domainMin[2]
    ? (inB - lut.domainMin[2]) / (lut.domainMax[2] - lut.domainMin[2])
    : inB

  const maxIndex = lut.size - 1
  const rx = Math.max(0, Math.min(maxIndex, normR * maxIndex))
  const gy = Math.max(0, Math.min(maxIndex, normG * maxIndex))
  const bz = Math.max(0, Math.min(maxIndex, normB * maxIndex))

  const r0 = Math.floor(rx)
  const r1 = Math.min(maxIndex, r0 + 1)
  const dr = rx - r0

  const g0 = Math.floor(gy)
  const g1 = Math.min(maxIndex, g0 + 1)
  const dg = gy - g0

  const b0 = Math.floor(bz)
  const b1 = Math.min(maxIndex, b0 + 1)
  const db = bz - b0

  // 8 surrounding corner vertices
  const c000: [number, number, number] = [0, 0, 0]
  const c100: [number, number, number] = [0, 0, 0]
  const c010: [number, number, number] = [0, 0, 0]
  const c110: [number, number, number] = [0, 0, 0]
  const c001: [number, number, number] = [0, 0, 0]
  const c101: [number, number, number] = [0, 0, 0]
  const c011: [number, number, number] = [0, 0, 0]
  const c111: [number, number, number] = [0, 0, 0]

  sampleLattice(lut, r0, g0, b0, c000)
  sampleLattice(lut, r1, g0, b0, c100)
  sampleLattice(lut, r0, g1, b0, c010)
  sampleLattice(lut, r1, g1, b0, c110)
  sampleLattice(lut, r0, g0, b1, c001)
  sampleLattice(lut, r1, g0, b1, c101)
  sampleLattice(lut, r0, g1, b1, c011)
  sampleLattice(lut, r1, g1, b1, c111)

  // Trilinear interpolation across 3 channels
  const outR = trilinear(c000[0], c100[0], c010[0], c110[0], c001[0], c101[0], c011[0], c111[0], dr, dg, db)
  const outG = trilinear(c000[1], c100[1], c010[1], c110[1], c001[1], c101[1], c011[1], c111[1], dr, dg, db)
  const outB = trilinear(c000[2], c100[2], c010[2], c110[2], c001[2], c101[2], c011[2], c111[2], dr, dg, db)

  // Linear blend with original by intensity
  const finalIntensity = Math.max(0, Math.min(1, intensity))
  const finalR = inR * (1 - finalIntensity) + outR * finalIntensity
  const finalG = inG * (1 - finalIntensity) + outG * finalIntensity
  const finalB = inB * (1 - finalIntensity) + outB * finalIntensity

  return [
    Math.max(0, Math.min(1, finalR)),
    Math.max(0, Math.min(1, finalG)),
    Math.max(0, Math.min(1, finalB)),
  ]
}

function trilinear(
  c000: number, c100: number, c010: number, c110: number,
  c001: number, c101: number, c011: number, c111: number,
  dx: number, dy: number, dz: number,
): number {
  const c00 = c000 + (c100 - c000) * dx
  const c10 = c010 + (c110 - c010) * dx
  const c01 = c001 + (c101 - c001) * dx
  const c11 = c011 + (c111 - c011) * dx

  const c0 = c00 + (c10 - c00) * dy
  const c1 = c01 + (c11 - c01) * dy

  return c0 + (c1 - c0) * dz
}
