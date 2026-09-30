import { describe, expect, it } from 'vitest'
import {
  createInitialEditorState,
  editPatchSchema,
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
  selectClips,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  type Timeline,
  type TimelineClip,
  type Track,
  type EditPatch,
} from '../src'

const createMockClip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: `clip-${Math.random().toString(36).slice(2, 8)}`,
  assetId: 'asset-1',
  type: 'video',
  startTime: 0,
  duration: 60,
  trimStart: 0,
  trimEnd: 0,
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

const createMockTimeline = (
  clips: TimelineClip[] = [],
  tracks?: Track[],
): Timeline => ({
  id: 'timeline-1',
  name: 'Main Timeline',
  createdAt: Date.now(),
  tracks: tracks ?? [
    { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
    { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false },
  ],
  clips,
  subtitles: [],
})

function makeTestState(clipDuration = 60) {
  const clip = createMockClip({ id: 'clip-1', trackIndex: 0, startTime: 0, duration: clipDuration })
  const timeline = createMockTimeline([clip])
  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

describe('S2-2: Edit Patch Format, Validation, Description, and Application', () => {
  // ── 1. Schema Tests ───────────────────────────────────────────────────────
  describe('Schema validation (valid and 4+ invalid cases)', () => {
    it('chấp nhận patch hợp lệ', () => {
      const validPatch = {
        version: 1,
        description: 'Cắt và di chuyển clip',
        operations: [
          { op: 'split_clip', clipId: 'clip-1', splitTime: 10 },
          { op: 'delete_clips', clipIds: ['clip-1'] },
          { op: 'cut_range', startTime: 20, endTime: 30 },
          { op: 'move_clip', clipId: 'clip-2', deltaTime: 5 },
        ],
      }
      const parsed = editPatchSchema.safeParse(validPatch)
      expect(parsed.success).toBe(true)
    })

    it('từ chối patch sai #1: thiếu trường (missing clipId or operations)', () => {
      // Missing operations
      const missingOps = { version: 1, description: 'Thiếu operations' }
      expect(editPatchSchema.safeParse(missingOps).success).toBe(false)

      // Missing clipId in split_clip
      const missingClipId = {
        version: 1,
        operations: [{ op: 'split_clip', splitTime: 10 }],
      }
      expect(editPatchSchema.safeParse(missingClipId).success).toBe(false)
    })

    it('từ chối patch sai #2: ID không tồn tại trên timeline', () => {
      const state = makeTestState(60)
      const patchNonExistent = {
        version: 1,
        operations: [{ op: 'split_clip', clipId: 'ghost-clip-xyz', splitTime: 10 }],
      }
      const validation = validateEditPatch(state, patchNonExistent)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.error).toContain('ghost-clip-xyz')
        expect(validation.error).toContain('does not exist')
      }
    })

    it('từ chối patch sai #3: thời gian âm (splitTime or startTime < 0)', () => {
      const negativeSplit = {
        version: 1,
        operations: [{ op: 'split_clip', clipId: 'clip-1', splitTime: -5 }],
      }
      expect(editPatchSchema.safeParse(negativeSplit).success).toBe(false)

      const negativeRange = {
        version: 1,
        operations: [{ op: 'cut_range', startTime: -1, endTime: 10 }],
      }
      expect(editPatchSchema.safeParse(negativeRange).success).toBe(false)
    })

    it('từ chối patch sai #4: thao tác lạ (unknown op)', () => {
      const unknownOp = {
        version: 1,
        operations: [{ op: 'teleport_magic_clip', clipId: 'clip-1' }],
      }
      expect(editPatchSchema.safeParse(unknownOp).success).toBe(false)
    })

    it('rejects cut_range covering the entire timeline for safety', () => {
      const state = makeTestState(60)
      const fullCutPatch = {
        version: 1,
        operations: [{ op: 'cut_range', startTime: 0, endTime: 60 }],
      }
      const validation = validateEditPatch(state, fullCutPatch)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.error).toContain('covers the entire timeline')
      }
    })
  })

  // ── 2. applyPatch Rejection & Rollback Safety ─────────────────────────────
  describe('applyPatch rejection on invalid patches', () => {
    it('applyPatch với patch sai → không thay đổi state, trả lỗi', () => {
      const state = makeTestState(60)
      const stateSnapshot = JSON.stringify(state)

      // 1. Invalid patch due to non-existent clip ID
      const badIdPatch = {
        version: 1,
        operations: [{ op: 'split_clip', clipId: 'clip-does-not-exist', splitTime: 15 }],
      }
      const res1 = applyPatch(state, badIdPatch)
      expect(res1.success).toBe(false)
      expect(res1.state).toBe(state) // exact same reference
      expect(JSON.stringify(res1.state)).toBe(stateSnapshot)

      // 2. Invalid patch due to negative time
      const badTimePatch = {
        version: 1,
        operations: [{ op: 'split_clip', clipId: 'clip-1', splitTime: -10 }],
      }
      const res2 = applyPatch(state, badTimePatch)
      expect(res2.success).toBe(false)
      expect(res2.state).toBe(state)
      expect(JSON.stringify(res2.state)).toBe(stateSnapshot)

      // 3. Invalid patch due to unknown op
      const badOpPatch = {
        version: 1,
        operations: [{ op: 'hack_timeline', clipId: 'clip-1' }],
      }
      const res3 = applyPatch(state, badOpPatch)
      expect(res3.success).toBe(false)
      expect(res3.state).toBe(state)
      expect(JSON.stringify(res3.state)).toBe(stateSnapshot)
    })
  })

  // ── 3. describePatch Purity ───────────────────────────────────────────────
  describe('describePatch purity and formatting', () => {
    it('describePatch là hàm thuần không đụng state, có test khẳng định state không đổi sau khi gọi', () => {
      const state = makeTestState(60)
      const stateSnapshot = JSON.stringify(state)

      const patch: EditPatch = {
        version: 1,
        description: 'Remove silences',
        operations: [
          { op: 'cut_range', startTime: 10, endTime: 20 },
        ],
      }

      const description = describePatch(state, patch)

      // Semantic diff output formatting check
      expect(typeof description).toBe('string')
      expect(description).toContain('Remove silences')
      expect(description).toContain('V1 shortened from')

      // Assert state was not mutated in any way
      expect(JSON.stringify(state)).toBe(stateSnapshot)
    })
  })

  // ── 4. applyPatch Single Undo Step & End-to-End Silence Cutting ───────────
  describe('applyPatch single undo step and end-to-end "cắt 3 khoảng lặng"', () => {
    it('applyPatch thành công → đúng 1 mục undo', () => {
      const state = makeTestState(60)
      expect(state.history.undoStack).toHaveLength(0)

      const patch: EditPatch = {
        version: 1,
        description: 'Cắt 1 khoảng',
        operations: [
          { op: 'cut_range', startTime: 10, endTime: 20 },
        ],
      }

      const result = applyPatch(state, patch)
      expect(result.success).toBe(true)
      if (!result.success) throw new Error('applyPatch failed')

      // Exactly ONE undo snapshot created
      expect(result.state.history.undoStack).toHaveLength(1)

      // Undo restores the exact state before patch
      const undone = undo(result.state)
      expect(selectClips(undone)).toHaveLength(1)
      expect(selectClips(undone)[0].duration).toBe(60)
    })

    it('Có test đầu-cuối: patch "cắt 3 khoảng lặng" → state kết quả đúng như mong đợi', () => {
      // Start with 60 seconds on V1
      const state = makeTestState(60)
      const initialClips = selectClips(state)
      expect(initialClips).toHaveLength(1)
      expect(initialClips[0].duration).toBe(60)

      // 3 silences:
      // Silence 1: 10 to 15 (5s)
      // Silence 2: 25 to 30 (5s)
      // Silence 3: 40 to 45 (5s)
      // Total removed: 15s. Expected final V1 duration: 60 - 15 = 45s.
      const silencePatch: EditPatch = {
        version: 1,
        description: 'Delete 3 silence segments',
        operations: [
          { op: 'cut_range', startTime: 10, endTime: 15 },
          { op: 'cut_range', startTime: 25, endTime: 30 },
          { op: 'cut_range', startTime: 40, endTime: 45 },
        ],
      }

      // Check describePatch
      const description = describePatch(state, silencePatch)
      expect(description).toContain('Delete 3 silence segments')
      expect(description).toContain('cut 3 ranges (15.0s)')
      expect(description).toContain('V1 shortened from 1:00 to 0:45 (-15.0s)')

      // Apply patch
      const applyResult = applyPatch(state, silencePatch)
      expect(applyResult.success).toBe(true)
      if (!applyResult.success) throw new Error(applyResult.error)

      const finalState = applyResult.state
      const finalClips = selectClips(finalState)

      // Total duration of clips on V1 should be exactly 45s
      const totalDuration = finalClips.reduce((sum, c) => sum + c.duration, 0)
      expect(totalDuration).toBe(45)

      // V1 must be packed seamlessly from 0 (magnetic V1 invariant)
      const sortedClips = [...finalClips].sort((a, b) => a.startTime - b.startTime)
      expect(sortedClips[0].startTime).toBe(0)
      for (let i = 1; i < sortedClips.length; i++) {
        const prev = sortedClips[i - 1]
        const curr = sortedClips[i]
        expect(curr.startTime).toBeCloseTo(prev.startTime + prev.duration, 2)
      }

      // Exactly 1 undo snapshot pushed
      expect(finalState.history.undoStack).toHaveLength(1)

      // Undoing restores the original 60s timeline
      const restoredState = undo(finalState)
      expect(selectClips(restoredState)).toHaveLength(1)
      expect(selectClips(restoredState)[0].duration).toBe(60)
    })

    it('validates, describes, applies, and undoes set_filter and remove_filter', () => {
      const state = makeTestState(30)
      const targetClipId = 'clip-1'

      // 1. Invalid filterId should fail validation
      const invalidPatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'set_filter', clipId: targetClipId, filterId: 'non-existent-filter' },
        ],
      }
      const invalidValidation = validateEditPatch(state, invalidPatch)
      expect(invalidValidation.valid).toBe(false)
      if (!invalidValidation.valid) {
        expect(invalidValidation.error).toContain('Unknown filter ID')
      }

      // 2. Valid set_filter patch
      const validSetPatch: EditPatch = {
        version: 1,
        description: 'Color grade cinematic style',
        operations: [
          { op: 'set_filter', clipId: targetClipId, filterId: 'cine-teal-orange', intensity: 85 },
        ],
      }

      const setValidation = validateEditPatch(state, validSetPatch)
      expect(setValidation.valid).toBe(true)

      const desc = describePatch(state, validSetPatch)
      expect(desc).toContain('Color grade cinematic style')
      expect(desc).toContain('apply filter Cine Teal & Orange (85%)')

      // Apply set_filter
      const setResult = applyPatch(state, validSetPatch)
      expect(setResult.success).toBe(true)
      if (!setResult.success) throw new Error(setResult.error)

      const clipWithFilter = selectClips(setResult.state).find(c => c.id === targetClipId)
      expect(clipWithFilter?.filter).toEqual({
        id: 'cine-teal-orange',
        intensity: 85,
      })

      // 3. Remove filter patch
      const removePatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'remove_filter', clipId: targetClipId },
        ],
      }
      const removeValidation = validateEditPatch(setResult.state, removePatch)
      expect(removeValidation.valid).toBe(true)

      const removeDesc = describePatch(setResult.state, removePatch)
      expect(removeDesc).toContain('remove 1 filters')

      const removeResult = applyPatch(setResult.state, removePatch)
      expect(removeResult.success).toBe(true)
      if (!removeResult.success) throw new Error(removeResult.error)

      const clipWithoutFilter = selectClips(removeResult.state).find(c => c.id === targetClipId)
      expect(clipWithoutFilter?.filter).toBeUndefined()

      // 4. Undo restores the filter
      const undone = undo(removeResult.state)
      const clipRestored = selectClips(undone).find(c => c.id === targetClipId)
      expect(clipRestored?.filter).toEqual({
        id: 'cine-teal-orange',
        intensity: 85,
      })
    })

    it('applies add_filter_clip operation creating an adjustment clip on timeline', () => {
      const state = makeTestState(20)
      const patch: EditPatch = {
        version: 1,
        operations: [
          { op: 'add_filter_clip', filterId: 'cine-teal-orange', intensity: 80 },
        ],
      }
      const validation = validateEditPatch(state, patch)
      expect(validation.valid).toBe(true)

      const desc = describePatch(state, patch)
      expect(desc).toContain('Cine Teal & Orange')

      const result = applyPatch(state, patch)
      expect(result.success).toBe(true)
      if (!result.success) throw new Error(result.error)

      const clips = selectClips(result.state)
      const filterClip = clips.find(c => c.type === 'adjustment' && c.filter?.id === 'cine-teal-orange')
      expect(filterClip).toBeDefined()
      expect(filterClip?.startTime).toBe(0)
      expect(filterClip?.duration).toBe(20)
      expect(filterClip?.filter?.intensity).toBe(80)
    })

    it('validates, executes, describes, and undoes detach_audio (KE-104)', () => {
      const state = makeTestState(30)
      const videoClipId = 'clip-1'

      // 1. Validation fails if clip does not exist
      const invalidClipPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'detach_audio', clipId: 'non-existent' }],
      }
      const invalidClipRes = validateEditPatch(state, invalidClipPatch)
      expect(invalidClipRes.valid).toBe(false)
      if (!invalidClipRes.valid) {
        expect(invalidClipRes.error).toContain('does not exist')
      }

      // 2. Validation fails if clip is not video
      const imageClip = createMockClip({ id: 'image-1', type: 'image', trackIndex: 0, startTime: 30, duration: 10 })
      const timelineWithImage = createMockTimeline([
        ...selectClips(state),
        imageClip,
      ])
      const stateWithImage = createInitialEditorState({
        assets: [],
        bins: {},
        timelines: [timelineWithImage],
        activeTimelineId: timelineWithImage.id,
      })
      const invalidTypePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'detach_audio', clipId: 'image-1' }],
      }
      const invalidTypeRes = validateEditPatch(stateWithImage, invalidTypePatch)
      expect(invalidTypeRes.valid).toBe(false)
      if (!invalidTypeRes.valid) {
        expect(invalidTypeRes.error).toContain('not a video clip')
      }

      // 3. Valid detach_audio patch
      const validPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'detach_audio', clipId: videoClipId }],
      }
      const validRes = validateEditPatch(state, validPatch)
      expect(validRes.valid).toBe(true)

      const desc = describePatch(state, validPatch)
      expect(desc).toContain('detach audio from 1 clips')

      // 4. Apply patch
      const applyResult = applyPatch(state, validPatch)
      expect(applyResult.success).toBe(true)
      if (!applyResult.success) throw new Error(applyResult.error)

      const appliedClips = selectClips(applyResult.state)
      const updatedVideo = appliedClips.find(c => c.id === videoClipId)
      expect(updatedVideo).toBeDefined()
      expect(updatedVideo?.muted).toBe(true)
      expect(updatedVideo?.linkedClipIds).toHaveLength(1)

      const audioClipId = updatedVideo!.linkedClipIds![0]
      const newAudioClip = appliedClips.find(c => c.id === audioClipId)
      expect(newAudioClip).toBeDefined()
      expect(newAudioClip?.type).toBe('audio')
      expect(newAudioClip?.startTime).toBe(updatedVideo?.startTime)
      expect(newAudioClip?.duration).toBe(updatedVideo?.duration)
      expect(newAudioClip?.trimStart).toBe(updatedVideo?.trimStart)
      expect(newAudioClip?.speed).toBe(updatedVideo?.speed)
      expect(newAudioClip?.muted).toBe(false)
      expect(newAudioClip?.linkedClipIds).toEqual([videoClipId])

      // 5. Validation fails if already has linked audio
      const duplicateDetachRes = validateEditPatch(applyResult.state, validPatch)
      expect(duplicateDetachRes.valid).toBe(false)
      if (!duplicateDetachRes.valid) {
        expect(duplicateDetachRes.error).toContain('already has a linked audio clip')
      }

      // 6. Undo restores the exact previous state
      const undoneState = undo(applyResult.state)
      const undoneClips = selectClips(undoneState)
      expect(undoneClips.some(c => c.id === audioClipId)).toBe(false)
      const restoredVideo = undoneClips.find(c => c.id === videoClipId)
      expect(restoredVideo?.muted).toBe(false)
      expect(restoredVideo?.linkedClipIds).toBeUndefined()
    })

    it('validates, executes, describes, and undoes keyframe operations (KE-203)', () => {
      const state = makeTestState(30)
      const clipId = 'clip-1'

      // 1. Validation fails if time exceeds clip duration
      const invalidTimePatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'set_keyframe', clipId, property: 'opacity', t: 999, value: 50 },
        ],
      }
      const invalidRes = validateEditPatch(state, invalidTimePatch)
      expect(invalidRes.valid).toBe(false)
      if (!invalidRes.valid) {
        expect(invalidRes.error).toContain('exceeds clip duration')
      }

      // 2. Set keyframe
      const setPatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'set_keyframe', clipId, property: 'transform.scale', t: 2.5, value: 150, easing: 'ease-in-out' },
          { op: 'set_keyframe', clipId, property: 'opacity', t: 1.0, value: 80 },
        ],
      }
      const setValid = validateEditPatch(state, setPatch)
      expect(setValid.valid).toBe(true)

      const desc = describePatch(state, setPatch)
      expect(desc).toContain('set keyframe for transform.scale at 2.5s')
      expect(desc).toContain('set keyframe for opacity at 1.0s')

      const appliedSet = applyPatch(state, setPatch)
      expect(appliedSet.success).toBe(true)
      if (!appliedSet.success) throw new Error(appliedSet.error)

      const clipAfterSet = selectClips(appliedSet.state).find(c => c.id === clipId)
      expect(clipAfterSet?.keyframes).toHaveLength(2)
      const scaleTrack = clipAfterSet?.keyframes?.find(k => k.property === 'transform.scale')
      expect(scaleTrack?.points).toEqual([
        { t: 2.5, value: 150, easing: 'ease-in-out' },
      ])

      // 3. Remove keyframe
      const removePatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'remove_keyframe', clipId, property: 'opacity', t: 1.0 },
        ],
      }
      const removeDesc = describePatch(appliedSet.state, removePatch)
      expect(removeDesc).toContain('remove 1 keyframes')

      const appliedRemove = applyPatch(appliedSet.state, removePatch)
      expect(appliedRemove.success).toBe(true)
      if (!appliedRemove.success) throw new Error(appliedRemove.error)

      const clipAfterRemove = selectClips(appliedRemove.state).find(c => c.id === clipId)
      expect(clipAfterRemove?.keyframes).toHaveLength(1)
      expect(clipAfterRemove?.keyframes?.[0].property).toBe('transform.scale')

      // 4. Clear keyframes
      const clearPatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'clear_keyframes', clipId },
        ],
      }
      const clearDesc = describePatch(appliedRemove.state, clearPatch)
      expect(clearDesc).toContain('clear all keyframes')

      const appliedClear = applyPatch(appliedRemove.state, clearPatch)
      expect(appliedClear.success).toBe(true)
      if (!appliedClear.success) throw new Error(appliedClear.error)

      const clipAfterClear = selectClips(appliedClear.state).find(c => c.id === clipId)
      expect(clipAfterClear?.keyframes).toBeUndefined()

      // 5. Undo restores back step by step
      const undoneOnce = undo(appliedClear.state)
      const clipUndone1 = selectClips(undoneOnce).find(c => c.id === clipId)
      expect(clipUndone1?.keyframes).toHaveLength(1)

      const undoneTwice = undo(undoneOnce)
      const clipUndone2 = selectClips(undoneTwice).find(c => c.id === clipId)
      expect(clipUndone2?.keyframes).toHaveLength(2)

      const undoneAll = undo(undoneTwice)
      const clipInitial = selectClips(undoneAll).find(c => c.id === clipId)
      expect(clipInitial?.keyframes).toBeUndefined()
    })

    it('validates, describes, executes, and undoes batch set_keyframes (KE-205)', () => {
      const state = makeTestState(30)
      const clipId = 'clip-1'

      // 1. Validation: out-of-range value rejection
      const invalidOpacityPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'set_keyframes',
            clipId,
            property: 'opacity',
            points: [
              { t: 0, value: 0 },
              { t: 1, value: 150 }, // > 100 invalid
            ],
          },
        ],
      }
      const invalidOpRes = validateEditPatch(state, invalidOpacityPatch)
      expect(invalidOpRes.valid).toBe(false)
      if (!invalidOpRes.valid) {
        expect(invalidOpRes.error).toContain('Opacity value 150 is out of range')
      }

      // 2. Validation: out-of-bounds time rejection
      const invalidTimePatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'set_keyframes',
            clipId,
            property: 'transform.scale',
            points: [
              { t: 0, value: 100 },
              { t: 50, value: 200 }, // > clip duration (10s)
            ],
          },
        ],
      }
      const invalidTimeRes = validateEditPatch(state, invalidTimePatch)
      expect(invalidTimeRes.valid).toBe(false)
      if (!invalidTimeRes.valid) {
        expect(invalidTimeRes.error).toContain('exceeds clip duration')
      }

      // 3. Valid batch set_keyframes with description check
      const batchPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'set_keyframes',
            clipId,
            property: 'transform.scale',
            points: [
              { t: 0.5, value: 100, easing: 'linear' },
              { t: 2.0, value: 150, easing: 'ease-in-out' },
              { t: 3.5, value: 120, easing: 'hold' },
            ],
          },
        ],
      }
      const validRes = validateEditPatch(state, batchPatch)
      expect(validRes.valid).toBe(true)

      const desc = describePatch(state, batchPatch)
      expect(desc).toContain('set 3 keyframe points for transform.scale (0.5s – 3.5s)')

      // 4. Execution
      const applied = applyPatch(state, batchPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.keyframes).toHaveLength(1)
      const scaleTrack = clipAfter?.keyframes?.[0]
      expect(scaleTrack?.property).toBe('transform.scale')
      expect(scaleTrack?.points).toHaveLength(3)
      expect(scaleTrack?.points[0]).toEqual({ t: 0.5, value: 100, easing: 'linear' })
      expect(scaleTrack?.points[1]).toEqual({ t: 2.0, value: 150, easing: 'ease-in-out' })
      expect(scaleTrack?.points[2]).toEqual({ t: 3.5, value: 120, easing: 'hold' })

      // 5. Clear specific property keyframes
      const clearPropPatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'clear_keyframes', clipId, property: 'transform.scale' },
        ],
      }
      const clearPropDesc = describePatch(applied.state, clearPropPatch)
      expect(clearPropDesc).toContain('clear keyframes for transform.scale')

      const appliedClear = applyPatch(applied.state, clearPropPatch)
      expect(appliedClear.success).toBe(true)
      if (!appliedClear.success) throw new Error(appliedClear.error)

      const clipAfterClear = selectClips(appliedClear.state).find(c => c.id === clipId)
      expect(clipAfterClear?.keyframes).toBeUndefined()

      // 6. Atomic Undo
      const undone = undo(appliedClear.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.keyframes?.[0].points).toHaveLength(3)

      const undoneInitial = undo(undone)
      const clipInitialState = selectClips(undoneInitial).find(c => c.id === clipId)
      expect(clipInitialState?.keyframes).toBeUndefined()
    })

    it('validates and applies speed ramp keyframes', () => {
      const state = makeTestState(10)
      const clipId = 'clip-1'

      const speedRampPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'set_keyframes',
            clipId,
            property: 'speed',
            points: [
              { t: 0, value: 1, easing: 'linear' },
              { t: 3, value: 0.25, easing: 'ease-in-out' },
              { t: 7, value: 0.25, easing: 'ease-in-out' },
              { t: 10, value: 1, easing: 'linear' },
            ],
          },
        ],
      }

      const validRes = validateEditPatch(state, speedRampPatch)
      expect(validRes.valid).toBe(true)

      const desc = describePatch(state, speedRampPatch)
      expect(desc).toContain('speed')

      const applied = applyPatch(state, speedRampPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clip = selectClips(applied.state).find(c => c.id === clipId)
      const speedTrack = clip?.keyframes?.find(k => k.property === 'speed')
      expect(speedTrack).toBeDefined()
      expect(speedTrack?.points).toHaveLength(4)
      expect(speedTrack?.points[1].value).toBe(0.25)
    })
  })

})
