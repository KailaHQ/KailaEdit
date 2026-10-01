import { describe, it, expect } from 'vitest'
import { createInitialEditorState } from '../src/editor-state'
import { setClipSpeed, setClipSpeedCurve, splitClipsAtTime } from '../src/editor-actions'
import { selectActiveTimeline } from '../src/editor-selectors'
import type { Timeline, TimelineClip } from '../src/project-model'
import {
  clipSourceSpan,
  clipSourceTimeAt,
  curveMeanSpeed,
  durationForSpeedCurve,
  speedCurveForPreset,
} from '../src/speed-curve'

/**
 * Speed curves through the editor actions: applying one keeps the source the
 * clip plays and changes its length, the magnetic track follows, linked audio
 * follows, and a cut leaves both halves showing what the whole showed.
 */

function clip(id: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    assetId: 'asset-1',
    type: 'video',
    startTime,
    duration,
    trimStart: 2,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: 0,
    asset: { id: 'asset-1', type: 'video', path: '/tmp/a.mp4', duration: 600, createdAt: 0 },
    flipH: false,
    flipV: false,
    opacity: 100,
    ...extra,
  } as unknown as TimelineClip
}

function stateWith(...clips: TimelineClip[]) {
  const timeline = {
    id: 't1',
    name: 'T',
    createdAt: 0,
    tracks: [
      { id: 'v1', name: 'V1', muted: false, locked: false, kind: 'video' },
      { id: 'a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
    ],
    clips,
    subtitles: [],
  } as unknown as Timeline
  return createInitialEditorState({ assets: [], bins: {}, timelines: [timeline], activeTimelineId: 't1' })
}

const clipsOf = (state: ReturnType<typeof stateWith>) =>
  [...selectActiveTimeline(state)!.clips].sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)

describe('setClipSpeedCurve', () => {
  it('keeps the source span and derives duration and mean speed from the curve', () => {
    const bullet = speedCurveForPreset('bullet')
    const [c] = clipsOf(setClipSpeedCurve(stateWith(clip('c1', 0, 6)), 'c1', bullet))
    expect(c.speedCurve?.preset).toBe('bullet')
    expect(c.duration).toBeCloseTo(durationForSpeedCurve(6, bullet), 6)
    expect(c.speed).toBeCloseTo(curveMeanSpeed(bullet), 6)
    expect(clipSourceSpan(c)).toBeCloseTo(6, 6)
    expect(c.duration * c.speed).toBeCloseTo(6, 6)
  })

  it('ripples the clips after it on the main track', () => {
    const state = stateWith(clip('c1', 0, 6), clip('c2', 6, 4))
    const [c1, c2] = clipsOf(setClipSpeedCurve(state, 'c1', speedCurveForPreset('bullet')))
    expect(c2.startTime).toBeCloseTo(c1.startTime + c1.duration, 6)
  })

  it('gives the linked audio clip the same curve and length', () => {
    const video = clip('v', 0, 6, { linkedClipIds: ['a'] })
    const audio = clip('a', 0, 6, { type: 'audio', trackIndex: 1, linkedClipIds: ['v'] } as Partial<TimelineClip>)
    const [v, a] = clipsOf(setClipSpeedCurve(stateWith(video, audio), 'v', speedCurveForPreset('hero')))
    expect(a.speedCurve).toEqual(v.speedCurve)
    expect(a.duration).toBeCloseTo(v.duration, 9)
  })

  it('removing the curve restores the clip to its length and speed before it', () => {
    const state = stateWith(clip('c1', 0, 6), clip('c2', 6, 4))
    const curved = setClipSpeedCurve(state, 'c1', speedCurveForPreset('bullet'))
    expect(clipsOf(curved)[0].duration).toBeGreaterThan(6)

    const after = clipsOf(setClipSpeedCurve(curved, 'c1', null))
    expect(after[0].speedCurve).toBeUndefined()
    expect(after[0].speed).toBe(1)
    expect(after[0].duration).toBeCloseTo(6, 9)
    // The clip after it follows back to where it was.
    expect(after[1].startTime).toBeCloseTo(6, 9)
  })

  it('returns to the earlier constant speed, not to 1x, however often the curve is changed', () => {
    const sped = clip('c1', 0, 3, { speed: 2 } as Partial<TimelineClip>) // 6s of footage at 2x
    let state = setClipSpeedCurve(stateWith(sped), 'c1', speedCurveForPreset('hero'))
    state = setClipSpeedCurve(state, 'c1', speedCurveForPreset('bullet'))
    state = setClipSpeedCurve(state, 'c1', speedCurveForPreset('jump-cut'))
    const [back] = clipsOf(setClipSpeedCurve(state, 'c1', null))
    expect(back.speed).toBe(2)
    expect(back.duration).toBeCloseTo(3, 9)
  })

  it('restores the linked audio clip too', () => {
    const video = clip('v', 0, 6, { linkedClipIds: ['a'] })
    const audio = clip('a', 0, 6, { type: 'audio', trackIndex: 1, linkedClipIds: ['v'] } as Partial<TimelineClip>)
    const curved = setClipSpeedCurve(stateWith(video, audio), 'v', speedCurveForPreset('bullet'))
    const [v, a] = clipsOf(setClipSpeedCurve(curved, 'v', null))
    expect(v.duration).toBeCloseTo(6, 9)
    expect(a.duration).toBeCloseTo(6, 9)
  })

  it('a cut keeps the way back: both halves return to the original speed', () => {
    const curved = setClipSpeedCurve(stateWith(clip('c1', 0, 6)), 'c1', speedCurveForPreset('bullet'))
    const cut = clipsOf(curved)[0].duration * 0.5
    const halves = clipsOf(splitClipsAtTime(curved, ['c1'], cut))
    expect(halves.every(h => h.speedCurve?.baseSpeed === 1)).toBe(true)
  })

  it('a constant speed from the Standard tab replaces the curve', () => {
    const curved = setClipSpeedCurve(stateWith(clip('c1', 0, 6)), 'c1', speedCurveForPreset('montage'))
    const [after] = clipsOf(setClipSpeed(curved, 'c1', 2, 3))
    expect(after.speedCurve).toBeUndefined()
    expect(after.speed).toBe(2)
  })

  it('ignores clips that have no source time', () => {
    const state = stateWith(clip('c1', 0, 6, { type: 'image' } as Partial<TimelineClip>))
    expect(setClipSpeedCurve(state, 'c1', speedCurveForPreset('bullet'))).toBe(state)
  })
})

describe('splitting a clip with a speed curve', () => {
  it('shows the same source frame on either side of the cut as before it', () => {
    const curved = setClipSpeedCurve(stateWith(clip('c1', 0, 6)), 'c1', speedCurveForPreset('hero'))
    const [whole] = clipsOf(curved)
    const cut = whole.duration * 0.41
    const [first, second] = clipsOf(splitClipsAtTime(curved, ['c1'], cut))

    expect(first.duration + second.duration).toBeCloseTo(whole.duration, 9)
    expect(second.startTime).toBeCloseTo(cut, 9)
    expect(first.speedCurve?.preset).toBe('custom')

    for (const t of [0, cut * 0.5, cut * 0.99]) {
      expect(clipSourceTimeAt(first, t)).toBeCloseTo(clipSourceTimeAt(whole, t), 1)
    }
    for (const t of [cut + 0.01, cut + (whole.duration - cut) * 0.5, whole.duration - 0.01]) {
      expect(Math.abs(clipSourceTimeAt(second, t - cut) - clipSourceTimeAt(whole, t))).toBeLessThan(1 / 30)
    }
  })
})
