// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useVideoPoolManager, type UseVideoPoolManagerResult, type VideoPoolRefs } from '../useVideoPoolManager'
import { upcomingVideoClips, type FrameRenderState } from '../preview-frame-engine'
import type { TimelineClip } from '../../../../types/project-model'

/**
 * Three clips start at the same instant on three tracks: the main-track clip, an image and a
 * video overlay on top. Only the clip after the active one used to be loaded ahead, so the
 * overlay's video was made on the spot, and for a couple of frames the layers under it showed.
 */

const clip = (id: string, trackIndex: number, startTime: number, duration: number, type: 'video' | 'image' | 'audio' | 'text' = 'video'): TimelineClip => ({
  id,
  type,
  trackIndex,
  startTime,
  duration,
  trimStart: 0,
  trimEnd: 0,
  speed: 1,
  asset: { id: `asset-${id}`, type: type === 'text' ? 'image' : type, path: `C:/media/${id}.mp4`, prompt: '', resolution: '', createdAt: 0 },
} as unknown as TimelineClip)

describe('upcomingVideoClips', () => {
  const clips = [
    clip('active', 0, 0, 11.786),
    clip('main-next', 0, 11.7863, 5.6),
    clip('overlay-video', 6, 11.786, 53),
    clip('overlay-image', 4, 11.786, 9, 'image'),
    clip('music', 1, 11.9, 20, 'audio'),
    clip('title', 7, 11.9, 3, 'text'),
    clip('far', 5, 30, 4),
    clip('past', 3, 1, 2),
  ]

  it('lists every video clip starting soon, on whatever track, soonest first', () => {
    const ids = upcomingVideoClips(clips, 10.9, 1.5).map(c => c.id)
    expect(ids).toEqual(['overlay-video', 'main-next'])
  })

  it('leaves out clips that are not video, already started, or too far off', () => {
    const ids = upcomingVideoClips(clips, 10.9, 1.5).map(c => c.id)
    for (const left of ['overlay-image', 'music', 'title', 'far', 'past', 'active']) expect(ids).not.toContain(left)
  })

  it('finds nothing when no clip begins inside the window', () => {
    expect(upcomingVideoClips(clips, 20, 1.5)).toEqual([])
  })
})

describe('the video pool while playing up to a boundary', () => {
  function setup(clips: TimelineClip[]) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const refs = {
      videoPoolRef: { current: new Map<string, HTMLVideoElement>() },
      videoPoolContainerRef: { current: null },
      activePoolPathRef: { current: '' },
      activePoolClipIdRef: { current: null },
      contributorSyncStatesRef: { current: new Map() },
      preSeekDoneRef: { current: null },
      compositingMediaRefs: { current: new Map() },
      clipsRef: { current: clips },
      lastFrameRequestRef: { current: null },
    } as unknown as VideoPoolRefs
    let manager!: UseVideoPoolManagerResult
    function Harness() {
      manager = useVideoPoolManager(refs, c => c.asset?.path ?? '', () => null, { current: 0 }, 1)
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<Harness />))
    return { refs, manager, root }
  }

  const stateAt = (atTime: number, active: TimelineClip): FrameRenderState =>
    ({ atTime, activeVideoContributors: [{ clip: active, target: 'active', role: 'primary', opacity: 1 }] }) as unknown as FrameRenderState

  it('loads every clip about to start, the overlay as well as the next main-track clip', () => {
    const active = clip('active', 0, 0, 11.786)
    const { refs, manager, root } = setup([
      active,
      clip('main-next', 0, 11.786, 5.6),
      clip('overlay-video', 6, 11.786, 53),
      clip('far', 5, 40, 4),
    ])
    manager.syncRetainedPoolVideos(stateAt(10.9, active), 'playback')

    expect([...refs.videoPoolRef.current.keys()].sort()).toEqual([
      'C:/media/active.mp4',
      'C:/media/main-next.mp4',
      'C:/media/overlay-video.mp4',
    ])
    act(() => root.unmount())
  })

  it('lets go of a clip that is not about to start', () => {
    const active = clip('active', 0, 0, 11.786)
    const { refs, manager, root } = setup([active, clip('far', 5, 40, 4)])
    manager.ensurePoolVideo('C:/media/far.mp4')
    manager.syncRetainedPoolVideos(stateAt(5, active), 'playback')
    expect([...refs.videoPoolRef.current.keys()]).toEqual(['C:/media/active.mp4'])
    act(() => root.unmount())
  })

  it('does not preload anything for a scrub: that shows one frame, not what follows', () => {
    const active = clip('active', 0, 0, 11.786)
    const { refs, manager, root } = setup([active, clip('overlay-video', 6, 11.786, 53)])
    manager.syncRetainedPoolVideos(stateAt(10.9, active), 'scrub')
    expect([...refs.videoPoolRef.current.keys()]).toEqual(['C:/media/active.mp4'])
    act(() => root.unmount())
  })
})
