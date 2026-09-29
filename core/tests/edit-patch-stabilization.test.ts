import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  computeStabilizationFingerprint,
  createInitialEditorState,
  DEFAULT_CLIP_STABILIZATION,
  describeClipStabilization,
  describePatch,
  qcCheck,
  selectClips,
  undo,
  validateEditPatch,
  type Asset,
  type EditPatch,
  type TimelineClip,
} from '../src'
import { createMockClip, createMockTimeline, makeTestState } from './edit-patch-test-helpers'

/** The reason a patch was refused, or an empty string when it was not. */
const errorOf = (result: ReturnType<typeof validateEditPatch>): string => ('error' in result ? String(result.error) : '')

const patchOf = (op: EditPatch['operations'][number]): EditPatch => ({ version: 1, operations: [op] })

describe('Edit Patch: set_stabilization', () => {
  it('validates, describes, applies and undoes', () => {
    const state = makeTestState(10)
    const patch = patchOf({ op: 'set_stabilization', clipId: 'clip-1', stabilization: { smoothing: 30, mode: 'tripod' } })

    expect(validateEditPatch(state, patch).valid).toBe(true)
    expect(describePatch(state, patch)).toContain('ổn định hình (độ mượt 30, chế độ chân máy) cho clip "clip-1"')

    const applied = applyPatch(state, patch)
    if (!applied.success) throw new Error(applied.error)
    expect(selectClips(applied.state)[0].stabilization).toEqual({ enabled: true, smoothing: 30, mode: 'tripod' })

    expect(selectClips(undo(applied.state))[0].stabilization).toBeUndefined()
  })

  it('turns on with defaults when given no settings', () => {
    const state = makeTestState(10)
    const patch = patchOf({ op: 'set_stabilization', clipId: 'clip-1', stabilization: {} })
    expect(describePatch(state, patch)).toContain('ổn định hình cho clip "clip-1"')
    const applied = applyPatch(state, patch)
    if (!applied.success) throw new Error(applied.error)
    expect(selectClips(applied.state)[0].stabilization).toEqual(DEFAULT_CLIP_STABILIZATION)
  })

  it('switches off and removes', () => {
    const on = applyPatch(makeTestState(10), patchOf({ op: 'set_stabilization', clipId: 'clip-1', stabilization: {} }))
    if (!on.success) throw new Error(on.error)

    const off = patchOf({ op: 'set_stabilization', clipId: 'clip-1', stabilization: { enabled: false } })
    expect(describePatch(on.state, off)).toContain('tắt ổn định hình cho clip "clip-1"')
    const offApplied = applyPatch(on.state, off)
    if (!offApplied.success) throw new Error(offApplied.error)
    expect(selectClips(offApplied.state)[0].stabilization?.enabled).toBe(false)

    const remove = patchOf({ op: 'set_stabilization', clipId: 'clip-1', stabilization: null })
    expect(describePatch(on.state, remove)).toContain('gỡ ổn định hình cho clip "clip-1"')
    const removed = applyPatch(on.state, remove)
    if (!removed.success) throw new Error(removed.error)
    expect(selectClips(removed.state)[0].stabilization).toBeUndefined()
  })

  it('rejects a bake, out-of-range smoothing, and unknown fields', () => {
    const state = makeTestState(10)
    for (const stabilization of [
      { smoothing: 2 },
      { smoothing: 99 },
      { mode: 'gimbal' },
      { bake: { path: 'x.mp4', fingerprint: 'f', createdAt: 0, sourceStart: 0, sourceSpan: 1 } },
    ]) {
      const result = validateEditPatch(state, { version: 1, operations: [{ op: 'set_stabilization', clipId: 'clip-1', stabilization }] })
      expect(result.valid, JSON.stringify(stabilization)).toBe(false)
    }
  })

  it('rejects a missing clip, a non-video clip, and a locked track', () => {
    expect(errorOf(validateEditPatch(makeTestState(10), patchOf({ op: 'set_stabilization', clipId: 'nope', stabilization: {} }))))
      .toMatch(/does not exist/)

    const image = createMockClip({ id: 'img', type: 'image' })
    const imageTimeline = createMockTimeline([image])
    const imageState = createInitialEditorState({ assets: [], bins: {}, timelines: [imageTimeline], activeTimelineId: imageTimeline.id })
    expect(errorOf(validateEditPatch(imageState, patchOf({ op: 'set_stabilization', clipId: 'img', stabilization: {} }))))
      .toMatch(/non-video/)

    const clip = createMockClip({ id: 'c', trackIndex: 0 })
    const locked = createMockTimeline([clip], [{ id: 'v1', kind: 'video', name: 'V1', locked: true, muted: false }])
    const lockedState = createInitialEditorState({ assets: [], bins: {}, timelines: [locked], activeTimelineId: locked.id })
    expect(errorOf(validateEditPatch(lockedState, patchOf({ op: 'set_stabilization', clipId: 'c', stabilization: {} }))))
      .toMatch(/locked/)
  })
})

// ---------------------------------------------------------------------------
// What the agent reads back, and what QC flags.
// ---------------------------------------------------------------------------

const ASSET: Asset = {
  id: 'asset-1', type: 'video', path: 'C:/media/IMG_4692.MOV', prompt: '', resolution: '', duration: 152.5, createdAt: 0,
}

/** A clip at timeline 10 s showing source 74..82, stabilized from a 73..83 bake. */
function stabilizedClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  const range = { sourceStart: 73, sourceSpan: 10 }
  return createMockClip({
    id: 'clip-1', asset: ASSET, startTime: 10, trimStart: 74, duration: 8, trimEnd: 152.5 - 82,
    stabilization: {
      ...DEFAULT_CLIP_STABILIZATION,
      bake: {
        path: 'C:/cache/stab.mp4',
        fingerprint: computeStabilizationFingerprint({ smoothing: 20, mode: 'auto', ...range }),
        createdAt: 0, ...range, assetKey: 'asset-1', zoomPercent: 6.03,
        warnings: ['occlusion'], warningTimes: [79.067, 82.9],
      },
    },
    ...overrides,
  })
}

function model(clip: TimelineClip) {
  const timeline = createMockTimeline([clip])
  return { assets: [ASSET], bins: {}, timelines: [timeline], activeTimelineId: timeline.id }
}

describe('describeClipStabilization', () => {
  it('reports a ready bake with its zoom and the occlusions this clip shows, in timeline seconds', () => {
    expect(describeClipStabilization(stabilizedClip(), [ASSET], () => true)).toEqual({
      enabled: true,
      smoothing: 20,
      mode: 'auto',
      status: 'ready',
      bakeReady: true,
      zoomPercent: 6.03,
      warnings: ['occlusion'],
      // 79.067 is 5.067 s into a clip that starts at 10; 82.9 is in the handle, not shown.
      occlusionTimes: [15.067],
      bakePath: 'C:/cache/stab.mp4',
    })
  })

  it('reads each status', () => {
    const clip = stabilizedClip()
    const stab = clip.stabilization!
    const status = (c: TimelineClip, exists = true) => describeClipStabilization(c, [ASSET], () => exists)?.status
    expect(status({ ...clip, stabilization: { ...stab, enabled: false } })).toBe('off')
    expect(status({ ...clip, stabilization: { ...stab, bake: undefined } })).toBe('pending')
    expect(status(clip, false)).toBe('missing')
    expect(status({ ...clip, stabilization: { ...stab, smoothing: 40 } })).toBe('stale')
    expect(status({ ...clip, trimStart: 60, duration: 20 })).toBe('stale')
    expect(status(clip)).toBe('ready')
    expect(describeClipStabilization(createMockClip(), [ASSET])).toBeNull()
  })

  it('places occlusions on a reversed clip from its end', () => {
    const described = describeClipStabilization(stabilizedClip({ reversed: true }), [ASSET], () => true)
    // Source 82 is the reversed clip's first frame: 79.067 is 2.933 s in.
    expect(described?.occlusionTimes).toEqual([12.933])
  })
})

describe('qcCheck: stabilization', () => {
  it('warns that an unbaked clip exports unstabilized', () => {
    const clip = stabilizedClip()
    const issues = qcCheck(model({ ...clip, stabilization: { ...clip.stabilization!, bake: undefined } }) as any)
    const issue = issues.find(i => i.type === 'STABILIZATION_NOT_BAKED')
    expect(issue?.severity).toBe('warning')
    expect(issue?.details?.status).toBe('pending')
  })

  it('treats a gone bake file as not baked', () => {
    const issues = qcCheck(model(stabilizedClip()) as any, { fileExists: () => false })
    expect(issues.find(i => i.type === 'STABILIZATION_NOT_BAKED')?.details?.status).toBe('missing')
  })

  it('passes a ready clip, and flags its occlusions', () => {
    const issues = qcCheck(model(stabilizedClip()) as any, { fileExists: () => true })
    expect(issues.some(i => i.type === 'STABILIZATION_NOT_BAKED')).toBe(false)
    expect(issues.find(i => i.type === 'STABILIZATION_OCCLUSION')?.details?.occlusionTimes).toEqual([15.067])
  })

  it('says nothing about a clip with stabilization switched off', () => {
    const clip = stabilizedClip()
    const issues = qcCheck(model({ ...clip, stabilization: { ...clip.stabilization!, enabled: false, bake: undefined } }) as any)
    expect(issues.some(i => i.type.startsWith('STABILIZATION_'))).toBe(false)
  })

  it('judges a stabilized clip\'s matte against its stabilized file', () => {
    const clip = stabilizedClip()
    const matteOf = (assetKey: string, sourceStart: number, sourceSpan: number) => ({
      enabled: true, model: 'rvm-mobilenetv3' as const, quality: 'standard' as const, featherEdge: 0, cleanEdge: 0,
      bake: { path: 'C:/cache/alpha.mp4', fingerprint: 'm', frameCount: 300, createdAt: 0, sourceStart, sourceSpan, speed: 1, assetKey },
    })
    // A matte of the whole ORIGINAL covers the seconds the stabilized clip plays (1..9),
    // yet sits on the wrong pixels: only the media key tells them apart.
    const stale = qcCheck(model({ ...clip, autoMatte: matteOf('c:/media/img_4692.mov', 0, 152.5) }) as any, { fileExists: () => true })
    expect(stale.some(i => i.type === 'AUTO_MATTE_NOT_BAKED')).toBe(true)
    // One of the stabilized file, in its own time (the clip starts 1 s into the bake).
    const good = qcCheck(model({ ...clip, autoMatte: matteOf('c:\\cache\\stab.mp4', 0, 10) }) as any, { fileExists: () => true })
    expect(good.some(i => i.type === 'AUTO_MATTE_NOT_BAKED')).toBe(false)
  })
})
