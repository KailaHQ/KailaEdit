import type {
  ClipMask,
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
  DEFAULT_CHROMA_KEY,
  DEFAULT_AUTO_MATTE,
  DEFAULT_CUSTOM_MATTE,
  DEFAULT_CLIP_STROKE,
  DEFAULT_CLIP_STABILIZATION,
} from '../project-model'
import { clampStabilizationSmoothing } from '../stabilization'
import type { EditorState } from '../editor-state'
import { selectClipById } from '../editor-selectors'
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

export function setClipMask(state: EditorState, clipId: string, mask: Partial<ClipMask> | null): EditorState {
  if (!mask) return updateClip(state, clipId, { mask: undefined })
  const clip = selectClipById(state, clipId)
  const currentMask = clip?.mask || DEFAULT_CLIP_MASK
  return updateClip(state, clipId, {
    mask: {
      ...currentMask,
      ...mask,
    },
  })
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
