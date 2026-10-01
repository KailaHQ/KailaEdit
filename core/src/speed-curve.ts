/**
 * Speed curves: a clip whose playback speed changes smoothly along its length.
 *
 * A curve is a list of points `(x, v)`. `x` runs 0..1 along the source the clip
 * plays, in playback order — 0 is the first source frame shown, 1 the last, and
 * for a reversed clip that is the source read backwards. `v` is the speed at
 * that moment. Putting `x` on the source rather than the timeline is what keeps
 * a slow-motion dip glued to the moment in the footage it was placed on: when
 * the user drags a point, the content stays where it is and only the clip's
 * duration changes.
 *
 * Between points the speed is interpolated on log10(v) with a monotone cubic,
 * so the curve is smooth, never overshoots a point, and 0.5x→2x spends as long
 * below 1x as above it.
 *
 * Timeline time follows from the speed: dt = ds / v. The shape of the curve
 * alone fixes `I = ∫₀¹ du / v(u)`, so a clip playing `L` seconds of source lasts
 * `L · I`. The clip's `speed` field is kept equal to `1 / I` — the mean rate —
 * which keeps every piece of code that converts with `duration * speed` (trim,
 * slip, transitions) consuming the right amount of source without knowing the
 * curve exists.
 */

import type { SpeedCurve, SpeedCurvePoint, SpeedCurvePreset, TimelineClip } from './project-model'
import { clampClipSpeed } from './clip-speed'

export const MIN_CURVE_SPEED = 0.1
export const MAX_CURVE_SPEED = 10

/** Two curve points closer than this in x are treated as one. */
export const MIN_CURVE_POINT_GAP = 0.01

export function clampCurveSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, v))
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

type PresetPoints = ReadonlyArray<readonly [number, number]>

const PRESET_POINTS: Record<Exclude<SpeedCurvePreset, 'custom'>, PresetPoints> = {
  montage: [[0, 1], [0.25, 1], [0.38, 4], [0.52, 0.3], [0.66, 1], [1, 1]],
  hero: [[0, 2], [0.3, 2], [0.45, 0.2], [0.55, 0.2], [0.7, 2], [1, 2]],
  bullet: [[0, 1], [0.3, 1], [0.42, 0.2], [0.58, 0.2], [0.7, 1], [1, 1]],
  'jump-cut': [[0, 1], [0.4, 1], [0.5, 5], [0.6, 1], [1, 1]],
  'flash-in': [[0, 5], [0.3, 5], [0.6, 1], [1, 1]],
  'flash-out': [[0, 1], [0.4, 1], [0.7, 5], [1, 5]],
}

const CUSTOM_POINTS: PresetPoints = [[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]]

/** The presets in the order the panel shows them. */
export const SPEED_CURVE_PRESETS: readonly SpeedCurvePreset[] = [
  'custom', 'montage', 'hero', 'bullet', 'jump-cut', 'flash-in', 'flash-out',
]

export function speedCurveForPreset(preset: SpeedCurvePreset): SpeedCurve {
  const source = preset === 'custom' ? CUSTOM_POINTS : PRESET_POINTS[preset]
  return {
    preset,
    points: source.map(([x, v]) => ({ x, v })),
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Makes a curve safe to evaluate: sorted, deduplicated, speeds clamped, first
 * point at x=0 and last at x=1. Returns null when nothing usable is left.
 */
export function normalizeSpeedCurve(curve: SpeedCurve | null | undefined): SpeedCurve | null {
  if (!curve || !Array.isArray(curve.points)) return null
  const finite = curve.points
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.v))
    .map(p => ({ x: Math.min(1, Math.max(0, p.x)), v: clampCurveSpeed(p.v) }))
    .sort((a, b) => a.x - b.x)
  if (finite.length === 0) return null

  const points: SpeedCurvePoint[] = []
  for (const p of finite) {
    const last = points[points.length - 1]
    if (last && p.x - last.x < 1e-6) {
      last.v = p.v
      continue
    }
    points.push({ ...p })
  }
  if (points[0].x > 0) points.unshift({ x: 0, v: points[0].v })
  if (points[points.length - 1].x < 1) points.push({ x: 1, v: points[points.length - 1].v })
  if (points.length < 2) points.push({ x: 1, v: points[0].v })
  points[0].x = 0
  points[points.length - 1].x = 1

  return { ...curve, points }
}

/** Whether a clip's timing is driven by a curve. */
export function clipHasSpeedCurve(clip: { speedCurve?: SpeedCurve | null } | null | undefined): boolean {
  return Boolean(clip?.speedCurve && clip.speedCurve.points && clip.speedCurve.points.length >= 2)
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

interface CurveTable {
  xs: number[]
  ys: number[] // log10(v)
  ms: number[] // Hermite tangents in (log10 v) per unit x
  /** Uniform x grid, TABLE_SIZE + 1 entries. */
  gridX: Float64Array
  /** ∫₀^gridX[k] du / v(u) */
  cumInv: Float64Array
  /** cumInv[TABLE_SIZE] — timeline seconds per source second. */
  totalInv: number
}

const TABLE_SIZE = 512
const tableCache = new WeakMap<SpeedCurve, CurveTable>()

/** Fritsch–Carlson tangents: monotone between points, no overshoot. */
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i]
    d.push(h > 0 ? (ys[i + 1] - ys[i]) / h : 0)
  }
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * d[i]
      m[i + 1] = tau * b * d[i]
    }
  }
  return m
}

function evalLog(xs: number[], ys: number[], ms: number[], x: number): number {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const h = xs[hi] - xs[lo]
  if (h <= 0) return ys[lo]
  const t = (x - xs[lo]) / h
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * ys[lo]
    + (t3 - 2 * t2 + t) * h * ms[lo]
    + (-2 * t3 + 3 * t2) * ys[hi]
    + (t3 - t2) * h * ms[hi]
}

function tableFor(curve: SpeedCurve): CurveTable {
  const cached = tableCache.get(curve)
  if (cached) return cached

  const normalized = normalizeSpeedCurve(curve) ?? speedCurveForPreset('custom')
  const xs = normalized.points.map(p => p.x)
  const ys = normalized.points.map(p => Math.log10(p.v))
  const ms = monotoneTangents(xs, ys)

  const gridX = new Float64Array(TABLE_SIZE + 1)
  const cumInv = new Float64Array(TABLE_SIZE + 1)
  const inv = (x: number) => Math.pow(10, -evalLog(xs, ys, ms, x))
  const h = 1 / TABLE_SIZE
  for (let k = 0; k <= TABLE_SIZE; k++) gridX[k] = k * h
  for (let k = 1; k <= TABLE_SIZE; k++) {
    const a = gridX[k - 1]
    const b = gridX[k]
    // Simpson on each cell.
    cumInv[k] = cumInv[k - 1] + (h / 6) * (inv(a) + 4 * inv((a + b) / 2) + inv(b))
  }

  const table: CurveTable = { xs, ys, ms, gridX, cumInv, totalInv: cumInv[TABLE_SIZE] }
  tableCache.set(curve, table)
  return table
}

/** Speed at source position x (0..1). */
export function curveSpeedAtX(curve: SpeedCurve, x: number): number {
  const t = tableFor(curve)
  return clampCurveSpeed(Math.pow(10, evalLog(t.xs, t.ys, t.ms, x)))
}

/** Timeline seconds per source second, averaged over the whole curve: `I`. */
export function curveTimePerSource(curve: SpeedCurve): number {
  return tableFor(curve).totalInv
}

/** The mean playback rate of a curve — what the clip's `speed` field holds. */
export function curveMeanSpeed(curve: SpeedCurve): number {
  return clampClipSpeed(1 / curveTimePerSource(curve))
}

/** Fraction of the clip's duration elapsed when playback reaches source position x. */
export function curveTimeFractionAtX(curve: SpeedCurve, x: number): number {
  const t = tableFor(curve)
  const cx = Math.min(1, Math.max(0, x))
  const pos = cx * TABLE_SIZE
  const k = Math.min(TABLE_SIZE - 1, Math.floor(pos))
  const f = pos - k
  const cum = t.cumInv[k] + (t.cumInv[k + 1] - t.cumInv[k]) * f
  return cum / t.totalInv
}

/** Source position x reached after a fraction `tau` of the clip's duration. */
export function curveXAtTimeFraction(curve: SpeedCurve, tau: number): number {
  const t = tableFor(curve)
  const target = Math.min(1, Math.max(0, tau)) * t.totalInv
  const cum = t.cumInv
  let lo = 0
  let hi = TABLE_SIZE
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (cum[mid] <= target) lo = mid
    else hi = mid
  }
  const span = cum[hi] - cum[lo]
  const f = span > 0 ? (target - cum[lo]) / span : 0
  return Math.min(1, Math.max(0, (lo + f) / TABLE_SIZE))
}

// ---------------------------------------------------------------------------
// Clip-level mapping
// ---------------------------------------------------------------------------

type TimedClip = Pick<TimelineClip, 'duration' | 'speed'> & { speedCurve?: SpeedCurve | null }

/**
 * Seconds of source the clip plays from its in-point to its out-point.
 *
 * For a curve this is `duration / I`; for a constant speed, `duration × speed`.
 */
export function clipSourceSpan(clip: TimedClip): number {
  const duration = Math.max(0, clip.duration || 0)
  if (clip.speedCurve && clipHasSpeedCurve(clip)) {
    return duration / curveTimePerSource(clip.speedCurve)
  }
  return duration * clampClipSpeed(clip.speed ?? 1)
}

/**
 * Seconds of source consumed (in playback order) after `timeInClip` seconds
 * of the clip have played. Reversal is the caller's business: for a reversed
 * clip the frame shown is `outPoint - consumed`.
 */
export function sourceOffsetAtClipTime(clip: TimedClip, timeInClip: number): number {
  const duration = Math.max(0, clip.duration || 0)
  const t = Math.min(duration, Math.max(0, timeInClip))
  if (clip.speedCurve && clipHasSpeedCurve(clip) && duration > 0) {
    const x = curveXAtTimeFraction(clip.speedCurve, t / duration)
    return x * clipSourceSpan(clip)
  }
  return t * clampClipSpeed(clip.speed ?? 1)
}

/** The inverse of `sourceOffsetAtClipTime`. */
export function clipTimeAtSourceOffset(clip: TimedClip, sourceOffset: number): number {
  const duration = Math.max(0, clip.duration || 0)
  if (clip.speedCurve && clipHasSpeedCurve(clip) && duration > 0) {
    const span = clipSourceSpan(clip)
    if (span <= 0) return 0
    const x = sourceOffset / span
    if (x <= 0) return sourceOffset / curveSpeedAtX(clip.speedCurve, 0)
    if (x >= 1) return duration + (sourceOffset - span) / curveSpeedAtX(clip.speedCurve, 1)
    return curveTimeFractionAtX(clip.speedCurve, x) * duration
  }
  return sourceOffset / clampClipSpeed(clip.speed ?? 1)
}

/** The playback speed at a moment of the clip. */
export function clipSpeedAtTime(clip: TimedClip, timeInClip: number): number {
  const duration = Math.max(0, clip.duration || 0)
  if (clip.speedCurve && clipHasSpeedCurve(clip) && duration > 0) {
    const x = curveXAtTimeFraction(clip.speedCurve, Math.min(1, Math.max(0, timeInClip / duration)))
    return curveSpeedAtX(clip.speedCurve, x)
  }
  return clampClipSpeed(clip.speed ?? 1)
}

/**
 * The source time, in seconds of the media file, shown at `timeInClip`.
 *
 * `mediaDuration` is only needed for reversed clips, whose out-point is
 * measured back from the end of the file (`trimEnd` is the amount cut off the
 * tail).
 */
export function clipSourceTimeAt(
  clip: TimedClip & Pick<TimelineClip, 'trimStart' | 'trimEnd' | 'reversed'>,
  timeInClip: number,
  mediaDuration?: number,
): number {
  const consumed = sourceOffsetAtClipTime(clip, timeInClip)
  if (clip.reversed) {
    const outPoint = mediaDuration !== undefined && Number.isFinite(mediaDuration)
      ? mediaDuration - clip.trimEnd
      : clip.trimStart + clipSourceSpan(clip)
    return Math.max(0, outPoint - consumed)
  }
  return Math.max(0, clip.trimStart + consumed)
}

/** Duration a clip playing `sourceSpan` seconds of source lasts under `curve`. */
export function durationForSpeedCurve(sourceSpan: number, curve: SpeedCurve): number {
  return Math.max(0, sourceSpan) * curveTimePerSource(curve)
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Splits a curve at source position `x` into the curve before and the curve
 * after, each renormalised to 0..1. The point at the cut carries the speed the
 * original curve had there, so both halves keep playing the same motion.
 */
export function splitSpeedCurve(curve: SpeedCurve, x: number): [SpeedCurve, SpeedCurve] {
  const normalized = normalizeSpeedCurve(curve) ?? speedCurveForPreset('custom')
  const cut = Math.min(1, Math.max(0, x))
  const vCut = curveSpeedAtX(normalized, cut)

  // The original points alone would not reproduce the shape near the cut: the
  // curve's slope there is set by neighbours the half no longer has. A few
  // samples of the original between the cut and its nearest points pin the
  // shape down, so each half plays the frames it played before the cut.
  const pts = normalized.points
  let after = pts.findIndex(p => p.x > cut + 1e-6)
  if (after < 0) after = pts.length - 1
  const before = Math.max(0, after - 1)
  const samples: SpeedCurvePoint[] = []
  for (let k = 1; k < SPLIT_SAMPLES; k++) {
    const lx = cut - (cut - pts[before].x) * (k / SPLIT_SAMPLES)
    const rx = cut + (pts[after].x - cut) * (k / SPLIT_SAMPLES)
    samples.push({ x: lx, v: curveSpeedAtX(normalized, lx) })
    samples.push({ x: rx, v: curveSpeedAtX(normalized, rx) })
  }

  const left: SpeedCurvePoint[] = []
  const right: SpeedCurvePoint[] = []
  for (const p of [...pts, ...samples]) {
    if (p.x < cut - 1e-6 && cut > 0) left.push({ x: p.x / cut, v: p.v })
    if (p.x > cut + 1e-6 && cut < 1) right.push({ x: (p.x - cut) / (1 - cut), v: p.v })
  }
  left.push({ x: 1, v: vCut })
  right.unshift({ x: 0, v: vCut })

  return [
    normalizeSpeedCurve({ ...normalized, preset: 'custom', points: left })!,
    normalizeSpeedCurve({ ...normalized, preset: 'custom', points: right })!,
  ]
}

export interface ClipTimingSlice {
  trimStart: number
  /** Seconds of source the piece plays. */
  sourceSpan: number
  duration: number
  speed: number
  speedCurve?: SpeedCurve
}

/**
 * The timing of the piece of a clip between `fromTime` and `toTime` (seconds
 * into the clip), as a clip of its own: where it starts reading the source,
 * how long it lasts, and — for a curve — the part of the curve it covers, so
 * the piece plays exactly the frames it played as part of the whole.
 *
 * For a reversed clip `trimStart` is still the lowest source time the piece
 * shows; the first piece of a reversed clip covers the end of its source.
 */
export function sliceClipTiming(
  clip: TimedClip & Pick<TimelineClip, 'trimStart' | 'reversed'>,
  fromTime: number,
  toTime: number,
): ClipTimingSlice {
  const duration = Math.max(0, clip.duration || 0)
  const a = Math.min(duration, Math.max(0, fromTime))
  const b = Math.min(duration, Math.max(a, toTime))
  const span = clipSourceSpan(clip)
  const oa = sourceOffsetAtClipTime(clip, a)
  const ob = sourceOffsetAtClipTime(clip, b)
  const trimStart = clip.reversed
    ? clip.trimStart + span - ob
    : clip.trimStart + oa

  if (!clip.speedCurve || !clipHasSpeedCurve(clip) || span <= 0) {
    return { trimStart, sourceSpan: ob - oa, duration: b - a, speed: clampClipSpeed(clip.speed ?? 1) }
  }

  let curve = normalizeSpeedCurve(clip.speedCurve)!
  const xa = oa / span
  const xb = ob / span
  if (xb < 1 - 1e-9) curve = splitSpeedCurve(curve, xb)[0]
  if (xa > 1e-9) curve = splitSpeedCurve(curve, xb > 0 ? xa / xb : 0)[1]
  return { trimStart, sourceSpan: ob - oa, duration: b - a, speed: curveMeanSpeed(curve), speedCurve: curve }
}

export interface ClipTimingPatch {
  duration: number
  trimStart: number
  trimEnd: number
  speed: number
  speedCurve?: SpeedCurve
}

/**
 * The timing of the two clips a cut at `timeInClip` makes.
 *
 * A clip with a constant speed keeps the long-standing arithmetic exactly. A
 * clip with a curve hands each half the part of the curve it covers, so the
 * halves play the same frames at the same moments the whole did.
 */
export function splitClipTimingAt(
  clip: TimedClip & Pick<TimelineClip, 'trimStart' | 'trimEnd' | 'reversed'>,
  timeInClip: number,
): [ClipTimingPatch, ClipTimingPatch] {
  const duration = Math.max(0, clip.duration || 0)
  const t = Math.min(duration, Math.max(0, timeInClip))
  const speed = clampClipSpeed(clip.speed ?? 1)

  if (!clip.speedCurve || !clipHasSpeedCurve(clip)) {
    return [
      { duration: t, trimStart: clip.trimStart, trimEnd: clip.trimEnd + (duration - t) * speed, speed },
      { duration: duration - t, trimStart: clip.trimStart + t * speed, trimEnd: clip.trimEnd, speed },
    ]
  }

  const outPoint = clip.trimStart + clipSourceSpan(clip)
  const piece = (slice: ClipTimingSlice): ClipTimingPatch => ({
    duration: slice.duration,
    trimStart: slice.trimStart,
    trimEnd: Math.max(0, clip.trimEnd + (outPoint - (slice.trimStart + slice.sourceSpan))),
    speed: slice.speed,
    speedCurve: slice.speedCurve,
  })
  return [piece(sliceClipTiming(clip, 0, t)), piece(sliceClipTiming(clip, t, duration))]
}

const SPLIT_SAMPLES = 4

/** Adds a point at `x`, taking the speed the curve already has there. */
export function insertSpeedCurvePoint(curve: SpeedCurve, x: number): SpeedCurve {
  const normalized = normalizeSpeedCurve(curve) ?? speedCurveForPreset('custom')
  const cx = Math.min(1, Math.max(0, x))
  const tooClose = normalized.points.some(p => Math.abs(p.x - cx) < MIN_CURVE_POINT_GAP)
  if (tooClose) return normalized
  const points = [...normalized.points, { x: cx, v: curveSpeedAtX(normalized, cx) }]
    .sort((a, b) => a.x - b.x)
  return { ...normalized, preset: 'custom', points }
}

/** Removes a point. The two end points cannot be removed. */
export function removeSpeedCurvePoint(curve: SpeedCurve, index: number): SpeedCurve {
  const normalized = normalizeSpeedCurve(curve) ?? speedCurveForPreset('custom')
  if (index <= 0 || index >= normalized.points.length - 1) return normalized
  return {
    ...normalized,
    preset: 'custom',
    points: normalized.points.filter((_, i) => i !== index),
  }
}

/**
 * Moves a point. End points keep their x; interior points stay strictly
 * between their neighbours so the order never changes under the user's drag.
 */
export function moveSpeedCurvePoint(curve: SpeedCurve, index: number, x: number, v: number): SpeedCurve {
  const normalized = normalizeSpeedCurve(curve) ?? speedCurveForPreset('custom')
  const pts = normalized.points.map(p => ({ ...p }))
  if (index < 0 || index >= pts.length) return normalized
  const last = pts.length - 1
  let nx = pts[index].x
  if (index > 0 && index < last) {
    const lo = pts[index - 1].x + MIN_CURVE_POINT_GAP
    const hi = pts[index + 1].x - MIN_CURVE_POINT_GAP
    nx = lo <= hi ? Math.min(hi, Math.max(lo, x)) : pts[index].x
  }
  pts[index] = { x: nx, v: clampCurveSpeed(v) }
  return { ...normalized, preset: 'custom', points: pts }
}

/** Whether two curves describe the same points. */
export function speedCurvesEqual(a: SpeedCurve | null | undefined, b: SpeedCurve | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.points.length !== b.points.length) return false
  return a.points.every((p, i) => Math.abs(p.x - b.points[i].x) < 1e-9 && Math.abs(p.v - b.points[i].v) < 1e-9)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exprNumber(n: number): string {
  return Number(n.toFixed(6)).toString()
}

/** Largest gap, in output seconds, between the exported and the exact timing. */
const SETPTS_TOLERANCE = 1 / 480
const SETPTS_MAX_SEGMENTS = 192

/**
 * An ffmpeg `setpts` expression mapping source PTS (after `setpts=PTS-STARTPTS`)
 * to output timestamps for a clip with a speed curve.
 *
 * The exact map is smooth; ffmpeg gets it as a piecewise-linear function whose
 * breakpoints are added where the curve bends until no frame lands more than
 * `SETPTS_TOLERANCE` from where the preview shows it. The pieces are selected
 * by a balanced tree of `if(lt(T, ...))`, so the expression stays shallow no
 * matter how many there are.
 */
export function buildSpeedCurveSetptsExpression(clip: TimedClip): string {
  if (!clip.speedCurve || !clipHasSpeedCurve(clip)) {
    const s = clampClipSpeed(clip.speed ?? 1)
    return s !== 1 ? `PTS/${s.toFixed(6)}` : 'PTS'
  }
  const curve = clip.speedCurve
  const span = clipSourceSpan(clip)
  const duration = Math.max(0, clip.duration || 0)
  const outAtX = (x: number) => curveTimeFractionAtX(curve, x) * duration

  // Breakpoints in x, refined where linear interpolation misses the exact map.
  let xs = Array.from({ length: 17 }, (_, i) => i / 16)
  for (let pass = 0; pass < 8 && xs.length - 1 < SETPTS_MAX_SEGMENTS; pass++) {
    const next: number[] = [xs[0]]
    let refined = false
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]
      const b = xs[i]
      const mid = (a + b) / 2
      const linear = (outAtX(a) + outAtX(b)) / 2
      if (Math.abs(outAtX(mid) - linear) > SETPTS_TOLERANCE && next.length + (xs.length - i) < SETPTS_MAX_SEGMENTS) {
        next.push(mid)
        refined = true
      }
      next.push(b)
    }
    xs = next
    if (!refined) break
  }

  const src = xs.map(x => x * span)
  const out = xs.map(outAtX)
  const segment = (i: number) => {
    const ds = src[i + 1] - src[i]
    const rate = ds > 0 ? (out[i + 1] - out[i]) / ds : 0
    return `(${exprNumber(out[i])}+(T-${exprNumber(src[i])})*${exprNumber(rate)})`
  }
  // Segments lo..hi inclusive. Beyond either end the outer segment's line
  // continues, so a stray frame past the end lands after the clip and is
  // dropped rather than piling onto its last frame.
  const build = (lo: number, hi: number): string => {
    if (lo === hi) return segment(lo)
    const mid = (lo + hi + 1) >>> 1
    return `if(lt(T,${exprNumber(src[mid])}),${build(lo, mid - 1)},${build(mid, hi)})`
  }
  return `(${build(0, xs.length - 2)})/TB`
}
