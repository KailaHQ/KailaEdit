import type {
  ColorCorrection,
  LetterboxSettings,
  TextOverlayStyle,
  TimelineClip,
  ClipTransform,
  KeyframeProperty,
  KeyframeEasing,
  KeyframePoint,
  KeyframeTrack,
} from '../project-model'
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_LETTERBOX,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectClips,
  selectCurrentTime,
  selectTracks,
  selectClipById,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import { createTextClipWithPreset, applyTextPreset, applyTextAnimation } from '../text-presets'
import { applyDuckingKeyframes } from '../audio-ducking'
import { mainVideoTrackIndex, resolveOverlaps } from '../video-editor-utils'
import type { AddTextClipParams } from './types'
import {
  updateSession,
} from './action-helpers'
import { replaceActiveTimeline } from './timeline-actions'
import { addTrack } from './track-actions'
import { updateClip } from './clip-core-actions'
import { setSelectedClipIds, setCurrentTime } from './playback-actions'

export function addTextClip(state: EditorState, params: AddTextClipParams = {}): EditorState {
  let next = state
  let trackIdx = params.trackIndex
  if (trackIdx === undefined) {
    const tracks = selectTracks(next)
    const mainIdx = mainVideoTrackIndex(tracks)
    const overlayTrackIndices = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => (mainIdx >= 0 ? index !== mainIdx : index > 0) && track.kind === 'video' && track.type !== 'subtitle' && !track.locked)
      .map(({ index }) => index)
    if (overlayTrackIndices.length > 0) {
      trackIdx = overlayTrackIndices[overlayTrackIndices.length - 1]
    } else {
      next = addTrack(next, 'video')
      trackIdx = selectTracks(next).length - 1
    }
  }

  const startTime = params.startTime ?? selectCurrentTime(next)
  const duration = params.duration ?? 4.0
  const text = params.style?.text ?? 'Title Text'

  let textClip: TimelineClip
  if (params.preset || params.animation) {
    textClip = createTextClipWithPreset(
      params.preset || 'default',
      params.animation,
      text,
      startTime,
      trackIdx,
      duration,
    )
    if (params.style) {
      textClip = {
        ...textClip,
        textStyle: {
          ...DEFAULT_TEXT_STYLE,
          ...textClip.textStyle,
          ...params.style,
          text,
        },
      }
    }
  } else {
    textClip = {
      id: makeId('clip-text'),
      assetId: null,
      type: 'text',
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: true,
      volume: 1,
      trackIndex: trackIdx,
      asset: null,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      transform: { ...DEFAULT_CLIP_TRANSFORM },
      opacity: 100,
      textStyle: {
        ...DEFAULT_TEXT_STYLE,
        ...(params.style || {}),
        text,
      },
    }
  }

  next = replaceActiveTimeline(next, timeline => ({
    ...timeline,
    clips: resolveOverlaps([...timeline.clips, textClip], new Set([textClip.id])),
  }))
  next = setSelectedClipIds(next, new Set([textClip.id]))
  next = setCurrentTime(next, startTime + 0.1)
  return next
}


export function setClipOpacity(state: EditorState, clipId: string, opacity: number): EditorState {
  return updateClip(state, clipId, { opacity })
}

export function setClipFlipH(state: EditorState, clipId: string, value: boolean): EditorState {
  return updateClip(state, clipId, { flipH: value })
}

export function setClipFlipV(state: EditorState, clipId: string, value: boolean): EditorState {
  return updateClip(state, clipId, { flipV: value })
}

export function setClipColorLabel(state: EditorState, clipId: string, colorLabel?: string): EditorState {
  return updateClip(state, clipId, { colorLabel })
}


export function setClipColorCorrectionField<K extends keyof ColorCorrection>(
  state: EditorState,
  clipId: string,
  field: K,
  value: ColorCorrection[K],
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    colorCorrection: {
      ...(clip.colorCorrection || DEFAULT_COLOR_CORRECTION),
      [field]: value,
    },
  })
}

export function resetClipColorCorrection(state: EditorState, clipId: string): EditorState {
  return updateClip(state, clipId, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })
}

export function setClipLetterbox(state: EditorState, clipId: string, patch: Partial<LetterboxSettings>): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    letterbox: {
      ...(clip.letterbox || DEFAULT_LETTERBOX),
      ...patch,
    },
  })
}

export function setClipTextStyleField<K extends keyof TextOverlayStyle>(
  state: EditorState,
  clipId: string,
  field: K,
  value: TextOverlayStyle[K],
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    textStyle: {
      ...(clip.textStyle || DEFAULT_TEXT_STYLE),
      [field]: value,
    },
  })
}

export function updateClipTextStyle(
  state: EditorState,
  clipId: string,
  patch: Partial<TextOverlayStyle>,
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip) return state
  return updateClip(state, clipId, {
    textStyle: {
      ...(clip.textStyle || DEFAULT_TEXT_STYLE),
      ...patch,
    },
  })
}

export function setClipTextPosition(
  state: EditorState,
  clipId: string,
  positionX: number,
  positionY: number,
): EditorState {
  const clip = selectClips(state).find(candidate => candidate.id === clipId)
  if (!clip?.textStyle) return state
  const clamp = (value: number) => Math.max(0, Math.min(100, value))
  const round1 = (value: number) => Math.round(value * 10) / 10
  return updateClip(state, clipId, {
    textStyle: {
      ...clip.textStyle,
      positionX: round1(clamp(positionX)),
      positionY: round1(clamp(positionY)),
    },
  })
}


export function setClipTransform(
  state: EditorState,
  clipId: string,
  transform: Partial<ClipTransform>,
  options?: { recordKeyframeAt?: number },
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  let nextState = updateClip(state, clipId, {
    transform: {
      ...(clip.transform || DEFAULT_CLIP_TRANSFORM),
      ...transform,
    },
  })

  if (options?.recordKeyframeAt !== undefined) {
    const t = options.recordKeyframeAt
    for (const [key, value] of Object.entries(transform)) {
      if (value !== undefined && typeof value === 'number') {
        const prop = `transform.${key}` as KeyframeProperty
        const hasTrack = clip.keyframes?.some(tr => tr.property === prop)
        if (hasTrack) {
          nextState = setKeyframe(nextState, clipId, prop, t, value)
        }
      }
    }
  }

  return nextState
}

export function setCropMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      cropMode: enabled,
    },
  }))
}

export function toggleCropMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      cropMode: !session.ui.cropMode,
    },
  }))
}


export function applyTextPresetToClip(state: EditorState, clipId: string, presetId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'text') return state
  const updated = applyTextPreset(clip, presetId)
  return updateClip(state, clipId, updated)
}

export function applyTextAnimationToClip(state: EditorState, clipId: string, animationId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'text') return state
  const updated = applyTextAnimation(clip, animationId)
  return updateClip(state, clipId, updated)
}

/* =========================================================================
 * Keyframe Actions (KE-201)
 * ========================================================================= */

export function setKeyframe(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
  value: number,
  easing: KeyframeEasing = 'linear',
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const currentTracks = clip.keyframes ? [...clip.keyframes] : []
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  const clampedT = Math.max(0, Math.min(clip.duration, Math.round(t * 1000) / 1000))

  let targetTrack = trackIdx >= 0 ? { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] } : { property, points: [] }

  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - clampedT) <= 0.04)
  if (pointIdx >= 0) {
    const isBoundary = Math.abs(targetTrack.points[pointIdx].t - clip.duration) < 0.001 || targetTrack.points[pointIdx].t === 0
    targetTrack.points[pointIdx] = {
      t: isBoundary ? targetTrack.points[pointIdx].t : clampedT,
      value,
      easing,
    }
  } else {
    targetTrack.points.push({ t: clampedT, value, easing })
  }
  targetTrack.points.sort((a, b) => a.t - b.t)

  if (trackIdx >= 0) {
    currentTracks[trackIdx] = targetTrack
  } else {
    currentTracks.push(targetTrack)
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function setKeyframePoints(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  points: Array<{ t: number; value: number; easing?: KeyframeEasing }>,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const currentTracks = clip.keyframes ? [...clip.keyframes] : []
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  const sanitizedPoints: KeyframePoint[] = points.map(p => ({
    t: Math.max(0, Math.min(clip.duration, Math.round(p.t * 1000) / 1000)),
    value: p.value,
    easing: p.easing || 'linear',
  })).sort((a, b) => a.t - b.t)

  const targetTrack: KeyframeTrack = {
    property,
    points: sanitizedPoints,
  }

  if (trackIdx >= 0) {
    currentTracks[trackIdx] = targetTrack
  } else {
    currentTracks.push(targetTrack)
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function removeKeyframeAt(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = currentTracks[trackIdx]
  const filteredPoints = targetTrack.points.filter(p => Math.abs(p.t - t) > 0.04)

  if (filteredPoints.length === 0) {
    currentTracks.splice(trackIdx, 1)
  } else {
    currentTracks[trackIdx] = { ...targetTrack, points: filteredPoints }
  }

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function removeKeyframeGroupAt(
  state: EditorState,
  clipId: string,
  t: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = clip.keyframes
    .map(track => ({
      ...track,
      points: track.points.filter(p => Math.abs(p.t - t) > 0.04),
    }))
    .filter(track => track.points.length > 0)

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function moveKeyframeGroup(
  state: EditorState,
  clipId: string,
  fromT: number,
  toT: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const clampedToT = Math.max(0, Math.min(clip.duration, Math.round(toT * 1000) / 1000))

  const currentTracks = clip.keyframes.map(track => {
    const pointIdx = track.points.findIndex(p => Math.abs(p.t - fromT) <= 0.04)
    if (pointIdx < 0) return track
    const newPoints = [...track.points]
    newPoints[pointIdx] = {
      ...newPoints[pointIdx],
      t: clampedToT,
    }
    newPoints.sort((a, b) => a.t - b.t)
    return {
      ...track,
      points: newPoints,
    }
  })

  let nextState = updateClip(state, clipId, { keyframes: currentTracks })
  nextState = updateSession(nextState, session => ({
    ...session,
    selection: {
      ...session.selection,
      selectedKeyframe: { clipId, t: clampedToT },
    },
  }))
  return nextState
}

export function moveKeyframe(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  fromT: number,
  toT: number,
  _tolerance?: number,
  newValue?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] }
  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - fromT) <= 0.04)
  if (pointIdx < 0) return state

  const clampedToT = Math.max(0, Math.min(clip.duration, Math.round(toT * 1000) / 1000))
  targetTrack.points[pointIdx] = {
    ...targetTrack.points[pointIdx],
    t: clampedToT,
    ...(newValue !== undefined ? { value: newValue } : {}),
  }
  targetTrack.points.sort((a, b) => a.t - b.t)
  currentTracks[trackIdx] = targetTrack

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function setKeyframeEasing(
  state: EditorState,
  clipId: string,
  property: KeyframeProperty,
  t: number,
  easing: KeyframeEasing,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state

  const currentTracks = [...clip.keyframes]
  const trackIdx = currentTracks.findIndex(tr => tr.property === property)
  if (trackIdx < 0) return state

  const targetTrack = { ...currentTracks[trackIdx], points: [...currentTracks[trackIdx].points] }
  const pointIdx = targetTrack.points.findIndex(p => Math.abs(p.t - t) <= 0.04)
  if (pointIdx < 0) return state

  targetTrack.points[pointIdx] = { ...targetTrack.points[pointIdx], easing }
  currentTracks[trackIdx] = targetTrack

  return updateClip(state, clipId, { keyframes: currentTracks })
}

export function clearKeyframes(state: EditorState, clipId: string, property?: KeyframeProperty): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || !clip.keyframes) return state
  if (!property) {
    return updateClip(state, clipId, { keyframes: undefined })
  }
  const filtered = clip.keyframes.filter(tr => tr.property !== property)
  return updateClip(state, clipId, {
    keyframes: filtered.length > 0 ? filtered : undefined,
  })
}

/* =========================================================================
 * Audio Fade, Normalization, Ducking & Detach Actions
 * ========================================================================= */

export function setAudioFade(
  state: EditorState,
  clipId: string,
  fadeIn?: number,
  fadeOut?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  const duration = clip.duration
  const currentKeyframes = clip.keyframes ? [...clip.keyframes] : []

  if (fadeIn === 0 && fadeOut === 0) {
    const remainingTracks = currentKeyframes.filter(tr => tr.property !== 'volume')
    return updateClip(state, clipId, {
      keyframes: remainingTracks.length > 0 ? remainingTracks : undefined,
    })
  }
  let volumeTrackIdx = currentKeyframes.findIndex(tr => tr.property === 'volume')
  let points = volumeTrackIdx >= 0 ? [...currentKeyframes[volumeTrackIdx].points] : []

  const baseVolume = clip.volume ?? 1.0

  if (fadeIn !== undefined) {
    const fadeDuration = Math.max(0, Math.min(duration, fadeIn))
    points = points.filter(p => p.t > fadeDuration && Math.abs(p.t - 0) > 0.02)
    if (fadeDuration > 0) {
      points.push({ t: 0, value: 0, easing: 'linear' })
      points.push({ t: fadeDuration, value: baseVolume, easing: 'linear' })
    }
  }

  if (fadeOut !== undefined) {
    const fadeDuration = Math.max(0, Math.min(duration, fadeOut))
    const fadeStart = Math.max(0, duration - fadeDuration)
    points = points.filter(p => p.t < fadeStart && Math.abs(p.t - duration) > 0.02)
    if (fadeDuration > 0) {
      points.push({ t: fadeStart, value: baseVolume, easing: 'linear' })
      points.push({ t: duration, value: 0, easing: 'linear' })
    }
  }

  points.sort((a, b) => a.t - b.t)
  if (volumeTrackIdx >= 0) {
    currentKeyframes[volumeTrackIdx] = { property: 'volume', points }
  } else if (points.length > 0) {
    currentKeyframes.push({ property: 'volume', points })
  }

  return updateClip(state, clipId, { keyframes: currentKeyframes })
}

export function normalizeClipAudio(
  state: EditorState,
  clipId: string,
  targetLufs: number = -14,
  currentLufs?: number,
  gainDb?: number,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state

  let calculatedGainDb = gainDb
  if (calculatedGainDb === undefined && currentLufs !== undefined) {
    calculatedGainDb = targetLufs - currentLufs
  }
  if (calculatedGainDb === undefined) {
    calculatedGainDb = 0
  }

  const multiplier = Math.pow(10, calculatedGainDb / 20)
  const currentVol = clip.volume ?? 1.0
  const nextVol = Math.max(0, Math.min(4.0, currentVol * multiplier))

  return updateClip(state, clipId, { volume: nextVol })
}

export function duckClipAudio(
  state: EditorState,
  musicClipId: string,
  speechIntervals: Array<{ start: number; end: number }>,
  options?: {
    duckingDb?: number
    attack?: number
    release?: number
  },
): EditorState {
  const clip = selectClipById(state, musicClipId)
  if (!clip) return state
  const ducked = applyDuckingKeyframes(clip, speechIntervals, options)
  return updateClip(state, musicClipId, ducked)
}

export function detachAudio(state: EditorState, clipId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'video' || clip.muted) return state

  let next = state
  const tracks = selectTracks(next)
  let audioTrackIndex = tracks.findIndex(t => t.kind === 'audio' && !t.locked)
  if (audioTrackIndex === -1) {
    next = addTrack(next, 'audio')
    audioTrackIndex = selectTracks(next).length - 1
  }

  const asset = clip.asset ?? (clip.assetId ? state.editorModel.assets.find(a => a.id === clip.assetId) ?? null : null)
  const audioClipId = makeId('clip-audio')
  const audioClip: TimelineClip = {
    id: audioClipId,
    assetId: clip.assetId,
    type: 'audio',
    startTime: clip.startTime,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    speed: clip.speed,
    reversed: clip.reversed,
    muted: false,
    volume: clip.volume ?? 1.0,
    trackIndex: audioTrackIndex,
    asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    linkedClipIds: [clip.id],
  }

  next = updateClip(next, clip.id, {
    muted: true,
    linkedClipIds: [...(clip.linkedClipIds || []), audioClipId],
  })

  return replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [...tl.clips, audioClip],
  }))
}

/* =========================================================================
 * Timeline Transitions Actions
 * ========================================================================= */

