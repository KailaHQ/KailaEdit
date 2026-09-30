import { describe, expect, it } from 'vitest'
import { buildVideoFilterGraph } from '../video-filter'
import type { ExportClip } from '../timeline'
import { effectiveTimelineBackground } from '../../../core/src/project-model'

const image: ExportClip = {
  path: 'photo.jpg', type: 'image', startTime: 0, duration: 3, trimStart: 0, speed: 1, reversed: false,
  flipH: false, flipV: false, opacity: 100, trackIndex: 0, muted: true, volume: 1,
}

describe('a picture that does not fill the frame', () => {
  it('is drawn on the plain canvas: a project that still asks for a blurred background gets none', () => {
    const { filterScript } = buildVideoFilterGraph([image], {
      width: 1080, height: 1920, fps: 30, totalDuration: 3, background: { type: 'blur', blur: 60 },
    })
    expect(filterScript).not.toContain('boxblur')
  })

  it('reads a blur background as the default colour', () => {
    expect(effectiveTimelineBackground({ type: 'blur', blur: 40 })).toEqual({ type: 'color', color: '#000000' })
    expect(effectiveTimelineBackground({ type: 'color', color: '#ff0000' })).toEqual({ type: 'color', color: '#ff0000' })
    expect(effectiveTimelineBackground(undefined)).toBeUndefined()
  })
})
