/**
 * KE-1805 — Tests for FramePairCoordinator.
 *
 * Verifies the Sprint 20 invariant: when matte is enabled, the coordinator
 * never tells the renderer to present the raw source. It either presents
 * source + alpha (synced or stale), holds the last composite, or skips.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FramePairCoordinator } from '../src/frame-pair-coordinator'
import type { MatteReadinessInput } from '../src/matte-preview-policy'
import type { SourceFrameEntry } from '../src/source-frame-index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(id: number, pts?: number): SourceFrameEntry {
  return {
    frameId: id,
    pts: pts ?? id * 33333,
    duration: 33333,
    dts: pts ?? id * 33333,
    isKeyframe: id % 30 === 0,
  }
}

function readyInput(overrides?: Partial<MatteReadinessInput>): MatteReadinessInput {
  return {
    matteEnabled: true,
    hasBake: true,
    bakeFailed: false,
    hasValidTexture: true,
    drift: 0,
    isInferring: false,
    hasCachedResult: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FramePairCoordinator', () => {
  let coord: FramePairCoordinator

  beforeEach(() => {
    coord = new FramePairCoordinator()
  })

  describe('generation management', () => {
    it('starts at generation 0', () => {
      expect(coord.getGeneration()).toBe(0)
    })

    it('nextGeneration increments and resets last presented', () => {
      const gen = coord.nextGeneration()
      expect(gen).toBe(1)
      expect(coord.getState().lastPresentedSourceFrame).toBeNull()
    })

    it('setMatteEnabled bumps generation', () => {
      coord.setMatteEnabled(true)
      expect(coord.getGeneration()).toBe(1)
      // Setting same value does not bump again
      coord.setMatteEnabled(true)
      expect(coord.getGeneration()).toBe(1)
    })

    it('isGenerationCurrent checks correctly', () => {
      expect(coord.isGenerationCurrent(0)).toBe(true)
      coord.nextGeneration()
      expect(coord.isGenerationCurrent(0)).toBe(false)
      expect(coord.isGenerationCurrent(1)).toBe(true)
    })
  })

  describe('without matte (matteEnabled = false)', () => {
    it('always presents source frames', () => {
      const frame = makeFrame(42)
      const d = coord.decide(frame, -1, readyInput({ matteEnabled: false }), 0)
      expect(d.action).toBe('present')
      expect(d.sourceFrame?.frameId).toBe(42)
      expect(d.alphaSynced).toBe(true) // no matte to sync
    })
  })

  describe('with matte enabled', () => {
    beforeEach(() => {
      coord.setMatteEnabled(true)
    })

    it('presents when alpha is ready and synced', () => {
      const frame = makeFrame(10)
      const gen = coord.getGeneration()
      const d = coord.decide(frame, 10, readyInput(), gen)
      expect(d.action).toBe('present')
      expect(d.alphaSynced).toBe(true)
      expect(d.readiness).toBe('ready')
    })

    it('does not present when readiness says ready but the alpha id is wrong', () => {
      const frame = makeFrame(10)
      const gen = coord.getGeneration()
      const d = coord.decide(frame, 8, readyInput(), gen)
      expect(d.action).toBe('skip')
      expect(d.alphaSynced).toBe(false)
      expect(coord.getState().lastPresentedSourceFrame).toBeNull()
    })

    it('holds when matte is stale', () => {
      // First present a good frame
      const gen = coord.getGeneration()
      coord.decide(makeFrame(5), 5, readyInput(), gen)

      // Now stale
      const d = coord.decide(
        makeFrame(10),
        5,
        readyInput({ drift: 1.0 }), // > STALE_MATTE_SECONDS
        gen,
      )
      expect(d.action).toBe('hold')
      expect(d.sourceFrame?.frameId).toBe(5) // last presented, not current
    })

    it('holds when matte is preparing', () => {
      const gen = coord.getGeneration()
      // First present
      coord.decide(makeFrame(5), 5, readyInput(), gen)

      const d = coord.decide(
        makeFrame(10),
        -1,
        readyInput({ hasValidTexture: false, isInferring: true }),
        gen,
      )
      expect(d.action).toBe('hold')
    })

    it('holds when matte has error', () => {
      const gen = coord.getGeneration()
      coord.decide(makeFrame(5), 5, readyInput(), gen)

      const d = coord.decide(
        makeFrame(10),
        -1,
        readyInput({ hasValidTexture: false, bakeFailed: true }),
        gen,
      )
      expect(d.action).toBe('hold')
      expect(d.readiness).toBe('error')
    })

    it('skips (never raw source) when matte is missing and no prior frame', () => {
      // First frame after enabling matte — no inference has run yet
      const gen = coord.getGeneration()
      const d = coord.decide(
        makeFrame(0),
        -1,
        readyInput({ matteEnabled: true, hasBake: false, hasValidTexture: false }),
        gen,
      )
      expect(d.action).toBe('skip')
      expect(d.readiness).toBe('missing')
      expect(d.sourceFrame).toBeNull()
      expect(d.alphaSynced).toBe(false)
    })

    // SPRINT 20 INVARIANT: never show raw source when matte is enabled
    it('INVARIANT: never returns present without alpha when readiness is stale/preparing/error', () => {
      const gen = coord.getGeneration()
      // Present one good frame first
      coord.decide(makeFrame(0), 0, readyInput(), gen)

      const problematicStates: Array<Partial<MatteReadinessInput>> = [
        { drift: 1.0 }, // stale
        { hasValidTexture: false, isInferring: true }, // preparing
        { hasValidTexture: false, bakeFailed: true }, // error
      ]

      for (const state of problematicStates) {
        const d = coord.decide(makeFrame(10), -1, readyInput(state), gen)
        // Must NOT be 'present' with a new source frame — that would expose raw source
        if (d.action === 'present') {
          // If presenting, it must be the HELD frame, not the new one
          expect(d.sourceFrame?.frameId).not.toBe(10)
        } else {
          expect(d.action).toBe('hold')
        }
      }
    })
  })

  describe('stale generation', () => {
    it('skips requests from old generation', () => {
      const oldGen = coord.getGeneration()
      coord.nextGeneration()
      const d = coord.decide(makeFrame(10), 10, readyInput(), oldGen)
      expect(d.action).toBe('skip')
    })
  })

  describe('reset', () => {
    it('returns to initial state', () => {
      coord.setMatteEnabled(true)
      coord.nextGeneration()
      coord.nextGeneration()
      coord.reset()
      expect(coord.getGeneration()).toBe(0)
      expect(coord.getState().matteEnabled).toBe(false)
      expect(coord.getState().lastPresentedSourceFrame).toBeNull()
    })
  })

  describe('rapid scrub simulation', () => {
    it('holds stale composite during 100-frame scrub', () => {
      coord.setMatteEnabled(true)
      const gen = coord.getGeneration()

      // Present one good frame at the start
      coord.decide(makeFrame(0), 0, readyInput(), gen)

      // Simulate 100 rapid scrub positions where alpha lags
      let holdCount = 0
      for (let i = 1; i <= 100; i++) {
        const d = coord.decide(
          makeFrame(i),
          0, // alpha still on frame 0
          readyInput({ drift: i * 0.033 }), // increasing drift
          gen,
        )
        if (i * 0.033 > 0.5) {
          // Past stale threshold
          expect(d.action).toBe('hold')
          holdCount++
        }
      }
      expect(holdCount).toBeGreaterThan(0)
    })
  })
})
