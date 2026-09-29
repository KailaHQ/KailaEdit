import { describe, expect, it } from 'vitest'
import {
  computeSegmentContentHash,
  findComplexSegments,
  resolveAdjustmentFilters,
  resolveEffectiveClipFilter,
  type TimelineClip,
  type Track,
} from '../src'
import { createMockClip, createMockTimeline } from './edit-patch-test-helpers'

const TRACKS: Track[] = [
  { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
  { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false },
]

const video = (id: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}) =>
  createMockClip({ id, type: 'video', trackIndex: 0, startTime, duration, ...extra })
const filterLayer = (startTime: number, duration: number, id = 'vintage-kodachrome', extra: Partial<TimelineClip> = {}) =>
  createMockClip({ id: 'adj', type: 'adjustment', assetId: null, trackIndex: 1, startTime, duration, filter: { id, intensity: 80 }, ...extra })

describe('resolveAdjustmentFilters', () => {
  it('writes the filter an adjustment layer grades a clip with onto the clip', () => {
    const clips = [video('a', 0, 10), filterLayer(0, 10)]
    const out = resolveAdjustmentFilters(clips, TRACKS)
    expect(out.find(c => c.id === 'a')?.filter).toEqual({ id: 'vintage-kodachrome', intensity: 80 })
    // The same answer the preview and the exporter give for that clip.
    expect(out.find(c => c.id === 'a')?.filter).toEqual(resolveEffectiveClipFilter(clips[0], [clips[1]], TRACKS))
    // The layer itself is left as it is; the input is not touched.
    expect(out.find(c => c.id === 'adj')).toBe(clips[1])
    expect(clips[0].filter).toBeUndefined()
  })

  it('keeps a clip\'s own filter over the layer\'s', () => {
    const own = { id: 'noir-bw', intensity: 100 }
    const out = resolveAdjustmentFilters([video('a', 0, 10, { filter: own }), filterLayer(0, 10)], TRACKS)
    expect(out.find(c => c.id === 'a')?.filter).toBe(own)
  })

  it('leaves clips the layer does not cover, and ones on a disabled track\'s layer', () => {
    const clips = [video('a', 0, 10), video('b', 10, 10), filterLayer(0, 10)]
    const out = resolveAdjustmentFilters(clips, TRACKS)
    expect(out.find(c => c.id === 'b')?.filter).toBeUndefined()
    const disabled = [{ ...TRACKS[0] }, { ...TRACKS[1], enabled: false }]
    expect(resolveAdjustmentFilters(clips, disabled)).toBe(clips)
  })

  it('returns the same array when nothing inherits', () => {
    const clips = [video('a', 0, 10)]
    expect(resolveAdjustmentFilters(clips, TRACKS)).toBe(clips)
  })
})

describe('the segment cache under a filter layer', () => {
  const timelineOf = (clips: TimelineClip[]) => createMockTimeline(clips, TRACKS)

  it('is a cached segment — which is why playback showed it ungraded', () => {
    const segments = findComplexSegments(timelineOf([video('a', 0, 10), filterLayer(0, 10)]))
    expect(segments.some(s => s.reasons.includes('adjustment'))).toBe(true)
  })

  it('hashes differently once the inherited filter is on the clip, and again when the layer\'s filter changes', () => {
    const raw = [video('a', 0, 10), filterLayer(0, 10)]
    const segment = findComplexSegments(timelineOf(raw))[0]
    const rawHash = computeSegmentContentHash(segment, timelineOf(raw), '480p', 16 / 9)
    const resolvedHash = computeSegmentContentHash(segment, timelineOf(resolveAdjustmentFilters(raw, TRACKS)), '480p', 16 / 9)
    expect(resolvedHash).not.toBe(rawHash)

    const recoloured = [video('a', 0, 10), filterLayer(0, 10, 'noir-bw')]
    const recolouredHash = computeSegmentContentHash(segment, timelineOf(resolveAdjustmentFilters(recoloured, TRACKS)), '480p', 16 / 9)
    expect(recolouredHash).not.toBe(resolvedHash)
  })
})
