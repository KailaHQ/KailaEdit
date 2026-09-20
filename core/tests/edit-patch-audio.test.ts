import { describe, expect, it } from 'vitest'
import {
  validateEditPatch,
  describePatch,
  applyPatch,
  undo,
  selectClips,
  getAudioFadeDurations,
  type EditPatch,
} from '../src'
import { makeTestState } from './edit-patch-test-helpers'

describe('Edit Patch: Audio Operations', () => {
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

  })
})
