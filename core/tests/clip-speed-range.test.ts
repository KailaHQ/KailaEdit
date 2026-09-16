import { describe, it, expect } from 'vitest'
import {
  MAX_CLIP_SPEED,
  MAX_REALTIME_PLAYBACK_RATE,
  MIN_CLIP_SPEED,
  clampClipSpeed,
  formatClipSpeed,
  sliderPositionForSpeed,
  playbackDriveModeForSpeed,
  speedForSliderPosition,
} from '../src/clip-speed'

describe('the speed range', () => {
  it('runs from 0.1x to 100x', () => {
    expect(MIN_CLIP_SPEED).toBe(0.1)
    expect(MAX_CLIP_SPEED).toBe(100)
  })

  it('clamps anything outside it', () => {
    expect(clampClipSpeed(0)).toBe(0.1)
    expect(clampClipSpeed(-4)).toBe(0.1)
    expect(clampClipSpeed(1000)).toBe(100)
    expect(clampClipSpeed(2.5)).toBe(2.5)
  })

  it('falls back to normal speed for anything that is not a real number', () => {
    // Including Infinity: a division that ran away should leave the clip
    // playing normally, not racing at the maximum.
    expect(clampClipSpeed(Number.NaN)).toBe(1)
    expect(clampClipSpeed(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('the slider mapping', () => {
  it('puts the ends of the range at the ends of the track', () => {
    expect(sliderPositionForSpeed(0.1)).toBeCloseTo(0, 6)
    expect(sliderPositionForSpeed(100)).toBeCloseTo(1, 6)
  })

  it('gives 1x a third of the track, not one percent of it', () => {
    // The point of the logarithmic scale: on a linear 0.1-100 slider, 1x would
    // sit at 0.9% and every ordinary speed would be unusable.
    expect(sliderPositionForSpeed(1)).toBeCloseTo(1 / 3, 6)
    expect(sliderPositionForSpeed(10)).toBeCloseTo(2 / 3, 6)
  })

  it('gives each decade an equal share', () => {
    const slowDecade = sliderPositionForSpeed(1) - sliderPositionForSpeed(0.1)
    const midDecade = sliderPositionForSpeed(10) - sliderPositionForSpeed(1)
    const fastDecade = sliderPositionForSpeed(100) - sliderPositionForSpeed(10)

    expect(midDecade).toBeCloseTo(slowDecade, 6)
    expect(fastDecade).toBeCloseTo(slowDecade, 6)
  })

  it('round-trips a speed through the slider', () => {
    for (const speed of [0.1, 0.5, 1, 2, 7.5, 25, 100]) {
      expect(speedForSliderPosition(sliderPositionForSpeed(speed))).toBeCloseTo(speed, 2)
    }
  })

  it('snaps to a landmark when the handle lands near one', () => {
    // Dragging back to normal speed has to be reachable by hand; on a
    // three-decade slider 1x is otherwise a single pixel.
    const justOff = sliderPositionForSpeed(1) + 0.008
    expect(speedForSliderPosition(justOff)).toBe(1)
  })

  it('leaves values between landmarks alone, rounded to two decimals', () => {
    const speed = speedForSliderPosition(0.5)
    expect(speed).toBeGreaterThan(1)
    expect(speed).toBeLessThan(10)
    expect(speed).toBe(Math.round(speed * 100) / 100)
  })

  it('never returns a speed outside the range', () => {
    expect(speedForSliderPosition(-1)).toBe(MIN_CLIP_SPEED)
    expect(speedForSliderPosition(2)).toBe(MAX_CLIP_SPEED)
  })
})

describe('how a speed is written', () => {
  it('drops trailing zeros', () => {
    expect(formatClipSpeed(1)).toBe('1x')
    expect(formatClipSpeed(2.5)).toBe('2.5x')
    expect(formatClipSpeed(100)).toBe('100x')
    expect(formatClipSpeed(0.1)).toBe('0.1x')
  })
})

describe('how the preview drives a clip at speed', () => {
  it('plays the element normally up to the rate ceiling', () => {
    for (const speed of [0.5, 1, 4, MAX_REALTIME_PLAYBACK_RATE]) {
      const drive = playbackDriveModeForSpeed(speed)
      expect(drive.seekDriven).toBe(false)
      expect(drive.rate).toBeCloseTo(speed, 6)
    }
  })

  it('steps by seeking past the ceiling, where no element can keep up', () => {
    // A media element clamps playbackRate at 16. Asking it to play at 40x and
    // letting it run left it trailing the playhead, showing frames from
    // earlier in the file — footage from elsewhere appearing to cut in.
    for (const speed of [16.1, 40, 100]) {
      expect(playbackDriveModeForSpeed(speed).seekDriven).toBe(true)
    }
  })

  it('never asks an element for a rate it would refuse', () => {
    for (const speed of [0.1, 1, 16, 50, 100]) {
      const drive = playbackDriveModeForSpeed(speed)
      expect(drive.rate).toBeGreaterThanOrEqual(0.1)
      expect(drive.rate).toBeLessThanOrEqual(MAX_REALTIME_PLAYBACK_RATE)
    }
  })
})
