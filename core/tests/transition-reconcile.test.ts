import { describe, expect, it } from 'vitest'
import {
  beginTransaction,
  commitTransaction,
  createInitialEditorState,
  deleteClips,
  moveClips,
  pruneOrphanTransitions,
  selectActiveTimeline,
  transitionOverlap,
  type Asset,
  type TimelineClip,
} from '../src'
import { mainVideoTrackIndex, packMainVideoTrack, packTrack1, resolveOverlaps } from '../src/timeline-overlap'
import { replaceActiveTimelineDocument } from '../src/actions/timeline-actions'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

/**
 * A transition is an overlap with a direction, and must not outlive the clips that make it.
 *
 * Found in a real project: after a clip was cut, dragged to the front of the main track and
 * another deleted, the old fade-to-black between clips 1 and 2 stayed in the file. Its clips had
 * swapped places, so `left.end - right.start` came out as +12 s and the preview treated that
 * whole stretch as one dissolve — wrong clip in front, everything above it left undrawn.
 */

const ASSET: Asset = { id: 'media', type: 'video', path: 'C:/media/a.mp4', prompt: '', resolution: '', duration: 120, createdAt: 0 }

const clip = (id: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip =>
  createMockClip({ id, trackIndex: 0, startTime, duration, assetId: ASSET.id, asset: ASSET, ...extra })

const transition = (id: string, leftClipId: string, rightClipId: string, duration = 0.5) =>
  ({ id, trackIndex: 0, leftClipId, rightClipId, type: 'fade-to-black', duration, leftExtend: duration / 2, rightExtend: duration / 2 })

function stateWith(clips: TimelineClip[], transitions: ReturnType<typeof transition>[]) {
  const timeline = { ...createMockTimeline(clips), transitions }
  return createInitialEditorState({ assets: [ASSET], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
}

const timelineOf = (state: ReturnType<typeof stateWith>) => selectActiveTimeline(state)!
const transitionIds = (state: ReturnType<typeof stateWith>) => (timelineOf(state).transitions ?? []).map(t => t.id)
const startsOf = (state: ReturnType<typeof stateWith>) =>
  Object.fromEntries(timelineOf(state).clips.filter(c => c.trackIndex === 0).map(c => [c.id, +c.startTime.toFixed(3)]))

/** Video 1 and 2 joined by a 0.5 s fade, as in the project: 0–5.64 and 5.14–11.94. */
const ONE_TWO = () => stateWith(
  [clip('v1', 0, 5.64), clip('v2', 5.14, 6.8), clip('v3', 11.94, 4)],
  [transition('t12', 'v1', 'v2')],
)

describe('transitionOverlap', () => {
  const track = { trackIndex: 0 }

  it('is the stretch the two clips share, for a left clip that runs into a right one', () => {
    expect(transitionOverlap({ ...track, startTime: 0, duration: 5 }, { ...track, startTime: 4.5, duration: 5 })).toBeCloseTo(0.5)
  })

  it('is nothing for clips that only touch, or leave a gap', () => {
    expect(transitionOverlap({ ...track, startTime: 0, duration: 5 }, { ...track, startTime: 5, duration: 5 })).toBe(0)
    expect(transitionOverlap({ ...track, startTime: 0, duration: 5 }, { ...track, startTime: 6, duration: 5 })).toBe(0)
  })

  it('is nothing once the clips have swapped places, however positive end minus start comes out', () => {
    const left = { ...track, startTime: 11.786, duration: 5.64 }
    const right = { ...track, startTime: 5.237, duration: 6.549 }
    expect(left.startTime + left.duration - right.startTime).toBeGreaterThan(12)
    expect(transitionOverlap(left, right)).toBe(0)
  })

  it('is nothing when one clip lies wholly inside the other', () => {
    expect(transitionOverlap({ ...track, startTime: 0, duration: 10 }, { ...track, startTime: 2, duration: 3 })).toBe(0)
  })

  it('is nothing across tracks', () => {
    expect(transitionOverlap({ trackIndex: 0, startTime: 0, duration: 5 }, { trackIndex: 1, startTime: 4.5, duration: 5 })).toBe(0)
  })
})

describe('pruneOrphanTransitions', () => {
  it('drops a record whose clips swapped places, as a damaged project file has it', () => {
    const timeline = {
      ...createMockTimeline([clip('v2', 5.237, 6.549), clip('v1', 11.786, 5.64)]),
      transitions: [transition('t', 'v1', 'v2')],
    }
    expect(pruneOrphanTransitions(timeline).transitions).toEqual([])
  })

  it('keeps a genuine overlap untouched, returning the same timeline', () => {
    const timeline = { ...createMockTimeline([clip('a', 0, 5), clip('b', 4.5, 5)]), transitions: [transition('t', 'a', 'b')] }
    expect(pruneOrphanTransitions(timeline)).toBe(timeline)
  })
})

describe('transitions through the edits that used to leave them behind', () => {
  it('deleting the clip a transition starts from removes the transition, so it can be placed again', () => {
    const next = deleteClips(ONE_TWO(), ['v1'])
    expect(transitionIds(next)).toEqual([])
    expect(startsOf(next).v2).toBe(0)
  })

  it('deleting the clip a transition ends on removes it too', () => {
    const next = deleteClips(ONE_TWO(), ['v2'])
    expect(transitionIds(next)).toEqual([])
  })

  it('leaves the other transitions alone', () => {
    const state = stateWith(
      [clip('v1', 0, 5.64), clip('v2', 5.14, 6.8), clip('v3', 11.44, 4)],
      [transition('t12', 'v1', 'v2'), transition('t23', 'v2', 'v3')],
    )
    const next = deleteClips(state, ['v3'])
    expect(transitionIds(next)).toEqual(['t12'])
  })

  it('dropping a clip in front of a joined pair keeps their order, their transition and its overlap', () => {
    // The drag handler's own pipeline (useTimelineDrag): place, push aside, pack, write.
    // v2 is listed first, as it can be in a project that has been edited for a while: when
    // pushed clips start together, array order must not decide which comes first.
    const state = stateWith(
      [clip('v2', 5.14, 6.8), clip('v1', 0, 5.64), clip('cut', 30, 5.237)],
      [transition('t12', 'v1', 'v2')],
    )
    const t = timelineOf(state)
    const dropped = t.clips.map(c => (c.id === 'cut' ? { ...c, startTime: 0 } : c))
    const mainIndex = mainVideoTrackIndex(t.tracks)
    const resolved = resolveOverlaps(dropped, new Set(['cut']), t.transitions, mainIndex)
    const packed = packMainVideoTrack(t.tracks, resolved, t.transitions)
    const next = replaceActiveTimelineDocument(state, { clips: packed })

    expect(transitionIds(next)).toEqual(['t12'])
    const starts = startsOf(next)
    expect(starts.cut).toBe(0)
    expect(starts.v1).toBeCloseTo(5.237)
    expect(starts.v2).toBeCloseTo(5.237 + 5.14)
    expect(starts.v1).toBeLessThan(starts.v2)
  })

  it('dropping a clip in front of two clips that are not joined keeps them in order', () => {
    const state = stateWith([clip('v2', 5, 5), clip('v1', 0, 5), clip('cut', 30, 6)], [])
    const t = timelineOf(state)
    const dropped = t.clips.map(c => (c.id === 'cut' ? { ...c, startTime: 0 } : c))
    const resolved = resolveOverlaps(dropped, new Set(['cut']), [], mainVideoTrackIndex(t.tracks))
    const packed = packMainVideoTrack(t.tracks, resolved, [])
    const order = packed.filter(c => c.trackIndex === 0).sort((a, b) => a.startTime - b.startTime).map(c => c.id)
    expect(order).toEqual(['cut', 'v1', 'v2'])
  })

  it('moving a joined clip past its partner drops the transition and leaves no stray overlap', () => {
    // v1 dragged to the end of the main track, behind v2 and v3.
    const next = moveClips(ONE_TWO(), { clipIds: ['v1'], deltaTime: 30 })
    expect(transitionIds(next)).toEqual([])
    const clips = timelineOf(next).clips.filter(c => c.trackIndex === 0).sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < clips.length; i += 1) {
      expect(clips[i].startTime).toBeCloseTo(clips[i - 1].startTime + clips[i - 1].duration)
    }
  })
})

describe('packing the main track around a transition', () => {
  it('overlaps a clip only with the clip its transition names', () => {
    const clips = [clip('b', 0, 4), clip('a', 4, 4), clip('c', 8, 4)]
    // a → b was joined, but the clips have since been reordered: b now comes first.
    const packed = packTrack1(clips, 0, [{ leftClipId: 'a', rightClipId: 'b', duration: 0.5 }])
    const starts = Object.fromEntries(packed.map(c => [c.id, c.startTime]))
    expect(starts).toEqual({ b: 0, a: 4, c: 8 })
  })

  it('still overlaps the pair a transition does join', () => {
    const clips = [clip('a', 0, 4), clip('b', 3.5, 4), clip('c', 7.5, 4)]
    const packed = packTrack1(clips, 0, [{ leftClipId: 'a', rightClipId: 'b', duration: 0.5 }])
    const starts = Object.fromEntries(packed.map(c => [c.id, c.startTime]))
    expect(starts).toEqual({ a: 0, b: 3.5, c: 7.5 })
  })
})

describe('transactions', () => {
  it('leave transitions alone while open, and reconcile them when committed', () => {
    const open = beginTransaction(ONE_TWO())
    const edited = deleteClips(open, ['v1'])
    // Mid-transaction a drag may pass through states it leaves again: nothing is dropped yet.
    expect(transitionIds(edited)).toEqual(['t12'])

    const committed = commitTransaction(edited)
    expect(committed.success).toBe(true)
    expect(transitionIds(committed.state)).toEqual([])
  })

  it('keep a transition whose clips end up where they began', () => {
    const open = beginTransaction(ONE_TWO())
    const there = moveClips(open, { clipIds: ['v3'], deltaTime: 3 })
    const back = moveClips(there, { clipIds: ['v3'], deltaTime: -3 })
    const committed = commitTransaction(back)
    expect(committed.success).toBe(true)
    expect(transitionIds(committed.state)).toEqual(['t12'])
  })
})
