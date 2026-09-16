import { describe, expect, it } from 'vitest'
import { buildTemplateFromTimeline } from '../src/template-model'
import {
  createInitialEditorState,
  editPatchSchema,
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
  selectClips,
  selectMarkers,
  selectSubtitles,
  selectActiveTimeline,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  getAudioFadeDurations,
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

    it('từ chối cut_range bao trùm toàn bộ timeline vì lý do an toàn', () => {
      const state = makeTestState(60)
      const fullCutPatch = {
        version: 1,
        operations: [{ op: 'cut_range', startTime: 0, endTime: 60 }],
      }
      const validation = validateEditPatch(state, fullCutPatch)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.error).toContain('bao trùm toàn bộ timeline')
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
        description: 'Xoá khoảng lặng',
        operations: [
          { op: 'cut_range', startTime: 10, endTime: 20 },
        ],
      }

      const description = describePatch(state, patch)

      // Semantic diff output formatting check
      expect(typeof description).toBe('string')
      expect(description).toContain('Xoá khoảng lặng')
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
        description: 'Xoá 3 đoạn im lặng',
        operations: [
          { op: 'cut_range', startTime: 10, endTime: 15 },
          { op: 'cut_range', startTime: 25, endTime: 30 },
          { op: 'cut_range', startTime: 40, endTime: 45 },
        ],
      }

      // Check describePatch
      const description = describePatch(state, silencePatch)
      expect(description).toContain('Xoá 3 đoạn im lặng')
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
        description: 'Chỉnh màu phong cách điện ảnh',
        operations: [
          { op: 'set_filter', clipId: targetClipId, filterId: 'cine-teal-orange', intensity: 85 },
        ],
      }

      const setValidation = validateEditPatch(state, validSetPatch)
      expect(setValidation.valid).toBe(true)

      const desc = describePatch(state, validSetPatch)
      expect(desc).toContain('Chỉnh màu phong cách điện ảnh')
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

  // ── 7. KE-301: Audio Fade (set_audio_fade) ──────────────────────────────────
  describe('KE-301: Audio Fade (set_audio_fade)', () => {
    it('validates and executes set_audio_fade producing real volume keyframes', () => {
      const state = makeTestState(10) // 10s clip
      const clipId = 'clip-1'

      // 1. Validation: Rejects invalid fade durations
      const invalidPatchExceedsDuration: EditPatch = {
        version: 1,
        operations: [{ op: 'set_audio_fade', clipId, fadeIn: 12, fadeOut: 0 }],
      }
      const valRes1 = validateEditPatch(state, invalidPatchExceedsDuration)
      expect(valRes1.valid).toBe(false)
      if (!valRes1.valid) {
        expect(valRes1.error).toContain('Fade in duration (12s) exceeds clip duration (10s)')
      }

      const invalidPatchExceedsTotal: EditPatch = {
        version: 1,
        operations: [{ op: 'set_audio_fade', clipId, fadeIn: 6, fadeOut: 5 }],
      }
      const valRes2 = validateEditPatch(state, invalidPatchExceedsTotal)
      expect(valRes2.valid).toBe(false)
      if (!valRes2.valid) {
        expect(valRes2.error).toContain('Total fade duration (11s) exceeds clip duration (10s)')
      }

      // 2. Describe patch
      const validPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_audio_fade', clipId, fadeIn: 2, fadeOut: 3 }],
      }
      const desc = describePatch(state, validPatch)
      expect(desc).toContain('set audio fade (in 2.0s, out 3.0s)')

      // 3. Apply patch
      const applied = applyPatch(state, validPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.keyframes).toBeDefined()
      const volumeTrack = clipAfter?.keyframes?.find(k => k.property === 'volume')
      expect(volumeTrack).toBeDefined()
      expect(volumeTrack?.points).toHaveLength(4)

      // Points: (0, 0), (2, 1), (7, 1), (10, 0)
      expect(volumeTrack?.points[0]).toEqual({ t: 0, value: 0, easing: 'linear' })
      expect(volumeTrack?.points[1]).toEqual({ t: 2, value: 1, easing: 'linear' })
      expect(volumeTrack?.points[2]).toEqual({ t: 7, value: 1, easing: 'linear' })
      expect(volumeTrack?.points[3]).toEqual({ t: 10, value: 0, easing: 'linear' })

      // Detect durations
      if (clipAfter) {
        const detected = getAudioFadeDurations(clipAfter)
        expect(detected.fadeIn).toBeCloseTo(2)
        expect(detected.fadeOut).toBeCloseTo(3)
      }

      // 4. Remove fade by setting to 0
      const clearFadePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_audio_fade', clipId, fadeIn: 0, fadeOut: 0 }],
      }
      const clearDesc = describePatch(applied.state, clearFadePatch)
      expect(clearDesc).toContain('disable audio fade')

      const appliedClear = applyPatch(applied.state, clearFadePatch)
      expect(appliedClear.success).toBe(true)
      if (!appliedClear.success) throw new Error(appliedClear.error)

      const clipCleared = selectClips(appliedClear.state).find(c => c.id === clipId)
      expect(clipCleared?.keyframes).toBeUndefined()

      // 5. Atomic Undo restores the fade keyframes
      const undone = undo(appliedClear.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.keyframes?.find(k => k.property === 'volume')?.points).toHaveLength(4)

      // Undo back to initial state
      const undoneInitial = undo(undone)
      const clipInitial = selectClips(undoneInitial).find(c => c.id === clipId)
      expect(clipInitial?.keyframes).toBeUndefined()
    })
  })

  // ── 8. KE-303: Audio Normalization (normalize_audio) ────────────────────────
  describe('KE-303: Audio Normalization (normalize_audio)', () => {
    it('validates and applies normalize_audio correctly adjusting static volume', () => {
      const state = makeTestState(30)
      const clipId = 'clip-1'

      // 1. Validation: Rejects non-existent clip ID
      const nonExistentPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'normalize_audio', clipId: 'ghost-clip', targetLufs: -14, currentLufs: -20 }],
      }
      const valRes1 = validateEditPatch(state, nonExistentPatch)
      expect(valRes1.valid).toBe(false)
      if (!valRes1.valid) {
        expect(valRes1.error).toContain('does not exist in active timeline')
      }

      // 2. Describe patch
      const validPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'normalize_audio', clipId, targetLufs: -14, currentLufs: -20 }],
      }
      const desc = describePatch(state, validPatch)
      expect(desc).toContain('normalize audio clip "clip-1" to -14 LUFS (+6.0 dB)')

      // 3. Execution: Volume boosts by +6 dB (factor of ~1.995)
      const applied = applyPatch(state, validPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.volume).toBeCloseTo(1.995, 2)

      // 4. Test with direct gainDb
      const gainDbPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'normalize_audio', clipId, targetLufs: -14, gainDb: -6 }],
      }
      const descGainDb = describePatch(applied.state, gainDbPatch)
      expect(descGainDb).toContain('normalize audio clip "clip-1" to -14 LUFS (-6.0 dB)')

      const appliedGainDb = applyPatch(applied.state, gainDbPatch)
      expect(appliedGainDb.success).toBe(true)
      if (!appliedGainDb.success) throw new Error(appliedGainDb.error)

      const clipAfterGainDb = selectClips(appliedGainDb.state).find(c => c.id === clipId)
      // 1.995 * 10^(-6/20) = 1.995 * 0.501187 = ~1.0
      expect(clipAfterGainDb?.volume).toBeCloseTo(1.0, 1)

      // 5. Atomic Undo
      const undone = undo(appliedGainDb.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.volume).toBeCloseTo(1.995, 2)

      const undoneInitial = undo(undone)
      const clipInitial = selectClips(undoneInitial).find(c => c.id === clipId)
      expect(clipInitial?.volume).toBe(1)
    })

    it('handles duck_audio operation: schema, validation, description, execution, and atomic undo', () => {
      const state = makeTestState(30)
      const clipId = 'clip-1'

      // 1. Validation fails if clipId does not exist
      const nonExistentPatch = {
        version: 1,
        operations: [{
          op: 'duck_audio',
          musicClipId: 'does-not-exist',
          speechIntervals: [{ start: 5, end: 10 }],
        }],
      }
      const valRes1 = validateEditPatch(state, nonExistentPatch)
      expect(valRes1.valid).toBe(false)
      if (!valRes1.valid) {
        expect(valRes1.error).toContain('does not exist in active timeline')
      }

      // 2. Describe patch
      const validPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'duck_audio',
          musicClipId: clipId,
          speechIntervals: [{ start: 5, end: 10 }],
          duckingDb: -12,
          attack: 0.3,
          release: 0.5,
        }],
      }
      const desc = describePatch(state, validPatch)
      expect(desc).toContain('auto-duck music clip "clip-1" (-12 dB) against 1 speech segments')

      // 3. Execution: keyframes generated on volume track
      const applied = applyPatch(state, validPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.keyframes).toBeDefined()
      const volTrack = clipAfter?.keyframes?.find(k => k.property === 'volume')
      expect(volTrack).toBeDefined()
      expect(volTrack!.points.length).toBeGreaterThanOrEqual(4)

      // 4. Atomic Undo
      const undone = undo(applied.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.keyframes).toBeUndefined()
    })

    it('validates, describes, applies, and undoes set_timeline_dimensions', () => {
      const state = makeTestState(30)
      const timelineId = state.editorModel.activeTimelineId!

      // 1. Validation error when timelineId does not exist
      const invalidTimelinePatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_dimensions',
          timelineId: 'non-existent-timeline',
          width: 1080,
          height: 1920,
        }],
      }
      const valRes = validateEditPatch(state, invalidTimelinePatch)
      expect(valRes.valid).toBe(false)
      if (!valRes.valid) {
        expect(valRes.error).toContain('does not exist in project')
      }

      // 2. Describe patch
      const validPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_dimensions',
          timelineId,
          width: 1080,
          height: 1920,
          fps: 60,
        }],
      }
      const desc = describePatch(state, validPatch)
      expect(desc).toContain('change dimensions to 1080x1920 @ 60fps')

      // 3. Execution modifies timeline settings
      const applied = applyPatch(state, validPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const activeTimelineAfter = applied.state.editorModel.timelines.find(t => t.id === timelineId)
      expect(activeTimelineAfter?.width).toBe(1080)
      expect(activeTimelineAfter?.height).toBe(1920)
      expect(activeTimelineAfter?.fps).toBe(60)

      // 4. Atomic Undo restores previous dimensions
      const undone = undo(applied.state)
      const activeTimelineUndone = undone.editorModel.timelines.find(t => t.id === timelineId)
      expect(activeTimelineUndone?.width).toBeUndefined()
      expect(activeTimelineUndone?.height).toBeUndefined()
    })

    it('KE-402: set_timeline_background supports color, blur, image, description, and atomic undo', () => {
      const state = makeTestState()
      const timelineId = state.editorModel.timelines[0].id

      // 1. Validation error on non-existent timeline
      const invalidPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_background',
          timelineId: 'non-existent-timeline',
          background: { type: 'color', color: '#18181b' },
        }],
      }
      const valRes = validateEditPatch(state, invalidPatch)
      expect(valRes.valid).toBe(false)
      if (!valRes.valid) {
        expect(valRes.error).toContain('does not exist in project')
      }

      // 2. Describe patch for color, blur, image
      const colorPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_background',
          timelineId,
          background: { type: 'color', color: '#ff0000' },
        }],
      }
      expect(describePatch(state, colorPatch)).toContain('set timeline background color to #ff0000')

      const blurPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_background',
          timelineId,
          background: { type: 'blur', blur: 50 },
        }],
      }
      expect(describePatch(state, blurPatch)).toContain('set timeline blurred background (50%)')

      const imagePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_timeline_background',
          timelineId,
          background: { type: 'image', imagePath: 'C:/bg.png' },
        }],
      }
      expect(describePatch(state, imagePatch)).toContain('set timeline background image')

      // 3. Execution sets background
      const applied = applyPatch(state, blurPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const timelineAfter = applied.state.editorModel.timelines.find(t => t.id === timelineId)
      expect(timelineAfter?.background?.type).toBe('blur')
      expect(timelineAfter?.background?.blur).toBe(50)

      // 4. Undo restores previous background
      const undone = undo(applied.state)
      const timelineUndone = undone.editorModel.timelines.find(t => t.id === timelineId)
      expect(timelineUndone?.background).toBeUndefined()
    })

    it('KE-404: set_canvas validates, describes, applies dimensions and background changes, and supports atomic undo', () => {
      const state = makeTestState()
      const timelineId = state.editorModel.timelines[0].id

      // 1. Validation: reject non-existent timeline
      const invalidTimelinePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_canvas',
          timelineId: 'timeline-does-not-exist',
          width: 1080,
          height: 1920,
        }],
      }
      const valRes1 = validateEditPatch(state, invalidTimelinePatch)
      expect(valRes1.valid).toBe(false)
      if (!valRes1.valid) {
        expect(valRes1.error).toContain('does not exist in project')
      }

      // 2. Validation: reject when no properties are provided
      const emptyCanvasPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_canvas',
          timelineId,
        }],
      }
      const valRes2 = validateEditPatch(state, emptyCanvasPatch)
      expect(valRes2.valid).toBe(false)
      if (!valRes2.valid) {
        expect(valRes2.error).toContain('At least one property')
      }

      // 3. Describe patch
      const fullCanvasPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_canvas',
          timelineId,
          width: 1080,
          height: 1920,
          fps: 60,
          background: { type: 'color', color: '#112233' },
        }],
      }
      const desc = describePatch(state, fullCanvasPatch)
      expect(desc).toContain('set canvas')
      expect(desc).toContain('dimensions 1080x1920 @ 60fps')
      expect(desc).toContain('color background #112233')

      // 4. Execution via applyPatch
      const applied = applyPatch(state, fullCanvasPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const tlAfter = applied.state.editorModel.timelines.find(t => t.id === timelineId)
      expect(tlAfter?.width).toBe(1080)
      expect(tlAfter?.height).toBe(1920)
      expect(tlAfter?.fps).toBe(60)
      expect(tlAfter?.background).toEqual({ type: 'color', color: '#112233' })

      // 5. Atomic undo restores prior dimensions and background
      const undone = undo(applied.state)
      const tlUndone = undone.editorModel.timelines.find(t => t.id === timelineId)
      expect(tlUndone?.width).toBeUndefined()
      expect(tlUndone?.height).toBeUndefined()
      expect(tlUndone?.fps).toBeUndefined()
      expect(tlUndone?.background).toBeUndefined()
    })

    it('KE-501: validates, describes, executes and undos set_mask operations', () => {
      const state = makeTestState(10)
      const clipId = 'clip-1'

      // 1. Validation: reject when clip does not exist
      const invalidClipPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_mask',
          clipId: 'non-existent-clip',
          mask: { shape: 'rectangle', x: 50, y: 50, width: 60, height: 40, rotation: 15, feather: 10, invert: false, enabled: true },
        }],
      }
      const valRes1 = validateEditPatch(state, invalidClipPatch)
      expect(valRes1.valid).toBe(false)
      if (!valRes1.valid) {
        expect(valRes1.error).toContain('does not exist')
      }

      // 2. Describe patch
      const maskPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_mask',
          clipId,
          mask: { shape: 'ellipse', x: 40, y: 60, width: 70, height: 50, rotation: 45, feather: 20, invert: true, enabled: true },
        }],
      }
      const desc = describePatch(state, maskPatch)
      expect(desc).toContain('mask')
      expect(desc).toContain('ellipse')
      expect(desc).toContain('feather 20%')
      expect(desc).toContain('inverted')

      // 3. Execution via applyPatch
      const applied = applyPatch(state, maskPatch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipsAfter = selectClips(applied.state)
      const clipAfter = clipsAfter.find(c => c.id === clipId)
      expect(clipAfter?.mask).toBeDefined()
      expect(clipAfter?.mask?.shape).toBe('ellipse')
      expect(clipAfter?.mask?.x).toBe(40)
      expect(clipAfter?.mask?.y).toBe(60)
      expect(clipAfter?.mask?.rotation).toBe(45)
      expect(clipAfter?.mask?.feather).toBe(20)
      expect(clipAfter?.mask?.invert).toBe(true)

      // 4. Atomic undo restores original mask (undefined)
      const undone = undo(applied.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.mask).toBeUndefined()

      // 5. Test removing mask by setting mask: null
      const removePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_mask',
          clipId,
          mask: null,
        }],
      }
      const descRemove = describePatch(applied.state, removePatch)
      expect(descRemove).toContain('remove mask for clip "clip-1"')
      const removed = applyPatch(applied.state, removePatch)
      expect(removed.success).toBe(true)
      const clipRemoved = selectClips(removed.state).find(c => c.id === clipId)
      expect(clipRemoved?.mask).toBeUndefined()
    })
  })

  describe('marker operations (KE-801)', () => {
    it('applies add_marker, update_marker, delete_marker, validates, describes and undoes', () => {
      const state = makeTestState()
      const markerId = 'marker-1'

      // 1. Add marker
      const addPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'add_marker',
          id: markerId,
          time: 15.5,
          label: 'Chương 1',
          color: '#ef4444',
        }],
      }

      const valAdd = validateEditPatch(state, addPatch)
      expect(valAdd.valid).toBe(true)

      const descAdd = describePatch(state, addPatch)
      expect(descAdd).toContain('add 1 markers')

      const appliedAdd = applyPatch(state, addPatch)
      expect(appliedAdd.success).toBe(true)
      const markersAfterAdd = selectMarkers(appliedAdd.state)
      expect(markersAfterAdd.length).toBe(1)
      expect(markersAfterAdd[0].id).toBe(markerId)
      expect(markersAfterAdd[0].time).toBe(15.5)
      expect(markersAfterAdd[0].label).toBe('Chương 1')
      expect(markersAfterAdd[0].color).toBe('#ef4444')

      // 2. Update marker
      const updatePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'update_marker',
          markerId,
          time: 20.0,
          label: 'Chương 1 (sửa)',
        }],
      }
      const valUpdate = validateEditPatch(appliedAdd.state, updatePatch)
      expect(valUpdate.valid).toBe(true)

      const descUpdate = describePatch(appliedAdd.state, updatePatch)
      expect(descUpdate).toContain('update 1 markers')

      const appliedUpdate = applyPatch(appliedAdd.state, updatePatch)
      expect(appliedUpdate.success).toBe(true)
      const markersAfterUpdate = selectMarkers(appliedUpdate.state)
      expect(markersAfterUpdate[0].time).toBe(20.0)
      expect(markersAfterUpdate[0].label).toBe('Chương 1 (sửa)')

      // 3. Delete marker
      const deletePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'delete_marker',
          markerId,
        }],
      }
      const valDelete = validateEditPatch(appliedUpdate.state, deletePatch)
      expect(valDelete.valid).toBe(true)

      const descDelete = describePatch(appliedUpdate.state, deletePatch)
      expect(descDelete).toContain('delete 1 markers')

      const appliedDelete = applyPatch(appliedUpdate.state, deletePatch)
      expect(appliedDelete.success).toBe(true)
      expect(selectMarkers(appliedDelete.state).length).toBe(0)

      // 4. Undo restores updated marker
      const undone = undo(appliedDelete.state)
      expect(selectMarkers(undone).length).toBe(1)
      expect(selectMarkers(undone)[0].label).toBe('Chương 1 (sửa)')

      // 5. Validation fails for non-existent marker in update/delete
      const invalidPatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'delete_marker',
          markerId: 'non-existent',
        }],
      }
      const valInvalid = validateEditPatch(state, invalidPatch)
      expect(valInvalid.valid).toBe(false)
    })
  })

  describe('freeze_frame operation (KE-802)', () => {
    it('freezes a frame on a video clip, splitting it and inserting an image clip with inherited properties', () => {
      const clip = createMockClip({
        id: 'clip-video-1',
        type: 'video',
        startTime: 0,
        duration: 10,
        transform: {
          scale: 150,
          positionX: 10,
          positionY: -5,
          rotation: 15,
          cropTop: 5,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
        },
        filter: { id: 'cine-teal-orange', intensity: 80 },
        colorCorrection: {
          brightness: 10,
          contrast: 20,
          saturation: 5,
          temperature: 0,
          tint: 0,
          exposure: 0,
          highlights: 0,
          shadows: 0,
        },
      })
      const timeline = createMockTimeline([clip])
      const state = createInitialEditorState({
        timelines: [timeline],
        activeTimelineId: timeline.id,
        assets: [],
        bins: {},
      })

      const patch: EditPatch = {
        version: 1,
        operations: [{
          op: 'freeze_frame',
          clipId: 'clip-video-1',
          time: 4.0,
          duration: 2.0,
        }],
      }

      // 1. Validate
      const validation = validateEditPatch(state, patch)
      expect(validation.valid).toBe(true)

      // 2. Describe
      const description = describePatch(state, patch)
      expect(description).toContain('freeze 1 frames')

      // 3. Apply
      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)

      const clipsAfter = selectClips(applied.state)
      // Original clip split into first half + freeze image clip + second half
      expect(clipsAfter.length).toBe(3)

      const firstHalf = clipsAfter.find(c => c.id === 'clip-video-1')!
      expect(firstHalf).toBeDefined()
      expect(firstHalf.startTime).toBe(0)
      expect(firstHalf.duration).toBeCloseTo(4.0)

      const freezeClip = clipsAfter.find(c => c.type === 'image')!
      expect(freezeClip).toBeDefined()
      expect(freezeClip.startTime).toBeCloseTo(4.0)
      expect(freezeClip.duration).toBeCloseTo(2.0)
      expect(freezeClip.transform.scale).toBe(150)
      expect(freezeClip.transform.positionX).toBe(10)
      expect(freezeClip.filter?.id).toBe('cine-teal-orange')
      expect(freezeClip.filter?.intensity).toBe(80)
      expect(freezeClip.colorCorrection?.contrast).toBe(20)

      const secondHalf = clipsAfter.find(c => c.id !== 'clip-video-1' && c.type === 'video')!
      expect(secondHalf).toBeDefined()
      expect(secondHalf.startTime).toBeCloseTo(6.0)
      expect(secondHalf.duration).toBeCloseTo(6.0)

      // 4. Undo restores single clip
      const undone = undo(applied.state)
      expect(selectClips(undone).length).toBe(1)
      expect(selectClips(undone)[0].id).toBe('clip-video-1')
      expect(selectClips(undone)[0].duration).toBe(10)
    })

    it('validates bounds and rejects invalid freeze time or locked track', () => {
      const clip = createMockClip({ id: 'c1', startTime: 0, duration: 5, trackIndex: 0 })
      const timeline = createMockTimeline([clip], [
        { id: 'v1', kind: 'video', name: 'V1', locked: true, muted: false },
      ])
      const state = createInitialEditorState({
        timelines: [timeline],
        activeTimelineId: timeline.id,
        assets: [],
        bins: {},
      })

      // Locked track
      const lockedPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'freeze_frame', clipId: 'c1', time: 2.0 }],
      }
      expect(validateEditPatch(state, lockedPatch).valid).toBe(false)

      // Outside bounds
      const unlockedTimeline = createMockTimeline([clip], [
        { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
      ])
      const unlockedState = createInitialEditorState({
        timelines: [unlockedTimeline],
        activeTimelineId: unlockedTimeline.id,
        assets: [],
        bins: {},
      })

      const outOfBoundsPatch: EditPatch = {
        version: 1,
        operations: [{ op: 'freeze_frame', clipId: 'c1', time: 10.0 }],
      }
      expect(validateEditPatch(unlockedState, outOfBoundsPatch).valid).toBe(false)
    })
  })

  // ── 15. KE-901: Smart Captions Chunking & Short-form Subtitle Presets ────────
  describe('KE-901: Smart Captions Chunking & Short-form Presets', () => {
    it('validates and applies import_srt with chunking and preset', () => {
      const state = makeTestState(60)

      const srtLongContent = `1
00:00:01,000 --> 00:00:08,000
Chào mừng các bạn đã quay trở lại với video hướng dẫn làm nội dung ngắn triệu view ngày hôm nay.
`

      const patch: EditPatch = {
        version: 1,
        description: 'Nhập SRT và tự động ngắt câu ngắn 3-5 từ',
        operations: [
          {
            op: 'import_srt',
            content: srtLongContent,
            chunk: true,
            minWords: 3,
            maxWords: 5,
            preset: 'tiktok-classic',
          },
        ],
      }

      // 1. Validate
      const validation = validateEditPatch(state, patch)
      expect(validation.valid).toBe(true)

      // 2. Describe
      const desc = describePatch(state, patch)
      expect(desc).toContain('import')
      expect(desc).toContain('subtitles from SRT')

      // 3. Apply
      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const subs = selectSubtitles(applied.state)
      // Long sentence of 19 words chunked into >= 4 cues
      expect(subs.length).toBeGreaterThanOrEqual(4)

      // Verify preset style was applied
      expect(subs[0].style?.fontWeight).toBe('bold')
      expect(subs[0].style?.position).toBe('bottom')
      expect(subs[0].style?.color).toBe('#FFFFFF')
    })

    it('validates and applies add_subtitle with preset option', () => {
      const state = makeTestState(60)

      const patch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'add_subtitle',
            text: 'CÂU NÓI VIRAL!',
            startTime: 2,
            endTime: 4,
            preset: 'viral-yellow',
          },
        ],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const subs = selectSubtitles(applied.state)
      const sub = subs.find(s => s.text === 'CÂU NÓI VIRAL!')
      expect(sub).toBeDefined()
      expect(sub?.style?.color).toBe('#FFE600')
      expect(sub?.style?.fontWeight).toBe('bold')
    })

    it('rejects unknown preset for subtitle operations', () => {
      const state = makeTestState(60)

      const badPresetPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'add_subtitle',
            text: 'Test',
            startTime: 0,
            endTime: 2,
            preset: 'non-existent-super-preset',
          },
        ],
      }

      const val = validateEditPatch(state, badPresetPatch)
      expect(val.valid).toBe(false)
      if (!val.valid) {
        expect(val.error).toContain('non-existent-super-preset')
      }
    })

    it('executes chunk_subtitles on existing long subtitles in timeline', () => {
      let state = makeTestState(60)

      // First add a long subtitle
      const addPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'add_subtitle',
            text: 'Đây là câu thoại phụ đề dài dòng trên timeline cần được chia nhỏ thành từng cụm từ.',
            startTime: 10,
            endTime: 20,
          },
        ],
      }
      const res1 = applyPatch(state, addPatch)
      expect(res1.success).toBe(true)
      if (!res1.success) throw new Error(res1.error)

      // Now chunk them
      const chunkPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'chunk_subtitles',
            minWords: 3,
            maxWords: 5,
            preset: 'viral-neon',
          },
        ],
      }

      const val = validateEditPatch(res1.state, chunkPatch)
      expect(val.valid).toBe(true)

      const res2 = applyPatch(res1.state, chunkPatch)
      expect(res2.success).toBe(true)
      if (!res2.success) throw new Error(res2.error)

      const chunkedSubs = selectSubtitles(res2.state)
      expect(chunkedSubs.length).toBeGreaterThan(1)
      expect(chunkedSubs[0].style?.color).toBe('#00FF66')
    })
  })

  describe('KE-902: Dynamic Zoom (Punch-in cut)', () => {
    it('executes punch_in_cut on a target visual clip', () => {
      const state = makeTestState(60)
      const clip = selectClips(state)[0]
      expect(clip).toBeDefined()

      const patch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'punch_in_cut',
            clipId: clip.id,
            scale: 120,
            positionX: 5,
            positionY: -2,
          },
        ],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const res = applyPatch(state, patch)
      expect(res.success).toBe(true)
      if (!res.success) throw new Error(res.error)

      const updatedClip = selectClips(res.state).find(c => c.id === clip.id)
      expect(updatedClip?.transform?.scale).toBe(120)
      expect(updatedClip?.transform?.positionX).toBe(5)
      expect(updatedClip?.transform?.positionY).toBe(-2)
      expect(res.description).toContain('punch-in (120%)')
    })

    it('executes punch_in_sequence alternating between 100% and punch-in scale', () => {
      let state = makeTestState(60)
      // Cut the main clip into 4 segments
      const mainClip = selectClips(state)[0]
      const splitPatch: EditPatch = {
        version: 1,
        operations: [
          { op: 'split_clip', clipId: mainClip.id, splitTime: 10 },
        ],
      }
      let res = applyPatch(state, splitPatch)
      expect(res.success).toBe(true)

      const clipsAfter1 = selectClips(res.state).filter(c => c.trackIndex === 0)
      const secondClip = clipsAfter1[1]
      const splitPatch2: EditPatch = {
        version: 1,
        operations: [
          { op: 'split_clip', clipId: secondClip.id, splitTime: 20 },
        ],
      }
      res = applyPatch(res.state, splitPatch2)
      expect(res.success).toBe(true)

      const clipsAfter2 = selectClips(res.state).filter(c => c.trackIndex === 0)
      const thirdClip = clipsAfter2[2]
      const splitPatch3: EditPatch = {
        version: 1,
        operations: [
          { op: 'split_clip', clipId: thirdClip.id, splitTime: 30 },
        ],
      }
      res = applyPatch(res.state, splitPatch3)
      expect(res.success).toBe(true)

      const trackClips = selectClips(res.state).filter(c => c.trackIndex === 0).sort((a, b) => a.startTime - b.startTime)
      expect(trackClips.length).toBe(4)

      // Apply punch_in_sequence
      const seqPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'punch_in_sequence',
            trackIndex: 0,
            scale: 115,
            startWithZoom: false,
          },
        ],
      }

      const val = validateEditPatch(res.state, seqPatch)
      expect(val.valid).toBe(true)

      const seqRes = applyPatch(res.state, seqPatch)
      expect(seqRes.success).toBe(true)
      if (!seqRes.success) throw new Error(seqRes.error)

      const resultClips = selectClips(seqRes.state).filter(c => c.trackIndex === 0).sort((a, b) => a.startTime - b.startTime)
      expect(resultClips[0].transform?.scale).toBe(100)
      expect(resultClips[1].transform?.scale).toBe(115)
      expect(resultClips[2].transform?.scale).toBe(100)
      expect(resultClips[3].transform?.scale).toBe(115)
      expect(seqRes.description).toContain('alternating punch-in 100% ↔ 115%')
    })

    it('rejects punch_in_cut on non-existent clip or invalid scale', () => {
      const state = makeTestState(60)
      const patch1: EditPatch = {
        version: 1,
        operations: [{ op: 'punch_in_cut', clipId: 'ghost-clip' }],
      }
      const val1 = validateEditPatch(state, patch1)
      expect(val1.valid).toBe(false)
      if (!val1.valid) {
        expect(val1.error).toContain('does not exist')
      }

      const clip = selectClips(state)[0]
      const patch2: EditPatch = {
        version: 1,
        operations: [{ op: 'punch_in_cut', clipId: clip.id, scale: -10 }],
      }
      const val2 = validateEditPatch(state, patch2)
      expect(val2.valid).toBe(false)
    })
  })

  describe('create_highlight_short', () => {
    it('creates 9:16 vertical short and adds 3s hook title card', () => {
      const state = makeTestState(120)
      const clip = selectClips(state)[0]

      const patch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'create_highlight_short',
            sourceClipId: clip.id,
            startTime: 15.0,
            endTime: 45.0,
            hookText: 'Bí mật triệu view!',
            hookPreset: 'headline-alert',
          },
        ],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const desc = describePatch(state, patch)
      expect(desc).toContain('create 9:16 Short (30.0s) with hook "Bí mật triệu view!"')

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const activeTl = selectActiveTimeline(applied.state)
      expect(activeTl?.width).toBe(1080)
      expect(activeTl?.height).toBe(1920)

      const clips = selectClips(applied.state)
      const videoClip = clips.find(c => c.type === 'video')
      expect(videoClip).toBeDefined()
      expect(videoClip?.duration).toBe(30.0)
      expect(videoClip?.startTime).toBe(0)
      expect(videoClip?.trimStart).toBe(15.0)

      const textClip = clips.find(c => c.type === 'text')
      expect(textClip).toBeDefined()
      expect(textClip?.startTime).toBe(0)
      expect(textClip?.duration).toBe(3.0)
      expect(textClip?.textStyle?.text).toBe('Bí mật triệu view!')
    })

    it('rejects create_highlight_short with out of bounds range', () => {
      const state = makeTestState(60)
      const clip = selectClips(state)[0]

      const invalidPatch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'create_highlight_short',
            sourceClipId: clip.id,
            startTime: 50.0,
            endTime: 80.0, // > clip duration (60s)
          },
        ],
      }

      const val = validateEditPatch(state, invalidPatch)
      expect(val.valid).toBe(false)
      if (!val.valid) {
        expect(val.error).toContain('exceeds clip bounds')
      }
    })

    it('validates, describes, executes, and undoes insert_broll (KE-904)', () => {
      const state = makeTestState(30)

      const patch: EditPatch = {
        version: 1,
        operations: [
          {
            op: 'insert_broll',
            assetPath: '/assets/broll-app.mp4',
            startTime: 5.0,
            duration: 4.0,
            fadeIn: 0.25,
            fadeOut: 0.25,
            muteAudio: true,
          },
        ],
      }

      // 1. Validation
      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      // 2. Description
      const desc = describePatch(state, patch)
      expect(desc).toContain('insert 1 B-roll clips')

      // 3. Execution
      const result = applyPatch(state, patch)
      expect(result.success).toBe(true)
      if (!result.success) throw new Error(result.error)

      const clips = selectClips(result.state)
      const brollClip = clips.find(c => c.startTime === 5.0 && c.duration === 4.0 && c.trackIndex > 0)

      expect(brollClip).toBeDefined()
      expect(brollClip?.muted).toBe(true)
      expect(brollClip?.volume).toBe(0)
      expect(brollClip?.transitionIn?.type).toBe('dissolve')
      expect(brollClip?.transitionIn?.duration).toBe(0.25)
      expect(brollClip?.transitionOut?.type).toBe('dissolve')
      expect(brollClip?.transitionOut?.duration).toBe(0.25)

      // 4. Undo
      const undone = undo(result.state)
      const clipsAfterUndo = selectClips(undone)
      expect(clipsAfterUndo.some(c => c.startTime === 5.0 && c.duration === 4.0 && c.trackIndex > 0)).toBe(false)
    })
  })

  /*
   * A template is an edit the agent can apply too, so it ships with a patch
   * operation — the repo rule in AGENTS.md, "every feature ships with its MCP
   * counterpart".
   */
  describe('apply_template', () => {
    const templateFrom = (state: ReturnType<typeof makeTestState>) =>
      buildTemplateFromTimeline(state.editorModel.timelines[0], { name: 'Nhịp nhanh' }).template

    const stateWithAsset = () => {
      const base = makeTestState(10)
      return {
        ...base,
        editorModel: {
          ...base.editorModel,
          assets: [{
            id: 'asset-1', type: 'video' as const, path: 'C:/mine/one.mp4',
            prompt: '', resolution: '', duration: 30, createdAt: 0,
          }],
        },
      }
    }

    it('describes how many slots get filled, and how many do not', () => {
      const state = stateWithAsset()
      const template = templateFrom(state)
      const described = describePatch(state, {
        version: 1,
        operations: [{ op: 'apply_template', template, bindings: [] }],
      })
      expect(described.toLowerCase()).toContain('template')
      expect(described).toContain('0/1')
      expect(described).toContain('left empty')
    })

    it('refuses a template with no slots to put footage into', () => {
      const state = stateWithAsset()
      const template = { ...templateFrom(state), slots: [] }
      const result = validateEditPatch(state, {
        version: 1,
        operations: [{ op: 'apply_template', template, bindings: [] }],
      })
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error).toContain('no slots')
    })

    it('refuses a binding to an asset the project does not have', () => {
      const state = stateWithAsset()
      const template = templateFrom(state)
      const result = validateEditPatch(state, {
        version: 1,
        operations: [{
          op: 'apply_template', template,
          bindings: [{ slotIndex: 1, assetId: 'not-here' }],
        }],
      })
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error).toContain('does not exist in project')
    })

    it('refuses two clips bound into the same hole', () => {
      const state = stateWithAsset()
      const template = templateFrom(state)
      const result = validateEditPatch(state, {
        version: 1,
        operations: [{
          op: 'apply_template', template,
          bindings: [
            { slotIndex: 1, assetId: 'asset-1' },
            { slotIndex: 1, assetId: 'asset-1' },
          ],
        }],
      })
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error).toContain('bound more than once')
    })

    /* Applying must never overwrite the edit the user is working in. */
    it('adds a new timeline and leaves the original untouched', () => {
      const state = stateWithAsset()
      const template = templateFrom(state)
      const before = state.editorModel.timelines[0]

      const result = applyPatch(state, {
        version: 1,
        operations: [{
          op: 'apply_template', template,
          bindings: [{ slotIndex: 1, assetId: 'asset-1' }],
        }],
      })
      expect(result.success).toBe(true)

      const next = result.state
      expect(next.editorModel.timelines).toHaveLength(2)
      expect(next.editorModel.timelines[0]).toEqual(before)

      const applied = next.editorModel.timelines[1]
      expect(next.editorModel.activeTimelineId).toBe(applied.id)
      expect(applied.variantTag).toBe('template')
      expect(applied.clips.find(c => c.assetId === 'asset-1')).toBeDefined()
    })
  })
})
