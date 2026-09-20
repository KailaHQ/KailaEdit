import { describe, it, expect } from 'vitest'
import {
  decideMattePreview,
  decideBakeMatteSync,
  LIVE_INFERENCE_MIN_INTERVAL_MS,
  SEEK_COOLDOWN_MS,
  SEEK_TOLERANCE_SECONDS,
  STALE_MATTE_SECONDS,
  type MattePreviewDecisionInput,
  type BakeMatteSyncInput,
} from '../src/matte-preview-policy'

/**
 * Added 17/09/2026 after the app became unusable with background removal switched on.
 *
 * The preview canvas redraws when a matte arrives, and redrawing asks for a matte. Nothing
 * checked whether the request was for a frame already done, so the two ran in a loop — a
 * full ONNX inference, a canvas readback and a 250k-element conversion per turn, forever,
 * on the renderer's own thread, while the playhead sat still.
 */

const base: MattePreviewDecisionInput = {
  clipChanged: false,
  timestampDelta: 0,
  hasCached: true,
  isPlaying: false,
  provider: 'webgpu',
  msSinceLastInference: 10_000,
}

describe('decideMattePreview — breaking the redraw loop', () => {
  it('reuses the matte when asked again for the same paused frame', () => {
    // The loop: without this, a redraw triggers inference, which triggers a redraw.
    expect(decideMattePreview(base)).toBe('cached')
  })

  it('still reuses it however many times the canvas asks', () => {
    for (let i = 0; i < 100; i++) {
      expect(decideMattePreview(base)).toBe('cached')
    }
  })

  it('runs once for the first frame of a clip, when there is nothing to reuse', () => {
    expect(decideMattePreview({ ...base, hasCached: false })).toBe('infer')
  })

  it('runs again once the playhead actually moves', () => {
    expect(decideMattePreview({ ...base, timestampDelta: 0.04 })).toBe('infer')
  })

  it('runs again on a different clip even at the same timestamp', () => {
    expect(decideMattePreview({ ...base, clipChanged: true })).toBe('infer')
  })

  it('honours force, which is how a parameter change gets a fresh matte', () => {
    expect(decideMattePreview({ ...base, force: true })).toBe('infer')
    expect(decideMattePreview({ ...base, hasCached: false, force: true })).toBe('infer')
  })
})

describe('decideMattePreview — keeping playback smooth', () => {
  const playing: MattePreviewDecisionInput = {
    ...base,
    isPlaying: true,
    timestampDelta: 1 / 30,
  }

  it('never infers during playback on CPU', () => {
    expect(decideMattePreview({ ...playing, provider: 'wasm', msSinceLastInference: 10_000 })).toBe('cached')
  })

  it('caps the rate during playback on the GPU', () => {
    expect(
      decideMattePreview({ ...playing, msSinceLastInference: LIVE_INFERENCE_MIN_INTERVAL_MS - 1 }),
    ).toBe('cached')
    expect(
      decideMattePreview({ ...playing, msSinceLastInference: LIVE_INFERENCE_MIN_INTERVAL_MS + 1 }),
    ).toBe('infer')
  })

  it('caps it well below a 60fps frame rate', () => {
    // At 60fps a frame is ~16.7ms. Inferring every frame is what stutters the window.
    expect(LIVE_INFERENCE_MIN_INTERVAL_MS).toBeGreaterThan(16.7 * 2)
  })

  it('does not stall the very first frame of playback', () => {
    expect(decideMattePreview({ ...playing, hasCached: false })).toBe('infer')
  })

  it('lets a paused frame through regardless of how recent the last inference was', () => {
    // Scrubbing while paused should feel immediate; the rate cap is a playback measure.
    expect(
      decideMattePreview({ ...base, timestampDelta: 0.5, msSinceLastInference: 1 }),
    ).toBe('infer')
  })
})

describe('decideBakeMatteSync — keeping the cut-out on the picture', () => {
  const sync = (over: Partial<BakeMatteSyncInput>) =>
    decideBakeMatteSync({ drift: 0, isPlaying: true, ready: true, msSinceLastSeek: 10_000, ...over })

  it('will not paste a decoded-but-stale frame over the picture', () => {
    // A matte video that stalls still reports a decoded frame, so it kept being used,
    // freezing a silhouette from seconds ago across a face that had moved. Having a frame
    // is not the same as having the right frame.
    const d = sync({ drift: 2, ready: true })
    expect(d.use).toBe(false)
  })

  /**
   * Added 18/09/2026, from "reopen the project and the video is cut out in some stretches
   * and not others, with no cut-out at all at the start".
   *
   * Dropping a stale matte does not show "no matte" — it shows the picture uncut, which
   * puts the removed background back on screen. The matte video drifts routinely on a
   * full-length clip, so playback alternated between the two. Holding the last matte lags
   * the silhouette by a fraction of a second; the seek logic pulls it straight back.
   */
  it('never drops the matte for being stale, however far behind it is', () => {
    for (const drift of [0.6, 2, 30]) {
      expect(sync({ drift, ready: true }).drop, `drift ${drift}`).toBe(false)
    }
  })

  it('still corrects a stale matte rather than living with it', () => {
    expect(sync({ drift: 2, ready: true }).seek).toBe(true)
  })

  it('uses a frame that is both decoded and in step', () => {
    const d = sync({ drift: 0.02, ready: true })
    expect(d.use).toBe(true)
    expect(d.drop).toBe(false)
  })

  it('uses nothing when no frame is decoded yet, but does not drop over a brief hiccup', () => {
    const d = sync({ drift: 0.1, ready: false })
    expect(d.use).toBe(false)
    expect(d.drop).toBe(false)
  })

  it('holds what is already on the GPU while the matte catches up', () => {
    // use:false + drop:false is the "hold" state the caller reads — it leaves the texture
    // it uploaded last in place. If both were ever true at once the caller would blank it.
    const d = sync({ drift: 1, ready: true })
    expect(d.use).toBe(false)
    expect(d.drop).toBe(false)
  })

  it('corrects drift worth correcting', () => {
    expect(sync({ drift: 0.3 }).seek).toBe(true)
  })

  it('leaves small drift alone rather than seeking a playing video', () => {
    expect(sync({ drift: 0.05 }).seek).toBe(false)
  })

  it('will not seek again inside the cooldown, however far out it is', () => {
    // Without this, each correction interrupts decoding and justifies the next one.
    expect(sync({ drift: 5, msSinceLastSeek: 10 }).seek).toBe(false)
    expect(sync({ drift: 5, msSinceLastSeek: SEEK_COOLDOWN_MS + 1 }).seek).toBe(true)
  })

  it('keeps an exact position while paused, with no cooldown in the way', () => {
    // Paused, nothing advances the matte on its own.
    expect(sync({ drift: 0.05, isPlaying: false, msSinceLastSeek: 0 }).seek).toBe(true)
  })

  it('does not seek for drift smaller than a frame either way', () => {
    expect(sync({ drift: 0.001, isPlaying: false }).seek).toBe(false)
    expect(sync({ drift: 0.001, isPlaying: true }).seek).toBe(false)
  })

  it('treats drift as a distance, whichever side it is on', () => {
    // Behind or ahead, a stale matte is equally unusable and equally worth correcting.
    expect(sync({ drift: -2 }).use).toBe(false)
    expect(sync({ drift: -0.3 }).seek).toBe(true)
  })

  it('corrects long before it gives up', () => {
    // There must be a window where the matte is nudged back rather than abandoned,
    // otherwise the cut-out blinks off every time it slips.
    expect(SEEK_TOLERANCE_SECONDS).toBeLessThan(STALE_MATTE_SECONDS)
  })
})
