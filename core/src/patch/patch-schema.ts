import { z } from 'zod'
import type { EditorState } from '../editor-state'
import { komfyTemplateSchema } from '../template-model'
import {
  keyframePropertySchema,
  keyframeEasingSchema,
  timelineBackgroundSchema,
  timelineCoverSchema,
  clipMaskSchema,
  chromaKeySchema,
  autoMatteSchema,
  customMatteSchema,
  clipStrokeSchema,
  stabilizationModeValues,
  STABILIZATION_SMOOTHING_MIN,
  STABILIZATION_SMOOTHING_MAX,
} from '../project-model'
import { clipBlendModeSchema } from '../blend-modes'
import type { ValidationError } from '../validator'

// ── 1. Edit Patch Zod Schema ───────────────────────────────────────────────

export const editPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('split_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    splitTime: z.number().min(0, 'splitTime must be non-negative'),
  }),
  z.object({
    op: z.literal('delete_clips'),
    clipIds: z.array(z.string().min(1)).min(1, 'clipIds must not be empty'),
  }),
  z.object({
    op: z.literal('delete_clip'),
    clipId: z.string().min(1, 'clipId is required'),
  }),
  z.object({
    op: z.literal('cut_range'),
    startTime: z.number().min(0, 'startTime must be non-negative'),
    endTime: z.number().min(0, 'endTime must be non-negative'),
    label: z.string().optional(),
  }).refine(data => data.endTime > data.startTime, {
    message: 'endTime must be greater than startTime',
    path: ['endTime'],
  }),
  z.object({
    op: z.literal('move_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    deltaTime: z.number(),
  }),
  z.object({
    op: z.literal('slip_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    delta: z.number(),
  }),
  z.object({
    op: z.literal('slide_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    delta: z.number(),
  }),
  z.object({
    op: z.literal('update_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('insert_clip'),
    assetId: z.string().min(1, 'assetId is required'),
    trackIndex: z.number().int().min(0).optional(),
    startTime: z.number().min(0, 'startTime must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
  }),
  z.object({
    op: z.literal('add_subtitle'),
    text: z.string().min(1, 'text is required'),
    startTime: z.number().min(0, 'startTime must be non-negative'),
    endTime: z.number().min(0, 'endTime must be non-negative'),
    trackIndex: z.number().int().min(0).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    preset: z.string().optional(),
  }).refine(data => data.endTime > data.startTime, {
    message: 'endTime must be greater than startTime',
    path: ['endTime'],
  }),
  z.object({
    op: z.literal('import_srt'),
    content: z.string().min(1, 'content is required'),
    targetTrackIndex: z.number().int().min(0).optional(),
    chunk: z.boolean().optional(),
    minWords: z.number().int().positive().optional(),
    maxWords: z.number().int().positive().optional(),
    maxChars: z.number().int().positive().optional(),
    preset: z.string().optional(),
  }),
  z.object({
    op: z.literal('chunk_subtitles'),
    trackIndex: z.number().int().min(0).optional(),
    minWords: z.number().int().positive().optional(),
    maxWords: z.number().int().positive().optional(),
    maxChars: z.number().int().positive().optional(),
    preset: z.string().optional(),
  }),
  z.object({
    op: z.literal('add_text'),
    text: z.string().min(1, 'text is required'),
    startTime: z.number().min(0, 'startTime must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
    trackIndex: z.number().int().min(0).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    preset: z.string().optional(),
    animation: z.string().optional(),
  }),
  z.object({
    op: z.literal('apply_text_preset'),
    clipId: z.string().min(1, 'clipId is required'),
    preset: z.string().min(1, 'preset is required'),
  }),
  z.object({
    op: z.literal('apply_text_animation'),
    clipId: z.string().min(1, 'clipId is required'),
    animation: z.string().min(1, 'animation is required'),
  }),
  z.object({
    op: z.literal('add_sticker'),
    /** Built-in sticker id (e.g. 'star', 'fire', 'heart') or path to PNG/WebP file. */
    stickerId: z.string().min(1, 'stickerId is required'),
    startTime: z.number().min(0, 'startTime must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
    trackIndex: z.number().int().min(0).optional(),
    scale: z.number().positive('scale must be positive').optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(100).optional(),
  }),
  z.object({
    op: z.literal('add_sfx'),
    /** Built-in sound effect id (e.g. 'whoosh', 'ding', 'pop') or filename. */
    sfxId: z.string().min(1, 'sfxId is required'),
    startTime: z.number().min(0, 'startTime must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
    trackIndex: z.number().int().min(0).optional(),
    volume: z.number().min(0).max(4).optional(),
  }),
  z.object({
    op: z.literal('set_transition'),
    leftClipId: z.string().min(1, 'leftClipId is required'),
    rightClipId: z.string().min(1, 'rightClipId is required'),
    /** An id from TRANSITION_DEFINITIONS; see core/src/transitions.ts. */
    type: z.string().min(1, 'type is required'),
    duration: z.number().positive('duration must be positive').optional(),
  }),
  z.object({
    op: z.literal('remove_transition'),
    leftClipId: z.string().min(1, 'leftClipId is required'),
    rightClipId: z.string().min(1, 'rightClipId is required'),
  }),
  z.object({
    op: z.literal('add_subtitle_track'),
    name: z.string().optional(),
  }),
  z.object({
    op: z.literal('set_filter'),
    clipId: z.string().min(1, 'clipId is required'),
    filterId: z.string().min(1, 'filterId is required'),
    intensity: z.number().min(0).max(100).optional(),
  }),
  z.object({
    op: z.literal('remove_filter'),
    clipId: z.string().min(1, 'clipId is required'),
  }),
  z.object({
    op: z.literal('add_filter_clip'),
    filterId: z.string().min(1, 'filterId is required'),
    intensity: z.number().min(0).max(100).optional(),
    startTime: z.number().min(0, 'startTime must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
    trackIndex: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal('detach_audio'),
    clipId: z.string().min(1, 'clipId is required'),
  }),
  z.object({
    op: z.literal('set_keyframe'),
    clipId: z.string().min(1, 'clipId is required'),
    property: keyframePropertySchema,
    t: z.number().min(0, 't must be non-negative'),
    value: z.number(),
    easing: keyframeEasingSchema.optional(),
  }),
  z.object({
    op: z.literal('set_keyframes'),
    clipId: z.string().min(1, 'clipId is required'),
    property: keyframePropertySchema,
    points: z.array(z.object({
      t: z.number().min(0, 't must be non-negative'),
      value: z.number(),
      easing: keyframeEasingSchema.optional(),
    })).min(1, 'points must contain at least 1 keyframe point'),
  }),
  z.object({
    op: z.literal('remove_keyframe'),
    clipId: z.string().min(1, 'clipId is required'),
    property: keyframePropertySchema,
    t: z.number().min(0, 't must be non-negative'),
  }),
  z.object({
    op: z.literal('clear_keyframes'),
    clipId: z.string().min(1, 'clipId is required'),
    property: keyframePropertySchema.optional(),
  }),
  z.object({
    op: z.literal('set_audio_fade'),
    clipId: z.string().min(1, 'clipId is required'),
    fadeIn: z.number().min(0, 'fadeIn must be non-negative').optional(),
    fadeOut: z.number().min(0, 'fadeOut must be non-negative').optional(),
  }),
  z.object({
    op: z.literal('normalize_audio'),
    clipId: z.string().min(1, 'clipId is required'),
    targetLufs: z.number().optional().default(-14),
    currentLufs: z.number().optional(),
    gainDb: z.number().optional(),
  }),
  z.object({
    op: z.literal('duck_audio'),
    musicClipId: z.string().min(1, 'musicClipId is required'),
    speechIntervals: z.array(z.object({
      start: z.number().min(0, 'speech interval start must be non-negative'),
      end: z.number().min(0, 'speech interval end must be non-negative'),
    })).min(1, 'speechIntervals must not be empty'),
    duckingDb: z.number().optional().default(-12),
    attack: z.number().min(0).optional().default(0.3),
    release: z.number().min(0).optional().default(0.5),
  }),
  z.object({
    op: z.literal('set_timeline_dimensions'),
    timelineId: z.string().optional(),
    width: z.number().int().positive('width must be positive'),
    height: z.number().int().positive('height must be positive'),
    fps: z.number().positive('fps must be positive').optional(),
  }),
  z.object({
    op: z.literal('set_timeline_background'),
    timelineId: z.string().optional(),
    background: timelineBackgroundSchema,
  }),
  z.object({
    op: z.literal('set_canvas'),
    timelineId: z.string().optional(),
    width: z.number().int().positive('width must be positive').optional(),
    height: z.number().int().positive('height must be positive').optional(),
    fps: z.number().positive('fps must be positive').optional(),
    background: timelineBackgroundSchema.optional(),
  }),
  z.object({
    op: z.literal('set_mask'),
    clipId: z.string().min(1, 'clipId is required'),
    mask: clipMaskSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal('set_chroma_key'),
    clipId: z.string().min(1, 'clipId is required'),
    chromaKey: chromaKeySchema.nullable().optional(),
  }),
  z.object({
    op: z.literal('set_auto_matte'),
    clipId: z.string().min(1, 'clipId is required'),
    autoMatte: autoMatteSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal('set_custom_matte'),
    clipId: z.string().min(1, 'clipId is required'),
    customMatte: customMatteSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal('replace_clip'),
    clipId: z.string().min(1, 'clipId is required'),
    /** A video or image asset already in the project (media_list). */
    assetId: z.string().min(1, 'assetId is required'),
    /** Where in a replacing video the clip starts, in seconds. Default: its beginning. */
    sourceStart: z.number().min(0).optional(),
  }),
  z.object({
    op: z.literal('set_stabilization'),
    clipId: z.string().min(1, 'clipId is required'),
    /**
     * Settings only. The bake is the editor's to make and record: it runs in the
     * background once the patch is applied, so an agent never supplies one.
     * null removes stabilization from the clip.
     */
    stabilization: z.object({
      enabled: z.boolean().optional(),
      smoothing: z.number().min(STABILIZATION_SMOOTHING_MIN).max(STABILIZATION_SMOOTHING_MAX).optional(),
      mode: z.enum(stabilizationModeValues).optional(),
    }).strict().nullable().optional(),
  }),
  z.object({
    op: z.literal('set_stroke'),
    clipId: z.string().min(1, 'clipId is required'),
    stroke: clipStrokeSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal('set_blend_mode'),
    clipId: z.string().min(1, 'clipId is required'),
    blendMode: clipBlendModeSchema,
  }),
  z.object({
    op: z.literal('add_marker'),
    time: z.number().min(0, 'time must be non-negative'),
    label: z.string().optional(),
    color: z.string().optional(),
    id: z.string().optional(),
  }),
  z.object({
    op: z.literal('delete_marker'),
    markerId: z.string().min(1, 'markerId is required'),
  }),
  z.object({
    op: z.literal('update_marker'),
    markerId: z.string().min(1, 'markerId is required'),
    time: z.number().min(0, 'time must be non-negative').optional(),
    label: z.string().optional(),
    color: z.string().optional(),
  }),
  z.object({
    op: z.literal('freeze_frame'),
    clipId: z.string().min(1, 'clipId is required'),
    time: z.number().min(0, 'time must be non-negative').optional(),
    duration: z.number().positive('duration must be positive').optional(),
    imageAssetId: z.string().optional(),
    imagePath: z.string().optional(),
  }),
  z.object({
    op: z.literal('punch_in_cut'),
    clipId: z.string().min(1, 'clipId is required'),
    scale: z.number().positive('scale must be positive').optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  }),
  z.object({
    op: z.literal('punch_in_sequence'),
    trackIndex: z.number().int().min(0).optional(),
    scale: z.number().positive('scale must be positive').optional(),
    startWithZoom: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('create_highlight_short'),
    sourceClipId: z.string().min(1, 'sourceClipId is required'),
    startTime: z.number().min(0, 'startTime must be non-negative'),
    endTime: z.number().min(0, 'endTime must be non-negative'),
    hookText: z.string().optional(),
    hookPreset: z.string().optional(),
    hookDuration: z.number().positive('hookDuration must be positive').optional(),
    targetDimensions: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    }).optional(),
  }).refine(data => data.endTime > data.startTime, {
    message: 'endTime must be greater than startTime',
    path: ['endTime'],
  }),
  z.object({
    op: z.literal('insert_broll'),
    assetId: z.string().optional(),
    assetPath: z.string().optional(),
    startTime: z.number().min(0, 'startTime must be non-negative'),
    duration: z.number().positive('duration must be positive'),
    trackIndex: z.number().int().min(0).optional(),
    fadeIn: z.number().min(0).max(2).optional(),
    fadeOut: z.number().min(0).max(2).optional(),
    muteAudio: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('duplicate_timeline'),
    timelineId: z.string().optional(),
    name: z.string().optional(),
    variantTag: z.string().optional(),
  }),
  z.object({
    op: z.literal('switch_timeline'),
    timelineId: z.string().min(1, 'timelineId is required'),
  }),
  z.object({
    op: z.literal('delete_timeline'),
    timelineId: z.string().min(1, 'timelineId is required'),
  }),
  z.object({
    op: z.literal('set_timeline_variant'),
    timelineId: z.string().optional(),
    name: z.string().optional(),
    variantTag: z.string().optional(),
    description: z.string().optional(),
  }),
  /*
   * Applying a saved template. The template itself travels inline rather than
   * by name: the agent may be looking at a template file the app has never
   * loaded, and a patch that depends on the app's current library would
   * describe one thing and do another on a different machine.
   *
   * `bindings` says which project asset fills which slot. A slot nobody binds
   * is left empty on purpose — an unfilled hole the user can see beats media
   * chosen for them.
   */
  z.object({
    op: z.literal('apply_template'),
    template: komfyTemplateSchema,
    bindings: z.array(z.object({
      slotIndex: z.number().int().positive(),
      assetId: z.string().min(1, 'assetId is required'),
    })).default([]),
    name: z.string().optional(),
    variantTag: z.string().optional(),
  }),
  z.object({
    op: z.literal('set_cover'),
    cover: timelineCoverSchema.optional(),
  }),
])

export type EditPatchOperation = z.infer<typeof editPatchOperationSchema>

export const editPatchSchema = z.object({
  version: z.literal(1).default(1),
  description: z.string().optional(),
  operations: z.array(editPatchOperationSchema).min(1, 'operations must not be empty'),
})

export type EditPatch = z.infer<typeof editPatchSchema>

export type PatchValidationResult =
  | { valid: true; data: EditPatch }
  | { valid: false; error: string; issues?: z.ZodIssue[] }

export type PatchApplyResult =
  | {
      success: true
      state: EditorState
      description: string
      appliedCount: number
    }
  | {
      success: false
      state: EditorState
      error: string
      validationErrors?: ValidationError[]
    }
