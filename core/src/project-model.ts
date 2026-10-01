import { z } from 'zod'
import { makeId } from './id-generator'
import { migrateLegacySpeedKeyframes } from './speed-curve-legacy'

export * from './clip-model'
import {
  colorCorrectionSchema,
  DEFAULT_COLOR_CORRECTION,
  clipTransformSchema,
  DEFAULT_CLIP_TRANSFORM,
  clipFilterSchema,
  clipEffectSchema,
  letterboxSettingsSchema,
  textOverlayStyleSchema,
  keyframeTrackSchema,
  clipMaskSchema,
  chromaKeySchema,
  autoMatteSchema,
  customMatteSchema,
  clipStabilizationSchema,
  clipStrokeSchema,
  clipBlendModeSchema,
  shapePropertiesSchema,
  speedCurveSchema,
} from './clip-model'

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



const baseTimelineClipSchema = z.object({
  id: z.string(),
  assetId: z.string().nullable(),
  type: z.enum(timelineClipTypeValues),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  trimEnd: z.number(),
  speed: z.number().default(1),
  /** When set, the clip's speed follows this curve and `speed` is its mean rate. */
  speedCurve: speedCurveSchema.optional(),
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
  /**
   * The text animations chosen for this clip — one to come in, one to go out, one to repeat.
   * The keyframes are generated from these, so the panel can show which is picked and
   * rebuild the tracks when the clip is retimed.
   */
  textAnimation: z.object({
    in: z.string().optional(),
    out: z.string().optional(),
    loop: z.string().optional(),
    /** Seconds the entrance / exit takes, when the user has set them; otherwise the animation's own. */
    inDuration: z.number().optional(),
    outDuration: z.number().optional(),
    /** What the keyframes were built from (length, position, size, words); when it changes they are rebuilt. */
    stamp: z.string().optional(),
  }).optional(),
  mask: clipMaskSchema.optional(),
  chromaKey: chromaKeySchema.optional(),
  autoMatte: autoMatteSchema.optional(),
  customMatte: customMatteSchema.optional(),
  stabilization: clipStabilizationSchema.optional(),
  stroke: clipStrokeSchema.optional(),
  blendMode: clipBlendModeSchema.default('normal').optional(),
  stickerId: z.string().optional(),
  shapeProperties: shapePropertiesSchema.optional(),
})



export const timelineClipSchema = z.preprocess((input: any) => {
  const val = migrateLegacySpeedKeyframes(input)
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

/**
 * The background that is actually drawn. A blurred copy of the media used to be one of the
 * choices; it filled the empty space around a picture that does not match the frame with a
 * smeared version of itself, which is not what an editor shows — the picture, at its own
 * proportions, on the plain canvas. Projects that still say `blur` are drawn as the default
 * colour in the monitor and in the export alike.
 */
export function effectiveTimelineBackground(background: TimelineBackground | undefined): TimelineBackground | undefined {
  return background?.type === 'blur' ? DEFAULT_TIMELINE_BACKGROUND : background
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
