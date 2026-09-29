import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  buildReplacedClip,
  clampReplacementStart,
  replacementSlack,
  createInitialEditorState,
  DEFAULT_CLIP_STABILIZATION,
  describePatch,
  isReplaceableClip,
  replaceClipMedia,
  replaceClipRefusal,
  selectClipById,
  selectClips,
  undo,
  validateEditPatch,
  type Asset,
  type EditPatch,
  type TimelineClip,
} from '../src'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

const video = (id: string, duration: number): Asset => ({
  id, type: 'video', path: `C:/media/${id}.mp4`, prompt: '', resolution: '', duration, createdAt: 0,
})
const image = (id: string): Asset => ({
  id, type: 'image', path: `C:/media/${id}.png`, prompt: '', resolution: '', width: 1080, height: 1920, createdAt: 0,
})

const OLD = video('old', 60)
const LONG = video('long', 30)
const SHORT = video('short', 3)
const PHOTO = image('photo')

/** A clip at 5 s on V2 playing 4 s of `OLD` from 10 s, with plenty set on it. */
function richClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'c', assetId: OLD.id, asset: OLD, type: 'video', trackIndex: 1,
    startTime: 5, duration: 4, trimStart: 10, trimEnd: 46, speed: 1, volume: 0.6, opacity: 80,
    importedName: 'old take',
    transform: { scale: 120, positionX: 10, positionY: -5, rotation: 12, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
    transitionIn: { type: 'fade-to-black', duration: 0.5 },
    keyframes: [{ property: 'opacity', points: [{ t: 0, value: 0, easing: 'linear' }, { t: 1, value: 100, easing: 'linear' }] }],
    filter: { id: 'vintage-kodachrome', intensity: 70 },
    autoMatte: { enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', featherEdge: 5, cleanEdge: 0,
      bake: { path: 'C:/cache/alpha.mp4', fingerprint: 'm', frameCount: 120, createdAt: 0 } },
    stabilization: { ...DEFAULT_CLIP_STABILIZATION, smoothing: 30,
      bake: { path: 'C:/cache/stab.mp4', fingerprint: 'stab_x', createdAt: 0, sourceStart: 9, sourceSpan: 6 } },
    ...overrides,
  })
}

describe('replaceClipRefusal', () => {
  const clip = richClip()

  it('accepts a long enough video, and any image', () => {
    expect(replaceClipRefusal(clip, LONG)).toBeNull()
    expect(replaceClipRefusal(clip, PHOTO)).toBeNull()
  })

  it('refuses a video shorter than the stretch the clip plays — at its speed', () => {
    expect(replaceClipRefusal(clip, SHORT)).toBe('too-short')
    // 4 s at 2x plays 8 s of media.
    expect(replaceClipRefusal({ ...clip, speed: 2 }, video('seven', 7))).toBe('too-short')
    expect(replaceClipRefusal({ ...clip, speed: 2 }, video('eight', 8))).toBeNull()
  })

  it('refuses what is not footage, and media that is not video or image', () => {
    expect(replaceClipRefusal({ ...clip, type: 'text' }, LONG)).toBe('not-replaceable')
    expect(replaceClipRefusal({ ...clip, type: 'image', stickerId: 'fire' }, PHOTO)).toBe('not-replaceable')
    expect(replaceClipRefusal({ ...clip, type: 'image', shapeProperties: { fillColor: '#fff' } }, PHOTO)).toBe('not-replaceable')
    expect(replaceClipRefusal(clip, { ...LONG, type: 'audio' })).toBe('unsupported-media')
    expect(replaceClipRefusal(clip, OLD)).toBe('same-media')
    expect(isReplaceableClip({ ...clip, type: 'audio' })).toBe(false)
  })

  it('refuses a clip on a locked track', () => {
    expect(replaceClipRefusal(clip, LONG, [{ locked: false }, { locked: true }])).toBe('locked')
  })
})

describe('buildReplacedClip', () => {
  it('keeps the clip\'s place, length and everything set on it', () => {
    const clip = richClip()
    const next = buildReplacedClip(clip, LONG)
    for (const key of ['id', 'trackIndex', 'startTime', 'duration', 'speed', 'volume', 'opacity',
      'transform', 'transitionIn', 'transitionOut', 'keyframes', 'filter', 'colorCorrection', 'flipH'] as const) {
      expect(next[key], key).toEqual(clip[key])
    }
  })

  it('points at the new media from its start, with the out point after the clip\'s span', () => {
    const next = buildReplacedClip(richClip(), LONG)
    expect(next).toMatchObject({ assetId: 'long', type: 'video', trimStart: 0, trimEnd: 26 })
    expect(next.asset?.path).toBe(LONG.path)
    expect(next.importedName).toBeUndefined()
  })

  it('starts where asked, but never so late the clip runs off the end', () => {
    expect(buildReplacedClip(richClip(), LONG, 20)).toMatchObject({ trimStart: 20, trimEnd: 6 })
    expect(buildReplacedClip(richClip(), LONG, 29)).toMatchObject({ trimStart: 26, trimEnd: 0 })
  })

  it('makes an image clip of a picture: no trims, not reversed, no stabilization', () => {
    const next = buildReplacedClip(richClip({ reversed: true }), PHOTO)
    expect(next).toMatchObject({ type: 'image', assetId: 'photo', trimStart: 0, trimEnd: 0, reversed: false })
    expect(next.stabilization).toBeUndefined()
  })

  it('drops bakes of the old frames but keeps their settings', () => {
    const next = buildReplacedClip(richClip(), LONG)
    expect(next.autoMatte).toMatchObject({ enabled: true, featherEdge: 5 })
    expect(next.autoMatte?.bake).toBeUndefined()
    expect(next.stabilization).toMatchObject({ enabled: true, smoothing: 30 })
    expect(next.stabilization?.bake).toBeUndefined()
  })
})

describe('replaceClipMedia', () => {
  function stateWith(clips: TimelineClip[], transitions: Array<{ id: string; trackIndex: number; leftClipId: string; rightClipId: string; type: string; duration: number }> = []) {
    const timeline = { ...createMockTimeline(clips), transitions }
    return createInitialEditorState({ assets: [OLD, LONG, SHORT, PHOTO], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
  }

  it('swaps the media and moves nothing else on the timeline', () => {
    const neighbours = [createMockClip({ id: 'before', trackIndex: 1, startTime: 0, duration: 5 }),
      createMockClip({ id: 'after', trackIndex: 1, startTime: 9, duration: 5 })]
    const state = stateWith([...neighbours, richClip()])
    const next = replaceClipMedia(state, 'c', 'long')
    expect(selectClipById(next, 'c')).toMatchObject({ assetId: 'long', startTime: 5, duration: 4, trackIndex: 1 })
    for (const n of neighbours) expect(selectClipById(next, n.id)).toEqual(n)
  })

  it('keeps the transitions that name the clip', () => {
    const left = createMockClip({ id: 'left', trackIndex: 0, startTime: 0, duration: 5, assetId: OLD.id, asset: OLD })
    const right = createMockClip({ id: 'right', trackIndex: 0, startTime: 5, duration: 5, assetId: OLD.id, asset: OLD })
    const transition = { id: 't', trackIndex: 0, leftClipId: 'left', rightClipId: 'right', type: 'dissolve', duration: 0.5 }
    const next = replaceClipMedia(stateWith([left, right], [transition]), 'right', 'photo')
    const timeline = next.editorModel.timelines[0]
    expect(timeline.transitions).toEqual([transition])
    expect(selectClips(next).map(c => [c.id, c.startTime, c.duration])).toEqual([['left', 0, 5], ['right', 5, 5]])
  })

  it('does nothing when the replacement is refused', () => {
    const state = stateWith([richClip()])
    expect(replaceClipMedia(state, 'c', 'short')).toBe(state)
    expect(replaceClipMedia(state, 'c', 'missing')).toBe(state)
    expect(replaceClipMedia(state, 'nope', 'long')).toBe(state)
  })

  it('carries a linked detached audio clip along, or mutes it under a still', () => {
    // On V1, which must run seamless from 0 — so both start there.
    const audio = createMockClip({ id: 'a', type: 'audio', trackIndex: 1, startTime: 0, duration: 4, trimStart: 10,
      assetId: OLD.id, asset: OLD, linkedClipIds: ['c'] })
    const clip = richClip({ trackIndex: 0, startTime: 0, linkedClipIds: ['a'] })
    const toVideo = replaceClipMedia(stateWith([clip, audio]), 'c', 'long')
    expect(selectClipById(toVideo, 'a')).toMatchObject({ assetId: 'long', trimStart: 0, trimEnd: 26, muted: false })
    const toImage = replaceClipMedia(stateWith([clip, audio]), 'c', 'photo')
    expect(selectClipById(toImage, 'a')).toMatchObject({ assetId: 'old', muted: true })
  })
})

describe('Edit Patch: replace_clip', () => {
  const state = () => {
    const timeline = createMockTimeline([richClip()])
    return createInitialEditorState({ assets: [OLD, LONG, SHORT, PHOTO], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
  }
  const patch = (op: Record<string, unknown>): EditPatch => ({ version: 1, operations: [{ op: 'replace_clip', ...op } as any] })
  const errorOf = (result: ReturnType<typeof validateEditPatch>) => ('error' in result ? String(result.error) : '')

  it('validates, describes, applies and undoes', () => {
    const p = patch({ clipId: 'c', assetId: 'long', sourceStart: 12 })
    expect(validateEditPatch(state(), p).valid).toBe(true)
    expect(describePatch(state(), p)).toContain('thay media của clip "c" bằng "long.mp4" từ giây 12, giữ nguyên vị trí và độ dài')
    const applied = applyPatch(state(), p)
    if (!applied.success) throw new Error(applied.error)
    expect(selectClipById(applied.state, 'c')).toMatchObject({ assetId: 'long', trimStart: 12, startTime: 5, duration: 4 })
    expect(selectClipById(undo(applied.state), 'c')).toMatchObject({ assetId: 'old', trimStart: 10 })
  })

  it('explains each refusal', () => {
    expect(errorOf(validateEditPatch(state(), patch({ clipId: 'x', assetId: 'long' })))).toMatch(/does not exist/)
    expect(errorOf(validateEditPatch(state(), patch({ clipId: 'c', assetId: 'x' })))).toMatch(/not in the project/)
    expect(errorOf(validateEditPatch(state(), patch({ clipId: 'c', assetId: 'short' })))).toMatch(/3\.00s long but the clip plays 4\.00s/)
    expect(errorOf(validateEditPatch(state(), patch({ clipId: 'c', assetId: 'old' })))).toMatch(/already shows/)
    expect(errorOf(validateEditPatch(state(), patch({ clipId: 'c', assetId: 'long', sourceStart: 28 })))).toMatch(/run past the end/)
  })
})

describe('choosing where in a longer video the clip starts', () => {
  const clip = richClip() // plays 4 s

  it('knows how much room a video leaves', () => {
    expect(replacementSlack(clip, LONG)).toBe(26)
    expect(replacementSlack({ ...clip, speed: 2 }, LONG)).toBe(22)
    expect(replacementSlack(clip, PHOTO)).toBe(0)
    expect(replacementSlack(clip, SHORT)).toBe(0)
    expect(replacementSlack(clip, { type: 'video', duration: undefined })).toBe(0)
  })

  it('keeps a chosen start inside that room', () => {
    expect(clampReplacementStart(12.5, clip, LONG)).toBe(12.5)
    expect(clampReplacementStart(-3, clip, LONG)).toBe(0)
    expect(clampReplacementStart(29, clip, LONG)).toBe(26)
    expect(clampReplacementStart(Number.NaN, clip, LONG)).toBe(0)
    expect(clampReplacementStart(5, clip, PHOTO)).toBe(0)
  })
})
