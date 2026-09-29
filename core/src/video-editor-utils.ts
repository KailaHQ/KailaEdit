import type { TimelineClip, TransitionType, Track, ClipEffect, SubtitleClip, ClipMask, Project, Asset } from './project-model'
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_COLOR_CORRECTION } from './project-model'
import { cssMixBlendModeFor } from './blend-modes'
import { sampleClipAt, hasKeyframesForProperty } from './keyframes'

// ── Tool types & definitions ────────────────────────────────────────

export type ToolType = 'select' | 'trackForward' | 'blade' | 'slip' | 'slide' | 'ripple' | 'roll'

export type ToolDef = { id: ToolType; label: string; actionId: string }

// ── Color Labels (Premiere-style) ────────────────────────────────────

export interface ColorLabelDef {
  id: string
  label: string
  color: string      // Tailwind-friendly hex for rendering
  bg: string         // Background class for timeline clips
  border: string     // Border class for timeline clips
  dot: string        // Dot color class for menus
}

export const COLOR_LABELS: ColorLabelDef[] = [
  { id: 'violet',    label: 'Violet',    color: '#8b5cf6', bg: 'bg-violet-700/50',  border: 'border-violet-500', dot: 'bg-violet-500' },
  { id: 'blue',      label: 'Blue',      color: '#3b82f6', bg: 'bg-blue-700/50',      border: 'border-blue-500',   dot: 'bg-blue-500' },
  { id: 'cyan',      label: 'Cyan',      color: '#06b6d4', bg: 'bg-cyan-700/50',      border: 'border-cyan-500',   dot: 'bg-cyan-500' },
  { id: 'teal',      label: 'Teal',      color: '#14b8a6', bg: 'bg-teal-700/50',      border: 'border-teal-500',   dot: 'bg-teal-500' },
  { id: 'green',     label: 'Green',     color: '#22c55e', bg: 'bg-green-700/50',     border: 'border-green-500',  dot: 'bg-green-500' },
  { id: 'yellow',    label: 'Yellow',    color: '#eab308', bg: 'bg-yellow-700/50',    border: 'border-yellow-500', dot: 'bg-yellow-500' },
  { id: 'orange',    label: 'Orange',    color: '#f97316', bg: 'bg-orange-700/50',    border: 'border-orange-500', dot: 'bg-orange-500' },
  { id: 'red',       label: 'Red',       color: '#ef4444', bg: 'bg-red-700/50',       border: 'border-red-500',    dot: 'bg-red-500' },
  { id: 'rose',      label: 'Rose',      color: '#f43f5e', bg: 'bg-rose-700/50',      border: 'border-rose-500',   dot: 'bg-rose-500' },
  { id: 'pink',      label: 'Pink',      color: '#ec4899', bg: 'bg-pink-700/50',      border: 'border-pink-500',   dot: 'bg-pink-500' },
]

export function getColorLabel(id: string | undefined): ColorLabelDef | undefined {
  if (!id) return undefined
  return COLOR_LABELS.find(c => c.id === id)
}

// ── Constants ────────────────────────────────────────────────────────

/** Debounce delay for auto-saving timeline changes to context (ms) */
export const AUTOSAVE_DELAY = 500

/** Tolerance in seconds for detecting adjacent clips (cut points) */
export const CUT_POINT_TOLERANCE = 0.05

/** Default cross-dissolve duration in seconds */
export const DEFAULT_DISSOLVE_DURATION = 0.5

// ── Resizable layout constants ───────────────────────────────────────

export const LAYOUT_STORAGE_KEY = 'komfyedit-video-editor-layout'

export interface EditorLayout {
  leftPanelWidth: number   // px
  rightPanelWidth: number  // px
  timelineHeight: number   // px
  assetsHeight: number     // px – height of assets section in left panel (timelines gets the rest)
}

// The left panel holds the sub-nav column (122px) *and* the library beside it,
// so it needs roughly twice the width the old assets-only panel did.
export const DEFAULT_LAYOUT: EditorLayout = {
  leftPanelWidth: 470,
  rightPanelWidth: 366,
  timelineHeight: 300,
  assetsHeight: 0,        // unused since the timelines list was removed
}

export const LAYOUT_LIMITS = {
  leftPanelWidth:  { min: 300, max: 700 },
  rightPanelWidth: { min: 260, max: 520 },
  timelineHeight:  { min: 120, max: 700 },
  assetsHeight:    { min: 120, max: 800 },
}

// ── Pure helper functions ────────────────────────────────────────────

/**
 * Overwrite helper: given a moved/placed clip, trim or split any clips
 * on the same track that it overlaps. Returns the updated clips array.
 * `movedIds` = IDs of the clip(s) being moved (they should not be trimmed).
 */
/** Overlaps shorter than this are rounding at a shared edge, not a collision. */
const COLLISION_EPSILON = 1e-3

/**
 * Where a drag lands on top of other clips on an overlay track, gives the dragged clips a
 * new track of their own instead — the way CapCut does it.
 *
 * Dropping onto an overlay track used to overwrite: `resolveOverlaps` trimmed the clip
 * underneath, or deleted it outright when the drop covered it. Nothing warned during the
 * drag, so moving one clip could quietly eat most of another. Now the dragged clips keep
 * exactly the time they were dropped at, move up onto a fresh track of the same kind, and
 * the clips they would have landed on are left alone.
 *
 * Per target track: every moved clip landing on a track where any of them collides goes
 * up together, so a group dragged as one stays on one track. The main track is left to
 * its magnet, and clips joined by a transition overlap on purpose, so neither counts.
 * New tracks are appended — above everything of their kind, which is where the dragged
 * clip is drawn anyway.
 */
export function liftCollidingClipsToNewTracks(
  tracks: Track[],
  clips: TimelineClip[],
  movedIds: ReadonlySet<string>,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string }> = [],
  mainTrackIndex: number = mainVideoTrackIndex(tracks),
  makeTrackId: () => string = () => `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): { tracks: Track[]; clips: TimelineClip[] } {
  const joined = (a: string, b: string) => transitions.some(t =>
    (t.leftClipId === a && t.rightClipId === b) || (t.leftClipId === b && t.rightClipId === a))

  const collidingTracks = new Set<number>()
  for (const moved of clips) {
    if (!movedIds.has(moved.id) || moved.trackIndex === mainTrackIndex) continue
    if (collidingTracks.has(moved.trackIndex)) continue
    const movedEnd = moved.startTime + moved.duration
    const hits = clips.some(other =>
      !movedIds.has(other.id)
      && other.trackIndex === moved.trackIndex
      && other.startTime < movedEnd - COLLISION_EPSILON
      && other.startTime + other.duration > moved.startTime + COLLISION_EPSILON
      && !joined(moved.id, other.id))
    if (hits) collidingTracks.add(moved.trackIndex)
  }
  if (collidingTracks.size === 0) return { tracks, clips }

  const nextTracks = [...tracks]
  const liftedTo = new Map<number, number>()
  for (const from of [...collidingTracks].sort((a, b) => a - b)) {
    const source = tracks[from]
    const kind = source?.kind ?? 'video'
    const prefix = kind === 'audio' ? 'A' : kind === 'sticker' ? 'S' : 'V'
    const sameKind = nextTracks.filter(t => (t.kind ?? 'video') === kind && t.type !== 'subtitle').length
    liftedTo.set(from, nextTracks.length)
    nextTracks.push({
      id: makeTrackId(),
      name: `${prefix}${sameKind + 1}`,
      muted: false,
      locked: false,
      kind,
    })
  }

  return {
    tracks: nextTracks,
    clips: clips.map(clip => {
      const to = movedIds.has(clip.id) ? liftedTo.get(clip.trackIndex) : undefined
      return to === undefined ? clip : { ...clip, trackIndex: to }
    }),
  }
}

/**
 * How far a clip's edges may be dragged on an overlay track before they run into the
 * clips beside it — the way CapCut stops a trim at the neighbour's edge.
 *
 * Without this a trim slid straight over the next clip, and on release `resolveOverlaps`
 * cut the neighbour back or deleted it. `start`–`end` is the clip's span when the trim
 * began; `trackIndexes` are the tracks being trimmed (the clip's own, plus any linked
 * clip's). A clip already overlapping that span limits nothing, and neither does one
 * joined to a resized clip by a transition — those overlap on purpose.
 */
export function neighbourTrimBounds(
  clips: ReadonlyArray<TimelineClip>,
  resizedIds: ReadonlySet<string>,
  trackIndexes: Iterable<number>,
  start: number,
  end: number,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string }> = [],
): { minStart: number; maxEnd: number } {
  const tracksToCheck = new Set(trackIndexes)
  const joined = (id: string) => transitions.some(t =>
    (resizedIds.has(t.leftClipId) && t.rightClipId === id) || (resizedIds.has(t.rightClipId) && t.leftClipId === id))
  let minStart = 0
  let maxEnd = Infinity
  for (const clip of clips) {
    if (resizedIds.has(clip.id) || !tracksToCheck.has(clip.trackIndex) || joined(clip.id)) continue
    const clipEnd = clip.startTime + clip.duration
    if (clipEnd <= start + COLLISION_EPSILON) minStart = Math.max(minStart, clipEnd)
    else if (clip.startTime >= end - COLLISION_EPSILON) maxEnd = Math.min(maxEnd, clip.startTime)
  }
  return { minStart, maxEnd }
}

export function resolveOverlaps(
  allClips: TimelineClip[],
  movedIds: Set<string>,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
  mainTrackIndex: number = 0,
): TimelineClip[] {
  let result = [...allClips]

  for (const movedId of movedIds) {
    const moved = result.find(c => c.id === movedId)
    if (!moved) continue

    const movedStart = moved.startTime
    const movedEnd = moved.startTime + moved.duration

    const next: TimelineClip[] = []

    for (const c of result) {
      if (movedIds.has(c.id)) { next.push(c); continue }
      if (c.trackIndex !== moved.trackIndex) { next.push(c); continue }

      // If moved and c are connected by a transition, their overlap is intentional and
      // managed by transition packing, not a conflict to resolve.
      const isConnectedByTransition = transitions.some(t =>
        (t.leftClipId === moved.id && t.rightClipId === c.id) ||
        (t.leftClipId === c.id && t.rightClipId === moved.id)
      )
      if (isConnectedByTransition) {
        next.push(c)
        continue
      }

      const cStart = c.startTime
      const cEnd = c.startTime + c.duration

      if (cEnd <= movedStart || cStart >= movedEnd) { next.push(c); continue }

      // For Track 1 (magnetic): never trim, split, or delete existing clips
      if (moved.trackIndex === mainTrackIndex) {
        const cMid = cStart + c.duration / 2
        if (movedStart < cMid) {
          next.push({ ...c, startTime: Math.max(cStart, movedEnd) })
        } else {
          next.push(c)
          if (moved.startTime < cEnd) {
            moved.startTime = cEnd
          }
        }
        continue
      }

      if (cStart >= movedStart && cEnd <= movedEnd) continue

      if (cStart < movedStart && cEnd > movedStart && cEnd <= movedEnd) {
        const newDuration = movedStart - cStart
        next.push({ ...c, duration: newDuration })
        continue
      }

      if (cStart >= movedStart && cStart < movedEnd && cEnd > movedEnd) {
        const trimAmount = movedEnd - cStart
        const newTrimStart = c.trimStart + trimAmount * c.speed
        next.push({
          ...c,
          startTime: movedEnd,
          duration: c.duration - trimAmount,
          trimStart: newTrimStart,
        })
        continue
      }

      if (cStart < movedStart && cEnd > movedEnd) {
        // Do NOT split c into two pieces. Push c forward so it stays whole.
        next.push({
          ...c,
          startTime: movedEnd,
        })
        continue
      }

      next.push(c)
    }

    result = next
  }

  return result
}

/**
 * Ensures clips on the main video track (Track 1 / index 0) form a continuous,
 * magnetic timeline starting at 0s with no gaps.
 * Also adjusts the start times of any linked audio clips accordingly.
 *
 * `transitions` is the one licensed exception to "no gaps, no overlaps": a pair
 * joined by a transition is *meant* to overlap, by exactly its duration, because
 * that overlap is the transition. Without this the magnetic packing would close
 * the overlap the instant it was created and the transition would be a no-op
 * that silently reverted itself.
 */
export function packTrack1(
  allClips: TimelineClip[],
  mainTrackIndex: number = 0,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
): TimelineClip[] {
  const track1Clips = allClips
    .filter(c => c.trackIndex === mainTrackIndex)
    .sort((a, b) => a.startTime - b.startTime)

  if (track1Clips.length === 0) return allClips

  const overlapAfter = new Map<string, number>()
  for (const transition of transitions) {
    overlapAfter.set(transition.leftClipId, transition.duration)
  }

  const clipDeltas = new Map<string, number>()
  let currentCursor = 0
  let moved = false

  const remappedTrack1 = new Map<string, TimelineClip>()
  for (const c of track1Clips) {
    const delta = currentCursor - c.startTime
    if (delta !== 0) moved = true
    clipDeltas.set(c.id, delta)
    remappedTrack1.set(c.id, {
      ...c,
      startTime: currentCursor,
    })
    // The next clip starts early by the length of the transition out of this one.
    const overlap = Math.min(overlapAfter.get(c.id) ?? 0, c.duration)
    currentCursor += c.duration - overlap
  }

  // Already tiled from 0: hand back the very same array so callers can treat an
  // unchanged reference as "nothing to write".
  if (!moved) return allClips

  return allClips.map(clip => {
    if (clip.trackIndex === mainTrackIndex) {
      return remappedTrack1.get(clip.id) || clip
    }
    if (clip.linkedClipIds?.length) {
      for (const linkedId of clip.linkedClipIds) {
        if (clipDeltas.has(linkedId)) {
          const delta = clipDeltas.get(linkedId)!
          return {
            ...clip,
            startTime: Math.max(0, clip.startTime + delta),
          }
        }
      }
    }
    return clip
  })
}

/** Index of the main video track (V1) — the magnetic one — or -1 if there is none. */
export function mainVideoTrackIndex(tracks: Track[]): number {
  // First prefer explicit base video track by id ('track-v1'), name ('V1'), or sourcePatched flag
  const explicit = tracks.findIndex(
    track => track.kind === 'video' && track.type !== 'subtitle' && (track.id === 'track-v1' || track.name === 'V1' || track.sourcePatched),
  )
  if (explicit >= 0) return explicit

  // Avoid choosing overlay tracks (e.g. titled 'Kinetic Titles', 'Text Overlay', etc.) over main video tracks
  const nonOverlay = tracks.findIndex(
    track => track.kind === 'video' && track.type !== 'subtitle' && !/text|title|chữ|adj|overlay|sticker/i.test(track.name),
  )
  if (nonOverlay >= 0) return nonOverlay

  return tracks.findIndex(track => track.kind === 'video' && track.type !== 'subtitle')
}

/**
 * Enforce the magnetic main track: clips on V1 always tile from 0 with no gaps.
 * Overlay tracks (V2 and up) are left alone — a clip put anywhere on them stays
 * where it was put.
 *
 * Returns the same `clips` reference when nothing had to move.
 */
export function packMainVideoTrack(
  tracks: Track[],
  clips: TimelineClip[],
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
): TimelineClip[] {
  const mainIndex = mainVideoTrackIndex(tracks)
  if (mainIndex < 0) return clips
  return packTrack1(clips, mainIndex, transitions)
}

/**
 * Automatically removes empty overlay video tracks (V2, V3, etc.) when they
 * contain no clips. Track 1 (V1) is never removed.
 * Remaps clip and subtitle track indices accordingly.
 */
export function pruneEmptyOverlayTracks(
  tracks: Track[],
  clips: TimelineClip[],
  subtitles: SubtitleClip[] = [],
): { tracks: Track[]; clips: TimelineClip[]; subtitles: SubtitleClip[] } {
  return pruneEmptyTracks(tracks, clips, subtitles)
}

export function clampVal(val: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, val))
}

/** Migrate old clips that don't have new effect fields */
export function migrateClip(clip: TimelineClip): TimelineClip {
  let filter = clip.filter
  let effects = clip.effects

  // Migrate legacy lut-* effects to 3D clip.filter
  if (effects) {
    const legacyLut = effects.find((fx: any) => typeof fx?.type === 'string' && fx.type.startsWith('lut-') && fx.enabled)
    if (!filter && legacyLut) {
      const mapping: Record<string, string> = {
        'lut-cinematic': 'cine-teal-orange',
        'lut-vintage': 'vintage-kodachrome',
        'lut-bw': 'noir-bw',
        'lut-cool': 'cold-winter',
        'lut-warm': 'warm-sunset',
        'lut-muted': 'film-classic',
        'lut-vivid': 'golden-hour',
      }
      const mappedId = mapping[legacyLut.type] || 'cine-teal-orange'
      filter = {
        id: mappedId,
        intensity: legacyLut.params?.intensity ?? 100,
      }
    }
    effects = effects.filter((fx: any) => typeof fx?.type !== 'string' || !fx.type.startsWith('lut-'))
  }

  return {
    ...clip,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    transitionIn: clip.transitionIn ?? { type: 'none', duration: 0.5 },
    transitionOut: clip.transitionOut ?? { type: 'none', duration: 0.5 },
    colorCorrection: clip.colorCorrection ?? { ...DEFAULT_COLOR_CORRECTION },
    transform: clip.transform ?? { ...DEFAULT_CLIP_TRANSFORM },
    opacity: clip.opacity ?? 100,
    filter,
    effects,
  }
}

/**
 * Migrate tracks from old format (no kind) to new NLE layout.
 * Heuristic: if a track has no `kind`, infer from its name or position.
 */
export function migrateTracks(tracks: Track[]): Track[] {
  return tracks.map(t => {
    if (t.kind) return t
    if (t.type === 'subtitle') return t
    if (/^A\d/i.test(t.name)) return { ...t, kind: 'audio' as const }
    if (/^V\d/i.test(t.name)) return { ...t, kind: 'video' as const }
    return { ...t, kind: 'video' as const }
  })
}

/**
 * The CSS a clip's effects and transform produce.
 *
 * Structurally compatible with React's `CSSProperties` so callers can spread it
 * straight onto a style prop, but declared here so core stays free of React —
 * this module is imported by the Electron main process too.
 */
/**
 * How far a clip's edges may miss an adjustment layer's and still count as
 * covered by it, in seconds.
 */
const ADJUSTMENT_COVERAGE_SLACK = 0.05

/**
 * The LUT a clip is actually graded with.
 *
 * A filter reaches a clip two ways: dropped straight onto it, or from an
 * adjustment layer laid over the stretch it sits in. The exporter has always
 * resolved the pair this way — the clip's own filter wins, an adjustment layer
 * that spans it fills in — so the preview asks the same question through the
 * same function rather than keeping a second opinion about what the frame
 * should look like.
 *
 * Only pictures inherit: text and audio are not graded by the export either.
 */
export function resolveEffectiveClipFilter(
  clip: TimelineClip,
  adjustmentClips: TimelineClip[],
  tracks?: Track[],
  timeInClip?: number,
): TimelineClip['filter'] {
  if (clip.filter) {
    if (timeInClip !== undefined && hasKeyframesForProperty(clip, 'filter.intensity')) {
      const sampled = sampleClipAt(clip, timeInClip)
      return {
        ...clip.filter,
        intensity: sampled.filterIntensity,
      }
    }
    return clip.filter
  }
  if (clip.type !== 'video' && clip.type !== 'image') return undefined

  const clipEnd = clip.startTime + clip.duration
  const covering = adjustmentClips.find(adjustment =>
    adjustment.type === 'adjustment' &&
    adjustment.filter &&
    (!tracks || tracks[adjustment.trackIndex]?.enabled !== false) &&
    adjustment.startTime <= clip.startTime + ADJUSTMENT_COVERAGE_SLACK &&
    adjustment.startTime + adjustment.duration >= clipEnd - ADJUSTMENT_COVERAGE_SLACK,
  )

  if (covering?.filter) {
    if (timeInClip !== undefined && hasKeyframesForProperty(covering, 'filter.intensity')) {
      const adjTimeInClip = Math.max(0, (clip.startTime + timeInClip) - covering.startTime)
      const sampled = sampleClipAt(covering, adjTimeInClip)
      return {
        ...covering.filter,
        intensity: sampled.filterIntensity,
      }
    }
    return covering.filter
  }

  return undefined
}

/**
 * Every clip with the filter it is actually graded with written onto it — the form the
 * main process renders from. Its pipeline knows nothing of adjustment layers; it grades a
 * clip by \`clip.filter\` alone. So anything sent there to render, the export and the
 * preview's segment cache alike, has to carry the inherited filter on the clip itself.
 *
 * Returns the input array when no clip inherits anything, so memoized callers keep it.
 */
export function resolveAdjustmentFilters(clips: TimelineClip[], tracks?: Track[]): TimelineClip[] {
  const adjustments = clips.filter(clip =>
    clip.type === 'adjustment' && clip.filter && (!tracks || tracks[clip.trackIndex]?.enabled !== false))
  if (adjustments.length === 0) return clips
  let changed = false
  const out = clips.map(clip => {
    if (clip.filter || (clip.type !== 'video' && clip.type !== 'image')) return clip
    const inherited = resolveEffectiveClipFilter(clip, adjustments, tracks)
    if (!inherited) return clip
    changed = true
    return { ...clip, filter: inherited }
  })
  return changed ? out : clips
}

export interface ClipEffectStyle {
  filter?: string
  transform?: string
  opacity?: number
  clipPath?: string
  maskImage?: string
  WebkitMaskImage?: string
  maskSize?: string
  WebkitMaskSize?: string
  maskRepeat?: string
  WebkitMaskRepeat?: string
  maskPosition?: string
  WebkitMaskPosition?: string
  mixBlendMode?: any
}

export interface ClipEffectStyleOptions {
  /**
   * Whether to fold the clip's 3D LUT into the CSS as an approximation.
   *
   * The preview grades the active layer for real, in WebGL, from the same
   * `.cube` file the exporter uses. Leaving the rough CSS stand-in on that same
   * element would then grade it twice — once properly and once again by hand —
   * which is why the preview came out heavier than the file it exported. Pass
   * `false` for any element whose LUT is already being rendered.
   *
   * Defaults to true, for the elements that have no canvas behind them.
   */
  lutApproximation?: boolean
}

/** Build CSS filter + transform strings from clip effects */
export function getClipEffectStyles(
  clip: TimelineClip,
  timeInClip?: number,
  options: ClipEffectStyleOptions = {},
): ClipEffectStyle {
  const cc = clip.colorCorrection || DEFAULT_COLOR_CORRECTION
  const filters: string[] = []

  if (cc.brightness !== 0) filters.push(`brightness(${1 + cc.brightness / 100})`)
  if (cc.contrast !== 0) filters.push(`contrast(${1 + cc.contrast / 100})`)
  if (cc.saturation !== 0) filters.push(`saturate(${1 + cc.saturation / 100})`)
  if (cc.exposure !== 0) filters.push(`brightness(${1 + cc.exposure / 200})`)
  if (cc.temperature !== 0) {
    const t = cc.temperature
    if (t > 0) {
      filters.push(`sepia(${t / 200})`)
      filters.push(`hue-rotate(-${t * 0.1}deg)`)
    } else {
      filters.push(`hue-rotate(${Math.abs(t) * 0.4}deg)`)
    }
  }
  if (cc.tint !== 0) {
    filters.push(`hue-rotate(${cc.tint * 1.2}deg)`)
  }
  if (cc.highlights !== 0) filters.push(`brightness(${1 + cc.highlights / 300})`)
  if (cc.shadows !== 0) filters.push(`contrast(${1 + cc.shadows / 300})`)

  if (clip.effects) {
    for (const fx of clip.effects) {
      if (!fx.enabled) continue
      const p = fx.params
      switch (fx.type) {
        case 'blur':
          if (p.amount > 0) filters.push(`blur(${p.amount}px)`)
          break
        case 'sharpen': {
          const s = p.amount / 100
          if (s > 0) filters.push(`contrast(${1 + s * 0.3})`)
          break
        }
        case 'glow': {
          const intensity = p.amount / 100
          const radius = p.radius || 10
          if (intensity > 0) {
            filters.push(`brightness(${1 + intensity * 0.3})`)
            filters.push(`drop-shadow(0 0 ${radius * intensity}px rgba(255,255,255,${intensity * 0.4}))`)
          }
          break
        }
        case 'vignette':
        case 'grain':
          break
      }
    }
  }

  // Sample animated properties if timeInClip is provided, otherwise fall back to static fields
  const sampled = timeInClip !== undefined ? sampleClipAt(clip, timeInClip) : null

  // 3D LUT Filter CSS approximation for preview and adjustment layers
  if (clip.filter && options.lutApproximation !== false) {
    const filterIntensity = sampled ? sampled.filterIntensity : (clip.filter.intensity ?? 100)
    const t = (filterIntensity / 100)
    if (t > 0) {
      switch (clip.filter.id) {
        case 'cine-teal-orange':
          filters.push(`contrast(${1 + 0.12 * t}) saturate(${1 - 0.15 * t}) sepia(${0.15 * t}) brightness(${1 - 0.04 * t}) hue-rotate(${-4 * t}deg)`)
          break
        case 'vintage-kodachrome':
          filters.push(`sepia(${0.35 * t}) contrast(${1 + 0.1 * t}) saturate(${1 + 0.2 * t}) brightness(${1 + 0.05 * t})`)
          break
        case 'noir-bw':
          filters.push(`grayscale(${t}) contrast(${1 + 0.2 * t})`)
          break
        case 'cold-winter':
          filters.push(`hue-rotate(${15 * t}deg) saturate(${1 - 0.15 * t}) brightness(${1 + 0.02 * t})`)
          break
        case 'warm-sunset':
          filters.push(`sepia(${0.25 * t}) hue-rotate(${-8 * t}deg) saturate(${1 + 0.15 * t})`)
          break
        case 'film-classic':
          filters.push(`saturate(${1 - 0.25 * t}) contrast(${1 + 0.05 * t}) sepia(${0.1 * t})`)
          break
        case 'golden-hour':
          filters.push(`sepia(${0.2 * t}) saturate(${1 + 0.35 * t}) brightness(${1 + 0.05 * t}) hue-rotate(${-4 * t}deg)`)
          break
        case 'cyber-neon':
          filters.push(`contrast(${1 + 0.25 * t}) saturate(${1 + 0.5 * t}) hue-rotate(${15 * t}deg)`)
          break
        case 'moody-forest':
          filters.push(`saturate(${1 - 0.25 * t}) contrast(${1 + 0.15 * t}) brightness(${1 - 0.08 * t}) hue-rotate(${10 * t}deg)`)
          break
        case 'retro-90s':
          filters.push(`sepia(${0.2 * t}) saturate(${1 - 0.1 * t}) contrast(${1 + 0.05 * t})`)
          break
        case 'bleach-bypass':
          filters.push(`contrast(${1 + 0.4 * t}) saturate(${1 - 0.5 * t}) brightness(${1 - 0.05 * t})`)
          break
        case 'pastel-dream':
          filters.push(`brightness(${1 + 0.1 * t}) contrast(${1 - 0.08 * t}) saturate(${1 + 0.15 * t})`)
          break
        default:
          break
      }
    }
  }


  // Mirrors the export chain's geometry: fit-scale, then transform scale, then
  // rotation, then the timeline position offset. CSS applies these right-to-left,
  // so the list reads outermost-first.
  const tf = clip.transform ?? DEFAULT_CLIP_TRANSFORM
  const scale = sampled ? sampled.scale : (tf.scale ?? 100)
  const scaleX = sampled?.scaleX ?? tf.scaleX ?? scale
  const scaleY = sampled?.scaleY ?? tf.scaleY ?? scale
  const positionX = sampled ? sampled.positionX : (tf.positionX ?? 0)
  const positionY = sampled ? sampled.positionY : (tf.positionY ?? 0)
  const rotation = sampled ? sampled.rotation : (tf.rotation ?? 0)
  const rawOpacity = sampled ? sampled.opacity : (clip.opacity ?? 100)

  const transforms: string[] = []
  if (positionX !== 0 || positionY !== 0) {
    transforms.push(`translate(${positionX}%, ${positionY}%)`)
  }
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`)
  if (scaleX !== 100 || scaleY !== 100) {
    if (scaleX === scaleY) {
      transforms.push(`scale(${scaleX / 100})`)
    } else {
      transforms.push(`scale(${scaleX / 100}, ${scaleY / 100})`)
    }
  }
  if (clip.flipH) transforms.push('scaleX(-1)')
  if (clip.flipV) transforms.push('scaleY(-1)')

  let opacity = rawOpacity / 100
  if (timeInClip !== undefined) {
    const tIn = clip.transitionIn
    const tOut = clip.transitionOut
    if (tIn && tIn.duration > 0 && timeInClip < tIn.duration) {
      if (tIn.type === 'fade-to-black' || tIn.type === 'fade-to-white') {
        opacity = Math.min(opacity, timeInClip / tIn.duration)
      }
    }
    if (tOut && tOut.duration > 0) {
      const timeFromEnd = clip.duration - timeInClip
      if (timeFromEnd < tOut.duration) {
        if (tOut.type === 'fade-to-black' || tOut.type === 'fade-to-white') {
          opacity = Math.min(opacity, timeFromEnd / tOut.duration)
        }
      }
    }
  }

  let clipPath: string | undefined
  if (timeInClip !== undefined) {
    const tIn = clip.transitionIn
    const tOut = clip.transitionOut
    if (tIn && tIn.type.startsWith('wipe-') && tIn.duration > 0 && timeInClip < tIn.duration) {
      const progress = timeInClip / tIn.duration
      clipPath = getWipeClipPath(tIn.type as TransitionType, progress, true)
    }
    if (tOut && tOut.type.startsWith('wipe-') && tOut.duration > 0) {
      const timeFromEnd = clip.duration - timeInClip
      if (timeFromEnd < tOut.duration) {
        const progress = timeFromEnd / tOut.duration
        clipPath = getWipeClipPath(tOut.type as TransitionType, progress, false)
      }
    }
  }

  // Crop hides the clip's edges without zooming what remains, matching the
  // crop+pad pair in the export chain. A wipe transition owns clipPath while it
  // runs, so crop yields to it for those frames.
  if (!clipPath && (tf.cropTop || tf.cropRight || tf.cropBottom || tf.cropLeft)) {
    clipPath = `inset(${tf.cropTop}% ${tf.cropRight}% ${tf.cropBottom}% ${tf.cropLeft}%)`
  }

  const style: ClipEffectStyle = {}
  if (filters.length > 0) style.filter = filters.join(' ')
  if (transforms.length > 0) style.transform = transforms.join(' ')
  if (opacity < 1) style.opacity = opacity
  if (clipPath) style.clipPath = clipPath

  if (clip.mask && clip.mask.enabled !== false) {
    const svg = buildClipMaskSvg(clip.mask)
    const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    style.maskImage = `url("${encoded}")`
    style.WebkitMaskImage = `url("${encoded}")`
    style.maskSize = '100% 100%'
    style.WebkitMaskSize = '100% 100%'
    style.maskRepeat = 'no-repeat'
    style.WebkitMaskRepeat = 'no-repeat'
    style.maskPosition = 'center'
    style.WebkitMaskPosition = 'center'
  }

  if (clip.blendMode && clip.blendMode !== 'normal') {
    style.mixBlendMode = cssMixBlendModeFor(clip.blendMode)
  }

  return style
}

export function buildClipMaskSvg(mask: ClipMask): string {
  const { shape, x, y, width, height, rotation, feather, invert } = mask
  const rot = rotation ?? 0
  const featherStdDev = (feather ?? 0) * 0.25

  let shapeElement = ''
  if (shape === 'rectangle') {
    const rx = Math.max(-100, x - width / 2)
    const ry = Math.max(-100, y - height / 2)
    shapeElement = `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" transform="rotate(${rot} ${x} ${y})" />`
  } else if (shape === 'ellipse') {
    const rx = width / 2
    const ry = height / 2
    shapeElement = `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${rot} ${x} ${y})" />`
  } else if (shape === 'linear') {
    shapeElement = `<rect x="-150" y="${y.toFixed(2)}" width="400" height="400" transform="rotate(${rot} ${x} ${y})" />`
  }

  const filterDef = featherStdDev > 0
    ? `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${featherStdDev.toFixed(2)}" /></filter>`
    : ''
  const filterAttr = featherStdDev > 0 ? 'filter="url(#f)"' : ''

  let content = ''
  if (invert) {
    content = `
      <defs>
        ${filterDef}
        <mask id="inv">
          <rect width="100" height="100" fill="white" />
          ${shapeElement.replace('/>', ` fill="black" ${filterAttr} />`)}
        </mask>
      </defs>
      <rect width="100" height="100" fill="white" mask="url(#inv)" />
    `
  } else {
    content = `
      <defs>${filterDef}</defs>
      ${shapeElement.replace('/>', ` fill="white" ${filterAttr} />`)}
    `
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">${content.trim()}</svg>`
}

// ── Effect Mask Utilities ──────────────────────────────────────────────

/** Get the CSS filter string for a single effect */
export function getSingleEffectFilter(fx: ClipEffect): string {
  if (!fx.enabled) return ''
  const p = fx.params
  const filters: string[] = []
  switch (fx.type) {
    case 'blur':
      if (p.amount > 0) filters.push(`blur(${p.amount}px)`)
      break
    case 'sharpen': {
      const s = p.amount / 100
      if (s > 0) filters.push(`contrast(${1 + s * 0.3})`)
      break
    }
    case 'glow': {
      const intensity = p.amount / 100
      const radius = p.radius || 10
      if (intensity > 0) {
        filters.push(`brightness(${1 + intensity * 0.3})`)
        filters.push(`drop-shadow(0 0 ${radius * intensity}px rgba(255,255,255,${intensity * 0.4}))`)
      }
      break
    }
    default:
      break
  }
  return filters.join(' ')
}

export function getWipeClipPath(type: TransitionType, progress: number, isIn: boolean): string {
  const p = Math.max(0, Math.min(1, progress)) * 100
  switch (type) {
    case 'wipe-left':
      return isIn ? `inset(0 ${100 - p}% 0 0)` : `inset(0 0 0 ${100 - p}%)`
    case 'wipe-right':
      return isIn ? `inset(0 0 0 ${100 - p}%)` : `inset(0 ${100 - p}% 0 0)`
    case 'wipe-up':
      return isIn ? `inset(0 0 ${100 - p}% 0)` : `inset(${100 - p}% 0 0 0)`
    case 'wipe-down':
      return isIn ? `inset(${100 - p}% 0 0 0)` : `inset(0 0 ${100 - p}% 0)`
    default:
      return ''
  }
}

/** Get the background color for transition overlay */
export function getTransitionBgColor(type: TransitionType): string | null {
  if (type === 'fade-to-black') return 'black'
  if (type === 'fade-to-white') return 'white'
  return null
}

export type TimecodeDisplayFormat = 'timecode' | 'frames'

/**
 * Format seconds for the timeline ruler labels: MM:SS, rolling over to H:MM:SS
 * past the hour. `withTenths` adds a decimal when the tick spacing is sub-second,
 * otherwise consecutive labels would render identically.
 * When format is 'frames', formats as the integer frame index.
 */
export function formatRulerTime(
  seconds: number,
  withTenths = false,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): string {
  if (format === 'frames') {
    return Math.round(seconds * fps).toString()
  }
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const base = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  const stamp = hrs > 0 ? `${hrs}:${base}` : base
  if (!withTenths) return stamp
  return `${stamp}.${Math.round((seconds % 1) * 10)}`
}

/** Format seconds into HH:MM:SS:FF timecode or integer frame count */
export function formatTime(
  seconds: number,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): string {
  if (format === 'frames') {
    return Math.round(seconds * fps).toString()
  }
  const validFps = fps > 0 ? fps : 24
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const frames = Math.floor((seconds % 1) * validFps)
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

/** Parse HH:MM:SS:FF timecode string or frame number back to seconds */
export function parseTime(
  tc: string,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): number | null {
  const trimmed = tc.trim()
  const validFps = fps > 0 ? fps : 24

  // Check if string is a pure frame count (e.g. "120" or "120f" or format === 'frames')
  if (/^\d+f?$/i.test(trimmed)) {
    const rawVal = parseInt(trimmed.replace(/f/i, ''), 10)
    if (!isNaN(rawVal)) {
      return format === 'frames' || trimmed.toLowerCase().endsWith('f')
        ? rawVal / validFps
        : rawVal
    }
  }

  const cleaned = trimmed.replace(/[^0-9:;]/g, '').replace(/;/g, ':')
  const parts = cleaned.split(':')
  if (parts.length === 4) {
    const hrs = parseInt(parts[0], 10)
    const mins = parseInt(parts[1], 10)
    const secs = parseInt(parts[2], 10)
    const frames = parseInt(parts[3], 10)
    if (isNaN(hrs) || isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return hrs * 3600 + mins * 60 + secs + frames / validFps
  }
  if (parts.length === 3) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    const frames = parseInt(parts[2], 10)
    if (isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return mins * 60 + secs + frames / validFps
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    if (isNaN(mins) || isNaN(secs)) return null
    return mins * 60 + secs
  }
  if (parts.length === 1) {
    const secs = parseInt(parts[0], 10)
    if (isNaN(secs)) return null
    return format === 'frames' ? secs / validFps : secs
  }
  return null
}

// ── Keyframe sampling & utilities ──────────────────────────────────
export * from './keyframes'


/**
 * Removes every track nothing is sitting on.
 *
 * An empty row is a row the user has to scroll past and aim around, and the
 * editor used to leave a trail of them: an overlay that was cleared, an audio
 * row kept "ready" for a drop, a sticker row whose sticker was deleted.
 *
 * Three rows are spared:
 *  - the first video track, so there is always somewhere to drop the first clip
 *  - subtitle tracks, whose contents live in `subtitles` rather than `clips`
 *  - locked tracks: locking a row is the user saying leave it alone, and an
 *    empty locked row is usually one being held open on purpose
 *
 * Nothing is lost by pruning aggressively: dropping media builds whatever track
 * it needs (see buildDroppedAudioClipInsertion and addStickerClip), and +V / +A
 * still add one by hand.
 */
export function pruneEmptyTracks(
  tracks: Track[],
  clips: TimelineClip[],
  subtitles: SubtitleClip[] = [],
): { tracks: Track[]; clips: TimelineClip[]; subtitles: SubtitleClip[] } {
  const baseVideoIndex = mainVideoTrackIndex(tracks)

  const isOccupied = (index: number) =>
    clips.some(clip => clip.trackIndex === index)
    || subtitles.some(sub => sub.trackIndex === index)

  const removed = new Set<number>()
  tracks.forEach((track, index) => {
    if (index === baseVideoIndex) return
    if (track.type === 'subtitle') return
    if (track.locked) return
    if (isOccupied(index)) return
    removed.add(index)
  })

  if (removed.size === 0) {
    return { tracks, clips, subtitles }
  }

  const oldToNewIndex = new Map<number, number>()
  const nextTracks: Track[] = []
  let videoCounter = 1
  let audioCounter = 1
  let stickerCounter = 1

  tracks.forEach((track, index) => {
    if (removed.has(index)) return
    oldToNewIndex.set(index, nextTracks.length)

    if (track.type === 'subtitle') {
      nextTracks.push(track)
    } else if (track.kind === 'audio') {
      nextTracks.push({ ...track, name: `A${audioCounter++}` })
    } else if (track.kind === 'sticker') {
      nextTracks.push({ ...track, name: `S${stickerCounter++}` })
    } else {
      nextTracks.push({ ...track, name: `V${videoCounter++}` })
    }
  })

  return {
    tracks: nextTracks,
    clips: clips.map(clip => ({
      ...clip,
      trackIndex: oldToNewIndex.get(clip.trackIndex) ?? clip.trackIndex,
    })),
    subtitles: subtitles.map(sub => ({
      ...sub,
      trackIndex: oldToNewIndex.get(sub.trackIndex) ?? sub.trackIndex,
    })),
  }
}

/**
 * Where a clip is drawn inside the preview frame, in pixels of that frame.
 *
 * The preview fits the media into the frame (object-contain), then applies the
 * clip's transform. Both the on-screen bounding box and the hit test for
 * "which clip did the user just click" need that same rectangle, and computing
 * it twice is how the two drift apart.
 *
 * Rotation is deliberately ignored: this is the axis-aligned box, which is
 * what a click test wants and what the bounding box positions itself with
 * before applying its own rotation.
 */
/**
 * The size media takes inside the preview frame before any clip transform,
 * i.e. what `object-contain` produces.
 */
export function fitMediaInFrame(
  frame: { width: number; height: number },
  asset: { width?: number; height?: number } | null | undefined,
): { width: number; height: number } {
  const frameWidth = frame.width || 1
  const frameHeight = frame.height || 1
  const targetRatio = (asset?.width || frameWidth) / (asset?.height || frameHeight)
  const frameRatio = frameWidth / frameHeight

  // The media touches the frame on whichever axis runs out first.
  return frameRatio > targetRatio
    ? { width: frameHeight * targetRatio, height: frameHeight }
    : { width: frameWidth, height: frameWidth / targetRatio }
}

export function clipScreenBox(
  frame: { width: number; height: number },
  asset: { width?: number; height?: number } | null | undefined,
  transform: { scale?: number; scaleX?: number; scaleY?: number; positionX?: number; positionY?: number } | null | undefined,
): { left: number; top: number; width: number; height: number } {
  const frameWidth = frame.width || 1
  const frameHeight = frame.height || 1

  const fitted = fitMediaInFrame(frame, asset)
  const fittedWidth = fitted.width
  const fittedHeight = fitted.height

  const scaleX = Math.max(0, transform?.scaleX ?? transform?.scale ?? 100) / 100
  const scaleY = Math.max(0, transform?.scaleY ?? transform?.scale ?? 100) / 100
  const width = fittedWidth * scaleX
  const height = fittedHeight * scaleY

  // positionX / positionY are percentages of the frame, measured from centre.
  const centreX = frameWidth / 2 + (frameWidth * (transform?.positionX ?? 0)) / 100
  const centreY = frameHeight / 2 + (frameHeight * (transform?.positionY ?? 0)) / 100

  return {
    left: centreX - width / 2,
    top: centreY - height / 2,
    width,
    height,
  }
}

/**
 * Resolves the representative asset for a project's thumbnail card on the Home screen.
 * Strictly prioritizes the first video clip on Track 1 (V1) (earliest startTime / frame 1).
 * Never selects internal sticker assets as a project thumbnail.
 */
export function getProjectThumbnailAsset(project: Project): Asset | null {
  const activeTimeline = project.timelines?.find(t => t.id === project.activeTimelineId) || project.timelines?.[0]

  if (activeTimeline) {
    const v1Index = activeTimeline.tracks
      ? mainVideoTrackIndex(activeTimeline.tracks)
      : 0
    const targetTrackIndex = v1Index >= 0 ? v1Index : 0

    // 1. First video clip on Track 1 (V1), ordered by startTime
    const v1VideoClips = (activeTimeline.clips || [])
      .filter(clip => {
        if (clip.trackIndex !== targetTrackIndex) return false
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        return clip.type === 'video' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (v1VideoClips.length > 0) {
      const firstClip = v1VideoClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }

    // 2. Fallback: Any non-sticker visual clip on Track 1 (V1), ordered by startTime
    const v1VisualClips = (activeTimeline.clips || [])
      .filter(clip => {
        if (clip.trackIndex !== targetTrackIndex) return false
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        if (asset?.path?.startsWith('stickers/') || asset?.id?.startsWith('sticker-')) return false
        return clip.type === 'image' || clip.type === 'video' || asset?.type === 'image' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (v1VisualClips.length > 0) {
      const firstClip = v1VisualClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }

    // 3. Fallback: Any video clip on any timeline track, ordered by startTime
    const anyVideoClips = (activeTimeline.clips || [])
      .filter(clip => {
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        return clip.type === 'video' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (anyVideoClips.length > 0) {
      const firstClip = anyVideoClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }
  }

  // 4. Fallback: First video asset in project assets
  const videoAsset = project.assets?.find(a => a.type === 'video')
  if (videoAsset) return videoAsset

  // 5. Fallback: Non-sticker asset (in case of image-only project, but never stickers!)
  const nonStickerAsset = project.assets?.find(a => {
    if (a.path?.startsWith('stickers/') || a.id?.startsWith('sticker-')) return false
    return true
  })
  if (nonStickerAsset) return nonStickerAsset

  return null
}
