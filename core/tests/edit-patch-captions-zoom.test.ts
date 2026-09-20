import { describe, expect, it } from 'vitest'
import {
  validateEditPatch,
  describePatch,
  applyPatch,
  selectClips,
  selectSubtitles,
  type EditPatch,
} from '../src'
import { makeTestState } from './edit-patch-test-helpers'

describe('Edit Patch: Captions and Dynamic Zoom', () => {
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

})
