import { describe, expect, it } from 'vitest'
import type { TimelineClip, Track } from '../../../../types/project-model'
import {
  buildFrameRenderCache,
  clipCoversFrame,
  deriveFrameRenderState,
  getCompositingStack,
} from '../preview-frame-engine'

/**
 * From the top down, each layer hides the ones under it. A layer that fills the whole frame, and
 * is opaque, leaves nothing under it worth drawing: three clips starting at one instant, each
 * filling the frame, must never show more than the topmost.
 */

const FRAME = 1080 / 1920 // the project's frame, 9:16

interface ClipOptions {
  type?: 'video' | 'image'
  size?: [number, number]
  path?: string
  extra?: Record<string, unknown>
}

const clip = (id: string, trackIndex: number, startTime: number, duration: number, options: ClipOptions = {}): TimelineClip => {
  const { type = 'video', size = [1080, 1920], path = `C:/media/${id}.mp4`, extra = {} } = options
  return {
    id,
    type,
    trackIndex,
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    volume: 1,
    opacity: 100,
    blendMode: 'normal',
    transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
    assetId: `asset-${id}`,
    asset: { id: `asset-${id}`, type, path, width: size[0], height: size[1], rotationChecked: true, prompt: '', resolution: '', createdAt: 0 },
    ...extra,
  } as unknown as TimelineClip
}

describe('clipCoversFrame', () => {
  it('is true for a clip the shape of the frame, opaque and unscaled', () => {
    expect(clipCoversFrame(clip('a', 6, 0, 10), FRAME, 1)).toBe(true)
  })

  it('is false while the frame\'s shape is not known', () => {
    expect(clipCoversFrame(clip('a', 6, 0, 10), undefined, 1)).toBe(false)
  })

  it('allows the small mismatch of a still cropped a few pixels off the frame\'s shape', () => {
    const almost = clip('a', 4, 0, 10, { type: 'image', size: [1184, 2096], path: 'C:/media/photo.jpg' })
    expect(clipCoversFrame(almost, FRAME, 1)).toBe(true)
  })

  it.each([
    ['partly transparent', { opacity: 80 }],
    ['blended', { blendMode: 'multiply' }],
    ['masked', { mask: { enabled: true, shape: 'circle' } }],
    ['keyed', { chromaKey: { enabled: true } }],
    ['cut out', { autoMatte: { enabled: true } }],
    ['rotated', { transform: { scale: 100, positionX: 0, positionY: 0, rotation: 5, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 } }],
    ['cropped', { transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 10, cropRight: 0, cropBottom: 0, cropLeft: 0 } }],
    ['moved', { transform: { scale: 100, positionX: 20, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 } }],
    ['shrunk', { transform: { scale: 90, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 } }],
  ])('is false for a clip that is %s', (_name, extra) => {
    expect(clipCoversFrame(clip('a', 6, 0, 10, { extra }), FRAME, 1)).toBe(false)
  })

  it('is true for a clip that is scaled up', () => {
    const bigger = clip('a', 6, 0, 10, { extra: { transform: { scale: 120, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 } } })
    expect(clipCoversFrame(bigger, FRAME, 1)).toBe(true)
  })

  it('is false for a wide clip in a tall frame until it is scaled past its bars', () => {
    const wide = (scale: number) => clip('a', 6, 0, 10, {
      size: [1920, 1080],
      extra: { transform: { scale, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 } },
    })
    expect(clipCoversFrame(wide(100), FRAME, 1)).toBe(false)
    expect(clipCoversFrame(wide(200), FRAME, 1)).toBe(false)
    // 16:9 fitted into 9:16 is 31.6% as tall as the frame: it needs 3.16x to fill it.
    expect(clipCoversFrame(wide(330), FRAME, 1)).toBe(true)
  })

  it('judges a keyframed scale where the playhead is', () => {
    const zoom = clip('a', 6, 0, 10, {
      extra: { keyframes: [{ property: 'transform.scale', points: [{ t: 0, value: 80, easing: 'linear' }, { t: 2, value: 100, easing: 'linear' }] }] },
    })
    expect(clipCoversFrame(zoom, FRAME, 0.5)).toBe(false)
    expect(clipCoversFrame(zoom, FRAME, 2.5)).toBe(true)
  })

  it('is false inside a fade to black at either end, and true between them', () => {
    const faded = clip('a', 6, 0, 10, {
      extra: { transitionIn: { type: 'fade-to-black', duration: 1 }, transitionOut: { type: 'fade-to-black', duration: 1 } },
    })
    expect(clipCoversFrame(faded, FRAME, 0.5)).toBe(false)
    expect(clipCoversFrame(faded, FRAME, 5)).toBe(true)
    expect(clipCoversFrame(faded, FRAME, 9.5)).toBe(false)
  })

  it('is false for a still that may carry transparency, true for one that cannot', () => {
    expect(clipCoversFrame(clip('a', 4, 0, 10, { type: 'image', path: 'C:/media/cutout.png' }), FRAME, 1)).toBe(false)
    expect(clipCoversFrame(clip('a', 4, 0, 10, { type: 'image', path: 'C:/media/photo.JPG' }), FRAME, 1)).toBe(true)
  })

  it('is false for a size nobody measured', () => {
    expect(clipCoversFrame(clip('a', 6, 0, 10, { size: [0, 0] }), FRAME, 1)).toBe(false)
    const unchecked = clip('a', 6, 0, 10)
    ;(unchecked.asset as { rotationChecked?: boolean }).rotationChecked = undefined
    expect(clipCoversFrame(unchecked, FRAME, 1)).toBe(false)
  })
})

describe('the layers drawn under the active clip', () => {
  const tracks = [] as Track[]
  // The project's boundary: a main-track clip, an image and a video overlay all start together.
  const main = clip('main', 0, 11.786, 5.6)
  const image = clip('image', 4, 11.786, 9.35, { type: 'image', size: [1184, 2096], path: 'C:/media/cutout.png' })
  const top = clip('top', 6, 11.786, 53)
  const all = [main, image, top]
  const ids = (clips: TimelineClip[]) => clips.map(c => c.id)

  it('draws nothing under a top clip that fills the frame, however many clips start with it', () => {
    expect(getCompositingStack(all, tracks, top, 11.8, { frameAspect: FRAME })).toEqual([])
  })

  it('does so from the first instant the clips start', () => {
    expect(getCompositingStack(all, tracks, top, 11.786, { frameAspect: FRAME })).toEqual([])
  })

  it('draws the layers under a top clip that leaves part of the frame open, down to the first that fills it', () => {
    const smaller = clip('top', 6, 11.786, 53, { extra: { opacity: 60 } })
    const stack = getCompositingStack([main, image, smaller], tracks, smaller, 11.8, { frameAspect: FRAME })
    // The cut-out image may be see-through, so the main clip is wanted too; it is the lowest.
    expect(ids(stack)).toEqual(['main', 'image'])
  })

  it('stops at a middle layer that fills the frame', () => {
    const fading = clip('top', 6, 11.786, 53, { extra: { opacity: 60 } })
    const middle = clip('middle', 4, 11.786, 9.35)
    const stack = getCompositingStack([main, middle, fading], tracks, fading, 11.8, { frameAspect: FRAME })
    expect(ids(stack)).toEqual(['middle'])
  })

  it('lists the layers lowest first, so that higher tracks are drawn over lower ones', () => {
    const fading = clip('top', 6, 11.786, 53, { extra: { opacity: 60 } })
    const a = clip('a', 2, 11.786, 5, { extra: { opacity: 50 } })
    const b = clip('b', 4, 11.786, 5, { extra: { opacity: 50 } })
    const stack = getCompositingStack([main, a, b, fading], tracks, fading, 11.8, { frameAspect: FRAME })
    expect(ids(stack)).toEqual(['main', 'a', 'b'])
  })

  it('draws what is under the active clip while it is part of a transition', () => {
    const stack = getCompositingStack(all, tracks, top, 11.8, { frameAspect: FRAME, inTransition: true })
    expect(ids(stack)).toEqual(['main', 'image'])
  })

  it('skips layers on a disabled track', () => {
    const fading = clip('top', 6, 11.786, 53, { extra: { opacity: 60 } })
    const disabled = [] as Track[]
    disabled[4] = { id: 't4', enabled: false } as unknown as Track
    const stack = getCompositingStack([main, image, fading], disabled, fading, 11.8, { frameAspect: FRAME })
    expect(ids(stack)).toEqual(['main'])
  })

  it('keeps the old rule when the frame\'s shape is not known: an overlay track always counts as see-through', () => {
    expect(ids(getCompositingStack(all, tracks, top, 11.8))).toEqual(['main', 'image'])
    expect(getCompositingStack([main], tracks, main, 11.8)).toEqual([])
  })
})

describe('the frame at the boundary where three clips begin', () => {
  const main = clip('main', 0, 11.786, 5.6)
  const image = clip('image', 4, 11.786, 9.35, { type: 'image', size: [1184, 2096], path: 'C:/media/cutout.png' })
  const top = clip('top', 6, 11.786, 53)
  const cache = buildFrameRenderCache([main, image, top], [], [], FRAME)

  it('shows only the top clip at the instant they start and just after', () => {
    for (const time of [11.786, 11.79, 11.8, 12, 15]) {
      const frame = deriveFrameRenderState(cache, [], time)
      expect(frame.activeClip?.id).toBe('top')
      expect(frame.compositingStack).toEqual([])
      expect(frame.activeVideoContributors.map(c => c.clip.id)).toEqual(['top'])
    }
  })

  it('shows the clips under it again once it ends', () => {
    const shorter = clip('top', 6, 11.786, 3)
    const ended = deriveFrameRenderState(buildFrameRenderCache([main, image, shorter], [], [], FRAME), [], 15)
    expect(ended.activeClip?.id).toBe('image')
  })
})

describe('a transition on the main track under a clip that fills the frame', () => {
  // The project's: wipe between two main-track clips at 20.2–20.7 s, a full-frame video above.
  const outgoing = clip('outgoing', 0, 17.4, 3.3)
  const incoming = clip('incoming', 0, 20.2, 3.1)
  const transitions = [{ id: 't', trackIndex: 0, leftClipId: 'outgoing', rightClipId: 'incoming', type: 'wipe-right', duration: 0.5 }] as never
  const during = 20.45

  it('is not drawn at all', () => {
    const overlay = clip('overlay', 6, 11.786, 53)
    const frame = deriveFrameRenderState(buildFrameRenderCache([outgoing, incoming, overlay], [], transitions, FRAME), [], during)
    expect(frame.crossDissolve).toBeNull()
    expect(frame.activeClip?.id).toBe('overlay')
    expect(frame.compositingStack).toEqual([])
    expect(frame.activeVideoContributors.map(c => c.clip.id)).toEqual(['overlay'])
  })

  it('is still drawn when nothing above it fills the frame', () => {
    const frame = deriveFrameRenderState(buildFrameRenderCache([outgoing, incoming], [], transitions, FRAME), [], during)
    expect(frame.crossDissolve?.outgoing.id).toBe('outgoing')
    expect(frame.crossDissolve?.incoming.id).toBe('incoming')
  })

  it('is still drawn under a clip above it that leaves part of the frame open', () => {
    const fading = clip('overlay', 6, 11.786, 53, { extra: { opacity: 60 } })
    const frame = deriveFrameRenderState(buildFrameRenderCache([outgoing, incoming, fading], [], transitions, FRAME), [], during)
    expect(frame.crossDissolve?.outgoing.id).toBe('outgoing')
  })

  it('is drawn again once the clip above it ends', () => {
    const overlay = clip('overlay', 6, 11.786, 8)
    const frame = deriveFrameRenderState(buildFrameRenderCache([outgoing, incoming, overlay], [], transitions, FRAME), [], during)
    expect(frame.crossDissolve?.outgoing.id).toBe('outgoing')
  })
})
