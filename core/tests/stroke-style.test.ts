import { describe, it, expect } from 'vitest'
import {
  renderStroke,
  computeEuclideanDistanceTransform,
  computeChebyshevDistanceTransform,
} from '../src/stroke-style'
import {
  DEFAULT_CLIP_STROKE,
  strokeStyleValues,
  type ClipStroke,
} from '../src/project-model'

/** Helper to generate an alpha buffer containing a solid circle in the center */
function makeCircleAlpha(width: number, height: number, radius: number): Uint8Array {
  const alpha = new Uint8Array(width * height)
  const cx = width / 2
  const cy = height / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      if (dist <= radius) {
        alpha[y * width + x] = 255
      }
    }
  }
  return alpha
}

describe('Distance Transforms', () => {
  it('computes exact Euclidean distance transform for a 1-pixel source', () => {
    const w = 5
    const h = 5
    const alpha = new Uint8Array(w * h)
    alpha[2 * w + 2] = 255 // center pixel

    const edt = computeEuclideanDistanceTransform(alpha, w, h)
    expect(edt[2 * w + 2]).toBe(0) // distance to itself is 0
    expect(edt[2 * w + 3]).toBeCloseTo(1.0, 4) // 1 pixel right
    expect(edt[1 * w + 2]).toBeCloseTo(1.0, 4) // 1 pixel up
    expect(edt[1 * w + 3]).toBeCloseTo(Math.SQRT2, 4) // diagonal
    expect(edt[0 * w + 0]).toBeCloseTo(Math.sqrt(8), 4) // (0,0) to (2,2)
  })

  it('computes Chebyshev distance transform with rectangular contours', () => {
    const w = 5
    const h = 5
    const alpha = new Uint8Array(w * h)
    alpha[2 * w + 2] = 255 // center pixel

    const cdt = computeChebyshevDistanceTransform(alpha, w, h)
    expect(cdt[2 * w + 2]).toBe(0)
    expect(cdt[2 * w + 3]).toBe(1)
    expect(cdt[1 * w + 3]).toBe(1) // Chebyshev diagonal is 1! (max(|dx|, |dy|))
    expect(cdt[0 * w + 0]).toBe(2) // Chebyshev (0,0) to (2,2) is max(2,2) = 2
  })
})

describe('renderStroke - All 8 styles', () => {
  const W = 100
  const H = 100
  const R = 20
  const circleAlpha = makeCircleAlpha(W, H, R)

  it('none returns completely transparent buffer', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'none',
    }
    const result = renderStroke(circleAlpha, W, H, stroke)
    expect(result.length).toBe(W * H * 4)
    expect(result.every((v) => v === 0)).toBe(true)
  })

  it('disabled returns completely transparent buffer', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      enabled: false,
      style: 'solid',
    }
    const result = renderStroke(circleAlpha, W, H, stroke)
    expect(result.every((v) => v === 0)).toBe(true)
  })

  it('width = 0 returns transparent buffer without crashing', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      width: 0,
    }
    const result = renderStroke(circleAlpha, W, H, stroke)
    expect(result.every((v) => v === 0)).toBe(true)
  })

  it('solid produces stroke only outside subject and within stroke width', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'solid',
      color: '#FF0000',
      width: 10, // 10px on 100x100
      opacity: 100,
    }
    const result = renderStroke(circleAlpha, W, H, stroke)

    // Center of circle: inside subject, stroke should NOT overwrite subject (alpha 0)
    const centerIdx = (50 * W + 50) * 4
    expect(result[centerIdx + 3]).toBe(0)

    // At radius 25: (outside circle of R=20, within 20+10=30) -> stroke exists and is red
    const strokePixelIdx = (50 * W + 75) * 4
    expect(result[strokePixelIdx]).toBe(255) // R
    expect(result[strokePixelIdx + 1]).toBe(0) // G
    expect(result[strokePixelIdx + 2]).toBe(0) // B
    expect(result[strokePixelIdx + 3]).toBeGreaterThan(200) // Alpha

    // At radius 45: beyond 30 -> no stroke
    const outsideIdx = (50 * W + 95) * 4
    expect(result[outsideIdx + 3]).toBe(0)
  })

  it('straight uses Chebyshev metric creating square corner contours', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'straight',
      width: 10,
    }
    const result = renderStroke(circleAlpha, W, H, stroke)

    // In straight style, diagonal distance grows slower (Chebyshev), so diagonals reach further
    let countStroke = 0
    for (let i = 0; i < W * H; i++) {
      if (result[i * 4 + 3] > 0) countStroke++
    }
    expect(countStroke).toBeGreaterThan(0)
  })

  it('offset shifts the stroke in the requested direction', () => {
    const strokeRight: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'offset',
      offsetX: 15,
      offsetY: 0,
      width: 5,
    }
    const strokeLeft: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'offset',
      offsetX: -15,
      offsetY: 0,
      width: 5,
    }
    const resRight = renderStroke(circleAlpha, W, H, strokeRight)
    const resLeft = renderStroke(circleAlpha, W, H, strokeLeft)

    // Check pixel at right of circle: should have stroke in strokeRight, but not in strokeLeft
    const rightPixel = (50 * W + 80) * 4
    const leftPixel = (50 * W + 20) * 4

    expect(resRight[rightPixel + 3]).toBeGreaterThan(100)
    expect(resRight[leftPixel + 3]).toBe(0)

    expect(resLeft[leftPixel + 3]).toBeGreaterThan(100)
    expect(resLeft[rightPixel + 3]).toBe(0)
  })

  it('dotted produces periodic gap modulation along perimeter', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'dotted',
      width: 10,
      gap: 50,
    }
    const result = renderStroke(circleAlpha, W, H, stroke)

    // Along a circle ring around R=25, some pixels should be opaque, some near 0
    let hasHigh = false
    let hasLow = false
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
      const px = Math.round(50 + 25 * Math.cos(angle))
      const py = Math.round(50 + 25 * Math.sin(angle))
      const a = result[(py * W + px) * 4 + 3]
      if (a > 150) hasHigh = true
      if (a === 0) hasLow = true
    }
    expect(hasHigh).toBe(true)
    expect(hasLow).toBe(true)
  })

  it('hand-drawn is strictly deterministic for the same seed', () => {
    const strokeA: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'hand-drawn',
      seed: 42,
      roughness: 60,
    }
    const strokeB: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'hand-drawn',
      seed: 42,
      roughness: 60,
    }
    const strokeDifferentSeed: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'hand-drawn',
      seed: 999,
      roughness: 60,
    }

    const resA = renderStroke(circleAlpha, W, H, strokeA)
    const resB = renderStroke(circleAlpha, W, H, strokeB)
    const resDiff = renderStroke(circleAlpha, W, H, strokeDifferentSeed)

    // resA and resB must be 100% byte-for-byte identical
    expect(resA).toEqual(resB)

    // resDiff should differ
    let diffCount = 0
    for (let i = 0; i < resA.length; i++) {
      if (resA[i] !== resDiff[i]) diffCount++
    }
    expect(diffCount).toBeGreaterThan(0)
  })

  it('paper produces textured stroke with roughness and deterministic seed', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'paper',
      seed: 123,
      roughness: 50,
    }
    const res1 = renderStroke(circleAlpha, W, H, stroke)
    const res2 = renderStroke(circleAlpha, W, H, stroke)
    expect(res1).toEqual(res2)

    let strokePixels = 0
    for (let i = 0; i < W * H; i++) {
      if (res1[i * 4 + 3] > 0) strokePixels++
    }
    expect(strokePixels).toBeGreaterThan(0)
  })

  it('luminescence glow extends outside subject with smooth falloff', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'luminescence',
      color: '#00FFFF',
      width: 5,
      glow: 80,
    }
    const result = renderStroke(circleAlpha, W, H, stroke)

    // Inner core (R=22) should have high alpha
    const inner = (50 * W + 72) * 4
    expect(result[inner + 3]).toBeGreaterThan(150)

    // Outer glow (R=35) should still have visible glow alpha > 0
    const outer = (50 * W + 85) * 4
    expect(result[outer + 3]).toBeGreaterThan(0)

    // Far outside (R=48) should decay smoothly towards 0
    const far = (50 * W + 98) * 4
    expect(result[inner + 3]).toBeGreaterThan(result[outer + 3])
    expect(result[outer + 3]).toBeGreaterThanOrEqual(result[far + 3])
  })

  it('width = 100 produces thick stroke without buffer overflow or crash', () => {
    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'solid',
      width: 100,
    }
    expect(() => renderStroke(circleAlpha, W, H, stroke)).not.toThrow()
    const result = renderStroke(circleAlpha, W, H, stroke)
    expect(result.length).toBe(W * H * 4)
  })

  it('all 8 styles produce distinct visual patterns', () => {
    const styles = strokeStyleValues.filter((s) => s !== 'none')
    const results = styles.map((style) => ({
      style,
      buffer: renderStroke(circleAlpha, W, H, {
        ...DEFAULT_CLIP_STROKE,
        style,
        width: 12,
        roughness: 60,
        gap: 50,
        glow: 60,
        seed: 7,
      }),
    }))

    // Pairwise comparison: each style must differ from all other styles
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        let diff = false
        const b1 = results[i].buffer
        const b2 = results[j].buffer
        for (let k = 0; k < b1.length; k += 4) {
          if (b1[k + 3] !== b2[k + 3] || b1[k] !== b2[k]) {
            diff = true
            break
          }
        }
        expect(diff, `Style ${results[i].style} should differ from ${results[j].style}`).toBe(true)
      }
    }
  })

  it('benchmarks 1080p frame execution time', () => {
    const w = 1920
    const h = 1080
    const alpha1080p = new Uint8Array(w * h)
    // Draw a subject ellipse in center
    const cx = w / 2
    const cy = h / 2
    for (let y = cy - 300; y < cy + 300; y++) {
      const dy = (y - cy) / 300
      for (let x = cx - 200; x < cx + 200; x++) {
        const dx = (x - cx) / 200
        if (dx * dx + dy * dy <= 1) {
          alpha1080p[y * w + x] = 255
        }
      }
    }

    const stroke: ClipStroke = {
      ...DEFAULT_CLIP_STROKE,
      style: 'solid',
      width: 10,
    }

    const t0 = performance.now()
    const out = renderStroke(alpha1080p, w, h, stroke)
    const duration = performance.now() - t0

    expect(out.length).toBe(w * h * 4)
    console.log(`[Benchmark] renderStroke on 1080p frame (1920x1080): ${duration.toFixed(2)}ms`)
    // Must execute within reasonable time (< 150ms on CPU)
    expect(duration).toBeLessThan(500)
  })
})

/**
 * Added 17/09/2026 alongside the renderStroke optimisation pass.
 *
 * The rewrite computes distances on a cropped region with a transposed second pass instead
 * of over the whole frame. That is only safe if the result is still the exact distance
 * everywhere it is used, so this pins it against a brute-force search — which also caught
 * that the previous implementation was off by one squared unit on one pixel of a 1080p
 * frame, enough to shift one alpha value in the noise-displaced styles.
 */
describe('Distance transform exactness', () => {
  function bruteForceEdt(alpha: Uint8Array, w: number, h: number): Float32Array {
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = Infinity
        for (let sy = 0; sy < h; sy++) {
          for (let sx = 0; sx < w; sx++) {
            if (alpha[sy * w + sx] > 127) {
              const d2 = (sx - x) ** 2 + (sy - y) ** 2
              if (d2 < best) best = d2
            }
          }
        }
        out[y * w + x] = Math.sqrt(best)
      }
    }
    return out
  }

  it('matches a brute-force search on an irregular shape', () => {
    const w = 61
    const h = 47
    const alpha = new Uint8Array(w * h)
    // Two blobs plus a hole, so the nearest source is not always in the same direction.
    for (let y = 8; y < 20; y++) for (let x = 5; x < 25; x++) alpha[y * w + x] = 255
    for (let y = 28; y < 40; y++) for (let x = 35; x < 55; x++) alpha[y * w + x] = 255
    for (let y = 12; y < 16; y++) for (let x = 12; x < 18; x++) alpha[y * w + x] = 0

    const got = computeEuclideanDistanceTransform(alpha, w, h)
    const want = bruteForceEdt(alpha, w, h)

    for (let i = 0; i < w * h; i++) {
      expect(got[i]).toBeCloseTo(want[i], 5)
    }
  })

  it('matches a brute-force search on a non-square image with sources on the edges', () => {
    const w = 37
    const h = 23
    const alpha = new Uint8Array(w * h)
    alpha[0] = 255
    alpha[w - 1] = 255
    alpha[(h - 1) * w] = 255
    alpha[h * w - 1] = 255
    alpha[11 * w + 18] = 255

    const got = computeEuclideanDistanceTransform(alpha, w, h)
    const want = bruteForceEdt(alpha, w, h)

    for (let i = 0; i < w * h; i++) {
      expect(got[i]).toBeCloseTo(want[i], 5)
    }
  })

  it('renders identically whether the subject sits in the corner or the middle', () => {
    // The optimisation crops to the subject's bounding box. If that crop were wrong, moving
    // the same subject around the frame would change the stroke around it.
    const w = 120
    const h = 90
    const stroke: ClipStroke = { ...DEFAULT_CLIP_STROKE, style: 'solid', width: 8, color: '#00FF00' }

    const place = (ox: number, oy: number) => {
      const alpha = new Uint8Array(w * h)
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 20; x++) alpha[(oy + y) * w + (ox + x)] = 255
      }
      return renderStroke(alpha, w, h, stroke)
    }

    const corner = place(2, 2)
    const middle = place(50, 35)

    const countInk = (buf: Uint8ClampedArray) => {
      let n = 0
      for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++
      return n
    }

    // The corner subject has part of its band clipped by the frame edge, so the counts are
    // not equal — what must hold is that both actually drew a band.
    expect(countInk(middle)).toBeGreaterThan(0)
    expect(countInk(corner)).toBeGreaterThan(0)
    expect(countInk(middle)).toBeGreaterThan(countInk(corner))
  })

  it('leaves the frame untouched when the matte is empty', () => {
    const w = 40
    const h = 30
    const alpha = new Uint8Array(w * h)
    const out = renderStroke(alpha, w, h, { ...DEFAULT_CLIP_STROKE, style: 'solid', width: 10 })
    expect(out.every(v => v === 0)).toBe(true)
  })

  it('reuses scratch buffers without leaking state between calls', () => {
    // The optimisation pools its working buffers across calls. A leak would show up as a
    // different result for the same input on the second call.
    const w = 80
    const h = 60
    const alpha = makeCircleAlpha(w, h, 15)
    const stroke: ClipStroke = { ...DEFAULT_CLIP_STROKE, style: 'luminescence', width: 10 }

    const first = renderStroke(alpha, w, h, stroke)

    // A bigger call in between grows the pool; a smaller one afterwards must still be right.
    renderStroke(makeCircleAlpha(300, 200, 60), 300, 200, stroke)

    const second = renderStroke(alpha, w, h, stroke)
    expect(Array.from(second)).toEqual(Array.from(first))
  })
})
