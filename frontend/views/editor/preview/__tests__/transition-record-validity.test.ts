import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineTransition } from '../../../../types/project-model'
import { buildFrameRenderCache, deriveFrameRenderState, getTransitionAtTime } from '../preview-frame-engine'

/**
 * A transition record left behind by an edit — here the clips it names have swapped places —
 * must not steer the preview. Taken at its word, the pair below made 5.2 s–17.4 s one dissolve:
 * clip 1, which really plays from 11.8 s, was forced in front for all of it, and the image and
 * video overlays above it on higher tracks were left undrawn.
 */

const clip = (id: string, trackIndex: number, startTime: number, duration: number, type: 'video' | 'image' = 'video'): TimelineClip => ({
  id,
  type,
  trackIndex,
  startTime,
  duration,
  trimStart: 0,
  trimEnd: 0,
  speed: 1,
  volume: 1,
  opacity: 100,
  assetId: `asset-${id}`,
  asset: { id: `asset-${id}`, type, path: `C:/media/${id}.mp4`, prompt: '', resolution: '', createdAt: 0 },
} as unknown as TimelineClip)

const transition = (leftClipId: string, rightClipId: string): TimelineTransition => ({
  id: `${leftClipId}-${rightClipId}`,
  trackIndex: 0,
  leftClipId,
  rightClipId,
  type: 'fade-to-black',
  duration: 0.5,
  leftExtend: 0.25,
  rightExtend: 0.25,
} as TimelineTransition)

// The project as the editor left it: video 2 now comes first on the main track, video 1 after.
const video2 = clip('video2', 0, 5.237, 6.549)
const video1 = clip('video1', 0, 11.786, 5.64)
const overlayImage = clip('overlay-image', 4, 11.689, 9.351, 'image')
const overlayVideo = clip('overlay-video', 6, 11.689, 53.201)
const CLIPS = [video2, video1, overlayImage, overlayVideo]
const SWAPPED = [transition('video1', 'video2')]

describe('getTransitionAtTime', () => {
  it('ignores a record whose clips have swapped places, though end minus start is +12 s', () => {
    expect(video1.startTime + video1.duration - video2.startTime).toBeGreaterThan(12)
    for (const time of [5.5, 8, 11.7, 12, 15]) {
      expect(getTransitionAtTime(CLIPS, SWAPPED, [], time)).toBeNull()
    }
  })

  it('still finds a genuine overlap, and how far through it the playhead is', () => {
    const left = clip('a', 0, 0, 5)
    const right = clip('b', 0, 4.5, 5)
    const hit = getTransitionAtTime([left, right], [transition('a', 'b')], [], 4.75)
    expect(hit?.pair.outgoing.id).toBe('a')
    expect(hit?.pair.incoming.id).toBe('b')
    expect(hit?.progress).toBeCloseTo(0.5)
    expect(getTransitionAtTime([left, right], [transition('a', 'b')], [], 6)).toBeNull()
  })

  it('ignores a record whose clip is gone', () => {
    expect(getTransitionAtTime([video2], [transition('deleted', 'video2')], [], 8)).toBeNull()
  })
})

describe('the frame at a time, with a stale record in the project', () => {
  const state = (time: number) => deriveFrameRenderState(buildFrameRenderCache(CLIPS, [], SWAPPED), [], time)

  it('shows the clip that is on the main track at that time, not the record\'s "outgoing" clip', () => {
    const frame = state(8)
    expect(frame.crossDissolve).toBeNull()
    expect(frame.activeClip?.id).toBe('video2')
  })

  it('draws the overlays above the main track when the playhead reaches them', () => {
    const frame = state(12)
    expect(frame.crossDissolve).toBeNull()
    // Topmost clip in front, as it would be with no transition in the project at all.
    expect(frame.activeClip?.id).toBe('overlay-video')
    expect(frame.activeVideoContributors.map(c => c.clip.id)).toContain('overlay-video')
  })
})
