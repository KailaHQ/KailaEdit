import type { EditorState } from '../editor-state'
import { selectClips, selectActiveTimeline } from '../editor-selectors'
import {
  deleteClips,
  splitClipsAtTime,
  moveClips,
  slipClip,
  slideClip,
  updateClip,
  insertAssetsToTimeline,
  addSubtitle,
  importSrtCues,
  addTextClip,
  addSubtitleTrack,
  replaceActiveTimeline,
  setClipFilter,
  removeClipFilter,
  addFilterClip,
  detachAudio,
  setKeyframe,
  setKeyframePoints,
  removeKeyframeAt,
  clearKeyframes,
  setAudioFade,
  normalizeClipAudio,
  duckClipAudio,
  setTimelineSettings,
  setTimelineBackground,
  setClipMask,
  setClipChromaKey,
  setClipAutoMatte,
  setClipCustomMatte,
  setClipStabilization,
  replaceClipMedia,
  setClipStroke,
  setClipBlendMode,
  applyTextPresetToClip,
  applyTextAnimationToClip,
  addStickerClip,
  addSfxClip,
  addMarker,
  deleteMarker,
  updateMarker,
  freezeFrame,
  punchInClip,
  punchInSequence,
  createHighlightShort,
  applyTemplateAsTimeline,
  insertBrollClip,
  duplicateTimeline,
  deleteTimeline,
  switchActiveTimeline,
  setTimelineVariantInfo,
  setTimelineCover,
} from '../editor-actions'
import { applySubtitlePreset } from '../text-presets'
import { makeId } from '../id-generator'
import { DEFAULT_TRANSITION_DURATION } from '../transitions'
import {
  findTransitionAtCut,
  removeTransitionById,
  setTransitionAtCut,
} from '../timeline-transitions'
import { parseSrt, chunkSrtCues, type SrtCue } from '../srt'
import { beginTransaction, commitTransaction } from '../transaction'
import type { EditPatch, EditPatchOperation, PatchApplyResult } from './patch-schema'
import { validateEditPatch } from './patch-validator'
import { describePatch } from './patch-describer'

/**
 * Merge a partial clip patch, one level deep.
 *
 * `updateClip` spreads shallowly, which is right for the UI (callers there pass
 * whole nested objects) but destructive here: an agent patching
 * `textStyle: { text }` replaced the entire style object and wiped font, colour,
 * position and the other 20 fields. Nested plain objects are merged instead.
 */
export function mergeClipPatch(
  clip: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

  // Auto-normalize text overlay patches: agents frequently pass `text: "..."`
  // directly for a text clip instead of nesting inside `textStyle: { text: "..." }`.
  let effectivePatch = patch
  if (clip.type === 'text' && typeof patch.text === 'string') {
    const patchTextStyle = isPlainObject(patch.textStyle) ? patch.textStyle : {}
    effectivePatch = {
      ...patch,
      textStyle: {
        ...patchTextStyle,
        text: patchTextStyle.text ?? patch.text,
      },
    }
    delete (effectivePatch as Record<string, unknown>).text
  }

  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(effectivePatch)) {
    const existing = clip[key]
    merged[key] = isPlainObject(value) && isPlainObject(existing)
      ? { ...existing, ...value }
      : value
  }
  return merged
}

export function applyCutRange(state: EditorState, startTime: number, endTime: number): EditorState {
  const clips = selectClips(state)
  // Find clips overlapping [startTime, endTime]
  const overlapping = clips.filter(c => c.startTime < endTime && c.startTime + c.duration > startTime)
  if (overlapping.length === 0) return state

  let current = state

  // Step 1: Split at endTime first (downstream)
  const splitAtEnd = overlapping.filter(
    c => c.startTime < endTime && c.startTime + c.duration > endTime,
  )
  for (const c of splitAtEnd) {
    current = splitClipsAtTime(current, [c.id], endTime)
  }

  // Step 2: Split at startTime (upstream)
  const clipsAfterEndSplit = selectClips(current)
  const splitAtStart = clipsAfterEndSplit.filter(
    c => c.startTime < startTime && c.startTime + c.duration > startTime,
  )
  for (const c of splitAtStart) {
    current = splitClipsAtTime(current, [c.id], startTime)
  }

  // Step 3: Delete clips fully within [startTime, endTime]
  const clipsAfterSplits = selectClips(current)
  const clipsToDelete = clipsAfterSplits.filter(
    c => c.startTime >= startTime - 0.01 && c.startTime + c.duration <= endTime + 0.01,
  )

  if (clipsToDelete.length > 0) {
    current = deleteClips(current, clipsToDelete.map(c => c.id))
  }

  return current
}

export function executePatchOperations(state: EditorState, operations: EditPatchOperation[]): EditorState {
  let current = state

  const cutOps = operations.filter((op): op is Extract<EditPatchOperation, { op: 'cut_range' }> => op.op === 'cut_range')
  const nonCutOps = operations.filter(op => op.op !== 'cut_range')

  // 1. Execute cut ranges descending by startTime to avoid timestamp shifts in upstream cuts
  const sortedCutOps = [...cutOps].sort((a, b) => b.startTime - a.startTime)
  for (const cutOp of sortedCutOps) {
    current = applyCutRange(current, cutOp.startTime, cutOp.endTime)
  }

  // 2. Execute non-cut operations in sequence
  for (const op of nonCutOps) {
    switch (op.op) {
      case 'split_clip':
        current = splitClipsAtTime(current, [op.clipId], op.splitTime)
        break
      case 'delete_clips':
        current = deleteClips(current, op.clipIds)
        break
      case 'delete_clip':
        current = deleteClips(current, [op.clipId])
        break
      case 'move_clip':
        current = moveClips(current, { clipIds: [op.clipId], deltaTime: op.deltaTime })
        break
      case 'slip_clip':
        current = slipClip(current, { clipId: op.clipId, deltaTime: op.delta })
        break
      case 'slide_clip':
        current = slideClip(current, { clipId: op.clipId, deltaTime: op.delta })
        break
      case 'update_clip': {
        const timeline = selectActiveTimeline(current)
        const target = timeline?.clips.find(clip => clip.id === op.clipId)
        if (!target) {
          throw new Error(`Clip "${op.clipId}" does not exist on timeline`)
        }
        const merged = mergeClipPatch(target as unknown as Record<string, unknown>, op.patch)
        current = updateClip(current, op.clipId, merged as never)
        break
      }
      case 'insert_clip': {
        const baseAsset = current.editorModel.assets.find(a => a.id === op.assetId)
        if (!baseAsset) {
          throw new Error(`Asset ID "${op.assetId}" does not exist in project assets`)
        }
        const assetToInsert = op.duration !== undefined ? { ...baseAsset, duration: op.duration } : baseAsset
        current = insertAssetsToTimeline(current, {
          assets: [assetToInsert],
          trackIndex: op.trackIndex,
          startTime: op.startTime,
        })
        break
      }
      case 'add_subtitle': {
        const activeTl = current.editorModel.timelines.find(t => t.id === current.editorModel.activeTimelineId)
        let subTrackIdx = op.trackIndex
        if (subTrackIdx === undefined) {
          const found = activeTl?.tracks.findIndex(t => t.type === 'subtitle') ?? -1
          subTrackIdx = found >= 0 ? found : 0
        }
        let styleOverride = op.style as any
        if (op.preset) {
          styleOverride = applySubtitlePreset(styleOverride, op.preset)
        }
        current = addSubtitle(current, {
          text: op.text,
          startTime: op.startTime,
          endTime: op.endTime,
          trackIndex: subTrackIdx,
          style: styleOverride,
        })
        break
      }
      case 'import_srt': {
        let cues = parseSrt(op.content)
        if (op.chunk) {
          cues = chunkSrtCues(cues, {
            minWords: op.minWords,
            maxWords: op.maxWords,
            maxChars: op.maxChars,
          })
        }
        let styleOverride: any
        if (op.preset) {
          styleOverride = applySubtitlePreset({}, op.preset)
        }
        current = importSrtCues(current, cues, {
          targetTrackIndex: op.targetTrackIndex,
          style: styleOverride,
        })
        break
      }
      case 'chunk_subtitles': {
        const activeTl = current.editorModel.timelines.find(t => t.id === current.editorModel.activeTimelineId)
        if (!activeTl) break
        const existingSubs = activeTl.subtitles || []
        if (existingSubs.length === 0) break

        let targetTrackIdx = op.trackIndex
        if (targetTrackIdx === undefined) {
          const found = activeTl.tracks.findIndex(t => t.type === 'subtitle')
          targetTrackIdx = found >= 0 ? found : (existingSubs.length > 0 ? existingSubs[0].trackIndex : 0)
        }

        const subsOnTrack = existingSubs.filter(s => s.trackIndex === targetTrackIdx)
        if (subsOnTrack.length === 0) break

        const srtCues: SrtCue[] = subsOnTrack.map((s, idx) => ({
          index: idx + 1,
          startTime: s.startTime,
          endTime: s.endTime,
          text: s.text,
        }))

        const chunked = chunkSrtCues(srtCues, {
          minWords: op.minWords,
          maxWords: op.maxWords,
          maxChars: op.maxChars,
        })

        let styleOverride: any
        if (op.preset) {
          styleOverride = applySubtitlePreset({}, op.preset)
        }

        current = importSrtCues(current, chunked, {
          targetTrackIndex: targetTrackIdx,
          style: styleOverride,
        })
        break
      }
      case 'add_text': {
        current = addTextClip(current, {
          style: {
            text: op.text,
            ...(op.style as any || {}),
          },
          startTime: op.startTime,
          duration: op.duration,
          trackIndex: op.trackIndex,
          preset: op.preset,
          animation: op.animation,
        })
        break
      }
      case 'apply_text_preset': {
        current = applyTextPresetToClip(current, op.clipId, op.preset)
        break
      }
      case 'apply_text_animation': {
        current = applyTextAnimationToClip(current, op.clipId, op.animation)
        break
      }
      case 'add_sticker': {
        current = addStickerClip(current, {
          stickerId: op.stickerId,
          startTime: op.startTime,
          duration: op.duration,
          trackIndex: op.trackIndex,
          scale: op.scale,
          positionX: op.positionX,
          positionY: op.positionY,
          rotation: op.rotation,
          opacity: op.opacity,
        })
        break
      }
      case 'add_sfx': {
        current = addSfxClip(current, {
          sfxId: op.sfxId,
          startTime: op.startTime,
          duration: op.duration,
          trackIndex: op.trackIndex,
          volume: op.volume,
        })
        break
      }
      case 'set_transition': {
        const timeline = selectActiveTimeline(current)
        if (!timeline) break
        const result = setTransitionAtCut(
          timeline,
          op.leftClipId,
          op.rightClipId,
          op.type,
          op.duration ?? DEFAULT_TRANSITION_DURATION,
          () => makeId('transition'),
        )
        // Validation already rejected the impossible cases; anything left is a
        // race with an earlier operation in the same patch, and skipping beats
        // writing a half-applied overlap.
        if (result.ok) current = replaceActiveTimeline(current, () => result.timeline)
        break
      }
      case 'remove_transition': {
        const timeline = selectActiveTimeline(current)
        if (!timeline) break
        const existing = findTransitionAtCut(timeline, op.leftClipId, op.rightClipId)
        if (existing) {
          current = replaceActiveTimeline(current, current => removeTransitionById(current, existing.id))
        }
        break
      }
      case 'add_subtitle_track': {
        current = addSubtitleTrack(current)
        break
      }
      case 'set_filter': {
        current = setClipFilter(current, op.clipId, op.filterId, op.intensity)
        break
      }
      case 'remove_filter': {
        current = removeClipFilter(current, op.clipId)
        break
      }
      case 'add_filter_clip': {
        current = addFilterClip(current, {
          filterId: op.filterId,
          intensity: op.intensity,
          startTime: op.startTime,
          duration: op.duration,
          trackIndex: op.trackIndex,
        })
        break
      }
      case 'detach_audio': {
        current = detachAudio(current, op.clipId)
        break
      }
      case 'set_keyframe': {
        current = setKeyframe(current, op.clipId, op.property, op.t, op.value, op.easing)
        break
      }
      case 'set_keyframes': {
        const points = op.points.map(p => ({
          t: p.t,
          value: p.value,
          easing: p.easing ?? 'linear',
        }))
        current = setKeyframePoints(current, op.clipId, op.property, points)
        break
      }
      case 'remove_keyframe': {
        current = removeKeyframeAt(current, op.clipId, op.property, op.t)
        break
      }
      case 'clear_keyframes': {
        current = clearKeyframes(current, op.clipId, op.property)
        break
      }
      case 'set_audio_fade': {
        current = setAudioFade(current, op.clipId, op.fadeIn, op.fadeOut)
        break
      }
      case 'normalize_audio': {
        current = normalizeClipAudio(current, op.clipId, op.targetLufs, op.currentLufs, op.gainDb)
        break
      }
      case 'duck_audio': {
        current = duckClipAudio(current, op.musicClipId, op.speechIntervals, {
          duckingDb: op.duckingDb,
          attack: op.attack,
          release: op.release,
        })
        break
      }
      case 'set_timeline_dimensions': {
        const targetTimelineId = op.timelineId || current.editorModel.activeTimelineId
        if (targetTimelineId) {
          current = setTimelineSettings(current, targetTimelineId, {
            width: op.width,
            height: op.height,
            fps: op.fps,
          })
        }
        break
      }
      case 'set_timeline_background': {
        const targetTimelineId = op.timelineId || current.editorModel.activeTimelineId
        if (targetTimelineId) {
          current = setTimelineBackground(current, targetTimelineId, op.background)
        }
        break
      }
      case 'set_cover': {
        current = setTimelineCover(current, op.cover)
        break
      }
      case 'set_canvas': {
        const targetTimelineId = op.timelineId || current.editorModel.activeTimelineId
        if (targetTimelineId) {
          current = setTimelineSettings(current, targetTimelineId, {
            width: op.width,
            height: op.height,
            fps: op.fps,
            background: op.background,
          })
        }
        break
      }
      case 'set_mask': {
        current = setClipMask(current, op.clipId, op.mask ?? null)
        break
      }
      case 'set_chroma_key': {
        current = setClipChromaKey(current, op.clipId, op.chromaKey ?? null)
        break
      }
      case 'set_auto_matte': {
        current = setClipAutoMatte(current, op.clipId, op.autoMatte ?? null)
        break
      }
      case 'set_custom_matte': {
        current = setClipCustomMatte(current, op.clipId, op.customMatte ?? null)
        break
      }
      case 'replace_clip': {
        current = replaceClipMedia(current, op.clipId, op.assetId, op.sourceStart ?? 0)
        break
      }
      case 'set_stabilization': {
        current = setClipStabilization(current, op.clipId, op.stabilization ?? null)
        break
      }
      case 'set_stroke': {
        current = setClipStroke(current, op.clipId, op.stroke ?? null)
        break
      }
      case 'set_blend_mode': {
        current = setClipBlendMode(current, op.clipId, op.blendMode)
        break
      }
      case 'add_marker': {
        current = addMarker(current, {
          time: op.time,
          label: op.label,
          color: op.color,
          id: op.id,
        })
        break
      }
      case 'delete_marker': {
        current = deleteMarker(current, op.markerId)
        break
      }
      case 'update_marker': {
        current = updateMarker(current, op.markerId, {
          ...(op.time !== undefined ? { time: op.time } : {}),
          ...(op.label !== undefined ? { label: op.label } : {}),
          ...(op.color !== undefined ? { color: op.color } : {}),
        })
        break
      }
      case 'freeze_frame': {
        const timeline = selectActiveTimeline(current)
        const targetClip = timeline?.clips.find(c => c.id === op.clipId)
        if (!targetClip) {
          throw new Error(`Clip "${op.clipId}" does not exist on timeline`)
        }

        let asset = current.editorModel.assets.find(a => a.id === op.imageAssetId)
        if (!asset && op.imagePath) {
          asset = current.editorModel.assets.find(a => a.path === op.imagePath)
        }
        if (!asset) {
          // Create or mock image asset for freeze frame
          const assetId = op.imageAssetId || makeId('asset')
          const assetPath = op.imagePath || targetClip.asset?.path || `freeze_${targetClip.id}.jpg`
          asset = {
            id: assetId,
            type: 'image',
            path: assetPath,
            prompt: `Freeze frame of clip ${targetClip.id}`,
            resolution: targetClip.asset?.resolution || '1920x1080',
            duration: op.duration ?? 2.0,
            createdAt: Date.now(),
          }
        }

        current = freezeFrame(current, {
          clipId: op.clipId,
          time: op.time,
          duration: op.duration ?? 2.0,
          imageAsset: asset,
        })
        break
      }
      case 'punch_in_cut': {
        current = punchInClip(current, op.clipId, {
          scale: op.scale,
          positionX: op.positionX,
          positionY: op.positionY,
        })
        break
      }
      case 'punch_in_sequence': {
        current = punchInSequence(current, {
          trackIndex: op.trackIndex,
          scale: op.scale,
          startWithZoom: op.startWithZoom,
        })
        break
      }
      case 'create_highlight_short': {
        current = createHighlightShort(current, {
          sourceClipId: op.sourceClipId,
          startTime: op.startTime,
          endTime: op.endTime,
          hookText: op.hookText,
          hookPreset: op.hookPreset,
          hookDuration: op.hookDuration,
          targetDimensions: op.targetDimensions,
        })
        break
      }
      case 'insert_broll': {
        current = insertBrollClip(current, {
          assetId: op.assetId,
          assetPath: op.assetPath,
          startTime: op.startTime,
          duration: op.duration,
          trackIndex: op.trackIndex,
          fadeIn: op.fadeIn,
          fadeOut: op.fadeOut,
          muteAudio: op.muteAudio,
        })
        break
      }
      case 'duplicate_timeline': {
        const targetId = op.timelineId || current.editorModel.activeTimelineId || current.editorModel.timelines[0]?.id
        if (targetId) {
          current = duplicateTimeline(current, targetId, op.name, op.variantTag)
        }
        break
      }
      case 'switch_timeline': {
        current = switchActiveTimeline(current, op.timelineId)
        break
      }
      case 'delete_timeline': {
        current = deleteTimeline(current, op.timelineId)
        break
      }
      case 'set_timeline_variant': {
        const targetId = op.timelineId || current.editorModel.activeTimelineId || current.editorModel.timelines[0]?.id
        if (targetId) {
          current = setTimelineVariantInfo(current, targetId, {
            name: op.name,
            variantTag: op.variantTag,
            description: op.description,
          })
        }
        break
      }
      case 'apply_template': {
        current = applyTemplateAsTimeline(current, {
          template: op.template,
          bindings: op.bindings,
          name: op.name,
          variantTag: op.variantTag,
        })
        break
      }
    }
  }
  return current
}

/**
 * Applies an EditPatch to the EditorState inside an atomic transaction.
 *
 * If the patch is invalid or execution fails validation, state remains unchanged
 * and an error is returned.
 * If successful, exactly ONE undo step is created.
 */
export function applyPatch(state: EditorState, rawPatch: unknown): PatchApplyResult {
  const validation = validateEditPatch(state, rawPatch)
  if (!validation.valid) {
    return {
      success: false,
      state,
      error: validation.error,
    }
  }

  const patch = validation.data
  const description = describePatch(state, patch)

  // Begin transaction
  const tx = beginTransaction(state)

  try {
    const modifiedTx = executePatchOperations(tx, patch.operations)
    const commitResult = commitTransaction(modifiedTx)

    if (!commitResult.success) {
      return {
        success: false,
        state: commitResult.state,
        error: commitResult.error,
        validationErrors: commitResult.validationErrors,
      }
    }

    return {
      success: true,
      state: commitResult.state,
      description,
      appliedCount: patch.operations.length,
    }
  } catch (err) {
    return {
      success: false,
      state,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Applies an EditPatch directly to EditorState and returns the updated state.
 * Throws an Error if the patch is invalid or violates timeline invariants.
 */
export function applyEditPatchToState(state: EditorState, patch: EditPatch): EditorState {
  const result = applyPatch(state, patch)
  if (!result.success) {
    throw new Error(result.error || 'Failed to apply edit patch')
  }
  return result.state
}
