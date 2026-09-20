import { fastHash64 } from './render-cache'
import { computeEuclideanDistanceTransform } from './stroke-style'
import type { BrushStroke } from './project-model'

/**
 * Computes a deterministic SHA-256 / 64-bit fast hash from the list of brush strokes.
 * If two stroke lists have identical hash, rebaking is unnecessary.
 */
export function computeStrokesHash(strokes: BrushStroke[]): string {
  if (!strokes || strokes.length === 0) return ''
  const canonical = strokes
    .map((s) => {
      const pts = s.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')
      return `${s.mode}:${s.size.toFixed(2)}:${s.paintedAt.toFixed(2)}:[${pts}]`
    })
    .join('|')
  return fastHash64(canonical)
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

export interface RasterizeOptions {
  /**
   * Filter strokes by mode category.
   * 'regular': only 'brush' and 'eraser'
   * 'region': only 'region-brush' and 'region-eraser'
   * 'all': all strokes (default)
   */
  filter?: 'all' | 'regular' | 'region'
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

    const strokeRadius = Math.max(0.5, (shortEdge * (stroke.size / 100)) / 2)
    const strokeRadiusSq = strokeRadius * strokeRadius
    const pad = Math.ceil(strokeRadius + 1)

    const pts = stroke.points
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
 * Combines base alpha with custom brush and eraser masks:
 * alpha_final = clamp(baseAlpha + brushMask - eraserMask, 0, 255)
 *
 * If baseAlpha is null/undefined, assumes full opacity (255) as base.
 */
export function blendCustomMatte(
  baseAlpha: Uint8Array | null | undefined,
  brushMask: Uint8Array,
  eraserMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const size = width * height
  const out = new Uint8Array(size)

  for (let i = 0; i < size; i++) {
    const base = baseAlpha ? baseAlpha[i] : 255
    const b = brushMask ? brushMask[i] : 0
    const e = eraserMask ? eraserMask[i] : 0
    const val = base + b - e
    out[i] = val < 0 ? 0 : val > 255 ? 255 : val
  }

  return out
}
