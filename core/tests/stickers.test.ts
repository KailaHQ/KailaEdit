import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  STICKER_DEFINITIONS,
  STICKER_CATEGORIES,
  getStickerDefinition,
  isValidStickerId,
  isAnimatedSticker,
  resolveStickerRelativePath,
  DEFAULT_STICKER_DURATION,
  DEFAULT_STICKER_PIXELS,
} from '../src/stickers'
import {
  createInitialEditorState,
  addStickerClip,
  selectActiveTimeline,
  selectClips,
} from '../src'

describe('stickers core definitions', () => {
  it('defines at least 50 stickers across categories', () => {
    expect(STICKER_DEFINITIONS.length).toBeGreaterThanOrEqual(50)
    const categories = new Set(STICKER_DEFINITIONS.map(s => s.category))
    expect(categories.has('emoji')).toBe(true)
    expect(categories.has('badge')).toBe(true)
    expect(categories.has('icon')).toBe(true)
  })

  it('contains expected categories including all, animated, and custom', () => {
    const ids = STICKER_CATEGORIES.map(c => c.id)
    expect(ids).toContain('all')
    expect(ids).toContain('animated')
    expect(ids).toContain('emoji')
    expect(ids).toContain('badge')
    expect(ids).toContain('custom')
  })

  it('retrieves sticker definition by id correctly', () => {
    const star = getStickerDefinition('star')
    expect(star).toBeDefined()
    expect(star?.name).toBe('Gold Star')
    expect(star?.filename).toBe('star.png')
    expect(isValidStickerId('star')).toBe(true)
    expect(isValidStickerId('nonexistent')).toBe(false)
  })

  it('identifies and retrieves animated stickers', () => {
    const animFire = getStickerDefinition('anim-fire')
    expect(animFire).toBeDefined()
    expect(animFire?.isAnimated).toBe(true)
    expect(animFire?.filename).toBe('anim-fire.gif')
    expect(isAnimatedSticker('anim-fire')).toBe(true)
    expect(isAnimatedSticker('anim-fire.gif')).toBe(true)
    expect(isAnimatedSticker('anim-fire.webp')).toBe(true)
    expect(isAnimatedSticker('star')).toBe(false)
    expect(isAnimatedSticker('star.png')).toBe(false)
  })

  it('verifies that all sticker files exist on disk in public/stickers', () => {
    const publicStickersDir = path.resolve(__dirname, '../../public/stickers')
    for (const sticker of STICKER_DEFINITIONS) {
      const filePath = path.join(publicStickersDir, sticker.filename)
      expect(fs.existsSync(filePath), `Missing sticker file: ${sticker.filename}`).toBe(true)
    }
  })

  it('resolves relative sticker path', () => {
    expect(resolveStickerRelativePath('star')).toBe('stickers/star.png')
    expect(resolveStickerRelativePath('anim-fire')).toBe('stickers/anim-fire.gif')
    expect(resolveStickerRelativePath('custom-sticker.png')).toBe('stickers/custom-sticker.png')
  })
})

function createTestState() {
  const asset1 = {
    id: 'asset-video-1',
    type: 'video' as const,
    path: '/path/to/video1.mp4',
    prompt: 'Video 1',
    resolution: '1920x1080',
    duration: 10,
    createdAt: 1000,
  }
  return createInitialEditorState({
    assets: [asset1],
    bins: { root: 'Default' },
    timelines: [
      {
        id: 'tl-1',
        name: 'Timeline 1',
        createdAt: Date.now(),
        tracks: [
          { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, sourcePatched: true },
        ],
        clips: [
          {
            id: 'clip-base',
            trackIndex: 0,
            startTime: 0,
            duration: 10,
            trimStart: 0,
            trimEnd: 10,
            type: 'video',
            assetId: 'asset-video-1',
            asset: asset1,
            speed: 1,
            reversed: false,
            muted: false,
            volume: 1,
            flipH: false,
            flipV: false,
            transitionIn: { type: 'none', duration: 0.5 },
            transitionOut: { type: 'none', duration: 0.5 },
            colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
            transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
            opacity: 100,
          },
        ],
        subtitles: [],
      },
    ],
    activeTimelineId: 'tl-1',
  })
}

describe('addStickerClip action', () => {
  it('adds sticker clip to active timeline as image clip on overlay track', () => {
    const initial = createTestState()
    const state = addStickerClip(initial, {
      stickerId: 'star',
      startTime: 1.5,
    })

    const timeline = selectActiveTimeline(state)
    expect(timeline).toBeDefined()
    const clips = selectClips(state)
    const stickerClip = clips.find(c => c.stickerId === 'star')

    expect(stickerClip).toBeDefined()
    expect(stickerClip?.type).toBe('image')
    expect(stickerClip?.startTime).toBe(1.5)
    expect(stickerClip?.duration).toBe(DEFAULT_STICKER_DURATION)
    // The scale is derived from the frame so the sticker lands about
    // DEFAULT_STICKER_PIXELS across, rather than being a fixed percentage that
    // would be tiny on a 4K timeline and huge on a small one.
    const shortEdge = 512 // no width/height on this timeline, so it comes from the asset
    expect((stickerClip!.transform.scale / 100) * shortEdge).toBeCloseTo(DEFAULT_STICKER_PIXELS, 0)
    expect(stickerClip?.importedName).toContain('Gold Star')

    // An asset must be registered in editorModel.assets
    const asset = state.editorModel.assets.find(a => a.id === stickerClip?.assetId)
    expect(asset).toBeDefined()
    expect(asset?.type).toBe('image')
    expect(asset?.path).toBe('stickers/star.png')
  })

  it('allows customizing duration, scale, and transform coordinates', () => {
    const initial = createTestState()
    const state = addStickerClip(initial, {
      stickerId: 'fire',
      startTime: 2,
      duration: 5,
      scale: 60,
      positionX: 15,
      positionY: -20,
      rotation: 12,
      opacity: 85,
    })

    const clips = selectClips(state)
    const clip = clips.find(c => c.stickerId === 'fire')
    expect(clip).toBeDefined()
    expect(clip?.duration).toBe(5)
    expect(clip?.transform.scale).toBe(60)
    expect(clip?.transform.positionX).toBe(15)
    expect(clip?.transform.positionY).toBe(-20)
    expect(clip?.transform.rotation).toBe(12)
    expect(clip?.opacity).toBe(85)
  })

  it('supports custom image path for user imported stickers', () => {
    const initial = createTestState()
    const state = addStickerClip(initial, {
      stickerId: 'my-custom-badge',
      imagePath: '/path/to/custom-badge.png',
      startTime: 0,
    })

    const clips = selectClips(state)
    const clip = clips.find(c => c.stickerId === 'my-custom-badge')
    expect(clip).toBeDefined()
    expect(clip?.type).toBe('image')
    expect(clip?.asset?.path).toBe('/path/to/custom-badge.png')
  })

  it('supports adding shape clips via addStickerClip', () => {
    const initial = createTestState()
    const state = addStickerClip(initial, {
      stickerId: 'shape-circle',
      imagePath: 'stickers/shape-circle.png',
      startTime: 1,
      duration: 3,
    })

    const clips = selectClips(state)
    const clip = clips.find(c => c.stickerId === 'shape-circle')
    expect(clip).toBeDefined()
    expect(clip?.type).toBe('image')
    expect(clip?.asset?.path).toBe('stickers/shape-circle.png')
  })
})
