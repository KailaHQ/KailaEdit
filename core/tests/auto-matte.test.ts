import { describe, it, expect } from 'vitest'
import {
  autoMatteSchema,
  DEFAULT_AUTO_MATTE,
  timelineClipSchema,
} from '../src/project-model'
import {
  autoMatteBakeKey,
  autoMatteBakeOffset,
  autoMattePlaybackRate,
  autoMatteSourceRange,
  computeAutoMatteFingerprint,
  downsampleRatioForInferenceSize,
  isAutoMatteBakeValid,
  matteTimeForSourceTime,
  parseAutoMatteFingerprint,
  snapAutoMatteRange,
} from '../src/auto-matte'
import { setClipAutoMatte } from '../src/editor-actions'
import { selectClipAutoMatte } from '../src/editor-selectors'
import { createInitialEditorState, type EditorState } from '../src/editor-state'

describe('matte reuse after changing playback speed', () => {
  it.each([0.25, 0.5, 1, 2, 4])('keeps the same source bake at %sx', speed => {
    const bake = { path: '/matte.mp4', fingerprint: 'bake', frameCount: 2400, createdAt: 0,
      sourceStart: 0, sourceSpan: 80, speed: 1 }
    expect(isAutoMatteBakeValid(bake, { trimStart: 0, duration: 80 / speed, speed,
      model: 'rvm-mobilenetv3', quality: 'standard' })).toBe(true)
    expect(autoMattePlaybackRate(bake, speed)).toBe(speed)
    expect(matteTimeForSourceTime(17, bake.sourceStart, bake.speed)).toBe(17)
  })

  it('retimes legacy accelerated bakes using their original rate', () => {
    expect(autoMattePlaybackRate({ speed: 2 }, 0.5)).toBe(0.25)
    expect(autoMatteBakeOffset({ sourceStart: 10, speed: 2 }, 16, 0.5)).toBe(3)
  })

  it('requires one source-rate migration for a legacy bake with missing alpha frames', () => {
    const bake = { path: '/legacy.mp4', fingerprint: 'legacy', frameCount: 1890, createdAt: 0,
      sourceStart: 0, sourceSpan: 80.01, speed: 1.27 }
    for (const speed of [1, 1.27, 0.5, 2]) {
      const params = { trimStart: 0, duration: 80 / speed, speed, model: 'rvm-mobilenetv3', quality: 'standard' }
      expect(isAutoMatteBakeValid(bake, params)).toBe(false)
      expect(isAutoMatteBakeValid({ ...bake, speed: 1, frameCount: 2400 }, params)).toBe(true)
    }
  })
})

describe('autoMatteSchema & Model', () => {
  it('parses valid autoMatte settings and sets defaults', () => {
    const parsed = autoMatteSchema.parse({})
    expect(parsed.enabled).toBe(true)
    expect(parsed.model).toBe('rvm-mobilenetv3')
    expect(parsed.quality).toBe('standard')
    expect(parsed.featherEdge).toBe(0)
    expect(parsed.cleanEdge).toBe(0)
    expect(parsed.bake).toBeUndefined()
    expect(DEFAULT_AUTO_MATTE.model).toBe('rvm-mobilenetv3')
  })

  it('validates bake payload when present', () => {
    const parsed = autoMatteSchema.parse({
      enabled: true,
      model: 'rvm-mobilenetv3',
      quality: 'high',
      featherEdge: 15,
      cleanEdge: 20,
      bake: {
        path: 'C:/cache/matte_123.mp4',
        fingerprint: 'matte_abc123',
        frameCount: 150,
        createdAt: 1726543210000,
      },
    })
    expect(parsed.bake).toBeDefined()
    expect(parsed.bake?.frameCount).toBe(150)
    expect(parsed.bake?.fingerprint).toBe('matte_abc123')
  })

  it('rejects invalid model or quality', () => {
    expect(() =>
      autoMatteSchema.parse({ model: 'nonexistent-model' as any })
    ).toThrow()
    expect(() =>
      autoMatteSchema.parse({ quality: 'ultra' as any })
    ).toThrow()
  })

  it('integrates cleanly into timelineClipSchema', () => {
    const clip = timelineClipSchema.parse({
      id: 'clip-1',
      assetId: 'asset-1',
      asset: null,
      type: 'video',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 5,
      trackIndex: 0,
      autoMatte: {
        enabled: true,
        model: 'rvm-mobilenetv3',
        quality: 'draft',
      },
    })
    expect(clip.autoMatte).toBeDefined()
    expect(clip.autoMatte?.model).toBe('rvm-mobilenetv3')
    expect(clip.autoMatte?.quality).toBe('draft')
  })
})

describe('computeAutoMatteFingerprint', () => {
  const baseParams = {
    assetKey: 'c:/media/clip.mp4',
    trimStart: 2.5,
    duration: 5.0,
    speed: 1,
    reversed: false,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
  }

  it('is deterministic for identical inputs', () => {
    const fp1 = computeAutoMatteFingerprint(baseParams)
    const fp2 = computeAutoMatteFingerprint({ ...baseParams })
    expect(fp1).toBe(fp2)
    expect(fp1.startsWith('matte_')).toBe(true)
  })

  it('carries the source range it stands for, readable back off the name', () => {
    const fp = computeAutoMatteFingerprint({ ...baseParams, sourceStart: 10, sourceSpan: 30 })
    const parsed = parseAutoMatteFingerprint(fp)
    expect(parsed?.range).toEqual({ sourceStart: 10, sourceSpan: 30 })
  })

  it('changes when the source range changes', () => {
    const fpOriginal = computeAutoMatteFingerprint(baseParams)
    expect(computeAutoMatteFingerprint({ ...baseParams, trimStart: 3.0 })).not.toBe(fpOriginal)
    expect(computeAutoMatteFingerprint({ ...baseParams, duration: 6.0 })).not.toBe(fpOriginal)
  })

  it('changes when speed, reversed, model, quality or media changes', () => {
    const fpOriginal = computeAutoMatteFingerprint(baseParams)
    expect(computeAutoMatteFingerprint({ ...baseParams, speed: 1.5 })).not.toBe(fpOriginal)
    expect(computeAutoMatteFingerprint({ ...baseParams, reversed: true })).not.toBe(fpOriginal)
    expect(computeAutoMatteFingerprint({ ...baseParams, model: 'modnet' })).not.toBe(fpOriginal)
    expect(computeAutoMatteFingerprint({ ...baseParams, quality: 'high' })).not.toBe(fpOriginal)
    expect(computeAutoMatteFingerprint({ ...baseParams, assetKey: 'c:/media/other.mp4' })).not.toBe(fpOriginal)
  })

  it('gives two clips cutting the same range of one asset the SAME matte', () => {
    // The opposite of what this used to assert. Keying on the clip id is what left one
    // project with nine near-identical mattes of a single piece of footage.
    const a = computeAutoMatteFingerprint({ ...baseParams })
    const b = computeAutoMatteFingerprint({ ...baseParams })
    expect(a).toBe(b)
  })

  it('validates bake coverage with isAutoMatteBakeValid', () => {
    const validBake = {
      path: '/tmp/bake.mp4',
      fingerprint: computeAutoMatteFingerprint(baseParams),
      frameCount: 150,
      createdAt: Date.now(),
      sourceStart: 2.5,
      sourceSpan: 5,
      speed: 1,
      reversed: false,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
    }
    expect(isAutoMatteBakeValid(validBake, baseParams)).toBe(true)

    // A trim that starts before the bake is not covered.
    expect(isAutoMatteBakeValid(validBake, { ...baseParams, trimStart: 1 })).toBe(false)
    // Nor one that runs past its end.
    expect(isAutoMatteBakeValid(validBake, { ...baseParams, duration: 9 })).toBe(false)
    // A trim inside it is.
    expect(isAutoMatteBakeValid(validBake, { ...baseParams, trimStart: 3, duration: 2 })).toBe(true)

    // Null or empty bake returns false
    expect(isAutoMatteBakeValid(null, baseParams)).toBe(false)
    expect(isAutoMatteBakeValid(undefined, baseParams)).toBe(false)
    expect(isAutoMatteBakeValid({ ...validBake, fingerprint: '' }, baseParams)).toBe(false)
    // A bake from before ranges were recorded says nothing about what it covers.
    expect(isAutoMatteBakeValid({ ...validBake, sourceStart: undefined }, baseParams)).toBe(false)
  })

  it('will not stand a reversed bake in for a different range', () => {
    // Reversed bakes play backwards, so a clip inside one is not where the offset says.
    const params = { ...baseParams, reversed: true, trimStart: 0, duration: 10 }
    const bake = {
      path: '/tmp/rev.mp4',
      fingerprint: computeAutoMatteFingerprint(params),
      frameCount: 300,
      createdAt: Date.now(),
      sourceStart: 0,
      sourceSpan: 10,
      speed: 1,
      reversed: true,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
    }
    expect(isAutoMatteBakeValid(bake, params)).toBe(true)
    // Covered, but not the same range — refused, where a forward bake would be reused.
    expect(isAutoMatteBakeValid(bake, { ...params, trimStart: 2, duration: 5 })).toBe(false)
    expect(
      isAutoMatteBakeValid({ ...bake, reversed: false }, { ...params, reversed: false, trimStart: 2, duration: 5 }),
    ).toBe(true)
  })

  it('rejects a bake made a different way, however well it covers the range', () => {
    const bake = {
      path: '/tmp/bake.mp4',
      fingerprint: 'matte_0000000000000000_0_60000',
      frameCount: 150,
      createdAt: Date.now(),
      sourceStart: 0,
      sourceSpan: 60,
      speed: 1,
      reversed: false,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
    }
    expect(isAutoMatteBakeValid(bake, baseParams)).toBe(true)
    expect(isAutoMatteBakeValid(bake, { ...baseParams, speed: 2 })).toBe(true)
    expect(isAutoMatteBakeValid(bake, { ...baseParams, reversed: true })).toBe(false)
    expect(isAutoMatteBakeValid(bake, { ...baseParams, model: 'modnet' })).toBe(false)
    expect(isAutoMatteBakeValid(bake, { ...baseParams, quality: 'high' })).toBe(false)
    expect(
      isAutoMatteBakeValid({ ...bake, assetKey: 'c:/media/other.mp4' }, baseParams),
    ).toBe(false)
  })
})

/**
 * Added 18/09/2026, from a render that died on its first frame with
 * "Error reinitializing filters".
 *
 * `alphamerge` refuses a mask that is not the same size as the picture — it reported
 * 270x480 against 853x480 — and the whole export goes down with it, on every encoder. The
 * clip was filmed portrait on a phone: the container holds 1920x1080 frames plus a 90°
 * display matrix, so the decoder emits 1080x1920, and a matte baked from the container's
 * reading came out landscape. Geometry is therefore part of a matte's identity: one made
 * under a different reading of the media can never be handed to a clip.
 */
describe('a matte is tied to the geometry it was made for', () => {
  const base = {
    assetKey: 'c:/media/phone.mov',
    trimStart: 0,
    duration: 10,
    speed: 1,
    reversed: false,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
  }

  it('gives the two readings of a rotated clip different mattes', () => {
    const asContainer = computeAutoMatteFingerprint({ ...base, frameSize: '1920x1080' })
    const asDecoded = computeAutoMatteFingerprint({ ...base, frameSize: '1080x1920' })
    expect(asDecoded).not.toBe(asContainer)
  })

  it('still reuses a bake across trims at the same geometry', () => {
    // The key deliberately knows nothing about the range — that is what lets one bake
    // serve every trim inside it.
    const key = { assetKey: base.assetKey, speed: 1, reversed: false, model: base.model, quality: base.quality }
    expect(autoMatteBakeKey({ ...key, frameSize: '1080x1920' })).toBe(
      autoMatteBakeKey({ ...key, frameSize: '1080x1920' }),
    )
    expect(
      computeAutoMatteFingerprint({ ...base, frameSize: '1080x1920' }),
    ).not.toBe(
      computeAutoMatteFingerprint({ ...base, trimStart: 4, duration: 3, frameSize: '1080x1920' }),
    )
  })
})

describe('snapAutoMatteRange', () => {
  it('rounds the request outward to the block grid', () => {
    expect(snapAutoMatteRange({ sourceStart: 12, sourceSpan: 5 })).toEqual({
      sourceStart: 10,
      sourceSpan: 10,
    })
  })

  it('never returns less than was asked for', () => {
    const asked = { sourceStart: 0, sourceSpan: 77 }
    const snapped = snapAutoMatteRange(asked, 77)
    expect(snapped.sourceStart).toBeLessThanOrEqual(asked.sourceStart)
    expect(snapped.sourceStart + snapped.sourceSpan).toBeGreaterThanOrEqual(
      asked.sourceStart + asked.sourceSpan,
    )
  })

  it('does not run past the end of the media', () => {
    const snapped = snapAutoMatteRange({ sourceStart: 70, sourceSpan: 7 }, 77)
    expect(snapped.sourceStart + snapped.sourceSpan).toBeCloseTo(77, 6)
  })

  it('collapses neighbouring trims of one clip onto one bake', () => {
    // Two trims a few frames apart used to be two full bakes.
    const a = snapAutoMatteRange({ sourceStart: 1.0, sourceSpan: 20 })
    const b = snapAutoMatteRange({ sourceStart: 1.2, sourceSpan: 19.5 })
    expect(a).toEqual(b)
  })
})

describe('editor actions & selectors for autoMatte', () => {
  function createMockState(): EditorState {
    const timeline = {
      id: 'tl-1',
      name: 'Timeline 1',
      createdAt: Date.now(),
      timecode: 0,
      duration: 10,
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      tracks: [{ id: 'track-v1', name: 'V1', kind: 'video', muted: false, locked: false }],
      clips: [
        {
          id: 'clip-test',
          assetId: 'asset-1',
          asset: null,
          type: 'video',
          startTime: 0,
          duration: 5,
          trimStart: 0,
          trimEnd: 5,
          trackIndex: 0,
          speed: 1,
          reversed: false,
          muted: false,
          volume: 1,
          flipH: false,
          flipV: false,
          opacity: 100,
          transitionIn: { type: 'none', duration: 0 },
          transitionOut: { type: 'none', duration: 0 },
          colorCorrection: {} as any,
          transform: {} as any,
        } as any,
      ],
      subtitles: [],
      transitions: [],
      markers: [],
    }

    return createInitialEditorState({
      assets: [],
      bins: {},
      timelines: [timeline as any],
      activeTimelineId: 'tl-1',
    })
  }

  it('sets autoMatte with default values when applied', () => {
    const state = createMockState()
    const nextState = setClipAutoMatte(state, 'clip-test', { enabled: true, quality: 'high' })

    const autoMatte = selectClipAutoMatte(nextState, 'clip-test')
    expect(autoMatte).toBeDefined()
    expect(autoMatte?.enabled).toBe(true)
    expect(autoMatte?.model).toBe('rvm-mobilenetv3')
    expect(autoMatte?.quality).toBe('high')
  })

  it('clears autoMatte when passed null', () => {
    const state = createMockState()
    const stateWithMatte = setClipAutoMatte(state, 'clip-test', { enabled: true })
    expect(selectClipAutoMatte(stateWithMatte, 'clip-test')).toBeDefined()

    const clearedState = setClipAutoMatte(stateWithMatte, 'clip-test', null)
    expect(selectClipAutoMatte(clearedState, 'clip-test')).toBeUndefined()
  })
})

/**
 * Added 17/09/2026 after a bug where background removal appeared to do nothing.
 *
 * The bake stored a fingerprint built from `clip.id`, while every consumer — the preview,
 * the Remove BG panel and QC — rebuilt it from `clip.assetId`. The two never matched, so
 * `isAutoMatteBakeValid` always said false: the preview silently ignored the matte it had
 * just spent a minute baking, and QC called every clip un-baked.
 *
 * Nothing failed loudly, which is what made it expensive. These tests hold the producer
 * and the consumers to the same input.
 */
describe('Bake fingerprint: producer and consumer agree', () => {
  const ASSET = 'c:/media/imported.mov'

  const clip = {
    id: 'clip-42',
    assetId: 'asset-7',
    trimStart: 2.5,
    duration: 8,
    speed: 1.25,
    reversed: false,
  }

  const params = {
    assetKey: ASSET,
    trimStart: clip.trimStart,
    duration: clip.duration,
    speed: clip.speed,
    reversed: clip.reversed,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
  }

  /** What matte-service stores when it finishes a bake: the range it actually rendered. */
  const range = snapAutoMatteRange(autoMatteSourceRange(params))
  const producedBake = {
    path: '/cache/matte.mp4',
    fingerprint: computeAutoMatteFingerprint({ ...params, ...range, speed: 1 }),
    frameCount: 240,
    createdAt: Date.now(),
    sourceStart: range.sourceStart,
    sourceSpan: range.sourceSpan,
    speed: 1,
    reversed: clip.reversed,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
    assetKey: ASSET,
  }

  it('accepts the bake it just produced', () => {
    expect(isAutoMatteBakeValid(producedBake, params)).toBe(true)
  })

  it('accepts it for a second clip cutting the same footage', () => {
    // Two clips, one asset, overlapping ranges: one bake serves both.
    expect(
      isAutoMatteBakeValid(producedBake, { ...params, trimStart: 4, duration: 3 }),
    ).toBe(true)
  })

  /**
   * The case from the log on 18/09/2026.
   *
   * The editor baked the whole 77 s clip. The render cache then rendered a 60 s preview
   * window, which `sliceClipsForPreview` hands over as a clip with `trimStart: 1` and a
   * shorter duration — a different fingerprint under the old rule, so the model ran again
   * over footage that was already matted. Nine mattes of one clip, ~400 MB, ended up in
   * the cache that way.
   */
  it('serves a render-cache preview window from the bake the editor already made', () => {
    const editorParams = {
      assetKey: ASSET,
      trimStart: 0,
      duration: 77,
      speed: 1,
      reversed: false,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
    }
    const baked = snapAutoMatteRange(autoMatteSourceRange(editorParams), 77)
    const editorBake = {
      path: '/cache/matte-full.mp4',
      fingerprint: computeAutoMatteFingerprint({ ...editorParams, ...baked }),
      frameCount: 2310,
      createdAt: Date.now(),
      sourceStart: baked.sourceStart,
      sourceSpan: baked.sourceSpan,
      speed: 1,
      reversed: false,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
      assetKey: ASSET,
    }

    const slicedByPreview = { ...editorParams, trimStart: 1, duration: 57 }
    expect(isAutoMatteBakeValid(editorBake, slicedByPreview)).toBe(true)

    // And the consumer seeks to where the slice begins inside it, rather than assuming
    // the matte starts on the clip's first frame.
    expect(autoMatteBakeOffset(editorBake, slicedByPreview.trimStart, 1)).toBeCloseTo(1, 6)
  })

  it('places a clip at the right point inside a shared bake', () => {
    // Offset uses the stored bake rate, independent of the current clip rate.
    expect(autoMatteBakeOffset({ sourceStart: 10, speed: 2 }, 16, 0.5)).toBeCloseTo(3, 6)
    expect(autoMatteBakeOffset({ sourceStart: 10, speed: 1 }, 16, 2)).toBeCloseTo(6, 6)
    // A bake that does start on the clip's first frame needs no seek.
    expect(autoMatteBakeOffset({ sourceStart: 2.5 }, 2.5, 1)).toBe(0)
    // Nor does one with no range recorded — that is the old behaviour, unchanged.
    expect(autoMatteBakeOffset({}, 5, 1)).toBe(0)
  })
})

describe('matteTimeForSourceTime', () => {
  it('shifts by the trim so the matte lines up with the picture', () => {
    // Matte time 0 is source time trimStart.
    expect(matteTimeForSourceTime(4, 2.5, 1)).toBeCloseTo(1.5, 6)
    expect(matteTimeForSourceTime(2.5, 2.5, 1)).toBeCloseTo(0, 6)
  })

  it('divides by speed, because the matte was baked already sped up', () => {
    expect(matteTimeForSourceTime(6, 2, 2)).toBeCloseTo(2, 6)
    expect(matteTimeForSourceTime(4, 0, 0.5)).toBeCloseTo(8, 6)
  })

  it('agrees with raw source time only on an untrimmed clip at 1x', () => {
    // This is why the bug hid for so long.
    expect(matteTimeForSourceTime(3.7, 0, 1)).toBeCloseTo(3.7, 6)
  })

  it('never seeks before the start, and survives a nonsense speed', () => {
    expect(matteTimeForSourceTime(1, 5, 1)).toBe(0)
    expect(matteTimeForSourceTime(4, 0, 0)).toBeCloseTo(4, 6)
    expect(matteTimeForSourceTime(4, 0, NaN)).toBeCloseTo(4, 6)
  })
})

/**
 * Added 17/09/2026 after background removal left whole slabs of background attached to the
 * subject on the test shot.
 *
 * Both call sites scale the frame down before inference and then passed a fixed
 * `downsample_ratio` of 0.25 on top, which downsamples twice. The bake fed the model 960px
 * frames and ran its segmentation stage at 240px; the preview ran at 96px. RVM's inference
 * guide asks for 256-512.
 */
describe('downsampleRatioForInferenceSize', () => {
  it('puts the segmentation stage inside the range the model expects', () => {
    for (const longSide of [256, 384, 512, 640, 960, 1280, 1920, 3840]) {
      const downsampled = longSide * downsampleRatioForInferenceSize(longSide)
      expect(downsampled).toBeLessThanOrEqual(512.001)
      // Anything at or below the target is already inside the range on its own.
      if (longSide >= 256) expect(downsampled).toBeGreaterThanOrEqual(256)
    }
  })

  it('agrees with the ratios published in the RVM inference guide', () => {
    // Guide: 1920x1080 -> 0.25 portrait / 0.4 full body; 1280x720 -> 0.375 / 0.6.
    expect(downsampleRatioForInferenceSize(1920)).toBeGreaterThanOrEqual(0.25)
    expect(downsampleRatioForInferenceSize(1920)).toBeLessThanOrEqual(0.4)
    expect(downsampleRatioForInferenceSize(1280)).toBeGreaterThanOrEqual(0.375)
    expect(downsampleRatioForInferenceSize(1280)).toBeLessThanOrEqual(0.6)
  })

  it('does not downsample a frame that is already small enough', () => {
    expect(downsampleRatioForInferenceSize(512)).toBe(1)
    expect(downsampleRatioForInferenceSize(384)).toBe(1)
  })

  it('rejects the value that shipped, for the sizes this app actually feeds the model', () => {
    // 960 with 0.25 gave 240px, below the range. The point of the helper is that this
    // cannot be reintroduced by hardcoding a ratio meant for a different resolution.
    expect(960 * downsampleRatioForInferenceSize(960)).toBeGreaterThan(240)
    expect(384 * downsampleRatioForInferenceSize(384)).toBeGreaterThan(96)
  })

  it('survives nonsense input rather than feeding the model a bad ratio', () => {
    expect(downsampleRatioForInferenceSize(0)).toBe(1)
    expect(downsampleRatioForInferenceSize(-5)).toBe(1)
    expect(downsampleRatioForInferenceSize(NaN)).toBe(1)
  })
})

describe('matteTimeForSourceTime with reverse support', () => {
  it('handles reverse time mapping when sourceSpan is provided', () => {
    // sourceSpan=10, speed=1, sourceStart=0. At sourceTime=2, reverse position is 8s
    expect(matteTimeForSourceTime(2, 0, 1, true, 10)).toBe(8)
    // At sourceTime=10, reverse position is 0s
    expect(matteTimeForSourceTime(10, 0, 1, true, 10)).toBe(0)
    // At sourceTime=0, reverse position is 10s
    expect(matteTimeForSourceTime(0, 0, 1, true, 10)).toBe(10)
  })

  it('handles reverse with speed 2x', () => {
    // sourceSpan=10, speed=2. At sourceTime=2, remaining=8s -> /2 = 4s
    expect(matteTimeForSourceTime(2, 0, 2, true, 10)).toBe(4)
  })
})

