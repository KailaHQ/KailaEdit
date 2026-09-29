import { describe, expect, it } from 'vitest'
import {
  collectPlayheadSnapTargets,
  computePlayheadSnapThresholdSeconds,
  snapPlayheadTime,
} from '../src/timeline-snap'
import { createMockClip } from './edit-patch-test-helpers'

const clips = [
  createMockClip({ id: 'a', type: 'video', trackIndex: 0, startTime: 0, duration: 5 }),
  createMockClip({ id: 'b', type: 'video', trackIndex: 0, startTime: 5, duration: 5 }),
  // An overlay on another layer: its edges catch the playhead just the same.
  createMockClip({ id: 't', type: 'text', assetId: null, trackIndex: 1, startTime: 2.4, duration: 1.3 }),
]
const targets = collectPlayheadSnapTargets({ clips, markers: [{ id: 'm', time: 8, label: '' } as never] })
const threshold = computePlayheadSnapThresholdSeconds(100) // 10px at 100px/s = 0.1s

describe('playhead snapping', () => {
  it('catches on clip edges on any layer, and on markers', () => {
    expect(snapPlayheadTime({ time: 2.45, targets, snapThreshold: threshold }).snappedTime).toBe(2.4)
    expect(snapPlayheadTime({ time: 3.63, targets, snapThreshold: threshold }).snappedTime).toBeCloseTo(3.7)
    expect(snapPlayheadTime({ time: 4.95, targets, snapThreshold: threshold }).snappedTime).toBe(5)
    expect(snapPlayheadTime({ time: 7.92, targets, snapThreshold: threshold }).snappedTime).toBe(8)
  })

  it('leaves the playhead where the pointer is away from any edge', () => {
    const result = snapPlayheadTime({ time: 3, targets, snapThreshold: threshold })
    expect(result).toEqual({ snappedTime: 3, delta: 0, snappedTarget: null })
  })

  it('picks the nearest edge when two are in reach', () => {
    const near = [{ time: 1, type: 'clip-end' as const }, { time: 1.08, type: 'clip-start' as const }]
    expect(snapPlayheadTime({ time: 1.05, targets: near, snapThreshold: 0.1 }).snappedTime).toBe(1.08)
  })

  it('never catches on the playhead itself', () => {
    expect(collectPlayheadSnapTargets({ clips }).some(t => t.type === 'playhead')).toBe(false)
    const own = [{ time: 3, type: 'playhead' as const }]
    expect(snapPlayheadTime({ time: 3.01, targets: own, snapThreshold: 0.1 }).snappedTarget).toBeNull()
  })

  it('reaches only a few pixels, however far the timeline is zoomed in', () => {
    // Zoomed in to 1000px/s the reach is 10ms — no 0.15s floor dragging it across the screen.
    expect(computePlayheadSnapThresholdSeconds(1000)).toBeCloseTo(0.01)
    expect(snapPlayheadTime({ time: 4.95, targets, snapThreshold: computePlayheadSnapThresholdSeconds(1000) }).snappedTarget).toBeNull()
  })
})
