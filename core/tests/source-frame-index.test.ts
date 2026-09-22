/**
 * KE-1803 — Tests for SourceFrameIndex: the canonical time-to-frame mapping.
 *
 * These tests verify that preview, bake and export all select the same source
 * frame for the same timeline position, across CFR/VFR/B-frame media with
 * trim, speed, and reverse applied.
 */

import { describe, it, expect } from 'vitest'
import {
  buildSourceFrameIndex,
  findFrameAtTime,
  resolveSourceFrame,
  timelineToSourceTimeUs,
  findNearestKeyframeBefore,
  validateBakeManifestV2,
  bakeOrdinalForSourceFrame,
  BAKE_MANIFEST_VERSION,
  type SourceFrameIndex,
  type BakeManifestV2,
} from '../src/source-frame-index'
import {
  cfr30fps5s,
  cfr24fps3s,
  cfr25fps4s,
  cfr60fps2s,
  vfrPhoneRecording,
  cfr30fpsWithBFrames,
  basicMappingCfr30,
  trimmedMappingCfr30,
  speed2xMappingCfr30,
  speed05xMappingCfr30,
  reversedMappingCfr30,
  type FixtureFrameEntry,
} from './matte-sync-fixtures'

// ---------------------------------------------------------------------------
// Helper: build an index from fixture entries
// ---------------------------------------------------------------------------

function indexFromFixture(entries: FixtureFrameEntry[], opts?: Partial<{ rotation: number; durationUs: number }>): SourceFrameIndex {
  const last = entries[entries.length - 1]
  const durationUs = opts?.durationUs ?? (last ? last.pts + last.duration : 0)
  return buildSourceFrameIndex(
    entries.map(e => ({
      pts: e.pts,
      duration: e.duration,
      dts: e.dts,
      isKeyframe: e.isKeyframe,
    })),
    {
      assetRevision: 'test-rev',
      timebaseNum: 1,
      timebaseDen: 1_000_000,
      rotation: opts?.rotation ?? 0,
      durationUs,
    },
  )
}

// ---------------------------------------------------------------------------
// buildSourceFrameIndex
// ---------------------------------------------------------------------------

describe('buildSourceFrameIndex', () => {
  it('sorts entries by PTS and assigns sequential frame ids', () => {
    const index = indexFromFixture(cfr30fps5s())
    expect(index.frameCount).toBe(150)
    expect(index.entries[0].frameId).toBe(0)
    expect(index.entries[0].pts).toBe(0)
    expect(index.entries[149].frameId).toBe(149)
  })

  it('handles B-frames: entries sorted by PTS not DTS', () => {
    const index = indexFromFixture(cfr30fpsWithBFrames())
    // PTS should be monotonically increasing
    for (let i = 1; i < index.entries.length; i++) {
      expect(index.entries[i].pts).toBeGreaterThanOrEqual(index.entries[i - 1].pts)
    }
    // But some entries have DTS < PTS
    const bFrames = index.entries.filter(e => e.dts < e.pts)
    expect(bFrames.length).toBeGreaterThan(0)
  })

  it('preserves VFR frame durations', () => {
    const index = indexFromFixture(vfrPhoneRecording())
    const durations = new Set(index.entries.map(e => e.duration))
    expect(durations.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// findFrameAtTime — half-open interval selection
// ---------------------------------------------------------------------------

describe('findFrameAtTime', () => {
  const index = indexFromFixture(cfr30fps5s())
  const fd = 33333 // frame duration µs

  it('time 0 → first frame', () => {
    const f = findFrameAtTime(index, 0)
    expect(f?.frameId).toBe(0)
  })

  it('time in middle of frame 0 → frame 0', () => {
    const f = findFrameAtTime(index, fd / 2)
    expect(f?.frameId).toBe(0)
  })

  it('time at exact boundary of frame 1 → frame 1 (half-open)', () => {
    // Frame 0 owns [0, fd). Time = fd is the start of frame 1.
    const f = findFrameAtTime(index, fd)
    expect(f?.frameId).toBe(1)
  })

  it('time just before frame 1 → frame 0', () => {
    const f = findFrameAtTime(index, fd - 1)
    expect(f?.frameId).toBe(0)
  })

  it('time past last frame → last frame', () => {
    const f = findFrameAtTime(index, 999_999_999)
    expect(f?.frameId).toBe(149)
  })

  it('negative time → first frame', () => {
    const f = findFrameAtTime(index, -100)
    expect(f?.frameId).toBe(0)
  })

  it('empty index → null', () => {
    const empty = buildSourceFrameIndex([], {
      assetRevision: 'empty', timebaseNum: 1, timebaseDen: 1_000_000,
      rotation: 0, durationUs: 0,
    })
    expect(findFrameAtTime(empty, 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findFrameAtTime with VFR
// ---------------------------------------------------------------------------

describe('findFrameAtTime VFR', () => {
  const index = indexFromFixture(vfrPhoneRecording())

  it('finds correct frame in 30fps region', () => {
    // First 30 frames are 30fps, frame duration ~33333µs
    const f = findFrameAtTime(index, 15 * 33333)
    expect(f?.frameId).toBe(15)
  })

  it('finds correct frame in 15fps region', () => {
    // After 30 frames (1s of 30fps), next segment is 15fps (66667µs per frame)
    // Frame 30 starts at 30 * 33333 = 999990µs
    const frame30Start = 30 * 33333
    const frame30Duration = 66667 // 15fps
    const f = findFrameAtTime(index, frame30Start + frame30Duration / 2)
    expect(f?.frameId).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// resolveSourceFrame — combined timeline→source mapping
// ---------------------------------------------------------------------------

describe('resolveSourceFrame', () => {
  const index = indexFromFixture(cfr30fps5s())

  describe('basic (no trim, speed 1x, not reversed)', () => {
    for (const tc of basicMappingCfr30()) {
      it(tc.label, () => {
        const f = resolveSourceFrame(index, tc.timelineTime, 0, 1, false)
        expect(f).not.toBeNull()
        expect(f!.frameId).toBe(tc.expectedFrameId)
      })
    }
  })

  describe('trimmed (trimStart=2s)', () => {
    for (const tc of trimmedMappingCfr30()) {
      it(tc.label, () => {
        const f = resolveSourceFrame(index, tc.timelineTime, 2, 1, false)
        expect(f).not.toBeNull()
        expect(f!.frameId).toBe(tc.expectedFrameId)
      })
    }
  })

  describe('speed 2x', () => {
    for (const tc of speed2xMappingCfr30()) {
      it(tc.label, () => {
        const f = resolveSourceFrame(index, tc.timelineTime, 0, 2, false)
        expect(f).not.toBeNull()
        expect(f!.frameId).toBe(tc.expectedFrameId)
      })
    }
  })

  describe('speed 0.5x', () => {
    for (const tc of speed05xMappingCfr30()) {
      it(tc.label, () => {
        const f = resolveSourceFrame(index, tc.timelineTime, 0, 0.5, false)
        expect(f).not.toBeNull()
        expect(f!.frameId).toBe(tc.expectedFrameId)
      })
    }
  })

  describe('reversed', () => {
    for (const tc of reversedMappingCfr30()) {
      it(tc.label, () => {
        const f = resolveSourceFrame(index, tc.timelineTime, 0, 1, true)
        expect(f).not.toBeNull()
        expect(f!.frameId).toBe(tc.expectedFrameId)
      })
    }
  })
})

// ---------------------------------------------------------------------------
// timelineToSourceTimeUs edge cases
// ---------------------------------------------------------------------------

describe('timelineToSourceTimeUs', () => {
  const durationUs = 5_000_000 // 5s

  it('clamps to [0, duration)', () => {
    // Way past the end
    const t = timelineToSourceTimeUs(100, 0, 1, false, durationUs)
    expect(t).toBeLessThan(durationUs)
    expect(t).toBeGreaterThanOrEqual(0)
  })

  it('handles NaN speed as 1x', () => {
    const t = timelineToSourceTimeUs(1, 0, NaN, false, durationUs)
    expect(t).toBe(1_000_000)
  })

  it('handles zero speed as 1x', () => {
    const t = timelineToSourceTimeUs(1, 0, 0, false, durationUs)
    expect(t).toBe(1_000_000)
  })

  it('handles negative speed as 1x', () => {
    const t = timelineToSourceTimeUs(1, 0, -2, false, durationUs)
    expect(t).toBe(1_000_000)
  })
})

// ---------------------------------------------------------------------------
// findNearestKeyframeBefore
// ---------------------------------------------------------------------------

describe('findNearestKeyframeBefore', () => {
  const index = indexFromFixture(cfr30fps5s())

  it('returns the keyframe at a keyframe position', () => {
    // Frame 30 is a keyframe (every 30 frames)
    const kf = findNearestKeyframeBefore(index, 30 * 33333)
    expect(kf?.frameId).toBe(30)
    expect(kf?.isKeyframe).toBe(true)
  })

  it('walks back to previous keyframe', () => {
    // Frame 45 is not a keyframe, nearest before is 30
    const kf = findNearestKeyframeBefore(index, 45 * 33333)
    expect(kf?.frameId).toBe(30)
    expect(kf?.isKeyframe).toBe(true)
  })

  it('returns first frame if nothing before', () => {
    const kf = findNearestKeyframeBefore(index, 5 * 33333)
    expect(kf?.frameId).toBe(0)
    expect(kf?.isKeyframe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Same source frame for source and alpha
// ---------------------------------------------------------------------------

describe('source/alpha always pick same frame', () => {
  const index = indexFromFixture(cfr30fps5s())

  it('1000 random seeks return deterministic frames', () => {
    // The point: if preview and bake both call resolveSourceFrame with the
    // same inputs, they get the same frame id.
    const seeks = Array.from({ length: 1000 }, (_, i) => (i * 4.999) / 999)
    const sourceFrames = seeks.map(t => resolveSourceFrame(index, t, 0, 1, false)?.frameId)
    const alphaFrames = seeks.map(t => resolveSourceFrame(index, t, 0, 1, false)?.frameId)
    expect(sourceFrames).toEqual(alphaFrames)
  })

  it('trim + speed: same result for both', () => {
    const seeks = [0, 0.5, 1.0, 1.5, 2.0]
    const sourceFrames = seeks.map(t => resolveSourceFrame(index, t, 1, 2, false)?.frameId)
    const alphaFrames = seeks.map(t => resolveSourceFrame(index, t, 1, 2, false)?.frameId)
    expect(sourceFrames).toEqual(alphaFrames)
  })
})

// ---------------------------------------------------------------------------
// BakeManifestV2 validation
// ---------------------------------------------------------------------------

describe('BakeManifestV2', () => {
  const validManifest: BakeManifestV2 = {
    version: BAKE_MANIFEST_VERSION,
    assetRevision: 'sha256:abc123',
    model: 'rvm-mobilenetv3',
    modelHash: 'sha256:model123',
    pipelineVersion: 1,
    geometry: '1920x1080',
    rotation: 0,
    timebase: [1, 30],
    alphaRange: [0, 255],
    frameMap: [
      { ordinal: 0, sourceFrameId: 0, sourcePts: 0 },
      { ordinal: 1, sourceFrameId: 1, sourcePts: 33333 },
      { ordinal: 2, sourceFrameId: 2, sourcePts: 66666 },
    ],
    coverageActual: { sourceStart: 0, sourceSpan: 0.1 },
    status: 'complete',
    completedAt: '2026-09-21T00:00:00Z',
  }

  it('validates a correct manifest', () => {
    const issues = validateBakeManifestV2(validManifest)
    expect(issues).toHaveLength(0)
  })

  it('detects zero-frame complete manifest', () => {
    const issues = validateBakeManifestV2({
      ...validManifest,
      frameMap: [],
    })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toContain('zero frames')
  })

  it('detects ordinal gap', () => {
    const issues = validateBakeManifestV2({
      ...validManifest,
      frameMap: [
        { ordinal: 0, sourceFrameId: 0, sourcePts: 0 },
        { ordinal: 2, sourceFrameId: 2, sourcePts: 66666 }, // gap: missing ordinal 1
      ],
    })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toContain('ordinal gap')
  })

  it('detects negative coverage', () => {
    const issues = validateBakeManifestV2({
      ...validManifest,
      coverageActual: { sourceStart: 0, sourceSpan: -1 },
    })
    expect(issues.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// bakeOrdinalForSourceFrame
// ---------------------------------------------------------------------------

describe('bakeOrdinalForSourceFrame', () => {
  const manifest: BakeManifestV2 = {
    version: BAKE_MANIFEST_VERSION,
    assetRevision: 'test',
    model: 'rvm-mobilenetv3',
    modelHash: 'test',
    pipelineVersion: 1,
    geometry: '1920x1080',
    rotation: 0,
    timebase: [1, 30],
    alphaRange: [0, 255],
    frameMap: Array.from({ length: 150 }, (_, i) => ({
      ordinal: i,
      sourceFrameId: i,
      sourcePts: i * 33333,
    })),
    coverageActual: { sourceStart: 0, sourceSpan: 5 },
    status: 'complete',
    completedAt: '2026-09-21T00:00:00Z',
  }

  it('finds ordinal for existing source frame', () => {
    expect(bakeOrdinalForSourceFrame(manifest, 0)).toBe(0)
    expect(bakeOrdinalForSourceFrame(manifest, 75)).toBe(75)
    expect(bakeOrdinalForSourceFrame(manifest, 149)).toBe(149)
  })

  it('returns -1 for missing source frame', () => {
    expect(bakeOrdinalForSourceFrame(manifest, 200)).toBe(-1)
    expect(bakeOrdinalForSourceFrame(manifest, -1)).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// Cross-rate consistency
// ---------------------------------------------------------------------------

describe('cross-rate consistency', () => {
  const rates = [
    { name: 'CFR 24fps', entries: cfr24fps3s() },
    { name: 'CFR 25fps', entries: cfr25fps4s() },
    { name: 'CFR 30fps', entries: cfr30fps5s() },
    { name: 'CFR 60fps', entries: cfr60fps2s() },
    { name: 'VFR phone', entries: vfrPhoneRecording() },
    { name: 'B-frames', entries: cfr30fpsWithBFrames() },
  ]

  for (const { name, entries } of rates) {
    it(`${name}: first and last frame are reachable`, () => {
      const index = indexFromFixture(entries)
      const first = resolveSourceFrame(index, 0, 0, 1, false)
      expect(first?.frameId).toBe(0)

      const lastEntry = entries[entries.length - 1]
      const lastTimeSec = lastEntry.pts / 1_000_000
      const last = resolveSourceFrame(index, lastTimeSec, 0, 1, false)
      expect(last?.frameId).toBe(entries.length - 1)
    })

    it(`${name}: no gaps — every frame id is reachable`, () => {
      const index = indexFromFixture(entries)
      const reachable = new Set<number>()
      // Sample at every frame's midpoint
      for (const entry of entries) {
        const midSec = (entry.pts + entry.duration / 2) / 1_000_000
        const f = resolveSourceFrame(index, midSec, 0, 1, false)
        if (f) reachable.add(f.frameId)
      }
      expect(reachable.size).toBe(entries.length)
    })
  }
})
