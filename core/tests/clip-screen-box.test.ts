import { describe, it, expect } from 'vitest'
import { clipScreenBox, fitMediaInFrame } from '../src/video-editor-utils'

/**
 * The rectangle a clip occupies on screen.
 *
 * Two things read it: the transform bounding box the user drags, and the hit
 * test that decides which clip a click on the preview selected. They have to
 * agree, or the handles appear somewhere the click does not reach.
 */

const frame = { width: 400, height: 300 } // 4:3 preview area

describe('fitMediaInFrame', () => {
  it('fills the width when the media is wider than the frame', () => {
    // 16:9 media in a 4:3 frame touches the left and right edges.
    expect(fitMediaInFrame(frame, { width: 1920, height: 1080 })).toEqual({ width: 400, height: 225 })
  })

  it('fills the height when the media is taller than the frame', () => {
    // 9:16 media in a 4:3 frame touches the top and bottom edges.
    const fitted = fitMediaInFrame(frame, { width: 1080, height: 1920 })
    expect(fitted.height).toBe(300)
    expect(fitted.width).toBeCloseTo(168.75, 2)
  })

  it('falls back to the frame when the asset has no dimensions', () => {
    expect(fitMediaInFrame(frame, undefined)).toEqual({ width: 400, height: 300 })
    expect(fitMediaInFrame(frame, {})).toEqual({ width: 400, height: 300 })
  })
})

describe('clipScreenBox', () => {
  it('centres an untransformed clip in the frame', () => {
    const box = clipScreenBox(frame, { width: 1920, height: 1080 }, { scale: 100, positionX: 0, positionY: 0 })

    expect(box.width).toBe(400)
    expect(box.height).toBe(225)
    expect(box.left).toBe(0)
    expect(box.top).toBeCloseTo(37.5, 2)
  })

  it('shrinks around the centre as the scale drops', () => {
    const box = clipScreenBox(frame, { width: 512, height: 512 }, { scale: 50, positionX: 0, positionY: 0 })

    // A square in a 4:3 frame fits to the height: 300, halved to 150.
    expect(box.width).toBeCloseTo(150, 2)
    expect(box.height).toBeCloseTo(150, 2)
    expect(box.left).toBeCloseTo(125, 2)
    expect(box.top).toBeCloseTo(75, 2)
  })

  it('reads position as a percentage of the frame, from the centre', () => {
    const centred = clipScreenBox(frame, { width: 512, height: 512 }, { scale: 50 })
    const moved = clipScreenBox(frame, { width: 512, height: 512 }, { scale: 50, positionX: 25, positionY: -10 })

    expect(moved.left - centred.left).toBeCloseTo(100, 2)  // 25% of 400
    expect(moved.top - centred.top).toBeCloseTo(-30, 2)    // -10% of 300
  })

  it('describes a sticker small enough to sit inside the frame', () => {
    // The default a new sticker gets: roughly 50px on the short edge.
    const box = clipScreenBox(frame, { width: 512, height: 512 }, { scale: (50 / 300) * 100 })

    expect(box.width).toBeCloseTo(50, 1)
    expect(box.height).toBeCloseTo(50, 1)
    expect(box.left).toBeGreaterThan(0)
    expect(box.top).toBeGreaterThan(0)
    expect(box.left + box.width).toBeLessThan(frame.width)
  })

  it('treats a missing transform as untransformed', () => {
    expect(clipScreenBox(frame, { width: 1920, height: 1080 }, undefined))
      .toEqual(clipScreenBox(frame, { width: 1920, height: 1080 }, { scale: 100 }))
  })
})

describe('the box the user grabs', () => {
  it('is sized by the scale rather than drawn full size and shrunk', () => {
    // The bounding box takes its width and height from clipScreenBox instead
    // of rendering at the fitted size under a CSS scale(). A CSS scale would
    // thin the outline and shrink the grab handles along with the box, so a
    // small sticker ended up with a hairline border nobody could hit.
    const fitted = fitMediaInFrame(frame, { width: 512, height: 512 })
    const small = clipScreenBox(frame, { width: 512, height: 512 }, { scale: 10 })
    const large = clipScreenBox(frame, { width: 512, height: 512 }, { scale: 90 })

    expect(small.width).toBeCloseTo(fitted.width * 0.1, 4)
    expect(large.width).toBeCloseTo(fitted.width * 0.9, 4)
  })

  it('supports independent scaleX and scaleY for shapes', () => {
    const fitted = fitMediaInFrame(frame, { width: 512, height: 512 })
    const box = clipScreenBox(frame, { width: 512, height: 512 }, { scaleX: 60, scaleY: 20 })

    expect(box.width).toBeCloseTo(fitted.width * 0.6, 4)
    expect(box.height).toBeCloseTo(fitted.height * 0.2, 4)
  })
})

