import { describe, it, expect } from 'vitest'
import { createInitialEditorState } from '../src/editor-state'
import { setClipSpeed, setClipsSpeed, updateClip } from '../src/editor-actions'
import { selectActiveTimeline } from '../src/editor-selectors'
import type { Timeline, TimelineClip } from '../src/project-model'
import { piecewisePositionForSpeed, speedForPiecewisePosition } from '../src/clip-speed'

/**
 * Changing a clip's speed on the magnetic track.
 *
 * Speed and duration move together, and V1 must stay seamless — the timeline
 * validator rejects a main track with a gap or an overlap, and
 * `replaceActiveTimeline` drops a rejected edit and returns the previous state
 * silently. So an edit that shortens a clip without re-timing what follows does
 * not fail loudly; it just does nothing, which is how the speed slider came to
 * be dead on any clip with another clip after it.
 */

function clip(id: string, startTime: number, duration: number): TimelineClip {
  return {
    id,
    assetId: 'asset-1',
    type: 'video',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: 0,
    asset: { id: 'asset-1', type: 'video', path: '/tmp/a.mp4', duration: 120, createdAt: 0 },
    flipH: false,
    flipV: false,
    opacity: 100,
  } as unknown as TimelineClip
}

function twoClipsOnV1() {
  const timeline = {
    id: 'timeline-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
    ],
    clips: [clip('first', 0, 20), clip('second', 20, 10)],
    subtitles: [],
  } as unknown as Timeline

  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

const clipsOf = (state: ReturnType<typeof twoClipsOnV1>) =>
  [...selectActiveTimeline(state)!.clips].sort((a, b) => a.startTime - b.startTime)

describe('setClipSpeed', () => {
  it('speeds a clip up and pulls the next clip back to meet it', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 2, 10)
    const [first, second] = clipsOf(next)

    expect(first.speed).toBe(2)
    expect(first.duration).toBe(10)
    expect(second.startTime).toBe(10)
  })

  it('slows a clip down and pushes the next clip out', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 0.5, 40)
    const [first, second] = clipsOf(next)

    expect(first.speed).toBe(0.5)
    expect(second.startTime).toBe(40)
  })

  it('leaves V1 seamless, which is what the validator demands', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 1.6, 12.5)
    const [first, second] = clipsOf(next)

    expect(second.startTime).toBeCloseTo(first.startTime + first.duration, 6)
  })

  it('works on the last clip, where nothing follows', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'second', 2, 5)
    const second = clipsOf(next)[1]

    expect(second.speed).toBe(2)
    expect(second.duration).toBe(5)
  })

  it('changes speed alone when no duration is given', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 2)
    const [first, second] = clipsOf(next)

    expect(first.speed).toBe(2)
    expect(first.duration).toBe(20)
    expect(second.startTime).toBe(20)
  })

  it('refuses a speed of zero rather than freezing the clip forever', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 0)
    expect(clipsOf(next)[0].speed).toBeGreaterThan(0)
  })
})

describe('the shape of the bug this replaced', () => {
  it('shows updateClip silently dropping the same edit', () => {
    // Kept as a record of why setClipSpeed exists: patching the clip on its own
    // leaves clip two starting at 20 while clip one now ends at 10, the
    // validator rejects the timeline, and the state comes back untouched.
    const before = twoClipsOnV1()
    const after = updateClip(before, 'first', { speed: 2, duration: 10 })

    expect(clipsOf(after)[0].speed).toBe(1)
    expect(clipsOf(after)[0].duration).toBe(20)
  })
})

describe('the extended speed range', () => {
  it('accepts up to 100x', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 100, 0.5)
    expect(clipsOf(next)[0].speed).toBe(100)
  })

  it('accepts down to 0.1x', () => {
    const next = setClipSpeed(twoClipsOnV1(), 'first', 0.1, 60)
    expect(clipsOf(next)[0].speed).toBe(0.1)
  })

  it('clamps beyond the range rather than accepting nonsense', () => {
    expect(clipsOf(setClipSpeed(twoClipsOnV1(), 'first', 500, 1))[0].speed).toBe(100)
    expect(clipsOf(setClipSpeed(twoClipsOnV1(), 'first', 0.001, 60))[0].speed).toBe(0.1)
  })
})

describe('setClipsSpeed', () => {
  it('re-times a whole selection in one edit', () => {
    const next = setClipsSpeed(twoClipsOnV1(), ['first', 'second'], 2, c => c.duration / 2)
    const [first, second] = clipsOf(next)

    expect(first.speed).toBe(2)
    expect(second.speed).toBe(2)
    expect(first.duration).toBe(10)
    expect(second.startTime).toBe(10)
  })

  it('does nothing when the selection is empty', () => {
    const before = twoClipsOnV1()
    expect(setClipsSpeed(before, [], 2)).toBe(before)
  })
})

describe('linked clips synchronization', () => {
  function videoWithLinkedAudio() {
    const video = {
      ...clip('v1_clip', 0, 20),
      linkedClipIds: ['a1_clip'],
    }
    const audio = {
      ...clip('a1_clip', 0, 20),
      type: 'audio',
      trackIndex: 1,
      linkedClipIds: ['v1_clip'],
    }
    const timeline = {
      id: 'timeline-1',
      name: 'Timeline 1',
      createdAt: 0,
      tracks: [
        { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
        { id: 'track-a1', name: 'A1', muted: false, locked: false, sourcePatched: true, kind: 'audio' },
      ],
      clips: [video, audio],
      subtitles: [],
    } as unknown as Timeline

    return createInitialEditorState({
      assets: [],
      bins: {},
      timelines: [timeline],
      activeTimelineId: timeline.id,
    })
  }

  it('updates linked audio clip speed and duration when video speed is changed', () => {
    const next = setClipSpeed(videoWithLinkedAudio(), 'v1_clip', 2, 10)
    const clips = selectActiveTimeline(next)!.clips
    const video = clips.find(c => c.id === 'v1_clip')!
    const audio = clips.find(c => c.id === 'a1_clip')!

    expect(video.speed).toBe(2)
    expect(video.duration).toBe(10)
    expect(audio.speed).toBe(2)
    expect(audio.duration).toBe(10)
  })

  it('updates linked clips when setClipsSpeed is used', () => {
    const next = setClipsSpeed(videoWithLinkedAudio(), ['v1_clip'], 2, c => c.duration / 2)
    const clips = selectActiveTimeline(next)!.clips
    const video = clips.find(c => c.id === 'v1_clip')!
    const audio = clips.find(c => c.id === 'a1_clip')!

    expect(video.speed).toBe(2)
    expect(video.duration).toBe(10)
    expect(audio.speed).toBe(2)
    expect(audio.duration).toBe(10)
  })
})

describe('piecewise speed slider mapping and magnetic snapping', () => {
  it('maps landmarks exactly to their position percentages', () => {
    expect(piecewisePositionForSpeed(0.1)).toBeCloseTo(0.0)
    expect(piecewisePositionForSpeed(1.0)).toBeCloseTo(0.2)
    expect(piecewisePositionForSpeed(2.0)).toBeCloseTo(0.4)
    expect(piecewisePositionForSpeed(5.0)).toBeCloseTo(0.6)
    expect(piecewisePositionForSpeed(10.0)).toBeCloseTo(0.8)
    expect(piecewisePositionForSpeed(100.0)).toBeCloseTo(1.0)
  })

  it('snaps magnetically to landmark speeds when near landmark positions', () => {
    // 10x is at pos 0.8
    expect(speedForPiecewisePosition(0.8, true)).toBe(10)
    expect(speedForPiecewisePosition(0.79, true)).toBe(10)
    expect(speedForPiecewisePosition(0.82, true)).toBe(10)

    // 1x is at pos 0.2
    expect(speedForPiecewisePosition(0.2, true)).toBe(1)
    expect(speedForPiecewisePosition(0.18, true)).toBe(1)
    expect(speedForPiecewisePosition(0.22, true)).toBe(1)

    // 2x is at pos 0.4
    expect(speedForPiecewisePosition(0.39, true)).toBe(2)
    expect(speedForPiecewisePosition(0.41, true)).toBe(2)

    // 5x is at pos 0.6
    expect(speedForPiecewisePosition(0.58, true)).toBe(5)
    expect(speedForPiecewisePosition(0.62, true)).toBe(5)
  })

  it('interpolates smoothly when outside magnetic snap zone', () => {
    // Midpoint between 1x (pos 0.2) and 2x (pos 0.4) is pos 0.3
    const mid = speedForPiecewisePosition(0.3, true)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(2)

    // With snap disabled
    expect(speedForPiecewisePosition(0.81, false)).toBeGreaterThan(10)
  })
})

