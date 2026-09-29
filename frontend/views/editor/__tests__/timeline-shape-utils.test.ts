import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIP_TRANSFORM, timelineClipSchema, type TimelineClip } from '../../../types/project-model'
import { shapeBoxAspect, timelineShapeToDataUrl, timelineShapeToSvgString } from '../timeline-shape-utils'

function shapeClip(shape: string, transform: Partial<TimelineClip['transform']> = {}, props: Record<string, unknown> = {}): TimelineClip {
  return timelineClipSchema.parse({
    id: 'shape-1', assetId: null, type: 'image', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0,
    trackIndex: 1, asset: null, stickerId: `shape-${shape}`,
    transform: { ...DEFAULT_CLIP_TRANSFORM, ...transform },
    shapeProperties: { fillColor: '#999999', cornerRounding: 40, ...props },
  })
}

/** Numbers out of the root <svg> and the <rect> of a rendered rectangle shape. */
function parseRect(svg: string) {
  const num = (re: RegExp) => Number(re.exec(svg)![1])
  const [, , vbW, vbH] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number)
  return {
    width: num(/<svg[^>]* width="([\d.]+)"/),
    height: num(/<svg[^>]* height="([\d.]+)"/),
    vbW, vbH,
    rx: num(/<rect[^>]* rx="([\d.]+)"/),
    ry: num(/<rect[^>]* ry="([\d.]+)"/),
  }
}

/**
 * The corner radii as they finally appear on screen: the square image maps the viewBox
 * into itself, then the clip's scaleX / scaleY stretch that square.
 */
function onScreenRadii(svg: string, scaleX: number, scaleY: number) {
  const r = parseRect(svg)
  return {
    x: r.rx * (r.width / r.vbW) * (scaleX / 100),
    y: r.ry * (r.height / r.vbH) * (scaleY / 100),
  }
}

describe('rectangle shapes keep round corners at any aspect', () => {
  it.each([
    [100, 100],
    [200, 100],
    [100, 250],
    [37, 180],
  ])('scaleX %s / scaleY %s', (scaleX, scaleY) => {
    const svg = timelineShapeToSvgString(shapeClip('rounded-rect', { scaleX, scaleY }), 512, 512)
    const { width, height } = parseRect(svg)
    // Still a square image — every pipeline fits it as one.
    expect([width, height]).toEqual([512, 512])
    const radii = onScreenRadii(svg, scaleX, scaleY)
    // Within the rounding of the aspect (kept coarse so a drag does not regenerate the image).
    expect(Math.abs(radii.x / radii.y - 1)).toBeLessThan(0.005)
  })

  it('keeps the long side at full resolution', () => {
    expect(parseRect(timelineShapeToSvgString(shapeClip('square', { scaleX: 300, scaleY: 100 }), 512, 512)))
      .toMatchObject({ vbW: 512, vbH: 170.67 })
    expect(parseRect(timelineShapeToSvgString(shapeClip('square', { scaleX: 100, scaleY: 400 }), 512, 512)))
      .toMatchObject({ vbW: 128, vbH: 512 })
  })

  it('falls back to the uniform scale when there is no per-axis scale', () => {
    expect(shapeBoxAspect({ ...DEFAULT_CLIP_TRANSFORM, scale: 180 })).toBe(1)
    expect(shapeBoxAspect({ ...DEFAULT_CLIP_TRANSFORM, scaleX: 150, scaleY: 50 })).toBe(3)
    expect(shapeBoxAspect(undefined)).toBe(1)
  })

  it('draws for a dragged transform when given one', () => {
    const clip = shapeClip('rounded-rect', { scaleX: 100, scaleY: 100 })
    const dragged = { ...clip.transform, scaleX: 200, scaleY: 100 }
    expect(timelineShapeToDataUrl(clip, dragged)).toBe(timelineShapeToDataUrl({ ...clip, transform: dragged }))
    expect(timelineShapeToDataUrl(clip, dragged)).not.toBe(timelineShapeToDataUrl(clip))
  })

  it('gives the same image for a move or a rotation, so a drag does not reload it', () => {
    const clip = shapeClip('rounded-rect', { scaleX: 160, scaleY: 90 })
    const moved = { ...clip.transform, positionX: 20, positionY: -10, rotation: 33 }
    expect(timelineShapeToDataUrl(clip, moved)).toBe(timelineShapeToDataUrl(clip))
    // A corner drag scales both axes together: same aspect, same image.
    const cornerScaled = { ...clip.transform, scaleX: 320, scaleY: 180 }
    expect(timelineShapeToDataUrl(clip, cornerScaled)).toBe(timelineShapeToDataUrl(clip))
  })
})

/**
 * Each rounded corner of a polygon is a quadratic curve: start, vertex (control), end.
 * On screen — viewBox mapped into the square image, the square stretched by scaleX /
 * scaleY — a symmetric corner has both tangent legs the same length.
 */
function cornerLegRatios(svg: string, scaleX: number, scaleY: number): number[] {
  const [, , vbW, vbH] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number)
  const width = Number(/<svg[^>]* width="([\d.]+)"/.exec(svg)![1])
  const height = Number(/<svg[^>]* height="([\d.]+)"/.exec(svg)![1])
  const kx = (width / vbW) * (scaleX / 100)
  const ky = (height / vbH) * (scaleY / 100)
  const d = /<path d="([^"]+)"/.exec(svg)![1]
  const nums = (t: string) => t.trim().split(/[\s,]+/).map(Number)
  const ratios: number[] = []
  let pen: number[] | null = null
  for (const seg of d.match(/[MLQ][^MLQZ]*/g) ?? []) {
    const v = nums(seg.slice(1))
    if (seg[0] === 'Q' && pen) {
      const leg = (a: number[], b: number[]) => Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)
      ratios.push(leg(pen, [v[0], v[1]]) / leg([v[0], v[1]], [v[2], v[3]]))
      pen = [v[2], v[3]]
    } else {
      pen = [v[v.length - 2], v[v.length - 1]]
    }
  }
  return ratios
}

describe('polygons keep symmetric rounded corners at any aspect', () => {
  it.each([
    ['triangle', 3],
    ['pentagon', 5],
    ['hexagon', 6],
    ['octagon', 8],
    ['polygon', 7],
  ])('%s', (shape, sides) => {
    for (const [scaleX, scaleY] of [[100, 100], [300, 100], [80, 240]]) {
      const svg = timelineShapeToSvgString(shapeClip(shape, { scaleX, scaleY }, { sides, cornerRounding: 60 }), 512, 512)
      const ratios = cornerLegRatios(svg, scaleX, scaleY)
      expect(ratios).toHaveLength(sides)
      for (const ratio of ratios) expect(Math.abs(ratio - 1)).toBeLessThan(0.005)
    }
  })

  it('draws a sharp polygon when there is no rounding', () => {
    const svg = timelineShapeToSvgString(shapeClip('hexagon', { scaleX: 300, scaleY: 100 }, { sides: 6, cornerRounding: 0 }))
    expect(svg).not.toContain('Q')
  })

  it('keeps the stroke even: one polygon unit is a hundredth of the long side', () => {
    const svg = timelineShapeToSvgString(
      shapeClip('triangle', { scaleX: 300, scaleY: 100 }, { sides: 3, strokeColor: '#fff', strokeWidth: 3, strokeDasharray: '4 2' }),
      512, 512,
    )
    expect(svg).toContain('stroke-width="15.36"')
    expect(svg).toContain('stroke-dasharray="20.48 10.24"')
  })

  it('stands a diamond on its vertex and rounds it when asked', () => {
    const sharp = timelineShapeToSvgString(shapeClip('diamond', {}, { cornerRounding: 0 }), 100, 100)
    expect(/<path d="([^"]+)"/.exec(sharp)![1]).toBe('M 50.00,1.00 L 99.00,50.00 L 50.00,99.00 L 1.00,50.00 Z')
    const rounded = timelineShapeToSvgString(shapeClip('diamond', { scaleX: 200, scaleY: 100 }, { cornerRounding: 50 }), 512, 512)
    const ratios = cornerLegRatios(rounded, 200, 100)
    expect(ratios).toHaveLength(4)
    for (const ratio of ratios) expect(Math.abs(ratio - 1)).toBeLessThan(0.005)
  })
})

describe('shapes that are not polygons are drawn as themselves', () => {
  it.each(['circle', 'star', 'heart', 'triangle-down', 'line-solid', 'arrow-right'])('%s', shape => {
    // Even with a side count stored on the clip, as the properties panel used to write.
    const svg = timelineShapeToSvgString(shapeClip(shape, {}, { sides: 4, cornerRounding: 0 }))
    // Not the square a four-sided polygon would draw.
    expect(svg).not.toContain('M 99.00,1.00 L 99.00,99.00 L 1.00,99.00 L 1.00,1.00 Z')
    expect(svg).not.toMatch(/<svg[^>]*viewBox="0 0 512 /)
  })

  it('draws a circle as a circle', () => {
    expect(timelineShapeToSvgString(shapeClip('circle'))).toMatch(/<(circle|ellipse)/)
  })

  it.each(['circle', 'star', 'line-solid'])('%s ignores the box aspect', shape => {
    const clip = shapeClip(shape)
    expect(timelineShapeToSvgString({ ...clip, transform: { ...clip.transform, scaleX: 300, scaleY: 100 } }))
      .toBe(timelineShapeToSvgString(clip))
  })
})
