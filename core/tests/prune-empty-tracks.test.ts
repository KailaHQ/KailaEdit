import { describe, it, expect } from 'vitest'
import { pruneEmptyTracks } from '../src/video-editor-utils'
import { DEFAULT_TRACKS } from '../src/project-model'
import type { SubtitleClip, TimelineClip, Track } from '../src/project-model'

/**
 * Empty rows are rows the user has to scroll past and aim around, so they go.
 */

const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({
  id,
  name: id.toUpperCase(),
  muted: false,
  locked: false,
  kind,
  ...extra,
} as Track)

const clip = (id: string, trackIndex: number): TimelineClip => ({
  id,
  type: 'video',
  startTime: 0,
  duration: 5,
  trackIndex,
} as TimelineClip)

describe('pruneEmptyTracks', () => {
  it('removes empty overlay, audio and sticker rows', () => {
    const tracks = [
      track('v1', 'video'),
      track('v2', 'video'),
      track('v3', 'video'),
      track('a1', 'audio'),
      track('s1', 'sticker'),
    ]
    const clips = [clip('c1', 2)] // only V3 is used

    const result = pruneEmptyTracks(tracks, clips)

    // V1 is protected, V3 carries the clip; everything else goes.
    expect(result.tracks.map(t => t.id)).toEqual(['v1', 'v3'])
    expect(result.clips[0].trackIndex).toBe(1)
  })

  it('renumbers the rows that survive', () => {
    const tracks = [
      track('v1', 'video'),
      track('v2', 'video'),
      track('v3', 'video'),
      track('a1', 'audio'),
      track('a2', 'audio'),
    ]
    const clips = [clip('c1', 2), clip('c2', 4)]

    const result = pruneEmptyTracks(tracks, clips)

    expect(result.tracks.map(t => t.name)).toEqual(['V1', 'V2', 'A1'])
  })

  it('keeps the first video track even with nothing on it', () => {
    const result = pruneEmptyTracks([track('v1', 'video')], [])
    expect(result.tracks.map(t => t.id)).toEqual(['v1'])
  })

  it('keeps a locked row, because locking says leave it alone', () => {
    const tracks = [
      track('v1', 'video'),
      track('v2', 'video', { locked: true }),
      track('v3', 'video'),
    ]
    const result = pruneEmptyTracks(tracks, [])
    expect(result.tracks.map(t => t.id)).toEqual(['v1', 'v2'])
  })

  it('keeps a subtitle row, whose contents are not clips', () => {
    const tracks = [
      track('v1', 'video'),
      track('subs', 'video', { type: 'subtitle' }),
      track('v2', 'video'),
    ]
    const subtitles: SubtitleClip[] = [
      { id: 's1', text: 'hi', startTime: 0, endTime: 1, trackIndex: 1 } as SubtitleClip,
    ]

    const result = pruneEmptyTracks(tracks, [], subtitles)

    expect(result.tracks.map(t => t.id)).toEqual(['v1', 'subs'])
    expect(result.subtitles[0].trackIndex).toBe(1)
  })

  it('leaves a new project with the video track alone', () => {
    // DEFAULT_TRACKS ships V1 only, and nothing downstream may put an empty
    // audio row back: an audio track appears when audio is added, not before.
    const result = pruneEmptyTracks([track('v1', 'video')], [])
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks.some(t => t.kind === 'audio')).toBe(false)
  })

  it('returns the same arrays when there is nothing to remove', () => {
    const tracks = [track('v1', 'video'), track('a1', 'audio')]
    const clips = [clip('c1', 0), clip('c2', 1)]

    const result = pruneEmptyTracks(tracks, clips)

    expect(result.tracks).toBe(tracks)
    expect(result.clips).toBe(clips)
  })

  it('prunes empty text/overlay tracks even when positioned at index 0 before track-v1', () => {
    const tracks = [
      track('track-text', 'video', { name: 'Kinetic Titles' }),
      track('track-v1', 'video', { name: 'Cinematic Footage' }),
      track('track-audio', 'audio', { name: 'Audio Bed' }),
    ]
    // Text was moved out of track-text (index 0); only track-v1 and track-audio have clips
    const clips = [
      clip('shot-1', 1),
      { id: 'audio-1', type: 'audio', startTime: 0, duration: 10, trackIndex: 2 } as TimelineClip,
    ]

    const result = pruneEmptyTracks(tracks, clips)

    // track-text is an overlay track and empty, so it must be pruned.
    // track-v1 survives as V1 (index 0), audio survives as A1 (index 1).
    expect(result.tracks.map(t => t.id)).toEqual(['track-v1', 'track-audio'])
    expect(result.tracks[0].name).toBe('V1')
    expect(result.tracks[1].name).toBe('A1')
    expect(result.clips[0].trackIndex).toBe(0)
    expect(result.clips[1].trackIndex).toBe(1)
  })

  it('prunes empty sticker tracks and renumbers surviving sticker tracks', () => {
    const tracks = [
      track('v1', 'video', { name: 'V1' }),
      track('s1', 'sticker', { name: 'S1' }),
      track('s2', 'sticker', { name: 'S2' }),
      track('a1', 'audio', { name: 'A1' }),
    ]
    // Sticker was moved from s1 (index 1) to s2 (index 2)
    const clips = [
      clip('shot-1', 0),
      { id: 'sticker-fire', type: 'image', stickerId: 'fire', startTime: 0, duration: 3, trackIndex: 2 } as TimelineClip,
      { id: 'audio-1', type: 'audio', startTime: 0, duration: 10, trackIndex: 3 } as TimelineClip,
    ]

    const result = pruneEmptyTracks(tracks, clips)

    // S1 was empty, so it must be removed. Surviving S2 is renumbered to S1.
    expect(result.tracks.map(t => t.id)).toEqual(['v1', 's2', 'a1'])
    expect(result.tracks.map(t => t.name)).toEqual(['V1', 'S1', 'A1'])
    expect(result.clips.find(c => c.id === 'sticker-fire')?.trackIndex).toBe(1)
    expect(result.clips.find(c => c.id === 'audio-1')?.trackIndex).toBe(2)
  })

  it('prunes empty sticker tracks even if sticker track is at index 0', () => {
    const tracks = [
      track('track-s1', 'sticker', { name: 'Sticker Overlay' }),
      track('track-v1', 'video', { name: 'V1' }),
    ]
    // Sticker moved away; only track-v1 has clips
    const clips = [clip('shot-1', 1)]

    const result = pruneEmptyTracks(tracks, clips)

    expect(result.tracks.map(t => t.id)).toEqual(['track-v1'])
    expect(result.clips[0].trackIndex).toBe(0)
  })
})

describe('DEFAULT_TRACKS', () => {
  it('is the video track only', () => {
    expect(DEFAULT_TRACKS).toHaveLength(1)
    expect(DEFAULT_TRACKS[0].kind).toBe('video')
  })
})
