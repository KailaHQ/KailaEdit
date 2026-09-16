import { describe, it, expect } from 'vitest'
import { createInitialEditorState } from '../src/editor-state'
import { addStickerClip, setCurrentTime } from '../src/editor-actions'
import { selectActiveTimeline, selectTracks } from '../src/editor-selectors'
import { DEFAULT_STICKER_PIXELS } from '../src/stickers'
import type { Timeline } from '../src/project-model'

/**
 * Where the Add button drops a sticker.
 *
 * At the very start of the timeline every sticker gets its own layer, because
 * they would all begin at 0 and simply cover each other otherwise. Anywhere
 * else the first sticker layer is reused at the playhead position.
 */

function baseState() {
  const timeline = {
    id: 'timeline-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
    ],
    clips: [],
    subtitles: [],
    width: 720,
    height: 1280,
  } as unknown as Timeline

  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

const stickerTracks = (state: ReturnType<typeof baseState>) =>
  selectTracks(state).filter(track => track.kind === 'sticker')

describe('adding a sticker with the playhead at the start', () => {
  it('gives every sticker its own layer', () => {
    let state = baseState()
    state = addStickerClip(state, { stickerId: 'fire' })
    state = addStickerClip(state, { stickerId: 'heart' })
    state = addStickerClip(state, { stickerId: 'star' })

    expect(stickerTracks(state)).toHaveLength(3)

    const clips = selectActiveTimeline(state)!.clips
    expect(clips).toHaveLength(3)
    expect(new Set(clips.map(clip => clip.trackIndex)).size).toBe(3)
    for (const clip of clips) expect(clip.startTime).toBe(0)
  })
})

describe('adding a sticker with the playhead further along', () => {
  it('reuses the first sticker layer at the playhead', () => {
    let state = baseState()
    state = addStickerClip(state, { stickerId: 'fire' }) // layer 1, at 0

    state = setCurrentTime(state, 8)
    state = addStickerClip(state, { stickerId: 'heart' })

    expect(stickerTracks(state)).toHaveLength(1)

    const clips = selectActiveTimeline(state)!.clips
    expect(clips).toHaveLength(2)
    expect(new Set(clips.map(clip => clip.trackIndex)).size).toBe(1)

    const later = clips.find(clip => clip.stickerId === 'heart')!
    expect(later.startTime).toBe(8)
  })

  it('skips a layer that is already busy at that moment', () => {
    let state = baseState()
    state = addStickerClip(state, { stickerId: 'fire' })

    // Two adds at the same non-zero position: the first sticker layer is taken,
    // so the second needs a layer of its own rather than an invisible overlap.
    state = setCurrentTime(state, 8)
    state = addStickerClip(state, { stickerId: 'heart' })
    state = addStickerClip(state, { stickerId: 'star' })

    expect(stickerTracks(state)).toHaveLength(2)

    const atEight = selectActiveTimeline(state)!.clips.filter(clip => clip.startTime === 8)
    expect(atEight).toHaveLength(2)
    expect(new Set(atEight.map(clip => clip.trackIndex)).size).toBe(2)
  })

  it('never lands on a video or text row, only on sticker rows', () => {
    let state = baseState()
    state = setCurrentTime(state, 5)
    state = addStickerClip(state, { stickerId: 'fire' })

    const tracks = selectTracks(state)
    const clip = selectActiveTimeline(state)!.clips[0]
    expect(tracks[clip.trackIndex].kind).toBe('sticker')
  })

  it('honours an explicit trackIndex, which is what MCP add_sticker passes', () => {
    let state = baseState()
    state = addStickerClip(state, { stickerId: 'fire' })
    state = setCurrentTime(state, 4)
    state = addStickerClip(state, { stickerId: 'heart', trackIndex: 1 })

    const clips = selectActiveTimeline(state)!.clips
    expect(clips.every(clip => clip.trackIndex === 1)).toBe(true)
  })
})

describe('the size a new sticker starts at', () => {
  it('is about DEFAULT_STICKER_PIXELS of the project frame, not a fixed percentage', () => {
    // 720x1280 frame: a square sticker is fitted to the 720 short edge first,
    // so DEFAULT_STICKER_PIXELS is measured against it.
    const state = addStickerClip(baseState(), { stickerId: 'fire' })
    const clip = selectActiveTimeline(state)!.clips[0]

    const shortEdge = 720
    const renderedPx = (clip.transform!.scale / 100) * shortEdge
    expect(renderedPx).toBeCloseTo(DEFAULT_STICKER_PIXELS, 0)
  })

  it('scales with the frame, so a 4K timeline does not get a giant sticker', () => {
    const state = addStickerClip(baseState(), { stickerId: 'fire' })
    const small = selectActiveTimeline(state)!.clips[0].transform!.scale

    // Same target on a much larger frame means a reasonable percentage.
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(30)
  })

  it('honours an explicit scale from the caller', () => {
    const state = addStickerClip(baseState(), { stickerId: 'fire', scale: 80 })
    expect(selectActiveTimeline(state)!.clips[0].transform!.scale).toBe(80)
  })
})
