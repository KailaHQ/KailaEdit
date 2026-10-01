import { describe, it, expect } from 'vitest'
import { timelineClipSchema } from '../src/project-model'
import { clipSourceSpan, clipSourceTimeAt } from '../src/speed-curve'

/**
 * Projects saved before speed curves keep their speed ramps as a keyframe
 * track on `speed`. Parsing a clip turns that track into a curve that plays
 * the same frames at the same moments.
 */

function legacyClip(points: Array<{ t: number; value: number; easing?: string }>) {
  return {
    id: 'c1',
    assetId: null,
    type: 'video',
    startTime: 0,
    duration: 10,
    trimStart: 5,
    trimEnd: 0,
    speed: 1,
    trackIndex: 0,
    asset: null,
    keyframes: [
      { property: 'opacity', points: [{ t: 0, value: 100 }] },
      { property: 'speed', points },
    ],
  }
}

/** Source time the old model showed: trimStart + ∫ v over the timeline. */
function legacySourceAt(points: Array<{ t: number; value: number }>, t: number): number {
  const steps = 4000
  let m = 0
  const v = (u: number) => {
    if (u <= points[0].t) return points[0].value
    for (let i = 0; i < points.length - 1; i++) {
      if (u <= points[i + 1].t) {
        const f = (u - points[i].t) / (points[i + 1].t - points[i].t)
        return points[i].value + (points[i + 1].value - points[i].value) * f
      }
    }
    return points[points.length - 1].value
  }
  for (let i = 0; i < steps; i++) m += v((t * (i + 0.5)) / steps) * (t / steps)
  return 5 + m
}

describe('legacy speed keyframes', () => {
  it('become a curve that shows the same frames', () => {
    const points = [{ t: 0, value: 1 }, { t: 3, value: 1 }, { t: 4, value: 0.25 }, { t: 7, value: 0.25 }, { t: 8, value: 1 }, { t: 10, value: 1 }]
    const clip = timelineClipSchema.parse(legacyClip(points))

    expect(clip.keyframes?.map(k => k.property)).toEqual(['opacity'])
    expect(clip.speedCurve).toBeDefined()
    expect(clip.duration).toBe(10)
    for (const t of [0, 2, 3.5, 5, 7.5, 9, 10]) {
      expect(Math.abs(clipSourceTimeAt(clip, t) - legacySourceAt(points, t))).toBeLessThan(1 / 30)
    }
    expect(clip.duration * clip.speed).toBeCloseTo(clipSourceSpan(clip), 1)
  })

  it('turn a single keyframe into a constant speed', () => {
    const clip = timelineClipSchema.parse(legacyClip([{ t: 2, value: 3 }]))
    expect(clip.speedCurve).toBeUndefined()
    expect(clip.speed).toBe(3)
    expect(clip.keyframes?.some(k => k.property === 'speed')).toBe(false)
  })

  it('leave clips without a speed track alone', () => {
    const raw = { ...legacyClip([]), keyframes: [{ property: 'opacity', points: [{ t: 0, value: 50 }] }] }
    const clip = timelineClipSchema.parse(raw)
    expect(clip.speedCurve).toBeUndefined()
    expect(clip.speed).toBe(1)
  })
})
