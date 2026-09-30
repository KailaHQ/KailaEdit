import { z } from 'zod'
import {
  keyframeTrackSchema,
  clipMaskSchema,
  chromaKeySchema,
  autoMatteSchema,
  clipStrokeSchema,
} from '../../core/src/project-model'

export const exportClipTransform = z.object({
  scale: z.number(),
  /** Per-axis scale, set by the side handles of a shape; absent means uniform `scale`. */
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  positionX: z.number(),
  positionY: z.number(),
  rotation: z.number(),
  cropTop: z.number(),
  cropRight: z.number(),
  cropBottom: z.number(),
  cropLeft: z.number(),
})

export const exportColorCorrection = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  exposure: z.number(),
  highlights: z.number(),
  shadows: z.number(),
})

export const exportClipTransition = z.object({
  type: z.string(),
  duration: z.number(),
})

/** A transition on the cut between two clips; the pair is rendered with xfade. */
export const exportTransition = z.object({
  leftClipId: z.string(),
  rightClipId: z.string(),
  type: z.string(),
  duration: z.number(),
})

export const exportClipEffect = z.object({
  type: z.string(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
})

export const exportTextStyle = z.object({
  text: z.string(),
  fontSize: z.number(),
  color: z.string(),
  backgroundColor: z.string(),
  positionX: z.number(),
  positionY: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  padding: z.number(),
  opacity: z.number(),
})

export const exportClipFilter = z.object({
  id: z.string(),
  intensity: z.number().optional(),
})

export const exportClip = z.object({
  path: z.string(),
  type: z.string(),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  speed: z.number(),
  reversed: z.boolean(),
  flipH: z.boolean(),
  flipV: z.boolean(),
  opacity: z.number(),
  trackIndex: z.number(),
  muted: z.boolean(),
  volume: z.number(),
  id: z.string().optional(),
  linkedClipIds: z.array(z.string()).optional(),
  transform: exportClipTransform.optional(),
  colorCorrection: exportColorCorrection.optional(),
  transitionIn: exportClipTransition.optional(),
  transitionOut: exportClipTransition.optional(),
  filter: exportClipFilter.optional(),
  effects: z.array(exportClipEffect).optional(),
  textStyle: exportTextStyle.optional(),
  keyframes: z.array(keyframeTrackSchema).optional(),
  mask: clipMaskSchema.optional(),
  chromaKey: chromaKeySchema.optional(),
  autoMatte: autoMatteSchema.optional(),
  stroke: clipStrokeSchema.optional(),
  strokeBakePath: z.string().optional(),
  stickerId: z.string().optional(),
  shapeProperties: z.object({
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    strokeDasharray: z.string().optional(),
    cornerRounding: z.number().optional(),
    sides: z.number().optional(),
  }).optional(),
  assetId: z.string().nullable().optional(),
})

export const exportSubtitle = z.object({
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  style: z.object({
    fontSize: z.number(),
    fontFamily: z.string(),
    fontWeight: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    position: z.string(),
    italic: z.boolean(),
  }),
})

export const exportBackground = z.object({
  type: z.enum(['color', 'blur', 'image']).default('color'),
  color: z.string().optional(),
  blur: z.number().optional(),
  imagePath: z.string().optional(),
})

export const exportMarker = z.object({
  id: z.string(),
  time: z.number(),
  label: z.string().optional(),
  color: z.string().optional(),
})
