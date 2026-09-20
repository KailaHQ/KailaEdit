import { describe, it, expect } from 'vitest'
import { clipNeedsAlphaCanvas } from '../preview-frame-engine'
import type { TimelineClip } from '../../../../types/project-model'

/**
 * Two questions that look alike and must never be merged.
 *
 *   needsCanvas — should the WebGL canvas draw this clip? A property of the clip alone.
 *   isCutOut    — may the raw <video>/<img> underneath be hidden yet? Only once the
 *                 canvas actually has a frame to replace it with.
 *
 * `applyFrameVisuals` derives both. Feeding canvas readiness into the first one
 * deadlocks the preview: an empty canvas means "don't draw", not drawing means it stays
 * empty, and the render path clears it on every frame forever. With the source hidden
 * for a background-removed clip, that is a permanently black monitor — which is exactly
 * what shipped for one iteration.
 *
 * The rule this locks in: `needsCanvas` is a pure function of the clip, so whatever
 * readiness is doing, it can never stop the canvas from drawing.
 */
function clip(over: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'c1',
    type: 'video',
    trackIndex: 0,
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 10,
    ...over,
  } as TimelineClip
}

/** Mirrors how applyFrameVisuals must combine the two. */
function decide(c: TimelineClip, canvasHasContent: boolean) {
  const needsCanvas = clipNeedsAlphaCanvas(c)
  return {
    // drives renderNow() vs clear()
    needsCanvas,
    // drives hiding the element underneath
    isCutOut: needsCanvas && canvasHasContent,
  }
}

describe('canvas visibility: needsCanvas vs isCutOut', () => {
  const matteClip = clip({ autoMatte: { enabled: true } as any })

  it('still asks the canvas to draw while the canvas is empty', () => {
    const { needsCanvas, isCutOut } = decide(matteClip, false)
    expect(needsCanvas).toBe(true) // the escape from the deadlock
    expect(isCutOut).toBe(false) // nothing to hide behind yet
  })

  it('hides the source only once the canvas has a frame', () => {
    expect(decide(matteClip, true).isCutOut).toBe(true)
  })

  it('never hides the source for a clip the canvas does not draw', () => {
    const plain = clip({})
    expect(decide(plain, true).isCutOut).toBe(false)
    expect(decide(plain, false).isCutOut).toBe(false)
  })

  it('is independent of readiness for the draw decision', () => {
    expect(decide(matteClip, false).needsCanvas).toBe(decide(matteClip, true).needsCanvas)
  })
})
