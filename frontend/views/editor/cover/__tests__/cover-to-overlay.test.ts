import { describe, expect, it, vi } from 'vitest'
import {
  COVER_TEXT_REFERENCE_HEIGHT,
  TIMELINE_TEXT_REFERENCE_HEIGHT,
  coverElementsToOverlays,
  coverTextToOverlay,
} from '../cover-to-overlay'
import type { CoverElement, ShapeCoverElement, TextCoverElement } from '../types'

const text = (overrides: Partial<TextCoverElement> = {}): TextCoverElement => ({
  id: 't', type: 'text', name: 'Title', text: 'weekend vibes', fontFamily: 'Inter, sans-serif', fontSize: 40,
  fontWeight: 700, color: '#ffeeaa', textAlign: 'center', x: 50, y: 25, width: 70, height: 12,
  rotation: 8, opacity: 0.5, zIndex: 3, ...overrides,
})
const shape: ShapeCoverElement = {
  id: 's', type: 'shape', name: 'Circle', shapeType: 'circle', fillColor: '#00ff00', x: 20, y: 80,
  width: 30, height: 15, rotation: 0, opacity: 1, zIndex: 2,
}
const background: CoverElement = {
  id: 'background-layer', type: 'image', name: 'Video Frame', src: 'data:image/png;base64,AA', x: 50, y: 50,
  width: 100, height: 100, rotation: 0, opacity: 1, zIndex: 1,
}

describe('coverTextToOverlay', () => {
  it('keeps the text where and as large as the cover showed it, in timeline units', () => {
    const item = coverTextToOverlay(text({ textTransform: 'uppercase' }))
    expect(item.kind).toBe('text')
    if (item.kind !== 'text') return
    expect(item.textStyle.text).toBe('WEEKEND VIBES')
    expect(item.textStyle.positionX).toBe(50)
    expect(item.textStyle.positionY).toBe(25)
    expect(item.textStyle.maxWidth).toBe(70)
    // Same share of the frame's height: 40px of a 604px canvas is ~72px of 1080.
    expect(item.textStyle.fontSize).toBe(Math.round(40 * TIMELINE_TEXT_REFERENCE_HEIGHT / COVER_TEXT_REFERENCE_HEIGHT))
    expect(item.textStyle.fontWeight).toBe('700')
    expect(item.textStyle.opacity).toBe(50)
    expect(item.rotation).toBe(8)
  })

  it('carries a badge as the text background', () => {
    const item = coverTextToOverlay(text({ backgroundBadge: { enabled: true, color: '#112233', paddingX: 10, paddingY: 4, borderRadius: 6 } }))
    if (item.kind !== 'text') throw new Error('expected text')
    expect(item.textStyle.backgroundColor).toBe('#112233')
    expect(item.textStyle.padding).toBeGreaterThan(0)
  })
})

describe('coverElementsToOverlays', () => {
  it('leaves the video frame out and lists the rest lowest first', async () => {
    const materialize = vi.fn()
    const items = await coverElementsToOverlays([text(), background, shape], materialize)
    expect(items.map(i => i.kind)).toEqual(['shape', 'text'])
    expect(materialize).not.toHaveBeenCalled()
  })
})
