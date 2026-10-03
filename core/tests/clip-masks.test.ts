import { describe, expect, it } from 'vitest'
import {
  addClipMask,
  buildClipMaskSvg,
  buildMaskDimSvg,
  maskPictureBox,
  getClipEffectStyles,
  getClipMasks,
  hasActiveMask,
  removeClipMask,
  selectClipById,
  selectClipMask,
  setActiveMaskId,
  setClipMask,
  updateClipMask,
  DEFAULT_CLIP_MASK,
} from '../src'
import { defaultMaskSize } from '../src/mask-shapes'
import { setClipMaskShape } from '../src'
import { makeTestState, createMockClip, createMockTimeline } from './edit-patch-test-helpers'
import { createInitialEditorState, selectActiveTimeline } from '../src'
import { getEffectiveTimelineDimensions } from '../src/video-resolution'

/**
 * A clip can carry several masks. The picture shows wherever any of them covers it, and one of
 * them at a time is "being edited" (the panel's tab, the canvas handles). Clips saved with the one
 * old `mask` field keep working and move to the list the first time they are edited.
 */

const masksOf = (state: ReturnType<typeof makeTestState>) => getClipMasks(selectClipById(state, 'clip-1')!)

describe('clip masks', () => {
  it('starts with none, and adding gives each mask its own id and makes the new one the edited one', () => {
    let state = makeTestState()
    expect(masksOf(state)).toEqual([])

    state = addClipMask(state, 'clip-1', 'rectangle')
    state = addClipMask(state, 'clip-1', 'heart')

    const masks = masksOf(state)
    expect(masks.map(mask => mask.shape)).toEqual(['rectangle', 'heart'])
    expect(new Set(masks.map(mask => mask.id)).size).toBe(2)
    expect(selectClipMask(state, 'clip-1')?.id).toBe(masks[1].id)
  })

  it('changes one mask without touching the others, and can switch its shape in place', () => {
    let state = addClipMask(addClipMask(makeTestState(), 'clip-1', 'rectangle'), 'clip-1', 'star')
    const [first, second] = masksOf(state)

    state = updateClipMask(state, 'clip-1', first.id!, { shape: 'ellipse', feather: 30 })

    const after = masksOf(state)
    expect(after[0]).toMatchObject({ id: first.id, shape: 'ellipse', feather: 30 })
    expect(after[1]).toEqual(second)
  })

  it('removes a mask and moves the edited one to its neighbour', () => {
    let state = ['rectangle', 'ellipse', 'star'].reduce((acc, shape) => addClipMask(acc, 'clip-1', shape as never), makeTestState())
    const [, middle, last] = masksOf(state)

    state = removeClipMask(state, 'clip-1', last.id!)
    expect(selectClipMask(state, 'clip-1')?.id).toBe(middle.id)

    state = removeClipMask(state, 'clip-1', middle.id!)
    state = removeClipMask(state, 'clip-1', masksOf(state)[0].id!)
    expect(masksOf(state)).toEqual([])
    expect(selectClipById(state, 'clip-1')?.masks).toBeUndefined()
  })

  it('setClipMask edits the mask being edited, and adds one when the clip has none', () => {
    let state = setClipMask(makeTestState(), 'clip-1', { x: 20 })
    expect(masksOf(state)).toHaveLength(1)
    expect(masksOf(state)[0]).toMatchObject({ x: 20, shape: DEFAULT_CLIP_MASK.shape })

    state = addClipMask(state, 'clip-1', 'ellipse')
    const [first, second] = masksOf(state)
    state = setActiveMaskId(state, first.id!)
    state = setClipMask(state, 'clip-1', { y: 70 })

    expect(masksOf(state)[0]).toMatchObject({ id: first.id, y: 70 })
    expect(masksOf(state)[1]).toEqual(second)

    expect(masksOf(setClipMask(state, 'clip-1', null))).toEqual([])
  })

  it('reads a clip saved with the one old mask field, and moves it to the list when edited', () => {
    let state = makeTestState()
    state = {
      ...state,
      editorModel: {
        ...state.editorModel,
        timelines: state.editorModel.timelines.map(timeline => ({
          ...timeline,
          clips: timeline.clips.map(clip => ({ ...clip, mask: { ...DEFAULT_CLIP_MASK, shape: 'ellipse' as const } })),
        })),
      },
    }
    const clip = selectClipById(state, 'clip-1')!
    expect(getClipMasks(clip)).toHaveLength(1)
    expect(getClipMasks(clip)[0].shape).toBe('ellipse')
    expect(hasActiveMask(clip)).toBe(true)

    state = addClipMask(state, 'clip-1', 'star')
    const edited = selectClipById(state, 'clip-1')!
    expect(edited.mask).toBeUndefined()
    expect(getClipMasks(edited).map(mask => mask.shape)).toEqual(['ellipse', 'star'])
  })

  it('does not count masks that are switched off', () => {
    let state = addClipMask(makeTestState(), 'clip-1', 'rectangle')
    expect(hasActiveMask(selectClipById(state, 'clip-1')!)).toBe(true)
    state = updateClipMask(state, 'clip-1', masksOf(state)[0].id!, { enabled: false })
    expect(hasActiveMask(selectClipById(state, 'clip-1')!)).toBe(false)
  })
})

describe('mask preview svg', () => {
  const mask = (patch: object) => ({ ...DEFAULT_CLIP_MASK, ...patch })

  it('draws every mask, so the picture shows wherever any covers it', () => {
    const svg = buildClipMaskSvg([mask({ shape: 'rectangle', x: 25 }), mask({ shape: 'ellipse', x: 75 }), mask({ shape: 'star' }), mask({ shape: 'heart' })])
    expect(svg).toContain('<rect')
    expect(svg).toContain('<ellipse')
    expect(svg.match(/<polygon/g)).toHaveLength(2)
  })

  it('gives each feathered or inverted mask ids of its own', () => {
    const svg = buildClipMaskSvg([mask({ feather: 20, invert: true }), mask({ feather: 40, invert: true })])
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map(match => match[1])
    expect(ids.length).toBe(4)
    expect(new Set(ids).size).toBe(4)
  })

  it('rounds a rectangle\'s corners', () => {
    expect(buildClipMaskSvg(mask({ roundCorners: 0 }))).not.toContain('rx=')
    expect(buildClipMaskSvg(mask({ roundCorners: 100, width: 40, height: 20 }))).toContain('rx="10.00"')
  })

  it('accepts a single mask as it always did', () => {
    expect(buildClipMaskSvg(mask({}))).toBe(buildClipMaskSvg([mask({})]))
  })
})

describe('mask geometry on a picture that is not square', () => {
  const mask = (patch: object) => ({ ...DEFAULT_CLIP_MASK, ...patch })

  it('is drawn in the proportions of the picture, so a rotation does not shear it', () => {
    const svg = buildClipMaskSvg(mask({ shape: 'rectangle', x: 50, y: 50, width: 50, height: 50, rotation: 30 }), 0.5625)
    expect(svg).toContain('viewBox="0 0 56.25 100"')
    // 50% of a 56.25-wide box, centred at its middle.
    expect(svg).toContain('width="28.13"')
    expect(svg).toContain('rotate(30 28.13 50.00)')
  })

  it('lays the mask over the picture as it is fitted in the frame', () => {
    // A 16:9 picture in a 9:16 frame fills the width and a third-ish of the height.
    const wide = maskPictureBox({ asset: { width: 1920, height: 1080 } } as never, 9 / 16)
    expect(wide.aspect).toBeCloseTo(16 / 9)
    expect(wide.size).toBe('100.000% 31.641%')
    // Same shape as the frame: the whole frame.
    expect(maskPictureBox({ asset: { width: 1080, height: 1920 } } as never, 9 / 16).size).toBe('100.000% 100.000%')
    // Nothing known about the frame: the picture is taken to fill it.
    expect(maskPictureBox({ asset: { width: 1920, height: 1080 } } as never).size).toBe('100% 100%')
  })

  it('writes that box into the clip style, and leaves the mask off while it is being edited', () => {
    const clip = { id: 'c', type: 'video', trackIndex: 0, asset: { width: 1920, height: 1080 }, masks: [mask({ id: 'm' })] } as never
    const style = getClipEffectStyles(clip, 0, { frameAspect: 9 / 16 })
    expect(style.maskSize).toBe('100.000% 31.641%')
    expect(decodeURIComponent(String(style.maskImage))).toContain('viewBox="0 0 177.78 100"')
    expect(getClipEffectStyles(clip, 0, { frameAspect: 9 / 16, ignoreMask: true }).maskImage).toBeUndefined()
  })

  it('blacks out what the masks hide, fully, unless asked for less', () => {
    const svg = buildMaskDimSvg([mask({ shape: 'ellipse' })], 1)
    expect(svg).toContain('fill-opacity="1"')
  })

  it('dims what the masks hide: one overlay for any number of masks', () => {
    const svg = buildMaskDimSvg([mask({ shape: 'linear', y: 50 }), mask({ shape: 'ellipse', invert: true })], 0.5625, 0.6)
    expect(svg).toContain('fill-opacity="0.6"')
    expect(svg).toContain('<mask id="dim">')
    // The shapes are cut out of the dimming in black; the inverted one through its own mask.
    expect(svg).toContain('mask="url(#inv1)"')
    expect(svg).toContain('fill="black"')
  })
})

describe('default mask size', () => {
  /** What the mask looks like on screen, in pixels, for a picture of the given size. */
  const onScreen = (size: { width: number; height: number }, pictureWidth: number, pictureHeight: number) => ({
    width: (size.width / 100) * pictureWidth,
    height: (size.height / 100) * pictureHeight,
  })

  it.each(['ellipse', 'rectangle', 'star', 'heart'])('makes a %s square on screen, whatever the shape of the picture', shape => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1000, 1000], [720, 1280]]) {
      const px = onScreen(defaultMaskSize(shape, w / h), w, h)
      expect(px.width).toBeCloseTo(px.height, 6)
      // Half the picture's shorter side across.
      expect(px.width).toBeCloseTo(Math.min(w, h) / 2, 6)
    }
  })

  it('leaves the split line and the filmstrip at 50 and 50', () => {
    expect(defaultMaskSize('linear', 9 / 16)).toEqual({ width: 50, height: 50 })
    expect(defaultMaskSize('mirror', 16 / 9)).toEqual({ width: 50, height: 50 })
  })

  const portraitState = () => {
    const clip = createMockClip({ id: 'clip-1', asset: { width: 1080, height: 1920 } as never })
    const timeline = createMockTimeline([clip])
    return createInitialEditorState({ assets: [], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
  }

  it('gives a mask added to a portrait clip a circle that is round', () => {
    const state = addClipMask(portraitState(), 'clip-1', 'ellipse')
    const mask = getClipMasks(selectClipById(state, 'clip-1')!)[0]
    expect(mask.width).toBe(50)
    expect(mask.height).toBeCloseTo(28.125, 6)
    expect((mask.width / 100) * 1080).toBeCloseTo((mask.height / 100) * 1920, 6)
  })

  it('resizes to the new shape when a mask changes shape, and keeps its place and softness', () => {
    let state = addClipMask(portraitState(), 'clip-1', 'linear')
    const id = getClipMasks(selectClipById(state, 'clip-1')!)[0].id!
    state = updateClipMask(state, 'clip-1', id, { x: 30, y: 70, rotation: 20, feather: 15 })

    state = setClipMaskShape(state, 'clip-1', id, 'heart')
    const heart = getClipMasks(selectClipById(state, 'clip-1')!)[0]
    expect(heart).toMatchObject({ shape: 'heart', x: 30, y: 70, rotation: 20, feather: 15, width: 50 })
    expect(heart.height).toBeCloseTo(28.125, 6)

    // Picking the shape it already has does not undo a size the user set.
    state = updateClipMask(state, 'clip-1', id, { width: 80 })
    state = setClipMaskShape(state, 'clip-1', id, 'heart')
    expect(getClipMasks(selectClipById(state, 'clip-1')!)[0].width).toBe(80)
  })

  it('falls back to the timeline frame when the clip has no picture size', () => {
    const state = addClipMask(makeTestState(), 'clip-1', 'rectangle')
    const mask = getClipMasks(selectClipById(state, 'clip-1')!)[0]
    const frame = getEffectiveTimelineDimensions(selectActiveTimeline(state))
    // Square on a frame of the timeline's shape.
    expect((mask.width / 100) * frame.width).toBeCloseTo((mask.height / 100) * frame.height, 6)
  })
})
