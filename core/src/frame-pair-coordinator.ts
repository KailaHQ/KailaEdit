/**
 * FramePairCoordinator — the single authority for "should the renderer present
 * this source frame, and if so, which alpha goes with it?"
 *
 * Every path that presents a frame (playback, scrub, seek, snap-to-still)
 * calls this coordinator. The coordinator ensures the Sprint 20 invariant:
 *
 *   "When autoMatte is enabled, the renderer NEVER shows the raw source.
 *    It shows source + alpha (correct pair), or the previous complete composite,
 *    or nothing at all — but never the uncut source."
 *
 * The coordinator is a pure state machine, not a React component. LutCanvas
 * and MonitorCompositingStack both read it, so they agree on what to present.
 *
 * Lives in core because the decision logic must be testable without a DOM.
 */

import {
  resolveMatteReadiness,
  type MatteReadiness,
  type MatteReadinessInput,
} from './matte-preview-policy'
import type { SourceFrameEntry } from './source-frame-index'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the coordinator tells the renderer to do with this frame. */
export type FrameAction =
  | 'present'    // Show source + alpha together.
  | 'hold'       // Keep the last composite on screen (stale alpha is better than raw source).
  | 'skip'       // Drop this frame entirely (e.g. during fast scrub).

export interface FramePairDecision {
  action: FrameAction
  /** The source frame to present (null if action is 'hold' or 'skip'). */
  sourceFrame: SourceFrameEntry | null
  /** Whether the alpha matches the source (false when holding stale). */
  alphaSynced: boolean
  /** Matte readiness at the time of the decision. */
  readiness: MatteReadiness
  /** Generation counter — monotonically increasing. */
  generation: number
}

export interface FramePairState {
  /** Monotonically increasing; bumped on clip/bake/project switch. */
  generation: number
  /** The last source frame that was actually presented. */
  lastPresentedSourceFrame: SourceFrameEntry | null
  /** The last alpha frame id that was presented (-1 = none). */
  lastPresentedAlphaFrameId: number
  /** Whether autoMatte is currently enabled on the active clip. */
  matteEnabled: boolean
  /** Timestamp of the last seek or scrub, ms (performance.now). */
  lastSeekAt: number
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

/**
 * FramePairCoordinator is instantiated per compositing canvas.
 *
 * It holds no GPU state — it only decides. The renderer reads the decision and
 * does the actual draw/upload/skip.
 */
export class FramePairCoordinator {
  private state: FramePairState = {
    generation: 0,
    lastPresentedSourceFrame: null,
    lastPresentedAlphaFrameId: -1,
    matteEnabled: false,
    lastSeekAt: 0,
  }

  /** Returns the current generation counter. */
  getGeneration(): number {
    return this.state.generation
  }

  /** Bump generation — call on clip switch, bake path change, project load. */
  nextGeneration(): number {
    this.state.generation++
    this.state.lastPresentedSourceFrame = null
    this.state.lastPresentedAlphaFrameId = -1
    return this.state.generation
  }

  /** Update whether matte is active on the current clip. */
  setMatteEnabled(enabled: boolean): void {
    if (this.state.matteEnabled !== enabled) {
      this.state.matteEnabled = enabled
      // Switching matte on/off is a generation boundary
      this.state.generation++
      this.state.lastPresentedSourceFrame = null
      this.state.lastPresentedAlphaFrameId = -1
    }
  }

  /** Record that a seek/scrub just happened. */
  recordSeek(now: number): void {
    this.state.lastSeekAt = now
  }

  /**
   * Decide what to do with the current frame.
   *
   * @param sourceFrame - The source frame the renderer wants to present.
   * @param alphaFrameId - The alpha frame id currently available (-1 = none).
   * @param readinessInput - Current matte pipeline state.
   * @param generation - The generation the request was made for.
   */
  decide(
    sourceFrame: SourceFrameEntry | null,
    alphaFrameId: number,
    readinessInput: MatteReadinessInput,
    generation: number,
  ): FramePairDecision {
    // Stale generation — the request was for a superseded clip/bake
    if (generation !== this.state.generation) {
      return {
        action: 'skip',
        sourceFrame: null,
        alphaSynced: false,
        readiness: 'missing',
        generation: this.state.generation,
      }
    }

    const readiness = resolveMatteReadiness(readinessInput)

    // No matte active — always present
    if (!this.state.matteEnabled) {
      if (sourceFrame) {
        this.state.lastPresentedSourceFrame = sourceFrame
      }
      return {
        action: 'present',
        sourceFrame,
        alphaSynced: true, // No matte to be out of sync with
        readiness,
        generation: this.state.generation,
      }
    }

    // Matte is enabled — apply the Sprint 20 invariant
    switch (readiness) {
      case 'ready': {
        // Alpha is fresh and matches the source
        const synced = alphaFrameId === sourceFrame?.frameId
        if (!sourceFrame || !synced || alphaFrameId < 0) {
          return {
            action: this.state.lastPresentedSourceFrame ? 'hold' : 'skip',
            sourceFrame: this.state.lastPresentedSourceFrame,
            alphaSynced: false,
            readiness: 'stale',
            generation: this.state.generation,
          }
        }
        if (sourceFrame) {
          this.state.lastPresentedSourceFrame = sourceFrame
          this.state.lastPresentedAlphaFrameId = alphaFrameId
        }
        return {
          action: 'present',
          sourceFrame,
          alphaSynced: synced,
          readiness,
          generation: this.state.generation,
        }
      }

      case 'stale': {
        // Alpha exists but belongs to a different frame.
        // HOLD the last composite — do NOT show the raw source.
        return {
          action: 'hold',
          sourceFrame: this.state.lastPresentedSourceFrame,
          alphaSynced: false,
          readiness,
          generation: this.state.generation,
        }
      }

      case 'preparing': {
        // Matte is being computed — hold the last composite
        return {
          action: 'hold',
          sourceFrame: this.state.lastPresentedSourceFrame,
          alphaSynced: false,
          readiness,
          generation: this.state.generation,
        }
      }

      case 'error': {
        // Pipeline failed — hold the last composite and let the UI show an error indicator
        return {
          action: 'hold',
          sourceFrame: this.state.lastPresentedSourceFrame,
          alphaSynced: false,
          readiness,
          generation: this.state.generation,
        }
      }

      case 'missing': {
        // Sprint 20 Invariant: Never present raw uncut source when autoMatte is enabled.
        // If a previous composite exists, hold it. Otherwise skip so canvas remains transparent
        // and timeline background shows rather than flashing raw uncut background.
        if (this.state.lastPresentedSourceFrame) {
          return {
            action: 'hold',
            sourceFrame: this.state.lastPresentedSourceFrame,
            alphaSynced: false,
            readiness,
            generation: this.state.generation,
          }
        }
        return {
          action: 'skip',
          sourceFrame: null,
          alphaSynced: false,
          readiness,
          generation: this.state.generation,
        }
      }
    }
  }

  /**
   * Check if a generation is still current.
   * Async callbacks use this to avoid uploading stale results.
   */
  isGenerationCurrent(generation: number): boolean {
    return generation === this.state.generation
  }

  /** Read-only access to the current state (for debugging/testing). */
  getState(): Readonly<FramePairState> {
    return { ...this.state }
  }

  /** Reset to initial state (for testing or project close). */
  reset(): void {
    this.state = {
      generation: 0,
      lastPresentedSourceFrame: null,
      lastPresentedAlphaFrameId: -1,
      matteEnabled: false,
      lastSeekAt: 0,
    }
  }
}
