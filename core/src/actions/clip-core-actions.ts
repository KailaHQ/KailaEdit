import type {
  SpeedCurve,
  TimelineClip,
} from '../project-model'
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  MAX_CLIP_VOLUME,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectClips,
  selectTracks,
  selectCurrentTime,
  selectClipById,
  selectAssets,
} from '../editor-selectors'
import { buildReplacedClip, replaceClipRefusal } from '../clip-replace'
import {
  resolveOverlaps,
  packMainVideoTrack,
  mainVideoTrackIndex,
  pruneEmptyTracks,
  liftCollidingClipsToNewTracks,
} from '../video-editor-utils'
import { clampClipSpeed } from '../clip-speed'
import {
  clipHasSpeedCurve,
  clipSourceSpan,
  curveMeanSpeed,
  durationForSpeedCurve,
  normalizeSpeedCurve,
  splitClipTimingAt,
} from '../speed-curve'
import { makeId } from '../id-generator'
import type {
  InsertAssetsToTimelineParams,
  MoveClipsParams,
  ResizeClipParams,
  SlipClipParams,
  SlideClipParams,
  InsertGeneratedGapAssetParams,
  SourceEditParams,
  AddAdjustmentLayerParams,
} from './types'
import {
  updateEditorModel,
  updateSession,
  activeTrackStartTime,
  buildDroppedAssetInsertion,
  createAdjustmentAsset,
  createAdjustmentClip,
  buildSourceRequestClips,
  getNextAdjustmentLayerName,
} from './action-helpers'
import { replaceActiveTimeline, mapClips, setTimelineClips } from './timeline-actions'
import { addAssetToEditor } from './asset-actions'
import { addTrack } from './track-actions'

export function insertAssetsToTimeline(state: EditorState, params: InsertAssetsToTimelineParams): EditorState {
  const activeTimeline = selectActiveTimeline(state)
  if (!activeTimeline) return state

  const mainTrackIndex = mainVideoTrackIndex(activeTimeline.tracks)
  let trackIndex = params.trackIndex !== undefined ? params.trackIndex : (mainTrackIndex >= 0 ? mainTrackIndex : 0)
  if (trackIndex < 0 || activeTimeline.tracks[trackIndex]?.type === 'subtitle') {
    trackIndex = mainTrackIndex >= 0 ? mainTrackIndex : 0
  }

  // position: 'start' puts the assets in front of what is already on the main
  // video track. V1 is the magnetic track: resolveOverlaps
  // pushes the clips it displaces to the right instead of trimming them, and
  // packMainVideoTrack closes the gap afterwards, so the existing edit survives
  // intact and simply starts later.
  //
  // Only for V1, and only when no explicit time was given. On any other track
  // resolveOverlaps trims and splits whatever it lands on, so prepending there
  // would destroy clips; drag-and-drop always passes its own startTime anyway.
  const prependToMainTrack = params.position === 'start'
    && params.startTime === undefined
    && mainTrackIndex >= 0
    && trackIndex === mainTrackIndex
  const startCursor = params.startTime ?? (prependToMainTrack ? 0 : activeTrackStartTime(state, trackIndex))
  let cursor = startCursor
  let nextTracks = activeTimeline.tracks
  const insertedClips: TimelineClip[] = []

  for (const asset of params.assets) {
    const isAudioCascade = asset.type === 'audio' && !(nextTracks[trackIndex]?.kind === 'audio')
    const itemStartTime = isAudioCascade ? startCursor : cursor
    const insertion = buildDroppedAssetInsertion(asset, trackIndex, itemStartTime, nextTracks, [...activeTimeline.clips, ...insertedClips])
    nextTracks = insertion.tracks
    insertedClips.push(...insertion.clips)
    if (!isAudioCascade) {
      cursor += insertion.duration
    }
  }

  if (insertedClips.length === 0 && nextTracks === activeTimeline.tracks) {
    return state
  }

  const insertedIds = new Set(insertedClips.map(clip => clip.id))
  const insertedSpan = cursor - startCursor

  // Make room first rather than letting resolveOverlaps do it. That function
  // DELETES any clip the inserted range fully covers (the `cStart >= movedStart
  // && cEnd <= movedEnd` branch), which it checks before the magnetic-track
  // guard — so prepending a 12s asset in front of a 10s clip erased the 10s
  // clip and looked like the new asset had replaced it. Shifting by hand is
  // also exact: every displaced clip moves by the same amount, so relative
  // timing and any transitions between them survive.
  const shiftForPrepend = (clips: TimelineClip[]): TimelineClip[] => {
    if (!prependToMainTrack || insertedSpan <= 0) return clips
    const displaced = new Set(
      clips.filter(clip => clip.trackIndex === mainTrackIndex).map(clip => clip.id))
    if (displaced.size === 0) return clips
    // Linked clips (a legacy detached audio track) ride along, or they would
    // drift out of sync with the picture they belong to.
    for (const clip of clips) {
      if (!displaced.has(clip.id)) continue
      for (const linkedId of clip.linkedClipIds ?? []) displaced.add(linkedId)
    }
    return clips.map(clip => displaced.has(clip.id)
      ? { ...clip, startTime: clip.startTime + insertedSpan }
      : clip)
  }

  const updatedTimelineState = replaceActiveTimeline(state, timeline => {
    // Dropped onto clips on an overlay track: the new clips go up to a track of their own
    // instead of overwriting what is there (see liftCollidingClipsToNewTracks). The main
    // track keeps its magnet; the explicit overwrite edits below keep overwriting.
    const lifted = liftCollidingClipsToNewTracks(
      nextTracks,
      [...shiftForPrepend(timeline.clips), ...insertedClips],
      insertedIds,
      timeline.transitions,
      mainTrackIndex,
      () => makeId('track'),
    )
    return {
      ...timeline,
      tracks: lifted.tracks,
      clips: packMainVideoTrack(
        lifted.tracks,
        resolveOverlaps(lifted.clips, insertedIds),
        timeline.transitions,
      ),
    }
  })

  const currentTime = selectCurrentTime(state)
  const isPlayheadInInsertedSpan = currentTime >= startCursor && currentTime <= cursor
  const nextCurrentTime = isPlayheadInInsertedSpan ? currentTime : startCursor

  return updateSession(updatedTimelineState, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: insertedIds,
      subtitleId: null,
      gap: null,
    },
    transport: {
      ...session.transport,
      currentTime: nextCurrentTime,
    },
  }))
}

export function overwriteAssetsOnTimeline(state: EditorState, params: InsertAssetsToTimelineParams): EditorState {
  const afterInsert = insertAssetsToTimeline(state, params)
  const activeTimeline = selectActiveTimeline(afterInsert)
  if (!activeTimeline) return afterInsert
  const insertedIds = new Set<string>(
    activeTimeline.clips
      .slice(-params.assets.length * 2)
      .map((clip: TimelineClip) => clip.id),
  )
  return replaceActiveTimeline(afterInsert, timeline => ({
    ...timeline,
    clips: resolveOverlaps(timeline.clips, insertedIds),
  }))
}

export function insertSourceEdit(state: EditorState, params: SourceEditParams): EditorState {
  const result = buildSourceRequestClips(state, params)
  if (!result) return state
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: [
      ...timeline.clips.map(clip => (
        result.targetTrackIndices.includes(clip.trackIndex) && clip.startTime >= result.time
          ? { ...clip, startTime: clip.startTime + result.insertDuration }
          : clip
      )),
      ...result.newClips,
    ],
  }))
}

export function overwriteSourceEdit(state: EditorState, params: SourceEditParams): EditorState {
  const result = buildSourceRequestClips(state, params)
  if (!result) return state
  const insertedIds = new Set(result.newClips.map(clip => clip.id))
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: resolveOverlaps([...timeline.clips, ...result.newClips], insertedIds),
  }))
}


export function createAdjustmentLayerAsset(state: EditorState): EditorState {
  const name = getNextAdjustmentLayerName(state.editorModel.assets)
  const asset = createAdjustmentAsset(name)
  return updateEditorModel(state, editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}

export function addAdjustmentLayer(state: EditorState, params: AddAdjustmentLayerParams = {}): EditorState {
  const name = getNextAdjustmentLayerName(state.editorModel.assets)
  const asset = createAdjustmentAsset(name)
  const clip = createAdjustmentClip(asset, params.startTime ?? selectCurrentTime(state), params.trackIndex ?? 0, params.duration ?? 10)
  return updateEditorModel(replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: [...timeline.clips, clip],
  })), editorModel => ({
    ...editorModel,
    assets: [asset, ...editorModel.assets],
  }))
}


export function duplicateClips(state: EditorState, clipIds: string[]): EditorState {
  const clipSet = new Set(clipIds)
  return replaceActiveTimeline(state, timeline => {
    const duplicates = timeline.clips
      .filter(clip => clipSet.has(clip.id))
      .map(clip => ({
        ...clip,
        id: makeId('clip'),
        startTime: clip.startTime + clip.duration,
      }))
    return {
      ...timeline,
      clips: [...timeline.clips, ...duplicates],
    }
  })
}

export function unlinkClipGroup(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip?.linkedClipIds?.length) return state
  const linkedIds = new Set(clip.linkedClipIds)
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: timeline.clips.map(candidate => {
      if (candidate.id === clipId) {
        return { ...candidate, linkedClipIds: undefined }
      }
      if (!linkedIds.has(candidate.id) || !candidate.linkedClipIds?.length) {
        return candidate
      }
      const remaining = candidate.linkedClipIds.filter(id => id !== clipId)
      return { ...candidate, linkedClipIds: remaining.length > 0 ? remaining : undefined }
    }),
  }))
}

export function deleteClips(state: EditorState, clipIds: string[]): EditorState {
  const deleteSet = new Set(clipIds)
  let next = replaceActiveTimeline(state, timeline => {
    const remainingClips = timeline.clips
      .filter(clip => !deleteSet.has(clip.id))
      .map(clip => {
        if (!clip.linkedClipIds) return clip
        const remaining = clip.linkedClipIds.filter(id => !deleteSet.has(id))
        return { ...clip, linkedClipIds: remaining.length > 0 ? remaining : undefined }
      })
    // Deleting the last clip on a row leaves the row behind, so tidy up in the
    // same step. The user sees the row go with its contents rather than having
    // to remove it separately.
    const pruned = pruneEmptyTracks(
      timeline.tracks,
      packMainVideoTrack(timeline.tracks, remainingClips, timeline.transitions),
      timeline.subtitles || [],
    )
    return {
      ...timeline,
      tracks: pruned.tracks,
      clips: pruned.clips,
      subtitles: pruned.subtitles,
    }
  })
  next = updateSession(next, session => ({
    ...session,
    selection: {
      ...session.selection,
      clipIds: new Set([...session.selection.clipIds].filter(id => !deleteSet.has(id))),
    },
  }))
  return next
}

export function splitClipsAtTime(state: EditorState, clipIds: string[], time: number): EditorState {
  const clips = selectClips(state)
  const tracks = selectTracks(state)
  const splittable = clipIds.filter(id => {
    const clip = clips.find(candidate => candidate.id === id)
    if (!clip) return false
    if (tracks[clip.trackIndex]?.locked) return false
    const splitPoint = time - clip.startTime
    return splitPoint > 0.1 && splitPoint < clip.duration - 0.1
  })
  if (splittable.length === 0) return state

  return replaceActiveTimeline(state, timeline => {
    const alreadySplit = new Set<string>()
    let newClips = [...timeline.clips]

    for (const splitId of splittable) {
      if (alreadySplit.has(splitId)) continue

      const clip = newClips.find(candidate => candidate.id === splitId)
      if (!clip) continue

      const splitPoint = time - clip.startTime
      if (splitPoint <= 0.1 || splitPoint >= clip.duration - 0.1) continue

      alreadySplit.add(splitId)

      const firstHalfId = clip.id
      const secondHalfId = makeId('clip')
      const linkedClips = (clip.linkedClipIds || [])
        .map(linkedId => newClips.find(candidate => candidate.id === linkedId))
        .filter((linkedClip): linkedClip is TimelineClip => linkedClip != null)

      const [firstTiming, secondTiming] = splitClipTimingAt(clip, splitPoint)
      const firstHalf: TimelineClip = {
        ...clip,
        ...firstTiming,
      }
      const secondHalf: TimelineClip = {
        ...clip,
        ...secondTiming,
        id: secondHalfId,
        startTime: clip.startTime + splitPoint,
      }

      newClips = newClips.map(candidate => candidate.id === splitId ? firstHalf : candidate).concat(secondHalf)

      const firstHalfLinkedIds: string[] = []
      const secondHalfLinkedIds: string[] = []

      for (const linkedClip of linkedClips) {
        alreadySplit.add(linkedClip.id)

        const linkedSplitPoint = time - linkedClip.startTime
        if (linkedSplitPoint <= 0.01 || linkedSplitPoint >= linkedClip.duration - 0.01) {
          firstHalfLinkedIds.push(linkedClip.id)
          continue
        }

        const linkedSecondId = makeId('clip')
        firstHalfLinkedIds.push(linkedClip.id)
        secondHalfLinkedIds.push(linkedSecondId)

        const [linkedFirstTiming, linkedSecondTiming] = splitClipTimingAt(linkedClip, linkedSplitPoint)
        const linkedFirstHalf: TimelineClip = {
          ...linkedClip,
          ...linkedFirstTiming,
          linkedClipIds: [firstHalfId],
        }
        const linkedSecondHalf: TimelineClip = {
          ...linkedClip,
          ...linkedSecondTiming,
          id: linkedSecondId,
          startTime: linkedClip.startTime + linkedSplitPoint,
          linkedClipIds: [secondHalfId],
        }

        newClips = newClips
          .map(candidate => candidate.id === linkedClip.id ? linkedFirstHalf : candidate)
          .concat(linkedSecondHalf)
      }

      firstHalf.linkedClipIds = firstHalfLinkedIds.length > 0 ? firstHalfLinkedIds : undefined
      secondHalf.linkedClipIds = secondHalfLinkedIds.length > 0 ? secondHalfLinkedIds : undefined
      newClips = newClips.map(candidate => (
        candidate.id === firstHalfId ? firstHalf : candidate.id === secondHalfId ? secondHalf : candidate
      ))
    }

    return {
      ...timeline,
      clips: newClips,
    }
  })
}

export function moveClips(state: EditorState, params: MoveClipsParams): EditorState {
  const clipSet = new Set(params.clipIds)
  return replaceActiveTimeline(state, timeline => {
    const moved = timeline.clips.map(clip => (
      clipSet.has(clip.id)
        ? {
            ...clip,
            startTime: Math.max(0, clip.startTime + (params.deltaTime ?? 0)),
            trackIndex: params.targetTrackIndex ?? clip.trackIndex,
          }
        : clip
    ))
    const packed = packMainVideoTrack(timeline.tracks, moved, timeline.transitions)
    const pruned = pruneEmptyTracks(timeline.tracks, packed, timeline.subtitles || [])
    return {
      ...timeline,
      tracks: pruned.tracks,
      clips: pruned.clips,
      subtitles: pruned.subtitles,
    }
  })
}

export function resizeClip(state: EditorState, params: ResizeClipParams): EditorState {
  return mapClips(state, clip => {
    if (clip.id !== params.clipId) return clip
    if (params.edge === 'start') {
      const nextStart = Math.max(0, clip.startTime + params.deltaTime)
      const delta = nextStart - clip.startTime
      const nextDuration = Math.max(0.1, clip.duration - delta)
      return {
        ...clip,
        startTime: nextStart,
        duration: nextDuration,
        trimStart: Math.max(0, clip.trimStart + delta * clip.speed),
      }
    }
    return {
      ...clip,
      duration: Math.max(0.1, clip.duration + params.deltaTime),
    }
  })
}

export function slipClip(state: EditorState, params: SlipClipParams): EditorState {
  return mapClips(state, clip => {
    if (clip.id !== params.clipId) return clip
    return {
      ...clip,
      trimStart: Math.max(0, clip.trimStart + params.deltaTime * clip.speed),
      trimEnd: Math.max(0, clip.trimEnd - params.deltaTime * clip.speed),
    }
  })
}

export function slideClip(state: EditorState, params: SlideClipParams): EditorState {
  return moveClips(state, { clipIds: [params.clipId], deltaTime: params.deltaTime })
}

export function updateClip(state: EditorState, clipId: string, patch: Partial<TimelineClip>): EditorState {
  return mapClips(state, clip => (clip.id === clipId ? { ...clip, ...patch } : clip))
}

/**
 * Re-times one clip and packs the magnetic track around it.
 *
 * Every edit that changes when a clip starts or how long it runs has to leave
 * V1 seamless, or `replaceActiveTimeline` throws the whole edit away. Patching
 * the clip on its own — which is all `updateClip` does — was enough to make the
 * Speed, Duration and Start Time controls do nothing at all whenever another
 * clip followed on the main track.
 */
function retimeClip(state: EditorState, clipId: string, patch: Partial<TimelineClip>): EditorState {
  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => (clip.id === clipId ? { ...clip, ...patch } : clip)),
      timeline.transitions,
    ),
  }))
}

/**
 * Note that on the magnetic track the pack decides the start time, so this can
 * only move a clip that sits on an overlay or audio row.
 */
export function setClipStartTime(state: EditorState, clipId: string, startTime: number): EditorState {
  return retimeClip(state, clipId, { startTime: Math.max(0, startTime) })
}

export function setClipDuration(state: EditorState, clipId: string, duration: number): EditorState {
  const targetClip = selectClipById(state, clipId)
  if (!targetClip) return state

  const safeDuration = Math.max(0.1, duration)
  const linkedIds = new Set(targetClip.linkedClipIds || [])
  const durationRatio = targetClip.duration > 0 ? safeDuration / targetClip.duration : 1

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => {
        if (clip.id === clipId) {
          return { ...clip, duration: safeDuration }
        }
        if (linkedIds.has(clip.id)) {
          return { ...clip, duration: Math.max(0.1, clip.duration * durationRatio) }
        }
        return clip
      }),
      timeline.transitions,
    ),
  }))
}

/**
 * Changes a clip's speed, and re-times the magnetic track around it.
 *
 * Speed and duration move together: playing the same media twice as fast takes
 * half the time. On V1 that shortens or lengthens the clip, which leaves every
 * clip after it starting at the wrong moment — and the timeline validator
 * rejects a V1 with a gap or an overlap (V1_NOT_SEAMLESS). `replaceActiveTimeline`
 * drops a rejected edit and returns the previous state without a word, so the
 * speed slider simply did nothing whenever another clip followed on V1.
 *
 * Packing the track in the same step is what makes the edit legal: the
 * following clips slide to meet the new duration.
 *
 * Any linked clips (such as linked audio from the same video file) are also
 * updated with the new speed and their durations scaled synchronously to prevent
 * desynchronization.
 */
export function setClipSpeed(
  state: EditorState,
  clipId: string,
  speed: number,
  duration?: number,
): EditorState {
  const targetClip = selectClipById(state, clipId)
  if (!targetClip) return state

  const safeSpeed = clampClipSpeed(speed)
  const safeDuration = duration !== undefined ? Math.max(0.1, duration) : undefined
  const linkedIds = new Set(targetClip.linkedClipIds || [])
  const durationRatio = safeDuration !== undefined && targetClip.duration > 0
    ? safeDuration / targetClip.duration
    : undefined

  const patchTarget = (clip: TimelineClip): TimelineClip => {
    if (clip.id === clipId) {
      return {
        ...clip,
        speed: safeSpeed,
        speedCurve: undefined,
        ...(safeDuration !== undefined ? { duration: safeDuration } : {}),
      }
    }
    if (linkedIds.has(clip.id)) {
      return {
        ...clip,
        speed: safeSpeed,
        speedCurve: undefined,
        ...(durationRatio !== undefined ? { duration: Math.max(0.1, clip.duration * durationRatio) } : {}),
      }
    }
    return clip
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(patchTarget),
      timeline.transitions,
    ),
  }))
}

/**
 * Gives a clip a speed curve, or takes it away (`curve` null).
 *
 * The clip keeps playing the same stretch of source — the curve only decides
 * how fast it moves through it — so the duration follows from the curve and
 * the magnetic track is re-packed around the new length, as `setClipSpeed`
 * does. `speed` is set to the curve's mean rate, which keeps every conversion
 * that uses `duration × speed` reading the right amount of source. Removing
 * the curve leaves the clip at that mean rate with its duration unchanged.
 *
 * Linked clips (the audio of a video) get the same curve so they stay in sync.
 */
export function setClipSpeedCurve(
  state: EditorState,
  clipId: string,
  curve: SpeedCurve | null,
): EditorState {
  const targetClip = selectClipById(state, clipId)
  if (!targetClip) return state
  if (targetClip.type !== 'video' && targetClip.type !== 'audio') return state

  const normalized = curve ? normalizeSpeedCurve(curve) : null
  if (curve && !normalized) return state
  const linkedIds = new Set(targetClip.linkedClipIds || [])

  const retime = (clip: TimelineClip): TimelineClip => {
    if (!normalized) {
      if (!clipHasSpeedCurve(clip)) return clip
      return { ...clip, speedCurve: undefined }
    }
    const span = clipSourceSpan(clip)
    return {
      ...clip,
      speedCurve: normalized,
      speed: curveMeanSpeed(normalized),
      duration: Math.max(0.1, durationForSpeedCurve(span, normalized)),
    }
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => (clip.id === clipId || linkedIds.has(clip.id) ? retime(clip) : clip)),
      timeline.transitions,
    ),
  }))
}

/**
 * The same change across a selection, in one edit.
 *
 * Applying it clip by clip would leave a row of undo steps for what the user
 * did once, and each intermediate state would have to be seamless on its own —
 * which it is not, since the clips are re-timed one at a time.
 *
 * `durationFor` receives each clip and returns the length it should take at the
 * new speed; the caller owns that sum because it is the side that knows how
 * much media is left to play.
 */
export function setClipsSpeed(
  state: EditorState,
  clipIds: Iterable<string>,
  speed: number,
  durationFor?: (clip: TimelineClip) => number,
): EditorState {
  const targets = new Set(clipIds)
  if (targets.size === 0) return state
  const safeSpeed = clampClipSpeed(speed)

  const allClips = selectClips(state)
  const linkedToTargets = new Map<string, string>() // linkedId -> parentTargetId
  for (const clip of allClips) {
    if (targets.has(clip.id) && clip.linkedClipIds) {
      for (const lid of clip.linkedClipIds) {
        if (!targets.has(lid)) {
          linkedToTargets.set(lid, clip.id)
        }
      }
    }
  }

  return replaceActiveTimeline(state, timeline => ({
    ...timeline,
    clips: packMainVideoTrack(
      timeline.tracks,
      timeline.clips.map(clip => {
        if (targets.has(clip.id)) {
          return {
            ...clip,
            speed: safeSpeed,
            speedCurve: undefined,
            ...(durationFor ? { duration: Math.max(0.1, durationFor(clip)) } : {}),
          }
        }
        const parentTargetId = linkedToTargets.get(clip.id)
        if (parentTargetId) {
          const parent = allClips.find(c => c.id === parentTargetId)
          const newParentDur = parent && durationFor ? durationFor(parent) : undefined
          const ratio = parent && newParentDur !== undefined && parent.duration > 0
            ? newParentDur / parent.duration
            : undefined
          return {
            ...clip,
            speed: safeSpeed,
            speedCurve: undefined,
            ...(ratio !== undefined ? { duration: Math.max(0.1, clip.duration * ratio) } : {}),
          }
        }
        return clip
      }),
      timeline.transitions,
    ),
  }))
}

function resolveClipAudioTargetId(state: EditorState, clipId: string): string | null {
  const clip = selectClipById(state, clipId)
  if (!clip) return null
  if (clip.type === 'audio') return clip.id

  const linkedAudioClip = (clip.linkedClipIds || [])
    .map(linkedId => selectClipById(state, linkedId))
    .find(candidate => candidate?.type === 'audio')

  return linkedAudioClip?.id ?? clip.id
}

export function setClipAudioLevel(state: EditorState, clipId: string, volume: number): EditorState {
  const targetClipId = resolveClipAudioTargetId(state, clipId)
  if (!targetClipId) return state
  // The ceiling is MAX_CLIP_VOLUME, not unity: the volume slider runs to 400%,
  // preview lifts anything past 100% through a Web Audio gain node and export
  // rides the peaks down with a look-ahead limiter. Clamping at 1 here meant
  // the slider sprang back to 100% and a clip could never be made louder.
  const clampedVolume = Math.max(0, Math.min(MAX_CLIP_VOLUME, volume))
  return updateClip(state, targetClipId, { volume: clampedVolume, muted: false })
}

export function setClipAudioMuted(state: EditorState, clipId: string, muted: boolean): EditorState {
  const targetClipId = resolveClipAudioTargetId(state, clipId)
  if (!targetClipId) return state
  return updateClip(state, targetClipId, { muted })
}

export function setClipVolume(state: EditorState, clipId: string, volume: number): EditorState {
  return updateClip(state, clipId, { volume })
}

export function toggleClipMute(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, { muted: !clip.muted })
}

export function toggleClipReverse(state: EditorState, clipId: string): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, { reversed: !clip.reversed })
}


export function insertGeneratedGapAsset(state: EditorState, params: InsertGeneratedGapAssetParams): EditorState {
  let next = addAssetToEditor(state, params.asset)

  let audioTrackIndex = -1
  if (params.createAudio) {
    audioTrackIndex = selectTracks(next).findIndex(
      track => track.kind === 'audio' && !track.locked && track.sourcePatched !== false,
    )
    if (audioTrackIndex < 0) {
      next = addTrack(next, 'audio')
      audioTrackIndex = selectTracks(next).length - 1
    }
  }

  const gapDuration = params.gap.endTime - params.gap.startTime
  const videoClipId = makeId('clip')
  const audioClipId = makeId('clip-audio')
  const newClips: TimelineClip[] = [{
    id: videoClipId,
    assetId: params.asset.id,
    type: params.asset.type === 'image' ? 'image' : 'video',
    startTime: params.gap.startTime,
    duration: gapDuration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: params.gap.trackIndex,
    asset: params.asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    ...(params.createAudio && audioTrackIndex >= 0 ? { linkedClipIds: [audioClipId] } : {}),
  }]

  if (params.createAudio && audioTrackIndex >= 0) {
    newClips.push({
      id: audioClipId,
      assetId: params.asset.id,
      type: 'audio',
      startTime: params.gap.startTime,
      duration: gapDuration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: audioTrackIndex,
      asset: params.asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      linkedClipIds: [videoClipId],
    })
  }

  return setTimelineClips(next, prev => [...prev, ...newClips])
}

/**
 * Puts different media into a clip, keeping its place and length (see clip-replace.ts).
 * Returns the state unchanged when the replacement is refused — the caller asks
 * `replaceClipRefusal` first when it needs to say why.
 *
 * A legacy detached audio clip linked to the clip follows: it plays the new video's sound
 * over the same stretch, or is muted when the new media is a still, which has none.
 */
export function replaceClipMedia(
  state: EditorState,
  clipId: string,
  assetId: string,
  sourceStart = 0,
): EditorState {
  const clip = selectClipById(state, clipId)
  const asset = selectAssets(state).find(candidate => candidate.id === assetId)
  if (!clip || !asset) return state
  if (replaceClipRefusal(clip, asset, selectTracks(state))) return state

  const replaced = buildReplacedClip(clip, asset, sourceStart)
  const linked = new Set(clip.linkedClipIds ?? [])
  return mapClips(state, candidate => {
    if (candidate.id === clipId) return replaced
    if (!linked.has(candidate.id) || candidate.type !== 'audio') return candidate
    if (asset.type !== 'video') return { ...candidate, muted: true }
    return {
      ...candidate,
      assetId: asset.id,
      asset,
      trimStart: replaced.trimStart,
      trimEnd: replaced.trimEnd,
      importedName: undefined,
    }
  })
}
