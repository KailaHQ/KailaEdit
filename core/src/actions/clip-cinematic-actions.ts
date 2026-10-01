import type {
  TimelineClip,
} from '../project-model'
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectCurrentTime,
  selectClipById,
} from '../editor-selectors'
import { makeId } from '../id-generator'
import { applyTemplate, type TemplateBinding } from '../template-apply'
import type { KomfyTemplate } from '../template-model'
import { sliceClipTiming, splitClipTimingAt } from '../speed-curve'
import type { FreezeFrameParams } from './types'
import {
  markEditorModelDirty,
} from './action-helpers'
import { replaceActiveTimeline, switchActiveTimeline, setTimelineSettings } from './timeline-actions'
import { addTextClip, setClipTransform } from './clip-style-actions'
import { addAssetToEditor } from './asset-actions'

export function freezeFrame(state: EditorState, params: FreezeFrameParams): EditorState {
  const timeline = selectActiveTimeline(state)
  const targetClip = timeline?.clips.find(c => c.id === params.clipId)
  if (!targetClip) return state

  const atTime = params.time ?? selectCurrentTime(state)
  const freezeDuration = params.duration ?? 2.0
  const splitPoint = atTime - targetClip.startTime

  if (splitPoint <= 0.05 || splitPoint >= targetClip.duration - 0.05) {
    return state
  }

  let next = state
  const imageAsset = params.imageAsset ?? {
    id: makeId('asset-freeze'),
    type: 'image' as const,
    path: `freeze_${targetClip.id}.jpg`,
    prompt: 'Freeze Frame',
    resolution: targetClip.asset?.resolution || '1920x1080',
    duration: freezeDuration,
    createdAt: Date.now(),
  }

  next = addAssetToEditor(next, imageAsset)

  const secondHalfId = makeId('clip')
  const freezeClipId = makeId('clip-freeze')

  const [firstTiming, secondTiming] = splitClipTimingAt(targetClip, splitPoint)
  const firstHalf: TimelineClip = {
    ...targetClip,
    ...firstTiming,
  }

  const freezeClip: TimelineClip = {
    id: freezeClipId,
    assetId: imageAsset.id,
    type: 'image',
    startTime: targetClip.startTime + splitPoint,
    duration: freezeDuration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex: targetClip.trackIndex,
    asset: imageAsset,
    flipH: targetClip.flipH,
    flipV: targetClip.flipV,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...(targetClip.colorCorrection || DEFAULT_COLOR_CORRECTION) },
    transform: { ...(targetClip.transform || DEFAULT_CLIP_TRANSFORM) },
    opacity: targetClip.opacity ?? 100,
    filter: targetClip.filter ? { ...targetClip.filter } : undefined,
  }

  const secondHalf: TimelineClip = {
    ...targetClip,
    id: secondHalfId,
    ...secondTiming,
    startTime: targetClip.startTime + splitPoint + freezeDuration,
  }

  const rippleDelta = freezeDuration
  const otherClips = timeline!.clips.filter(c => c.id !== targetClip.id).map(c => {
    if (c.trackIndex === targetClip.trackIndex && c.startTime >= targetClip.startTime + splitPoint) {
      return { ...c, startTime: c.startTime + rippleDelta }
    }
    return c
  })

  return replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [...otherClips, firstHalf, freezeClip, secondHalf],
  }))
}

export function punchInClip(
  state: EditorState,
  clipId: string,
  options?: { scale?: number; positionX?: number; positionY?: number },
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const scale = options?.scale ?? 120
  return setClipTransform(state, clipId, {
    scale,
    ...(options?.positionX !== undefined ? { positionX: options.positionX } : {}),
    ...(options?.positionY !== undefined ? { positionY: options.positionY } : {}),
  })
}

export function punchInSequence(
  state: EditorState,
  options?: {
    trackIndex?: number
    scale?: number
    startWithZoom?: boolean
  },
): EditorState {
  const timeline = selectActiveTimeline(state)
  if (!timeline) return state

  const trackIndex = options?.trackIndex ?? 0
  const targetScale = options?.scale ?? 120
  let isZoomed = options?.startWithZoom ?? false

  const sortedClips = [...timeline.clips]
    .filter(c => c.trackIndex === trackIndex && (c.type === 'video' || c.type === 'image'))
    .sort((a, b) => a.startTime - b.startTime)

  let next = state
  for (const clip of sortedClips) {
    const scale = isZoomed ? targetScale : 100
    next = setClipTransform(next, clip.id, { scale })
    isZoomed = !isZoomed
  }

  return next
}

export interface CreateHighlightShortParams {
  sourceClipId: string
  startTime: number
  endTime: number
  hookText?: string
  hookPreset?: string
  hookDuration?: number
  targetDimensions?: { width: number; height: number }
}

export function createHighlightShort(
  state: EditorState,
  params: CreateHighlightShortParams,
): EditorState {
  const timeline = selectActiveTimeline(state)
  const sourceClip = timeline?.clips.find(c => c.id === params.sourceClipId)
  if (!timeline || !sourceClip) return state

  const clipStart = sourceClip.startTime
  const slice = sliceClipTiming(sourceClip, params.startTime - clipStart, params.endTime - clipStart)
  const trimStart = slice.trimStart
  const duration = params.endTime - params.startTime
  const dims = params.targetDimensions || { width: 1080, height: 1920 }

  let next = state
  next = setTimelineSettings(next, timeline.id, {
    width: dims.width,
    height: dims.height,
  })

  const shortVideoClip: TimelineClip = {
    ...sourceClip,
    id: makeId('clip-short'),
    startTime: 0,
    duration,
    trimStart,
    trimEnd: sourceClip.trimEnd,
    speed: slice.speed,
    speedCurve: slice.speedCurve,
    trackIndex: 0,
  }

  const hookDuration = params.hookDuration ?? 3.0
  const hookText = params.hookText || 'Viral Hook!'
  const hookPreset = params.hookPreset || 'headline-alert'

  next = replaceActiveTimeline(next, tl => ({
    ...tl,
    clips: [shortVideoClip],
  }))

  next = addTextClip(next, {
    startTime: 0,
    duration: hookDuration,
    trackIndex: 1,
    preset: hookPreset,
    style: { text: hookText },
  })

  return next
}

export function applyTemplateAsTimeline(
  state: EditorState,
  params: {
    template: KomfyTemplate
    bindings: ReadonlyArray<{ slotIndex: number; assetId: string }>
    name?: string
    variantTag?: string
  },
): EditorState {
  const assets = state.editorModel.assets
  const resolved: TemplateBinding[] = []
  for (const binding of params.bindings) {
    const asset = assets.find(candidate => candidate.id === binding.assetId)
    if (asset) resolved.push({ slotIndex: binding.slotIndex, asset })
  }

  const applied = applyTemplate(params.template, resolved, {
    name: params.name ?? params.template.name,
    variantTag: params.variantTag ?? 'template',
  })

  const next = markEditorModelDirty({
    ...state,
    editorModel: {
      ...state.editorModel,
      timelines: [...state.editorModel.timelines, applied.timeline],
    },
  })

  return switchActiveTimeline(next, applied.timeline.id)
}
