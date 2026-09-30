import { describe, expect, it } from 'vitest'
import { applyAffine, invertAffine, MotionTracker, type Affine } from '../src/global-motion'

const W = 96
const H = 128

/** A deterministic picture with detail at several scales, defined for any (x, y). */
function texture(x: number, y: number): number {
  return 128
    + 40 * Math.sin(x * 0.21 + Math.cos(y * 0.13) * 2)
    + 35 * Math.sin(y * 0.17 - x * 0.05)
    + 20 * Math.sin((x + y) * 0.43)
    + 15 * Math.cos(x * 0.09) * Math.sin(y * 0.11)
}

/** The picture after a similarity: scale, turn (radians) and shift (pixels) about its centre. */
function moved(scale: number, angle: number, shiftX: number, shiftY: number): Uint8Array {
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  const a = scale * Math.cos(angle)
  const b = scale * Math.sin(angle)
  const det = a * a + b * b
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Inverse map of p' = R(p - c) + c + t
      const dx = x - cx - shiftX
      const dy = y - cy - shiftY
      const sx = (a * dx + b * dy) / det + cx
      const sy = (-b * dx + a * dy) / det + cy
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(texture(sx, sy))))
    }
  }
  return out
}

/** Where the estimate puts a point of the reference, against where the picture really moved it. */
function pixelError(estimate: Affine, scale: number, angle: number, shiftX: number, shiftY: number): number {
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  let worst = 0
  for (const [px, py] of [[20, 30], [70, 40], [50, 100], [15, 110]]) {
    const dx = px - cx
    const dy = py - cy
    const truth = [
      scale * (Math.cos(angle) * dx - Math.sin(angle) * dy) + cx + shiftX,
      scale * (Math.sin(angle) * dx + Math.cos(angle) * dy) + cy + shiftY,
    ]
    const [u, v] = applyAffine(estimate, px / W, py / H)
    worst = Math.max(worst, Math.hypot(u * W - truth[0], v * H - truth[1]))
  }
  return worst
}

describe('MotionTracker', () => {
  it('finds a shift and a zoom between two frames', () => {
    const tracker = new MotionTracker(W, H, moved(1, 0, 0, 0))
    const estimate = tracker.push(moved(1.08, 0, 3, -2))
    expect(pixelError(estimate, 1.08, 0, 3, -2)).toBeLessThan(0.6)
  })

  it('finds a small turn as well', () => {
    const tracker = new MotionTracker(W, H, moved(1, 0, 0, 0))
    const angle = (2 * Math.PI) / 180
    expect(pixelError(tracker.push(moved(1, angle, -2, 1)), 1, angle, -2, 1)).toBeLessThan(0.6)
  })

  it('follows a zoom that grows over many frames, further than one step would find', () => {
    const tracker = new MotionTracker(W, H, moved(1, 0, 0, 0))
    let estimate: Affine = [1, 0, 0, 0, 1, 0]
    for (let k = 1; k <= 12; k++) estimate = tracker.push(moved(1 - k * 0.02, 0, k * 0.8, k * 0.5))
    expect(pixelError(estimate, 1 - 12 * 0.02, 0, 12 * 0.8, 12 * 0.5)).toBeLessThan(1.2)
  })

  it('reports no motion for a picture that did not move', () => {
    const tracker = new MotionTracker(W, H, moved(1, 0, 0, 0))
    const estimate = tracker.push(moved(1, 0, 0, 0))
    expect(pixelError(estimate, 1, 0, 0, 0)).toBeLessThan(0.1)
  })

  it('produces an invertible map', () => {
    const tracker = new MotionTracker(W, H, moved(1, 0, 0, 0))
    expect(invertAffine(tracker.push(moved(1.05, 0, 1, 1)))).not.toBeNull()
  })
})
