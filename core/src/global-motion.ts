/**
 * Global motion of a shot: how the whole picture moved between one frame and another.
 *
 * A smart brush selects an object on ONE frame, and the selection is a fixed mask of the
 * picture. On a shot where the camera pans or zooms, the object slides out from under that
 * mask while the video plays. This estimates the camera's motion — a similarity (shift, zoom,
 * turn) — so the mask can follow it. Objects that move by themselves inside the frame are not
 * followed; they are the minority of the picture and are down-weighted rather than tracked.
 *
 * Pure and dependency-free: used by the export (main process), the preview and the tests.
 */

/** [m00, m01, m02, m10, m11, m12]: x' = m00 x + m01 y + m02, y' = m10 x + m11 y + m12. */
export type Affine = [number, number, number, number, number, number]

export const IDENTITY_AFFINE: Affine = [1, 0, 0, 0, 1, 0]

export function multiplyAffine(p: Affine, q: Affine): Affine {
  // p ∘ q: apply q first, then p.
  return [
    p[0] * q[0] + p[1] * q[3],
    p[0] * q[1] + p[1] * q[4],
    p[0] * q[2] + p[1] * q[5] + p[2],
    p[3] * q[0] + p[4] * q[3],
    p[3] * q[1] + p[4] * q[4],
    p[3] * q[2] + p[4] * q[5] + p[5],
  ]
}

export function invertAffine(m: Affine): Affine | null {
  const det = m[0] * m[4] - m[1] * m[3]
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  const i00 = m[4] / det
  const i01 = -m[1] / det
  const i10 = -m[3] / det
  const i11 = m[0] / det
  return [i00, i01, -(i00 * m[2] + i01 * m[5]), i10, i11, -(i10 * m[2] + i11 * m[5])]
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

/** The factor lengths are scaled by, for a near-similarity. */
export function affineScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]))
}

export function isNearIdentity(m: Affine, tolerance = 1e-3): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY_AFFINE[i]) < tolerance)
}

// ── Image pyramid ──────────────────────────────────────────────────────────

interface Level {
  width: number
  height: number
  pixels: Float32Array
}

function halve(level: Level): Level {
  const width = Math.max(1, level.width >> 1)
  const height = Math.max(1, level.height >> 1)
  const pixels = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(level.width - 1, x * 2)
      const sy = Math.min(level.height - 1, y * 2)
      const sx1 = Math.min(level.width - 1, sx + 1)
      const sy1 = Math.min(level.height - 1, sy + 1)
      pixels[y * width + x] = (
        level.pixels[sy * level.width + sx] + level.pixels[sy * level.width + sx1]
        + level.pixels[sy1 * level.width + sx] + level.pixels[sy1 * level.width + sx1]
      ) / 4
    }
  }
  return { width, height, pixels }
}

/** A light blur so the gradients of the top level are not just sensor noise. */
function smooth(level: Level): Level {
  const { width, height, pixels } = level
  const tmp = new Float32Array(pixels.length)
  const out = new Float32Array(pixels.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = pixels[y * width + Math.max(0, x - 1)]
      const r = pixels[y * width + Math.min(width - 1, x + 1)]
      tmp[y * width + x] = (l + 2 * pixels[y * width + x] + r) / 4
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = tmp[Math.max(0, y - 1) * width + x]
      const d = tmp[Math.min(height - 1, y + 1) * width + x]
      out[y * width + x] = (u + 2 * tmp[y * width + x] + d) / 4
    }
  }
  return { width, height, pixels: out }
}

function buildPyramid(width: number, height: number, gray: ArrayLike<number>, levels: number): Level[] {
  const base = new Float32Array(width * height)
  for (let i = 0; i < base.length; i++) base[i] = gray[i]
  const out: Level[] = [smooth({ width, height, pixels: base })]
  for (let l = 1; l < levels; l++) {
    const prev = out[l - 1]
    if (prev.width < 24 || prev.height < 24) break
    out.push(smooth(halve(prev)))
  }
  return out
}

function sampleBilinear(level: Level, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const w = level.width
  const p = level.pixels
  const x1 = x0 + 1
  const y1 = y0 + 1
  return (
    p[y0 * w + x0] * (1 - fx) * (1 - fy) + p[y0 * w + x1] * fx * (1 - fy)
    + p[y1 * w + x0] * (1 - fx) * fy + p[y1 * w + x1] * fx * fy
  )
}

// ── Alignment ──────────────────────────────────────────────────────────────

/** Similarity in centred pixel coordinates of one level: [a, b, tx, ty] with x' = a x - b y + tx. */
type Sim = [number, number, number, number]

function solve4(h: Float64Array, g: Float64Array): Float64Array | null {
  // Gaussian elimination on a 4x4 system with partial pivoting.
  const a: number[][] = []
  for (let i = 0; i < 4; i++) a.push([h[i * 4], h[i * 4 + 1], h[i * 4 + 2], h[i * 4 + 3], g[i]])
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (Math.abs(a[piv][c]) < 1e-9) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    for (let r = c + 1; r < 4; r++) {
      const f = a[r][c] / a[c][c]
      for (let k = c; k < 5; k++) a[r][k] -= f * a[c][k]
    }
  }
  const x = new Float64Array(4)
  for (let r = 3; r >= 0; r--) {
    let s = a[r][4]
    for (let k = r + 1; k < 4; k++) s -= a[r][k] * x[k]
    x[r] = s / a[r][r]
  }
  return x
}

/**
 * Inverse-compositional alignment of `cur` to `ref` on one pyramid level: finds the similarity
 * that carries a point of the reference onto the same point of the current frame.
 */
function alignLevel(ref: Level, cur: Level, start: Sim, iterations: number): Sim {
  const { width, height } = ref
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const inset = 2

  // Steepest-descent images of the reference are fixed for the whole level.
  const count = width * height
  const sd = new Float32Array(count * 4)
  const tx = new Float32Array(count)
  const ty = new Float32Array(count)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx = (ref.pixels[i + 1] - ref.pixels[i - 1]) / 2
      const gy = (ref.pixels[i + width] - ref.pixels[i - width]) / 2
      tx[i] = gx
      ty[i] = gy
      const px = x - cx
      const py = y - cy
      sd[i * 4] = gx * px + gy * py
      sd[i * 4 + 1] = -gx * py + gy * px
      sd[i * 4 + 2] = gx
      sd[i * 4 + 3] = gy
    }
  }

  let [a, b, tX, tY] = start
  const residual = new Float32Array(count)
  const valid = new Uint8Array(count)

  for (let iter = 0; iter < iterations; iter++) {
    let absSum = 0
    let n = 0
    for (let y = inset; y < height - inset; y++) {
      for (let x = inset; x < width - inset; x++) {
        const i = y * width + x
        const px = x - cx
        const py = y - cy
        const wx = a * px - b * py + tX + cx
        const wy = b * px + a * py + tY + cy
        if (wx < 1 || wy < 1 || wx >= cur.width - 2 || wy >= cur.height - 2) {
          valid[i] = 0
          continue
        }
        const e = sampleBilinear(cur, wx, wy) - ref.pixels[i]
        residual[i] = e
        valid[i] = 1
        absSum += Math.abs(e)
        n++
      }
    }
    if (n < count * 0.15) break // too little overlap to say anything
    // Cauchy weights: what moved on its own, or was uncovered, has a large residual and counts less.
    const scale = Math.max(2, (absSum / n) * 1.5)

    const h = new Float64Array(16)
    const g = new Float64Array(4)
    for (let y = inset; y < height - inset; y++) {
      for (let x = inset; x < width - inset; x++) {
        const i = y * width + x
        if (!valid[i]) continue
        const e = residual[i]
        const w = 1 / (1 + (e / scale) * (e / scale))
        const s0 = sd[i * 4]
        const s1 = sd[i * 4 + 1]
        const s2 = sd[i * 4 + 2]
        const s3 = sd[i * 4 + 3]
        h[0] += w * s0 * s0; h[1] += w * s0 * s1; h[2] += w * s0 * s2; h[3] += w * s0 * s3
        h[5] += w * s1 * s1; h[6] += w * s1 * s2; h[7] += w * s1 * s3
        h[10] += w * s2 * s2; h[11] += w * s2 * s3
        h[15] += w * s3 * s3
        g[0] += w * s0 * e; g[1] += w * s1 * e; g[2] += w * s2 * e; g[3] += w * s3 * e
      }
    }
    h[4] = h[1]; h[8] = h[2]; h[9] = h[6]; h[12] = h[3]; h[13] = h[7]; h[14] = h[11]
    // A small ridge keeps a flat, textureless picture from throwing the estimate around.
    for (let k = 0; k < 4; k++) h[k * 4 + k] += 1e-3
    const d = solve4(h, g)
    if (!d) break

    // W <- W ∘ ΔW⁻¹, with ΔW = [[1+da, -db, dtx], [db, 1+da, dty]] in centred coordinates.
    const da = d[0]
    const db = d[1]
    const dtx = d[2]
    const dty = d[3]
    const det = (1 + da) * (1 + da) + db * db
    const ia = (1 + da) / det
    const ib = -db / det
    const itx = -(ia * dtx - ib * dty)
    const ity = -(ib * dtx + ia * dty)
    // Compose [[a, -b, tX], [b, a, tY]] with the inverse [[ia, -ib, itx], [ib, ia, ity]].
    const na = a * ia - b * ib
    const nb = b * ia + a * ib
    const ntx = a * itx - b * ity + tX
    const nty = b * itx + a * ity + tY
    a = na; b = nb; tX = ntx; tY = nty
    if (Math.abs(da) + Math.abs(db) < 1e-5 && Math.abs(dtx) + Math.abs(dty) < 1e-3) break
  }
  return [a, b, tX, tY]
}

/** Follows one shot's global motion, frame by frame, against its first frame. */
export class MotionTracker {
  private readonly ref: Level[]
  private readonly levels: number
  /** Similarity of the last frame, in centred pixel coordinates of the base level. */
  private last: Sim = [1, 0, 0, 0]

  constructor(readonly width: number, readonly height: number, referenceGray: ArrayLike<number>, levels = 4) {
    this.ref = buildPyramid(width, height, referenceGray, levels)
    this.levels = this.ref.length
  }

  /**
   * Motion of a later frame relative to the reference, as an affine map of normalised picture
   * coordinates (0..1 on both axes): a point of the reference lands at the returned position
   * in this frame.
   */
  push(gray: ArrayLike<number>): Affine {
    const cur = buildPyramid(this.width, this.height, gray, this.levels)
    // Coarse to fine, starting from where the previous frame ended up (the shot moves smoothly).
    let sim: Sim = [...this.last] as Sim
    for (let l = this.levels - 1; l >= 0; l--) {
      const k = 2 ** l
      const level: Sim = [sim[0], sim[1], sim[2] / k, sim[3] / k]
      const refined = alignLevel(this.ref[l], cur[l], level, l === 0 ? 10 : 15)
      sim = [refined[0], refined[1], refined[2] * k, refined[3] * k]
    }
    // A wild answer (a cut, a flash) is worse than holding still.
    const scale = Math.hypot(sim[0], sim[1])
    if (!(scale > 0.4 && scale < 2.5) || !sim.every(Number.isFinite)) sim = [...this.last] as Sim
    this.last = sim
    return this.toNormalised(sim)
  }

  private toNormalised(sim: Sim): Affine {
    const { width, height } = this
    const cx = (width - 1) / 2
    const cy = (height - 1) / 2
    const [a, b, tx, ty] = sim
    // Pixel map: p' = M (p - c) + c + t. Normalised coordinates are pixel / size.
    const m00 = a
    const m01 = -b
    const m10 = b
    const m11 = a
    const e = -(m00 * cx + m01 * cy) + cx + tx
    const f = -(m10 * cx + m11 * cy) + cy + ty
    return [m00, (m01 * height) / width, e / width, (m10 * width) / height, m11, f / height]
  }
}
