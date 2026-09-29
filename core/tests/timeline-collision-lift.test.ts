import { describe, expect, it } from 'vitest'
import {
  createInitialEditorState,
  insertAssetsToTimeline,
  liftCollidingClipsToNewTracks,
  neighbourTrimBounds,
  resolveOverlaps,
  selectClips,
  selectTracks,
  type Asset,
  type TimelineClip,
  type Track,
} from '../src'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

const TRACKS: Track[] = [
  { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
  { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false },
  { id: 's1', kind: 'sticker', name: 'S1', locked: false, muted: false },
  { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false },
]

const clip = (id: string, trackIndex: number, startTime: number, duration: number): TimelineClip =>
  createMockClip({ id, trackIndex, startTime, duration })

let seq = 0
const ids = () => `new-${++seq}`

describe('liftCollidingClipsToNewTracks', () => {
  it('sends a clip dropped onto another overlay clip up to a new track, at the time it was dropped', () => {
    const clips = [clip('under', 1, 0, 4), clip('dragged', 1, 3, 4)]
    const out = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['dragged']), [], 0, ids)
    expect(out.tracks).toHaveLength(5)
    expect(out.tracks[4]).toMatchObject({ kind: 'video', name: 'V3', locked: false, muted: false })
    const dragged = out.clips.find(c => c.id === 'dragged')!
    expect(dragged).toMatchObject({ trackIndex: 4, startTime: 3, duration: 4 })
    // The clip underneath is untouched.
    expect(out.clips.find(c => c.id === 'under')).toBe(clips[0])
  })

  it('then leaves resolveOverlaps nothing to trim on that track', () => {
    const clips = [clip('under', 1, 0, 4), clip('dragged', 1, 1, 2)]
    const lifted = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['dragged']), [], 0, ids)
    const resolved = resolveOverlaps(lifted.clips, new Set(['dragged']), [], 0)
    // Before, a drop fully inside `under` would have split it; covering it would delete it.
    expect(resolved.find(c => c.id === 'under')).toMatchObject({ startTime: 0, duration: 4 })
    expect(resolved).toHaveLength(2)
  })

  it('does nothing when the drop lands in free space, or only touches an edge', () => {
    const clips = [clip('under', 1, 0, 4), clip('dragged', 1, 4, 2)]
    const out = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['dragged']), [], 0, ids)
    expect(out.tracks).toBe(TRACKS)
    expect(out.clips).toBe(clips)
  })

  it('keeps the kind of the track it came from', () => {
    const sticker = liftCollidingClipsToNewTracks(TRACKS, [clip('a', 2, 0, 3), clip('b', 2, 1, 3)], new Set(['b']), [], 0, ids)
    expect(sticker.tracks[4]).toMatchObject({ kind: 'sticker', name: 'S2' })
    const audio = liftCollidingClipsToNewTracks(TRACKS, [clip('a', 3, 0, 3), clip('b', 3, 1, 3)], new Set(['b']), [], 0, ids)
    expect(audio.tracks[4]).toMatchObject({ kind: 'audio', name: 'A2' })
  })

  it('leaves the main track to its magnet', () => {
    const clips = [clip('a', 0, 0, 4), clip('b', 0, 2, 4)]
    const out = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['b']), [], 0, ids)
    expect(out.tracks).toBe(TRACKS)
    expect(out.clips).toBe(clips)
  })

  it('keeps a group dragged together on one track', () => {
    const clips = [clip('under', 1, 2, 2), clip('g1', 1, 0, 3), clip('g2', 1, 5, 2)]
    const out = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['g1', 'g2']), [], 0, ids)
    expect(out.tracks).toHaveLength(5)
    expect(out.clips.filter(c => c.trackIndex === 4).map(c => c.id).sort()).toEqual(['g1', 'g2'])
  })

  it('gives each colliding track its own new track', () => {
    const clips = [clip('v', 1, 0, 4), clip('s', 2, 0, 4), clip('mv', 1, 1, 1), clip('ms', 2, 1, 1)]
    const out = liftCollidingClipsToNewTracks(TRACKS, clips, new Set(['mv', 'ms']), [], 0, ids)
    expect(out.tracks.slice(4).map(t => t.kind)).toEqual(['video', 'sticker'])
    expect(out.clips.find(c => c.id === 'mv')!.trackIndex).toBe(4)
    expect(out.clips.find(c => c.id === 'ms')!.trackIndex).toBe(5)
  })

  it('does not count an overlap two clips share through a transition', () => {
    const clips = [clip('left', 1, 0, 4), clip('right', 1, 3.5, 4)]
    const out = liftCollidingClipsToNewTracks(
      TRACKS, clips, new Set(['right']), [{ leftClipId: 'left', rightClipId: 'right' }], 0, ids)
    expect(out.clips).toBe(clips)
  })
})

describe('dropping media onto an occupied overlay spot', () => {
  const asset: Asset = {
    id: 'img', type: 'image', path: 'C:/media/logo.png', prompt: '', resolution: '', width: 512, height: 512,
    duration: 5, createdAt: 0,
  }

  function stateWith(clips: TimelineClip[]) {
    const timeline = createMockTimeline(clips, TRACKS)
    return createInitialEditorState({ assets: [asset], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
  }

  it('puts the new clip on a new track instead of overwriting', () => {
    const existing = clip('existing', 1, 0, 10)
    const state = insertAssetsToTimeline(stateWith([clip('main', 0, 0, 20), existing]), {
      assets: [asset], trackIndex: 1, startTime: 2,
    })
    const clips = selectClips(state)
    expect(clips.find(c => c.id === 'existing')).toMatchObject({ startTime: 0, duration: 10, trackIndex: 1 })
    const inserted = clips.find(c => c.assetId === 'img')!
    expect(inserted.startTime).toBe(2)
    expect(selectTracks(state)[inserted.trackIndex]).toMatchObject({ kind: 'video' })
    expect(inserted.trackIndex).not.toBe(1)
  })

  it('still lands on the track itself when the spot is free', () => {
    const state = insertAssetsToTimeline(stateWith([clip('main', 0, 0, 20), clip('existing', 1, 0, 2)]), {
      assets: [asset], trackIndex: 1, startTime: 5,
    })
    expect(selectClips(state).find(c => c.assetId === 'img')!.trackIndex).toBe(1)
    expect(selectTracks(state)).toHaveLength(TRACKS.length)
  })
})

describe('neighbourTrimBounds', () => {
  const bounds = (clips: TimelineClip[], id = 'me', transitions: Array<{ leftClipId: string; rightClipId: string }> = []) => {
    const me = clips.find(c => c.id === id)!
    return neighbourTrimBounds(clips, new Set([id]), [me.trackIndex], me.startTime, me.startTime + me.duration, transitions)
  }

  it('stops at the clips either side on the same track', () => {
    expect(bounds([clip('before', 1, 0, 2), clip('me', 1, 3, 2), clip('after', 1, 7, 2)])).toEqual({ minStart: 2, maxEnd: 7 })
  })

  it('takes the nearest neighbour on each side', () => {
    expect(bounds([clip('far', 1, 0, 1), clip('near', 1, 1.5, 1), clip('me', 1, 4, 1), clip('next', 1, 6, 1), clip('later', 1, 9, 1)]))
      .toEqual({ minStart: 2.5, maxEnd: 6 })
  })

  it('is free up to 0 and without end when nothing is there', () => {
    expect(bounds([clip('me', 1, 3, 2)])).toEqual({ minStart: 0, maxEnd: Infinity })
  })

  it('ignores other tracks, a clip already overlapping, and a transition partner', () => {
    expect(bounds([clip('me', 1, 3, 2), clip('other-track', 2, 5, 2), clip('overlapping', 1, 4, 3)]))
      .toEqual({ minStart: 0, maxEnd: Infinity })
    expect(bounds([clip('me', 1, 0, 4), clip('partner', 1, 3.5, 2)], 'me', [{ leftClipId: 'me', rightClipId: 'partner' }]))
      .toEqual({ minStart: 0, maxEnd: Infinity })
  })

  it('counts a clip touching an edge as the neighbour at that edge', () => {
    expect(bounds([clip('before', 1, 0, 3), clip('me', 1, 3, 2), clip('after', 1, 5, 2)])).toEqual({ minStart: 3, maxEnd: 5 })
  })

  it('checks every track a linked trim touches', () => {
    const clips = [clip('me', 1, 2, 2), clip('linked', 3, 2, 2), clip('audio-next', 3, 5, 2)]
    expect(neighbourTrimBounds(clips, new Set(['me', 'linked']), [1, 3], 2, 4)).toEqual({ minStart: 0, maxEnd: 5 })
  })
})
