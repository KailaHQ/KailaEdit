import { describe, expect, it } from 'vitest'
import {
  buildOverlayPaste,
  clipScreenBox,
  copyOverlays,
  copySelection,
  createInitialEditorState,
  pasteSelection,
  selectAssets,
  selectCanUseClipboard,
  selectClips,
  selectSelectedClipIds,
  selectTracks,
  setCurrentTime,
  transformForBox,
  type Asset,
  type OverlayClipboardItem,
  type Track,
} from '../src'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

const FOOTAGE: Asset = {
  id: 'footage', type: 'video', path: 'C:/media/footage.mp4', prompt: '', resolution: '1080x1920',
  width: 1080, height: 1920, duration: 60, createdAt: 0,
}
const PICTURE: Asset = {
  id: 'cover-pic', type: 'image', path: 'C:/assets/cover-pic.png', prompt: '', resolution: '400x200',
  width: 400, height: 200, createdAt: 0,
}
const TRACKS: Track[] = [
  { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
  { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false },
]

/** Stacking order, lowest first — the order the cover studio copies them in. */
const ITEMS: OverlayClipboardItem[] = [
  { kind: 'shape', shapeType: 'circle', shapeProperties: { fillColor: '#ff0000' }, box: { x: 30, y: 40, width: 20, height: 10 }, rotation: 15, opacity: 80 },
  { kind: 'image', asset: PICTURE, box: { x: 70, y: 60, width: 40, height: 10 }, rotation: 0, opacity: 100 },
  { kind: 'text', textStyle: { text: 'HELLO', fontSize: 72, positionX: 50, positionY: 20 }, rotation: -5 },
]

function stateWithFootage() {
  const timeline = createMockTimeline([
    createMockClip({ id: 'main', assetId: FOOTAGE.id, asset: FOOTAGE, type: 'video', trackIndex: 0, startTime: 0, duration: 20 }),
  ], TRACKS)
  return createInitialEditorState({ assets: [FOOTAGE], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
}

describe('transformForBox', () => {
  it('is the inverse of clipScreenBox: the picture lands exactly on the box it had on the cover', () => {
    const frame = { width: 1080, height: 1920 }
    const box = { x: 70, y: 60, width: 40, height: 10 }
    const tf = transformForBox(frame, PICTURE, box, 0)
    const screen = clipScreenBox(frame, PICTURE, tf)
    expect(screen.width).toBeCloseTo(0.4 * 1080, 0)
    expect(screen.height).toBeCloseTo(0.1 * 1920, 0)
    expect(screen.left + screen.width / 2).toBeCloseTo(0.7 * 1080, 0)
    expect(screen.top + screen.height / 2).toBeCloseTo(0.6 * 1920, 0)
  })
})

describe('buildOverlayPaste', () => {
  it('puts each object on a track of its own above every existing one, in stacking order, 3 s long', () => {
    let n = 0
    const out = buildOverlayPaste({
      tracks: TRACKS, items: ITEMS, atTime: 4.5, frame: { width: 1080, height: 1920 }, makeId: p => `${p}-${n++}`,
    })
    expect(out.tracks).toHaveLength(TRACKS.length + 3)
    expect(out.tracks.slice(0, 2)).toEqual(TRACKS)
    // Shapes are stickers and live on sticker rows; text and pictures on video rows.
    expect(out.tracks.slice(2).map(t => t.kind)).toEqual(['sticker', 'video', 'video'])
    expect(out.clips.map(c => c.trackIndex)).toEqual([2, 3, 4])
    for (const clip of out.clips) {
      expect(clip.startTime).toBe(4.5)
      expect(clip.duration).toBe(3)
    }
    const [shape, picture, text] = out.clips
    expect(shape.stickerId).toBe('shape-circle')
    expect(shape.shapeProperties).toEqual({ fillColor: '#ff0000' })
    expect(shape.opacity).toBe(80)
    expect(shape.transform.rotation).toBe(15)
    expect(shape.transform.positionX).toBe(-20)
    expect(shape.transform.positionY).toBe(-10)
    expect(picture.assetId).toBe(PICTURE.id)
    expect(text.type).toBe('text')
    expect(text.textStyle).toMatchObject({ text: 'HELLO', fontSize: 72, positionX: 50, positionY: 20 })
    expect(text.transform.rotation).toBe(-5)
    // The shape's sticker asset and the picture come along.
    expect(out.assets.map(a => a.id)).toEqual([shape.assetId, PICTURE.id])
  })
})

describe('copy from the cover, paste on the timeline', () => {
  it('pastes at the playhead onto new top tracks and selects what it pasted', () => {
    let state = copyOverlays(stateWithFootage(), ITEMS)
    expect(selectCanUseClipboard(state)).toBe(true)
    state = setCurrentTime(state, 7.25)
    const before = state
    state = pasteSelection(state)

    const pasted = selectClips(state).filter(c => c.id !== 'main')
    expect(pasted).toHaveLength(3)
    expect(pasted.every(c => c.startTime === 7.25 && c.duration === 3)).toBe(true)
    expect(selectTracks(state)).toHaveLength(TRACKS.length + 3)
    expect(new Set(pasted.map(c => c.trackIndex)).size).toBe(3)
    expect([...selectSelectedClipIds(state)].sort()).toEqual(pasted.map(c => c.id).sort())
    expect(selectAssets(state).some(a => a.id === PICTURE.id)).toBe(true)
    expect(selectClips(state).find(c => c.id === 'main')).toEqual(selectClips(before).find(c => c.id === 'main'))

    // Pasting again lays another set on further new tracks, as a clip paste would.
    const twice = pasteSelection(state)
    expect(selectTracks(twice)).toHaveLength(TRACKS.length + 6)
  })

  it('a Ctrl+C with nothing selected on the timeline keeps what the cover copied', () => {
    const state = copySelection(copyOverlays(stateWithFootage(), ITEMS))
    expect(state.session.clipboard.kind).toBe('overlays')
    expect(state.session.clipboard.overlays).toHaveLength(3)
  })

  it('copying nothing changes nothing', () => {
    const state = stateWithFootage()
    expect(copyOverlays(state, [])).toBe(state)
    expect(pasteSelection(state)).toBe(state)
  })
})
