import { describe, it, expect } from 'vitest'
import { insertAssetsToTimeline } from '../src/editor-actions'
import { createInitialEditorState } from '../src/editor-state'
import type { EditorModel } from '../src/editor-state'
import type { Timeline, TimelineClip, Track, Asset } from '../src/project-model'

const subtitleTrack: Track = {
  id: 'track-sub',
  name: 'Subtitles',
  muted: false,
  locked: false,
  kind: 'video',
  type: 'subtitle',
}

const videoTrack: Track = {
  id: 'track-v1',
  name: 'V1',
  muted: false,
  locked: false,
  kind: 'video',
  type: 'default',
}

const audioTrack: Track = {
  id: 'track-a1',
  name: 'A1',
  muted: false,
  locked: false,
  kind: 'audio',
  type: 'default',
}

const existingVideoClip: TimelineClip = {
  id: 'clip-1',
  type: 'video',
  startTime: 0,
  duration: 10,
  trimStart: 0,
  trimEnd: 0,
  trackIndex: 1, // V1 is at index 1 because Subtitles is at index 0
  speed: 1,
  assetId: 'asset-1',
} as unknown as TimelineClip

function createCaptionedState() {
  const timeline: Timeline = {
    id: 'tl-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [subtitleTrack, videoTrack, audioTrack],
    clips: [existingVideoClip],
    subtitles: [
      { id: 'sub-1', text: 'Hello', startTime: 0, endTime: 2, trackIndex: 0 },
    ],
  }
  const model: EditorModel = {
    assets: [
      { id: 'asset-1', type: 'video', prompt: 'Existing.mp4', path: '/media/1.mp4', resolution: '1080p', duration: 10, createdAt: 0 },
      { id: 'asset-2', type: 'image', prompt: 'Photo.png', path: '/media/photo.png', resolution: '1080p', duration: 5, createdAt: 0 },
      { id: 'asset-3', type: 'video', prompt: 'New.mp4', path: '/media/2.mp4', resolution: '1080p', duration: 8, createdAt: 0 },
    ] as unknown as Asset[],
    timelines: [timeline],
    activeTimelineId: 'tl-1',
    bins: {},
  }
  return createInitialEditorState(model)
}

describe('insertAssetsToTimeline with captioned timeline', () => {
  it('inserts an image onto V1 (trackIndex 1) instead of subtitle track (trackIndex 0) when trackIndex is omitted', () => {
    const state = createCaptionedState()
    const imageAsset = state.editorModel.assets.find(a => a.id === 'asset-2')!

    const nextState = insertAssetsToTimeline(state, {
      assets: [imageAsset],
      position: 'start',
    })

    const activeTimeline = nextState.editorModel.timelines.find(t => t.id === 'tl-1')!
    const insertedClip = activeTimeline.clips.find(c => c.assetId === 'asset-2')!

    expect(insertedClip).toBeDefined()
    // Must be on V1 (trackIndex 1), NEVER on the subtitle track (trackIndex 0)
    expect(insertedClip.trackIndex).toBe(1)
    expect(activeTimeline.tracks[insertedClip.trackIndex].type).not.toBe('subtitle')
    expect(activeTimeline.tracks[insertedClip.trackIndex].name).toBe('V1')
  })

  it('redirects to V1 when trackIndex is explicitly passed as 0 (subtitle track)', () => {
    const state = createCaptionedState()
    const videoAsset = state.editorModel.assets.find(a => a.id === 'asset-3')!

    const nextState = insertAssetsToTimeline(state, {
      assets: [videoAsset],
      trackIndex: 0, // Passing 0 (which points to Subtitles)
      startTime: 5,
    })

    const activeTimeline = nextState.editorModel.timelines.find(t => t.id === 'tl-1')!
    const insertedClip = activeTimeline.clips.find(c => c.assetId === 'asset-3')!

    expect(insertedClip).toBeDefined()
    expect(insertedClip.trackIndex).toBe(1) // Redirected to V1
    expect(activeTimeline.tracks[insertedClip.trackIndex].type).not.toBe('subtitle')
  })
})
