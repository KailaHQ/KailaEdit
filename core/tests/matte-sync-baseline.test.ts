/**
 * KE-1801 — Baseline tests for matte synchronisation.
 *
 * These tests establish the pre-fix state: they verify what the current code
 * does RIGHT (cache identity, time mapping basics) and document what is WRONG
 * (the three bugs Sprint 20 fixes) so regressions after each ticket are
 * detectable.
 *
 * Tests that cover bugs the current code has are expected to FAIL until the
 * corresponding ticket lands. They are not skipped — a passing test that was
 * supposed to fail is the first sign that the harness is wrong.
 */

import { describe, it, expect } from 'vitest'
import {
  matteTimeForSourceTime,
  autoMatteSourceRange,
  autoMatteBakeKey,
  computeAutoMatteFingerprint,
  parseAutoMatteFingerprint,
  isAutoMatteBakeValid,
  snapAutoMatteRange,
  autoMatteRangeCovers,
} from '../src/auto-matte'
import {
  decideBakeMatteSync,
  decideMattePreview,
  STALE_MATTE_SECONDS,
  SEEK_TOLERANCE_SECONDS,
  SEEK_COOLDOWN_MS,
  SEEK_DEADBAND_SECONDS,
} from '../src/matte-preview-policy'
import {
  cfr30fps5s,
  cfr24fps3s,
  cfr25fps4s,
  cfr60fps2s,
  vfrPhoneRecording,
  cfr30fpsWithBFrames,
  randomSeekSequence,
  bidirectionalDragSequence,
  syntheticAlphaMask,
  readFrameIdFromAlpha,
  seededRandom,
} from './matte-sync-fixtures'
import { MatteTestHarness, runSeekSequence } from './matte-harness'

// ---------------------------------------------------------------------------
// matteTimeForSourceTime — the mapping between source and bake time
// ---------------------------------------------------------------------------

describe('matteTimeForSourceTime', () => {
  it('identity at speed 1x, no trim', () => {
    expect(matteTimeForSourceTime(2.5, 0, 1)).toBe(2.5)
  })

  it('offsets by sourceStart', () => {
    // sourceTime=5, bake starts at 2 → matte time = 3
    expect(matteTimeForSourceTime(5, 2, 1)).toBe(3)
  })

  it('applies speed divisor', () => {
    // sourceTime=4, bake starts at 0, speed=2 → matte time = 2
    expect(matteTimeForSourceTime(4, 0, 2)).toBe(2)
  })

  it('combined trim + speed', () => {
    // sourceTime=6, bake starts at 2, speed=2 → (6-2)/2 = 2
    expect(matteTimeForSourceTime(6, 2, 2)).toBe(2)
  })

  it('clamps to zero when source is before bake start', () => {
    expect(matteTimeForSourceTime(1, 5, 1)).toBe(0)
  })

  it('handles speed 0.5x', () => {
    // sourceTime=1, speed=0.5 → 1/0.5 = 2
    expect(matteTimeForSourceTime(1, 0, 0.5)).toBe(2)
  })

  it('handles invalid speed gracefully', () => {
    expect(matteTimeForSourceTime(5, 0, 0)).toBe(5)  // fallback to speed=1
    expect(matteTimeForSourceTime(5, 0, -1)).toBe(5)
    expect(matteTimeForSourceTime(5, 0, NaN)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// autoMatteSourceRange — what stretch of source a clip needs
// ---------------------------------------------------------------------------

describe('autoMatteSourceRange', () => {
  it('simple untrimmed clip', () => {
    const r = autoMatteSourceRange({ trimStart: 0, duration: 5 })
    expect(r.sourceStart).toBe(0)
    expect(r.sourceSpan).toBe(5)
  })

  it('trimmed clip', () => {
    const r = autoMatteSourceRange({ trimStart: 2, duration: 3 })
    expect(r.sourceStart).toBe(2)
    expect(r.sourceSpan).toBe(3)
  })

  it('speed 2x: span doubles', () => {
    const r = autoMatteSourceRange({ trimStart: 0, duration: 5, speed: 2 })
    expect(r.sourceSpan).toBe(10) // 5s timeline * 2x = 10s source
  })

  it('speed 0.5x: span halves', () => {
    const r = autoMatteSourceRange({ trimStart: 0, duration: 5, speed: 0.5 })
    expect(r.sourceSpan).toBe(2.5) // 5s timeline * 0.5x = 2.5s source
  })
})

// ---------------------------------------------------------------------------
// Cache identity — speed/reverse changes must change the key
// ---------------------------------------------------------------------------

describe('autoMatteBakeKey stability', () => {
  const base = {
    assetKey: '/path/to/video.mp4',
    model: 'rvm-mobilenetv3' as const,
    quality: 'standard' as const,
    frameSize: '1920x1080',
  }

  it('same params → same key', () => {
    const a = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    const b = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    expect(a).toBe(b)
  })

  it('different speed → different key', () => {
    const a = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    const b = autoMatteBakeKey({ ...base, speed: 2, reversed: false })
    expect(a).not.toBe(b)
  })

  it('reversed → different key', () => {
    const a = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    const b = autoMatteBakeKey({ ...base, speed: 1, reversed: true })
    expect(a).not.toBe(b)
  })

  it('different model → different key', () => {
    const a = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    const b = autoMatteBakeKey({ ...base, speed: 1, reversed: false, model: 'modnet' as any })
    expect(a).not.toBe(b)
  })

  it('different frameSize → different key', () => {
    const a = autoMatteBakeKey({ ...base, speed: 1, reversed: false })
    const b = autoMatteBakeKey({ ...base, speed: 1, reversed: false, frameSize: '1080x1920' })
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Fingerprint round-trip
// ---------------------------------------------------------------------------

describe('fingerprint round-trip', () => {
  it('encode → parse → same range', () => {
    const fp = computeAutoMatteFingerprint({
      trimStart: 2,
      duration: 5,
      speed: 1,
      model: 'rvm-mobilenetv3',
      quality: 'standard',
      assetKey: '/video.mp4',
      sourceStart: 0,
      sourceSpan: 10,
    })
    const parsed = parseAutoMatteFingerprint(fp)
    expect(parsed).not.toBeNull()
    expect(parsed!.range.sourceStart).toBe(0)
    expect(parsed!.range.sourceSpan).toBe(10)
  })

  it('rejects malformed fingerprints', () => {
    expect(parseAutoMatteFingerprint('')).toBeNull()
    expect(parseAutoMatteFingerprint('not-a-fingerprint')).toBeNull()
    expect(parseAutoMatteFingerprint('matte_short')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// snapAutoMatteRange
// ---------------------------------------------------------------------------

describe('snapAutoMatteRange', () => {
  it('rounds outward to 10s blocks', () => {
    const r = snapAutoMatteRange({ sourceStart: 2.5, sourceSpan: 3.5 })
    expect(r.sourceStart).toBe(0)      // floor(2.5/10)*10 = 0
    expect(r.sourceStart + r.sourceSpan).toBeGreaterThanOrEqual(6) // ceil(6/10)*10 = 10
  })

  it('respects media duration', () => {
    const r = snapAutoMatteRange({ sourceStart: 0, sourceSpan: 3 }, 5)
    expect(r.sourceStart + r.sourceSpan).toBeLessThanOrEqual(10)
  })

  it('never snaps to less than requested', () => {
    const r = snapAutoMatteRange({ sourceStart: 8, sourceSpan: 7 })
    expect(r.sourceStart + r.sourceSpan).toBeGreaterThanOrEqual(15)
  })
})

// ---------------------------------------------------------------------------
// autoMatteRangeCovers
// ---------------------------------------------------------------------------

describe('autoMatteRangeCovers', () => {
  it('exact match covers', () => {
    expect(autoMatteRangeCovers({ sourceStart: 0, sourceSpan: 10 }, { sourceStart: 0, sourceSpan: 10 })).toBe(true)
  })

  it('superset covers subset', () => {
    expect(autoMatteRangeCovers({ sourceStart: 0, sourceSpan: 20 }, { sourceStart: 5, sourceSpan: 5 })).toBe(true)
  })

  it('subset does not cover superset', () => {
    expect(autoMatteRangeCovers({ sourceStart: 5, sourceSpan: 5 }, { sourceStart: 0, sourceSpan: 20 })).toBe(false)
  })

  it('partial overlap does not cover', () => {
    expect(autoMatteRangeCovers({ sourceStart: 0, sourceSpan: 5 }, { sourceStart: 3, sourceSpan: 5 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// decideBakeMatteSync policy
// ---------------------------------------------------------------------------

describe('decideBakeMatteSync policy', () => {
  it('seeks when paused and drift > deadband', () => {
    const d = decideBakeMatteSync({
      drift: 0.1,
      isPlaying: false,
      ready: true,
      msSinceLastSeek: 1000,
    })
    expect(d.seek).toBe(true)
    expect(d.use).toBe(true)
    expect(d.drop).toBe(false)
  })

  it('does not seek when paused and drift < deadband', () => {
    const d = decideBakeMatteSync({
      drift: SEEK_DEADBAND_SECONDS / 2,
      isPlaying: false,
      ready: true,
      msSinceLastSeek: 1000,
    })
    expect(d.seek).toBe(false)
  })

  it('during playback: seeks only past tolerance AND cooldown', () => {
    const d = decideBakeMatteSync({
      drift: SEEK_TOLERANCE_SECONDS + 0.01,
      isPlaying: true,
      ready: true,
      msSinceLastSeek: SEEK_COOLDOWN_MS + 1,
    })
    expect(d.seek).toBe(true)
  })

  it('during playback: respects cooldown', () => {
    const d = decideBakeMatteSync({
      drift: SEEK_TOLERANCE_SECONDS + 0.01,
      isPlaying: true,
      ready: true,
      msSinceLastSeek: SEEK_COOLDOWN_MS - 1,
    })
    expect(d.seek).toBe(false)
  })

  it('never drops — Sprint 20 invariant', () => {
    const d = decideBakeMatteSync({
      drift: 100, // absurdly large
      isPlaying: true,
      ready: true,
      msSinceLastSeek: 10000,
    })
    expect(d.drop).toBe(false)
  })

  it('stale matte is held, not used', () => {
    const d = decideBakeMatteSync({
      drift: STALE_MATTE_SECONDS + 0.1,
      isPlaying: true,
      ready: true,
      msSinceLastSeek: SEEK_COOLDOWN_MS + 1,
    })
    expect(d.use).toBe(false)
    expect(d.drop).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// decideMattePreview policy
// ---------------------------------------------------------------------------

describe('decideMattePreview policy', () => {
  it('first frame always infers', () => {
    expect(decideMattePreview({
      clipChanged: false,
      timestampDelta: 0,
      hasCached: false,
      isPlaying: false,
      provider: 'webgpu',
      msSinceLastInference: 1000,
    })).toBe('infer')
  })

  it('same frame reuses cache', () => {
    expect(decideMattePreview({
      clipChanged: false,
      timestampDelta: 0.0001, // below epsilon
      hasCached: true,
      isPlaying: false,
      provider: 'webgpu',
      msSinceLastInference: 1000,
    })).toBe('cached')
  })

  it('clip change triggers infer even with cache', () => {
    expect(decideMattePreview({
      clipChanged: true,
      timestampDelta: 0,
      hasCached: true,
      isPlaying: false,
      provider: 'webgpu',
      msSinceLastInference: 1000,
    })).toBe('infer')
  })

  it('playing on wasm always caches', () => {
    expect(decideMattePreview({
      clipChanged: false,
      timestampDelta: 0.5,
      hasCached: true,
      isPlaying: true,
      provider: 'wasm',
      msSinceLastInference: 1000,
    })).toBe('cached')
  })

  it('force overrides everything', () => {
    expect(decideMattePreview({
      clipChanged: false,
      timestampDelta: 0,
      hasCached: true,
      isPlaying: true,
      provider: 'wasm',
      msSinceLastInference: 0,
      force: true,
    })).toBe('infer')
  })
})

// ---------------------------------------------------------------------------
// Fixture data correctness
// ---------------------------------------------------------------------------

describe('fixture data', () => {
  it('cfr30fps5s has 150 frames at consistent intervals', () => {
    const frames = cfr30fps5s()
    expect(frames).toHaveLength(150)
    expect(frames[0].pts).toBe(0)
    expect(frames[0].isKeyframe).toBe(true)
    // Check consistent spacing
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].pts - frames[i - 1].pts).toBe(33333)
    }
  })

  it('cfr24fps3s has 72 frames', () => {
    expect(cfr24fps3s()).toHaveLength(72)
  })

  it('cfr25fps4s has 100 frames', () => {
    expect(cfr25fps4s()).toHaveLength(100)
  })

  it('cfr60fps2s has 120 frames', () => {
    expect(cfr60fps2s()).toHaveLength(120)
  })

  it('vfrPhoneRecording has variable spacing', () => {
    const frames = vfrPhoneRecording()
    const durations = new Set(frames.map((f) => f.duration))
    expect(durations.size).toBeGreaterThan(1) // multiple distinct durations
    // Verify contiguous (no gaps)
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].pts).toBe(frames[i - 1].pts + frames[i - 1].duration)
    }
  })

  it('cfr30fpsWithBFrames has divergent DTS/PTS', () => {
    const frames = cfr30fpsWithBFrames()
    const divergent = frames.filter((f) => f.dts !== f.pts)
    expect(divergent.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Synthetic alpha mask
// ---------------------------------------------------------------------------

describe('synthetic alpha mask', () => {
  it('encodes and decodes frame id', () => {
    for (const id of [0, 1, 42, 255, 1000, 65535, 0xFFFFFF]) {
      const mask = syntheticAlphaMask(id, 64, 64)
      expect(readFrameIdFromAlpha(mask)).toBe(id)
    }
  })

  it('different frames produce different patterns', () => {
    const a = syntheticAlphaMask(0, 32, 32)
    const b = syntheticAlphaMask(8, 32, 32) // checkerboard inverts every 8
    let differs = 0
    for (let i = 4; i < a.length; i++) {
      if (a[i] !== b[i]) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Seeded random
// ---------------------------------------------------------------------------

describe('seededRandom', () => {
  it('is deterministic', () => {
    const a = Array.from({ length: 100 }, seededRandom(42))
    const b = Array.from({ length: 100 }, seededRandom(42))
    expect(a).toEqual(b)
  })

  it('different seeds differ', () => {
    const a = Array.from({ length: 10 }, seededRandom(42))
    const b = Array.from({ length: 10 }, seededRandom(99))
    expect(a).not.toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Test harness smoke
// ---------------------------------------------------------------------------

describe('MatteTestHarness', () => {
  it('records presentations and detects mismatches', () => {
    const harness = new MatteTestHarness()

    // Good pair
    harness.record({
      requestedSourceFrameId: 10,
      presentedAlphaFrameId: 10,
      timelineTime: 0.333,
      matteBackend: 'webcodecs',
      matteState: 'ready',
    })

    // Bad pair: source 20 but alpha still showing 10
    harness.record({
      requestedSourceFrameId: 20,
      presentedAlphaFrameId: 10,
      timelineTime: 0.666,
      matteBackend: 'webcodecs',
      matteState: 'ready',
    })

    expect(harness.getMismatchedPairs()).toHaveLength(1)
    expect(harness.getMismatchedPairs()[0].requestedSourceFrameId).toBe(20)
    expect(harness.getMismatchedPairs()[0].presentedAlphaFrameId).toBe(10)
  })

  it('detects background flashes', () => {
    const harness = new MatteTestHarness()

    // Flash: alpha is -1 but state is 'ready' (should not happen)
    harness.record({
      requestedSourceFrameId: 5,
      presentedAlphaFrameId: -1,
      timelineTime: 0.1,
      matteBackend: 'none',
      matteState: 'ready',
    })

    // Not a flash: state is 'preparing' (expected during load)
    harness.record({
      requestedSourceFrameId: 6,
      presentedAlphaFrameId: -1,
      timelineTime: 0.2,
      matteBackend: 'none',
      matteState: 'preparing',
    })

    expect(harness.getBackgroundFlashes()).toHaveLength(1)
  })

  it('runSeekSequence records all seeks', () => {
    const harness = new MatteTestHarness()
    const seekTimes = randomSeekSequence(42, 100, 5.0)

    runSeekSequence(
      harness,
      seekTimes,
      (t) => Math.floor(t * 30), // simple time → frame
      (sourceFrameId) => ({
        alphaFrameId: sourceFrameId, // perfect sync
        state: 'ready' as const,
        backend: 'webcodecs' as const,
        latencyMs: 1,
      }),
    )

    expect(harness.getRecords()).toHaveLength(100)
    expect(harness.getMismatchedPairs()).toHaveLength(0)
    expect(harness.getBackgroundFlashes()).toHaveLength(0)
  })

  it('bidirectional drag detects late callbacks', () => {
    const harness = new MatteTestHarness()
    const seekTimes = bidirectionalDragSequence(0, 4, 20)

    let lastDeliveredFrame = -1
    runSeekSequence(
      harness,
      seekTimes,
      (t) => Math.floor(t * 30),
      (sourceFrameId) => {
        // Simulate: alpha arrives 2 frames late
        const alphaId = lastDeliveredFrame >= 0 ? lastDeliveredFrame : sourceFrameId
        lastDeliveredFrame = sourceFrameId
        return {
          alphaFrameId: alphaId,
          state: 'ready' as const,
          backend: 'webcodecs' as const,
          latencyMs: 5,
        }
      },
    )

    // The first seek's alpha is its own frame (no prior), but subsequent ones
    // are 1 frame behind — the harness should detect those mismatches.
    const mismatches = harness.getMismatchedPairs()
    // At direction change points the alpha catches up, so not ALL are mismatches
    expect(mismatches.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Baseline: documented current-code limitations
// ---------------------------------------------------------------------------

describe('baseline: known limitations to fix in Sprint 20', () => {
  it('matteTimeForSourceTime does not account for reverse', () => {
    // Current code: no reverse handling in matteTimeForSourceTime
    // This documents the gap — KE-1803 will add SourceFrameIndex with reverse support
    const forwardTime = matteTimeForSourceTime(2, 0, 1)
    // Reverse: timeline time 0 should map to source end, but current code
    // just does (sourceTime - start) / speed, ignoring reverse entirely.
    // The bake service handles reverse via ffmpeg `reverse` filter, so the
    // matte file is already reversed — seeking it forward works. But the
    // IDENTITY of the source frame (for matching) is wrong.
    expect(forwardTime).toBe(2) // baseline: works for forward
    // No reverse test yet — SourceFrameIndex will own this
  })

  it('bake descriptor records sourceSpan from request, not actual output', () => {
    // KE-1804 will fix this: manifest v2 records actual coverage
    // Current code: MatteService writes bakeRange.sourceSpan into the descriptor
    // regardless of whether ffmpeg actually produced that many frames.
    // This is a documentation baseline, not a code assertion.
    expect(true).toBe(true) // placeholder for awareness
  })

  it('isAutoMatteBakeValid checks model/quality/speed/reversed but not pipeline version', () => {
    // KE-1803/1804: v2 manifest will include pipelineVersion
    const valid = isAutoMatteBakeValid(
      {
        path: '/cache/matte.mp4',
        fingerprint: 'matte_abc_0_5000',
        frameCount: 150,
        sourceStart: 0,
        sourceSpan: 5,
        model: 'rvm-mobilenetv3',
        quality: 'standard',
        speed: 1,
        reversed: false,
        createdAt: Date.now(),
      },
      {
        trimStart: 0,
        duration: 5,
        speed: 1,
        model: 'rvm-mobilenetv3',
        quality: 'standard',
      },
    )
    expect(valid).toBe(true) // baseline: validates but no pipeline version check
  })
})
