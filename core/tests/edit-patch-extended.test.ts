import { describe, it, expect } from 'vitest'
import {
  createInitialEditorState,
  getEditorModel,
  projectSchema,
  type Project,
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
} from '../src/index'

describe('S5-3 · Mở rộng Edit Patch: chèn, phụ đề, text', () => {
  const createTestState = () => {
    const asset1 = {
      id: 'asset-video-1',
      type: 'video' as const,
      path: '/path/to/video1.mp4',
      prompt: 'Video 1',
      resolution: '1920x1080',
      duration: 10,
      createdAt: 1000,
    }
    const asset2 = {
      id: 'asset-video-2',
      type: 'video' as const,
      path: '/path/to/video2.mp4',
      prompt: 'Video 2',
      resolution: '1920x1080',
      duration: 5,
      createdAt: 1000,
    }
    const project: Project = projectSchema.parse({
      version: 2,
      id: 'test-proj',
      name: 'Test Project',
      createdAt: 1000,
      updatedAt: 1000,
      assets: [asset1, asset2],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl-main',
          name: 'Main Timeline',
          createdAt: 1000,
          tracks: [
            { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false, sourcePatched: true },
            { id: 'v2-locked', name: 'V2 Locked', kind: 'video', muted: false, locked: true },
          ],
          clips: [
            {
              id: 'clip-1',
              trackIndex: 0,
              startTime: 0,
              duration: 10,
              trimStart: 0,
              trimEnd: 10,
              type: 'video',
              assetId: 'asset-video-1',
              asset: asset1,
            },
          ],
          subtitles: [],
        },
      ],
      activeTimelineId: 'tl-main',
    })
    return createInitialEditorState(getEditorModel(project))
  }

  describe('Validation of new operations', () => {
    it('validates insert_clip with existing asset', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [{ op: 'insert_clip', assetId: 'asset-video-2', trackIndex: 0 }],
      }
      const res = validateEditPatch(state, patch)
      expect(res.valid).toBe(true)
    })

    it('rejects insert_clip with non-existent asset (does not auto-import)', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [{ op: 'insert_clip', assetId: 'asset-ghost-99' }],
      }
      const res = validateEditPatch(state, patch)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain('does not exist in project assets')
      }
    })

    it('rejects insert_clip onto locked track', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [{ op: 'insert_clip', assetId: 'asset-video-1', trackIndex: 1 }],
      }
      const res = validateEditPatch(state, patch)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain('Cannot insert clip onto locked track')
      }
    })

    it('rejects negative startTime via zod schema', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [{ op: 'insert_clip', assetId: 'asset-video-1', startTime: -5 }],
      }
      const res = validateEditPatch(state, patch)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain('Patch schema validation failed')
      }
    })

    it('validates add_subtitle and rejects if endTime <= startTime', () => {
      const state = createTestState()
      const validPatch = {
        version: 1,
        operations: [{ op: 'add_subtitle', text: 'Hello World', startTime: 1, endTime: 4 }],
      }
      expect(validateEditPatch(state, validPatch).valid).toBe(true)

      const invalidPatch = {
        version: 1,
        operations: [{ op: 'add_subtitle', text: 'Hello World', startTime: 4, endTime: 1 }],
      }
      expect(validateEditPatch(state, invalidPatch).valid).toBe(false)
    })

    it('validates import_srt and rejects invalid SRT content', () => {
      const state = createTestState()
      const validSrt = `1
00:00:01,000 --> 00:00:04,000
First subtitle

2
00:00:05,000 --> 00:00:08,000
Second subtitle`

      const res = validateEditPatch(state, {
        version: 1,
        operations: [{ op: 'import_srt', content: validSrt }],
      })
      expect(res.valid).toBe(true)

      const emptySrtRes = validateEditPatch(state, {
        version: 1,
        operations: [{ op: 'import_srt', content: 'Not an srt file' }],
      })
      expect(emptySrtRes.valid).toBe(false)
    })
  })

  describe('describePatch purity and descriptions', () => {
    it('is a pure function that does not mutate the state', () => {
      const state = createTestState()
      const stateSnapshot = JSON.stringify(state)

      const patch = {
        version: 1,
        description: 'Thêm phụ đề và văn bản',
        operations: [
          { op: 'insert_clip', assetId: 'asset-video-2', trackIndex: 0 },
          { op: 'add_subtitle', text: 'Chào bạn', startTime: 1, endTime: 3 },
          { op: 'add_text', text: 'Tiêu đề video', startTime: 0 },
        ],
      }

      const desc = describePatch(state, patch as any)
      expect(typeof desc).toBe('string')
      expect(desc).toContain('insert 1 clips')
      expect(desc).toContain('add 1 subtitles')
      expect(desc).toContain('add 1 text clips')

      // Assert state was not mutated at all
      expect(JSON.stringify(state)).toBe(stateSnapshot)
    })
  })

  describe('applyPatch execution and single undo step', () => {
    it('executes insert_clip and preserves magnetic V1 track invariant', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [{ op: 'insert_clip', assetId: 'asset-video-2', trackIndex: 0 }],
      }

      const result = applyPatch(state, patch)
      expect(result.success).toBe(true)
      if (!result.success) return

      const timeline = result.state.editorModel.timelines[0]
      const v1Clips = timeline.clips.filter(c => c.trackIndex === 0)
      expect(v1Clips).toHaveLength(2)

      // Invariant: V1 clips must be packed seamlessly
      expect(v1Clips[0].startTime).toBe(0)
      expect(v1Clips[1].startTime).toBe(v1Clips[0].duration)
    })

    it('executes import_srt and adds subtitles properly', () => {
      const state = createTestState()
      const srt = `1
00:00:01,000 --> 00:00:03,000
Xin chào Việt Nam

2
00:00:04,000 --> 00:00:07,000
KomfyEdit Offline Editor`

      const patch = {
        version: 1,
        operations: [{ op: 'import_srt', content: srt }],
      }

      const result = applyPatch(state, patch)
      expect(result.success).toBe(true)
      if (!result.success) return

      const timeline = result.state.editorModel.timelines[0]
      expect(timeline.subtitles).toHaveLength(2)
      expect(timeline.subtitles[0].text).toBe('Xin chào Việt Nam')
      expect(timeline.subtitles[1].text).toBe('KomfyEdit Offline Editor')
    })

    it('applies a multi-operation patch as exactly 1 atomic undo step', () => {
      const state = createTestState()
      const patch = {
        version: 1,
        operations: [
          { op: 'insert_clip', assetId: 'asset-video-2', trackIndex: 0 },
          { op: 'add_subtitle_track' },
          { op: 'add_subtitle', text: 'Sub 1', startTime: 0, endTime: 2 },
          { op: 'add_text', text: 'Title overlay' },
        ],
      }

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) return

      // Exactly 1 undo step was pushed to history
      expect(applied.state.history.undoStack).toHaveLength(state.history.undoStack.length + 1)

      // Performing 1 undo restores the exact original state
      const reverted = undo(applied.state)
      expect(reverted.editorModel.timelines[0].clips).toHaveLength(state.editorModel.timelines[0].clips.length)
      expect(reverted.editorModel.timelines[0].subtitles).toHaveLength(0)
      expect(reverted.editorModel.timelines[0].tracks).toHaveLength(state.editorModel.timelines[0].tracks.length)
    })

    it('rejects an invalid multi-operation patch atomically without partial modifications', () => {
      const state = createTestState()
      const invalidPatch = {
        version: 1,
        operations: [
          { op: 'insert_clip', assetId: 'asset-video-2', trackIndex: 0 }, // valid
          { op: 'insert_clip', assetId: 'ghost-asset-404' }, // invalid!
        ],
      }

      const result = applyPatch(state, invalidPatch)
      expect(result.success).toBe(false)
      expect(result.state).toBe(state) // completely untouched
      expect(result.state.editorModel.timelines[0].clips).toHaveLength(1)
    })
  })

  describe('KE-502 · Chroma key edit patch & atomic undo', () => {
    it('validates set_chroma_key patch operations', () => {
      const state = createTestState()
      const validPatch = {
        version: 1,
        operations: [
          {
            op: 'set_chroma_key',
            clipId: 'clip-1',
            chromaKey: {
              enabled: true,
              color: '#00FF00',
              similarity: 35,
              smoothness: 15,
              spill: 50,
            },
          },
        ],
      }
      expect(validateEditPatch(state, validPatch).valid).toBe(true)

      const invalidClipPatch = {
        version: 1,
        operations: [
          {
            op: 'set_chroma_key',
            clipId: 'non-existent-clip',
            chromaKey: { enabled: true, color: '#00FF00', similarity: 30, smoothness: 10, spill: 50 },
          },
        ],
      }
      const invalidRes = validateEditPatch(state, invalidClipPatch)
      expect(invalidRes.valid).toBe(false)
      if (!invalidRes.valid) {
        expect(invalidRes.error).toContain('does not exist')
      }
    })

    it('describes set_chroma_key patch human-readably', () => {
      const setPatch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_chroma_key' as const,
            clipId: 'clip-1',
            chromaKey: {
              enabled: true,
              color: '#00FF00',
              similarity: 30,
              smoothness: 10,
              spill: 50,
            },
          },
        ],
      }
      const state = createTestState()
      const desc = describePatch(state, setPatch)
      expect(desc).toContain('chroma key color #00FF00')
      expect(desc).toContain('#00FF00')

      const removePatch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_chroma_key' as const,
            clipId: 'clip-1',
            chromaKey: null,
          },
        ],
      }
      const removeDesc = describePatch(state, removePatch)
      expect(removeDesc).toContain('remove chroma key')
    })

    it('applies set_chroma_key and undoes atomically', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_chroma_key' as const,
            clipId: 'clip-1',
            chromaKey: {
              enabled: true,
              color: '#00FF00',
              similarity: 40,
              smoothness: 20,
              spill: 60,
            },
          },
        ],
      }

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) return

      const clip = applied.state.editorModel.timelines[0].clips.find(c => c.id === 'clip-1')
      expect(clip?.chromaKey).toBeDefined()
      expect(clip?.chromaKey?.color).toBe('#00FF00')
      expect(clip?.chromaKey?.similarity).toBe(40)
      expect(clip?.chromaKey?.smoothness).toBe(20)
      expect(clip?.chromaKey?.spill).toBe(60)

      // Undo restores original state without chromaKey
      const undone = undo(applied.state)
      const undoneClip = undone.editorModel.timelines[0].clips.find(c => c.id === 'clip-1')
      expect(undoneClip?.chromaKey).toBeUndefined()
    })
  })

  describe('KE-503: Blend Mode (set_blend_mode)', () => {
    it('validates set_blend_mode rejecting non-existent clip', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_blend_mode' as const,
            clipId: 'non-existent',
            blendMode: 'screen' as const,
          },
        ],
      }
      const validation = validateEditPatch(state, patch)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.error).toContain('non-existent')
      }
    })

    it('generates human-readable English description for set_blend_mode', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_blend_mode' as const,
            clipId: 'clip-1',
            blendMode: 'multiply' as const,
          },
        ],
      }
      const desc = describePatch(state, patch)
      expect(desc).toContain('set blend mode multiply for clip "clip-1"')
    })

    it('applies set_blend_mode and undoes atomically', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'set_blend_mode' as const,
            clipId: 'clip-1',
            blendMode: 'overlay' as const,
          },
        ],
      }

      const applied = applyPatch(state, patch)
      expect(applied.success).toBe(true)
      if (!applied.success) return

      const clip = applied.state.editorModel.timelines[0].clips.find(c => c.id === 'clip-1')
      expect(clip?.blendMode).toBe('overlay')

      // Undo restores original state
      const undone = undo(applied.state)
      const undoneClip = undone.editorModel.timelines[0].clips.find(c => c.id === 'clip-1')
      expect(undoneClip?.blendMode).toBe('normal')
    })

    it('applies add_text with preset and animation, and applies apply_text_preset / apply_text_animation', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'add_text' as const,
            text: 'Original Title',
            startTime: 1,
            preset: 'cinematic-gold',
            animation: 'fly-in',
          },
        ],
      }

      const res = applyPatch(state, patch)
      expect(res.success).toBe(true)
      if (!res.success) return

      const addedClip = res.state.editorModel.timelines[0].clips.find(c => c.type === 'text')
      expect(addedClip).toBeDefined()
      expect(addedClip?.textStyle?.text).toBe('Original Title')
      expect(addedClip?.textStyle?.color).toBe('#F59E0B') // Gold
      expect(addedClip?.keyframes?.some(k => k.property === 'transform.positionY')).toBe(true)

      // Now apply a different preset and animation via patch
      const patch2 = {
        version: 1 as const,
        operations: [
          {
            op: 'apply_text_preset' as const,
            clipId: addedClip!.id,
            preset: 'neon-cyan',
          },
          {
            op: 'apply_text_animation' as const,
            clipId: addedClip!.id,
            animation: 'typewriter',
          },
        ],
      }

      const res2 = applyPatch(res.state, patch2)
      expect(res2.success).toBe(true)
      if (!res2.success) return

      const updatedClip = res2.state.editorModel.timelines[0].clips.find(c => c.id === addedClip!.id)
      expect(updatedClip?.textStyle?.text).toBe('Original Title') // Preserved!
      expect(updatedClip?.textStyle?.color).toBe('#38BDF8') // Neon Cyan
      expect(updatedClip?.keyframes?.some(k => k.property === 'text.progress')).toBe(true)
    })
  })

  describe('KE-702 · Thao tác add_sticker trên Edit Patch', () => {
    it('validates add_sticker operation and rejects locked tracks', () => {
      const state = createTestState()
      const validPatch = {
        version: 1 as const,
        operations: [
          {
            op: 'add_sticker' as const,
            stickerId: 'star',
            startTime: 2,
            duration: 3,
            scale: 50,
          },
        ],
      }
      expect(validateEditPatch(state, validPatch).valid).toBe(true)

      const lockedTrackPatch = {
        version: 1 as const,
        operations: [
          {
            op: 'add_sticker' as const,
            stickerId: 'star',
            trackIndex: 1, // V2 is locked in createTestState
          },
        ],
      }
      const lockedRes = validateEditPatch(state, lockedTrackPatch)
      expect(lockedRes.valid).toBe(false)
      if (!lockedRes.valid) {
        expect(lockedRes.error).toContain('locked track #1')
      }
    })

    it('describes add_sticker operations accurately in describePatch', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'add_sticker' as const,
            stickerId: 'star',
          },
          {
            op: 'add_sticker' as const,
            stickerId: 'fire',
          },
        ],
      }
      const desc = describePatch(state, patch)
      expect(desc).toContain('add 2 stickers')
      expect(desc).toContain('Gold Star')
      expect(desc).toContain('Hot Fire')
    })

    it('applies add_sticker patch, adds image clip on overlay track, and supports undo', () => {
      const state = createTestState()
      const patch = {
        version: 1 as const,
        operations: [
          {
            op: 'add_sticker' as const,
            stickerId: 'sparkles',
            startTime: 3.5,
            duration: 4,
            scale: 45,
            positionX: 20,
            positionY: -10,
          },
        ],
      }

      const res = applyPatch(state, patch)
      expect(res.success).toBe(true)
      if (!res.success) return

      const clips = res.state.editorModel.timelines[0].clips
      const stickerClip = clips.find(c => c.stickerId === 'sparkles')
      expect(stickerClip).toBeDefined()
      expect(stickerClip?.type).toBe('image')
      expect(stickerClip?.startTime).toBe(3.5)
      expect(stickerClip?.duration).toBe(4)
      expect(stickerClip?.transform.scale).toBe(45)
      expect(stickerClip?.transform.positionX).toBe(20)
      expect(stickerClip?.transform.positionY).toBe(-10)

      // Test undo
      const undone = undo(res.state)
      const undoneClips = undone.editorModel.timelines[0].clips
      expect(undoneClips.some(c => c.stickerId === 'sparkles')).toBe(false)
    })
  })
})


