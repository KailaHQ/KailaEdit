// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  packTrack1,
  packMainVideoTrack,
  resolveOverlaps,
  pruneEmptyOverlayTracks,
} from '../src/video-editor-utils'
import {
  createDefaultTimeline,
  createInitialEditorState,
  getEditorModel,
  insertAssetsToTimeline,
  splitClipsAtTime,
  deleteClips,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  type TimelineClip,
  type Track,
  type SubtitleClip,
  type EditorState,
  type EditorModel,
  type Asset,
  type Project,
} from '../src/index'
import { parseTimelineXml } from '../src/timeline-import'

describe('S1-2: Pure editing logic safety net and trap prevention', () => {
  const createMockClip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
    id: `clip-${Math.random()}`,
    assetId: 'asset-1',
    type: 'video',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 5,
    speed: 1,
    reversed: false,
    muted: false,
    trackIndex: 0,
    volume: 1,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: DEFAULT_CLIP_TRANSITION,
    transitionOut: DEFAULT_CLIP_TRANSITION,
    colorCorrection: DEFAULT_COLOR_CORRECTION,
    transform: DEFAULT_CLIP_TRANSFORM,
    opacity: 100,
    ...overrides,
  })

  const createMockState = (clips: TimelineClip[] = [], tracks?: Track[]): EditorState => {
    const defaultTracks: Track[] = tracks ?? [
      { id: 'track-v1', name: 'V1', kind: 'video', muted: false, locked: false, sourcePatched: true },
      { id: 'track-a1', name: 'A1', kind: 'audio', muted: false, locked: false, sourcePatched: true },
    ]

    const timeline = {
      ...createDefaultTimeline('Timeline 1'),
      tracks: defaultTracks,
      clips,
    }

    const model: EditorModel = {
      assets: [],
      bins: {},
      timelines: [timeline],
      activeTimelineId: timeline.id,
    }

    return createInitialEditorState(model, {
      leftPanelWidth: 470,
      rightPanelWidth: 366,
      timelineHeight: 300,
      assetsHeight: 0,
    })
  }

  // ── 1. Trap 2.3: V1 is magnetic (seamless from 0s) ──────────────────────
  describe('Trap 2.3: V1 magnetic invariants', () => {
    it('packTrack1 packs clips seamlessly starting at 0 without gaps', () => {
      const c1 = createMockClip({ id: 'c1', trackIndex: 0, startTime: 2, duration: 4 })
      const c2 = createMockClip({ id: 'c2', trackIndex: 0, startTime: 10, duration: 6 })

      const packed = packTrack1([c1, c2])
      expect(packed[0].startTime).toBe(0)
      expect(packed[0].duration).toBe(4)
      expect(packed[1].startTime).toBe(4)
      expect(packed[1].duration).toBe(6)
    })

    it('packMainVideoTrack leaves overlay and audio tracks unchanged while packing V1', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      ]
      const v1Clip = createMockClip({ id: 'v1c', trackIndex: 0, startTime: 5, duration: 3 })
      const a1Clip = createMockClip({ id: 'a1c', trackIndex: 1, type: 'audio', startTime: 5, duration: 3 })

      const result = packMainVideoTrack(tracks, [v1Clip, a1Clip])
      const packedV1 = result.find(c => c.id === 'v1c')
      const packedA1 = result.find(c => c.id === 'a1c')

      expect(packedV1?.startTime).toBe(0)
      expect(packedA1?.startTime).toBe(5) // Audio track was not packed to 0
    })

    it('deleting a clip on V1 ripples subsequent V1 clips left to 0', () => {
      const c1 = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 3 })
      const c2 = createMockClip({ id: 'c2', trackIndex: 0, startTime: 3, duration: 4 })
      const state = createMockState([c1, c2])

      const next = deleteClips(state, ['c1'])
      const timeline = next.editorModel.timelines[0]
      expect(timeline.clips.length).toBe(1)
      expect(timeline.clips[0].id).toBe('c2')
      expect(timeline.clips[0].startTime).toBe(0) // Rippled to 0
    })

    it('inserting into V1 maintains seamless tiling', () => {
      const c1 = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 4 })
      const state = createMockState([c1])
      const asset: Asset = {
        id: 'new-v',
        type: 'video',
        path: '/v.mp4',
        prompt: 'new',
        resolution: '1080p',
        duration: 3,
        createdAt: Date.now(),
      }

      const next = insertAssetsToTimeline(state, { assets: [asset], trackIndex: 0, startTime: 0 })
      const clips = next.editorModel.timelines[0].clips.filter(c => c.trackIndex === 0)
      clips.sort((a, b) => a.startTime - b.startTime)

      expect(clips[0].startTime).toBe(0)
      expect(clips[1].startTime).toBe(clips[0].duration)
    })
  })

  // ── 2. Trap 2.2: Never fail silently / Media routing ─────────────────────
  describe('Trap 2.2: Fail closed & media routing', () => {
    it('routes dropped visual clip away from audio track to a visual track instead of discarding', () => {
      const state = createMockState([])
      const videoAsset: Asset = {
        id: 'vid-1',
        type: 'video',
        path: '/movie.mp4',
        prompt: 'video clip',
        resolution: '1080p',
        duration: 5,
        createdAt: Date.now(),
      }

      // Drop targeting trackIndex 1 (which is A1 audio track)
      const next = insertAssetsToTimeline(state, {
        assets: [videoAsset],
        trackIndex: 1, // Audio track
        startTime: 0,
      })

      const clips = next.editorModel.timelines[0].clips
      expect(clips.length).toBeGreaterThan(0)
      const visualClip = clips.find(c => c.type === 'video')
      expect(visualClip).toBeDefined()
      // Routed to video track (track 0), not dropped!
      expect(visualClip?.trackIndex).toBe(0)
    })

    it('routes dropped clip away from locked track to an open track or creates new track', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: true }, // LOCKED
        { id: 'v2', name: 'V2', kind: 'video', muted: false, locked: false }, // OPEN
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      ]
      const state = createMockState([], tracks)
      const videoAsset: Asset = {
        id: 'vid-locked-test',
        type: 'video',
        path: '/vid.mp4',
        prompt: 'vid',
        resolution: '1080p',
        duration: 4,
        createdAt: Date.now(),
      }

      const next = insertAssetsToTimeline(state, {
        assets: [videoAsset],
        trackIndex: 0, // Targeted locked V1
        startTime: 0,
      })

      const clips = next.editorModel.timelines[0].clips
      expect(clips.length).toBeGreaterThan(0)
      const visualClip = clips.find(c => c.type === 'video')
      // Did not write to locked track V1; went to open V2
      expect(visualClip?.trackIndex).toBe(1)
    })

    it('creates new track if all existing compatible tracks are locked', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: true }, // LOCKED
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      ]
      const state = createMockState([], tracks)
      const videoAsset: Asset = {
        id: 'vid-all-locked',
        type: 'video',
        path: '/vid.mp4',
        prompt: 'vid',
        resolution: '1080p',
        duration: 4,
        createdAt: Date.now(),
      }

      const next = insertAssetsToTimeline(state, {
        assets: [videoAsset],
        trackIndex: 0,
        startTime: 0,
      })

      const nextTimeline = next.editorModel.timelines[0]
      expect(nextTimeline.clips.length).toBeGreaterThan(0)
      // A new track was created because V1 was locked
      expect(nextTimeline.tracks.length).toBeGreaterThan(2)
      const clip = nextTimeline.clips.find(c => c.type === 'video')
      expect(nextTimeline.tracks[clip!.trackIndex].locked).toBe(false)
    })
  })

  // ── 3. Trap 2.1: Atomic track creation ──────────────────────────────────
  describe('Trap 2.1: Atomic track creation and snapshot overwrite prevention', () => {
    it('creates new track and places clip on it atomically without losing the new track', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      ]
      const state = createMockState([], tracks)
      const asset: Asset = {
        id: 'new-track-asset',
        type: 'video',
        path: '/top.mp4',
        prompt: 'top',
        resolution: '1080p',
        duration: 6,
        createdAt: Date.now(),
      }

      // Target trackIndex 99 (way above existing tracks)
      const next = insertAssetsToTimeline(state, {
        assets: [asset],
        trackIndex: 99,
        startTime: 0,
      })

      const timeline = next.editorModel.timelines[0]
      const clip = timeline.clips.find(c => c.assetId === 'new-track-asset')
      expect(clip).toBeDefined()
      // The track pointed to by clip.trackIndex MUST exist in timeline.tracks!
      expect(timeline.tracks[clip!.trackIndex]).toBeDefined()
      expect(timeline.tracks[clip!.trackIndex].kind).toBe('video')
    })

    it('newly created track persists alongside existing clips on other tracks', () => {
      const existingClip = createMockClip({ id: 'existing', trackIndex: 0, startTime: 0, duration: 5 })
      const state = createMockState([existingClip])
      const asset: Asset = {
        id: 'asset-2',
        type: 'video',
        path: '/v2.mp4',
        prompt: 'v2',
        resolution: '1080p',
        duration: 3,
        createdAt: Date.now(),
      }

      const next = insertAssetsToTimeline(state, {
        assets: [asset],
        trackIndex: 10,
        startTime: 2,
      })

      const timeline = next.editorModel.timelines[0]
      expect(timeline.clips.some(c => c.id === 'existing')).toBe(true)
      expect(timeline.clips.some(c => c.assetId === 'asset-2')).toBe(true)
    })
  })

  // ── 4. Project load re-attachment of orphan clips ────────────────────────
  describe('Project load orphan clip recovery', () => {
    it('re-attaches video clip with non-existent trackIndex to valid main video track', () => {
      const project: Project = {
        version: 2,
        id: 'p-orphan',
        name: 'Orphan test',
        createdAt: 1000,
        updatedAt: 2000,
        bins: {},
        assets: [],
        timelines: [
          {
            id: 't-1',
            name: 'T1',
            createdAt: 1000,
            tracks: [
              { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
              { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
            ],
            clips: [
              createMockClip({ id: 'orphan-1', trackIndex: 99, type: 'video', startTime: 0 }),
            ],
            subtitles: [],
          },
        ],
        activeTimelineId: 't-1',
      }

      const model = getEditorModel(project)
      const timeline = model.timelines[0]
      const clip = timeline.clips.find(c => c.id === 'orphan-1')
      expect(clip).toBeDefined()
      expect(clip!.trackIndex).toBe(0) // Reattached to V1!
    })

    it('re-attaches audio clip with non-existent trackIndex to first audio track', () => {
      const project: Project = {
        version: 2,
        id: 'p-orphan-audio',
        name: 'Orphan audio test',
        createdAt: 1000,
        updatedAt: 2000,
        bins: {},
        assets: [],
        timelines: [
          {
            id: 't-1',
            name: 'T1',
            createdAt: 1000,
            tracks: [
              { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
              { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
            ],
            clips: [
              createMockClip({ id: 'orphan-audio', trackIndex: 88, type: 'audio', startTime: 2 }),
            ],
            subtitles: [],
          },
        ],
        activeTimelineId: 't-1',
      }

      const model = getEditorModel(project)
      const timeline = model.timelines[0]
      const clip = timeline.clips.find(c => c.id === 'orphan-audio')
      expect(clip).toBeDefined()
      expect(clip!.trackIndex).toBe(1) // Reattached to A1!
    })
  })

  // ── 5. pruneEmptyOverlayTracks ──────────────────────────────────────────
  describe('pruneEmptyOverlayTracks', () => {
    it('prunes empty overlay tracks and remaps trackIndex of BOTH clips and subtitles', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false }, // 0
        { id: 'v2-empty', name: 'V2', kind: 'video', muted: false, locked: false }, // 1 (empty overlay)
        { id: 'v3', name: 'V3', kind: 'video', muted: false, locked: false }, // 2 (has clip)
        { id: 's1', name: 'S1', type: 'subtitle', muted: false, locked: false }, // 3 (has subtitle)
      ]

      const clips: TimelineClip[] = [
        createMockClip({ id: 'c-v1', trackIndex: 0, startTime: 0, duration: 5 }),
        createMockClip({ id: 'c-v3', trackIndex: 2, startTime: 0, duration: 5 }),
      ]

      const subtitles: SubtitleClip[] = [
        { id: 'sub-1', text: 'Hello', startTime: 0, endTime: 3, trackIndex: 3 },
      ]

      const result = pruneEmptyOverlayTracks(tracks, clips, subtitles)

      // Empty track v2-empty is removed
      expect(result.tracks.length).toBe(3)
      expect(result.tracks.some(t => t.id === 'v2-empty')).toBe(false)

      // c-v3 remapped from 2 to 1
      const remappedClip = result.clips.find(c => c.id === 'c-v3')
      expect(remappedClip?.trackIndex).toBe(1)

      // Subtitle remapped from 3 to 2
      const remappedSub = result.subtitles.find(s => s.id === 'sub-1')
      expect(remappedSub?.trackIndex).toBe(2)
    })

    it('does not prune main video track even if empty', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      ]
      const result = pruneEmptyOverlayTracks(tracks, [], [])
      expect(result.tracks.some(t => t.id === 'v1')).toBe(true)
      expect(result.tracks.some(t => t.id === 'a1')).toBe(false)
      expect(result.tracks).toHaveLength(1)
    })

    it('prunes empty audio tracks including A1 when audio clip is moved', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false }, // 0
        { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false }, // 1 (empty)
        { id: 'a2-empty', name: 'A2', kind: 'audio', muted: false, locked: false }, // 2 (empty, was previous track)
        { id: 'a3', name: 'A3', kind: 'audio', muted: false, locked: false }, // 3 (has clip)
      ]

      const clips: TimelineClip[] = [
        createMockClip({ id: 'c-audio', trackIndex: 3, type: 'audio', startTime: 0, duration: 5 }),
      ]

      const result = pruneEmptyOverlayTracks(tracks, clips, [])

      // Both empty audio tracks a1 and a2-empty are removed, a3 becomes A1
      expect(result.tracks.length).toBe(2)
      expect(result.tracks.some(t => t.id === 'a1')).toBe(false)
      expect(result.tracks.some(t => t.id === 'a2-empty')).toBe(false)
      expect(result.tracks.find(t => t.id === 'a3')?.name).toBe('A1')

      const remapped = result.clips.find(c => c.id === 'c-audio')
      expect(remapped?.trackIndex).toBe(1)
    })
  })

  // ── 6. resolveOverlaps ──────────────────────────────────────────────────
  describe('resolveOverlaps', () => {
    it('trims end of preceding clip when overlapped by placed clip', () => {
      const existing = createMockClip({ id: 'c1', trackIndex: 1, startTime: 0, duration: 6 })
      const placed = createMockClip({ id: 'placed', trackIndex: 1, startTime: 4, duration: 4 })

      const result = resolveOverlaps([existing, placed], new Set(['placed']))
      const updatedExisting = result.find(c => c.id === 'c1')
      expect(updatedExisting?.duration).toBe(4) // Trimmed from 6 to 4
    })

    it('removes existing clip completely if completely covered by placed clip on overlay track', () => {
      const existing = createMockClip({ id: 'small', trackIndex: 1, startTime: 2, duration: 2 })
      const placed = createMockClip({ id: 'huge', trackIndex: 1, startTime: 0, duration: 8 })

      const result = resolveOverlaps([existing, placed], new Set(['huge']))
      expect(result.find(c => c.id === 'small')).toBeUndefined()
    })

    it('never removes existing clip on Track 1 (magnetic) when moved clip is longer and covers it completely', () => {
      // Bug regression: clip on Track 2 (12.1s) dragged down to Track 1 at 0s where an 11.3s clip existed.
      // The 11.3s clip must NOT be deleted, it must be pushed forward.
      const clip1 = createMockClip({ id: 'clip1', trackIndex: 0, startTime: 0, duration: 11.3 })
      const clip2 = createMockClip({ id: 'clip2', trackIndex: 0, startTime: 11.3, duration: 3.0 })
      const draggedDown = createMockClip({ id: 'dragged', trackIndex: 0, startTime: 0, duration: 12.1 })

      const resolved = resolveOverlaps([clip1, clip2, draggedDown], new Set(['dragged']), [], 0)
      expect(resolved.find(c => c.id === 'clip1')).toBeDefined()
      expect(resolved.find(c => c.id === 'clip2')).toBeDefined()
      expect(resolved.find(c => c.id === 'dragged')).toBeDefined()

      const packed = packTrack1(resolved, 0)
      const byTime = [...packed].sort((a, b) => a.startTime - b.startTime)
      expect(byTime.map(c => c.id)).toEqual(['dragged', 'clip1', 'clip2'])
      expect(byTime[0].startTime).toBe(0)
      expect(byTime[1].startTime).toBe(12.1)
      expect(byTime[2].startTime).toBe(12.1 + 11.3)
    })

    it('splits or pushes existing clip forward when placed clip is dropped in its center', () => {
      const existing = createMockClip({ id: 'long', trackIndex: 1, startTime: 0, duration: 10 })
      const placed = createMockClip({ id: 'middle', trackIndex: 1, startTime: 3, duration: 4 })

      const result = resolveOverlaps([existing, placed], new Set(['middle']))
      const pushed = result.find(c => c.id === 'long')

      expect(pushed).toBeDefined()
      expect(pushed?.startTime).toBe(7)
    })

    it('leaves clips on different tracks untouched', () => {
      const track0Clip = createMockClip({ id: 't0', trackIndex: 0, startTime: 0, duration: 10 })
      const track1Clip = createMockClip({ id: 't1', trackIndex: 1, startTime: 2, duration: 4 })

      const result = resolveOverlaps([track0Clip, track1Clip], new Set(['t1']))
      expect(result.find(c => c.id === 't0')?.duration).toBe(10)
    })

    it('preserves intentional overlap when clips are connected by a transition', () => {
      const clipA = createMockClip({ id: 'a', trackIndex: 0, startTime: 0, duration: 5.5 })
      const clipB = createMockClip({ id: 'b', trackIndex: 0, startTime: 4.5, duration: 5.5 })
      const transitions = [{ leftClipId: 'a', rightClipId: 'b', duration: 1.0 }]

      const result = resolveOverlaps([clipA, clipB], new Set(['a']), transitions)
      const b = result.find(c => c.id === 'b')
      expect(b?.startTime).toBe(4.5)
      expect(b?.duration).toBe(5.5)
    })
  })

  // ── 7. splitClipsAtTime ─────────────────────────────────────────────────
  describe('splitClipsAtTime', () => {
    it('splits clip at target time with accurate durations and trims', () => {
      const c = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 10, trimStart: 0, trimEnd: 0, speed: 1 })
      const state = createMockState([c])

      const next = splitClipsAtTime(state, ['c1'], 4)
      const clips = next.editorModel.timelines[0].clips
      expect(clips.length).toBe(2)

      const left = clips.find(x => x.startTime === 0)
      const right = clips.find(x => x.startTime === 4)

      expect(left?.duration).toBe(4)
      expect(left?.trimStart).toBe(0)
      expect(left?.trimEnd).toBe(6)
      expect(right?.duration).toBe(6)
      expect(right?.trimStart).toBe(4)
      expect(right?.trimEnd).toBe(0)
    })

    it('does not split if time is at exact boundary (startTime or endTime)', () => {
      const c = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 5 })
      const state = createMockState([c])

      const next = splitClipsAtTime(state, ['c1'], 5)
      expect(next.editorModel.timelines[0].clips.length).toBe(1)
    })

    it('does not split clip on locked track', () => {
      const tracks: Track[] = [
        { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: true }, // Locked
      ]
      const c = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 8 })
      const state = createMockState([c], tracks)

      const next = splitClipsAtTime(state, ['c1'], 4)
      expect(next.editorModel.timelines[0].clips.length).toBe(1)
    })

    it('preserves speed and effects across both split clips', () => {
      const c = createMockClip({
        id: 'c1',
        trackIndex: 0,
        startTime: 0,
        duration: 6,
        speed: 2,
        reversed: true,
        effects: [{ id: 'fx1', type: 'blur', enabled: true, params: { amount: 10 } }],
      })
      const state = createMockState([c])

      const next = splitClipsAtTime(state, ['c1'], 2)
      const clips = next.editorModel.timelines[0].clips
      expect(clips.length).toBe(2)
      expect(clips[0].speed).toBe(2)
      expect(clips[1].speed).toBe(2)
      expect(clips[0].reversed).toBe(true)
      expect(clips[1].reversed).toBe(true)
      expect(clips[0].effects?.length).toBe(1)
      expect(clips[1].effects?.length).toBe(1)
    })
  })

  // ── 8. deleteClips ──────────────────────────────────────────────────────
  describe('deleteClips', () => {
    it('deletes overlay clip without altering positions of surrounding overlay clips', () => {
      const c1 = createMockClip({ id: 'o1', trackIndex: 1, startTime: 2, duration: 3 })
      const c2 = createMockClip({ id: 'o2', trackIndex: 1, startTime: 8, duration: 4 })
      const state = createMockState([c1, c2])

      const next = deleteClips(state, ['o1'])
      const remaining = next.editorModel.timelines[0].clips
      expect(remaining.length).toBe(1)
      expect(remaining[0].id).toBe('o2')
      expect(remaining[0].startTime).toBe(8) // Did not ripple on overlay track
    })

    it('deleting multiple clips across tracks in a single operation', () => {
      const c1 = createMockClip({ id: 'v1c', trackIndex: 0, startTime: 0, duration: 4 })
      const c2 = createMockClip({ id: 'a1c', trackIndex: 1, type: 'audio', startTime: 0, duration: 4 })
      const state = createMockState([c1, c2])

      const next = deleteClips(state, ['v1c', 'a1c'])
      expect(next.editorModel.timelines[0].clips.length).toBe(0)
    })

    it('deleting non-existent clip ID is a no-op that preserves state', () => {
      const c = createMockClip({ id: 'c1', trackIndex: 0, startTime: 0, duration: 5 })
      const state = createMockState([c])

      const next = deleteClips(state, ['non-existent-id'])
      expect(next.editorModel.timelines[0].clips.length).toBe(1)
    })
  })

  // ── 9. timeline-import parser ───────────────────────────────────────────
  describe('parseTimelineXml parser', () => {
    it('correctly parses FCP7 XML sequence with video and audio tracks', () => {
      const fcp7SampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>Sample FCP7 Sequence</name>
    <duration>300</duration>
    <rate>
      <timebase>30</timebase>
    </rate>
    <media>
      <video>
        <track>
          <clipitem id="clipitem-1">
            <name>shot_01.mp4</name>
            <duration>150</duration>
            <start>0</start>
            <end>150</end>
            <in>0</in>
            <out>150</out>
            <file id="file-1">
              <name>shot_01.mp4</name>
              <pathurl>file:///C:/Media/shot_01.mp4</pathurl>
              <duration>300</duration>
            </file>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`

      const result = parseTimelineXml(fcp7SampleXml)
      expect(result).not.toBeNull()
      expect(result?.format).toBe('fcp7xml')
      expect(result?.name).toBe('Sample FCP7 Sequence')
      expect(result?.fps).toBe(30)
      expect(result?.clips.length).toBe(1)
      expect(result?.clips[0].name).toBe('shot_01.mp4')
      expect(result?.clips[0].startTime).toBe(0)
      expect(result?.clips[0].duration).toBe(5) // 150 frames / 30fps = 5s
    })

    it('correctly parses FCPXML with resources and asset clips', () => {
      const fcpxmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080"/>
    <asset id="r2" name="interview" src="file:///Volumes/Media/interview.mov" duration="600/30s" hasVideo="1" hasAudio="1"/>
  </resources>
  <library>
    <event name="Event 1">
      <project name="FCPXML Project">
        <sequence format="r1" duration="600/30s">
          <spine>
            <asset-clip ref="r2" name="interview" offset="0s" duration="300/30s" start="0s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

      const result = parseTimelineXml(fcpxmlSample)
      expect(result).not.toBeNull()
      expect(result?.format).toBe('fcpxml')
      expect(result?.clips.length).toBeGreaterThan(0)
      expect(result?.clips[0].name).toBe('interview')
    })

    it('throws error for completely invalid / non-xml string', () => {
      expect(() => parseTimelineXml('THIS IS NOT XML AT ALL')).toThrow()
    })

    it('handles empty sequence gracefully', () => {
      const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <sequence>
    <name>Empty Sequence</name>
    <media>
      <video></video>
    </media>
  </sequence>
</xmeml>`

      const result = parseTimelineXml(emptyXml)
      expect(result).not.toBeNull()
      expect(result?.clips.length).toBe(0)
    })
  })
})
