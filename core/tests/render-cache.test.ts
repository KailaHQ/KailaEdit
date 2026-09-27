import { describe, it, expect } from 'vitest'
import {
  fastHash64,
  findComplexSegments,
  computeSegmentContentHash,
  previewFrameSize,
  MAX_CACHE_SEGMENT_SECONDS,
} from '../src/render-cache'
import {
  timelineClipSchema,
  type Timeline,
  type TimelineClip,
} from '../src/index'

function makeClip(overrides: Partial<TimelineClip> & { id: string; trackIndex: number; startTime: number; duration: number }): TimelineClip {
  return timelineClipSchema.parse({
    type: 'video',
    assetId: null,
    asset: null,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    flipH: false,
    flipV: false,
    opacity: 100,
    ...overrides,
  })
}

function createTimeline(partial: Partial<Timeline>): Timeline {
  return {
    id: 'timeline-test',
    name: 'Test Timeline',
    createdAt: Date.now(),
    tracks: [
      { id: 't1', name: 'Track 1', type: 'default', muted: false, locked: false, kind: 'video', enabled: true },
      { id: 't2', name: 'Track 2', type: 'default', muted: false, locked: false, kind: 'video', enabled: true },
    ],
    clips: [],
    subtitles: [],
    ...partial,
  }
}

describe('fastHash64', () => {
  it('produces a deterministic 16-hex character string', () => {
    const hash1 = fastHash64('komfyedit_test_render_cache')
    const hash2 = fastHash64('komfyedit_test_render_cache')
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different hashes for different inputs', () => {
    const hashA = fastHash64('input_alpha')
    const hashB = fastHash64('input_beta')
    expect(hashA).not.toBe(hashB)
  })
})

describe('findComplexSegments', () => {
  it('returns empty array for empty or simple timeline', () => {
    expect(findComplexSegments(createTimeline({ clips: [] }))).toEqual([])

    const simpleTimeline = createTimeline({
      clips: [
        makeClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', trackIndex: 0, startTime: 5, duration: 5 }),
      ],
    })
    expect(findComplexSegments(simpleTimeline)).toEqual([])
  })

  it('detects transitions as complex segments', () => {
    const timeline = createTimeline({
      clips: [
        makeClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', trackIndex: 0, startTime: 4, duration: 5 }),
      ],
      transitions: [
        {
          id: 'tr1',
          trackIndex: 0,
          type: 'cross-fade',
          duration: 1,
          leftClipId: 'c1',
          rightClipId: 'c2',
        },
      ],
    })

    const segments = findComplexSegments(timeline)
    expect(segments.length).toBe(1)
    expect(segments[0].startTime).toBe(4)
    expect(segments[0].endTime).toBe(5)
    expect(segments[0].reasons).toContain('transition')
  })

  it('detects multi-track visual overlaps', () => {
    const timeline = createTimeline({
      clips: [
        makeClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 10 }),
        makeClip({ id: 'c2', trackIndex: 1, startTime: 3, duration: 4 }),
      ],
    })

    const segments = findComplexSegments(timeline)
    expect(segments.length).toBe(1)
    expect(segments[0].startTime).toBe(3)
    expect(segments[0].endTime).toBe(7)
    expect(segments[0].reasons).toContain('multi_layer')
  })

  it('detects non-normal blend modes and adjustments, while single-clip features render in-memory', () => {
    // Single-clip effects (chroma, autoMatte, speed) render in-memory in realtime without cache baking
    const chromaTimeline = createTimeline({
      clips: [
        makeClip({
          id: 'c1',
          trackIndex: 0,
          startTime: 2,
          duration: 3,
          chromaKey: { enabled: true, color: '#00ff00', similarity: 40, smoothness: 10, spill: 10 },
        }),
      ],
    })
    expect(findComplexSegments(chromaTimeline)).toEqual([])

    const autoMatteTimeline = createTimeline({
      clips: [
        makeClip({
          id: 'c-matte',
          trackIndex: 0,
          startTime: 2,
          duration: 3,
          autoMatte: { enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', featherEdge: 0, cleanEdge: 0 },
        }),
      ],
    })
    expect(findComplexSegments(autoMatteTimeline)).toEqual([])

    const speedTimeline = createTimeline({
      clips: [
        makeClip({
          id: 'spd1',
          trackIndex: 0,
          startTime: 0,
          duration: 2,
          speed: 10,
        }),
      ],
    })
    expect(findComplexSegments(speedTimeline)).toEqual([])

    // Heavy multi-layer or compositing features DO trigger complex segments
    const blendTimeline = createTimeline({
      clips: [
        makeClip({
          id: 'c3',
          trackIndex: 0,
          startTime: 0,
          duration: 2,
          blendMode: 'multiply',
        }),
      ],
    })
    const blendSegments = findComplexSegments(blendTimeline)
    expect(blendSegments.length).toBe(1)
    expect(blendSegments[0].reasons).toContain('blendmode')

    const adjTimeline = createTimeline({
      clips: [
        makeClip({
          id: 'adj1',
          trackIndex: 0,
          type: 'adjustment',
          startTime: 5,
          duration: 3,
        }),
      ],
    })
    const adjSegments = findComplexSegments(adjTimeline)
    expect(adjSegments.length).toBe(1)
    expect(adjSegments[0].reasons).toContain('adjustment')
  })

  it('merges adjacent or overlapping complex intervals', () => {
    const timeline = createTimeline({
      clips: [
        makeClip({
          id: 'c1',
          trackIndex: 0,
          startTime: 0,
          duration: 2,
          blendMode: 'multiply',
        }),
        makeClip({
          id: 'c2',
          trackIndex: 0,
          startTime: 2,
          duration: 3,
          type: 'adjustment',
        }),
      ],
    })

    const segments = findComplexSegments(timeline)
    expect(segments.length).toBe(1)
    expect(segments[0].startTime).toBe(0)
    expect(segments[0].endTime).toBe(5)
  })
})

describe('computeSegmentContentHash', () => {
  const baseTimeline = createTimeline({
    width: 1920,
    height: 1080,
    clips: [
      makeClip({
        id: 'c1',
        assetId: 'a1',
        trackIndex: 0,
        startTime: 0,
        duration: 5,
        trimStart: 1,
        trimEnd: 0,
        speed: 1,
        opacity: 100,
        filter: { id: 'lut_warm', intensity: 80 },
      }),
    ],
  })

  const segment = {
    id: 'seg-1',
    startTime: 0,
    endTime: 5,
    duration: 5,
    reasons: ['test'],
  }

  it('is deterministic for identical inputs', () => {
    const hash1 = computeSegmentContentHash(segment, baseTimeline, '480p')
    const hash2 = computeSegmentContentHash(segment, baseTimeline, '480p')
    expect(hash1).toBe(hash2)
  })

  it('invalidates when clip properties change', () => {
    const originalHash = computeSegmentContentHash(segment, baseTimeline, '480p')

    const timelineTrim = JSON.parse(JSON.stringify(baseTimeline))
    timelineTrim.clips[0].trimStart = 2
    expect(computeSegmentContentHash(segment, timelineTrim, '480p')).not.toBe(originalHash)

    const timelineFilter = JSON.parse(JSON.stringify(baseTimeline))
    timelineFilter.clips[0].filter.intensity = 50
    expect(computeSegmentContentHash(segment, timelineFilter, '480p')).not.toBe(originalHash)

    const timelineSpeed = JSON.parse(JSON.stringify(baseTimeline))
    timelineSpeed.clips[0].speed = 1.5
    expect(computeSegmentContentHash(segment, timelineSpeed, '480p')).not.toBe(originalHash)

    expect(computeSegmentContentHash(segment, baseTimeline, '720p')).not.toBe(originalHash)
  })

  it('invalidates when the frame shape changes', () => {
    const landscape = computeSegmentContentHash(segment, baseTimeline, '480p', 16 / 9)
    const portrait = computeSegmentContentHash(segment, baseTimeline, '480p', 9 / 16)
    expect(portrait).not.toBe(landscape)
  })
})

describe('previewFrameSize', () => {
  it('keeps the timeline shape, with the resolution on the short side', () => {
    expect(previewFrameSize('480p', 16 / 9)).toEqual({ width: 854, height: 480 })
    expect(previewFrameSize('480p', 9 / 16)).toEqual({ width: 480, height: 854 })
    expect(previewFrameSize('720p', 1)).toEqual({ width: 720, height: 720 })
    expect(previewFrameSize('360p', 4 / 5)).toEqual({ width: 360, height: 450 })
  })

  it('falls back to 16:9 without a usable ratio', () => {
    expect(previewFrameSize('480p')).toEqual({ width: 854, height: 480 })
    expect(previewFrameSize('480p', 0)).toEqual({ width: 854, height: 480 })
  })
})

/**
 * Added 18/09/2026, from a log where one 60 s segment was rendered twice, 250 s apart,
 * around a matte bake finishing.
 *
 * `autoMatte.bake` carries `createdAt: Date.now()`, and the whole object went into the
 * segment hash. Finishing a bake therefore invalidated every cached segment the clip
 * appeared in — even when the bake produced the same matte it already had — and the
 * segment renders started again. Those renders re-cut the clips, which could start
 * another bake, which invalidated the segments again.
 */
describe('computeSegmentContentHash: bake bookkeeping does not invalidate', () => {
  const withBake = (bake: Record<string, unknown>) =>
    createTimeline({
      width: 1920,
      height: 1080,
      clips: [
        makeClip({
          id: 'c1',
          assetId: 'a1',
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
            bake,
          },
        } as never),
      ],
    })

  const segment = { id: 'seg-1', startTime: 0, endTime: 5, duration: 5, reasons: ['matte'] }
  const bake = {
    path: '/cache/matte.mp4',
    fingerprint: 'matte_aaaaaaaaaaaaaaaa_0_5000',
    frameCount: 150,
    createdAt: 1_000,
  }

  it('ignores when the bake was made', () => {
    const before = computeSegmentContentHash(segment, withBake(bake), '480p')
    const after = computeSegmentContentHash(
      segment,
      withBake({ ...bake, createdAt: 9_999_999 }),
      '480p',
    )
    expect(after).toBe(before)
  })

  it('still invalidates for a different matte', () => {
    const before = computeSegmentContentHash(segment, withBake(bake), '480p')
    const other = computeSegmentContentHash(
      segment,
      withBake({ ...bake, fingerprint: 'matte_bbbbbbbbbbbbbbbb_0_5000' }),
      '480p',
    )
    expect(other).not.toBe(before)
  })

  it('still invalidates when the matte settings change', () => {
    const timeline = withBake(bake)
    const before = computeSegmentContentHash(segment, timeline, '480p')
    const feathered = JSON.parse(JSON.stringify(timeline))
    feathered.clips[0].autoMatte.featherEdge = 40
    expect(computeSegmentContentHash(segment, feathered, '480p')).not.toBe(before)
  })
})

/**
 * A segment is cached by rendering it, and that renderer will not produce more than
 * PREVIEW_MAX_SECONDS at a time. A longer segment came back truncated and was still
 * published as ready for its whole span, so the preview played the cache past the end of
 * the file and froze on the last frame.
 */
describe('findComplexSegments: nothing longer than the renderer will produce', () => {
  it('splits a long overlap into cacheable pieces that still cover it', () => {
    const timeline = createTimeline({
      clips: [
        makeClip({ id: 'base', assetId: 'a1', trackIndex: 0, startTime: 0, duration: 80 }),
        makeClip({ id: 'over', assetId: 'a2', trackIndex: 1, startTime: 0, duration: 80 }),
      ],
    })

    const segments = findComplexSegments(timeline)
    expect(segments.length).toBeGreaterThan(1)
    for (const seg of segments) {
      expect(seg.duration).toBeLessThanOrEqual(MAX_CACHE_SEGMENT_SECONDS + 1e-6)
    }

    // Contiguous, and together they still cover the whole overlap.
    expect(segments[0].startTime).toBeCloseTo(0, 3)
    expect(segments[segments.length - 1].endTime).toBeCloseTo(80, 3)
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startTime).toBeCloseTo(segments[i - 1].endTime, 3)
    }
  })

  it('leaves a short segment in one piece', () => {
    const timeline = createTimeline({
      clips: [
        makeClip({ id: 'base', assetId: 'a1', trackIndex: 0, startTime: 0, duration: 5 }),
        makeClip({ id: 'over', assetId: 'a2', trackIndex: 1, startTime: 0, duration: 5 }),
      ],
    })

    const segments = findComplexSegments(timeline)
    expect(segments).toHaveLength(1)
    expect(segments[0].duration).toBeCloseTo(5, 3)
  })
})
