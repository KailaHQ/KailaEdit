import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { buildMaskChain } from '../video-filter'
import { DEFAULT_CLIP_MASK, type ClipMask } from '../../../core/src/project-model'

/**
 * The export cuts masks with an ffmpeg `geq` expression. These tests run the real thing on a
 * white 100x100 picture and read back which pixels survive, so an expression ffmpeg cannot parse,
 * or a shape drawn in the wrong place, fails here rather than after an export has started.
 */

const SIZE = 100

/** The alpha of every pixel after the masks, 0 or 255, row by row. */
function alphaAfter(masks: ClipMask | ClipMask[], width = SIZE): Uint8Array {
  const chain = buildMaskChain(masks)
  expect(chain).not.toBe('')
  const run = spawnSync(
    ffmpegPath as string,
    [
      '-v', 'error',
      '-f', 'lavfi', '-i', `color=c=white:s=${width}x${SIZE}:d=0.04:r=25,format=yuva420p${chain},format=rgba,alphaextract,format=gray`,
      '-frames:v', '1', '-f', 'rawvideo', '-',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  expect(run.stderr.toString()).toBe('')
  expect(run.status).toBe(0)
  return new Uint8Array(run.stdout)
}

const shows = (alpha: Uint8Array, x: number, y: number, width = SIZE) => alpha[y * width + x] > 127
const mask = (patch: Partial<ClipMask>): ClipMask => ({ ...DEFAULT_CLIP_MASK, width: 60, height: 60, ...patch })

describe('export mask chain', () => {
  it('cuts a rectangle', () => {
    const alpha = alphaAfter(mask({ shape: 'rectangle' }))
    expect(shows(alpha, 50, 50)).toBe(true)
    expect(shows(alpha, 25, 25)).toBe(true)
    expect(shows(alpha, 10, 10)).toBe(false)
    expect(shows(alpha, 90, 50)).toBe(false)
  })

  it('rounds the rectangle\'s corners', () => {
    const square = alphaAfter(mask({ shape: 'rectangle', roundCorners: 0 }))
    const round = alphaAfter(mask({ shape: 'rectangle', roundCorners: 100 }))
    // The corner of the box (just inside it) shows when square and not when fully rounded.
    expect(shows(square, 22, 22)).toBe(true)
    expect(shows(round, 22, 22)).toBe(false)
    expect(shows(round, 50, 50)).toBe(true)
    expect(shows(round, 50, 22)).toBe(true)
  })

  it('cuts a circle', () => {
    const alpha = alphaAfter(mask({ shape: 'ellipse' }))
    expect(shows(alpha, 50, 50)).toBe(true)
    expect(shows(alpha, 22, 50)).toBe(true)
    expect(shows(alpha, 22, 22)).toBe(false)
  })

  it('keeps one side of the split line', () => {
    const alpha = alphaAfter(mask({ shape: 'linear' }))
    expect(shows(alpha, 50, 80)).toBe(true)
    expect(shows(alpha, 50, 20)).toBe(false)
  })

  it('keeps a band across the picture for the filmstrip', () => {
    const alpha = alphaAfter(mask({ shape: 'mirror', height: 30 }))
    expect(shows(alpha, 50, 50)).toBe(true)
    expect(shows(alpha, 3, 50)).toBe(true)
    expect(shows(alpha, 96, 50)).toBe(true)
    expect(shows(alpha, 50, 20)).toBe(false)
    expect(shows(alpha, 50, 80)).toBe(false)
  })

  it('cuts a star with a point straight up and notches between the points', () => {
    const alpha = alphaAfter(mask({ shape: 'star', width: 80, height: 80 }))
    expect(shows(alpha, 50, 50)).toBe(true)
    // Near the top tip: inside, while the corner of the box above the shoulders is outside.
    expect(shows(alpha, 50, 14)).toBe(true)
    expect(shows(alpha, 20, 14)).toBe(false)
    expect(shows(alpha, 80, 14)).toBe(false)
    // The notch between the top and upper-right points is outside, just beside the centre line.
    expect(shows(alpha, 62, 24)).toBe(false)
  })

  it('cuts a heart: lobes up, point down, a dip between the lobes', () => {
    const alpha = alphaAfter(mask({ shape: 'heart', width: 80, height: 80 }))
    expect(shows(alpha, 50, 50)).toBe(true)
    expect(shows(alpha, 32, 20)).toBe(true)
    expect(shows(alpha, 68, 20)).toBe(true)
    expect(shows(alpha, 50, 12)).toBe(false)
    expect(shows(alpha, 50, 88)).toBe(true)
    expect(shows(alpha, 14, 88)).toBe(false)
  })

  it('turns a shape the way it looks on a wide picture instead of shearing it', () => {
    // 200 x 100 picture: a 40 x 40 box (in picture percent that is 50% wide, 100% tall...) is
    // easier to read as a 50% x 50% rectangle, 100 wide and 50 tall, turned a quarter turn.
    const wide = 200
    const flat = alphaAfter(mask({ shape: 'rectangle', width: 50, height: 50 }), wide)
    expect(shows(flat, 100 + 45, 50, wide)).toBe(true)
    expect(shows(flat, 100, 50 + 20, wide)).toBe(true)
    expect(shows(flat, 100, 50 + 30, wide)).toBe(false)

    const upright = alphaAfter(mask({ shape: 'rectangle', width: 50, height: 50, rotation: 90 }), wide)
    // Now 50 px wide and 100 px tall on screen: the old math left it stretched 200 px wide.
    expect(shows(upright, 100 + 20, 50, wide)).toBe(true)
    expect(shows(upright, 100 + 30, 50, wide)).toBe(false)
    expect(shows(upright, 100, 50 + 45, wide)).toBe(true)
  })

  it('inverts', () => {
    const alpha = alphaAfter(mask({ shape: 'ellipse', invert: true }))
    expect(shows(alpha, 50, 50)).toBe(false)
    expect(shows(alpha, 5, 5)).toBe(true)
  })

  it('shows the picture wherever any of several masks covers it', () => {
    const alpha = alphaAfter([
      mask({ shape: 'rectangle', x: 25, y: 50, width: 30, height: 30 }),
      mask({ shape: 'ellipse', x: 75, y: 50, width: 30, height: 30 }),
    ])
    expect(shows(alpha, 25, 50)).toBe(true)
    expect(shows(alpha, 75, 50)).toBe(true)
    expect(shows(alpha, 50, 50)).toBe(false)
    expect(shows(alpha, 25, 5)).toBe(false)
  })

  it('ignores masks that are switched off, and gives nothing when none is left', () => {
    expect(buildMaskChain([{ ...DEFAULT_CLIP_MASK, enabled: false }])).toBe('')
    expect(buildMaskChain([])).toBe('')
    expect(buildMaskChain(undefined)).toBe('')
  })

  it('accepts feathered masks of every shape', () => {
    for (const shape of ['rectangle', 'ellipse', 'linear', 'mirror', 'star', 'heart'] as const) {
      const alpha = alphaAfter(mask({ shape, feather: 40, roundCorners: shape === 'rectangle' ? 50 : 0 }))
      expect(alpha.length).toBe(SIZE * SIZE)
    }
  })
})
