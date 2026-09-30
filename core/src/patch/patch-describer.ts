import type { EditorState } from '../editor-state'
import { selectActiveTimeline } from '../editor-selectors'
import { getTextPreset, getTextAnimation } from '../text-presets'
import { getStickerDefinition } from '../stickers'
import { getSfxDefinition } from '../sfx'
import { getFilterDefinition } from '../filters'
import { parseSrt, chunkSrtCues } from '../srt'
import type { EditPatch } from './patch-schema'
import { executePatchOperations } from './patch-executor'

export function formatDurationMmSs(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function getV1Duration(state: EditorState): number {
  const activeTimeline = selectActiveTimeline(state)
  if (!activeTimeline) return 0
  const v1TrackIndex = activeTimeline.tracks.findIndex(
    t => t.name === 'V1' || t.id.includes('v1') || (t.kind === 'video' && t.type !== 'subtitle'),
  )
  const targetIndex = v1TrackIndex >= 0 ? v1TrackIndex : 0
  const v1Clips = activeTimeline.clips.filter(c => c.trackIndex === targetIndex)
  return v1Clips.reduce((sum, c) => sum + c.duration, 0)
}

/**
 * Returns a human-readable semantic diff of the patch intent without modifying state.
 * E.g.: "Xoá 3 đoạn im lặng, tổng 15.0s; V1 rút từ 1:00 còn 0:45"
 */
export function describePatch(state: EditorState, patch: EditPatch): string {
  const v1DurationBefore = getV1Duration(state)

  // Tally operation details
  let cutRangeCount = 0
  let cutRangeTotalSec = 0
  let deleteClipCount = 0
  let splitCount = 0
  let insertClipCount = 0
  let addSubtitleCount = 0
  let importSrtCount = 0
  let srtCuesTotal = 0
  let addTextCount = 0
  let addSubTrackCount = 0
  let setTransitionCount = 0
  let removeTransitionCount = 0
  let setFilterCount = 0
  let removeFilterCount = 0
  let detachAudioCount = 0
  const keyframeDescriptions: string[] = []
  let removeKeyframeCount = 0
  let clearKeyframeCount = 0
  const filterNamesApplied: string[] = []
  const timelineDimensionChanges: string[] = []
  const maskChanges: string[] = []
  const chromaKeyChanges: string[] = []
  const autoMatteChanges: string[] = []
  const stabilizationChanges: string[] = []
  const replaceChanges: string[] = []
  const assetName = (assetId: string) => {
    const asset = state.editorModel.assets.find(a => a.id === assetId)
    const path = asset?.path ?? ''
    return path.split(/[\\/]/).pop() || assetId
  }
  const customMatteChanges: string[] = []
  const strokeChanges: string[] = []
  const blendModeChanges: string[] = []
  let applyTextPresetCount = 0
  let applyTextAnimCount = 0
  const textPresetsApplied: string[] = []
  const textAnimsApplied: string[] = []
  let addStickerCount = 0
  const stickerNamesApplied: string[] = []
  let addSfxCount = 0
  const sfxNamesApplied: string[] = []
  let addMarkerCount = 0
  let deleteMarkerCount = 0
  let updateMarkerCount = 0
  let freezeFrameCount = 0
  let insertBrollCount = 0
  let otherCount = 0
  const updatedFields: string[] = []

  for (const op of patch.operations) {
    if (op.op === 'insert_broll') {
      insertBrollCount++
    } else if (op.op === 'cut_range') {
      cutRangeCount++
      cutRangeTotalSec += op.endTime - op.startTime
    } else if (op.op === 'delete_clips') {
      deleteClipCount += op.clipIds.length
    } else if (op.op === 'delete_clip') {
      deleteClipCount++
    } else if (op.op === 'split_clip') {
      splitCount++
    } else if (op.op === 'insert_clip') {
      insertClipCount++
    } else if (op.op === 'add_subtitle') {
      addSubtitleCount++
    } else if (op.op === 'import_srt') {
      importSrtCount++
      try {
        let cues = parseSrt(op.content)
        if (op.chunk) {
          cues = chunkSrtCues(cues, {
            minWords: op.minWords,
            maxWords: op.maxWords,
            maxChars: op.maxChars,
          })
        }
        srtCuesTotal += cues.length
      } catch {
        // best effort
      }
    } else if (op.op === 'chunk_subtitles') {
      otherCount++
      const presetInfo = op.preset ? ` (preset ${op.preset})` : ''
      keyframeDescriptions.push(`chunk subtitles into 3–5 word phrases${presetInfo}`)
    } else if (op.op === 'add_text') {
      addTextCount++
    } else if (op.op === 'apply_text_preset') {
      applyTextPresetCount++
      const def = getTextPreset(op.preset)
      textPresetsApplied.push(def?.name || op.preset)
    } else if (op.op === 'apply_text_animation') {
      applyTextAnimCount++
      const def = getTextAnimation(op.animation)
      textAnimsApplied.push(def?.name || op.animation)
    } else if (op.op === 'add_sticker') {
      addStickerCount++
      const def = getStickerDefinition(op.stickerId)
      stickerNamesApplied.push(def?.name || op.stickerId)
    } else if (op.op === 'add_sfx') {
      addSfxCount++
      const def = getSfxDefinition(op.sfxId)
      sfxNamesApplied.push(def?.name || op.sfxId)
    } else if (op.op === 'add_subtitle_track') {
      addSubTrackCount++
    } else if (op.op === 'set_transition') {
      setTransitionCount++
    } else if (op.op === 'remove_transition') {
      removeTransitionCount++
    } else if (op.op === 'set_filter' || op.op === 'add_filter_clip') {
      setFilterCount++
      const def = getFilterDefinition(op.filterId)
      const name = def ? def.name : op.filterId
      const intensityStr = op.intensity !== undefined ? ` (${Math.round(op.intensity)}%)` : ''
      filterNamesApplied.push(`${name}${intensityStr}`)
    } else if (op.op === 'remove_filter') {
      removeFilterCount++
    } else if (op.op === 'detach_audio') {
      detachAudioCount++
    } else if (op.op === 'set_keyframe') {
      keyframeDescriptions.push(`set keyframe for ${op.property} at ${op.t.toFixed(1)}s`)
    } else if (op.op === 'set_keyframes') {
      const times = op.points.map(p => p.t)
      const tMin = Math.min(...times)
      const tMax = Math.max(...times)
      const rangeStr = tMin === tMax ? `${tMin.toFixed(1)}s` : `${tMin.toFixed(1)}s – ${tMax.toFixed(1)}s`
      keyframeDescriptions.push(`set ${op.points.length} keyframe points for ${op.property} (${rangeStr})`)
    } else if (op.op === 'remove_keyframe') {
      removeKeyframeCount++
    } else if (op.op === 'clear_keyframes') {
      if (op.property) {
        keyframeDescriptions.push(`clear keyframes for ${op.property}`)
      } else {
        clearKeyframeCount++
      }
    } else if (op.op === 'set_audio_fade') {
      const partsFade: string[] = []
      if (op.fadeIn !== undefined && op.fadeIn > 0) partsFade.push(`in ${op.fadeIn.toFixed(1)}s`)
      if (op.fadeOut !== undefined && op.fadeOut > 0) partsFade.push(`out ${op.fadeOut.toFixed(1)}s`)
      if (partsFade.length === 0) {
        keyframeDescriptions.push(`disable audio fade`)
      } else {
        keyframeDescriptions.push(`set audio fade (${partsFade.join(', ')})`)
      }
    } else if (op.op === 'normalize_audio') {
      const deltaDb = op.gainDb !== undefined
        ? op.gainDb
        : op.currentLufs !== undefined
          ? (op.targetLufs ?? -14) - op.currentLufs
          : undefined
      const deltaStr = deltaDb !== undefined ? ` (${deltaDb > 0 ? '+' : ''}${deltaDb.toFixed(1)} dB)` : ''
      keyframeDescriptions.push(`normalize audio clip "${op.clipId}" to ${op.targetLufs ?? -14} LUFS${deltaStr}`)
    } else if (op.op === 'duck_audio') {
      const duckDb = op.duckingDb ?? -12
      keyframeDescriptions.push(`auto-duck music clip "${op.musicClipId}" (${duckDb} dB) against ${op.speechIntervals.length} speech segments`)
    } else if (op.op === 'set_timeline_dimensions') {
      const fpsStr = op.fps ? ` @ ${op.fps}fps` : ''
      timelineDimensionChanges.push(`change dimensions to ${op.width}x${op.height}${fpsStr}`)
    } else if (op.op === 'set_timeline_background') {
      if (op.background.type === 'blur') {
        const blurVal = op.background.blur ?? 40
        timelineDimensionChanges.push(`set timeline blurred background (${blurVal}%)`)
      } else if (op.background.type === 'image') {
        timelineDimensionChanges.push('set timeline background image')
      } else {
        timelineDimensionChanges.push(`set timeline background color to ${op.background.color || '#000000'}`)
      }
    } else if (op.op === 'set_canvas') {
      const canvasParts: string[] = []
      if (op.width !== undefined && op.height !== undefined) {
        const fpsStr = op.fps ? ` @ ${op.fps}fps` : ''
        canvasParts.push(`dimensions ${op.width}x${op.height}${fpsStr}`)
      } else {
        if (op.width !== undefined) canvasParts.push(`width ${op.width}px`)
        if (op.height !== undefined) canvasParts.push(`height ${op.height}px`)
        if (op.fps !== undefined) canvasParts.push(`fps ${op.fps}fps`)
      }
      if (op.background) {
        if (op.background.type === 'blur') {
          const blurVal = op.background.blur ?? 40
          canvasParts.push(`blur background (${blurVal}%)`)
        } else if (op.background.type === 'image') {
          canvasParts.push('image background')
        } else {
          canvasParts.push(`color background ${op.background.color || '#000000'}`)
        }
      }
      timelineDimensionChanges.push(`set canvas (${canvasParts.join(', ')})`)
    } else if (op.op === 'set_mask') {
      if (!op.mask || op.mask.enabled === false) {
        maskChanges.push(`remove mask for clip "${op.clipId}"`)
      } else {
        const shapeName = op.mask.shape === 'rectangle' ? 'rectangle' : (op.mask.shape === 'ellipse' ? 'ellipse' : 'linear')
        const featherStr = op.mask.feather ? `, feather ${op.mask.feather}%` : ''
        const invertStr = op.mask.invert ? ', inverted' : ''
        maskChanges.push(`set mask shape ${shapeName} (${op.mask.width}%x${op.mask.height}%${featherStr}${invertStr}) for clip "${op.clipId}"`)
      }
    } else if (op.op === 'set_chroma_key') {
      if (!op.chromaKey || op.chromaKey.enabled === false) {
        chromaKeyChanges.push(`remove chroma key for clip "${op.clipId}"`)
      } else {
        const { color = '#00FF00', similarity = 30, smoothness = 10, spill = 10, featherEdge = 0, cleanEdge = 0 } = op.chromaKey
        const featherStr = featherEdge ? `, feather ${featherEdge}%` : ''
        const cleanStr = cleanEdge ? `, clean ${cleanEdge}%` : ''
        chromaKeyChanges.push(`chroma key color ${color} (similarity ${similarity}%, smoothness ${smoothness}%, spill ${spill}%${featherStr}${cleanStr}) for clip "${op.clipId}"`)
      }
    } else if (op.op === 'set_auto_matte') {
      if (!op.autoMatte || op.autoMatte.enabled === false) {
        autoMatteChanges.push(`remove auto matte for clip "${op.clipId}"`)
      } else {
        const quality = op.autoMatte.quality ?? 'standard'
        const feather = op.autoMatte.featherEdge !== undefined ? `, feather ${op.autoMatte.featherEdge}%` : ''
        const clean = op.autoMatte.cleanEdge !== undefined ? `, clean edge ${op.autoMatte.cleanEdge}%` : ''
        autoMatteChanges.push(`auto matte (${quality}${feather}${clean}) for clip "${op.clipId}"`)
      }
    } else if (op.op === 'replace_clip') {
      const from = op.sourceStart ? ` from ${op.sourceStart}s` : ''
      replaceChanges.push(`replace media of clip "${op.clipId}" with "${assetName(op.assetId)}"${from}, keeping position and duration`)
    } else if (op.op === 'set_stabilization') {
      const stab = op.stabilization
      if (!stab) {
        stabilizationChanges.push(`remove stabilization for clip "${op.clipId}"`)
      } else if (stab.enabled === false) {
        stabilizationChanges.push(`disable stabilization for clip "${op.clipId}"`)
      } else {
        const details = [
          stab.smoothing !== undefined ? `smoothing ${Math.round(stab.smoothing)}` : null,
          stab.mode ? (stab.mode === 'tripod' ? 'tripod mode' : 'camera mode') : null,
        ].filter(Boolean).join(', ')
        stabilizationChanges.push(`stabilization${details ? ` (${details})` : ''} for clip "${op.clipId}"`)
      }
    } else if (op.op === 'set_custom_matte') {
      if (!op.customMatte || op.customMatte.enabled === false) {
        customMatteChanges.push(`remove custom matte for clip "${op.clipId}"`)
      } else {
        const strokeCount = op.customMatte.strokes?.length ?? 0
        customMatteChanges.push(`custom matte (${strokeCount} strokes) for clip "${op.clipId}"`)
      }
    } else if (op.op === 'set_stroke') {
      if (!op.stroke || op.stroke.enabled === false || op.stroke.style === 'none') {
        strokeChanges.push(`remove stroke for clip "${op.clipId}"`)
      } else {
        const style = op.stroke.style
        const color = op.stroke.color ?? '#FFFFFF'
        const width = op.stroke.width ?? 10
        strokeChanges.push(`stroke ${style} color ${color} width ${width}% for clip "${op.clipId}"`)
      }
    } else if (op.op === 'set_blend_mode') {
      blendModeChanges.push(`set blend mode ${op.blendMode} for clip "${op.clipId}"`)
    } else if (op.op === 'update_clip') {
      // Name the fields: 'a clip changed' tells the reviewer nothing about what.
      for (const field of Object.keys(op.patch || {})) {
        if (!updatedFields.includes(field)) updatedFields.push(field)
      }
    } else if (op.op === 'add_marker') {
      addMarkerCount++
    } else if (op.op === 'delete_marker') {
      deleteMarkerCount++
    } else if (op.op === 'update_marker') {
      updateMarkerCount++
    } else if (op.op === 'freeze_frame') {
      freezeFrameCount++
    } else if (op.op === 'punch_in_cut') {
      const scaleStr = op.scale ? `${op.scale}%` : '115%'
      keyframeDescriptions.push(`punch-in (${scaleStr}) clip "${op.clipId}"`)
    } else if (op.op === 'punch_in_sequence') {
      const scaleStr = op.scale ? `${op.scale}%` : '115%'
      keyframeDescriptions.push(`alternating punch-in 100% ↔ ${scaleStr} on track #${op.trackIndex ?? 0}`)
    } else if (op.op === 'create_highlight_short') {
      const dur = (op.endTime - op.startTime).toFixed(1)
      const hookMsg = op.hookText ? ` with hook "${op.hookText}"` : ''
      keyframeDescriptions.push(`create 9:16 Short (${dur}s)${hookMsg}`)
    } else if (op.op === 'duplicate_timeline') {
      const nameMsg = op.name ? ` "${op.name}"` : ''
      const tagMsg = op.variantTag ? ` [${op.variantTag}]` : ''
      keyframeDescriptions.push(`duplicate timeline variant${nameMsg}${tagMsg}`)
    } else if (op.op === 'switch_timeline') {
      keyframeDescriptions.push(`switch to timeline "${op.timelineId}"`)
    } else if (op.op === 'delete_timeline') {
      keyframeDescriptions.push(`delete timeline "${op.timelineId}"`)
    } else if (op.op === 'set_timeline_variant') {
      const tagMsg = op.variantTag ? ` tag="${op.variantTag}"` : ''
      const nameMsg = op.name ? ` name="${op.name}"` : ''
      keyframeDescriptions.push(`update variant info${nameMsg}${tagMsg}`)
    } else if (op.op === 'apply_template') {
      // Say how many holes get filled and how many are left: an applied
      // template with three of its six slots empty looks broken, and the
      // reviewer should know that before approving, not after.
      const filled = op.bindings.length
      const total = op.template.slots.length
      const emptyMsg = filled < total ? `, ${total - filled} slot(s) left empty` : ''
      keyframeDescriptions.push(
        `apply template "${op.template.name}" as a new timeline (${filled}/${total} slots filled${emptyMsg})`,
      )
    } else if (op.op === 'set_cover') {
      const typeStr = op.cover?.type ? ` [${op.cover.type}]` : ''
      keyframeDescriptions.push(`set timeline cover${typeStr}`)
    } else {
      otherCount++
    }
  }

  // Calculate simulated V1 duration
  // If patch is applied on a clone, calculate exact result
  let simulatedState = state
  try {
    const simResult = executePatchOperations(simulatedState, patch.operations)
    simulatedState = simResult
  } catch {
    // Fallback if simulation encounters error
  }

  const v1DurationAfter = getV1Duration(simulatedState)
  const durationDiff = v1DurationBefore - v1DurationAfter

  const parts: string[] = []

  if (patch.description) {
    parts.push(patch.description)
  }

  if (cutRangeCount > 0) {
    parts.push(`cut ${cutRangeCount} ranges (${cutRangeTotalSec.toFixed(1)}s)`)
  }
  if (deleteClipCount > 0) {
    parts.push(`delete ${deleteClipCount} clips`)
  }
  if (splitCount > 0) {
    parts.push(`split ${splitCount} points`)
  }
  if (insertClipCount > 0) {
    parts.push(`insert ${insertClipCount} clips`)
  }
  if (addSubtitleCount > 0) {
    parts.push(`add ${addSubtitleCount} subtitles`)
  }
  if (importSrtCount > 0) {
    parts.push(`import ${srtCuesTotal > 0 ? srtCuesTotal : importSrtCount} subtitles from SRT`)
  }
  if (addTextCount > 0) {
    parts.push(`add ${addTextCount} text clips`)
  }
  if (applyTextPresetCount > 0) {
    parts.push(`apply ${applyTextPresetCount} text presets (${textPresetsApplied.join(', ')})`)
  }
  if (applyTextAnimCount > 0) {
    parts.push(`apply ${applyTextAnimCount} text animations (${textAnimsApplied.join(', ')})`)
  }
  if (addStickerCount > 0) {
    const list = stickerNamesApplied.slice(0, 3).join(', ')
    const more = stickerNamesApplied.length > 3 ? ` and ${stickerNamesApplied.length - 3} more` : ''
    parts.push(`add ${addStickerCount} stickers (${list}${more})`)
  }
  if (addSfxCount > 0) {
    const list = sfxNamesApplied.slice(0, 3).join(', ')
    const more = sfxNamesApplied.length > 3 ? ` and ${sfxNamesApplied.length - 3} more` : ''
    parts.push(`add ${addSfxCount} sound effects (${list}${more})`)
  }
  if (setTransitionCount > 0) {
    parts.push(`set ${setTransitionCount} transitions`)
  }
  if (removeTransitionCount > 0) {
    parts.push(`remove ${removeTransitionCount} transitions`)
  }
  if (addSubTrackCount > 0) {
    parts.push(`add ${addSubTrackCount} subtitle tracks`)
  }
  if (setFilterCount > 0) {
    if (filterNamesApplied.length === 1) {
      parts.push(`apply filter ${filterNamesApplied[0]}`)
    } else {
      parts.push(`apply ${setFilterCount} filters (${filterNamesApplied.join(', ')})`)
    }
  }
  if (removeFilterCount > 0) {
    parts.push(`remove ${removeFilterCount} filters`)
  }
  if (detachAudioCount > 0) {
    parts.push(`detach audio from ${detachAudioCount} clips`)
  }
  if (keyframeDescriptions.length > 0) {
    parts.push(keyframeDescriptions.join(', '))
  }
  if (removeKeyframeCount > 0) {
    parts.push(`remove ${removeKeyframeCount} keyframes`)
  }
  if (clearKeyframeCount > 0) {
    parts.push(`clear all keyframes (${clearKeyframeCount} clips)`)
  }
  if (updatedFields.length > 0) {
    parts.push(`update ${updatedFields.join(', ')} of clip`)
  }
  if (timelineDimensionChanges.length > 0) {
    parts.push(timelineDimensionChanges.join(', '))
  }
  if (maskChanges.length > 0) {
    parts.push(maskChanges.join(', '))
  }
  if (chromaKeyChanges.length > 0) {
    parts.push(chromaKeyChanges.join(', '))
  }
  if (autoMatteChanges.length > 0) {
    parts.push(autoMatteChanges.join(', '))
  }
  if (stabilizationChanges.length > 0) {
    parts.push(stabilizationChanges.join(', '))
  }
  if (replaceChanges.length > 0) {
    parts.push(replaceChanges.join(', '))
  }
  if (customMatteChanges.length > 0) {
    parts.push(customMatteChanges.join(', '))
  }
  if (strokeChanges.length > 0) {
    parts.push(strokeChanges.join(', '))
  }
  if (blendModeChanges.length > 0) {
    parts.push(blendModeChanges.join(', '))
  }
  if (addMarkerCount > 0) {
    parts.push(`add ${addMarkerCount} markers`)
  }
  if (deleteMarkerCount > 0) {
    parts.push(`delete ${deleteMarkerCount} markers`)
  }
  if (updateMarkerCount > 0) {
    parts.push(`update ${updateMarkerCount} markers`)
  }
  if (freezeFrameCount > 0) {
    parts.push(`freeze ${freezeFrameCount} frames`)
  }
  if (insertBrollCount > 0) {
    parts.push(`insert ${insertBrollCount} B-roll clips`)
  }
  if (otherCount > 0) {
    parts.push(`${otherCount} other operations`)
  }

  const summary = parts.length > 0 ? parts.join(', ') : `${patch.operations.length} operations`

  let v1Transition = `V1: ${formatDurationMmSs(v1DurationBefore)}`
  if (durationDiff > 0.05) {
    v1Transition = `V1 shortened from ${formatDurationMmSs(v1DurationBefore)} to ${formatDurationMmSs(v1DurationAfter)} (-${durationDiff.toFixed(1)}s)`
  } else if (durationDiff < -0.05) {
    v1Transition = `V1 lengthened from ${formatDurationMmSs(v1DurationBefore)} to ${formatDurationMmSs(v1DurationAfter)} (+${Math.abs(durationDiff).toFixed(1)}s)`
  }

  return `${summary}; ${v1Transition}`
}
