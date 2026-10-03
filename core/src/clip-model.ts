import { z } from 'zod'
import { clipBlendModeSchema, type ClipBlendMode } from './blend-modes'

export { clipBlendModeSchema, type ClipBlendMode }

export const effectTypeValues = [
  'blur',
  'sharpen',
  'glow',
  'vignette',
  'grain',
] as const
export const effectMaskShapeValues = ['rectangle', 'ellipse'] as const
export const letterboxAspectRatioValues = ['2.35:1', '2.39:1', '2.76:1', '1.85:1', '4:3', 'custom'] as const

export const fontWeightValues = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const
export const fontStyleValues = ['normal', 'italic'] as const
export const textAlignValues = ['left', 'center', 'right'] as const

export const colorCorrectionSchema = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  exposure: z.number(),
  highlights: z.number(),
  shadows: z.number(),
})

export type ColorCorrection = z.infer<typeof colorCorrectionSchema>

export const DEFAULT_COLOR_CORRECTION = colorCorrectionSchema.parse({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
})

export const clipTransformSchema = z.object({
  scale: z.number(),
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

export type ClipTransform = z.infer<typeof clipTransformSchema>

export const DEFAULT_CLIP_TRANSFORM = clipTransformSchema.parse({
  scale: 100,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
})

export const letterboxSettingsSchema = z.object({
  enabled: z.boolean(),
  aspectRatio: z.enum(letterboxAspectRatioValues),
  customRatio: z.number().optional(),
  color: z.string(),
  opacity: z.number(),
})

export type LetterboxSettings = z.infer<typeof letterboxSettingsSchema>

export const DEFAULT_LETTERBOX = letterboxSettingsSchema.parse({
  enabled: false,
  aspectRatio: '2.35:1',
  color: '#000000',
  opacity: 100,
})

/**
 * @deprecated Legacy effect-level mask schema. Retained for backward-compatibility with older project files.
 * Real clip-level masking was implemented in KE-501 (see clip.mask).
 */
export const effectMaskSchema = z.object({
  enabled: z.boolean(),
  shape: z.enum(effectMaskShapeValues),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  feather: z.number(),
  invert: z.boolean(),
  rotation: z.number(),
})

export type EffectMask = z.infer<typeof effectMaskSchema>

export const DEFAULT_EFFECT_MASK = effectMaskSchema.parse({
  enabled: false,
  shape: 'ellipse',
  x: 50,
  y: 50,
  width: 40,
  height: 40,
  feather: 20,
  invert: false,
  rotation: 0,
})

/**
 * 'linear' is the split line, 'ellipse' the circle, 'mirror' a band across the picture (the
 * filmstrip); the rest are closed shapes drawn inside the mask's width and height.
 */
export const clipMaskShapeValues = ['rectangle', 'ellipse', 'linear', 'mirror', 'star', 'heart'] as const
export const clipMaskShapeSchema = z.enum(clipMaskShapeValues)
export type ClipMaskShape = typeof clipMaskShapeValues[number]

export const clipMaskSchema = z.object({
  /** Names the mask among its clip's masks; masks saved before there could be several have none. */
  id: z.string().optional(),
  enabled: z.boolean().default(true),
  shape: clipMaskShapeSchema.default('rectangle'),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(50),
  width: z.number().min(1).max(200).default(50),
  height: z.number().min(1).max(200).default(50),
  rotation: z.number().default(0),
  feather: z.number().min(0).max(100).default(0),
  /** Rounds a rectangle's corners, 0 (square) to 100 (as round as the shorter side allows). */
  roundCorners: z.number().min(0).max(100).optional(),
  invert: z.boolean().default(false),
})

export type ClipMask = z.infer<typeof clipMaskSchema>

export const DEFAULT_CLIP_MASK: ClipMask = {
  enabled: true,
  shape: 'rectangle',
  x: 50,
  y: 50,
  width: 50,
  height: 50,
  rotation: 0,
  feather: 0,
  roundCorners: 0,
  invert: false,
}

/**
 * The masks a clip shows through. A clip saved before there could be several keeps its one in
 * `mask`; it is given the id `mask-1` here so it can be picked like the others.
 */
export function getClipMasks(clip: { mask?: ClipMask; masks?: ClipMask[] }): ClipMask[] {
  if (clip.masks) return clip.masks
  return clip.mask ? [{ ...clip.mask, id: clip.mask.id ?? 'mask-1' }] : []
}

/** True when the clip has at least one mask that is switched on. */
export function hasActiveMask(clip: { mask?: ClipMask; masks?: ClipMask[] }): boolean {
  return getClipMasks(clip).some(mask => mask.enabled !== false)
}

export const chromaKeySchema = z.object({
  enabled: z.boolean().default(true),
  color: z.string().default('#00FF00'), // target key color hex, default green screen
  similarity: z.number().min(0).max(100).default(30), // threshold/tolerance %
  smoothness: z.number().min(0).max(100).default(10), // feather/softness %
  spill: z.number().min(0).max(100).default(10), // spill suppression %
  featherEdge: z.number().min(0).max(100).default(0).optional(), // gblur on alpha %
  cleanEdge: z.number().min(0).max(100).default(0).optional(), // erosion on alpha %
})

export type ChromaKey = z.infer<typeof chromaKeySchema>

export const DEFAULT_CHROMA_KEY: ChromaKey = {
  enabled: true,
  color: '#00FF00',
  similarity: 30,
  smoothness: 10,
  spill: 10,
  featherEdge: 0,
  cleanEdge: 0,
}

export const autoMatteModelValues = ['rvm-mobilenetv3', 'modnet'] as const
export type AutoMatteModel = (typeof autoMatteModelValues)[number]

export const autoMatteQualityValues = ['draft', 'standard', 'high'] as const
export type AutoMatteQuality = (typeof autoMatteQualityValues)[number]

export const autoMatteDeviceValues = ['auto', 'gpu', 'cpu'] as const
export const autoMatteDeviceSchema = z.enum(autoMatteDeviceValues)
export type AutoMatteDevice = (typeof autoMatteDeviceValues)[number]

export const autoMatteBakeSchema = z.object({
  path: z.string(),
  fingerprint: z.string(),
  frameCount: z.number(),
  createdAt: z.number(),
  sourceStart: z.number().optional(),
  sourceSpan: z.number().optional(),
  speed: z.number().optional(),
  reversed: z.boolean().optional(),
  model: z.string().optional(),
  quality: z.string().optional(),
  assetKey: z.string().optional(),
})

export type AutoMatteBake = z.infer<typeof autoMatteBakeSchema>

export const autoMatteSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.enum(autoMatteModelValues).default('rvm-mobilenetv3'),
  quality: z.enum(autoMatteQualityValues).default('standard'),
  featherEdge: z.number().min(0).max(100).default(0),
  cleanEdge: z.number().min(0).max(100).default(0),
  bake: autoMatteBakeSchema.optional(),
})

export type AutoMatte = z.infer<typeof autoMatteSchema>

export const DEFAULT_AUTO_MATTE: AutoMatte = {
  enabled: true,
  model: 'rvm-mobilenetv3',
  quality: 'standard',
  featherEdge: 0,
  cleanEdge: 0,
}

export const brushModeValues = ['brush', 'eraser', 'region-brush', 'region-eraser'] as const
export type BrushMode = (typeof brushModeValues)[number]

export const brushStrokeSchema = z.object({
  mode: z.enum(brushModeValues),
  size: z.number().min(0.1).max(50),
  points: z.array(z.tuple([z.number(), z.number()])),
  paintedAt: z.number().min(0),
  region: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    rle: z.string(),
  }).optional(),
})

export type BrushStroke = z.infer<typeof brushStrokeSchema>

export const customMatteSchema = z.object({
  enabled: z.boolean().default(true),
  strokes: z.array(brushStrokeSchema).default([]),
  appliedHash: z.string().optional(),
  bake: autoMatteBakeSchema.optional(),
  motion: z.object({
    t0: z.number(),
    step: z.number().positive(),
    m: z.array(z.number()),
  }).optional(),
})

export type CustomMatte = z.infer<typeof customMatteSchema>

export const DEFAULT_CUSTOM_MATTE: CustomMatte = {
  enabled: true,
  strokes: [],
}

export const stabilizationModeValues = ['auto', 'tripod'] as const
export type StabilizationMode = (typeof stabilizationModeValues)[number]

export const STABILIZATION_SMOOTHING_MIN = 5
export const STABILIZATION_SMOOTHING_MAX = 60

export const stabilizationWarningValues = ['occlusion', 'highZoom'] as const
export type StabilizationWarning = (typeof stabilizationWarningValues)[number]

export const stabilizationBakeSchema = z.object({
  path: z.string(),
  fingerprint: z.string(),
  createdAt: z.number(),
  sourceStart: z.number(),
  sourceSpan: z.number(),
  assetKey: z.string().optional(),
  zoomPercent: z.number().optional(),
  warnings: z.array(z.enum(stabilizationWarningValues)).optional(),
  warningTimes: z.array(z.number()).optional(),
})

export type StabilizationBake = z.infer<typeof stabilizationBakeSchema>

export const clipStabilizationSchema = z.object({
  enabled: z.boolean().default(true),
  smoothing: z.number().min(STABILIZATION_SMOOTHING_MIN).max(STABILIZATION_SMOOTHING_MAX).default(20),
  mode: z.enum(stabilizationModeValues).default('auto'),
  bake: stabilizationBakeSchema.optional(),
})

export type ClipStabilization = z.infer<typeof clipStabilizationSchema>

export const DEFAULT_CLIP_STABILIZATION: ClipStabilization = {
  enabled: true,
  smoothing: 20,
  mode: 'auto',
}

export const strokeStyleValues = [
  'none',
  'solid',
  'straight',
  'offset',
  'dotted',
  'hand-drawn',
  'paper',
  'luminescence',
] as const

export type StrokeStyle = typeof strokeStyleValues[number]

export const clipStrokeSchema = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(strokeStyleValues).default('solid'),
  color: z.string().default('#FFFFFF'),
  width: z.number().min(0).max(100).default(12),
  opacity: z.number().min(0).max(100).default(100),
  offsetX: z.number().min(-100).max(100).default(0),
  offsetY: z.number().min(-100).max(100).default(0),
  glow: z.number().min(0).max(100).default(50),
  roughness: z.number().min(0).max(100).default(50),
  gap: z.number().min(0).max(100).default(50),
  seed: z.number().int().default(0),
})

export type ClipStroke = z.infer<typeof clipStrokeSchema>

export const DEFAULT_CLIP_STROKE: ClipStroke = {
  enabled: true,
  style: 'solid',
  color: '#FFFFFF',
  width: 12,
  opacity: 100,
  offsetX: 0,
  offsetY: 0,
  glow: 50,
  roughness: 50,
  gap: 50,
  seed: 0,
}

export const clipFilterSchema = z.object({
  id: z.string(),
  intensity: z.number().min(0).max(100).default(100),
})

export type ClipFilter = z.infer<typeof clipFilterSchema>

export const clipEffectSchema = z.object({
  id: z.string(),
  type: z.enum(effectTypeValues),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
  mask: effectMaskSchema.optional(),
})

export type EffectType = (typeof effectTypeValues)[number]
export type ClipEffect = z.infer<typeof clipEffectSchema>

export const textOverlayStyleSchema = z.object({
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.enum(fontWeightValues),
  fontStyle: z.enum(fontStyleValues),
  underline: z.boolean().optional(),
  color: z.string(),
  backgroundColor: z.string(),
  textAlign: z.enum(textAlignValues),
  positionX: z.number(),
  positionY: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  shadowColor: z.string(),
  shadowBlur: z.number(),
  shadowOffsetX: z.number(),
  shadowOffsetY: z.number(),
  letterSpacing: z.number(),
  lineHeight: z.number(),
  maxWidth: z.number(),
  padding: z.number(),
  borderRadius: z.number(),
  opacity: z.number(),
})

export type TextOverlayStyle = z.infer<typeof textOverlayStyleSchema>

export const DEFAULT_TEXT_STYLE = textOverlayStyleSchema.parse({
  text: 'Title Text',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: 64,
  fontWeight: 'bold',
  fontStyle: 'normal',
  color: '#FFFFFF',
  backgroundColor: 'transparent',
  textAlign: 'center',
  positionX: 50,
  positionY: 50,
  strokeColor: 'transparent',
  strokeWidth: 0,
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  letterSpacing: 0,
  lineHeight: 1.2,
  maxWidth: 80,
  padding: 0,
  borderRadius: 0,
  opacity: 100,
})

export const keyframePropertyValues = [
  'transform.scale',
  'transform.scaleX',
  'transform.scaleY',
  'transform.positionX',
  'transform.positionY',
  'transform.rotation',
  'opacity',
  'volume',
  'speed',
  'filter.intensity',
  'text.progress',
  'chromaKey.similarity',
  'chromaKey.smoothness',
  'chromaKey.spill',
  'chromaKey.featherEdge',
  'chromaKey.cleanEdge',
] as const

export const keyframePropertySchema = z.enum(keyframePropertyValues)
export type KeyframeProperty = typeof keyframePropertyValues[number]

export const keyframeEasingValues = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
] as const

export const keyframeEasingSchema = z.enum(keyframeEasingValues)
export type KeyframeEasing = typeof keyframeEasingValues[number]

export const keyframePointSchema = z.object({
  t: z.number().min(0),
  value: z.number(),
  easing: z.enum(keyframeEasingValues).default('linear'),
})

export type KeyframePoint = z.infer<typeof keyframePointSchema>

export const keyframeTrackSchema = z.object({
  property: z.enum(keyframePropertyValues),
  points: z.array(keyframePointSchema),
})

export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>

export const speedCurvePresetValues = [
  'custom',
  'montage',
  'hero',
  'bullet',
  'jump-cut',
  'flash-in',
  'flash-out',
] as const
export type SpeedCurvePreset = typeof speedCurvePresetValues[number]

export const speedCurvePointSchema = z.object({
  /** Position along the source the clip plays, 0..1, in playback order. */
  x: z.number().min(0).max(1),
  /** Playback speed at that position, 0.1x..10x. */
  v: z.number().min(0.1).max(10),
})
export type SpeedCurvePoint = z.infer<typeof speedCurvePointSchema>

/**
 * A speed that changes smoothly along the clip. See core/src/speed-curve.ts.
 * While a clip has one, its `speed` field holds the curve's mean rate.
 */
export const speedCurveSchema = z.object({
  preset: z.enum(speedCurvePresetValues).default('custom'),
  points: z.array(speedCurvePointSchema).min(2),
  /**
   * The constant speed the clip had before the curve was applied. Turning the
   * curve off returns to it, and with it the clip's original length. Absent
   * on curves with no earlier speed to return to (converted from old keyframes).
   */
  baseSpeed: z.number().positive().optional(),
  /** Reserved for frame blending / optical flow on export. Not used yet. */
  smoothSlowMo: z.enum(['off', 'blend', 'optical-flow']).optional(),
})
export type SpeedCurve = z.infer<typeof speedCurveSchema>

export const shapePropertiesSchema = z.object({
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeDasharray: z.string().optional(),
  cornerRounding: z.number().optional(),
  sides: z.number().optional(),
})

export type ShapeProperties = z.infer<typeof shapePropertiesSchema>
