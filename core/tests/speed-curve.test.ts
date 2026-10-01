import { describe, it, expect } from 'vitest'
import type { SpeedCurve } from '../src/project-model'
import {
  buildSpeedCurveSetptsExpression,
  clipSourceSpan,
  clipSourceTimeAt,
  clipSpeedAtTime,
  clipTimeAtSourceOffset,
  curveMeanSpeed,
  curveSpeedAtX,
  curveTimeFractionAtX,
  curveXAtTimeFraction,
  durationForSpeedCurve,
  insertSpeedCurvePoint,
  moveSpeedCurvePoint,
  normalizeSpeedCurve,
  removeSpeedCurvePoint,
  sliceClipTiming,
  sourceOffsetAtClipTime,
  speedCurveForPreset,
  SPEED_CURVE_PRESETS,
  splitSpeedCurve,
} from '../src/speed-curve'

const flat = (v: number): SpeedCurve => ({ preset: 'custom', points: [{ x: 0, v }, { x: 1, v }] })

function curveClip(curve: SpeedCurve | undefined, sourceSpan: number, extra: Record<string, unknown> = {}) {
  const duration = curve ? durationForSpeedCurve(sourceSpan, curve) : sourceSpan
  return {
    duration,
    speed: curve ? curveMeanSpeed(curve) : 1,
    speedCurve: curve,
    trimStart: 10,
    trimEnd: 0,
    reversed: false,
    ...extra,
  }
}

describe('speed curve maths', () => {
  it('a flat curve behaves exactly like a constant speed', () => {
    const clip = curveClip(flat(2), 8)
    expect(clip.duration).toBeCloseTo(4, 6)
    expect(clip.speed).toBeCloseTo(2, 6)
    expect(sourceOffsetAtClipTime(clip, 1)).toBeCloseTo(2, 6)
    expect(clipTimeAtSourceOffset(clip, 6)).toBeCloseTo(3, 6)
    expect(clipSpeedAtTime(clip, 2.5)).toBeCloseTo(2, 6)
  })

  it('time and source position round-trip', () => {
    for (const preset of SPEED_CURVE_PRESETS) {
      const clip = curveClip(speedCurveForPreset(preset), 6)
      for (let i = 0; i <= 20; i++) {
        const t = (clip.duration * i) / 20
        const offset = sourceOffsetAtClipTime(clip, t)
        expect(clipTimeAtSourceOffset(clip, offset)).toBeCloseTo(t, 3)
      }
    }
  })

  it('consumes the whole source span by the end of the clip', () => {
    for (const preset of SPEED_CURVE_PRESETS) {
      const clip = curveClip(speedCurveForPreset(preset), 6)
      expect(sourceOffsetAtClipTime(clip, clip.duration)).toBeCloseTo(6, 6)
      expect(clipSourceSpan(clip)).toBeCloseTo(6, 6)
    }
  })

  it('source position is monotone in time', () => {
    const curve = speedCurveForPreset('montage')
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const x = curveXAtTimeFraction(curve, i / 200)
      expect(x).toBeGreaterThanOrEqual(prev)
      prev = x
    }
  })

  it('never overshoots the speed range between points', () => {
    for (const preset of SPEED_CURVE_PRESETS) {
      const curve = speedCurveForPreset(preset)
      const vs = curve.points.map(p => p.v)
      const lo = Math.min(...vs)
      const hi = Math.max(...vs)
      for (let i = 0; i <= 400; i++) {
        const v = curveSpeedAtX(curve, i / 400)
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(v).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })

  it('a slow-motion dip makes the clip longer', () => {
    const bullet = speedCurveForPreset('bullet')
    expect(durationForSpeedCurve(6, bullet)).toBeGreaterThan(6)
    // And it spends most of its time in the dip.
    const clip = curveClip(bullet, 6)
    const enter = clipTimeAtSourceOffset(clip, 6 * 0.42)
    const leave = clipTimeAtSourceOffset(clip, 6 * 0.58)
    expect(leave - enter).toBeGreaterThan(clip.duration * 0.35)
  })

  it('maps a reversed clip from its out-point backwards', () => {
    const clip = curveClip(flat(1), 5, { reversed: true })
    expect(clipSourceTimeAt(clip, 0)).toBeCloseTo(15, 6)
    expect(clipSourceTimeAt(clip, 5)).toBeCloseTo(10, 6)
    expect(clipSourceTimeAt(clip, 0, 20)).toBeCloseTo(20, 6) // trimEnd 0 on a 20s file
  })

  it('is fast once the table is built', () => {
    const clip = curveClip(speedCurveForPreset('hero'), 6)
    sourceOffsetAtClipTime(clip, 0)
    const start = performance.now()
    for (let i = 0; i < 10_000; i++) sourceOffsetAtClipTime(clip, (i % 100) / 100 * clip.duration)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('editing curves', () => {
  it('normalises unsorted, out-of-range points', () => {
    const c = normalizeSpeedCurve({ preset: 'custom', points: [{ x: 0.7, v: 50 }, { x: 0.2, v: 0.01 }] })!
    expect(c.points[0]).toEqual({ x: 0, v: 0.1 })
    expect(c.points[c.points.length - 1]).toEqual({ x: 1, v: 10 })
    expect(c.points.map(p => p.x)).toEqual([0, 0.2, 0.7, 1])
  })

  it('keeps interior points between their neighbours and end points pinned', () => {
    const curve = speedCurveForPreset('custom')
    const moved = moveSpeedCurvePoint(curve, 1, 0.9, 3)
    expect(moved.points[1].x).toBeLessThan(moved.points[2].x)
    expect(moved.points[1].v).toBe(3)
    const end = moveSpeedCurvePoint(curve, 0, 0.5, 4)
    expect(end.points[0].x).toBe(0)
    expect(end.preset).toBe('custom')
  })

  it('adds and removes points, never the ends', () => {
    const curve = speedCurveForPreset('jump-cut')
    const added = insertSpeedCurvePoint(curve, 0.8)
    expect(added.points.length).toBe(curve.points.length + 1)
    expect(removeSpeedCurvePoint(added, 0).points.length).toBe(added.points.length)
    expect(removeSpeedCurvePoint(added, added.points.length - 1).points.length).toBe(added.points.length)
    expect(removeSpeedCurvePoint(added, 1).points.length).toBe(curve.points.length)
  })

  it('splits a curve into halves that keep the speed at the cut', () => {
    const curve = speedCurveForPreset('hero')
    const [left, right] = splitSpeedCurve(curve, 0.5)
    expect(left.points[left.points.length - 1].v).toBeCloseTo(curveSpeedAtX(curve, 0.5), 6)
    expect(right.points[0].v).toBeCloseTo(curveSpeedAtX(curve, 0.5), 6)
  })

  it('slices of a clip together last as long as the clip and cover its source', () => {
    for (const preset of SPEED_CURVE_PRESETS) {
      const clip = curveClip(speedCurveForPreset(preset), 6)
      const cut = clip.duration * 0.37
      const a = sliceClipTiming(clip, 0, cut)
      const b = sliceClipTiming(clip, cut, clip.duration)
      expect(a.duration + b.duration).toBeCloseTo(clip.duration, 9)
      expect(b.trimStart).toBeCloseTo(clip.trimStart + sourceOffsetAtClipTime(clip, cut), 9)
      // Each piece's own curve plays the span it was given, within a frame at 60fps.
      const spanA = clipSourceSpan({ duration: a.duration, speed: a.speed, speedCurve: a.speedCurve })
      const spanB = clipSourceSpan({ duration: b.duration, speed: b.speed, speedCurve: b.speedCurve })
      expect(Math.abs(spanA + spanB - 6)).toBeLessThan(1 / 60)
      expect(Math.abs(b.trimStart - (clip.trimStart + spanA))).toBeLessThan(1 / 60)
    }
  })

  it('slices a reversed clip from the end of its source', () => {
    const clip = curveClip(flat(1), 6, { reversed: true })
    const first = sliceClipTiming(clip, 0, 2)
    const second = sliceClipTiming(clip, 2, 6)
    expect(first.trimStart).toBeCloseTo(14, 6) // shows 16 → 14
    expect(second.trimStart).toBeCloseTo(10, 6) // shows 14 → 10
  })
})

describe('export setpts expression', () => {
  /** Evaluates the expression the way ffmpeg would, for a source time T in seconds. */
  function evaluate(expr: string, T: number): number {
    const js = expr.replace(/\bif\(/g, 'iff(')
    // eslint-disable-next-line no-new-func
    return Function('T', `const lt = (a, b) => a < b; const iff = (c, a, b) => (c ? a : b); return ${js}`)(T) as number
  }

  it('is a plain division for a constant speed', () => {
    expect(buildSpeedCurveSetptsExpression({ duration: 5, speed: 2 })).toBe('PTS/2.000000')
  })

  it('places every source frame within half a frame of the preview', () => {
    for (const preset of SPEED_CURVE_PRESETS) {
      const clip = curveClip(speedCurveForPreset(preset), 6)
      const expr = buildSpeedCurveSetptsExpression(clip)
      expect(expr.endsWith('/TB')).toBe(true)
      const body = expr.slice(1, -4)
      for (let i = 0; i <= 60; i++) {
        const T = (6 * i) / 60
        const exported = evaluate(body, T)
        const preview = clipTimeAtSourceOffset(clip, T)
        expect(Math.abs(exported - preview)).toBeLessThan(1 / 240)
      }
      expect(curveTimeFractionAtX(clip.speedCurve!, 1)).toBeCloseTo(1, 9)
    }
  })
})
