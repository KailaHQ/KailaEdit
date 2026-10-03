import type {
  ClipMask,
  ClipMaskShape,
  ChromaKey,
  AutoMatte,
  CustomMatte,
  BrushStroke,
  BrushMode,
  ClipStroke,
  ClipBlendMode,
  ClipStabilization,
  StabilizationBake,
} from '../project-model'
import {
  DEFAULT_CLIP_MASK,
  getClipMasks,
  DEFAULT_CHROMA_KEY,
  DEFAULT_AUTO_MATTE,
  DEFAULT_CUSTOM_MATTE,
  DEFAULT_CLIP_STROKE,
  DEFAULT_CLIP_STABILIZATION,
} from '../project-model'
import { makeId } from '../id-generator'
import { clampStabilizationSmoothing } from '../stabilization'
import type { EditorState } from '../editor-state'
import { selectActiveTimeline, selectClipById } from '../editor-selectors'
import { defaultMaskSize } from '../mask-shapes'
import { getEffectiveTimelineDimensions } from '../video-resolution'
import { updateSession } from './action-helpers'
import { updateClip } from './clip-core-actions'

export function setMaskMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      maskMode: enabled,
    },
  }))
}

export function toggleMaskMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      maskMode: !session.ui.maskMode,
    },
  }))
}

export function setEyedropperMode(state: EditorState, enabled: boolean): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      eyedropperMode: enabled,
    },
  }))
}

export function toggleEyedropperMode(state: EditorState): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      eyedropperMode: !session.ui.eyedropperMode,
    },
  }))
}

export function setCustomMatteBrushMode(state: EditorState, mode: BrushMode | null): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      customMatteBrushMode: mode,
    },
  }))
}

export function setCustomMatteBrushSize(state: EditorState, size: number): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: {
      ...session.ui,
      customMatteBrushSize: Math.max(0.1, Math.min(50, size)),
    },
  }))
}

/** Which of the selected clip's masks the panel and the canvas handles are editing. */
export function setActiveMaskId(state: EditorState, maskId: string | null): EditorState {
  return updateSession(state, session => ({
    ...session,
    ui: { ...session.ui, activeMaskId: maskId },
  }))
}

/** The mask being edited: the picked one, else the first. */
function pickMask(state: EditorState, masks: ClipMask[]): ClipMask | undefined {
  const activeId = state.session.ui.activeMaskId
  return masks.find(mask => mask.id === activeId) ?? masks[0]
}

function writeMasks(state: EditorState, clipId: string, masks: ClipMask[]): EditorState {
  // The single-mask field is retired once the clip is edited; masks live in the list from here on.
  return updateClip(state, clipId, { mask: undefined, masks: masks.length > 0 ? masks : undefined })
}

/** The picture's width over its height: the clip's own, else the timeline's frame. */
function pictureAspect(state: EditorState, clip: { asset?: { width?: number; height?: number } | null }): number {
  const width = clip.asset?.width
  const height = clip.asset?.height
  if (width && height && width > 0 && height > 0) return width / height
  return getEffectiveTimelineDimensions(selectActiveTimeline(state)).aspectRatio || 1
}

/** Adds a mask of the given shape, sized to look right on this picture, and makes it the one being edited. */
export function addClipMask(state: EditorState, clipId: string, shape: ClipMaskShape = 'rectangle'): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const id = makeId('mask')
  const next = writeMasks(state, clipId, [
    ...getClipMasks(clip),
    { ...DEFAULT_CLIP_MASK, ...defaultMaskSize(shape, pictureAspect(state, clip)), id, shape, enabled: true },
  ])
  return setActiveMaskId(next, id)
}

/** Takes one mask off the clip; the one before it (or the first left) becomes the edited one. */
export function removeClipMask(state: EditorState, clipId: string, maskId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const masks = getClipMasks(clip)
  const index = masks.findIndex(mask => mask.id === maskId)
  if (index < 0) return state
  const remaining = masks.filter(mask => mask.id !== maskId)
  const next = writeMasks(state, clipId, remaining)
  return setActiveMaskId(next, remaining[Math.max(0, index - 1)]?.id ?? null)
}

/**
 * Gives a mask another shape. The size goes back to what a new mask of that shape starts with,
 * because the old width and height only suited the old shape: carried over, a circle taken from
 * a wide rectangle comes out an oval. Position, turn, feather and invert stay.
 */
export function setClipMaskShape(state: EditorState, clipId: string, maskId: string, shape: ClipMaskShape): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const current = getClipMasks(clip).find(mask => mask.id === maskId)
  if (!current) return state
  if (current.shape === shape) return updateClipMask(state, clipId, maskId, { enabled: true })
  return updateClipMask(state, clipId, maskId, { shape, enabled: true, ...defaultMaskSize(shape, pictureAspect(state, clip)) })
}

/** Changes one mask by id: its shape, size, feather and so on. */
export function updateClipMask(state: EditorState, clipId: string, maskId: string, patch: Partial<ClipMask>): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const masks = getClipMasks(clip)
  if (!masks.some(mask => mask.id === maskId)) return state
  return writeMasks(state, clipId, masks.map(mask => (mask.id === maskId ? { ...mask, ...patch, id: maskId } : mask)))
}

/**
 * Changes the mask being edited, adding one if the clip has none; null removes every mask.
 * The canvas handles and the patch operations speak to the clip this way.
 */
export function setClipMask(state: EditorState, clipId: string, mask: Partial<ClipMask> | null): EditorState {
  if (!mask) return setActiveMaskId(updateClip(state, clipId, { mask: undefined, masks: undefined }), null)
  const clip = selectClipById(state, clipId)
  if (!clip) return state
  const target = pickMask(state, getClipMasks(clip))
  if (!target) {
    const id = makeId('mask')
    return setActiveMaskId(writeMasks(state, clipId, [{ ...DEFAULT_CLIP_MASK, ...mask, id }]), id)
  }
  return updateClipMask(state, clipId, target.id!, mask)
}

export function setClipChromaKey(state: EditorState, clipId: string, chromaKey: Partial<ChromaKey> | null): EditorState {
  if (!chromaKey) return updateClip(state, clipId, { chromaKey: undefined })
  const clip = selectClipById(state, clipId)
  const currentChromaKey = clip?.chromaKey || DEFAULT_CHROMA_KEY
  return updateClip(state, clipId, {
    chromaKey: {
      ...currentChromaKey,
      ...chromaKey,
    },
  })
}

export function setClipAutoMatte(state: EditorState, clipId: string, autoMatte: Partial<AutoMatte> | null): EditorState {
  if (!autoMatte) return updateClip(state, clipId, { autoMatte: undefined })
  const clip = selectClipById(state, clipId)
  const currentAutoMatte = clip?.autoMatte || DEFAULT_AUTO_MATTE
  return updateClip(state, clipId, {
    autoMatte: {
      ...currentAutoMatte,
      ...autoMatte,
    },
  })
}

export function setClipCustomMatte(state: EditorState, clipId: string, customMatte: Partial<CustomMatte> | null): EditorState {
  if (!customMatte) return updateClip(state, clipId, { customMatte: undefined })
  const clip = selectClipById(state, clipId)
  const currentCustomMatte = clip?.customMatte || DEFAULT_CUSTOM_MATTE
  return updateClip(state, clipId, {
    customMatte: {
      ...currentCustomMatte,
      ...customMatte,
    },
  })
}

/**
 * Turns stabilization on, changes its settings, or (with null) removes it.
 *
 * Only video clips can be stabilized. Changing a setting keeps the old bake on the clip:
 * it no longer validates, so the clip plays the original until the new bake lands, and
 * turning the setting back finds the old bake still good.
 */
export function setClipStabilization(
  state: EditorState,
  clipId: string,
  stabilization: Partial<Omit<ClipStabilization, 'bake'>> | null,
): EditorState {
  if (!stabilization) return updateClip(state, clipId, { stabilization: undefined })
  const clip = selectClipById(state, clipId)
  if (!clip || clip.type !== 'video') return state
  const current = clip.stabilization || DEFAULT_CLIP_STABILIZATION
  return updateClip(state, clipId, {
    stabilization: {
      ...current,
      ...stabilization,
      ...(stabilization.smoothing !== undefined
        ? { smoothing: clampStabilizationSmoothing(stabilization.smoothing) }
        : {}),
    },
  })
}

/**
 * Records (or with undefined, forgets) the bake a clip plays. Bookkeeping for the bake
 * keeper, not an edit: callers apply it without an undo step.
 */
export function setClipStabilizationBake(
  state: EditorState,
  clipId: string,
  bake: StabilizationBake | undefined,
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.stabilization) return state
  if (clip.stabilization.bake === bake) return state
  return updateClip(state, clipId, { stabilization: { ...clip.stabilization, bake } })
}

export function addCustomMatteStroke(state: EditorState, clipId: string, stroke: BrushStroke): EditorState {
  const clip = selectClipById(state, clipId)
  const currentCustomMatte = clip?.customMatte || DEFAULT_CUSTOM_MATTE
  return updateClip(state, clipId, {
    customMatte: {
      ...currentCustomMatte,
      enabled: true,
      strokes: [...currentCustomMatte.strokes, stroke],
    },
  })
}

/** Records how the video's picture moves, so the strokes follow it. Not an edit the user made. */
export function setCustomMatteMotion(
  state: EditorState,
  clipId: string,
  motion: CustomMatte['motion'],
): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.customMatte) return state
  return updateClip(state, clipId, { customMatte: { ...clip.customMatte, motion } })
}

export function clearCustomMatteStrokes(state: EditorState, clipId: string): EditorState {
  const clip = selectClipById(state, clipId)
  if (!clip?.customMatte) return state
  return updateClip(state, clipId, {
    customMatte: {
      ...clip.customMatte,
      strokes: [],
      appliedHash: undefined,
      motion: undefined,
    },
  })
}

export function setClipStroke(state: EditorState, clipId: string, stroke: Partial<ClipStroke> | null): EditorState {
  if (!stroke) return updateClip(state, clipId, { stroke: undefined })
  const clip = selectClipById(state, clipId)
  const currentStroke = clip?.stroke || DEFAULT_CLIP_STROKE
  return updateClip(state, clipId, {
    stroke: {
      ...currentStroke,
      ...stroke,
    },
  })
}

export function setClipBlendMode(state: EditorState, clipId: string, blendMode?: ClipBlendMode): EditorState {
  return updateClip(state, clipId, { blendMode: blendMode ?? 'normal' })
}
