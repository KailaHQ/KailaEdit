// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectSchema, type Project } from '@core/project-model'
import type { TimelineClip } from '../../../../types/project-model'

const sourceFor = vi.hoisted(() => vi.fn())
vi.mock('../webcodecs/FirstFrameSource', () => ({ getFirstFrameSource: sourceFor }))

import {
  clearPreparedFrames,
  getPreparedFrame,
  prepareFirstFrame,
  prepareProjectFirstFrame,
} from '../first-frame-prefetch'

const clip = { id: 'c1', startTime: 0, trimStart: 0.62, trimEnd: 0, speed: 1, duration: 5, reversed: false } as unknown as TimelineClip

function fakeFrame() {
  const frame = { close: vi.fn(), clone: vi.fn() } as unknown as VideoFrame & { close: ReturnType<typeof vi.fn>; clone: ReturnType<typeof vi.fn> }
  const copy = { close: vi.fn() } as unknown as VideoFrame
  frame.clone.mockReturnValue(copy)
  return { frame, copy }
}

function fakeSource(frame: VideoFrame | null) {
  const frameAt = vi.fn(async () => frame)
  const source = { open: vi.fn(async () => ({ duration: 7.27 })), frameAt }
  sourceFor.mockReturnValue(source)
  return { source, frameAt }
}

describe('first frame prefetch', () => {
  beforeEach(() => {
    sourceFor.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    clearPreparedFrames()
    vi.useRealTimers()
  })

  it('decodes the frame the playhead will be on, not frame 0 of the file', async () => {
    const { frame } = fakeFrame()
    const { frameAt } = fakeSource(frame)
    prepareFirstFrame('/a.mp4', clip, 0)
    await getPreparedFrame('/a.mp4', 'c1', 0)
    expect(frameAt).toHaveBeenCalledWith(0.62)
  })

  it('prepares each frame once however often it is asked', async () => {
    const { frame } = fakeFrame()
    const { frameAt } = fakeSource(frame)
    prepareFirstFrame('/a.mp4', clip, 0)
    prepareFirstFrame('/a.mp4', clip, 0)
    await getPreparedFrame('/a.mp4', 'c1', 0)
    expect(frameAt).toHaveBeenCalledTimes(1)
  })

  it('hands out copies and keeps the original for the next asker', async () => {
    const { frame, copy } = fakeFrame()
    fakeSource(frame)
    prepareFirstFrame('/a.mp4', clip, 0)
    const first = await getPreparedFrame('/a.mp4', 'c1', 0)
    const second = await getPreparedFrame('/a.mp4', 'c1', 0)
    expect(first).toBe(copy)
    expect(second).toBe(copy)
    expect(frame.close).not.toHaveBeenCalled()
  })

  it('knows nothing about a frame that was not prepared', () => {
    expect(getPreparedFrame('/a.mp4', 'c1', 0)).toBeUndefined()
    fakeSource(fakeFrame().frame)
    prepareFirstFrame('/a.mp4', clip, 0)
    expect(getPreparedFrame('/a.mp4', 'c1', 3)).toBeUndefined()
    expect(getPreparedFrame('/other.mp4', 'c1', 0)).toBeUndefined()
  })

  it('releases the frame when nobody wanted it', async () => {
    const { frame } = fakeFrame()
    fakeSource(frame)
    prepareFirstFrame('/a.mp4', clip, 0)
    await getPreparedFrame('/a.mp4', 'c1', 0)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(frame.close).toHaveBeenCalledTimes(1)
    expect(getPreparedFrame('/a.mp4', 'c1', 0)).toBeUndefined()
  })

  it('turns a file that cannot be decoded into no frame, not an error', async () => {
    sourceFor.mockReturnValue({ open: async () => { throw new Error('no moov') }, frameAt: vi.fn() })
    prepareFirstFrame('/clip.avi', clip, 0)
    expect(await getPreparedFrame('/clip.avi', 'c1', 0)).toBeNull()
  })
})

describe('preparing the frame of a project that is opening', () => {
  const video = (id: string, startTime: number, trackIndex: number, path: string, extra: Record<string, unknown> = {}) => ({
    id,
    trackIndex,
    startTime,
    duration: 5,
    trimStart: 0.62,
    trimEnd: 0,
    type: 'video' as const,
    assetId: `asset-${id}`,
    asset: { id: `asset-${id}`, type: 'video' as const, path, prompt: '', resolution: '1080x1920', duration: 60, createdAt: 1 },
    ...extra,
  })

  function projectWith(clips: unknown[], assets: unknown[] = []): Project {
    return projectSchema.parse({
      version: 2,
      id: 'p1',
      name: 'Project',
      createdAt: 1,
      updatedAt: 1,
      assets,
      bins: { root: 'Default' },
      timelines: [{
        id: 'tl',
        name: 'Main',
        createdAt: 1,
        tracks: [
          { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, sourcePatched: true },
          { id: 'v2', name: 'V2', kind: 'video', muted: false, locked: false },
        ],
        clips,
        subtitles: [],
      }],
      activeTimelineId: 'tl',
    })
  }

  beforeEach(() => {
    sourceFor.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    clearPreparedFrames()
    vi.useRealTimers()
  })

  it('prepares the video clip in front at the start of the timeline', () => {
    fakeSource(fakeFrame().frame)
    prepareProjectFirstFrame(projectWith([video('c1', 0, 0, '/media/first.mp4'), video('c2', 5, 0, '/media/second.mp4')]), false)
    expect(sourceFor).toHaveBeenCalledTimes(1)
    expect(sourceFor).toHaveBeenCalledWith('/media/first.mp4')
    expect(getPreparedFrame('/media/first.mp4', 'c1', 0)).toBeDefined()
  })

  it('uses the proxy only when proxies are on', () => {
    const asset = { id: 'asset-c1', type: 'video', path: '/media/first.mp4', proxyPath: '/proxy/first.mp4', proxyStatus: 'ready', prompt: '', resolution: '1080x1920', duration: 60, createdAt: 1 }
    fakeSource(fakeFrame().frame)
    prepareProjectFirstFrame(projectWith([video('c1', 0, 0, '/media/first.mp4')], [asset]), true)
    expect(sourceFor).toHaveBeenLastCalledWith('/proxy/first.mp4')

    clearPreparedFrames()
    sourceFor.mockClear()
    fakeSource(fakeFrame().frame)
    prepareProjectFirstFrame(projectWith([video('c1', 0, 0, '/media/first.mp4')], [asset]), false)
    expect(sourceFor).toHaveBeenLastCalledWith('/media/first.mp4')
  })

  it('prepares nothing when nothing is in front at the start of the timeline', () => {
    prepareProjectFirstFrame(projectWith([]), false)
    // On an overlay track a clip stays where it was put; only the main track closes gaps.
    prepareProjectFirstFrame(projectWith([video('c1', 4, 1, '/media/later.mp4')]), false)
    prepareProjectFirstFrame(null, false)
    expect(sourceFor).not.toHaveBeenCalled()
  })

  it('prepares the first clip of the main track even if it was left starting later', () => {
    // The editor closes the gap at the start of the main track, so the monitor shows it at 0.
    fakeSource(fakeFrame().frame)
    prepareProjectFirstFrame(projectWith([video('c1', 4, 0, '/media/late.mp4')]), false)
    expect(sourceFor).toHaveBeenCalledWith('/media/late.mp4')
  })

  it('never throws, whatever the project looks like', () => {
    expect(() => prepareProjectFirstFrame({} as Project, false)).not.toThrow()
  })
})
