import { describe, it, expect } from 'vitest'
import {
  clipStabilizationSchema,
  DEFAULT_CLIP_STABILIZATION,
  timelineClipSchema,
  type Asset,
  type ClipStabilization,
  type StabilizationBake,
  type TimelineClip,
} from '../src/project-model'
import {
  analyzeStabilization,
  buildVidstabDetectFilter,
  buildVidstabTransformFilter,
  clampStabilizationSmoothing,
  clipNeedsStabilizationBake,
  clipSourceRange,
  computeStabilizationFingerprint,
  escapeFilterPath,
  isStabilizationBakeValid,
  parseStabilizationFingerprint,
  parseVidstabFinalZoom,
  parseVidstabGlobalMotions,
  resolveStabilizedClip,
  stabilizationBakeKey,
  stabilizationBakeRange,
  stabilizedSourceForClip,
  stabilizationContextForClip,
  stabilizedClipPath,
  resolveStabilizedClips,
  clipAsPlayed,
  isStabilizationPending,
  type GlobalMotion,
} from '../src/stabilization'
import { sameMediaKey } from '../src/auto-matte'
import { selectClipById, selectClipPathFromAssets } from '../src/editor-selectors'
import { setClipStabilization, setClipStabilizationBake } from '../src/editor-actions'
import { createInitialEditorState } from '../src/editor-state'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

const MEDIA_DURATION = 152.5
const ASSET: Asset = {
  id: 'asset-1',
  type: 'video',
  path: 'C:/media/IMG_4692.MOV',
  prompt: '',
  resolution: '1080x1920',
  duration: MEDIA_DURATION,
  createdAt: 0,
  proxyPath: 'C:/proxies/asset-1.mp4',
  proxyStatus: 'ready',
}

/** A bake made exactly the way the service would make one for this clip. */
function bakeFor(
  clip: TimelineClip,
  stab: Pick<ClipStabilization, 'smoothing' | 'mode'> = DEFAULT_CLIP_STABILIZATION,
): StabilizationBake {
  const range = stabilizationBakeRange(clipSourceRange(clip, MEDIA_DURATION), MEDIA_DURATION)
  return {
    path: 'C:/cache/stab.mp4',
    fingerprint: computeStabilizationFingerprint({ ...stab, ...range }),
    createdAt: 0,
    ...range,
  }
}

function stabilizedClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  const clip = createMockClip({ asset: ASSET, trimStart: 20, duration: 10, ...overrides })
  clip.trimEnd = overrides.trimEnd ?? MEDIA_DURATION - clip.trimStart - clip.duration * clip.speed
  return { ...clip, stabilization: { ...DEFAULT_CLIP_STABILIZATION, bake: bakeFor(clip) } }
}

const ctx = { mediaDuration: MEDIA_DURATION }

describe('stabilization schema', () => {
  it('fills defaults for a bare stabilization block', () => {
    expect(clipStabilizationSchema.parse({})).toEqual({ enabled: true, smoothing: 20, mode: 'auto' })
  })

  it('rejects smoothing outside the range the filter accepts', () => {
    expect(() => clipStabilizationSchema.parse({ smoothing: 2 })).toThrow()
    expect(() => clipStabilizationSchema.parse({ smoothing: 90 })).toThrow()
  })

  it('round-trips on a clip, and older clips without it still parse', () => {
    const base = createMockClip()
    expect(timelineClipSchema.parse(base).stabilization).toBeUndefined()
    const withStab = timelineClipSchema.parse({ ...base, stabilization: { smoothing: 30, mode: 'tripod' } })
    expect(withStab.stabilization).toEqual({ enabled: true, smoothing: 30, mode: 'tripod' })
  })
})

describe('source range', () => {
  it('reads the range from the trims when the media length is known', () => {
    const clip = createMockClip({ trimStart: 5, trimEnd: 100, duration: 999 })
    expect(clipSourceRange(clip, 120)).toEqual({ sourceStart: 5, sourceSpan: 15 })
  })

  it('falls back to duration × speed without the media length', () => {
    const clip = createMockClip({ trimStart: 4, duration: 3, speed: 2 })
    expect(clipSourceRange(clip)).toEqual({ sourceStart: 4, sourceSpan: 6 })
  })

  it('adds a handle each side but never leaves the media', () => {
    expect(stabilizationBakeRange({ sourceStart: 20, sourceSpan: 10 }, 60)).toEqual({ sourceStart: 19, sourceSpan: 12 })
    expect(stabilizationBakeRange({ sourceStart: 0.4, sourceSpan: 10 }, 60)).toEqual({ sourceStart: 0, sourceSpan: 11.4 })
    expect(stabilizationBakeRange({ sourceStart: 55, sourceSpan: 4.5 }, 60)).toEqual({ sourceStart: 54, sourceSpan: 6 })
  })
})

describe('fingerprint', () => {
  const params = { smoothing: 20, mode: 'auto' as const, sourceStart: 19, sourceSpan: 12 }

  it('parses back into its key and range', () => {
    const fp = computeStabilizationFingerprint(params)
    expect(parseStabilizationFingerprint(fp)).toEqual({
      key: stabilizationBakeKey(params),
      range: { sourceStart: 19, sourceSpan: 12 },
    })
    expect(parseStabilizationFingerprint('matte_0123456789abcdef_0_1000')).toBeNull()
  })

  it('is stable, and changes with anything that changes the pixels', () => {
    const fp = computeStabilizationFingerprint(params)
    expect(computeStabilizationFingerprint({ ...params })).toBe(fp)
    expect(computeStabilizationFingerprint({ ...params, smoothing: 30 })).not.toBe(fp)
    expect(computeStabilizationFingerprint({ ...params, mode: 'tripod' })).not.toBe(fp)
    expect(computeStabilizationFingerprint({ ...params, sourceStart: 18 })).not.toBe(fp)
  })

  it('keys on the smoothing the filter will get, not the raw slider value', () => {
    expect(clampStabilizationSmoothing(20.4)).toBe(20)
    expect(stabilizationBakeKey({ smoothing: 20.4, mode: 'auto' }))
      .toBe(stabilizationBakeKey({ smoothing: 20, mode: 'auto' }))
  })
})

describe('bake validity', () => {
  it('holds while the clip trims inside the bake, and breaks past its handle', () => {
    const clip = stabilizedClip()
    const bake = clip.stabilization!.bake!
    const check = (sourceStart: number, sourceSpan: number) => isStabilizationBakeValid(bake, {
      smoothing: 20, mode: 'auto', need: { sourceStart, sourceSpan },
    })
    expect(check(20, 10)).toBe(true)
    expect(check(22, 5)).toBe(true)
    expect(check(19.5, 11)).toBe(true)
    expect(check(18, 10)).toBe(false)
    expect(check(20, 12)).toBe(false)
  })

  it('breaks when the settings change', () => {
    const clip = stabilizedClip()
    const bake = clip.stabilization!.bake!
    const need = { sourceStart: 20, sourceSpan: 10 }
    expect(isStabilizationBakeValid(bake, { smoothing: 30, mode: 'auto', need })).toBe(false)
    expect(isStabilizationBakeValid(bake, { smoothing: 20, mode: 'tripod', need })).toBe(false)
    expect(isStabilizationBakeValid({ ...bake, fingerprint: 'nonsense' }, { smoothing: 20, mode: 'auto', need })).toBe(false)
  })

  it('never serves a bake of another media file', () => {
    const clip = stabilizedClip()
    const bake = { ...clip.stabilization!.bake!, assetKey: 'a' }
    const need = { sourceStart: 20, sourceSpan: 10 }
    expect(isStabilizationBakeValid(bake, { smoothing: 20, mode: 'auto', need, assetKey: 'b' })).toBe(false)
  })

  it('asks for a bake only when stabilization is on and nothing usable exists', () => {
    const clip = stabilizedClip()
    expect(clipNeedsStabilizationBake(clip, ctx)).toBe(false)
    expect(clipNeedsStabilizationBake({ ...clip, stabilization: { ...clip.stabilization!, bake: undefined } }, ctx)).toBe(true)
    expect(clipNeedsStabilizationBake({ ...clip, stabilization: { ...clip.stabilization!, smoothing: 40 } }, ctx)).toBe(true)
    expect(clipNeedsStabilizationBake({ ...clip, stabilization: { ...clip.stabilization!, enabled: false, bake: undefined } }, ctx)).toBe(false)
    expect(clipNeedsStabilizationBake({ ...clip, type: 'image', stabilization: { ...DEFAULT_CLIP_STABILIZATION } }, ctx)).toBe(false)
    expect(clipNeedsStabilizationBake(createMockClip(), ctx)).toBe(false)
  })
})

describe('resolving a stabilized clip', () => {
  it('points at the bake and shifts both trims into its time', () => {
    // Clip shows source 20..30; bake covers 19..31.
    const clip = stabilizedClip()
    const resolved = resolveStabilizedClip(clip, ctx)
    expect(resolved.asset?.path).toBe('C:/cache/stab.mp4')
    expect(resolved.asset?.duration).toBe(12)
    expect(resolved.trimStart).toBe(1)
    expect(resolved.trimEnd).toBe(1)
    expect(resolved.duration).toBe(clip.duration)
    expect(resolved.startTime).toBe(clip.startTime)
  })

  it('shows the same source frames as the original', () => {
    const clip = stabilizedClip()
    const resolved = resolveStabilizedClip(clip, ctx)
    const bake = clip.stabilization!.bake!
    // First frame of the clip, as a source second of the original media.
    expect(bake.sourceStart + resolved.trimStart).toBe(clip.trimStart)
    // Last frame, counted back from the end of each file — how a reversed clip is placed.
    expect(bake.sourceStart + (resolved.asset!.duration! - resolved.trimEnd)).toBeCloseTo(MEDIA_DURATION - clip.trimEnd, 6)
  })

  it('keeps the mapping for a reversed clip', () => {
    const clip = stabilizedClip({ reversed: true })
    const resolved = resolveStabilizedClip(clip, ctx)
    expect(resolved.reversed).toBe(true)
    // The preview seeks a reversed clip to `duration - trimEnd` of the file it plays.
    const originalSeek = MEDIA_DURATION - clip.trimEnd
    const resolvedSeek = resolved.asset!.duration! - resolved.trimEnd
    expect(clip.stabilization!.bake!.sourceStart + resolvedSeek).toBeCloseTo(originalSeek, 6)
  })

  it('keeps the mapping for a sped-up clip', () => {
    // 5 timeline seconds at 2x eat 10 source seconds.
    const clip = stabilizedClip({ duration: 5, speed: 2 })
    const resolved = resolveStabilizedClip(clip, ctx)
    expect(resolved.speed).toBe(2)
    expect(resolved.trimStart).toBe(1)
    expect(resolved.trimEnd).toBe(1)
  })

  it('drops the proxy, which is of the unstabilized frames', () => {
    const resolved = resolveStabilizedClip(stabilizedClip(), ctx)
    expect(resolved.asset?.proxyPath).toBeUndefined()
    expect(resolved.asset?.proxyStatus).toBeUndefined()
  })

  it('returns the clip itself when there is nothing to swap', () => {
    const plain = createMockClip({ asset: ASSET })
    expect(resolveStabilizedClip(plain, ctx)).toBe(plain)

    const clip = stabilizedClip()
    const off = { ...clip, stabilization: { ...clip.stabilization!, enabled: false } }
    expect(resolveStabilizedClip(off, ctx)).toBe(off)

    // Trimmed out past the bake: play the original rather than the wrong frames.
    const extended = { ...clip, trimStart: 10, duration: 20 }
    expect(resolveStabilizedClip(extended, ctx)).toBe(extended)
    expect(stabilizedSourceForClip(extended, ctx)).toBeNull()
  })

  it('does not touch the original clip', () => {
    const clip = stabilizedClip()
    const before = JSON.stringify(clip)
    resolveStabilizedClip(clip, ctx)
    expect(JSON.stringify(clip)).toBe(before)
  })
})

describe('filters', () => {
  it('builds the detect pass', () => {
    expect(buildVidstabDetectFilter({ smoothing: 20, mode: 'auto' }, 'motion.trf'))
      .toBe('vidstabdetect=shakiness=8:accuracy=15:result=motion.trf')
    expect(buildVidstabDetectFilter({ smoothing: 20, mode: 'tripod' }, 'motion.trf'))
      .toBe('vidstabdetect=shakiness=8:accuracy=15:result=motion.trf:tripod=1')
  })

  it('builds the transform pass with the tested settings', () => {
    expect(buildVidstabTransformFilter({ smoothing: 20, mode: 'auto' }, 'motion.trf'))
      .toBe('vidstabtransform=input=motion.trf:smoothing=20:optzoom=1:interpol=bilinear,unsharp=5:5:0.8:3:3:0.4')
    expect(buildVidstabTransformFilter({ smoothing: 99, mode: 'tripod' }, 'motion.trf', { debug: true }))
      .toBe('vidstabtransform=input=motion.trf:smoothing=60:optzoom=1:interpol=bilinear:tripod=1:debug=1,unsharp=5:5:0.8:3:3:0.4')
  })

  it('escapes a Windows path so its drive colon does not end the option', () => {
    expect(escapeFilterPath("C:\\Users\\me\\it's.trf")).toBe("C\\:/Users/me/it\\'s.trf")
  })
})

describe('reading the bake log', () => {
  it('reads the last reported zoom', () => {
    const log = [
      '[vidstabtransform @ 0x1] Final zoom: 1.5',
      '[vidstabtransform @ 0x2] Final zoom: 2.347967',
    ].join('\n')
    expect(parseVidstabFinalZoom(log)).toBeCloseTo(2.347967)
    expect(parseVidstabFinalZoom('nothing here')).toBeNull()
  })

  it('parses global motions and keeps unmeasured frames in place', () => {
    const text = [
      '0 0 0 0 0 1',
      '# no fields',
      '0 -0.510617 -0.748194 -0.000154 -0.096451 0',
      '#\t\t\t\t\t 0.803530 2',
      '0 1.5 2.5 0.01 0 0',
    ].join('\n')
    expect(parseVidstabGlobalMotions(text)).toEqual([
      { dx: 0, dy: 0, angle: 0 },
      { dx: 0, dy: 0, angle: 0 },
      { dx: -0.510617, dy: -0.748194, angle: -0.000154 },
      { dx: 1.5, dy: 2.5, angle: 0.01 },
    ])
  })
})

describe('analysis', () => {
  const still = (n: number): GlobalMotion[] => Array.from({ length: n }, (_, i) => ({ dx: (i % 3) * 0.05, dy: 0.02, angle: 0 }))

  it('flags a sudden jump in a still shot as an occlusion', () => {
    // A locked-off 1080-wide shot at 30 fps, with a hand crossing the lens at frame 150.
    const motions = still(300)
    motions[150] = { dx: 60, dy: -40, angle: 0.02 }
    motions[151] = { dx: -30, dy: 20, angle: 0 }
    const report = analyzeStabilization({ motions, fps: 30, frameWidth: 1080, sourceStart: 70 })
    expect(report.warnings).toEqual(['occlusion'])
    expect(report.warningTimes).toEqual([75])
  })

  it('merges jumps that belong to one event', () => {
    const motions = still(300)
    for (const i of [100, 105, 112]) motions[i] = { dx: 70, dy: 0, angle: 0 }
    const report = analyzeStabilization({ motions, fps: 30, frameWidth: 1080, sourceStart: 0 })
    expect(report.warningTimes).toHaveLength(1)
  })

  it('does not flag handheld jitter or a steady pan', () => {
    const handheld = Array.from({ length: 300 }, (_, i) => ({ dx: Math.sin(i) * 4, dy: Math.cos(i * 1.3) * 3, angle: 0 }))
    const pan = Array.from({ length: 300 }, () => ({ dx: 50, dy: 1, angle: 0 }))
    for (const motions of [handheld, pan]) {
      expect(analyzeStabilization({ motions, fps: 30, frameWidth: 1080, sourceStart: 0 }).warnings).toEqual([])
    }
  })

  it('flags a crop large enough to notice', () => {
    expect(analyzeStabilization({ motions: [], fps: 30, frameWidth: 1080, sourceStart: 0, zoomPercent: 6.3 }).warnings).toEqual([])
    expect(analyzeStabilization({ motions: [], fps: 30, frameWidth: 1080, sourceStart: 0, zoomPercent: 14 }).warnings).toEqual(['highZoom'])
  })
})

describe('renderer integration helpers', () => {
  const assets = [ASSET]

  it('recognises a resolved clip by its own asset path, and nothing else', () => {
    const clip = stabilizedClip()
    expect(stabilizedClipPath(clip)).toBeNull()
    const resolved = resolveStabilizedClip(clip, ctx)
    expect(stabilizedClipPath(resolved)).toBe('C:/cache/stab.mp4')
    expect(stabilizedClipPath({ ...resolved, stabilization: { ...resolved.stabilization!, enabled: false } })).toBeNull()
  })

  it('makes the path selector play the bake for a resolved clip only', () => {
    const clip = stabilizedClip()
    expect(selectClipPathFromAssets(assets, clip)).toBe(ASSET.path)
    expect(selectClipPathFromAssets(assets, resolveStabilizedClip(clip, ctx))).toBe('C:/cache/stab.mp4')
  })

  it('resolves a clip list, keeping the array when nothing is stabilized', () => {
    const plain = [createMockClip({ asset: ASSET })]
    expect(resolveStabilizedClips(plain, assets)).toBe(plain)
    const mixed = [plain[0], stabilizedClip()]
    const out = resolveStabilizedClips(mixed, assets)
    expect(out).not.toBe(mixed)
    expect(out[0]).toBe(mixed[0])
    expect(out[1].trimStart).toBe(1)
  })

  it('reads the media length from the live asset', () => {
    const clip = stabilizedClip()
    expect(stabilizationContextForClip(clip, [{ id: 'asset-1', duration: 99 }])).toEqual({ mediaDuration: 99, assetKey: 'asset-1' })
    expect(stabilizationContextForClip(clip, [])).toEqual({ mediaDuration: MEDIA_DURATION, assetKey: 'asset-1' })
  })

  it('reports a clip as pending until a fitting bake exists', () => {
    const ready = stabilizedClip()
    expect(isStabilizationPending(ready, assets)).toBe(false)
    expect(clipAsPlayed(ready, assets).trimStart).toBe(1)
    const waiting = { ...ready, stabilization: { ...ready.stabilization!, smoothing: 45 } }
    expect(isStabilizationPending(waiting, assets)).toBe(true)
    expect(clipAsPlayed(waiting, assets)).toBe(waiting)
    expect(isStabilizationPending(createMockClip({ asset: ASSET }), assets)).toBe(false)
  })
})

describe('stabilization actions', () => {
  function stateWith(clip: TimelineClip) {
    const timeline = createMockTimeline([clip])
    return createInitialEditorState({ assets: [ASSET], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
  }

  it('turns stabilization on with defaults, merges changes, and removes it', () => {
    let state = stateWith(createMockClip({ id: 'c', asset: ASSET }))
    state = setClipStabilization(state, 'c', {})
    expect(selectClipById(state, 'c')?.stabilization).toEqual(DEFAULT_CLIP_STABILIZATION)
    state = setClipStabilization(state, 'c', { smoothing: 33.6, mode: 'tripod' })
    expect(selectClipById(state, 'c')?.stabilization).toMatchObject({ smoothing: 34, mode: 'tripod', enabled: true })
    state = setClipStabilization(state, 'c', null)
    expect(selectClipById(state, 'c')?.stabilization).toBeUndefined()
  })

  it('keeps the old bake when a setting changes', () => {
    const clip = stabilizedClip({ id: 'c' })
    const state = setClipStabilization(stateWith(clip), 'c', { smoothing: 40 })
    expect(selectClipById(state, 'c')?.stabilization?.bake).toEqual(clip.stabilization!.bake)
  })

  it('only stabilizes video clips', () => {
    const state = stateWith(createMockClip({ id: 'i', type: 'image', asset: ASSET }))
    expect(setClipStabilization(state, 'i', {})).toBe(state)
  })

  it('records and forgets a bake, and ignores clips without stabilization', () => {
    const clip = stabilizedClip({ id: 'c' })
    const bake = clip.stabilization!.bake!
    let state = stateWith({ ...clip, stabilization: { ...clip.stabilization!, bake: undefined } })
    state = setClipStabilizationBake(state, 'c', bake)
    expect(selectClipById(state, 'c')?.stabilization?.bake).toBe(bake)
    expect(setClipStabilizationBake(state, 'c', bake)).toBe(state)
    state = setClipStabilizationBake(state, 'c', undefined)
    expect(selectClipById(state, 'c')?.stabilization?.bake).toBeUndefined()

    const plain = stateWith(createMockClip({ id: 'p' }))
    expect(setClipStabilizationBake(plain, 'p', bake)).toBe(plain)
  })
})

describe('matte media keys', () => {
  it('matches the main process key against a renderer path', () => {
    expect(sameMediaKey('c:\\users\\me\\stab.mp4', 'C:/Users/me/stab.mp4')).toBe(true)
    expect(sameMediaKey('c:\\users\\me\\stab.mp4', 'C:/Users/me/other.mp4')).toBe(false)
  })
})
