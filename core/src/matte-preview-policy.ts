/**
 * When the preview is allowed to run the matting model on a frame.
 *
 * This lives in core, with tests, because getting it wrong does not degrade the preview —
 * it makes the whole app unusable. Two ways that happened:
 *
 * 1. **The feedback loop.** The preview canvas redraws when a matte arrives, and a redraw
 *    asks for the matte. With no "this is the frame I already did" check, the two called
 *    each other forever, running inference back to back while the playhead sat still.
 * 2. **Per-frame inference during playback.** Inference runs on the renderer's own thread,
 *    and each frame also costs a canvas readback and a quarter-million-element conversion
 *    loop. At the frame rate, that leaves nothing for the interface.
 *
 * The accurate path during playback is the baked matte, which costs the preview nothing.
 * Live inference is only for the window before a bake exists.
 */

/** Floor on the gap between two live inferences during playback (about 12 per second). */
export const LIVE_INFERENCE_MIN_INTERVAL_MS = 80

/** Two timestamps closer than this are the same frame. */
export const SAME_FRAME_EPSILON = 1e-3

export interface MattePreviewDecisionInput {
  /** The request is for a different clip than the last one. */
  clipChanged: boolean
  /** Absolute difference between this request's time and the last one's, in seconds. */
  timestampDelta: number
  /** A matte for this clip is already in hand. */
  hasCached: boolean
  isPlaying: boolean
  provider: 'webgpu' | 'wasm'
  /** Milliseconds since the last inference started. */
  msSinceLastInference: number
  /** Caller insists, e.g. the user just changed something that must be reflected. */
  force?: boolean
}

export type MattePreviewDecision = 'infer' | 'cached'

export function decideMattePreview(input: MattePreviewDecisionInput): MattePreviewDecision {
  if (input.force) return 'infer'

  // Nothing to reuse yet — the first frame of a clip always runs.
  if (!input.hasCached) return 'infer'

  // Same frame as last time. This is the check that breaks the redraw loop.
  if (!input.clipChanged && Math.abs(input.timestampDelta) < SAME_FRAME_EPSILON) {
    return 'cached'
  }

  if (input.isPlaying) {
    // On CPU there is no rate that is safe, so playback reuses the last matte outright.
    if (input.provider === 'wasm') return 'cached'
    if (input.msSinceLastInference < LIVE_INFERENCE_MIN_INTERVAL_MS) return 'cached'
  }

  return 'infer'
}

/** How far out of step the matte may drift before it is worth a seek. */
export const SEEK_TOLERANCE_SECONDS = 0.12

/**
 * Minimum gap between two seeks of the matte video.
 *
 * Tolerance says how tight the sync should be; this says how often we are allowed to
 * reach for it. Keeping them separate is what stops the correction turning into a storm:
 * a seek interrupts decoding, which puts the video further out, which used to justify
 * another seek immediately.
 */
export const SEEK_COOLDOWN_MS = 250

/** Drift past this means the matte on screen no longer belongs to this picture. */
export const STALE_MATTE_SECONDS = 0.5

/** Below this the matte is close enough that seeking would cost more than it fixes. */
export const SEEK_DEADBAND_SECONDS = 1 / 120

export interface BakeMatteSyncInput {
  /** |matte video position − where it should be|, in seconds. */
  drift: number
  isPlaying: boolean
  /** The matte video has a decoded frame available. */
  ready: boolean
  /** Milliseconds since the last seek was issued. */
  msSinceLastSeek: number
}

export interface BakeMatteSyncDecision {
  seek: boolean
  /** Upload this frame as the matte. */
  use: boolean
  /** Stop applying the matte entirely — what is on screen is too old to belong here. */
  drop: boolean
}

/**
 * How the baked matte video is kept in step with the picture.
 *
 * Three failures this encodes against, all seen in the app:
 *
 * - **Seeking a playing video on every small drift.** A seek interrupts decoding, which
 *   creates more drift, which justifies another seek. The matte ends up pinned near one
 *   position while the picture moves on. Handled by the cooldown, not by loosening the
 *   tolerance — the matte still has to stay close.
 * - **Trusting a decoded frame because it is decoded.** Whether a frame exists says
 *   nothing about whether it belongs to *this* moment. A matte video that stalls still
 *   reports a frame, and that frame kept being pasted over a face that had moved on. What
 *   makes a matte usable is its distance in time from the picture, so that is what decides.
 * - **Holding the last good matte forever.** Past a point a stale silhouette is wrong, so
 *   this used to drop the matte entirely once drift passed STALE_MATTE_SECONDS.
 *
 *   That was reversed on 18/09/2026. Dropping the matte does not show "no matte" — it
 *   shows the picture **uncut**, which means the background the user removed comes back.
 *   On a full-length clip the matte video drifts routinely (two 1080x1920 streams decoding
 *   in step, plus a correction seek that costs a few hundred milliseconds), so playback
 *   alternated between cut-out and background, and the first seconds after opening a
 *   project had no cut-out at all while the matte video was still cold. Reported twice as
 *   a bug, and rightly: revealing removed background is the one outcome the feature exists
 *   to prevent.
 *
 *   So a stale matte is now HELD rather than dropped — `use: false, drop: false` leaves the
 *   texture already on the GPU in place. The silhouette lags by a fraction of a second and
 *   the seek logic pulls it back; nothing ever exposes the background. Only the caller's
 *   own failure paths (a matte video that will not load at all) turn the matte off.
 */
export function decideBakeMatteSync(input: BakeMatteSyncInput): BakeMatteSyncDecision {
  const drift = Math.abs(input.drift)
  const tooFar = drift > STALE_MATTE_SECONDS

  const wantsSeek = input.isPlaying
    ? drift > SEEK_TOLERANCE_SECONDS && input.msSinceLastSeek >= SEEK_COOLDOWN_MS
    : drift > SEEK_DEADBAND_SECONDS

  return {
    seek: wantsSeek && drift > SEEK_DEADBAND_SECONDS,
    use: input.ready && !tooFar,
    // Staleness alone never drops the matte. See the note above for why this reversed.
    drop: false,
  }
}

// ---------------------------------------------------------------------------
// MatteReadiness — unified state for the matte pipeline
// ---------------------------------------------------------------------------

/**
 * Summary of the matte pipeline's readiness.
 *
 * This replaces the scattered booleans (`hasValidMatteRef`, `matteEnabled`,
 * `bakeFailedRef`) with a single enum that the compositing stack and LutCanvas
 * both read to decide what to show.
 *
 * Invariant: when `autoMatte.enabled` is true and readiness is NOT 'ready',
 * the compositor must NOT show the raw source — it shows the last valid
 * composite or hides the layer entirely.
 */
export type MatteReadiness =
  | 'ready'       // Alpha is present and matches the current source frame.
  | 'preparing'   // Alpha is being computed/sought; show last valid composite.
  | 'stale'       // Alpha exists but belongs to a different frame; hold it.
  | 'error'       // Pipeline failed (load error, inference crash); notify user.
  | 'missing'     // No bake, no live inference, no cached result at all.

export interface MatteReadinessInput {
  /** Whether autoMatte is enabled on the clip. */
  matteEnabled: boolean
  /** A bake file exists and is usable. */
  hasBake: boolean
  /** The bake video failed to load. */
  bakeFailed: boolean
  /** A valid matte texture is currently on the GPU. */
  hasValidTexture: boolean
  /** Drift between source and matte, seconds. */
  drift: number
  /** Live inference is currently running. */
  isInferring: boolean
  /** A cached inference result exists for this clip. */
  hasCachedResult: boolean
}

/**
 * Resolves the matte readiness from the current pipeline state.
 *
 * This is a pure function — the caller reads refs and passes values, and the
 * decision is deterministic. LutCanvas and MonitorCompositingStack both call
 * this so they agree on visibility.
 */
export function resolveMatteReadiness(input: MatteReadinessInput): MatteReadiness {
  if (!input.matteEnabled) return 'missing'

  // Error state: bake is present but can't load
  if (input.hasBake && input.bakeFailed) return 'error'

  // Ready: valid texture with acceptable drift
  if (input.hasValidTexture && input.drift <= STALE_MATTE_SECONDS) return 'ready'

  // Stale: we have a texture but it's too far from the current frame
  if (input.hasValidTexture && input.drift > STALE_MATTE_SECONDS) return 'stale'

  // Preparing: inference is running or bake is being loaded
  if (input.isInferring || (input.hasBake && !input.bakeFailed)) return 'preparing'

  // We have a cached result we could upload
  if (input.hasCachedResult) return 'preparing'

  // Nothing at all
  return 'missing'
}
