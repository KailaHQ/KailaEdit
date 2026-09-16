import { z } from 'zod'
import { makeId } from './id-generator'
import { selectBaseFootageTrackIndex } from './broll-copilot'
import { timelineClipTypeValues, timelineSchema, type Timeline, type TimelineClip } from './project-model'

/* ────────────────────────────────────────────────────────────────
   A template is a timeline with the user's media taken out.

   Everything that makes an edit look the way it does — the cut rhythm, the
   transforms, the keyframes, the filters, the text, the transitions — already
   lives on the timeline. What does not belong in a template is the footage
   itself: it is personal, it lives at an absolute path inside one project's
   asset folder, and it is exactly the part the next video replaces.

   So a template is the timeline, stripped, plus a list of the holes left
   behind. Applying one fills the holes.
   ──────────────────────────────────────────────────────────────── */

/** Kinds of media a slot will accept. */
export const templateSlotKindValues = ['video', 'image', 'any'] as const
export type TemplateSlotKind = (typeof templateSlotKindValues)[number]

export const templateSlotSchema = z.object({
  /** Order the slots are filled in, 1-based, as shown to the user. */
  slotIndex: z.number().int().positive(),
  /** Which clip in the stored timeline this slot stands for. */
  clipId: z.string(),
  /**
   * How long the slot runs, in seconds. Fixed, and that is the point: these
   * edits are cut to a rhythm, so shortening one slot because the chosen clip
   * is shorter would drag everything after it off the beat.
   */
  duration: z.number().positive(),
  kind: z.enum(templateSlotKindValues).default('any'),
  /** What to call it in the picker, e.g. "Opening shot". */
  label: z.string().default(''),
})

export type TemplateSlot = z.infer<typeof templateSlotSchema>

export const TEMPLATE_FORMAT_VERSION = 1

export const kailaTemplateSchema = z.object({
  format: z.literal(TEMPLATE_FORMAT_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  /** Frame size the edit was designed for; applying re-frames the timeline. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().optional(),
  /** Total run time, for the card in the browser. */
  durationSec: z.number().nonnegative(),
  slots: z.array(templateSlotSchema),
  /**
   * The timeline itself, media removed. Clip ids here are what `slots.clipId`
   * points at; they are remapped on every apply, so they need only be unique
   * inside the template.
   */
  timeline: timelineSchema,
  /** Cover image, relative to the template file. Optional by design. */
  cover: z.string().optional(),
  /**
   * Which shelf this sits on in the browser.
   *
   * A free-form id rather than an enum: the built-ins use the ids below, and a
   * template arriving from someone else's machine may name a shelf this build
   * has never heard of. An unknown id shows under its own raw name instead of
   * being dropped, which is the behaviour that keeps a shared template usable.
   */
  category: z.string().default(''),
  /**
   * Files that travel with the template — the music bed, an overlay PNG.
   *
   * Only media the template owns. The user's footage is never in here: it goes
   * to a slot.
   */
  bundledMedia: z.array(z.string()).default([]),
})

export const komfyTemplateSchema = kailaTemplateSchema

export type KailaTemplate = z.infer<typeof kailaTemplateSchema>
export type KomfyTemplate = KailaTemplate

/** The extension a single-file template is saved under. */
export const TEMPLATE_FILE_EXTENSION = '.kailatemplate'
export const LEGACY_TEMPLATE_FILE_EXTENSION = '.komfytemplate'
export const TEMPLATE_FILE_EXTENSIONS = ['.kailatemplate', '.komfytemplate'] as const

/** Shelves the built-in templates use. User templates may name anything. */
export const TEMPLATE_CATEGORIES = ['opener', 'montage', 'compare', 'text'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/**
 * Strips one clip of everything that identifies the media inside it.
 *
 * The asset record carries an absolute path into one project's asset folder,
 * a thumbnail beside it and a proxy beside that. None of it means anything on
 * another machine, or even in another project on the same machine, so it is
 * dropped rather than carried around broken.
 */
function stripClipMedia(clip: TimelineClip): TimelineClip {
  const { importedName: _importedName, ...rest } = clip

  // `assetId` is nullable but not optional on the schema, so it is emptied
  // rather than deleted — a template whose timeline fails to parse is a
  // template that cannot be saved or read back.
  return { ...rest, asset: null, assetId: null } as TimelineClip
}

/** The folder bundled media sits in, inside a template. */
export const TEMPLATE_MEDIA_DIR = 'media'

/** One file the template carries, and where it was copied from. */
export interface TemplateMediaRef {
  /** Absolute path on the machine the template was built on. */
  sourcePath: string
  /** Leaf name inside the template's `media/` folder. */
  fileName: string
}

/**
 * Names a bundled file so two songs called `music.mp3` cannot collide.
 *
 * Keyed by source path, because the same file used by two clips must end up as
 * one copy — a template with the music bed duplicated is a template twice the
 * size that sounds identical.
 */
function bundleNameFor(
  sourcePath: string,
  taken: Map<string, string>,
): string {
  const existing = taken.get(sourcePath)
  if (existing) return existing

  const leaf = sourcePath.split(/[/\\]/).pop() || 'media'
  const safe = leaf.replace(/[^\p{L}\p{N}._-]/gu, '_')
  const used = new Set(taken.values())

  let candidate = safe
  let counter = 2
  while (used.has(candidate)) {
    const dot = safe.lastIndexOf('.')
    candidate = dot > 0
      ? `${safe.slice(0, dot)}-${counter}${safe.slice(dot)}`
      : `${safe}-${counter}`
    counter += 1
  }

  taken.set(sourcePath, candidate)
  return candidate
}

export interface BuildTemplateOptions {
  name: string
  /**
   * Clips to turn into slots. Defaults to the footage on the base track —
   * see selectBaseFootageTrackIndex for why that is not simply track 0.
   */
  slotClipIds?: string[]
  /** Labels by clip id, so the picker can say "Opening shot" and not "Slot 1". */
  labels?: Record<string, string>
  /** Shelf to file it under; blank means "mine". */
  category?: string
}

/**
 * Turns the timeline the user is looking at into a reusable template.
 *
 * Slots come out in timeline order, not in the order clips happen to sit in
 * the array, because the user fills them by watching the video in their head:
 * first shot first.
 */
export interface BuildTemplateResult {
  template: KomfyTemplate
  /** Files the caller must copy into the template's `media/` folder. */
  media: TemplateMediaRef[]
}

export function buildTemplateFromTimeline(
  timeline: Timeline,
  options: BuildTemplateOptions,
): BuildTemplateResult {
  const baseTrackIndex = selectBaseFootageTrackIndex(timeline.clips)
  const isFootage = (clip: TimelineClip) => clip.type === 'video' || clip.type === 'image'

  const chosen = options.slotClipIds
    ? timeline.clips.filter(clip => options.slotClipIds!.includes(clip.id))
    : timeline.clips.filter(clip => isFootage(clip) && clip.trackIndex === baseTrackIndex)

  const ordered = chosen.slice().sort((left, right) => left.startTime - right.startTime)

  const slots: TemplateSlot[] = ordered.map((clip, position) => ({
    slotIndex: position + 1,
    clipId: clip.id,
    duration: clip.duration,
    kind: clip.type === 'image' ? 'image' : clip.type === 'video' ? 'video' : 'any',
    label: options.labels?.[clip.id] ?? '',
  }))

  const durationSec = timeline.clips.reduce(
    (longest, clip) => Math.max(longest, clip.startTime + clip.duration),
    0,
  )

  /*
   * Media splits two ways, and the split is the whole of Phase 2.
   *
   * A slot's media is the user's footage: personal, and the very thing the
   * next video replaces, so it is stripped. Everything else — the music bed,
   * an overlay PNG — IS the template. Without it a saved edit came back
   * silent, which was an issue in earlier versions.
   *
   * Kept media is rewritten to a name inside the template's own folder, so no
   * absolute path from this machine survives into the file.
   */
  const slotClipIds = new Set(slots.map(slot => slot.clipId))
  const bundleNames = new Map<string, string>()

  const clips = timeline.clips.map(clip => {
    if (slotClipIds.has(clip.id)) return stripClipMedia(clip)

    const sourcePath = clip.asset?.path
    if (!sourcePath) return stripClipMedia(clip)

    const fileName = bundleNameFor(sourcePath, bundleNames)
    return {
      ...clip,
      importedName: undefined,
      assetId: null,
      asset: { ...clip.asset!, id: `tpl-media-${fileName}`, path: `${TEMPLATE_MEDIA_DIR}/${fileName}` },
    } as TimelineClip
  })

  const media: TemplateMediaRef[] = [...bundleNames.entries()]
    .map(([sourcePath, fileName]) => ({ sourcePath, fileName }))

  return {
    template: {
      format: TEMPLATE_FORMAT_VERSION,
      id: makeId('tpl'),
      name: options.name.trim() || 'Template',
      createdAt: Date.now(),
      width: timeline.width ?? 1080,
      height: timeline.height ?? 1920,
      ...(timeline.fps ? { fps: timeline.fps } : {}),
      durationSec: Number(durationSec.toFixed(3)),
      slots,
      // Anything the user saves is theirs, not one of the shipped shelves.
      category: options.category ?? '',
      bundledMedia: media.map(entry => entry.fileName),
      timeline: {
        ...timeline,
        // A template is not a timeline in a project: it has no identity of its
        // own until it is applied, and carrying the source id would let two
        // applied copies collide.
        id: 'template-timeline',
        clips,
      },
    },
    media,
  }
}

/** A slot with nothing in it yet — what the picker shows a gap for. */
export function isFootageSlotType(type: string): boolean {
  return (timelineClipTypeValues as readonly string[]).includes(type)
}
