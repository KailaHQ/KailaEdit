import { describe, it, expect } from 'vitest'
import {
  collectTimelineSnapTargets,
  computeSnapThresholdSeconds,
  snapClipMove,
  snapClipResize,
  deduplicateSnapTargets,
} from '../src/timeline-snap'
import type { TimelineClip, TimelineTransition } from '../src/project-model'

function mockClip(id: string, trackIndex: number, startTime: number, duration: number): TimelineClip {
  return {
    id,
    trackIndex,
    startTime,
    duration,
    type: 'video',
    speed: 1,
    trimStart: 0,
    trimEnd: 0,
  } as TimelineClip
}

describe('computeSnapThresholdSeconds', () => {
  it('scales snap threshold dynamically by zoom (pixelsPerSecond)', () => {
    // At 50 px/s, 14px is 0.28s
    expect(computeSnapThresholdSeconds(50, 14, 0.15)).toBeCloseTo(0.28, 2)
    // At 100 px/s, 14px is 0.14s -> clamped to minSeconds 0.15s
    expect(computeSnapThresholdSeconds(100, 14, 0.15)).toBe(0.15)
    // At 10 px/s, 14px is 1.4s
    expect(computeSnapThresholdSeconds(10, 14, 0.15)).toBeCloseTo(1.4, 2)
  })
})

describe('collectTimelineSnapTargets', () => {
  it('collects clip start and end boundaries on all tracks', () => {
    const clip1 = mockClip('c1', 0, 0, 10) // ends at 10
    const clip2 = mockClip('c2', 0, 10, 5) // ends at 15
    const overlay = mockClip('ov', 1, 3, 4) // 3 to 7

    const targets = collectTimelineSnapTargets({
      clips: [clip1, clip2, overlay],
      ignoreClipIds: new Set(['ov']),
    })

    const times = targets.map(t => t.time)
    expect(times).toContain(0) // clip1 start
    expect(times).toContain(10) // clip1 end / clip2 start
    expect(times).toContain(15) // clip2 end
    expect(times).not.toContain(3) // overlay ignored
    expect(times).not.toContain(7) // overlay ignored
  })

  it('collects cuts and transition junctions between clips', () => {
    // Two clips on Track 0 with 1s transition (overlap from 9 to 10)
    const clip1 = mockClip('c1', 0, 0, 10)
    const clip2 = mockClip('c2', 0, 9, 6)
    const transition: TimelineTransition = {
      id: 'tr1',
      trackIndex: 0,
      leftClipId: 'c1',
      rightClipId: 'c2',
      type: 'fade',
      duration: 1,
    }

    const targets = collectTimelineSnapTargets({
      clips: [clip1, clip2],
      transitions: [transition],
    })

    const times = targets.map(t => t.time)
    expect(times).toContain(9.5) // junction
    expect(times).toContain(9) // overlapStart
    expect(times).toContain(10) // overlapEnd
  })

  it('includes playhead and markers when provided', () => {
    const targets = collectTimelineSnapTargets({
      clips: [],
      currentTime: 12.5,
      markers: [{ id: 'm1', time: 7.2, label: 'Marker 1', color: 'blue' }],
    })

    const times = targets.map(t => t.time)
    expect(times).toContain(12.5)
    expect(times).toContain(7.2)
  })
})

describe('snapClipMove', () => {
  const targets = deduplicateSnapTargets([
    { time: 5.0, type: 'clip-end' },
    { time: 10.0, type: 'clip-end' },
    { time: 11.58, type: 'transition-junction' },
    { time: 18.0, type: 'clip-start' },
  ])

  it('snaps moving clip start edge to target when close', () => {
    // Clip at 4.9s with duration 3s. Start edge 4.9s is close to 5.0s
    const res = snapClipMove({
      proposedStartTime: 4.9,
      duration: 3,
      targets,
      snapThreshold: 0.25,
    })

    expect(res.snappedTime).toBe(5.0)
    expect(res.delta).toBeCloseTo(0.1, 2)
    expect(res.snappedTarget?.time).toBe(5.0)
  })

  it('snaps moving clip end edge to target (e.g. cut or clip end below)', () => {
    // Clip with duration 6s at proposedStartTime 3.9s -> clipEnd is 9.9s, close to target 10.0s
    const res = snapClipMove({
      proposedStartTime: 3.9,
      duration: 6,
      targets,
      snapThreshold: 0.25,
    })

    expect(res.snappedTime).toBe(4.0) // 4.0 + 6 = 10.0
    expect(res.delta).toBeCloseTo(0.1, 2)
    expect(res.snappedTarget?.time).toBe(10.0)
  })

  it('snaps to transition junctions accurately', () => {
    // Clip start proposed at 11.55s, close to junction 11.58s
    const res = snapClipMove({
      proposedStartTime: 11.55,
      duration: 4,
      targets,
      snapThreshold: 0.2,
    })

    expect(res.snappedTime).toBe(11.58)
    expect(res.snappedTarget?.time).toBe(11.58)
    expect(res.snappedTarget?.type).toBe('transition-junction')
  })

  it('picks the nearest target when multiple candidates are within threshold', () => {
    // Target at 5.0 and target at 5.3
    const localTargets = deduplicateSnapTargets([
      { time: 5.0, type: 'clip-start' },
      { time: 5.3, type: 'clip-end' },
    ])

    // Proposed 5.05 -> distance to 5.0 is 0.05, distance to 5.3 is 0.25
    const res = snapClipMove({
      proposedStartTime: 5.05,
      duration: 2,
      targets: localTargets,
      snapThreshold: 0.3,
    })

    expect(res.snappedTime).toBe(5.0)
  })

  it('does not snap if outside threshold', () => {
    const res = snapClipMove({
      proposedStartTime: 7.0,
      duration: 2,
      targets,
      snapThreshold: 0.2,
    })

    expect(res.snappedTime).toBe(7.0)
    expect(res.snappedTarget).toBeNull()
  })
})

describe('snapClipResize', () => {
  const targets = deduplicateSnapTargets([
    { time: 4.0, type: 'clip-start' },
    { time: 10.0, type: 'clip-end' },
    { time: 14.5, type: 'transition-junction' },
  ])

  it('snaps left edge resize to nearest target', () => {
    const res = snapClipResize({
      edge: 'left',
      proposedTime: 4.08,
      targets,
      snapThreshold: 0.2,
    })

    expect(res.snappedTime).toBe(4.0)
    expect(res.snappedTarget?.time).toBe(4.0)
  })

  it('snaps right edge resize to nearest target', () => {
    const res = snapClipResize({
      edge: 'right',
      proposedTime: 14.45,
      targets,
      snapThreshold: 0.2,
    })

    expect(res.snappedTime).toBe(14.5)
    expect(res.snappedTarget?.time).toBe(14.5)
  })
})
