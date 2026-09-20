import { describe, expect, it } from 'vitest'
import {
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
  selectClips,
  selectMarkers,
  type EditPatch,
  createInitialEditorState,
} from '../src'
import { makeTestState, createMockClip, createMockTimeline } from './edit-patch-test-helpers'

describe('Edit Patch: Canvas, Mask, Markers, and Freeze Frame', () => {
  describe('canvas and mask operations', () => {
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

})
