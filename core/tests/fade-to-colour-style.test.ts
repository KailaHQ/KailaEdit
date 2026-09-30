import { describe, expect, it } from 'vitest'
import { getClipEffectStyles } from '../src/video-editor-utils'
import { createMockClip } from './edit-patch-test-helpers'

const clip = createMockClip({
  id: 'c1',
  duration: 10,
  transitionIn: { type: 'fade-to-black', duration: 2 },
  transitionOut: { type: 'fade-to-white', duration: 2 },
})

describe('fade to black / white as an overlay', () => {
  it('ramps the picture itself by default, as the parity test relies on', () => {
    expect(getClipEffectStyles(clip, 1).opacity).toBeCloseTo(0.5, 3)
    expect(getClipEffectStyles(clip, 9).opacity).toBeCloseTo(0.5, 3)
  })

  it('leaves the picture opaque when the monitor draws the fade as an overlay, so the ramp is applied once', () => {
    // Both the picture at α and a colour overlay at 1-α would give α² of the light.
    expect(getClipEffectStyles(clip, 1, { fadeToColourAsOverlay: true }).opacity ?? 1).toBe(1)
    expect(getClipEffectStyles(clip, 9, { fadeToColourAsOverlay: true }).opacity ?? 1).toBe(1)
  })

  it('keeps the clip\'s own opacity when the fade is left to the overlay', () => {
    const dimmed = createMockClip({ id: 'c2', duration: 10, opacity: 60, transitionIn: { type: 'fade-to-black', duration: 2 } })
    expect(getClipEffectStyles(dimmed, 1, { fadeToColourAsOverlay: true }).opacity).toBeCloseTo(0.6, 3)
  })
})
