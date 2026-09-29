import { describe, expect, it } from 'vitest'
import { clipScreenBox } from '@core/video-editor-utils'
import { DEFAULT_TEXT_STYLE, type TextOverlayStyle } from '../../../../types/project-model'
import { canRasterizeTextClip, layoutTextBox, layoutTextLines, textClipAsImage } from '../text-raster'

/** Every character 10px wide. */
const measure = (s: string) => s.length * 10

describe('layoutTextLines', () => {
  it('wraps at spaces, keeps line breaks, and breaks a word too long for the box', () => {
    expect(layoutTextLines('aa bb cc', measure, 50)).toEqual(['aa bb', 'cc'])
    expect(layoutTextLines('one\n\ntwo', measure, 100)).toEqual(['one', '', 'two'])
    expect(layoutTextLines('abcdefgh', measure, 30)).toEqual(['abc', 'def', 'gh'])
    // Trailing spaces hang instead of starting a new line.
    expect(layoutTextLines('abcd    ef', measure, 40)).toEqual(['abcd', 'ef'])
  })
})

describe('layoutTextBox', () => {
  const frame = { width: 1080, height: 1920 }
  const style = (s: Partial<TextOverlayStyle>): TextOverlayStyle => ({ ...DEFAULT_TEXT_STYLE, ...s })

  it('sizes against the frame height, as the monitor and the export do', () => {
    const box = layoutTextBox(style({ text: 'Hi', fontSize: 54, padding: 10, lineHeight: 1.5 }), frame, measure)
    const unit = 1920 / 1080
    expect(box.fontPx).toBeCloseTo(54 * unit)
    expect(box.padding).toBeCloseTo(10 * unit)
    expect(box.boxHeight).toBeCloseTo(54 * unit * 1.5 + 2 * 10 * unit)
    // Hugs short text…
    expect(box.boxWidth).toBeCloseTo(20 + 2 * 10 * unit)
  })

  it('fills the capped width once the text has to wrap, like max-content under max-width', () => {
    const long = 'word '.repeat(40).trim()
    const box = layoutTextBox(style({ text: long, padding: 0 }), frame, measure)
    expect(box.lines.length).toBeGreaterThan(1)
    expect(box.boxWidth).toBeCloseTo(0.8 * 1080)
  })

  it('keeps a width set narrower than the default even for short text', () => {
    const box = layoutTextBox(style({ text: 'Hi', maxWidth: 50, padding: 0 }), frame, measure)
    expect(box.boxWidth).toBeCloseTo(0.5 * 1080)
  })
})

describe('textClipAsImage', () => {
  const frame = { width: 1080, height: 1920 }
  const exportClip = {
    id: 't', type: 'text', path: '', opacity: 100, startTime: 1, duration: 3,
    transform: { scale: 100, positionX: 0, positionY: 0, rotation: 12, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
    textStyle: { text: 'x' },
    keyframes: [
      { property: 'transform.positionX' as const, points: [{ t: 0, value: -10, easing: 'linear' as const }, { t: 1, value: 0, easing: 'linear' as const }] },
      { property: 'transform.scale' as const, points: [{ t: 0, value: 50, easing: 'linear' as const }, { t: 1, value: 100, easing: 'linear' as const }] },
      { property: 'opacity' as const, points: [{ t: 0, value: 0, easing: 'linear' as const }] },
    ],
  }
  const style = { ...DEFAULT_TEXT_STYLE, positionX: 30, positionY: 80, opacity: 50 }
  const raster = { width: 600, height: 200, centerX: 30, centerY: 80 }

  it('puts the picture exactly over the text box the monitor draws', () => {
    const image = textClipAsImage(exportClip, style, raster, frame, 'C:/tmp/text.png')
    expect(image.type).toBe('image')
    expect(image.path).toBe('C:/tmp/text.png')
    expect(image.textStyle).toBeUndefined()
    const box = clipScreenBox(frame, raster, image.transform)
    expect(box.width).toBeCloseTo(600, 0)
    expect(box.height).toBeCloseTo(200, 0)
    expect(box.left + box.width / 2).toBeCloseTo(0.3 * 1080, 0)
    expect(box.top + box.height / 2).toBeCloseTo(0.8 * 1920, 0)
    expect(image.transform?.rotation).toBe(12)
    expect(image.opacity).toBe(50)
  })

  it('rebases the text animation onto the picture', () => {
    const image = textClipAsImage(exportClip, style, raster, frame, 'p.png')
    const track = (p: string) => image.keyframes?.find(k => k.property === p)?.points.map(pt => pt.value)
    // Position keyframes were offsets from the style position; now absolute from the centre.
    expect(track('transform.positionX')).toEqual([30 - 50 - 10, 30 - 50])
    // Scale keyframes were a factor on the text's size; now a factor on the picture's scale.
    const base = image.transform!.scale
    expect(track('transform.scale')?.[0]).toBeCloseTo(base * 0.5)
    expect(track('transform.scale')?.[1]).toBeCloseTo(base)
    expect(track('opacity')).toEqual([0])
  })

  it('leaves a typewriter reveal to drawtext', () => {
    const typed = { type: 'text', textStyle: DEFAULT_TEXT_STYLE, keyframes: [{ property: 'text.progress' as const, points: [{ t: 0, value: 0, easing: 'linear' as const }] }] }
    expect(canRasterizeTextClip(typed as any)).toBe(false)
    expect(canRasterizeTextClip({ type: 'text', textStyle: DEFAULT_TEXT_STYLE } as any)).toBe(true)
    expect(canRasterizeTextClip({ type: 'image' } as any)).toBe(false)
  })
})
