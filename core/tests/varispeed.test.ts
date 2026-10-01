import { describe, it, expect } from 'vitest'
import { renderVarispeed } from '../src/varispeed'
import { curveMeanSpeed, durationForSpeedCurve, speedCurveForPreset } from '../src/speed-curve'
import type { SpeedCurve } from '../src/project-model'

/**
 * Speed curves play their audio like tape: pitch follows speed, and the sound
 * at each moment is the source at the moment the picture shows.
 */

const SR = 8000

function sine(freq: number, seconds: number, channels = 1): Float32Array {
  const frames = Math.round(seconds * SR)
  const out = new Float32Array(frames * channels)
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) out[i * channels + ch] = 10000 * Math.sin((2 * Math.PI * freq * i) / SR)
  }
  return out
}

/** Frequency from zero crossings, over a stretch of a mono signal. */
function frequency(signal: Float32Array, from: number, to: number): number {
  let crossings = 0
  for (let i = from + 1; i < to; i++) {
    if ((signal[i - 1] < 0) !== (signal[i] < 0)) crossings++
  }
  return (crossings / 2) / ((to - from) / SR)
}

const flat = (v: number): SpeedCurve => ({ preset: 'custom', points: [{ x: 0, v }, { x: 1, v }] })

function clipFor(curve: SpeedCurve, sourceSeconds: number, reversed = false) {
  return { duration: durationForSpeedCurve(sourceSeconds, curve), speed: curveMeanSpeed(curve), speedCurve: curve, reversed }
}

describe('renderVarispeed', () => {
  it('doubles the pitch and halves the length at 2x', () => {
    const out = renderVarispeed(sine(200, 2), 1, SR, clipFor(flat(2), 2))
    expect(out.length).toBe(SR) // 1 second
    expect(frequency(out, 0, out.length)).toBeCloseTo(400, -1)
  })

  it('halves the pitch at 0.5x', () => {
    const out = renderVarispeed(sine(400, 1), 1, SR, clipFor(flat(0.5), 1))
    expect(out.length).toBe(2 * SR)
    expect(frequency(out, 0, out.length)).toBeCloseTo(200, -1)
  })

  it('follows the curve: slow in the dip, normal outside it', () => {
    const bullet = speedCurveForPreset('bullet')
    const clip = clipFor(bullet, 4)
    const out = renderVarispeed(sine(500, 4), 1, SR, clip)
    const head = frequency(out, 0, Math.round(0.5 * SR))
    const middle = Math.round((clip.duration / 2) * SR)
    const dip = frequency(out, middle - SR / 4, middle + SR / 4)
    expect(head).toBeCloseTo(500, -1)
    expect(dip).toBeLessThan(150)
  })

  it('keeps channels apart', () => {
    const src = new Float32Array(SR * 2 * 2)
    for (let i = 0; i < SR * 2; i++) { src[i * 2] = 1000; src[i * 2 + 1] = -1000 }
    const out = renderVarispeed(src, 2, SR, clipFor(speedCurveForPreset('montage'), 2))
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]).toBeCloseTo(1000, 6)
      expect(out[i + 1]).toBeCloseTo(-1000, 6)
    }
  })

  it('plays a reversed clip from the end of its window', () => {
    const ramp = new Float32Array(SR)
    for (let i = 0; i < SR; i++) ramp[i] = i
    const out = renderVarispeed(ramp, 1, SR, clipFor(flat(1), 1, true))
    expect(out[0]).toBeGreaterThan(SR - 3)
    expect(out[out.length - 1]).toBeLessThan(3)
  })

  it('stays within full scale', () => {
    const out = renderVarispeed(sine(1000, 2), 1, SR, clipFor(speedCurveForPreset('jump-cut'), 2))
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(v)).toBeLessThanOrEqual(10000 * 1.3)
    }
  })
})
