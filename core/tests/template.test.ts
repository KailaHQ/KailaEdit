import { describe, it, expect } from 'vitest'
import { buildTemplateFromTimeline, komfyTemplateSchema } from '../src/template-model'
import {
  MIN_SLOT_SPEED,
  applyTemplate,
  coverScaleFor,
  fitAssetToSlot,
} from '../src/template-apply'
import type { Asset, Timeline, TimelineClip } from '../src/project-model'

const clip = (over: Partial<TimelineClip>): TimelineClip => ({
  id: 'c', type: 'video', startTime: 0, duration: 3,
  trimStart: 0, trimEnd: 0, trackIndex: 1, speed: 1,
  transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
  ...over,
} as TimelineClip)

const asset = (over: Partial<Asset>): Asset => ({
  id: 'a', type: 'video', path: 'C:/media/a.mp4', prompt: '', resolution: '', createdAt: 0,
  ...over,
} as Asset)

/** A captioned project: subtitle track at index 0, footage at index 1. */
const sourceTimeline: Timeline = {
  id: 'tl-source', name: 'Timeline 1', createdAt: 0,
  tracks: [
    { id: 't-sub', name: 'Subtitles', muted: false, locked: false, kind: 'video', type: 'subtitle' },
    { id: 't-v', name: 'V1', muted: false, locked: false, kind: 'video', type: 'default' },
  ],
  clips: [
    clip({ id: 'shot-2', startTime: 3, duration: 2, assetId: 'a2', asset: asset({ id: 'a2' }) } as Partial<TimelineClip>),
    clip({ id: 'shot-1', startTime: 0, duration: 3, assetId: 'a1', asset: asset({ id: 'a1' }) } as Partial<TimelineClip>),
    clip({ id: 'caption', type: 'text', startTime: 0, duration: 5, trackIndex: 0 }),
  ],
  subtitles: [],
  width: 1080,
  height: 1920,
  fps: 30,
}

describe('buildTemplateFromTimeline', () => {
  const { template } = buildTemplateFromTimeline(sourceTimeline, { name: 'Nhịp nhanh' })

  it('produces a document the schema accepts', () => {
    expect(() => komfyTemplateSchema.parse(template)).not.toThrow()
  })

  /*
   * The footage is on track 1, not 0, because generating captions prepends a
   * subtitle track and pushes every clip up. Reading "track 0 is the video"
   * here would make a template out of the caption row.
   */
  it('takes its slots from the footage track, wherever that track sits', () => {
    expect(template.slots.map(s => s.clipId)).toEqual(['shot-1', 'shot-2'])
  })

  it('numbers slots in the order they play, not array order', () => {
    expect(template.slots[0].slotIndex).toBe(1)
    expect(template.slots[0].duration).toBe(3)
    expect(template.slots[1].duration).toBe(2)
  })

  /*
   * An asset path points into one project's asset folder on one machine. A
   * template carrying it would either break or, worse, quietly reference
   * somebody else's footage.
   */
  it('strips every trace of the media it was built from', () => {
    const serialised = JSON.stringify(template)
    expect(serialised).not.toContain('C:/media/a.mp4')
    for (const c of template.timeline.clips) {
      expect(c.asset).toBeNull()
      expect(c.assetId).toBeNull()
    }
  })

  it('keeps the clips that are not slots — they are the template', () => {
    expect(template.timeline.clips.some(c => c.id === 'caption')).toBe(true)
  })

  it('carries the frame it was designed for', () => {
    expect(template.width).toBe(1080)
    expect(template.height).toBe(1920)
    expect(template.durationSec).toBe(5)
  })
})

describe('fitAssetToSlot', () => {
  const slot = { slotIndex: 1, clipId: 'x', duration: 4, kind: 'any' as const, label: '' }

  it('trims a long clip down to the slot', () => {
    expect(fitAssetToSlot(slot, 10)).toEqual({ trimStart: 0, duration: 4, speed: 1, short: false })
  })

  it('stretches a slightly short clip to fill the slot', () => {
    const fit = fitAssetToSlot(slot, 3)
    expect(fit.duration).toBe(4)
    expect(fit.speed).toBeCloseTo(0.75)
    expect(fit.short).toBe(false)
  })

  /*
   * Past half speed the stretch reads as slow motion rather than a cut, so the
   * slot is left visibly short instead — a gap the user can see and fix beats
   * an effect they never asked for.
   */
  it('refuses to stretch past the believable limit and says the slot is short', () => {
    const fit = fitAssetToSlot(slot, 1)
    expect(fit.speed).toBe(1)
    expect(fit.duration).toBe(1)
    expect(fit.short).toBe(true)
    expect(1 / slot.duration).toBeLessThan(MIN_SLOT_SPEED)
  })

  it('lets a still fill any slot, since it has no length of its own', () => {
    expect(fitAssetToSlot(slot, undefined).duration).toBe(4)
    expect(fitAssetToSlot(slot, 0).duration).toBe(4)
  })
})

describe('coverScaleFor', () => {
  it('scales landscape footage up to cover a vertical frame', () => {
    // 16:9 into 9:16 needs the width blown up by (16/9) / (9/16) ≈ 3.16×.
    expect(coverScaleFor({ width: 1920, height: 1080 }, { width: 1080, height: 1920 }))
      .toBeCloseTo(316.05, 1)
  })

  it('leaves matching shapes alone', () => {
    expect(coverScaleFor({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })).toBe(100)
  })

  it('has no opinion when the media dimensions are unknown', () => {
    expect(coverScaleFor(undefined, { width: 1080, height: 1920 })).toBe(100)
    expect(coverScaleFor({ width: 0, height: 0 }, { width: 1080, height: 1920 })).toBe(100)
  })
})

describe('applyTemplate', () => {
  const { template } = buildTemplateFromTimeline(
    {
      ...sourceTimeline,
      transitions: [{
        id: 'tr-1', trackIndex: 1, leftClipId: 'shot-1', rightClipId: 'shot-2',
        type: 'dissolve', duration: 0.5,
      }],
      clips: [
        ...sourceTimeline.clips,
        clip({ id: 'audio-1', type: 'audio', trackIndex: 2, linkedClipIds: ['shot-1'] }),
      ],
    },
    { name: 'Nhịp nhanh' },
  )

  const bindings = [
    { slotIndex: 1, asset: asset({ id: 'new-1', path: 'C:/mine/one.mp4', duration: 10, width: 1920, height: 1080 }) },
    { slotIndex: 2, asset: asset({ id: 'new-2', path: 'C:/mine/two.mp4', duration: 10 }) },
  ]

  it('fills the slots with the chosen media', () => {
    const { timeline } = applyTemplate(template, bindings)
    const filled = timeline.clips.filter(c => c.assetId)
    expect(filled.map(c => c.assetId).sort()).toEqual(['new-1', 'new-2'])
  })

  /* The whole point of a fixed slot: the cut stays on the beat. */
  it('keeps every slot at the template duration', () => {
    const { timeline } = applyTemplate(template, bindings)
    const byAsset = new Map(timeline.clips.map(c => [c.assetId, c]))
    expect(byAsset.get('new-1')!.duration).toBe(3)
    expect(byAsset.get('new-2')!.duration).toBe(2)
  })

  it('scales landscape media up to cover the vertical frame', () => {
    const { timeline } = applyTemplate(template, bindings)
    const wide = timeline.clips.find(c => c.assetId === 'new-1')!
    expect(wide.transform!.scale).toBeGreaterThan(300)
  })

  it('leaves a slot nobody bound empty, and says which', () => {
    const { timeline, unfilledSlots } = applyTemplate(template, [bindings[0]])
    expect(unfilledSlots).toEqual([2])
    expect(timeline.clips.filter(c => c.assetId)).toHaveLength(1)
  })

  it('reports a slot whose media ran out rather than hiding the gap', () => {
    const { shortSlots } = applyTemplate(template, [
      { slotIndex: 1, asset: asset({ id: 'tiny', duration: 0.4 }) },
    ])
    expect(shortSlots).toEqual([1])
  })

  /*
   * Ids must not survive the copy. A transition or a linked audio clip still
   * pointing at the template's ids attaches to nothing once applied.
   */
  it('remaps clip ids and carries links and transitions across with them', () => {
    const { timeline } = applyTemplate(template, bindings)
    const ids = new Set(timeline.clips.map(c => c.id))
    expect(ids.has('shot-1')).toBe(false)

    const linked = timeline.clips.find(c => c.type === 'audio')!
    expect(ids.has(linked.linkedClipIds![0])).toBe(true)

    const [transition] = timeline.transitions!
    expect(ids.has(transition.leftClipId)).toBe(true)
    expect(ids.has(transition.rightClipId)).toBe(true)
  })

  it('is a new timeline, tagged, never the one it came from', () => {
    const { timeline } = applyTemplate(template, bindings)
    expect(timeline.id).not.toBe('tl-source')
    expect(timeline.id).not.toBe('template-timeline')
    expect(timeline.variantTag).toBe('template')
    expect(timeline.width).toBe(1080)
  })

  it('keeps the non-slot clips that make the template look like itself', () => {
    const { timeline } = applyTemplate(template, bindings)
    expect(timeline.clips.some(c => c.type === 'text')).toBe(true)
  })
})

/*
 * Phase 2: a template keeps the media it owns.
 *
 * The music bed and the overlays ARE the template; without them a saved edit
 * came back silent. The user's footage
 * still never travels — that is what the slots are for.
 */
describe('bundled media', () => {
  const withMusic: Timeline = {
    ...sourceTimeline,
    clips: [
      ...sourceTimeline.clips,
      clip({
        id: 'music', type: 'audio', trackIndex: 2, startTime: 0, duration: 5,
        assetId: 'a-music', asset: asset({ id: 'a-music', type: 'audio', path: 'C:/lib/beat.mp3' }),
      } as Partial<TimelineClip>),
      clip({
        id: 'overlay', type: 'image', trackIndex: 3, startTime: 0, duration: 2,
        assetId: 'a-logo', asset: asset({ id: 'a-logo', type: 'image', path: 'C:/lib/logo.png' }),
      } as Partial<TimelineClip>),
    ],
  }

  const built = buildTemplateFromTimeline(withMusic, { name: 'Có nhạc' })

  it('lists what has to be copied beside the document', () => {
    expect(built.media.map(m => m.sourcePath).sort())
      .toEqual(['C:/lib/beat.mp3', 'C:/lib/logo.png'])
    expect(built.template.bundledMedia.sort()).toEqual(['beat.mp3', 'logo.png'])
  })

  it('rewrites kept media to a name inside the template, not a path on this machine', () => {
    const music = built.template.timeline.clips.find(c => c.id === 'music')!
    expect(music.asset?.path).toBe('media/beat.mp3')
    expect(JSON.stringify(built.template)).not.toContain('C:/lib')
  })

  /* The slot's footage is the user's, and the next video replaces it. */
  it('still strips the footage in the slots', () => {
    for (const slot of built.template.slots) {
      const slotClip = built.template.timeline.clips.find(c => c.id === slot.clipId)!
      expect(slotClip.asset).toBeNull()
    }
    expect(built.template.bundledMedia).not.toContain('a.mp4')
  })

  it('copies a file used twice only once', () => {
    const twice: Timeline = {
      ...sourceTimeline,
      clips: [
        ...sourceTimeline.clips,
        clip({ id: 'm1', type: 'audio', trackIndex: 2, assetId: 'x', asset: asset({ id: 'x', type: 'audio', path: 'C:/lib/beat.mp3' }) } as Partial<TimelineClip>),
        clip({ id: 'm2', type: 'audio', trackIndex: 3, assetId: 'x', asset: asset({ id: 'x', type: 'audio', path: 'C:/lib/beat.mp3' }) } as Partial<TimelineClip>),
      ],
    }
    const result = buildTemplateFromTimeline(twice, { name: 'Lặp' })
    expect(result.media).toHaveLength(1)
    expect(result.template.bundledMedia).toEqual(['beat.mp3'])
  })

  it('gives two different files with the same name separate bundle names', () => {
    const clash: Timeline = {
      ...sourceTimeline,
      clips: [
        ...sourceTimeline.clips,
        clip({ id: 'm1', type: 'audio', trackIndex: 2, assetId: 'p', asset: asset({ id: 'p', type: 'audio', path: 'C:/a/beat.mp3' }) } as Partial<TimelineClip>),
        clip({ id: 'm2', type: 'audio', trackIndex: 3, assetId: 'q', asset: asset({ id: 'q', type: 'audio', path: 'C:/b/beat.mp3' }) } as Partial<TimelineClip>),
      ],
    }
    const result = buildTemplateFromTimeline(clash, { name: 'Trùng tên' })
    expect(new Set(result.template.bundledMedia).size).toBe(2)
    expect(result.template.bundledMedia).toContain('beat.mp3')
  })

  it('a template with nothing of its own bundles nothing', () => {
    expect(buildTemplateFromTimeline(sourceTimeline, { name: 'Trơn' }).media).toEqual([])
  })

  it('carries the music through to the applied timeline', () => {
    const { timeline } = applyTemplate(built.template, [
      { slotIndex: 1, asset: asset({ id: 'mine', duration: 10 }) },
    ])
    const music = timeline.clips.find(c => c.type === 'audio')!
    expect(music.asset?.path).toBe('media/beat.mp3')
  })
})

/*
 * The numbers the picker shows before you commit.
 *
 * The fit was always computed during the apply, silently: a clip two seconds
 * short became slow motion nobody asked for, and one far too short left a gap
 * found only on playback. These are the cases the panel now labels.
 */
describe('what the picker has to warn about', () => {
  const slot = { slotIndex: 1, clipId: 'x', duration: 4, kind: 'video' as const, label: '' }

  it('says nothing when the clip simply fits', () => {
    const fit = fitAssetToSlot(slot, 10)
    expect(fit.speed).toBe(1)
    expect(fit.short).toBe(false)
  })

  it('flags the slow-down and by how much, before it happens', () => {
    const fit = fitAssetToSlot(slot, 2.4)
    expect(fit.speed).toBeCloseTo(0.6)
    expect(fit.speed).toBeGreaterThanOrEqual(MIN_SLOT_SPEED)
    expect(fit.short).toBe(false)
  })

  it('flags the gap, and the gap is the difference the panel reports', () => {
    const fit = fitAssetToSlot(slot, 1.5)
    expect(fit.short).toBe(true)
    expect(slot.duration - fit.duration).toBeCloseTo(2.5)
  })

  /* Exactly at the limit still stretches; a hair under does not. */
  it('draws the line at the stated limit', () => {
    expect(fitAssetToSlot(slot, slot.duration * MIN_SLOT_SPEED).short).toBe(false)
    expect(fitAssetToSlot(slot, slot.duration * MIN_SLOT_SPEED - 0.01).short).toBe(true)
  })
})
