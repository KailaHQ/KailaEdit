import { describe, it, expect } from 'vitest'
import { createInitialEditorState } from '../src/editor-state'
import { insertAssetsToTimeline, detachAudio } from '../src/editor-actions'
import { selectActiveTimeline } from '../src/editor-selectors'
import type { Asset, Timeline } from '../src/project-model'

/**
 * A video dropped on the timeline stays one clip.
 *
 * KomfyEdit used to split every imported video into a video clip plus a linked
 * audio clip on the nearest audio track. Both playback and export already knew
 * how to read the sound straight off a video clip that has no linked audio
 * clip, so the split only ever cost the user a second row to manage.
 */

const videoAsset: Asset = {
  id: 'asset-video',
  type: 'video',
  path: '/tmp/clip.mp4',
  prompt: '',
  resolution: '1920x1080',
  duration: 12,
  createdAt: 0,
}

function emptyState() {
  const timeline = {
    id: 'timeline-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
      { id: 'track-a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
    ],
    clips: [],
    subtitles: [],
  } as unknown as Timeline

  return createInitialEditorState({
    assets: [videoAsset],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

describe('importing a video with sound', () => {
  it('creates exactly one clip, on the video track', () => {
    const next = insertAssetsToTimeline(emptyState(), { assets: [videoAsset], trackIndex: 0 })
    const clips = selectActiveTimeline(next)!.clips

    expect(clips).toHaveLength(1)
    expect(clips[0].type).toBe('video')
    expect(clips[0].trackIndex).toBe(0)
  })

  it('leaves no linked audio clip behind', () => {
    const next = insertAssetsToTimeline(emptyState(), { assets: [videoAsset], trackIndex: 0 })
    const clips = selectActiveTimeline(next)!.clips

    // The guards in usePlaybackAudioSync (isAudioSourceClip) and
    // electron/export/audio-mix.ts both key off this being absent: that is what
    // makes the video clip itself the owner of the sound.
    expect(clips[0].linkedClipIds).toBeUndefined()
    expect(clips.some(clip => clip.type === 'audio')).toBe(false)
  })

  it('does not leave the clip muted, so the sound still plays and exports', () => {
    const next = insertAssetsToTimeline(emptyState(), { assets: [videoAsset], trackIndex: 0 })
    const clip = selectActiveTimeline(next)!.clips[0]

    expect(clip.muted).toBe(false)
    expect(clip.volume).toBe(1)
  })

  it('still splits on demand through Extract audio', () => {
    const imported = insertAssetsToTimeline(emptyState(), { assets: [videoAsset], trackIndex: 0 })
    const videoClipId = selectActiveTimeline(imported)!.clips[0].id

    const detached = detachAudio(imported, videoClipId)
    const clips = selectActiveTimeline(detached)!.clips

    expect(clips).toHaveLength(2)
    const audioClip = clips.find(clip => clip.type === 'audio')
    expect(audioClip).toBeDefined()
    expect(audioClip!.linkedClipIds).toContain(videoClipId)
  })
})
