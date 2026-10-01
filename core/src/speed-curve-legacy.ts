/**
 * Converts the speed ramps of older projects into speed curves.
 *
 * Speed used to be a keyframe track keyed on timeline time. That model is
 * gone: it never changed the clip's length, so a ramp could read past the
 * source it had been trimmed to, and every conversion that assumed a constant
 * speed (cutting, trimming, captions, export audio) was wrong for it.
 *
 * This runs while a clip is parsed, before the schema sees it, so it must not
 * import anything that imports project-model at runtime. The keyframe sampler
 * below is a deliberately small copy of the one in keyframes.ts.
 */

import { MIN_CURVE_POINT_GAP, clampCurveSpeed } from './speed-curve'

interface LegacyPoint {
  t: number
  value: number
  easing?: string
}

function ease(p: number, easing: string | undefined): number {
  const u = Math.max(0, Math.min(1, p))
  switch (easing) {
    case 'ease-in': return u * u
    case 'ease-out': return u * (2 - u)
    case 'ease-in-out': return u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u
    case 'hold': return 0
    default: return u
  }
}

function sample(points: LegacyPoint[], t: number): number {
  if (t <= points[0].t) return points[0].value
  const last = points[points.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      if (span <= 0) return b.value
      return a.value + (b.value - a.value) * ease((t - a.t) / span, a.easing)
    }
  }
  return last.value
}

const UNIFORM_SAMPLES = 32
const INTEGRATION_STEPS = 1024

/**
 * Returns the clip with its `speed` keyframe track replaced by a `speedCurve`,
 * or the clip unchanged when it has none. Works on raw, unparsed data.
 */
export function migrateLegacySpeedKeyframes<T>(raw: T): T {
  const clip = raw as any
  if (!clip || typeof clip !== 'object' || !Array.isArray(clip.keyframes)) return raw
  const track = clip.keyframes.find((k: any) => k?.property === 'speed')
  if (!track) return raw

  const rest = clip.keyframes.filter((k: any) => k !== track)
  const keyframes = rest.length > 0 ? rest : undefined
  const points: LegacyPoint[] = (Array.isArray(track.points) ? track.points : [])
    .filter((p: any) => Number.isFinite(p?.t) && Number.isFinite(p?.value) && p.value > 0)
    .sort((a: LegacyPoint, b: LegacyPoint) => a.t - b.t)
  const duration = Number(clip.duration) || 0

  if (points.length === 0 || duration <= 0) return { ...clip, keyframes }

  const constant = points.every(p => Math.abs(p.value - points[0].value) < 1e-9)
  if (constant) {
    return { ...clip, keyframes, speed: points[0].value, speedCurve: undefined }
  }

  // Source consumed by each timeline moment: M(t) = ∫ v.
  const dt = duration / INTEGRATION_STEPS
  const cumulative = new Float64Array(INTEGRATION_STEPS + 1)
  for (let i = 1; i <= INTEGRATION_STEPS; i++) {
    const a = sample(points, (i - 1) * dt)
    const b = sample(points, i * dt)
    cumulative[i] = cumulative[i - 1] + ((a + b) / 2) * dt
  }
  const total = cumulative[INTEGRATION_STEPS]
  if (!(total > 0)) return { ...clip, keyframes }
  const consumedAt = (t: number) => {
    const pos = Math.max(0, Math.min(INTEGRATION_STEPS, t / dt))
    const k = Math.min(INTEGRATION_STEPS - 1, Math.floor(pos))
    return cumulative[k] + (cumulative[k + 1] - cumulative[k]) * (pos - k)
  }

  const times = new Set<number>()
  for (let i = 0; i <= UNIFORM_SAMPLES; i++) times.add((duration * i) / UNIFORM_SAMPLES)
  for (const p of points) if (p.t > 0 && p.t < duration) times.add(p.t)

  const curvePoints: Array<{ x: number; v: number }> = []
  for (const t of [...times].sort((a, b) => a - b)) {
    const x = Math.max(0, Math.min(1, consumedAt(t) / total))
    const prev = curvePoints[curvePoints.length - 1]
    if (prev && x - prev.x < MIN_CURVE_POINT_GAP && x < 1) continue
    if (prev && x - prev.x < MIN_CURVE_POINT_GAP) curvePoints.pop()
    curvePoints.push({ x, v: clampCurveSpeed(sample(points, t)) })
  }
  curvePoints[0].x = 0
  curvePoints[curvePoints.length - 1].x = 1

  return {
    ...clip,
    keyframes,
    // The clip keeps its length, so the mean rate is what it consumed per second.
    speed: total / duration,
    speedCurve: { preset: 'custom', points: curvePoints },
  }
}
