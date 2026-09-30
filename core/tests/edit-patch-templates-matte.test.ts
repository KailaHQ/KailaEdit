import { describe, expect, it } from 'vitest'
import { buildTemplateFromTimeline } from '../src/template-model'
import {
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
  selectClips,
  selectActiveTimeline,
  DEFAULT_AUTO_MATTE,
  DEFAULT_CLIP_STROKE,
  type EditPatch,
  createInitialEditorState,
} from '../src'
import { makeTestState, createMockClip, createMockTimeline } from './edit-patch-test-helpers'

describe('Edit Patch: Templates, Shorts, Auto Matte, and Stroke', () => {
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


  // ── 20. KE-1406: Auto Matte and Stroke Operations ─────────────────────────
  describe('KE-1406: Auto Matte and Stroke Operations', () => {
    it('validates, describes, applies and undoes set_auto_matte', () => {
      const state = makeTestState(10)
      const clipId = 'clip-1'

      // 1. Success path
      const patch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_auto_matte',
          clipId,
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 15,
            cleanEdge: 10,
          },
        }],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const desc = describePatch(state, patch)
      expect(desc).toContain('auto matte (standard, feather 15%, clean edge 10%) for clip "clip-1"')

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.autoMatte).toBeDefined()
      expect(clipAfter?.autoMatte?.enabled).toBe(true)
      expect(clipAfter?.autoMatte?.featherEdge).toBe(15)
      expect(clipAfter?.autoMatte?.cleanEdge).toBe(10)

      // 2. Undo restores previous state (undefined)
      const undone = undo(applied.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.autoMatte).toBeUndefined()

      // 3. Remove by passing null
      const removePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_auto_matte',
          clipId,
          autoMatte: null,
        }],
      }
      const descRemove = describePatch(applied.state, removePatch)
      expect(descRemove).toContain('remove auto matte for clip "clip-1"')

      const removed = applyPatch(applied.state, removePatch)
      expect(removed.success).toBe(true)
      const clipRemoved = selectClips(removed.state).find(c => c.id === clipId)
      expect(clipRemoved?.autoMatte).toBeUndefined()
    })

    it('validates, describes, applies and undoes set_custom_matte', () => {
      const state = makeTestState(10)
      const clipId = 'clip-1'

      // 1. Success path
      const patch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_custom_matte',
          clipId,
          customMatte: {
            enabled: true,
            strokes: [
              { mode: 'brush', size: 5, points: [[0.2, 0.3], [0.25, 0.35]], paintedAt: 100 },
            ],
          },
        }],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const desc = describePatch(state, patch)
      expect(desc).toContain('custom matte (1 strokes) for clip "clip-1"')

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.customMatte).toBeDefined()
      expect(clipAfter?.customMatte?.enabled).toBe(true)
      expect(clipAfter?.customMatte?.strokes).toHaveLength(1)

      // 2. Undo restores previous state (undefined)
      const undone = undo(applied.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.customMatte).toBeUndefined()

      // 3. Remove by passing null
      const removePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_custom_matte',
          clipId,
          customMatte: null,
        }],
      }
      const descRemove = describePatch(applied.state, removePatch)
      expect(descRemove).toContain('remove custom matte for clip "clip-1"')

      const removed = applyPatch(applied.state, removePatch)
      expect(removed.success).toBe(true)
      const clipRemoved = selectClips(removed.state).find(c => c.id === clipId)
      expect(clipRemoved?.customMatte).toBeUndefined()
    })

    it('validates, describes, applies and undoes set_stroke', () => {
      const state = makeTestState(10)
      const clipId = 'clip-1'

      // 1. Success path
      const patch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_stroke',
          clipId,
          stroke: {
            ...DEFAULT_CLIP_STROKE,
            enabled: true,
            style: 'luminescence',
            color: '#00E5FF',
            width: 12,
            opacity: 100,
            glow: 80,
          },
        }],
      }

      const val = validateEditPatch(state, patch)
      expect(val.valid).toBe(true)

      const desc = describePatch(state, patch)
      expect(desc).toContain('stroke luminescence color #00E5FF width 12% for clip "clip-1"')

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) throw new Error(applied.error)

      const clipAfter = selectClips(applied.state).find(c => c.id === clipId)
      expect(clipAfter?.stroke).toBeDefined()
      expect(clipAfter?.stroke?.enabled).toBe(true)
      expect(clipAfter?.stroke?.style).toBe('luminescence')
      expect(clipAfter?.stroke?.color).toBe('#00E5FF')
      expect(clipAfter?.stroke?.width).toBe(12)

      // 2. Undo restores previous state
      const undone = undo(applied.state)
      const clipUndone = selectClips(undone).find(c => c.id === clipId)
      expect(clipUndone?.stroke).toBeUndefined()

      // 3. Remove by passing null
      const removePatch: EditPatch = {
        version: 1,
        operations: [{
          op: 'set_stroke',
          clipId,
          stroke: null,
        }],
      }
      const descRemove = describePatch(applied.state, removePatch)
      expect(descRemove).toContain('remove stroke for clip "clip-1"')

      const removed = applyPatch(applied.state, removePatch)
      expect(removed.success).toBe(true)
      const clipRemoved = selectClips(removed.state).find(c => c.id === clipId)
      expect(clipRemoved?.stroke).toBeUndefined()
    })

    it('rejects set_auto_matte and set_stroke when clip does not exist', () => {
      const state = makeTestState(10)
      const missingMatte: EditPatch = {
        version: 1,
        operations: [{ op: 'set_auto_matte', clipId: 'ghost-clip', autoMatte: { ...DEFAULT_AUTO_MATTE, enabled: true } }],
      }
      const valMatte = validateEditPatch(state, missingMatte)
      expect(valMatte.valid).toBe(false)
      if (!valMatte.valid) expect(valMatte.error).toContain('does not exist')

      const missingStroke: EditPatch = {
        version: 1,
        operations: [{ op: 'set_stroke', clipId: 'ghost-clip', stroke: { ...DEFAULT_CLIP_STROKE, enabled: true, style: 'solid' } }],
      }
      const valStroke = validateEditPatch(state, missingStroke)
      expect(valStroke.valid).toBe(false)
      if (!valStroke.valid) expect(valStroke.error).toContain('does not exist')
    })

    it('rejects set_auto_matte and set_stroke when applied to audio clip', () => {
      const audioClip = createMockClip({ id: 'audio-1', type: 'audio', trackIndex: 0, startTime: 0, duration: 10 })
      const timeline = createMockTimeline([audioClip])
      const state = createInitialEditorState({
        timelines: [timeline],
        activeTimelineId: timeline.id,
        assets: [],
        bins: {},
      })

      const audioMattePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_auto_matte', clipId: 'audio-1', autoMatte: { ...DEFAULT_AUTO_MATTE, enabled: true } }],
      }
      const valMatte = validateEditPatch(state, audioMattePatch)
      expect(valMatte.valid).toBe(false)
      if (!valMatte.valid) expect(valMatte.error).toContain('Cannot apply auto matte to non-visual clip')

      const audioStrokePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_stroke', clipId: 'audio-1', stroke: { ...DEFAULT_CLIP_STROKE, enabled: true, style: 'solid' } }],
      }
      const valStroke = validateEditPatch(state, audioStrokePatch)
      expect(valStroke.valid).toBe(false)
      if (!valStroke.valid) expect(valStroke.error).toContain('Cannot apply stroke to non-visual clip')
    })

    it('rejects set_auto_matte and set_stroke when track is locked', () => {
      const clip = createMockClip({ id: 'c-locked', startTime: 0, duration: 10, trackIndex: 0 })
      const timeline = createMockTimeline([clip], [
        { id: 'v1', kind: 'video', name: 'V1', locked: true, muted: false },
      ])
      const state = createInitialEditorState({
        timelines: [timeline],
        activeTimelineId: timeline.id,
        assets: [],
        bins: {},
      })

      const lockedMattePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_auto_matte', clipId: 'c-locked', autoMatte: { ...DEFAULT_AUTO_MATTE, enabled: true } }],
      }
      const valMatte = validateEditPatch(state, lockedMattePatch)
      expect(valMatte.valid).toBe(false)
      if (!valMatte.valid) expect(valMatte.error).toContain('locked track')

      const lockedStrokePatch: EditPatch = {
        version: 1,
        operations: [{ op: 'set_stroke', clipId: 'c-locked', stroke: { ...DEFAULT_CLIP_STROKE, enabled: true, style: 'solid' } }],
      }
      const valStroke = validateEditPatch(state, lockedStrokePatch)
      expect(valStroke.valid).toBe(false)
      if (!valStroke.valid) expect(valStroke.error).toContain('locked track')
    })
  })
})
