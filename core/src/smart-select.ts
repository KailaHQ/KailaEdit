/**
 * Smart selection: from a few painted points, the whole object they sit on.
 *
 * Two sources of knowledge are combined. When a subject matte of the frame is at hand (the
 * person-matting model the app already runs) and the painted points lie on that subject, the
 * result is the whole connected subject — a person painted at the shirt is selected head to
 * toe, however many colours they wear. Everywhere else — an orange, a cup, a wall — the
 * region grows by colour: outward from the painted pixels through neighbours that look like
 * them and do not cross a sharp edge, which follows shading and highlights across one object
 * but stops at its outline.
 *
 * Pure and dependency-free, so the preview, the tests and any other caller share it.
 */

export interface SmartSelectInput {
  width: number
  height: number
  /** RGBA (or RGB) pixels of the frame, `width * height` of them. */
  rgba: ArrayLike<number>
  /** Painted points, 0..255, `width * height`. */
  seeds: ArrayLike<number>
  /** A matte of the frame's subject, 0..255, `width * height`, when one is available. */
  subject?: ArrayLike<number> | null
}

/** A selection stored on a stroke: 8-bit coverage, run-length encoded. */
export interface RegionMask {
  width: number
  height: number
  rle: string
}

// ── Colour ─────────────────────────────────────────────────────────────────

function srgbToLinear(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

function toLab(rgba: ArrayLike<number>, count: number): { L: Float32Array; A: Float32Array; B: Float32Array } {
  const channels = rgba.length >= count * 4 ? 4 : 3
  const L = new Float32Array(count)
  const A = new Float32Array(count)
  const B = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const r = srgbToLinear(rgba[i * channels])
    const g = srgbToLinear(rgba[i * channels + 1])
    const b = srgbToLinear(rgba[i * channels + 2])
    const x = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
    const y = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
    const z = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)
    L[i] = 116 * y - 16
    A[i] = 500 * (x - y)
    B[i] = 200 * (y - z)
  }
  return { L, A, B }
}

// ── Selection ──────────────────────────────────────────────────────────────

const DX = [-1, 1, 0, 0]
const DY = [0, 0, -1, 1]

function seedIndices(seeds: ArrayLike<number>, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) if (seeds[i] > 127) out.push(i)
  return out
}

/** Every pixel of `allowed` reachable from `starts` through 4-neighbours. */
function connectedFrom(allowed: Uint8Array, starts: number[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(allowed.length)
  const queue = new Int32Array(allowed.length)
  let head = 0
  let tail = 0
  for (const s of starts) {
    if (allowed[s] && !out[s]) {
      out[s] = 1
      queue[tail++] = s
    }
  }
  while (head < tail) {
    const cur = queue[head++]
    const cx = cur % width
    const cy = (cur - cx) / width
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (allowed[next] && !out[next]) {
        out[next] = 1
        queue[tail++] = next
      }
    }
  }
  return out
}

interface Lab { L: Float32Array; A: Float32Array; B: Float32Array }

function labDistance(lab: Lab, i: number, j: number): number {
  const dl = lab.L[i] - lab.L[j]
  const da = lab.A[i] - lab.A[j]
  const db = lab.B[i] - lab.B[j]
  return Math.sqrt(dl * dl + da * da + db * db)
}

function growByColour(
  lab: Lab,
  seeds: number[],
  width: number,
  height: number,
  tolerance: number,
  step: number,
  mean: [number, number, number],
): Uint8Array {
  const count = width * height
  const out = new Uint8Array(count)
  const queue = new Int32Array(count)
  let head = 0
  let tail = 0
  for (const s of seeds) {
    if (!out[s]) {
      out[s] = 1
      queue[tail++] = s
    }
  }
  // Distance from the object's typical colour is allowed to be more generous than the step
  // between neighbours: shading changes an object's colour slowly, an outline changes it at once.
  const reach = tolerance * 1.6
  while (head < tail) {
    const cur = queue[head++]
    const cx = cur % width
    const cy = (cur - cx) / width
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (out[next]) continue
      const dl = lab.L[next] - mean[0]
      const da = lab.A[next] - mean[1]
      const db = lab.B[next] - mean[2]
      if (Math.sqrt(dl * dl + da * da + db * db) > reach) continue
      if (labDistance(lab, cur, next) > step) continue
      out[next] = 1
      queue[tail++] = next
    }
  }
  return out
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = mask[y * width + x]
      for (let d = 0; d < 4 && keep; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) keep = 0
      }
      out[y * width + x] = keep
    }
  }
  return out
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = mask[y * width + x]
      for (let d = 0; d < 4 && !on; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) on = 1
      }
      out[y * width + x] = on
    }
  }
  return out
}

/**
 * The colours of the background, as a handful of cluster centres and how far each spreads,
 * learned from the pixels the subject matte is sure are not the subject.
 */
interface ColourModel {
  centres: Array<[number, number, number]>
  spread: number[]
}

function clusterColours(lab: Lab, indices: number[], k: number): ColourModel | null {
  if (indices.length < k * 8) return null
  // A sample keeps this quick on a large frame; the wall does not need every pixel.
  const stride = Math.max(1, Math.floor(indices.length / 4000))
  const sample: number[] = []
  for (let i = 0; i < indices.length; i += stride) sample.push(indices[i])
  // Start from evenly spaced lightness so the run is deterministic.
  const sorted = [...sample].sort((a, b) => lab.L[a] - lab.L[b])
  const centres: Array<[number, number, number]> = []
  for (let c = 0; c < k; c++) {
    const i = sorted[Math.min(sorted.length - 1, Math.floor(((c + 0.5) / k) * sorted.length))]
    centres.push([lab.L[i], lab.A[i], lab.B[i]])
  }
  const owner = new Int32Array(sample.length)
  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = centres.map(() => [0, 0, 0, 0])
    sample.forEach((px, n) => {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < k; c++) {
        const dl = lab.L[px] - centres[c][0]
        const da = lab.A[px] - centres[c][1]
        const db = lab.B[px] - centres[c][2]
        const d = dl * dl + da * da + db * db
        if (d < bestDist) { bestDist = d; best = c }
      }
      owner[n] = best
      sums[best][0] += lab.L[px]; sums[best][1] += lab.A[px]; sums[best][2] += lab.B[px]; sums[best][3]++
    })
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) centres[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
    }
  }
  const spread = centres.map(() => 0)
  const counts = centres.map(() => 0)
  sample.forEach((px, n) => {
    const c = owner[n]
    const dl = lab.L[px] - centres[c][0]
    const da = lab.A[px] - centres[c][1]
    const db = lab.B[px] - centres[c][2]
    spread[c] += Math.sqrt(dl * dl + da * da + db * db)
    counts[c]++
  })
  return { centres, spread: spread.map((total, c) => (counts[c] > 0 ? total / counts[c] : 0)) }
}

/** Distance from a pixel to the nearest background cluster, scaled by that cluster's own spread. */
function backgroundLikeness(lab: Lab, px: number, model: ColourModel): { distance: number; limit: number } {
  let best = Infinity
  let limit = 0
  for (let c = 0; c < model.centres.length; c++) {
    const dl = lab.L[px] - model.centres[c][0]
    const da = lab.A[px] - model.centres[c][1]
    const db = lab.B[px] - model.centres[c][2]
    const d = Math.sqrt(dl * dl + da * da + db * db)
    if (d < best) {
      best = d
      limit = Math.max(6, Math.min(14, model.spread[c] * 1.4))
    }
  }
  return { distance: best, limit }
}

/**
 * A matte made in one pass often lets a patch of the wall behind the subject through, joined
 * to it along an edge. That patch is the colour of the wall, and the wall is all around it,
 * so it can be told apart: drop what looks like the background more than like the painted
 * points, keep the piece that holds them, and fill back what the drop left inside the body.
 */
function dropBackgroundLookingPixels(
  selected: Uint8Array,
  lab: Lab,
  seeds: number[],
  meanSeed: [number, number, number],
  width: number,
  height: number,
): Uint8Array {
  const count = width * height
  const far = dilate(dilate(dilate(selected, width, height), width, height), width, height)
  const background: number[] = []
  for (let i = 0; i < count; i++) if (!far[i]) background.push(i)
  const model = clusterColours(lab, background, 6)
  if (!model) return selected

  const kept = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (!selected[i]) continue
    const wall = backgroundLikeness(lab, i, model)
    const dl = lab.L[i] - meanSeed[0]
    const da = lab.A[i] - meanSeed[1]
    const db = lab.B[i] - meanSeed[2]
    const fromSeeds = Math.sqrt(dl * dl + da * da + db * db)
    kept[i] = wall.distance <= wall.limit && wall.distance < fromSeeds ? 0 : 1
  }
  const cleaned = dilate(erode(kept, width, height), width, height)
  const starts = seeds.filter(s => cleaned[s])
  if (starts.length === 0) return selected
  const piece = connectedFrom(cleaned, starts, width, height)
  fillHoles(piece, width, height, 0.2)
  return piece
}

/** Fills regions of "outside" that the selection fully encloses, when they are small. */
function fillHoles(mask: Uint8Array, width: number, height: number, maxHoleShare: number): void {
  const count = width * height
  const outside = new Uint8Array(count)
  for (let i = 0; i < count; i++) outside[i] = mask[i] ? 0 : 1
  const starts: number[] = []
  for (let x = 0; x < width; x++) {
    starts.push(x, (height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    starts.push(y * width, y * width + width - 1)
  }
  const reachable = connectedFrom(outside, starts, width, height)
  // Whatever is outside the selection and not reachable from the border is a hole.
  const visited = new Uint8Array(count)
  const limit = Math.max(1, Math.floor(count * maxHoleShare))
  for (let i = 0; i < count; i++) {
    if (!outside[i] || reachable[i] || visited[i]) continue
    const hole = connectedFrom(outside, [i], width, height)
    let size = 0
    for (let k = 0; k < count; k++) if (hole[k]) { visited[k] = 1; size++ }
    if (size <= limit) for (let k = 0; k < count; k++) if (hole[k]) mask[k] = 1
  }
}

/** One pass of 3x3 majority: removes specks and pin-holes without moving the outline. */
function majority(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0
      let total = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          total++
          on += mask[ny * width + nx]
        }
      }
      out[y * width + x] = on * 2 > total ? 1 : 0
    }
  }
  return out
}

/** Binary mask to 0..255 with a one-pixel soft edge. */
function feather(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let total = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          total++
          sum += mask[ny * width + nx]
        }
      }
      out[y * width + x] = Math.round((255 * sum) / total)
    }
  }
  return out
}

export function smartSelect(input: SmartSelectInput): Uint8Array {
  const { width, height } = input
  const count = width * height
  const empty = new Uint8Array(count)
  if (count === 0) return empty
  const seeds = seedIndices(input.seeds, count)
  if (seeds.length === 0) return empty

  let selected: Uint8Array | null = null

  // The subject prior: painted on the subject means "all of it".
  if (input.subject) {
    // A matte that says nothing is the subject, or nearly everything is, tells us nothing.
    let covered = 0
    for (let i = 0; i < count; i++) if (input.subject[i] > 160) covered++
    const plausible = covered > count * 0.01 && covered < count * 0.9
    let onSubject = 0
    for (const s of seeds) if (input.subject[s] > 160) onSubject++
    if (plausible && onSubject / seeds.length >= 0.5) {
      const allowed = new Uint8Array(count)
      for (let i = 0; i < count; i++) allowed[i] = input.subject[i] > 160 ? 1 : 0
      // Opening: the matte's soft fringe and stray specks of background are thinner than the
      // subject, so shrinking then regrowing by a pixel drops them and keeps the body.
      const opened = dilate(erode(allowed, width, height), width, height)
      const start = seeds.filter(s => opened[s])
      selected = connectedFrom(start.length > 0 ? opened : allowed, start.length > 0 ? start : seeds.filter(s => allowed[s]), width, height)

      // Trust the matte for the body, not for the wall: see dropBackgroundLookingPixels.
      const lab = toLab(input.rgba, count)
      let mL = 0
      let mA = 0
      let mB = 0
      for (const s of seeds) { mL += lab.L[s]; mA += lab.A[s]; mB += lab.B[s] }
      selected = dropBackgroundLookingPixels(selected, lab, seeds, [mL / seeds.length, mA / seeds.length, mB / seeds.length], width, height)
    }
  }

  if (!selected) {
    const lab = toLab(input.rgba, count)
    let mL = 0
    let mA = 0
    let mB = 0
    for (const s of seeds) { mL += lab.L[s]; mA += lab.A[s]; mB += lab.B[s] }
    mL /= seeds.length
    mA /= seeds.length
    mB /= seeds.length
    let variance = 0
    for (const s of seeds) {
      variance += (lab.L[s] - mL) ** 2 + (lab.A[s] - mA) ** 2 + (lab.B[s] - mB) ** 2
    }
    const spread = Math.sqrt(variance / seeds.length)

    let tolerance = Math.max(16, Math.min(42, 12 + 1.8 * spread))
    // A selection that swallows nearly the whole frame has leaked through the object's
    // outline; try again, tighter.
    for (let attempt = 0; attempt < 5; attempt++) {
      const step = Math.max(3, Math.min(14, tolerance * 0.35))
      selected = growByColour(lab, seeds, width, height, tolerance, step, [mL, mA, mB])
      let size = 0
      for (let i = 0; i < count; i++) size += selected[i]
      if (size <= count * 0.7) break
      tolerance = Math.max(4, tolerance * 0.6)
    }
  }

  const mask = selected as Uint8Array
  for (const s of seeds) mask[s] = 1
  fillHoles(mask, width, height, 0.15)
  return feather(majority(mask, width, height), width, height)
}

// ── Storage ────────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '='
    out += i + 2 < bytes.length ? B64[c & 63] : '='
  }
  return out
}

function base64ToBytes(text: string): number[] {
  const out: number[] = []
  const lookup = new Map<string, number>()
  for (let i = 0; i < B64.length; i++) lookup.set(B64[i], i)
  for (let i = 0; i + 3 < text.length + 3; i += 4) {
    const chunk = text.slice(i, i + 4)
    if (chunk.length === 0) break
    const v = [0, 1, 2, 3].map(k => (chunk[k] === '=' || chunk[k] === undefined ? 0 : lookup.get(chunk[k]) ?? 0))
    out.push((v[0] << 2) | (v[1] >> 4))
    if (chunk[2] !== '=' && chunk[2] !== undefined) out.push(((v[1] & 15) << 4) | (v[2] >> 2))
    if (chunk[3] !== '=' && chunk[3] !== undefined) out.push(((v[2] & 3) << 6) | v[3])
  }
  return out
}

/** Run-length encodes coverage as (value, run) pairs; a run is a LEB128 count. */
export function encodeRegionMask(mask: ArrayLike<number>, width: number, height: number): RegionMask {
  const bytes: number[] = []
  const count = width * height
  let i = 0
  while (i < count) {
    const value = mask[i]
    let run = 1
    while (i + run < count && mask[i + run] === value) run++
    bytes.push(value)
    let rest = run
    while (rest >= 0x80) {
      bytes.push((rest & 0x7f) | 0x80)
      rest >>>= 7
    }
    bytes.push(rest)
    i += run
  }
  return { width, height, rle: bytesToBase64(bytes) }
}

export function decodeRegionMask(region: RegionMask): Uint8Array {
  const count = region.width * region.height
  const out = new Uint8Array(count)
  const bytes = base64ToBytes(region.rle)
  let p = 0
  let i = 0
  while (p < bytes.length && i < count) {
    const value = bytes[p++]
    let run = 0
    let shift = 0
    while (p < bytes.length) {
      const b = bytes[p++]
      run |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    const end = Math.min(count, i + run)
    if (value !== 0) out.fill(value, i, end)
    i = end
  }
  return out
}

/** Coverage of a stored selection at a point given as fractions of the picture (bilinear). */
export function sampleRegionMask(mask: Uint8Array, width: number, height: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(width - 1, u * width - 0.5))
  const y = Math.max(0, Math.min(height - 1, v * height - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = mask[y0 * width + x0] * (1 - fx) + mask[y0 * width + x1] * fx
  const bottom = mask[y1 * width + x0] * (1 - fx) + mask[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
}
