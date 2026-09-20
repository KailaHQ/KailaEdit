import { describe, it, expect } from 'vitest'
import { clipNeedsAlphaCanvas } from '../preview-frame-engine'
import type { TimelineClip } from '../../../../types/project-model'

/**
 * The preview draws a cut-out clip on a WebGL canvas that sits OVER the raw
 * `<video>`/`<img>`. Whatever this returns false for keeps that element visible, and the
 * untouched picture then shows through every hole the shader made.
 *
 * Only chroma key was listed here once, so Remove BG looked like it did nothing: the
 * background came straight back through the cut-out from the video underneath, and the
 * feature only appeared to work over spans the render cache had already baked.
 */
function clip(over: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'c1',
    type: 'video',
    trackIndex: 0,
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 10,
    ...over,
  } as TimelineClip
}

describe('clipNeedsAlphaCanvas', () => {
  it('is false for a plain clip, so the raw element keeps showing the picture', () => {
    expect(clipNeedsAlphaCanvas(clip({}))).toBe(false)
  })

  it('is false for nothing at all', () => {
    expect(clipNeedsAlphaCanvas(null)).toBe(false)
    expect(clipNeedsAlphaCanvas(undefined)).toBe(false)
  })

  it('covers chroma key', () => {
    expect(clipNeedsAlphaCanvas(clip({ chromaKey: { enabled: true } as any }))).toBe(true)
  })

  it('covers auto matte — the Remove BG regression', () => {
    expect(clipNeedsAlphaCanvas(clip({ autoMatte: { enabled: true } as any }))).toBe(true)
  })

  it('leaves a disabled auto matte alone', () => {
    expect(clipNeedsAlphaCanvas(clip({ autoMatte: { enabled: false } as any }))).toBe(false)
  })

  it('covers a custom matte that actually has strokes', () => {
    expect(
      clipNeedsAlphaCanvas(clip({ customMatte: { enabled: true, strokes: [{}] } as any })),
    ).toBe(true)
    expect(
      clipNeedsAlphaCanvas(clip({ customMatte: { enabled: true, strokes: [] } as any })),
    ).toBe(false)
  })

  it('covers a stroke, which is drawn outside the subject and needs the alpha too', () => {
    expect(
      clipNeedsAlphaCanvas(clip({ stroke: { enabled: true, style: 'solid', width: 8 } as any })),
    ).toBe(true)
    expect(
      clipNeedsAlphaCanvas(clip({ stroke: { enabled: true, style: 'none', width: 8 } as any })),
    ).toBe(false)
    expect(
      clipNeedsAlphaCanvas(clip({ stroke: { enabled: true, style: 'solid', width: 0 } as any })),
    ).toBe(false)
  })
})
