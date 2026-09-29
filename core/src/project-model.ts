import { z } from 'zod'
import { makeId } from './id-generator'
import { clipBlendModeSchema, type ClipBlendMode } from './blend-modes'

export { clipBlendModeSchema, type ClipBlendMode }

export const assetTypeValues = ['image', 'video', 'audio', 'adjustment'] as const
export const timelineClipTypeValues = [...assetTypeValues, 'text'] as const
export const transitionTypeValues = [
  'none',
  'dissolve',
  'fade-to-black',
  'fade-to-white',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
] as const
export const trackTypeValues = ['default', 'subtitle'] as const
// 'sticker' rows are overlay rows that only ever hold stickers. They are kept
// apart from 'video' so a sticker never lands on a track holding footage or
// text, and so the timeline can draw them shorter than a real video row.
export const trackKindValues = ['video', 'audio', 'sticker'] as const
export const subtitlePositionValues = ['bottom', 'top', 'center'] as const
export const fontWeightValues = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const
export const fontStyleValues = ['normal', 'italic'] as const
export const textAlignValues = ['left', 'center', 'right'] as const
export const effectTypeValues = [
  'blur',
  'sharpen',
  'glow',
  'vignette',
  'grain',
] as const
export const effectMaskShapeValues = ['rectangle', 'ellipse'] as const
export const letterboxAspectRatioValues = ['2.35:1', '2.39:1', '2.76:1', '1.85:1', '4:3', 'custom'] as const
export const viewTypeValues = ['home', 'project'] as const

export const transitionTypeSchema = z.enum(transitionTypeValues)
export const viewTypeSchema = z.enum(viewTypeValues)

export const subtitleStyleSchema = z.object({
  fontSize: z.number(),
  fontFamily: z.string(),
  fontWeight: z.enum(['normal', 'bold']),
  color: z.string(),
  backgroundColor: z.string(),
  position: z.enum(subtitlePositionValues),
  italic: z.boolean(),
})

export const DEFAULT_SUBTITLE_STYLE = subtitleStyleSchema.parse({
  fontSize: 32,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  color: '#FFFFFF',
  backgroundColor: 'transparent',
  position: 'bottom',
  italic: false,
})

export const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  muted: z.boolean(),
  locked: z.boolean(),
  solo: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sourcePatched: z.boolean().optional(),
  type: z.enum(trackTypeValues).optional(),
  kind: z.enum(trackKindValues).optional(),
  subtitleStyle: subtitleStyleSchema.partial().optional(),
})

// One of each to start. Extra tracks appear when they are
// actually needed — an overlay with nowhere free to go, or an explicit
// "Add track". Existing projects keep whatever tracks they were saved with.
// The video track alone. An audio row appears when audio is added and not
// before — an empty A1 on a brand-new project is a row with nothing to say.
export const DEFAULT_TRACKS = trackSchema.array().parse([
  { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
])

export const subtitleClipSchema = z.object({
  id: z.string(),
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  trackIndex: z.number(),
  style: subtitleStyleSchema.partial().optional(),
})

export const clipTransitionSchema = z.object({
  type: transitionTypeSchema,
  duration: z.number(),
})

/**
 * A transition sitting on the cut between two adjacent clips.
 *
 * It belongs to the timeline rather than to either clip, because a wipe or a
 * slide needs both pictures at once and cannot be expressed as two independent
 * per-clip effects. `clip.transitionIn/Out` stay for the genuinely one-sided
 * case — fading up from black at the head of a clip, where there is no
 * neighbour to cross with.
 *
 * The two clips OVERLAP by `duration`, so adding one
 * pulls the right-hand clip (and everything after it on that track) left, and
 * the timeline gets shorter.
 *
 * The overlap straddles the original cut rather than sitting entirely in the
 * left clip's tail: the left clip is lengthened by `leftExtend` out of its
 * unused tail media, so the effect grows evenly on both sides of the join.
 */
export const timelineTransitionSchema = z.object({
  id: z.string(),
  trackIndex: z.number(),
  leftClipId: z.string(),
  rightClipId: z.string(),
  /** An id from TRANSITION_DEFINITIONS in core/src/transitions.ts. */
  type: z.string(),
  duration: z.number(),
  /**
   * How much the left clip was lengthened to centre the overlap on the cut —
   * `duration / 2` when it had the media to spare, less when it did not.
   * Removing the transition gives exactly this much back, so it has to be
   * recorded rather than recomputed from clips that have since moved.
   *
   * Absent on projects written before centring existed; those overlaps sit
   * wholly inside the left clip, which `0` describes exactly.
   */
  leftExtend: z.number().optional(),
  /**
   * ...and how much the right clip started early, out of its own unused head.
   * Together with `leftExtend` this is what the two clips lent; anything left
   * over was taken from the timeline by closing up, and comes back the same way.
   */
  rightExtend: z.number().optional(),
})

/**
 * Ceiling for clip gain. 4 is +12 dB, which is roughly where a boost stops
 * recovering detail and starts amplifying noise; the export limiter keeps
 * anything up to here from clipping.
 */
export const MAX_CLIP_VOLUME = 4

export const DEFAULT_CLIP_TRANSITION = clipTransitionSchema.parse({
  type: 'none',
  duration: 0.5,
})

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

/**
 * Per-clip geometry, applied on top of the "fit inside the frame" base scaling.
 *
 * - `scale` is a percentage of that fitted size, so 100 means untouched.
 * - `positionX`/`positionY` are percentages of the output frame, measured from
 *   centre, so 0 is centred and 50 pushes the clip to the right/bottom edge.
 * - `crop*` values are percentages taken off each side of the source before scaling.
 */
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

export const clipMaskShapeValues = ['rectangle', 'ellipse', 'linear'] as const
export const clipMaskShapeSchema = z.enum(clipMaskShapeValues)
export type ClipMaskShape = typeof clipMaskShapeValues[number]

export const clipMaskSchema = z.object({
  enabled: z.boolean().default(true),
  shape: clipMaskShapeSchema.default('rectangle'),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(50),
  width: z.number().min(1).max(200).default(50),
  height: z.number().min(1).max(200).default(50),
  rotation: z.number().default(0),
  feather: z.number().min(0).max(100).default(0),
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
  invert: false,
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

/**
 * Which processor runs the matting model.
 *
 * 'auto' takes the GPU when this machine has a usable one and quietly falls back to the
 * CPU otherwise. The explicit choices exist because "quietly" is not always what people
 * want: 'gpu' surfaces an error instead of silently running slow, and 'cpu' is the way out
 * when a driver misbehaves.
 *
 * This is a machine preference, not a property of the edit, so it lives in app settings
 * and is passed in per call — it is deliberately NOT part of the bake fingerprint, since
 * the same matte should not be re-baked just because it ran somewhere else.
 */
export const autoMatteDeviceValues = ['auto', 'gpu', 'cpu'] as const
export const autoMatteDeviceSchema = z.enum(autoMatteDeviceValues)
export type AutoMatteDevice = (typeof autoMatteDeviceValues)[number]

export const autoMatteBakeSchema = z.object({
  path: z.string(),
  fingerprint: z.string(),
  frameCount: z.number(),
  createdAt: z.number(),
  /**
   * The SOURCE range this file actually covers, and how it was made.
   *
   * Recorded because a bake no longer has to line up with the clip that asked for it: one
   * bake serves every trim that falls inside it, and the consumer seeks by
   * `autoMatteBakeOffset`. Optional so older projects still load — a bake without a range
   * says nothing about what it covers, so it is treated as invalid and re-baked once.
   */
  sourceStart: z.number().optional(),
  sourceSpan: z.number().optional(),
  /** Rate used to encode this file; new bakes use 1, independent of clip playback speed. */
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
  /** Phần trăm cạnh ngắn khung hình — KHÔNG phải pixel */
  size: z.number().min(0.1).max(50),
  /** Toạ độ chuẩn hoá 0..1, để đổi khung hình không lệch */
  points: z.array(z.tuple([z.number(), z.number()])),
  /** Thời điểm trong clip lúc vẽ — dùng để chốt tiêu chí màu cho cọ lan vùng */
  paintedAt: z.number().min(0),
})

export type BrushStroke = z.infer<typeof brushStrokeSchema>

export const customMatteSchema = z.object({
  enabled: z.boolean().default(true),
  strokes: z.array(brushStrokeSchema).default([]),
  /** Băm từ danh sách nét vẽ. Bằng nhau thì không dựng lại. */
  appliedHash: z.string().optional(),
  bake: autoMatteBakeSchema.optional(),
})

export type CustomMatte = z.infer<typeof customMatteSchema>

export const DEFAULT_CUSTOM_MATTE: CustomMatte = {
  enabled: true,
  strokes: [],
}

/**
 * How the camera path is smoothed.
 *
 * 'auto' follows the camera and removes only the jitter around its path. 'tripod' pins
 * every frame to one reference frame, which is what a locked-off shot wants — and it is
 * much harder to fool with a hand passing in front of the lens, which 'auto' reads as
 * the camera lurching.
 */
export const stabilizationModeValues = ['auto', 'tripod'] as const
export type StabilizationMode = (typeof stabilizationModeValues)[number]

export const STABILIZATION_SMOOTHING_MIN = 5
export const STABILIZATION_SMOOTHING_MAX = 60

/** Something the bake noticed that the user should hear about. */
export const stabilizationWarningValues = ['occlusion', 'highZoom'] as const
export type StabilizationWarning = (typeof stabilizationWarningValues)[number]

export const stabilizationBakeSchema = z.object({
  path: z.string(),
  fingerprint: z.string(),
  createdAt: z.number(),
  /**
   * The SOURCE range the stabilized file covers. The file starts at `sourceStart`, not at
   * zero, so every consumer goes through `resolveStabilizedClip` to shift the clip's trim
   * into the file's own time.
   */
  sourceStart: z.number(),
  sourceSpan: z.number(),
  /** Id of the asset that was stabilized; a bake of another asset is never picked up. */
  assetKey: z.string().optional(),
  /** How far the picture was scaled up to hide the moving edges, in percent. */
  zoomPercent: z.number().optional(),
  warnings: z.array(z.enum(stabilizationWarningValues)).optional(),
  /** Source seconds where a warning was raised, for pointing the user at it. */
  warningTimes: z.array(z.number()).optional(),
})

export type StabilizationBake = z.infer<typeof stabilizationBakeSchema>

export const clipStabilizationSchema = z.object({
  enabled: z.boolean().default(true),
  /** Frames either side the camera path is averaged over. 15 reads natural, 30 like a gimbal. */
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
  width: z.number().min(0).max(100).default(12), // phần trăm của cạnh ngắn khung hình
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
  /** @deprecated Legacy effect-level mask. Ignored by renderer & export; clip-level masks were implemented in KE-501 (see clip.mask). */
  mask: effectMaskSchema.optional(),
})

export const textOverlayStyleSchema = z.object({
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.enum(fontWeightValues),
  fontStyle: z.enum(fontStyleValues),
  /** Underlined text. Optional: styles written before it existed are not underlined. */
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

export const assetSchema = z.object({
  id: z.string(),
  type: z.enum(assetTypeValues),
  path: z.string(),
  bigThumbnailPath: z.string().optional(),
  smallThumbnailPath: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  /** Free-form description shown in the asset browser. Legacy projects always carry one. */
  prompt: z.string().default(''),
  resolution: z.string().default(''),
  duration: z.number().optional(),
  createdAt: z.number(),
  favorite: z.boolean().optional(),
  binId: z.string().optional(),
  colorLabel: z.string().optional(),
  proxyPath: z.string().optional(),
  proxyStatus: z.enum(['none', 'generating', 'ready', 'error']).optional(),
  /**
   * Where the asset came from. Absent means a file the user imported, which is
   * the only kind the media panel lists — anything the app created on the
   * user's behalf is still needed for clip lookups but stays out of that list.
   */
  source: z.enum(['sticker', 'sfx']).optional(),
  /**
   * Whether `width`/`height` are the size a player shows rather than the size
   * the stream is stored at. Import used to read the stream size and ignore the
   * display matrix a phone writes, so a vertical clip was recorded as
   * landscape. Absent on a video means those numbers predate the fix and are
   * re-measured once, on the next open.
   */
  rotationChecked: z.boolean().optional(),
})

const LEGACY_LUT_MAPPING: Record<string, string> = {
  'lut-cinematic': 'cine-teal-orange',
  'lut-vintage': 'vintage-kodachrome',
  'lut-bw': 'noir-bw',
  'lut-cool': 'cold-winter',
  'lut-warm': 'warm-sunset',
  'lut-muted': 'film-classic',
  'lut-vivid': 'golden-hour',
}

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
  /**
   * Time in SECONDS relative to the start of the clip (0 <= t <= clip.duration).
   * NOTE: This is clip-local time, NOT timeline time, so trimming or moving the clip
   * preserves animations without drift.
   */
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

const baseTimelineClipSchema = z.object({
  id: z.string(),
  assetId: z.string().nullable(),
  type: z.enum(timelineClipTypeValues),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  trimEnd: z.number(),
  speed: z.number().default(1),
  reversed: z.boolean().default(false),
  muted: z.boolean().default(false),
  /** Linear gain, not a percentage. 1 is unity; values above it boost the clip. */
  volume: z.number().default(1),
  trackIndex: z.number(),
  asset: assetSchema.nullable(),
  importedName: z.string().optional(),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  transitionIn: clipTransitionSchema.default(DEFAULT_CLIP_TRANSITION),
  transitionOut: clipTransitionSchema.default(DEFAULT_CLIP_TRANSITION),
  colorCorrection: colorCorrectionSchema.default(DEFAULT_COLOR_CORRECTION),
  transform: clipTransformSchema.default(DEFAULT_CLIP_TRANSFORM),
  opacity: z.number().default(100),
  linkedClipIds: z.array(z.string()).optional(),
  colorLabel: z.string().optional(),
  filter: clipFilterSchema.optional(),
  effects: z.array(clipEffectSchema).optional(),
  letterbox: letterboxSettingsSchema.optional(),
  textStyle: textOverlayStyleSchema.optional(),
  keyframes: z.array(keyframeTrackSchema).optional(),
  mask: clipMaskSchema.optional(),
  chromaKey: chromaKeySchema.optional(),
  autoMatte: autoMatteSchema.optional(),
  customMatte: customMatteSchema.optional(),
  stabilization: clipStabilizationSchema.optional(),
  stroke: clipStrokeSchema.optional(),
  blendMode: clipBlendModeSchema.default('normal').optional(),
  stickerId: z.string().optional(),
  shapeProperties: z.object({
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    strokeDasharray: z.string().optional(),
    cornerRounding: z.number().optional(),
    sides: z.number().optional(),
  }).optional(),
})

export const shapePropertiesSchema = z.object({
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeDasharray: z.string().optional(),
  cornerRounding: z.number().optional(),
  sides: z.number().optional(),
})
export type ShapeProperties = z.infer<typeof shapePropertiesSchema>

export const timelineClipSchema = z.preprocess((val: any) => {
  if (val && typeof val === 'object' && Array.isArray(val.effects)) {
    const legacyLut = val.effects.find((fx: any) => typeof fx?.type === 'string' && fx.type.startsWith('lut-') && fx.enabled)
    let filter = val.filter
    if (!filter && legacyLut) {
      filter = {
        id: LEGACY_LUT_MAPPING[legacyLut.type] || 'cine-teal-orange',
        intensity: legacyLut.params?.intensity ?? 100,
      }
    }
    const cleanEffects = val.effects.filter((fx: any) => typeof fx?.type !== 'string' || !fx.type.startsWith('lut-'))
    return {
      ...val,
      filter,
      effects: cleanEffects,
    }
  }
  return val
}, baseTimelineClipSchema)

export const timelineBackgroundTypeValues = ['color', 'blur', 'image'] as const
export const timelineBackgroundTypeSchema = z.enum(timelineBackgroundTypeValues)
export type TimelineBackgroundType = typeof timelineBackgroundTypeValues[number]

export const timelineBackgroundSchema = z.object({
  type: timelineBackgroundTypeSchema.default('color'),
  color: z.string().optional(), // hex color, e.g. '#000000'
  blur: z.number().min(0).max(100).optional(), // blur percentage 0-100
  imagePath: z.string().optional(),
})
export type TimelineBackground = z.infer<typeof timelineBackgroundSchema>

export const DEFAULT_TIMELINE_BACKGROUND: TimelineBackground = {
  type: 'color',
  color: '#000000',
}

export const timelineMarkerSchema = z.object({
  id: z.string(),
  time: z.number().min(0),
  label: z.string().default(''),
  color: z.string().default('#3b82f6'),
})

export type TimelineMarker = z.infer<typeof timelineMarkerSchema>

export const timelineCoverTextItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.string().optional(),
  fontStyle: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  x: z.number().default(50), // percent 0-100
  y: z.number().default(50), // percent 0-100
  rotation: z.number().optional(),
  scale: z.number().optional(),
  stylePreset: z.string().optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  shadow: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
})

export type TimelineCoverTextItem = z.infer<typeof timelineCoverTextItemSchema>

export const timelineCoverSchema = z.object({
  type: z.enum(['video_frame', 'custom_image']).default('video_frame'),
  time: z.number().default(0), // seconds on timeline
  customImagePath: z.string().optional(),
  templateId: z.string().optional(),
  texts: z.array(timelineCoverTextItemSchema).default([]),
  elements: z.array(z.any()).optional(),
  thumbnailDataUrl: z.string().optional(),
  updatedAt: z.number().optional(),
})

export type TimelineCover = z.infer<typeof timelineCoverSchema>

export const timelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  tracks: z.array(trackSchema),
  clips: z.array(timelineClipSchema),
  subtitles: z.array(subtitleClipSchema).default([]),
  // Optional rather than defaulted: a project written before transitions
  // existed simply has no field, and every reader here treats absent as empty.
  // Defaulting it would make the property required on the inferred type and
  // force every place that builds a Timeline to name it.
  transitions: z.array(timelineTransitionSchema).optional(),
  markers: z.array(timelineMarkerSchema).optional(),
  fps: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  background: timelineBackgroundSchema.optional(),
  variantTag: z.string().optional(),
  description: z.string().optional(),
  cover: timelineCoverSchema.optional(),
})

export const assetBinsSchema = z.record(z.string(), z.string())

/**
 * What Whisper heard, kept so the next feature that needs it does not pay for
 * it again. Seconds are the media's own, measured from the start of the file —
 * see transcript-store.ts for why that outlives trimming and moving.
 */
export const transcriptSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string(),
})

export const assetTranscriptSchema = z.object({
  assetPath: z.string(),
  language: z.string().default(''),
  segments: z.array(transcriptSegmentSchema),
  createdAt: z.number(),
})

export const projectV2Schema = z.object({
  version: z.literal(2),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  bins: assetBinsSchema,
  assets: z.array(assetSchema),
  timelines: z.array(timelineSchema),
  activeTimelineId: z.string().optional(),
  // Optional, like transitions above: a project saved before the transcript
  // store existed simply has no field, and absent reads as empty everywhere.
  // No migration is needed — the first transcription fills it in.
  transcripts: z.array(assetTranscriptSchema).optional(),
})

const assetV1Schema = assetSchema
  .omit({ binId: true })
  .extend({
    bin: z.string().optional(),
  })

export const projectV1Schema = projectV2Schema
  .omit({ version: true, bins: true, assets: true, timelines: true })
  .extend({
    version: z.undefined().optional(),
    bins: z.undefined().optional(),
    assets: z.array(assetV1Schema),
    timelines: z.array(timelineSchema).optional(),
  })

export const projectSchema = projectV2Schema

export const projectReferenceSchema = z.object({
  id: z.string(),
})

const projectVersionSchema = z.object({
  version: z.unknown().optional(),
})

export type Asset = z.infer<typeof assetSchema>
export type Track = z.infer<typeof trackSchema>
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitleClip = z.infer<typeof subtitleClipSchema>
export type TransitionType = z.infer<typeof transitionTypeSchema>
export type TimelineTransition = z.infer<typeof timelineTransitionSchema>
export type ClipTransition = z.infer<typeof clipTransitionSchema>
export type ColorCorrection = z.infer<typeof colorCorrectionSchema>
export type ClipTransform = z.infer<typeof clipTransformSchema>
export type LetterboxSettings = z.infer<typeof letterboxSettingsSchema>
export type EffectMask = z.infer<typeof effectMaskSchema>
export type EffectType = z.infer<typeof clipEffectSchema.shape.type>
export type ClipEffect = z.infer<typeof clipEffectSchema>
export type TextOverlayStyle = z.infer<typeof textOverlayStyleSchema>
export type TimelineClip = z.infer<typeof timelineClipSchema>
export type Timeline = z.infer<typeof timelineSchema>
export type AssetTranscriptRecord = z.infer<typeof assetTranscriptSchema>
export type AssetBins = z.infer<typeof assetBinsSchema>
export type ProjectV1 = z.infer<typeof projectV1Schema>
export type ProjectV2 = z.infer<typeof projectV2Schema>
export type Project = ProjectV2
export type ViewType = z.infer<typeof viewTypeSchema>

export function createAssetBinId(): string {
  return makeId('bin')
}

export function createDefaultTimeline(
  name: string = 'Timeline 1',
  fps?: number,
  width?: number,
  height?: number,
  background?: TimelineBackground,
): Timeline {
  return {
    id: makeId('timeline'),
    name,
    createdAt: Date.now(),
    tracks: DEFAULT_TRACKS.map(track => ({ ...track })),
    clips: [],
    subtitles: [],
    markers: [],
    ...(fps !== undefined ? { fps } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(background !== undefined ? { background } : {}),
  }
}

function normalizeLegacyBinName(bin: string | undefined): string | null {
  const normalized = bin?.trim()
  return normalized ? normalized : null
}

function migrateProjectV1ToV2(project: ProjectV1): ProjectV2 {
  const bins = Object.fromEntries(
    Array.from(new Set(project.assets.flatMap(asset => {
      const binName = normalizeLegacyBinName(asset.bin)
      return binName ? [binName] : []
    }))).map(binName => [createAssetBinId(), binName]),
  )
  const binNameToId = new Map<string, string>(
    Object.entries(bins).map(([binId, binName]) => [binName, binId]),
  )

  return projectV2Schema.parse({
    ...project,
    version: 2,
    bins,
    assets: project.assets.map(({ bin, ...asset }) => {
      const binName = normalizeLegacyBinName(bin)
      const binId = binName ? binNameToId.get(binName) : undefined
      return binId ? { ...asset, binId } : asset
    }),
    timelines: project.timelines ?? [createDefaultTimeline('Timeline 1')],
    activeTimelineId: project.timelines ? project.activeTimelineId : undefined,
  })
}

export function migrateProjectData(projectData: unknown): { project: Project; migrated: boolean } {
  const { version } = projectVersionSchema.parse(projectData)

  if (version === undefined) {
    return {
      project: migrateProjectV1ToV2(projectV1Schema.parse(projectData)),
      migrated: true,
    }
  }

  if (version === 2) {
    return {
      project: projectV2Schema.parse(projectData),
      migrated: false,
    }
  }

  throw new Error(`Unsupported project version: ${String(version)}`)
}

export function normalizeProject(projectData: unknown): Project {
  return migrateProjectData(projectData).project
}
