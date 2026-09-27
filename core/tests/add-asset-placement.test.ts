import { describe, it, expect } from 'vitest'
import { createInitialEditorState } from '../src/editor-state'
import { insertAssetsToTimeline } from '../src/editor-actions'
import { selectActiveTimeline } from '../src/editor-selectors'
import type { Asset, Timeline } from '../src/project-model'

/**
 * Where the Add button drops an asset.
 *
 * `position: 'start'` is opt-in rather than the default, because the MCP
 * `insert_clip` operation goes through the same action and agents rely on it
 * appending.
 */

function asset(id: string, duration: number): Asset {
  return {
    id,
    type: 'video',
    path: `/tmp/${id}.mp4`,
    prompt: '',
    resolution: '1920x1080',
    duration,
    createdAt: 0,
  }
}

const existing = asset('asset-existing', 10)
const added = asset('asset-added', 4)

function stateWithOneClipOnV1() {
  const timeline = {
    id: 'timeline-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
    ],
    clips: [
      {
        id: 'clip-existing',
        assetId: existing.id,
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: false,
        volume: 1,
        trackIndex: 0,
        asset: existing,
        flipH: false,
        flipV: false,
        opacity: 100,
      },
    ],
    subtitles: [],
  } as unknown as Timeline

  return createInitialEditorState({
    assets: [existing, added],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

describe('adding an asset to the main video track', () => {
  it("puts it in front of the existing edit with position 'start'", () => {
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added],
      trackIndex: 0,
      position: 'start',
    })
    const clips = selectActiveTimeline(next)!.clips.filter(c => c.trackIndex === 0)

    expect(clips).toHaveLength(2)
    const byTime = [...clips].sort((a, b) => a.startTime - b.startTime)
    expect(byTime[0].assetId).toBe(added.id)
    expect(byTime[0].startTime).toBe(0)
  })

  it('pushes the existing clip later instead of trimming it', () => {
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added],
      trackIndex: 0,
      position: 'start',
    })
    const clips = selectActiveTimeline(next)!.clips.filter(c => c.trackIndex === 0)
    const existingClip = clips.find(c => c.assetId === existing.id)!

    expect(existingClip.duration).toBe(10)
    expect(existingClip.startTime).toBeGreaterThan(0)
  })

  it('leaves no gap on the magnetic track', () => {
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added],
      trackIndex: 0,
      position: 'start',
    })
    const byTime = selectActiveTimeline(next)!.clips
      .filter(c => c.trackIndex === 0)
      .sort((a, b) => a.startTime - b.startTime)

    expect(byTime[0].startTime).toBe(0)
    expect(byTime[1].startTime).toBe(byTime[0].duration)
  })

  it('keeps the existing clip even when the new one is longer than it', () => {
    // The bug this guards: resolveOverlaps drops any clip fully covered by the
    // inserted range, so adding a 12s asset in front of a 10s one deleted the
    // 10s clip instead of pushing it aside. Adding twice looked like the second
    // asset had replaced the first.
    const longer = asset('asset-longer', 12)
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [longer],
      trackIndex: 0,
      position: 'start',
    })
    const byTime = selectActiveTimeline(next)!.clips
      .filter(c => c.trackIndex === 0)
      .sort((a, b) => a.startTime - b.startTime)

    expect(byTime).toHaveLength(2)
    expect(byTime[0].assetId).toBe(longer.id)
    expect(byTime[1].assetId).toBe(existing.id)
    expect(byTime[1].duration).toBe(10)
  })

  it('keeps every clip when the same asset is added twice in a row', () => {
    // What the user actually did: click Add, click Add again. The second click
    // must land in front of the first, not on top of it.
    const first = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added], trackIndex: 0, position: 'start',
    })
    const second = insertAssetsToTimeline(first, {
      assets: [added], trackIndex: 0, position: 'start',
    })

    const byTime = selectActiveTimeline(second)!.clips
      .filter(c => c.trackIndex === 0)
      .sort((a, b) => a.startTime - b.startTime)

    expect(byTime).toHaveLength(3)
    expect(byTime.map(c => c.assetId)).toEqual([added.id, added.id, existing.id])
    expect(byTime[0].startTime).toBe(0)
    expect(byTime[1].startTime).toBe(byTime[0].duration)
    expect(byTime[2].startTime).toBe(byTime[0].duration + byTime[1].duration)
  })

  it('still appends by default, which is what MCP insert_clip relies on', () => {
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added],
      trackIndex: 0,
    })
    const byTime = selectActiveTimeline(next)!.clips
      .filter(c => c.trackIndex === 0)
      .sort((a, b) => a.startTime - b.startTime)

    expect(byTime[0].assetId).toBe(existing.id)
    expect(byTime[1].assetId).toBe(added.id)
  })

  it('honours an explicit startTime over the position hint', () => {
    const next = insertAssetsToTimeline(stateWithOneClipOnV1(), {
      assets: [added],
      trackIndex: 0,
      startTime: 10,
      position: 'start',
    })
    const byTime = selectActiveTimeline(next)!.clips
      .filter(c => c.trackIndex === 0)
      .sort((a, b) => a.startTime - b.startTime)

    expect(byTime[0].assetId).toBe(existing.id)
  })
})

describe('adding audio assets to timeline with cascading layers', () => {
  function audioAsset(id: string, duration = 5): Asset {
    return {
      id,
      type: 'audio',
      path: `/tmp/${id}.mp3`,
      prompt: '',
      resolution: '',
      duration,
      createdAt: 0,
    }
  }

  it('cascades consecutive audio clips into lower audio tracks when occupied', () => {
    const audio1 = audioAsset('audio-1', 10)
    const audio2 = audioAsset('audio-2', 8)
    const audio3 = audioAsset('audio-3', 6)

    const initial = stateWithOneClipOnV1()
    // First audio added
    const after1 = insertAssetsToTimeline(initial, {
      assets: [audio1],
      trackIndex: 0,
      startTime: 0,
    })

    const t1 = selectActiveTimeline(after1)!
    // An audio track A1 was created
    const audioClips1 = t1.clips.filter(c => c.type === 'audio')
    expect(audioClips1).toHaveLength(1)
    const a1Track = t1.tracks[audioClips1[0].trackIndex]
    expect(a1Track.kind).toBe('audio')
    expect(a1Track.name).toBe('A1')

    // Second audio added at same start time (e.g. 0) -> A1 is occupied, should go to new track A2
    const after2 = insertAssetsToTimeline(after1, {
      assets: [audio2],
      trackIndex: 0,
      startTime: 0,
    })

    const t2 = selectActiveTimeline(after2)!
    const audioClips2 = t2.clips.filter(c => c.type === 'audio')
    expect(audioClips2).toHaveLength(2)
    const clip1 = audioClips2.find(c => c.assetId === audio1.id)!
    const clip2 = audioClips2.find(c => c.assetId === audio2.id)!
    expect(clip1.trackIndex).not.toBe(clip2.trackIndex)
    expect(t2.tracks[clip2.trackIndex].name).toBe('A2')

    // Third audio added in a batch
    const after3 = insertAssetsToTimeline(after2, {
      assets: [audio3],
      trackIndex: 0,
      startTime: 0,
    })

    const t3 = selectActiveTimeline(after3)!
    const audioClips3 = t3.clips.filter(c => c.type === 'audio')
    expect(audioClips3).toHaveLength(3)
    const clip3 = audioClips3.find(c => c.assetId === audio3.id)!
    expect(t3.tracks[clip3.trackIndex].name).toBe('A3')
  })

  it('cascades a multi-asset batch of audio files onto separate lower layers', () => {
    const audioA = audioAsset('audio-a', 10)
    const audioB = audioAsset('audio-b', 8)

    const initial = stateWithOneClipOnV1()
    const result = insertAssetsToTimeline(initial, {
      assets: [audioA, audioB],
      trackIndex: 0,
      startTime: 0,
    })

    const timeline = selectActiveTimeline(result)!
    const audioClips = timeline.clips.filter(c => c.type === 'audio')
    expect(audioClips).toHaveLength(2)
    const clipA = audioClips.find(c => c.assetId === audioA.id)!
    const clipB = audioClips.find(c => c.assetId === audioB.id)!

    expect(clipA.trackIndex).not.toBe(clipB.trackIndex)
    expect(timeline.tracks[clipA.trackIndex].name).toBe('A1')
    expect(timeline.tracks[clipB.trackIndex].name).toBe('A2')
  })

  it('reuses existing audio track if time range does not overlap', () => {
    const audio1 = audioAsset('audio-1', 5)
    const audio2 = audioAsset('audio-2', 5)

    const initial = stateWithOneClipOnV1()
    const after1 = insertAssetsToTimeline(initial, {
      assets: [audio1],
      trackIndex: 0,
      startTime: 0,
    })

    // Add audio2 starting at 10 (no overlap with [0, 5])
    const after2 = insertAssetsToTimeline(after1, {
      assets: [audio2],
      trackIndex: 0,
      startTime: 10,
    })

    const t2 = selectActiveTimeline(after2)!
    const audioClips = t2.clips.filter(c => c.type === 'audio')
    expect(audioClips).toHaveLength(2)
    // Both can share track A1 since there is no time conflict
    expect(audioClips[0].trackIndex).toBe(audioClips[1].trackIndex)
  })

  it('automatically selects newly inserted clips in session.selection.clipIds', () => {
    const initial = stateWithOneClipOnV1()
    const next = insertAssetsToTimeline(initial, {
      assets: [added],
      trackIndex: 0,
      startTime: 10,
    })

    const selectedIds = next.session.selection.clipIds
    expect(selectedIds.size).toBeGreaterThan(0)
    const t = selectActiveTimeline(next)!
    const addedClip = t.clips.find(c => c.assetId === added.id)
    expect(addedClip).toBeDefined()
    expect(selectedIds.has(addedClip!.id)).toBe(true)
  })
})

