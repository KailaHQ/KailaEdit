import type { ClipStroke } from './project-model'

/**
 * Stroke rendering — the definitive, bit-exact version of the 8 stroke styles.
 *
 * The preview shader in `frontend/views/editor/preview/LutCanvas.tsx` approximates this;
 * this file is what the exported file is built from. See section 4 of
 * `_private/17-tach-nen-tu-dong-va-vien-stroke.md`.
 *
 * PERFORMANCE NOTES — this runs once per exported frame, so it is written for speed:
 *
 * 1. **Only the band is computed.** A stroke can only appear within `bandLimit` pixels of
 *    the subject, so everything works on the subject's bounding box grown by that radius.
 *    On a typical portrait matte that is a fraction of the frame. This is exact, not an
 *    approximation: every foreground pixel lies inside the box, so distances inside the
 *    region are the same as they would be over the whole frame, and every pixel outside
 *    the region is farther than `bandLimit` and therefore transparent either way.
 * 2. **The distance transform runs on contiguous memory.** The separable EDT needs a pass
 *    along columns; walking a column with a stride of `width` misses the cache on almost
 *    every access. Transposing between the two passes turns both into linear scans, which
 *    is where most of the speedup comes from.
 * 3. **`sqrt` only where it matters.** Distances stay squared until a pixel is known to be
 *    inside the band.
 * 4. **Scratch buffers are pooled** instead of allocating ~24 MB per 1080p frame.
 */

const FG_THRESHOLD = 127
const INF = 1e9

// ── Scratch pool ────────────────────────────────────────────────────────────────
// renderStroke is synchronous with no await inside, so a single set of buffers can be
// reused across calls without any risk of two calls interleaving.

let scratchA: Float32Array = new Float32Array(0)
let scratchB: Float32Array = new Float32Array(0)
let scratchAlpha: Uint8Array = new Uint8Array(0)
let scratchV: Int32Array = new Int32Array(0)
let scratchZ: Float32Array = new Float32Array(0)

function ensureScratch(size: number, maxDim: number): void {
  if (scratchA.length < size) scratchA = new Float32Array(size)
  if (scratchB.length < size) scratchB = new Float32Array(size)
  if (scratchV.length < maxDim) scratchV = new Int32Array(maxDim)
  if (scratchZ.length < maxDim + 1) scratchZ = new Float32Array(maxDim + 1)
}

/**
 * Felzenszwalb & Huttenlocher's linear-time 1D squared distance transform over a
 * contiguous span. `f` is the input span, `d` receives the result; both start at `offset`.
 */
function edt1D(f: Float32Array, n: number, offset: number, d: Float32Array): void {
  const v = scratchV
  const z = scratchZ

  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity

  for (let q = 1; q < n; q++) {
    const fq = f[offset + q]
    let s = 0
    while (k >= 0) {
      const vk = v[k]
      s = (fq - f[offset + vk] + (q * q - vk * vk)) / (2 * q - 2 * vk)
      if (s <= z[k]) k--
      else break
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }

  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const vk = v[k]
    const diff = q - vk
    d[offset + q] = diff * diff + f[offset + vk]
  }
}

/** Cache-blocked transpose of an `w x h` matrix into an `h x w` one. */
function transpose(src: Float32Array, dst: Float32Array, w: number, h: number): void {
  const BLOCK = 32
  for (let y0 = 0; y0 < h; y0 += BLOCK) {
    const yMax = Math.min(y0 + BLOCK, h)
    for (let x0 = 0; x0 < w; x0 += BLOCK) {
      const xMax = Math.min(x0 + BLOCK, w)
      for (let y = y0; y < yMax; y++) {
        const srcRow = y * w
        for (let x = x0; x < xMax; x++) {
          dst[x * h + y] = src[srcRow + x]
        }
      }
    }
  }
}

/**
 * Squared Euclidean distance to the nearest foreground pixel, over a sub-rectangle.
 *
 * Writes `rw * rh` values into `out` (row-major over the region). Foreground is read from
 * `alpha` using global coordinates. Exact as long as every foreground pixel lies inside
 * the region — which is how `renderStroke` picks the region.
 */
function edtSquaredRegion(
  alpha: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  out: Float32Array,
): void {
  const size = rw * rh
  ensureScratch(size, Math.max(rw, rh))
  const tmp = scratchB

  // Pass 1 — along rows. The general parabola algorithm is not needed here: within a
  // single row every source is either 0 (foreground) or infinity, so the nearest source
  // is simply the nearest foreground pixel left or right. Two linear sweeps with no
  // divisions give exactly the same squared distances.
  for (let y = 0; y < rh; y++) {
    const srcRow = (y0 + y) * width + x0
    const dstRow = y * rw

    let last = -1
    for (let x = 0; x < rw; x++) {
      if (alpha[srcRow + x] > FG_THRESHOLD) {
        last = x
        tmp[dstRow + x] = 0
      } else {
        const dx = x - last
        tmp[dstRow + x] = last < 0 ? INF : dx * dx
      }
    }

    last = -1
    for (let x = rw - 1; x >= 0; x--) {
      if (alpha[srcRow + x] > FG_THRESHOLD) {
        last = x
      } else if (last >= 0) {
        const dx = last - x
        const d = dx * dx
        if (d < tmp[dstRow + x]) tmp[dstRow + x] = d
      }
    }
  }

  // Transpose so the second pass is contiguous too.
  transpose(tmp, out, rw, rh)

  // Pass 2 — along what were the columns, now rows of the transposed buffer.
  //
  // Two ways of skipping work here were tried and BOTH dropped: scanning each column for
  // its minimum and skipping whole columns measured slower (46 ms -> 58 ms), and filtering
  // hull sites past the band gained nothing. The reason is the same in both cases — the
  // padding is exactly as wide as the band, so almost no column is far enough from the
  // subject to be skippable. Don't try either again without changing the padding first.
  for (let x = 0; x < rw; x++) {
    edt1D(out, rh, x * rh, tmp)
  }

  transpose(tmp, out, rh, rw)
}

/**
 * Euclidean distance (in pixels) to the nearest foreground pixel, over the whole image.
 *
 * Kept as the public, whole-image entry point. `renderStroke` uses the region-limited
 * path above instead.
 */
export function computeEuclideanDistanceTransform(
  alpha: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const size = width * height
  const out = new Float32Array(size)
  if (size === 0) return out

  edtSquaredRegion(alpha, width, 0, 0, width, height, out)
  for (let i = 0; i < size; i++) out[i] = Math.sqrt(out[i])
  return out
}

/**
 * Chebyshev (L-infinity) distance to the nearest foreground pixel, over a sub-rectangle.
 * Contours are axis-aligned, which is what gives the 'straight' style its square corners.
 */
function chebyshevRegion(
  alpha: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  out: Float32Array,
): void {
  const BIG = 1e6

  for (let y = 0; y < rh; y++) {
    const srcRow = (y0 + y) * width + x0
    const dstRow = y * rw
    for (let x = 0; x < rw; x++) {
      out[dstRow + x] = alpha[srcRow + x] > FG_THRESHOLD ? 0 : BIG
    }
  }

  for (let y = 0; y < rh; y++) {
    const rowOffset = y * rw
    for (let x = 0; x < rw; x++) {
      const idx = rowOffset + x
      let d = out[idx]
      if (d === 0) continue
      if (x > 0) {
        const c = out[idx - 1] + 1
        if (c < d) d = c
      }
      if (y > 0) {
        const top = idx - rw
        let c = out[top] + 1
        if (c < d) d = c
        if (x > 0) {
          c = out[top - 1] + 1
          if (c < d) d = c
        }
        if (x < rw - 1) {
          c = out[top + 1] + 1
          if (c < d) d = c
        }
      }
      out[idx] = d
    }
  }

  for (let y = rh - 1; y >= 0; y--) {
    const rowOffset = y * rw
    for (let x = rw - 1; x >= 0; x--) {
      const idx = rowOffset + x
      let d = out[idx]
      if (d === 0) continue
      if (x < rw - 1) {
        const c = out[idx + 1] + 1
        if (c < d) d = c
      }
      if (y < rh - 1) {
        const bot = idx + rw
        let c = out[bot] + 1
        if (c < d) d = c
        if (x < rw - 1) {
          c = out[bot + 1] + 1
          if (c < d) d = c
        }
        if (x > 0) {
          c = out[bot - 1] + 1
          if (c < d) d = c
        }
      }
      out[idx] = d
    }
  }
}

/** Whole-image Chebyshev distance transform. Public entry point. */
export function computeChebyshevDistanceTransform(
  alpha: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height)
  if (out.length === 0) return out
  chebyshevRegion(alpha, width, 0, 0, width, height, out)
  return out
}

/**
 * Deterministic 2D PRNG hash based on integer coordinates and seed.
 *
 * The value-noise interpolation that used to wrap this lives inline in the 'hand-drawn'
 * and 'paper' loops now: the noise grid is much coarser than the pixel grid, so those
 * loops keep the four corner hashes for the current cell and only refresh them when the
 * cell changes, instead of hashing four corners per pixel.
 */
function hash2D(x: number, y: number, seed: number): number {
  let h = (seed ^ (x * 374761393) ^ (y * 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Parse hex string '#RRGGBB' into [r, g, b] 0..255.
 */
function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '')
  const r = parseInt(clean.substring(0, 2) || 'FF', 16)
  const g = parseInt(clean.substring(2, 4) || 'FF', 16)
  const b = parseInt(clean.substring(4, 6) || 'FF', 16)
  return [Number.isFinite(r) ? r : 255, Number.isFinite(g) ? g : 255, Number.isFinite(b) ? b : 255]
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  count: number
  sumX: number
  sumY: number
}

/** Bounding box plus centre of mass of the foreground, in one scan. */
function scanForeground(alpha: Uint8Array, width: number, height: number): Bounds {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let count = 0
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      if (alpha[rowOffset + x] > FG_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        count++
        sumX += x
        sumY += y
      }
    }
  }

  return { minX, minY, maxX, maxY, count, sumX, sumY }
}

/**
 * Pure function: Render subject stroke based on alpha channel and ClipStroke parameters.
 *
 * @param alpha Uint8Array of size width * height (0..255)
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param stroke Stroke parameters
 * @returns Uint8ClampedArray of size width * height * 4 containing RGBA pixels
 */
export function renderStroke(
  alpha: Uint8Array,
  width: number,
  height: number,
  stroke: ClipStroke,
): Uint8ClampedArray {
  const size = width * height
  const out = new Uint8ClampedArray(size * 4)

  if (!stroke.enabled || stroke.style === 'none' || stroke.width <= 0 || width <= 0 || height <= 0) {
    return out
  }

  const [sR, sG, sB] = parseHexColor(stroke.color)
  const baseOpacity = Math.max(0, Math.min(100, stroke.opacity)) / 100
  if (baseOpacity <= 0) return out

  // Values are produced in range, so writing through a plain view skips the clamping step
  // on every store. Anything that can overshoot (the paper grain) is clamped by hand.
  const rgba = new Uint8Array(out.buffer)

  const bounds = scanForeground(alpha, width, height)
  if (bounds.count === 0) return out

  // Stroke width in pixels is percentage of min dimension
  const minDim = Math.min(width, height)
  const strokeW = Math.max(0, (stroke.width / 100) * minDim)

  const centerX = bounds.sumX / bounds.count
  const centerY = bounds.sumY / bounds.count

  const roughness = Math.max(0, Math.min(100, stroke.roughness)) / 100
  const glow = Math.max(1, Math.min(100, stroke.glow)) / 100
  const maxGlowRadius = strokeW + minDim * 0.15 * glow
  const paperW = strokeW * 1.15
  const handNoiseAmp = strokeW * 0.7 * roughness
  const paperNoiseAmp = strokeW * 0.5 * roughness

  // How far from the subject this style can still put ink. Noise can only pull a pixel
  // `amp` closer to the band, so the reach grows by the same amount.
  let bandLimit: number
  switch (stroke.style) {
    case 'luminescence':
      bandLimit = maxGlowRadius
      break
    case 'hand-drawn':
      bandLimit = strokeW + handNoiseAmp
      break
    case 'paper':
      bandLimit = paperW + paperNoiseAmp
      break
    default:
      bandLimit = strokeW
  }

  // Region of interest: the subject's box grown by the reach. For 'offset' the distance
  // field is built from the shifted subject, so the box shifts with it.
  const rawX = stroke.offsetX
  const rawY = stroke.offsetY
  const isOffset = stroke.style === 'offset'
  const effX = isOffset && rawX === 0 && rawY === 0 ? 5 : rawX
  const effY = isOffset && rawX === 0 && rawY === 0 ? 5 : rawY
  const offX = isOffset ? Math.round((effX / 100) * minDim) : 0
  const offY = isOffset ? Math.round((effY / 100) * minDim) : 0

  const pad = Math.ceil(bandLimit) + 2
  const x0 = Math.max(0, Math.min(bounds.minX, bounds.minX + offX) - pad)
  const y0 = Math.max(0, Math.min(bounds.minY, bounds.minY + offY) - pad)
  const x1 = Math.min(width - 1, Math.max(bounds.maxX, bounds.maxX + offX) + pad)
  const y1 = Math.min(height - 1, Math.max(bounds.maxY, bounds.maxY + offY) + pad)
  const rw = x1 - x0 + 1
  const rh = y1 - y0 + 1
  if (rw <= 0 || rh <= 0) return out

  const regionSize = rw * rh
  ensureScratch(regionSize, Math.max(rw, rh))
  const dist = scratchA

  // 'offset' keys off a shifted copy of the subject; everything else off the subject itself.
  let source = alpha
  let shifted: Uint8Array | null = null
  if (isOffset) {
    if (scratchAlpha.length < size) scratchAlpha = new Uint8Array(size)
    shifted = scratchAlpha
    shifted.fill(0, 0, size)
    for (let y = 0; y < height; y++) {
      const srcY = y - offY
      if (srcY < 0 || srcY >= height) continue
      const dstRow = y * width
      const srcRow = srcY * width
      for (let x = 0; x < width; x++) {
        const srcX = x - offX
        if (srcX < 0 || srcX >= width) continue
        shifted[dstRow + x] = alpha[srcRow + srcX]
      }
    }
    source = shifted
  }

  if (stroke.style === 'straight') {
    chebyshevRegion(source, width, x0, y0, rw, rh, dist)
  } else {
    edtSquaredRegion(source, width, x0, y0, rw, rh, dist)
  }
  // 'straight' works in Chebyshev distance, which the region helper returns unsquared.
  const distIsSquared = stroke.style !== 'straight'
  const limit = bandLimit
  const limitCmp = distIsSquared ? limit * limit : limit

  const gapFactor = Math.max(10, stroke.gap) / 50
  const dotPeriod = Math.max(6, strokeW * 1.5 * gapFactor)
  const glowSigma = Math.max(1, maxGlowRadius * 0.35)
  const glowCoreW = Math.max(1, strokeW * 0.3)
  const seed = stroke.seed
  const style = stroke.style

  // One tight loop per style. Keeping the switch outside the loop matters at 2 megapixels
  // a frame, and it lets the two noise styles hoist their per-row work.

  switch (style) {
    case 'solid':
    case 'straight': {
      for (let ry = 0; ry < rh; ry++) {
        const regionRow = ry * rw
        const imageRow = (y0 + ry) * width + x0
        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue
          const d = distIsSquared ? Math.sqrt(raw) : raw
          const edgeFactor = Math.max(0, Math.min(1, strokeW - d + 0.5))
          const px = i * 4
          rgba[px] = sR
          rgba[px + 1] = sG
          rgba[px + 2] = sB
          rgba[px + 3] = Math.round(edgeFactor * baseOpacity * 255)
        }
      }
      break
    }

    case 'offset': {
      const shiftedAlpha = shifted!
      for (let ry = 0; ry < rh; ry++) {
        const regionRow = ry * rw
        const imageRow = (y0 + ry) * width + x0
        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue
          const edgeFactor =
            shiftedAlpha[i] > FG_THRESHOLD
              ? 1
              : Math.max(0, Math.min(1, strokeW - Math.sqrt(raw) + 0.5))
          const px = i * 4
          rgba[px] = sR
          rgba[px + 1] = sG
          rgba[px + 2] = sB
          rgba[px + 3] = Math.round(edgeFactor * baseOpacity * 255)
        }
      }
      break
    }

    case 'dotted': {
      for (let ry = 0; ry < rh; ry++) {
        const y = y0 + ry
        const dy = y - centerY
        const regionRow = ry * rw
        const imageRow = y * width + x0
        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue

          const dx = x0 + rx - centerX
          const arcPos = Math.atan2(dy, dx) * Math.sqrt(dx * dx + dy * dy)
          const dotVal = Math.cos((2 * Math.PI * arcPos) / dotPeriod)
          if (dotVal <= 0.1) continue

          const d = Math.sqrt(raw)
          const dotAlpha = Math.min(1, (dotVal - 0.1) / 0.5)
          const edgeFactor = Math.max(0, Math.min(1, strokeW - d + 0.5))
          const px = i * 4
          rgba[px] = sR
          rgba[px + 1] = sG
          rgba[px + 2] = sB
          rgba[px + 3] = Math.round(dotAlpha * edgeFactor * baseOpacity * 255)
        }
      }
      break
    }

    case 'hand-drawn': {
      const SCALE = 0.04
      for (let ry = 0; ry < rh; ry++) {
        const y = y0 + ry
        const regionRow = ry * rw
        const imageRow = y * width + x0

        const ny = y * SCALE
        const iY = Math.floor(ny)
        const fY = ny - iY
        const vY = fY * fY * fY * (fY * (fY * 6 - 15) + 10)

        let cellX = 0x7fffffff
        let n00 = 0
        let n10 = 0
        let n01 = 0
        let n11 = 0

        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue

          const nx = (x0 + rx) * SCALE
          const iX = Math.floor(nx)
          if (iX !== cellX) {
            // The noise grid is far coarser than the pixel grid, so the four corner
            // hashes only change every 1/SCALE pixels.
            cellX = iX
            n00 = hash2D(iX, iY, seed)
            n10 = hash2D(iX + 1, iY, seed)
            n01 = hash2D(iX, iY + 1, seed)
            n11 = hash2D(iX + 1, iY + 1, seed)
          }
          const fX = nx - iX
          const uX = fX * fX * fX * (fX * (fX * 6 - 15) + 10)
          const nx0 = n00 * (1 - uX) + n10 * uX
          const nx1 = n01 * (1 - uX) + n11 * uX
          const n = (nx0 * (1 - vY) + nx1 * vY) * 2 - 1

          const noisyD = Math.sqrt(raw) + n * handNoiseAmp
          if (noisyD > strokeW) continue

          const edgeFactor = Math.max(0, Math.min(1, strokeW - noisyD + 0.5))
          const px = i * 4
          rgba[px] = sR
          rgba[px + 1] = sG
          rgba[px + 2] = sB
          rgba[px + 3] = Math.round(edgeFactor * baseOpacity * 255)
        }
      }
      break
    }

    case 'paper': {
      const CONTOUR_SCALE = 0.015
      const GRAIN_SCALE = 0.2
      const grainSeed = seed + 101

      for (let ry = 0; ry < rh; ry++) {
        const y = y0 + ry
        const regionRow = ry * rw
        const imageRow = y * width + x0

        const cy = y * CONTOUR_SCALE
        const ciY = Math.floor(cy)
        const cfY = cy - ciY
        const cvY = cfY * cfY * cfY * (cfY * (cfY * 6 - 15) + 10)

        const gy = y * GRAIN_SCALE
        const giY = Math.floor(gy)
        const gfY = gy - giY
        const gvY = gfY * gfY * gfY * (gfY * (gfY * 6 - 15) + 10)

        let cCell = 0x7fffffff
        let c00 = 0, c10 = 0, c01 = 0, c11 = 0
        let gCell = 0x7fffffff
        let g00 = 0, g10 = 0, g01 = 0, g11 = 0

        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue

          const x = x0 + rx

          const cx = x * CONTOUR_SCALE
          const ciX = Math.floor(cx)
          if (ciX !== cCell) {
            cCell = ciX
            c00 = hash2D(ciX, ciY, seed)
            c10 = hash2D(ciX + 1, ciY, seed)
            c01 = hash2D(ciX, ciY + 1, seed)
            c11 = hash2D(ciX + 1, ciY + 1, seed)
          }
          const cfX = cx - ciX
          const cuX = cfX * cfX * cfX * (cfX * (cfX * 6 - 15) + 10)
          const cx0 = c00 * (1 - cuX) + c10 * cuX
          const cx1 = c01 * (1 - cuX) + c11 * cuX
          const n = (cx0 * (1 - cvY) + cx1 * cvY) * 2 - 1

          const noisyD = Math.sqrt(raw) + n * paperNoiseAmp
          if (noisyD > paperW) continue

          const gx = x * GRAIN_SCALE
          const giX = Math.floor(gx)
          if (giX !== gCell) {
            gCell = giX
            g00 = hash2D(giX, giY, grainSeed)
            g10 = hash2D(giX + 1, giY, grainSeed)
            g01 = hash2D(giX, giY + 1, grainSeed)
            g11 = hash2D(giX + 1, giY + 1, grainSeed)
          }
          const gfX = gx - giX
          const guX = gfX * gfX * gfX * (gfX * (gfX * 6 - 15) + 10)
          const gx0 = g00 * (1 - guX) + g10 * guX
          const gx1 = g01 * (1 - guX) + g11 * guX
          const grain = 1.0 + ((gx0 * (1 - gvY) + gx1 * gvY) * 2 - 1) * 0.12

          const edgeFactor = Math.max(0, Math.min(1, paperW - noisyD + 0.5))
          const px = i * 4
          rgba[px] = Math.max(0, Math.min(255, Math.round(sR * grain)))
          rgba[px + 1] = Math.max(0, Math.min(255, Math.round(sG * grain)))
          rgba[px + 2] = Math.max(0, Math.min(255, Math.round(sB * grain)))
          rgba[px + 3] = Math.round(edgeFactor * baseOpacity * 255)
        }
      }
      break
    }

    case 'luminescence': {
      for (let ry = 0; ry < rh; ry++) {
        const regionRow = ry * rw
        const imageRow = (y0 + ry) * width + x0
        for (let rx = 0; rx < rw; rx++) {
          const i = imageRow + rx
          if (alpha[i] > FG_THRESHOLD) continue
          const raw = dist[regionRow + rx]
          if (raw > limitCmp) continue

          const d = Math.sqrt(raw)
          let intensity: number
          if (d <= glowCoreW) {
            intensity = 1.0
          } else {
            const cutoff = Math.max(0, 1 - (d / maxGlowRadius) ** 2)
            intensity = Math.exp(-(d - glowCoreW) / glowSigma) * cutoff
          }
          if (intensity <= 0.005) continue

          const px = i * 4
          rgba[px] = sR
          rgba[px + 1] = sG
          rgba[px + 2] = sB
          rgba[px + 3] = Math.round(Math.min(1, intensity) * baseOpacity * 255)
        }
      }
      break
    }
  }

  return out
}
