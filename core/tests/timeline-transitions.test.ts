import { describe, it, expect } from 'vitest'
import type { Timeline, TimelineClip } from '../src/project-model'
import { findCutPoints } from '../src/timeline-cuts'
import {
  findTransitionAtCut,
  migrateLegacyDissolves,
  pruneOrphanTransitions,
  removeTransitionById,
  resolveCut,
  setTransitionAtCut,
} from '../src/timeline-transitions'

let idSeq = 0
const makeId = () => `tr-${++idSeq}`

function clip(id: string, startTime: number, duration: number, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    assetId: `asset-${id}`,
    type: 'video',
    startTime,
    duration,
    trackIndex: 0,
    trimStart: 0,
    trimEnd: 0,
    volume: 1,
    transitionIn: { type: 'none', duration: 0.5 },
    transitionOut: { type: 'none', duration: 0.5 },
    ...overrides,
  } as TimelineClip
}

function timeline(clips: TimelineClip[]): Timeline {
  return {
    id: 'tl',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 't0', name: 'V1', muted: false, locked: false, kind: 'video' },
      { id: 't1', name: 'A1', muted: false, locked: false, kind: 'audio' },
    ],
    clips,
    subtitles: [],
  } as Timeline
}

/** A, B and C end to end: 0–4, 4–8, 8–12. */
const THREE = () => timeline([clip('a', 0, 4), clip('b', 4, 4), clip('c', 8, 4)])

describe('resolveCut', () => {
  it('accepts two clips that meet', () => {
    expect(resolveCut(THREE(), 'a', 'b').ok).toBe(true)
  })

  it('refuses a gap, and says which problem it is', () => {
    const result = resolveCut(timeline([clip('a', 0, 4), clip('b', 5, 4)]), 'a', 'b')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/gap/)
  })

  it('refuses two clips on different tracks', () => {
    const result = resolveCut(timeline([clip('a', 0, 4), clip('b', 4, 4, { trackIndex: 1 })]), 'a', 'b')
    expect(result.ok === false && result.reason).toMatch(/same track/)
  })

  it('refuses clips too short to overlap', () => {
    const result = resolveCut(timeline([clip('a', 0, 0.1), clip('b', 0.1, 0.1)]), 'a', 'b')
    expect(result.ok === false && result.reason).toMatch(/too short/)
  })
})

describe('setTransitionAtCut — transition overlap', () => {
  it('pulls the right clip and everything after it left, so the film shortens', () => {
    const result = setTransitionAtCut(THREE(), 'a', 'b', 'wipe-left', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const byId = new Map(result.timeline.clips.map(c => [c.id, c]))
    expect(byId.get('a')!.startTime).toBe(0)   // the left clip does not move
    expect(byId.get('b')!.startTime).toBe(3)   // pulled left by the duration
    expect(byId.get('c')!.startTime).toBe(7)   // and everything behind follows

    // A now runs to 4 while B starts at 3: one second where both exist, which
    // is the whole point — a wipe needs two pictures at once.
    expect(byId.get('a')!.startTime + byId.get('a')!.duration).toBe(4)
    expect(result.timeline.transitions).toHaveLength(1)
    expect(result.timeline.transitions![0]).toMatchObject({
      leftClipId: 'a', rightClipId: 'b', type: 'wipe-left', duration: 1, trackIndex: 0,
    })
  })

  it('clamps to half of the shorter clip rather than swallowing it', () => {
    const result = setTransitionAtCut(timeline([clip('a', 0, 4), clip('b', 4, 1)]), 'a', 'b', 'dissolve', 10, makeId)
    expect(result.ok && result.duration).toBe(0.5)
  })

  it('re-times an existing transition without compounding the shift', () => {
    const first = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = setTransitionAtCut(first.timeline, 'a', 'b', 'dissolve', 2, makeId)
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const byId = new Map(second.timeline.clips.map(c => [c.id, c]))
    // 2s of overlap measured from the original cut, not 1 + 2.
    expect(byId.get('b')!.startTime).toBe(2)
    expect(byId.get('c')!.startTime).toBe(6)
    expect(second.timeline.transitions).toHaveLength(1)
  })

  it('drags a linked clip along so picture and sound stay together', () => {
    const base = timeline([
      clip('a', 0, 4),
      clip('b', 4, 4, { linkedClipIds: ['b-audio'] }),
      clip('b-audio', 4, 4, { trackIndex: 1, type: 'audio' }),
    ])
    const result = setTransitionAtCut(base, 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const byId = new Map(result.timeline.clips.map(c => [c.id, c]))
    expect(byId.get('b')!.startTime).toBe(3)
    expect(byId.get('b-audio')!.startTime).toBe(3)
  })

  it('refuses a transition nobody has implemented', () => {
    const result = setTransitionAtCut(THREE(), 'a', 'b', 'radiant-burst', 1, makeId)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/radiant-burst/)
  })
})

describe('removeTransitionById', () => {
  it('closes the overlap back up', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const removed = removeTransitionById(added.timeline, added.timeline.transitions![0].id)
    const byId = new Map(removed.clips.map(c => [c.id, c]))
    expect(byId.get('b')!.startTime).toBe(4)
    expect(byId.get('c')!.startTime).toBe(8)
    expect(removed.transitions).toHaveLength(0)
  })

  it('is a no-op for an id that is not there', () => {
    const base = THREE()
    // A double remove — an undo racing a click — must not shift the track.
    expect(removeTransitionById(base, 'nope')).toBe(base)
  })
})

describe('pruneOrphanTransitions', () => {
  it('drops a transition whose clip was deleted, without moving anything', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const withoutB = { ...added.timeline, clips: added.timeline.clips.filter(c => c.id !== 'b') }
    const pruned = pruneOrphanTransitions(withoutB)
    expect(pruned.transitions).toHaveLength(0)
    // The deleted clip took its own time with it; nothing else may shift.
    expect(pruned.clips.find(c => c.id === 'c')!.startTime).toBe(7)
  })

  it('leaves a healthy timeline untouched by identity', () => {
    const base = THREE()
    expect(pruneOrphanTransitions(base)).toBe(base)
  })

  it('keeps a transition whose overlap is genuinely in force', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(pruneOrphanTransitions(added.timeline).transitions).toHaveLength(1)
  })

  it('drops a transition whose clips merely meet, and moves nothing', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    // Something dragged B back to A's end: the two now abut, overlap 0.
    const a = added.timeline.clips.find(c => c.id === 'a')!
    const separated = {
      ...added.timeline,
      clips: added.timeline.clips.map(c =>
        c.id === 'b' ? { ...c, startTime: a.startTime + a.duration } : c,
      ),
    }

    const pruned = pruneOrphanTransitions(separated)
    expect(pruned.transitions).toHaveLength(0)
    // Non-rippling: the clips stay exactly where they were found.
    expect(pruned.clips.find(c => c.id === 'b')!.startTime).toBe(a.startTime + a.duration)
    expect(pruned.clips.find(c => c.id === 'c')!.startTime)
      .toBe(separated.clips.find(c => c.id === 'c')!.startTime)
  })

  it('drops a transition whose clips have been pulled fully apart', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const separated = {
      ...added.timeline,
      clips: added.timeline.clips.map(c => (c.id === 'b' ? { ...c, startTime: 20 } : c)),
    }
    expect(pruneOrphanTransitions(separated).transitions).toHaveLength(0)
  })

  it('drops a transition whose clips have ended up on different tracks', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    // B dragged up to an overlay track. The two still overlap in time, but a
    // transition only ever means something within one track.
    const moved = {
      ...added.timeline,
      clips: added.timeline.clips.map(c => (c.id === 'b' ? { ...c, trackIndex: 2 } : c)),
    }
    expect(pruneOrphanTransitions(moved).transitions).toHaveLength(0)
  })

  it('heals the record found in the real project file', () => {
    const damaged: Timeline = {
      ...timeline([
        clip('img-a', 2.84, 4.28, { type: 'image', trackIndex: 6 }),
        clip('img-b', 7.12, 5, { type: 'image', trackIndex: 6 }),
      ]),
      transitions: [{
        id: 'transition-1788609241021-uaevqvcot',
        trackIndex: 6,
        leftClipId: 'img-a',
        rightClipId: 'img-b',
        type: 'wipe-down',
        duration: 0.72,
      }],
    }

    const pruned = pruneOrphanTransitions(damaged)
    expect(pruned.transitions).toHaveLength(0)
    expect(pruned.clips.find(c => c.id === 'img-a')!.duration).toBe(4.28)
    expect(pruned.clips.find(c => c.id === 'img-b')!.startTime).toBe(7.12)
  })
})

describe('migrateLegacyDissolves', () => {
  it('turns the old paired fades into one real overlapping transition', () => {
    const legacy = timeline([
      clip('a', 0, 4, { transitionOut: { type: 'dissolve', duration: 0.8 } }),
      clip('b', 4, 4, { transitionIn: { type: 'dissolve', duration: 0.8 } }),
    ])

    const migrated = migrateLegacyDissolves(legacy, makeId)
    expect(migrated.transitions).toHaveLength(1)
    expect(migrated.transitions![0]).toMatchObject({ type: 'dissolve', duration: 0.8 })
    // The clips now genuinely overlap — under the old form they never did,
    // which is why the export dipped to black where the preview cross-faded.
    expect(migrated.clips.find(c => c.id === 'b')!.startTime).toBeCloseTo(3.2)
    // And the per-clip fades are cleared, or the export would fade twice.
    expect(migrated.clips.find(c => c.id === 'a')!.transitionOut.type).toBe('none')
    expect(migrated.clips.find(c => c.id === 'b')!.transitionIn.type).toBe('none')
  })

  it('leaves a one-sided fade alone — it has no partner to cross with', () => {
    const legacy = timeline([
      clip('a', 0, 4, { transitionIn: { type: 'fade-to-black', duration: 0.5 } }),
      clip('b', 4, 4),
    ])
    const migrated = migrateLegacyDissolves(legacy, makeId)
    expect(migrated.transitions ?? []).toHaveLength(0)
    expect(migrated.clips.find(c => c.id === 'a')!.transitionIn.type).toBe('fade-to-black')
  })

  it('does not run twice over a timeline that already migrated', () => {
    const legacy = timeline([
      clip('a', 0, 4, { transitionOut: { type: 'dissolve', duration: 0.8 } }),
      clip('b', 4, 4, { transitionIn: { type: 'dissolve', duration: 0.8 } }),
    ])
    const once = migrateLegacyDissolves(legacy, makeId)
    expect(migrateLegacyDissolves(once, makeId)).toBe(once)
  })
})

describe('findTransitionAtCut', () => {
  it('finds the transition for a pair, and nothing for a bare cut', () => {
    const added = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(findTransitionAtCut(added.timeline, 'a', 'b')).toBeDefined()
    expect(findTransitionAtCut(added.timeline, 'b', 'c')).toBeUndefined()
  })
})

describe('setTransitionAtCut — closing a gap first', () => {
  /** Two clips on an overlay track, 0.4s apart: what a hand-placed pair looks like. */
  const GAPPED = () => timeline([
    clip('a', 10, 4, { trackIndex: 2 }),
    clip('b', 14.4, 4, { trackIndex: 2 }),
    clip('c', 20, 4, { trackIndex: 2 }),
  ])

  it('refuses the gap when no licence is given', () => {
    const result = setTransitionAtCut(GAPPED(), 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/gap/)
  })

  it('pulls the right clip onto the left one, then overlaps it', () => {
    const result = setTransitionAtCut(GAPPED(), 'a', 'b', 'dissolve', 1, makeId, { closeGapUpTo: 0.4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const b = result.timeline.clips.find(c => c.id === 'b')!
    // 14.4 − 0.4 gap − 1s of transition overlap.
    expect(b.startTime).toBeCloseTo(13, 5)
    expect(result.timeline.transitions?.[0].trackIndex).toBe(2)
  })

  it('carries the rest of the track along with it', () => {
    const result = setTransitionAtCut(GAPPED(), 'a', 'b', 'dissolve', 1, makeId, { closeGapUpTo: 0.4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const c = result.timeline.clips.find(c => c.id === 'c')!
    expect(c.startTime).toBeCloseTo(20 - 0.4 - 1, 5)
  })

  it('leaves a gap wider than the licence alone', () => {
    const result = setTransitionAtCut(GAPPED(), 'a', 'b', 'dissolve', 1, makeId, { closeGapUpTo: 0.2 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/gap/)
  })

  it('does not shift anything when the clips already meet', () => {
    const result = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId, { closeGapUpTo: 0.5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timeline.clips.find(c => c.id === 'b')!.startTime).toBeCloseTo(3, 5)
  })
})

describe('setTransitionAtCut — the overlap straddles the cut', () => {
  /** Two stills meeting at 4s. A still lends tail freely: no source to exhaust. */
  const STILLS = () => timeline([
    clip('a', 0, 4, { type: 'image' }),
    clip('b', 4, 4, { type: 'image' }),
    clip('c', 8, 4, { type: 'image' }),
  ])

  it('lengthens the left clip by half, so the overlap centres on the cut', () => {
    const result = setTransitionAtCut(STILLS(), 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const a = result.timeline.clips.find(c => c.id === 'a')!
    const b = result.timeline.clips.find(c => c.id === 'b')!
    expect(a.duration).toBeCloseTo(4.5, 5)
    expect(b.startTime).toBeCloseTo(3.5, 5)
    // Overlap is 1s wide and sits symmetrically around the old cut at 4s.
    expect(a.startTime + a.duration - b.startTime).toBeCloseTo(1, 5)
    expect((b.startTime + a.startTime + a.duration) / 2).toBeCloseTo(4, 5)
    expect(result.timeline.transitions?.[0].leftExtend).toBeCloseTo(0.5, 5)
  })

  it('leaves everything after it exactly where it was', () => {
    const result = setTransitionAtCut(STILLS(), 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Both clips paid with trimmed-off media, so no time came out of the
    // timeline and nothing downstream shifts under the user's cursor.
    const b = result.timeline.clips.find(c => c.id === 'b')!
    expect(b.startTime + b.duration).toBeCloseTo(8, 5)
    expect(result.timeline.clips.find(c => c.id === 'c')!.startTime).toBe(8)
  })

  it('gives every borrowed second back on removal', () => {
    const added = setTransitionAtCut(STILLS(), 'a', 'b', 'dissolve', 1, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const removed = removeTransitionById(added.timeline, added.timeline.transitions![0].id)
    expect(removed.clips.find(c => c.id === 'a')!.duration).toBeCloseTo(4, 5)
    expect(removed.clips.find(c => c.id === 'b')!.startTime).toBeCloseTo(4, 5)
    expect(removed.clips.find(c => c.id === 'c')!.startTime).toBeCloseTo(8, 5)
  })

  it('does not drift when re-timed over and over', () => {
    let current = STILLS()
    for (const duration of [1, 2, 0.5, 1.5, 0.8]) {
      const result = setTransitionAtCut(current, 'a', 'b', 'dissolve', duration, makeId)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      current = result.timeline
    }

    const a = current.clips.find(c => c.id === 'a')!
    const b = current.clips.find(c => c.id === 'b')!
    expect(a.duration).toBeCloseTo(4.4, 5)
    expect(b.startTime).toBeCloseTo(3.6, 5)
    expect((b.startTime + a.startTime + a.duration) / 2).toBeCloseTo(4, 5)
  })

  it('borrows from a video clip only as far as its untrimmed tail allows', () => {
    const scarce = timeline([
      clip('a', 0, 4, { trimEnd: 0.2 }),
      clip('b', 4, 4),
    ])
    const result = setTransitionAtCut(scarce, 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const a = result.timeline.clips.find(c => c.id === 'a')!
    expect(a.duration).toBeCloseTo(4.2, 5)
    expect(a.trimEnd).toBeCloseTo(0, 5)
    expect(result.timeline.transitions?.[0].leftExtend).toBeCloseTo(0.2, 5)
    // The overlap is still a full second; it just leans left of the cut.
    expect(a.startTime + a.duration - result.timeline.clips.find(c => c.id === 'b')!.startTime)
      .toBeCloseTo(1, 5)
  })

  it('leans wholly left when the clip has no tail to lend', () => {
    const result = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timeline.clips.find(c => c.id === 'a')!.duration).toBe(4)
    expect(result.timeline.clips.find(c => c.id === 'b')!.startTime).toBe(3)
    expect(result.timeline.transitions?.[0].leftExtend).toBe(0)
  })
})

describe('a transition whose clips no longer overlap', () => {
  /**
   * Straight out of a real project file: two stills that meet exactly, with a
   * 0.72s transition recorded between them that nothing on the timeline shows.
   * Something moved the clips after it was placed, and the record outlived it.
   */
  const DEAD = (): Timeline => ({
    ...timeline([
      clip('img-a', 2.84, 4.28, { type: 'image', trackIndex: 6 }),
      clip('img-b', 7.12, 5, { type: 'image', trackIndex: 6 }),
    ]),
    transitions: [{
      id: 'dead',
      trackIndex: 6,
      leftClipId: 'img-a',
      rightClipId: 'img-b',
      type: 'wipe-down',
      duration: 0.72,
    }],
  })

  it('still reports the junction, as a plain cut', () => {
    const cuts = findCutPoints(DEAD().clips, DEAD().transitions)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].time).toBeCloseTo(7.12, 5)
    // The band is not drawn: the effect is not in force.
    expect(cuts[0].transition).toBeNull()
  })

  it('removing it moves nothing — there is no overlap to give back', () => {
    const removed = removeTransitionById(DEAD(), 'dead')
    expect(removed.transitions).toHaveLength(0)
    expect(removed.clips.find(c => c.id === 'img-b')!.startTime).toBeCloseTo(7.12, 5)
    expect(removed.clips.find(c => c.id === 'img-a')!.duration).toBeCloseTo(4.28, 5)
  })

  it('a new transition dropped on that junction replaces it instead of failing', () => {
    const result = setTransitionAtCut(DEAD(), 'img-a', 'img-b', 'dissolve', 0.5, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.timeline.transitions).toHaveLength(1)
    expect(result.timeline.transitions![0].type).toBe('dissolve')

    const a = result.timeline.clips.find(c => c.id === 'img-a')!
    const b = result.timeline.clips.find(c => c.id === 'img-b')!
    expect(a.startTime + a.duration - b.startTime).toBeCloseTo(0.5, 5)
    // Centred on the old cut at 7.12, as anywhere else.
    expect((b.startTime + a.startTime + a.duration) / 2).toBeCloseTo(7.12, 5)
  })
})

describe('re-timing a transition holds both clips still', () => {
  const STILLS = () => timeline([
    clip('a', 0, 4, { type: 'image' }),
    clip('b', 4, 4, { type: 'image' }),
    clip('c', 8, 4, { type: 'image' }),
  ])

  /** Where each clip visibly begins and ends, which is what the user watches. */
  const spans = (tl: Timeline) => Object.fromEntries(
    tl.clips.map(c => [c.id, [+c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4)]]),
  )

  it('grows the overlap without moving a single clip edge outward', () => {
    let current = STILLS()
    const before = spans(current)

    for (const duration of [0.5, 1, 2, 1.2, 0.8]) {
      const result = setTransitionAtCut(current, 'a', 'b', 'dissolve', duration, makeId)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      current = result.timeline

      const a = current.clips.find(c => c.id === 'a')!
      const b = current.clips.find(c => c.id === 'b')!
      // a starts where it started, b ends where it ended, c never budges.
      expect(a.startTime).toBe(before.a[0])
      expect(+(b.startTime + b.duration).toFixed(4)).toBe(before.b[1])
      expect(spans(current).c).toEqual(before.c)
      // ...and the overlap is the requested one, centred on the original cut.
      expect(a.startTime + a.duration - b.startTime).toBeCloseTo(duration, 5)
      expect((b.startTime + a.startTime + a.duration) / 2).toBeCloseTo(4, 5)
    }
  })

  it('restores the original spans when removed', () => {
    const before = spans(STILLS())
    const added = setTransitionAtCut(STILLS(), 'a', 'b', 'dissolve', 1.6, makeId)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const removed = removeTransitionById(added.timeline, added.timeline.transitions![0].id)
    expect(spans(removed)).toEqual(before)
  })

  it('falls back to closing up the timeline when neither clip has media to lend', () => {
    // Untrimmed footage: no head on the right, no tail on the left.
    const result = setTransitionAtCut(THREE(), 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.timeline.transitions![0].leftExtend).toBe(0)
    expect(result.timeline.transitions![0].rightExtend).toBe(0)
    expect(result.timeline.clips.find(c => c.id === 'b')!.startTime).toBe(3)
    expect(result.timeline.clips.find(c => c.id === 'c')!.startTime).toBe(7)
  })

  it('lets one side cover for the other when only it has media spare', () => {
    // 'a' has a 2s tail, 'b' has no head: 'a' pays the whole overlap.
    const lopsided = timeline([clip('a', 0, 4, { trimEnd: 2 }), clip('b', 4, 4)])
    const result = setTransitionAtCut(lopsided, 'a', 'b', 'dissolve', 1, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.timeline.transitions![0].leftExtend).toBeCloseTo(1, 5)
    expect(result.timeline.transitions![0].rightExtend).toBe(0)
    // 'b' still has not moved — the overlap is entirely 'a' reaching over it.
    expect(result.timeline.clips.find(c => c.id === 'b')!.startTime).toBe(4)
    expect(result.timeline.clips.find(c => c.id === 'a')!.duration).toBeCloseTo(5, 5)
  })
})
