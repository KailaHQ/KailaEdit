import type { EditorState } from '../editor-state'
import { selectActiveTimeline } from '../editor-selectors'
import { getTransitionDefinition } from '../transitions'
import { resolveCut } from '../timeline-transitions'
import { getFilterDefinition } from '../filters'
import { getTextPreset, getTextAnimation, getSubtitlePreset } from '../text-presets'
import { parseSrt } from '../srt'
import { replaceClipRefusal, replacementSourceSpan } from '../clip-replace'
import { editPatchSchema, type PatchValidationResult } from './patch-schema'

/**
 * Validates an EditPatch syntactically (zod) and semantically against the state.
 */
export function validateEditPatch(state: EditorState, rawPatch: unknown): PatchValidationResult {
  const parseResult = editPatchSchema.safeParse(rawPatch)
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    const path = firstIssue.path.join('.')
    return {
      valid: false,
      error: `Patch schema validation failed: [${path}] ${firstIssue.message}`,
      issues: parseResult.error.issues,
    }
  }

  const patch = parseResult.data
  const activeTimeline = selectActiveTimeline(state)
  if (!activeTimeline) {
    return { valid: false, error: 'No active timeline found in editor state' }
  }

  const clipMap = new Map(activeTimeline.clips.map(c => [c.id, c]))
  const trackMap = new Map(activeTimeline.tracks.map((t, idx) => [idx, t]))

  // Semantic check: all referenced clipIds must exist and not be on locked tracks
  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]
    if ('clipId' in op && op.clipId) {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'cut_range') {
      const activeClips = activeTimeline.clips || []
      const timelineDuration = activeClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
      if (activeClips.length > 0 && op.startTime <= 0.05 && op.endTime >= timelineDuration - 0.05) {
        return {
          valid: false,
          error: `Operation #${i + 1} (cut_range): Cut range [${op.startTime}, ${op.endTime}] covers the entire timeline (${timelineDuration.toFixed(2)}s). This operation would wipe out the entire video and was rejected for safety.`,
        }
      }
    }
    if (op.op === 'delete_marker' || op.op === 'update_marker') {
      const markerExists = (activeTimeline.markers || []).some(m => m.id === op.markerId)
      if (!markerExists) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Marker ID "${op.markerId}" does not exist in active timeline`,
        }
      }
    }
    if (op.op === 'set_transition' || op.op === 'remove_transition') {
      // A transition names two clips and a junction; every way that can be
      // wrong is worth saying out loud, because the agent's next move depends
      // on which one it was — a missing clip means it read a stale timeline,
      // a gap means it should close the gap first.
      for (const id of [op.leftClipId, op.rightClipId]) {
        const clip = clipMap.get(id)
        if (!clip) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Clip ID "${id}" does not exist in active timeline`,
          }
        }
        if (trackMap.get(clip.trackIndex)?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot modify clip "${id}" on locked track #${clip.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'set_transition') {
      if (!getTransitionDefinition(op.type)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_transition): Unknown transition type "${op.type}"`,
        }
      }
      const cut = resolveCut(activeTimeline, op.leftClipId, op.rightClipId)
      if (!cut.ok) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_transition): ${cut.reason}`,
        }
      }
    }
    if (op.op === 'set_filter' || op.op === 'add_filter_clip') {
      if (!getFilterDefinition(op.filterId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Unknown filter ID "${op.filterId}"`,
        }
      }
    }
    if (op.op === 'detach_audio') {
      const clip = clipMap.get(op.clipId)
      if (clip && clip.type !== 'video') {
        return {
          valid: false,
          error: `Operation #${i + 1} (detach_audio): Clip "${op.clipId}" is not a video clip (type is "${clip.type}")`,
        }
      }
      if (clip && (clip.linkedClipIds ?? []).some(id => clipMap.get(id)?.type === 'audio')) {
        return {
          valid: false,
          error: `Operation #${i + 1} (detach_audio): Clip "${op.clipId}" already has a linked audio clip`,
        }
      }
    }
    if ((op.op === 'set_keyframe' || op.op === 'set_keyframes') && op.property === 'speed') {
      return {
        valid: false,
        error: `Operation #${i + 1} (${op.op}): Speed is no longer keyframed. Use set_speed_curve with a preset or curve points instead`,
      }
    }
    if (op.op === 'set_speed_curve') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return { valid: false, error: `Operation #${i + 1} (set_speed_curve): Clip "${op.clipId}" does not exist` }
      }
      if (clip.type !== 'video' && clip.type !== 'audio') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_speed_curve): Clip "${op.clipId}" is a ${clip.type} clip; only video and audio clips have a speed curve`,
        }
      }
      if (!op.points && !op.preset) {
        return { valid: false, error: `Operation #${i + 1} (set_speed_curve): Give a preset or curve points` }
      }
    }
    if (op.op === 'set_keyframe' || op.op === 'remove_keyframe') {
      const clip = clipMap.get(op.clipId)
      if (clip && op.t > clip.duration + 0.05) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Time ${op.t} exceeds clip duration (${clip.duration})`,
        }
      }
      if (clip && op.property === 'volume' && clip.type !== 'audio' && clip.type !== 'video') {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Cannot keyframe volume on non-audio clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      if (clip && op.property === 'filter.intensity' && !clip.filter) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Clip "${op.clipId}" has no filter applied to keyframe`,
        }
      }
      if (op.op === 'set_keyframe') {
        if (op.property === 'opacity' && (op.value < 0 || op.value > 100)) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframe): Opacity value ${op.value} is out of range [0, 100]`,
          }
        }
        if (op.property === 'filter.intensity' && (op.value < 0 || op.value > 100)) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframe): Filter intensity ${op.value} is out of range [0, 100]`,
          }
        }
        if (op.property === 'volume' && op.value < 0) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframe): Volume value ${op.value} must be non-negative`,
          }
        }
        if (op.property === 'transform.scale' && op.value < 0) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframe): Scale value ${op.value} must be non-negative`,
          }
        }
      }
    }
    if (op.op === 'set_keyframes') {
      const clip = clipMap.get(op.clipId)
      if (clip) {
        for (const p of op.points) {
          if (p.t > clip.duration + 0.05) {
            return {
              valid: false,
              error: `Operation #${i + 1} (set_keyframes): Time ${p.t} exceeds clip duration (${clip.duration})`,
            }
          }
          if (op.property === 'opacity' && (p.value < 0 || p.value > 100)) {
            return {
              valid: false,
              error: `Operation #${i + 1} (set_keyframes): Opacity value ${p.value} is out of range [0, 100]`,
            }
          }
          if (op.property === 'filter.intensity' && (p.value < 0 || p.value > 100)) {
            return {
              valid: false,
              error: `Operation #${i + 1} (set_keyframes): Filter intensity ${p.value} is out of range [0, 100]`,
            }
          }
          if (op.property === 'volume' && p.value < 0) {
            return {
              valid: false,
              error: `Operation #${i + 1} (set_keyframes): Volume value ${p.value} must be non-negative`,
            }
          }
          if (op.property === 'transform.scale' && p.value < 0) {
            return {
              valid: false,
              error: `Operation #${i + 1} (set_keyframes): Scale value ${p.value} must be non-negative`,
            }
          }
        }
        if (op.property === 'volume' && clip.type !== 'audio' && clip.type !== 'video') {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframes): Cannot keyframe volume on non-audio clip "${op.clipId}" (type: ${clip.type})`,
          }
        }
        if (op.property === 'filter.intensity' && !clip.filter) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_keyframes): Clip "${op.clipId}" has no filter applied to keyframe`,
          }
        }
      }
    }
    if (op.op === 'set_audio_fade') {
      const clip = clipMap.get(op.clipId)
      if (clip) {
        if (clip.type !== 'audio' && clip.type !== 'video') {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_audio_fade): Cannot apply audio fade to non-audio clip "${op.clipId}" (type: ${clip.type})`,
          }
        }
        const fadeIn = op.fadeIn ?? 0
        const fadeOut = op.fadeOut ?? 0
        if (fadeIn > clip.duration + 0.01) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_audio_fade): Fade in duration (${fadeIn}s) exceeds clip duration (${clip.duration}s)`,
          }
        }
        if (fadeOut > clip.duration + 0.01) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_audio_fade): Fade out duration (${fadeOut}s) exceeds clip duration (${clip.duration}s)`,
          }
        }
        if (fadeIn + fadeOut > clip.duration + 0.01) {
          return {
            valid: false,
            error: `Operation #${i + 1} (set_audio_fade): Total fade duration (${fadeIn + fadeOut}s) exceeds clip duration (${clip.duration}s)`,
          }
        }
      }
    }
    if (op.op === 'normalize_audio') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (normalize_audio): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'audio' && clip.type !== 'video') {
        return {
          valid: false,
          error: `Operation #${i + 1} (normalize_audio): Cannot normalize non-audio clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (normalize_audio): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'duck_audio') {
      const clip = clipMap.get(op.musicClipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (duck_audio): Music clip ID "${op.musicClipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'audio' && clip.type !== 'video') {
        return {
          valid: false,
          error: `Operation #${i + 1} (duck_audio): Cannot duck non-audio clip "${op.musicClipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (duck_audio): Cannot modify clip "${op.musicClipId}" on locked track #${clip.trackIndex}`,
        }
      }
      for (const seg of op.speechIntervals) {
        if (seg.end < seg.start) {
          return {
            valid: false,
            error: `Operation #${i + 1} (duck_audio): Speech interval end (${seg.end}) cannot be less than start (${seg.start})`,
          }
        }
      }
    }
    if ('clipIds' in op && Array.isArray(op.clipIds)) {
      for (const id of op.clipIds) {
        const clip = clipMap.get(id)
        if (!clip) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Clip ID "${id}" does not exist in active timeline`,
          }
        }
        const track = trackMap.get(clip.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot modify clip "${id}" on locked track #${clip.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'cut_range') {
      const overlappingLocked = activeTimeline.clips.filter(
        c => c.startTime < op.endTime && c.startTime + c.duration > op.startTime && trackMap.get(c.trackIndex)?.locked
      )
      if (overlappingLocked.length > 0) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Range [${op.startTime}, ${op.endTime}] intersects clip "${overlappingLocked[0].id}" on locked track #${overlappingLocked[0].trackIndex}`,
        }
      }
    }
    if (op.op === 'insert_clip') {
      const asset = state.editorModel.assets.find(a => a.id === op.assetId)
      if (!asset) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Asset ID "${op.assetId}" does not exist in project assets`,
        }
      }
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot insert clip onto locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'add_subtitle') {
      if (op.preset && !getSubtitlePreset(op.preset)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Subtitle preset "${op.preset}" does not exist`,
        }
      }
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot add subtitle onto locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'import_srt') {
      const cues = parseSrt(op.content)
      if (cues.length === 0) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): SRT content contains no valid cues`,
        }
      }
      if (op.preset && !getSubtitlePreset(op.preset)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Subtitle preset "${op.preset}" does not exist`,
        }
      }
      if (op.targetTrackIndex !== undefined) {
        if (op.targetTrackIndex < 0 || op.targetTrackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.targetTrackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.targetTrackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot import SRT onto locked track #${op.targetTrackIndex}`,
          }
        }
      }
    }
    if (op.op === 'chunk_subtitles') {
      if (op.preset && !getSubtitlePreset(op.preset)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (${op.op}): Subtitle preset "${op.preset}" does not exist`,
        }
      }
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot chunk subtitles on locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'add_text') {
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot add text onto locked track #${op.trackIndex}`,
          }
        }
      }
      if (op.preset && !getTextPreset(op.preset)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (add_text): Unknown text preset "${op.preset}"`,
        }
      }
      if (op.animation && !getTextAnimation(op.animation)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (add_text): Unknown text animation "${op.animation}"`,
        }
      }
    }
    if (op.op === 'insert_broll') {
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot insert B-roll onto locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'apply_text_preset') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_preset): Clip "${op.clipId}" does not exist`,
        }
      }
      if (clip.type !== 'text') {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_preset): Clip "${op.clipId}" is of type "${clip.type}", expected "text"`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_preset): Cannot modify clip on locked track #${clip.trackIndex}`,
        }
      }
      if (!getTextPreset(op.preset)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_preset): Unknown text preset "${op.preset}"`,
        }
      }
    }
    if (op.op === 'apply_text_animation') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_animation): Clip "${op.clipId}" does not exist`,
        }
      }
      if (clip.type !== 'text') {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_animation): Clip "${op.clipId}" is of type "${clip.type}", expected "text"`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_animation): Cannot modify clip on locked track #${clip.trackIndex}`,
        }
      }
      if (!getTextAnimation(op.animation)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_text_animation): Unknown text animation "${op.animation}"`,
        }
      }
    }
    if (op.op === 'add_sticker') {
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot add sticker onto locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'add_sfx') {
      if (op.trackIndex !== undefined) {
        if (op.trackIndex < 0 || op.trackIndex >= activeTimeline.tracks.length) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Track index #${op.trackIndex} does not exist in timeline`,
          }
        }
        const track = trackMap.get(op.trackIndex)
        if (track?.locked) {
          return {
            valid: false,
            error: `Operation #${i + 1} (${op.op}): Cannot add SFX onto locked track #${op.trackIndex}`,
          }
        }
      }
    }
    if (op.op === 'set_timeline_dimensions') {
      if (op.timelineId && !state.editorModel.timelines.some(t => t.id === op.timelineId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_timeline_dimensions): Timeline ID "${op.timelineId}" does not exist in project`,
        }
      }
    }
    if (op.op === 'set_timeline_background') {
      if (op.timelineId && !state.editorModel.timelines.some(t => t.id === op.timelineId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_timeline_background): Timeline ID "${op.timelineId}" does not exist in project`,
        }
      }
    }
    if (op.op === 'set_canvas') {
      if (op.timelineId && !state.editorModel.timelines.some(t => t.id === op.timelineId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_canvas): Timeline ID "${op.timelineId}" does not exist in project`,
        }
      }
      if (op.width === undefined && op.height === undefined && op.fps === undefined && op.background === undefined) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_canvas): At least one property (width, height, fps, background) must be specified`,
        }
      }
    }
    if (op.op === 'set_mask') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_mask): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_mask): Cannot apply mask to non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_mask): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'set_chroma_key') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_chroma_key): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_chroma_key): Cannot apply chroma key to non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_chroma_key): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'set_auto_matte') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_auto_matte): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_auto_matte): Cannot apply auto matte to non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_auto_matte): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'replace_clip') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (replace_clip): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      const asset = state.editorModel.assets.find(a => a.id === op.assetId)
      if (!asset) {
        return {
          valid: false,
          error: `Operation #${i + 1} (replace_clip): Asset ID "${op.assetId}" is not in the project (see media_list)`,
        }
      }
      const refusal = replaceClipRefusal(clip, asset, activeTimeline.tracks)
      if (refusal) {
        const why: Record<string, string> = {
          'not-replaceable': `clip "${op.clipId}" (type: ${clip.type}) is not a video or image clip — text, stickers, shapes, audio and adjustment layers cannot be replaced`,
          'unsupported-media': `asset "${op.assetId}" is ${asset.type}; only video or image media can replace a clip`,
          'same-media': `clip "${op.clipId}" already shows asset "${op.assetId}"`,
          'too-short': `asset "${op.assetId}" is ${(asset.duration ?? 0).toFixed(2)}s long but the clip plays ${replacementSourceSpan(clip).toFixed(2)}s of media; the clip's length never changes, so the media must be at least that long`,
          locked: `clip "${op.clipId}" is on locked track #${clip.trackIndex}`,
        }
        return { valid: false, error: `Operation #${i + 1} (replace_clip): ${why[refusal]}` }
      }
      if (op.sourceStart !== undefined && asset.type === 'video' && typeof asset.duration === 'number'
        && op.sourceStart + replacementSourceSpan(clip) > asset.duration + 0.02) {
        return {
          valid: false,
          error: `Operation #${i + 1} (replace_clip): starting at ${op.sourceStart}s, the clip would run past the end of the ${asset.duration.toFixed(2)}s media`,
        }
      }
    }
    if (op.op === 'set_stabilization') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stabilization): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      // Only moving footage has camera motion to take out; a still has none.
      if (clip.type !== 'video') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stabilization): Cannot stabilize non-video clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stabilization): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'set_custom_matte') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_custom_matte): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_custom_matte): Cannot apply custom matte to non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_custom_matte): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'set_stroke') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stroke): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stroke): Cannot apply stroke to non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_stroke): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
    }
    if (op.op === 'freeze_frame') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (freeze_frame): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (freeze_frame): Cannot freeze frame on non-video/image clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (freeze_frame): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
      if (op.time !== undefined) {
        if (op.time <= clip.startTime + 0.01 || op.time >= clip.startTime + clip.duration - 0.01) {
          return {
            valid: false,
            error: `Operation #${i + 1} (freeze_frame): Freeze time ${op.time}s is outside clip bounds [${clip.startTime}s, ${clip.startTime + clip.duration}s]`,
          }
        }
      }
    }
    if (op.op === 'punch_in_cut') {
      const clip = clipMap.get(op.clipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_cut): Clip ID "${op.clipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'image') {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_cut): Cannot punch-in non-visual clip "${op.clipId}" (type: ${clip.type})`,
        }
      }
      const track = trackMap.get(clip.trackIndex)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_cut): Cannot modify clip "${op.clipId}" on locked track #${clip.trackIndex}`,
        }
      }
      if (op.scale !== undefined && op.scale <= 0) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_cut): Scale must be positive, got ${op.scale}`,
        }
      }
    }
    if (op.op === 'punch_in_sequence') {
      const targetTrack = op.trackIndex !== undefined ? op.trackIndex : 0
      if (targetTrack < 0 || targetTrack >= activeTimeline.tracks.length) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_sequence): Track index #${targetTrack} does not exist in timeline`,
        }
      }
      const track = trackMap.get(targetTrack)
      if (track?.locked) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_sequence): Cannot apply punch-in sequence on locked track #${targetTrack}`,
        }
      }
      if (op.scale !== undefined && op.scale <= 0) {
        return {
          valid: false,
          error: `Operation #${i + 1} (punch_in_sequence): Scale must be positive, got ${op.scale}`,
        }
      }
    }
    if (op.op === 'create_highlight_short') {
      const clip = clipMap.get(op.sourceClipId)
      if (!clip) {
        return {
          valid: false,
          error: `Operation #${i + 1} (create_highlight_short): Source clip ID "${op.sourceClipId}" does not exist in active timeline`,
        }
      }
      if (clip.type !== 'video' && clip.type !== 'audio') {
        return {
          valid: false,
          error: `Operation #${i + 1} (create_highlight_short): Cannot create highlight from clip "${op.sourceClipId}" of type "${clip.type}"`,
        }
      }
      if (op.startTime < clip.startTime - 0.05 || op.endTime > clip.startTime + clip.duration + 0.05) {
        return {
          valid: false,
          error: `Operation #${i + 1} (create_highlight_short): Highlight range [${op.startTime}s, ${op.endTime}s] exceeds clip bounds [${clip.startTime}s, ${clip.startTime + clip.duration}s]`,
        }
      }
    }
    if (op.op === 'duplicate_timeline') {
      const targetId = op.timelineId || activeTimeline.id
      if (!state.editorModel.timelines.some(t => t.id === targetId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (duplicate_timeline): Timeline ID "${targetId}" does not exist in project`,
        }
      }
    }
    if (op.op === 'apply_template') {
      // A template with no slots is a fixed edit nobody can put footage into.
      // It would apply cleanly and produce a timeline the user cannot use.
      if (op.template.slots.length === 0) {
        return {
          valid: false,
          error: `Operation #${i + 1} (apply_template): Template "${op.template.name}" has no slots to fill`,
        }
      }
      const slotIndexes = new Set(op.template.slots.map(slot => slot.slotIndex))
      for (const binding of op.bindings) {
        if (!slotIndexes.has(binding.slotIndex)) {
          return {
            valid: false,
            error: `Operation #${i + 1} (apply_template): Slot #${binding.slotIndex} does not exist in template "${op.template.name}"`,
          }
        }
        // Bind to an asset this project does not have and the slot silently
        // stays empty, which reads as the template being broken.
        if (!state.editorModel.assets.some(asset => asset.id === binding.assetId)) {
          return {
            valid: false,
            error: `Operation #${i + 1} (apply_template): Asset ID "${binding.assetId}" does not exist in project`,
          }
        }
      }
      // Two clips in one hole: the later binding would win and the first
      // asset would vanish without a word.
      const seen = new Set<number>()
      for (const binding of op.bindings) {
        if (seen.has(binding.slotIndex)) {
          return {
            valid: false,
            error: `Operation #${i + 1} (apply_template): Slot #${binding.slotIndex} is bound more than once`,
          }
        }
        seen.add(binding.slotIndex)
      }
    }
    if (op.op === 'switch_timeline') {
      if (!state.editorModel.timelines.some(t => t.id === op.timelineId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (switch_timeline): Timeline ID "${op.timelineId}" does not exist in project`,
        }
      }
    }
    if (op.op === 'delete_timeline') {
      if (!state.editorModel.timelines.some(t => t.id === op.timelineId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (delete_timeline): Timeline ID "${op.timelineId}" does not exist in project`,
        }
      }
      if (state.editorModel.timelines.length <= 1) {
        return {
          valid: false,
          error: `Operation #${i + 1} (delete_timeline): Cannot delete the only timeline in the project`,
        }
      }
    }
    if (op.op === 'set_timeline_variant') {
      const targetId = op.timelineId || activeTimeline.id
      if (!state.editorModel.timelines.some(t => t.id === targetId)) {
        return {
          valid: false,
          error: `Operation #${i + 1} (set_timeline_variant): Timeline ID "${targetId}" does not exist in project`,
        }
      }
    }
  }

  return { valid: true, data: patch }
}
