import { fastHash64 } from './render-cache'
import { computeEuclideanDistanceTransform } from './stroke-style'
import type { BrushStroke } from './project-model'
import { decodeRegionMask, sampleRegionMask } from './smart-select'
import { affineScale, applyAffine, invertAffine, type Affine } from './global-motion'

/**
 * Computes a deterministic SHA-256 / 64-bit fast hash from the list of brush strokes.
 * If two stroke lists have identical hash, rebaking is unnecessary.
 */
export function computeStrokesHash(strokes: BrushStroke[], motionKey = ''): string {
  if (!strokes || strokes.length === 0) return ''
  const canonical = strokes
    .map((s) => {
      const pts = s.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')
      return `${s.mode}:${s.size.toFixed(2)}:${s.paintedAt.toFixed(2)}:[${pts}]${s.region ? `:${s.region.width}x${s.region.height}:${s.region.rle}` : ''}`
    })
    .join('|')
  return fastHash64(motionKey ? `${canonical}#${motionKey}` : canonical)
}

/**
 * Distance from point (px, py) to line segment between (x0, y0) and (x1, y1).
 */
function distToSegmentSquared(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const l2 = (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)
  if (l2 === 0) {
    const dx = px - x0
    const dy = py - y0
    return dx * dx + dy * dy
  }
  let t = ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / l2
  t = Math.max(0, Math.min(1, t))
  const projX = x0 + t * (x1 - x0)
  const projY = y0 + t * (y1 - y0)
  const dx = px - projX
  const dy = py - projY
  return dx * dx + dy * dy
}

/**
 * How much a stored selection's edge is steepened when it is laid onto the picture.
 *
 * A selection is kept at a fraction of the picture's size and read back bilinearly, so a hard
 * outline arrives as a ramp several pixels wide. One selection alone hides that. Two that meet
 * do not: a smart eraser taken over the hair and a smart brush taken over the hair after it
 * never share an outline exactly, and where the eraser's ramp reaches past the brush's, the
 * strip between them is left half erased — a translucent seam of the picture's own colour
 * (the "smear" and the "gap"). Steepening the ramp around its midpoint keeps the outline
 * where the model put it and shrinks that strip to about a pixel.
 */
const REGION_EDGE_GAIN = 5
/**
 * Where a smart eraser's edge sits on that ramp. Slightly inside the model's outline (0.5), so
 * an eraser never takes a sliver of what lies beside the object it was taken over; the brush
 * keeps the outline itself, or it would pull the wall in with the object.
 */
const REGION_ERASER_EDGE = 0.6

export interface RasterizeOptions {
  /**
   * Filter strokes by mode category.
   * 'regular': only 'brush' and 'eraser'
   * 'region': only 'region-brush' and 'region-eraser'
   * 'all': all strokes (default)
   */
  filter?: 'all' | 'regular' | 'region'
  /**
   * For a video whose picture moves: maps the picture as it was when a stroke was painted onto
   * the reference picture the masks are kept in. Null (or no function) leaves a stroke where
   * it was painted. See matte-motion.
   */
  toReference?: (paintedAt: number) => Affine | null
}

/**
 * Rasterizes a list of vector strokes onto two separate 8-bit masks:
 * - `brushMask`: additive pixels (0..255)
 * - `eraserMask`: subtractive pixels (0..255)
 *
 * Coordinates are normalized 0..1 relative to width and height.
 * Stroke size is expressed as a percentage of the frame's short edge:
 * radius = (min(width, height) * (size / 100)) / 2.
 */
export function rasterizeStrokes(
  strokes: BrushStroke[],
  width: number,
  height: number,
  options?: RasterizeOptions,
): { brushMask: Uint8Array; eraserMask: Uint8Array } {
  const size = width * height
  const brushMask = new Uint8Array(size)
  const eraserMask = new Uint8Array(size)

  if (size === 0 || !strokes || strokes.length === 0) {
    return { brushMask, eraserMask }
  }

  const shortEdge = Math.min(width, height)
  const filter = options?.filter ?? 'all'

  for (const stroke of strokes) {
    if (filter === 'regular' && (stroke.mode === 'region-brush' || stroke.mode === 'region-eraser')) {
      continue
    }
    if (filter === 'region' && (stroke.mode === 'brush' || stroke.mode === 'eraser')) {
      continue
    }

    const isAdditive = stroke.mode === 'brush' || stroke.mode === 'region-brush'
    const targetMask = isAdditive ? brushMask : eraserMask
    const oppMask = isAdditive ? eraserMask : brushMask
    const toRef = options?.toReference?.(stroke.paintedAt) ?? null

    if (stroke.region) {
      // A smart stroke is the object it selected, stored as a small mask of the picture.
      const region = decodeRegionMask(stroke.region)
      // Where a reference pixel lies on the picture the stroke was painted on.
      const fromRef = toRef ? invertAffine(toRef) : null
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let u = (x + 0.5) / width
          let v = (y + 0.5) / height
          if (fromRef) {
            ;[u, v] = applyAffine(fromRef, u, v)
            if (u < 0 || v < 0 || u > 1 || v > 1) continue
          }
          const soft = sampleRegionMask(region, stroke.region.width, stroke.region.height, u, v) / 255
          const alpha = Math.round(255 * Math.max(0, Math.min(1, (soft - (isAdditive ? 0.5 : REGION_ERASER_EDGE)) * REGION_EDGE_GAIN + 0.5)))
          if (alpha <= 0) continue
          const idx = y * width + x
          if (alpha > targetMask[idx]) targetMask[idx] = alpha
          if (alpha === 255) oppMask[idx] = 0
        }
      }
      continue
    }

    const strokeRadius = Math.max(0.5, (shortEdge * (stroke.size / 100) * (toRef ? affineScale(toRef) : 1)) / 2)
    const strokeRadiusSq = strokeRadius * strokeRadius
    const pad = Math.ceil(strokeRadius + 1)

    const pts = toRef ? stroke.points.map(([px, py]) => applyAffine(toRef, px, py)) : stroke.points
    if (pts.length === 0) continue

    if (pts.length === 1) {
      // Single dot / click
      const cx = pts[0][0] * width
      const cy = pts[0][1] * height
      const minX = Math.max(0, Math.floor(cx - pad))
      const maxX = Math.min(width - 1, Math.ceil(cx + pad))
      const minY = Math.max(0, Math.floor(cy - pad))
      const maxY = Math.min(height - 1, Math.ceil(cy + pad))

      for (let y = minY; y <= maxY; y++) {
        const row = y * width
        const dy = y - cy
        const dy2 = dy * dy
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx
          const d2 = dx * dx + dy2
          if (d2 <= strokeRadiusSq) {
            const d = Math.sqrt(d2)
            const alpha = d <= strokeRadius - 0.5 ? 255 : Math.round(255 * Math.max(0, strokeRadius + 0.5 - d))
            const idx = row + x
            if (alpha > targetMask[idx]) targetMask[idx] = alpha
            if (alpha === 255) oppMask[idx] = 0
          }
        }
      }
      continue
    }

    // Connect contiguous segments
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i][0] * width
      const y0 = pts[i][1] * height
      const x1 = pts[i + 1][0] * width
      const y1 = pts[i + 1][1] * height

      const segMinX = Math.max(0, Math.floor(Math.min(x0, x1) - pad))
      const segMaxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + pad))
      const segMinY = Math.max(0, Math.floor(Math.min(y0, y1) - pad))
      const segMaxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + pad))

      for (let y = segMinY; y <= segMaxY; y++) {
        const row = y * width
        for (let x = segMinX; x <= segMaxX; x++) {
          const d2 = distToSegmentSquared(x, y, x0, y0, x1, y1)
          if (d2 <= strokeRadiusSq) {
            const d = Math.sqrt(d2)
            const alpha = d <= strokeRadius - 0.5 ? 255 : Math.round(255 * Math.max(0, strokeRadius + 0.5 - d))
            const idx = row + x
            if (alpha > targetMask[idx]) targetMask[idx] = alpha
            if (alpha === 255) oppMask[idx] = 0
          }
        }
      }
    }
  }

  return { brushMask, eraserMask }
}

/**
 * Color criterion computed from the seed region at paintedAt time.
 */
export interface RegionCriterion {
  meanR: number
  meanG: number
  meanB: number
  varR: number
  varG: number
  varB: number
  /** Euclidean color distance threshold (default 38.0) */
  threshold: number
}

/**
 * Computes color statistics (mean and variance in RGB) of pixels covered by seed stroke.
 */
export function computeRegionCriterion(
  rgb: Uint8Array,
  seed: Uint8Array,
  width: number,
  height: number,
  threshold = 38.0,
): RegionCriterion {
  const pixelCount = width * height
  const channels = rgb.length >= pixelCount * 4 ? 4 : 3

  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0

  for (let i = 0; i < pixelCount; i++) {
    if (seed[i] > 127) {
      const idx = i * channels
      sumR += rgb[idx]
      sumG += rgb[idx + 1]
      sumB += rgb[idx + 2]
      count++
    }
  }

  if (count === 0) {
    return { meanR: 128, meanG: 128, meanB: 128, varR: 400, varG: 400, varB: 400, threshold }
  }

  const meanR = sumR / count
  const meanG = sumG / count
  const meanB = sumB / count

  let sqDiffR = 0
  let sqDiffG = 0
  let sqDiffB = 0

  for (let i = 0; i < pixelCount; i++) {
    if (seed[i] > 127) {
      const idx = i * channels
      const dr = rgb[idx] - meanR
      const dg = rgb[idx + 1] - meanG
      const db = rgb[idx + 2] - meanB
      sqDiffR += dr * dr
      sqDiffG += dg * dg
      sqDiffB += db * db
    }
  }

  const varR = Math.max(16, sqDiffR / count)
  const varG = Math.max(16, sqDiffG / count)
  const varB = Math.max(16, sqDiffB / count)

  return { meanR, meanG, meanB, varR, varG, varB, threshold }
}

/**
 * Region growing from seed stroke:
 * - BFS propagation comparing RGB to criterion
 * - Boundary blocking at image gradient edges and existing alpha transitions
 * - Boundary smoothing via Euclidean distance transform
 */
export function growRegion(
  rgb: Uint8Array,
  alpha: Uint8Array,
  width: number,
  height: number,
  seed: Uint8Array,
  criterion: RegionCriterion,
): Uint8Array {
  const size = width * height
  const output = new Uint8Array(size)
  if (size === 0) return output

  const channels = rgb.length >= size * 4 ? 4 : 3
  const visited = new Uint8Array(size)

  // Queue allocation
  const queue = new Int32Array(size)
  let head = 0
  let tail = 0

  // Seed initialization
  for (let i = 0; i < size; i++) {
    if (seed[i] > 127) {
      visited[i] = 1
      output[i] = 255
      queue[tail++] = i
    }
  }

  if (tail === 0) return output

  const threshSq = criterion.threshold * criterion.threshold
  const { meanR, meanG, meanB } = criterion

  const dx = [-1, 1, 0, 0]
  const dy = [0, 0, -1, 1]

  while (head < tail) {
    const curr = queue[head++]
    const cx = curr % width
    const cy = Math.floor(curr / width)
    const currAlpha = alpha ? alpha[curr] : 255

    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d]
      const ny = cy + dy[d]

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const next = ny * width + nx
      if (visited[next]) continue

      visited[next] = 1

      // 1. Boundary check: sharp existing matte boundary (stop if crossing subject edge)
      if (alpha && Math.abs((alpha[next] || 0) - currAlpha) > 50) {
        continue
      }

      // 2. Color distance to locked criterion
      const nRgbIdx = next * channels
      const dr = rgb[nRgbIdx] - meanR
      const dg = rgb[nRgbIdx + 1] - meanG
      const db = rgb[nRgbIdx + 2] - meanB
      const distSq = dr * dr + dg * dg + db * db

      if (distSq <= threshSq) {
        output[next] = 255
        queue[tail++] = next
      }
    }
  }

  // 3. Smooth boundary using Euclidean Distance Transform
  // EDT from stroke-style computes distance from foreground (output > 127)
  // We compute EDT on inverted output to soften outer edge by 1.5px
  const inv = new Uint8Array(size)
  for (let i = 0; i < size; i++) inv[i] = output[i] > 127 ? 255 : 0

  // Soften boundary falloff (1.5px)
  try {
    const dist = computeEuclideanDistanceTransform(inv, width, height)
    for (let i = 0; i < size; i++) {
      if (output[i] === 0 && dist[i] < 1.5) {
        output[i] = Math.round(255 * Math.max(0, 1 - dist[i] / 1.5))
      }
    }
  } catch {
    // If EDT fails for any reason, keep pure output
  }

  return output
}

/**
 * Whether the custom matte starts from nothing rather than from the whole picture.
 *
 * With no automatic matte underneath, a clip is fully visible, so painting more of it "in"
 * changes nothing — which is how the brush looked broken: strokes were recorded, Apply was
 * pressed, and the picture stayed exactly as it was. A brush over a clip with no base matte
 * is a cutout: what is painted is kept and the rest goes; the eraser then takes parts of that
 * away. Only erasing (no brush stroke at all) starts from the whole picture.
 */
export function customMatteStartsEmpty(strokes: ReadonlyArray<BrushStroke> | undefined, hasBaseMatte: boolean): boolean {
  if (hasBaseMatte) return false
  return Boolean(strokes?.some(stroke => stroke.mode === 'brush' || stroke.mode === 'region-brush'))
}

/**
 * Combines base alpha with custom brush and eraser masks:
 * alpha_final = clamp(baseAlpha + brushMask - eraserMask, 0, 255)
 *
 * If baseAlpha is null/undefined, the base is full opacity (255) — or nothing (0) when
 * `startEmpty` is set; see customMatteStartsEmpty.
 */
export function blendCustomMatte(
  baseAlpha: Uint8Array | null | undefined,
  brushMask: Uint8Array,
  eraserMask: Uint8Array,
  width: number,
  height: number,
  startEmpty = false,
): Uint8Array {
  const size = width * height
  const out = new Uint8Array(size)

  for (let i = 0; i < size; i++) {
    const base = baseAlpha ? baseAlpha[i] : (startEmpty ? 0 : 255)
    const b = brushMask ? brushMask[i] : 0
    const e = eraserMask ? eraserMask[i] : 0
    const val = base + b - e
    out[i] = val < 0 ? 0 : val > 255 ? 255 : val
  }

  return out
}

/**
 * A mask of the reference picture, laid onto the picture as it stands in another frame.
 * `frameToRef` maps a point of that frame to the same point of the reference picture; what
 * falls outside the reference is nothing.
 */
export function warpMask(mask: Uint8Array, width: number, height: number, frameToRef: Affine, out?: Uint8Array): Uint8Array {
  const result = out ?? new Uint8Array(width * height)
  const [m0, m1, m2, m3, m4, m5] = frameToRef
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const ru = (m0 * u + m1 * v + m2) * width - 0.5
      const rv = (m3 * u + m4 * v + m5) * height - 0.5
      let value = 0
      if (ru > -1 && rv > -1 && ru < width && rv < height) {
        const x0 = Math.floor(ru)
        const y0 = Math.floor(rv)
        const fx = ru - x0
        const fy = rv - y0
        const xa = Math.max(0, x0)
        const xb = Math.min(width - 1, x0 + 1)
        const ya = Math.max(0, y0)
        const yb = Math.min(height - 1, y0 + 1)
        const wxa = x0 < 0 ? 0 : 1 - fx
        const wxb = x0 + 1 > width - 1 ? 0 : fx
        const wya = y0 < 0 ? 0 : 1 - fy
        const wyb = y0 + 1 > height - 1 ? 0 : fy
        value = Math.round(
          mask[ya * width + xa] * wxa * wya + mask[ya * width + xb] * wxb * wya
          + mask[yb * width + xa] * wxa * wyb + mask[yb * width + xb] * wxb * wyb,
        )
      }
      result[y * width + x] = value
    }
  }
  return result
}
