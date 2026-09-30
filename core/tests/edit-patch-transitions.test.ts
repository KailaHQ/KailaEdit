import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  createInitialEditorState,
  describePatch,
  selectActiveTimeline,
  selectClips,
  undo,
  validateEditPatch,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  type EditPatch,
  type Timeline,
  type TimelineClip,
} from '../src'

/**
 * The MCP path for transitions. These exist because of the rule in AGENTS.md:
 * a feature the agent cannot drive is only half-built, and the half that is
 * missing is invisible until someone asks autopilot to do it.
 */

const makeClip = (id: string, startTime: number, duration: number, trackIndex = 0): TimelineClip => ({
  id,
  assetId: `asset-${id}`,
  type: 'video',
  startTime,
  duration,
  trackIndex,
  trimStart: 0,
  trimEnd: 0,
  volume: 1,
  asset: null,
  flipH: false,
  flipV: false,
  transitionIn: DEFAULT_CLIP_TRANSITION,
  transitionOut: DEFAULT_CLIP_TRANSITION,
  colorCorrection: DEFAULT_COLOR_CORRECTION,
  transform: DEFAULT_CLIP_TRANSFORM,
  opacity: 100,
} as TimelineClip)

function makeState() {
  const timeline: Timeline = {
    id: 'timeline-1',
    name: 'Main',
    createdAt: 0,
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
      { id: 'v2', kind: 'video', name: 'V2', locked: true, muted: false },
    ],
    clips: [
      makeClip('a', 0, 4),
      makeClip('b', 4, 4),
      makeClip('c', 8, 4),
      // Two adjacent clips already sitting on the locked track, so the locked
      // case can be checked without first having to make a legal edit to it.
      makeClip('locked-a', 0, 4, 1),
      makeClip('locked-b', 4, 4, 1),
    ],
    subtitles: [],
  } as Timeline

  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

const patch = (operations: unknown[]): EditPatch => ({
  version: 1,
  description: 'test',
  operations,
} as EditPatch)

describe('set_transition through the patch pipeline', () => {
  it('applies the transition overlap and records one transition', () => {
    const result = applyPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'wipe-left', duration: 1 },
    ]))
    expect(result.success).toBe(true)
    if (!result.success) return

    const clips = new Map(selectClips(result.state).map(clip => [clip.id, clip]))
    expect(clips.get('b')!.startTime).toBe(3)
    expect(clips.get('c')!.startTime).toBe(7)
    expect(selectActiveTimeline(result.state)!.transitions).toHaveLength(1)
  })

  it('is undoable as one step', () => {
    const applied = applyPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'dissolve', duration: 1 },
    ]))
    expect(applied.success).toBe(true)
    if (!applied.success) return

    const back = undo(applied.state)
    const clips = new Map(selectClips(back).map(clip => [clip.id, clip]))
    expect(clips.get('b')!.startTime).toBe(4)
    expect(selectActiveTimeline(back)!.transitions ?? []).toHaveLength(0)
  })

  it('defaults the duration when the agent omits it', () => {
    const result = applyPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'dissolve' },
    ]))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(selectActiveTimeline(result.state)!.transitions![0].duration).toBe(0.5)
  })
})

describe('remove_transition through the patch pipeline', () => {
  it('closes the overlap again', () => {
    const added = applyPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'dissolve', duration: 1 },
    ]))
    expect(added.success).toBe(true)
    if (!added.success) return

    const removed = applyPatch(added.state, patch([
      { op: 'remove_transition', leftClipId: 'a', rightClipId: 'b' },
    ]))
    expect(removed.success).toBe(true)
    if (!removed.success) return

    const clips = new Map(selectClips(removed.state).map(clip => [clip.id, clip]))
    expect(clips.get('b')!.startTime).toBe(4)
    expect(clips.get('c')!.startTime).toBe(8)
  })
})

describe('validation refuses what cannot work, with a reason', () => {
  it('rejects an unknown transition name', () => {
    const result = validateEditPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'radiant-burst', duration: 1 },
    ]))
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toMatch(/Unknown transition type/)
  })

  it('rejects a clip that does not exist', () => {
    const result = validateEditPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'ghost', type: 'dissolve', duration: 1 },
    ]))
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toMatch(/does not exist/)
  })

  it('rejects a pair that is not a cut', () => {
    const result = validateEditPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'c', type: 'dissolve', duration: 1 },
    ]))
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toMatch(/gap|overlapping/)
  })

  it('rejects a locked track', () => {
    const result = validateEditPatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'locked-a', rightClipId: 'locked-b', type: 'dissolve', duration: 1 },
    ]))
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toMatch(/locked track/)
  })
})

describe('the diff the user approves says what happened', () => {
  it('names the transition operations rather than lumping them into "other"', () => {
    const description = describePatch(makeState(), patch([
      { op: 'set_transition', leftClipId: 'a', rightClipId: 'b', type: 'dissolve', duration: 1 },
    ]))
    expect(description).toMatch(/transition/)
    expect(description).not.toMatch(/thao tác khác/)
  })
})
