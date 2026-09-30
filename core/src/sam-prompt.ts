/**
 * Segment Anything (MobileSAM) around the model itself: turning painted strokes into the
 * model's point prompt, and its output into a clean coverage mask.
 *
 * The model is run elsewhere (onnxruntime in the renderer, onnxruntime-node in tests); this
 * file only knows the conventions of the exported encoder/decoder pair:
 *
 *   encoder  input_image     float32 [H, W, 3], 0..255, longest side 1024 (it pads itself)
 *            image_embeddings float32 [1, 256, 64, 64]
 *   decoder  point_coords    float32 [1, N, 2]  in the 1024-scaled image's pixels
 *            point_labels    float32 [1, N]     1 = object, 0 = not the object, -1 = padding
 *            mask_input      float32 [1, 1, 256, 256], has_mask_input float32 [1]
 *            orig_im_size    float32 [2]  (height, width) the mask is returned at
 *            masks           float32 [1, 1, h, w] logits, > 0 inside the object
 */

/** The side the encoder works at. */
export const SAM_INPUT_SIZE = 1024
/** Most points taken from one stroke: a long scribble is still one intention. */
const POINTS_PER_STROKE = 6
/** Most points of each kind in one prompt. */
const MAX_POINTS = 16

export interface SamPoint {
  /** Fractions of the picture, 0..1. */
  x: number
  y: number
  /** true = part of the object, false = not part of it. */
  positive: boolean
}

/** The size to draw a picture at for the encoder: longest side 1024, proportions kept. */
export function samEncoderSize(width: number, height: number): { width: number; height: number } {
  const scale = SAM_INPUT_SIZE / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** A few points spread evenly along a stroke — its start, its end, and between. */
export function samplePoints(points: ReadonlyArray<readonly [number, number]>, count = POINTS_PER_STROKE): Array<[number, number]> {
  if (points.length === 0) return []
  if (points.length <= count) return points.map(([x, y]) => [x, y])
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  }
  const total = lengths[lengths.length - 1]
  if (total === 0) return [[points[0][0], points[0][1]]]
  const out: Array<[number, number]> = []
  let j = 0
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total
    while (j < lengths.length - 2 && lengths[j + 1] < target) j++
    const span = lengths[j + 1] - lengths[j] || 1
    const t = Math.max(0, Math.min(1, (target - lengths[j]) / span))
    out.push([
      points[j][0] + (points[j + 1][0] - points[j][0]) * t,
      points[j][1] + (points[j + 1][1] - points[j][1]) * t,
    ])
  }
  return out
}

/**
 * The decoder's point inputs. Positive points first; at most MAX_POINTS of each kind (the
 * newest are kept); and the padding point the model was exported to expect when no box is
 * given.
 */
export function samPromptTensors(
  points: ReadonlyArray<SamPoint>,
  width: number,
  height: number,
): { coords: Float32Array; labels: Float32Array; count: number } {
  const scale = SAM_INPUT_SIZE / Math.max(width, height)
  const positives = points.filter(p => p.positive).slice(-MAX_POINTS)
  const negatives = points.filter(p => !p.positive).slice(-MAX_POINTS)
  const chosen = [...positives, ...negatives]
  const count = chosen.length + 1
  const coords = new Float32Array(count * 2)
  const labels = new Float32Array(count)
  chosen.forEach((p, i) => {
    coords[i * 2] = p.x * width * scale
    coords[i * 2 + 1] = p.y * height * scale
    labels[i] = p.positive ? 1 : 0
  })
  labels[count - 1] = -1
  return { coords, labels, count }
}

const DX = [-1, 1, 0, 0]
const DY = [0, 0, -1, 1]

function connected(allowed: Uint8Array, starts: number[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(allowed.length)
  const queue = new Int32Array(allowed.length)
  let head = 0
  let tail = 0
  for (const s of starts) if (allowed[s] && !out[s]) { out[s] = 1; queue[tail++] = s }
  while (head < tail) {
    const cur = queue[head++]
    const cx = cur % width
    const cy = (cur - cx) / width
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (allowed[next] && !out[next]) { out[next] = 1; queue[tail++] = next }
    }
  }
  return out
}

/**
 * The decoder's logits as coverage: 0..255 with the model's own soft edge, only the pieces
 * that hold a positive point (a stray island elsewhere is the model hedging), and small holes
 * inside the object filled (a highlight on a shirt is still the shirt).
 */
export function samMaskFromLogits(
  logits: ArrayLike<number>,
  width: number,
  height: number,
  points: ReadonlyArray<SamPoint>,
): Uint8Array {
  const count = width * height
  const inside = new Uint8Array(count)
  for (let i = 0; i < count; i++) inside[i] = logits[i] > 0 ? 1 : 0

  const starts: number[] = []
  for (const p of points) {
    if (!p.positive) continue
    const x = Math.min(width - 1, Math.max(0, Math.floor(p.x * width)))
    const y = Math.min(height - 1, Math.max(0, Math.floor(p.y * height)))
    starts.push(y * width + x)
  }
  const kept = starts.some(s => inside[s]) ? connected(inside, starts, width, height) : inside

  // Holes: outside pixels not reachable from the border, when small.
  const outside = new Uint8Array(count)
  for (let i = 0; i < count; i++) outside[i] = kept[i] ? 0 : 1
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
  for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1)
  const open = connected(outside, border, width, height)
  const limit = count * 0.02
  const seen = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (!outside[i] || open[i] || seen[i]) continue
    const hole = connected(outside, [i], width, height)
    const members: number[] = []
    for (let k = 0; k < count; k++) if (hole[k]) { seen[k] = 1; members.push(k) }
    if (members.length <= limit) for (const k of members) kept[k] = 1
  }

  // Soft edge from the logits themselves: a logit of ±2 is well inside / outside. Only on the
  // outline: a pixel with all four neighbours in the object is the object, however unsure the
  // model was of it. Reading its logit there left a filled hole, or a dim patch the model
  // hedged on, half transparent — a grey blotch on the picture.
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const soft = Math.max(0, Math.min(1, 0.5 + logits[i] / 4))
    if (kept[i]) {
      const x = i % width
      const y = (i - x) / width
      const interior = x > 0 && y > 0 && x < width - 1 && y < height - 1
        && kept[i - 1] && kept[i + 1] && kept[i - width] && kept[i + width]
      out[i] = interior ? 255 : Math.round(255 * Math.max(soft, 0.5))
    } else {
      // Just outside a kept pixel the edge may fade; anything farther is out.
      const x = i % width
      const y = (i - x) / width
      let near = false
      for (let d = 0; d < 4 && !near; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && kept[ny * width + nx]) near = true
      }
      out[i] = near ? Math.round(255 * Math.min(soft, 0.5)) : 0
    }
  }
  return out
}
