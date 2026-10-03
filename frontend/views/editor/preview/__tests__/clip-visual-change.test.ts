import { describe, expect, it } from 'vitest'
import { sameClipVisualProperties } from '../preview-frame-engine'
import { DEFAULT_CLIP_MASK, type TimelineClip } from '../../../../types/project-model'

/**
 * The monitor skips a repaint when the clips on screen look the same as before. A mask added or
 * changed did not count as a difference, so the picture stayed as it was until the playhead
 * moved: the mask seemed not to apply, or to apply a step behind.
 */

const clip = (extra: Partial<TimelineClip> = {}) =>
  ({ id: 'c', type: 'video', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0, speed: 1, reversed: false, trackIndex: 0, ...extra }) as unknown as TimelineClip

describe('sameClipVisualProperties and masks', () => {
  it('sees a mask being added, changed or removed', () => {
    const plain = clip()
    const masked = clip({ masks: [{ ...DEFAULT_CLIP_MASK, id: 'm' }] })
    const turned = clip({ masks: [{ ...DEFAULT_CLIP_MASK, id: 'm', rotation: 30 }] })

    expect(sameClipVisualProperties(plain, masked)).toBe(false)
    expect(sameClipVisualProperties(masked, turned)).toBe(false)
    expect(sameClipVisualProperties(turned, plain)).toBe(false)
  })

  it('still treats unrelated edits as no change', () => {
    const masks = [{ ...DEFAULT_CLIP_MASK, id: 'm' }]
    expect(sameClipVisualProperties(clip({ masks }), clip({ masks }))).toBe(true)
  })
})
