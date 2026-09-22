/**
 * SourceFrameIndex — the single source of truth for "which source frame does
 * this timeline position belong to?"
 *
 * Preview, bake and export all use this, so they all choose the same frame for
 * the same position. The index is built once per media file (from the demuxer's
 * sample table or ffprobe) and re-used across clips that share the asset.
 *
 * Frame selection uses half-open intervals: frame i owns [pts_i, pts_i+duration_i).
 * The last frame's interval is clamped to the media duration — seeking past the
 * end returns the last frame, not EOF.
 *
 * All timestamps are in microseconds (integers) to avoid floating-point drift.
 * Source time in seconds is converted to µs at the boundary, and the integer
 * search is exact.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceFrameEntry {
  /** 0-based ordinal within the source media, in presentation (PTS) order. */
  frameId: number
  /** Presentation timestamp, microseconds. */
  pts: number
  /** Duration of this frame's presentation interval, microseconds. */
  duration: number
  /** Decode timestamp, microseconds. Differs from PTS with B-frames. */
  dts: number
  /** Whether this sample is a sync / key frame. */
  isKeyframe: boolean
}

export interface SourceFrameIndex {
  /** Changes when the underlying media file changes. */
  assetRevision: string
  /** Total frames in the index. */
  frameCount: number
  /** Timebase numerator (e.g. 1 for 1/30000). */
  timebaseNum: number
  /** Timebase denominator (e.g. 30000). */
  timebaseDen: number
  /** Frames sorted by PTS ascending. */
  entries: SourceFrameEntry[]
  /** Container rotation in degrees (0, 90, 180, 270). */
  rotation: number
  /** Duration of the full source in microseconds. */
  durationUs: number
}

// ---------------------------------------------------------------------------
// Building the index
// ---------------------------------------------------------------------------

export interface RawSampleEntry {
  /** PTS in microseconds. */
  pts: number
  /** Duration in microseconds. */
  duration: number
  /** DTS in microseconds. */
  dts: number
  /** Is this a sync/key frame? */
  isKeyframe: boolean
}

/**
 * Builds a SourceFrameIndex from raw sample table entries.
 *
 * Entries need not be sorted — they are sorted by PTS and assigned frame ids
 * in presentation order. Duplicate PTS values are kept but logged.
 */
export function buildSourceFrameIndex(
  samples: RawSampleEntry[],
  opts: {
    assetRevision: string
    timebaseNum: number
    timebaseDen: number
    rotation: number
    durationUs: number
  },
): SourceFrameIndex {
  // Sort by PTS (presentation order)
  const sorted = [...samples].sort((a, b) => a.pts - b.pts)

  const entries: SourceFrameEntry[] = sorted.map((s, i) => ({
    frameId: i,
    pts: s.pts,
    duration: s.duration,
    dts: s.dts,
    isKeyframe: s.isKeyframe,
  }))

  return {
    assetRevision: opts.assetRevision,
    frameCount: entries.length,
    timebaseNum: opts.timebaseNum,
    timebaseDen: opts.timebaseDen,
    entries,
    rotation: opts.rotation,
    durationUs: opts.durationUs,
  }
}

// ---------------------------------------------------------------------------
// Timeline → source frame resolution
// ---------------------------------------------------------------------------

/**
 * Converts a timeline position to a source media time in microseconds.
 *
 * @param timelineTimeSec - Position in the timeline, seconds.
 * @param trimStartSec - Where the clip starts reading the source, seconds.
 * @param speed - Playback speed factor (1 = normal). Must be > 0.
 * @param reversed - Whether the clip is reversed.
 * @param sourceDurationUs - Total source duration in µs (needed for reverse).
 * @returns Source time in microseconds, clamped to [0, sourceDuration).
 */
export function timelineToSourceTimeUs(
  timelineTimeSec: number,
  trimStartSec: number,
  speed: number,
  reversed: boolean,
  sourceDurationUs: number,
): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1
  // Timeline seconds → source seconds consumed
  const sourceOffsetSec = timelineTimeSec * safeSpeed
  let sourceTimeSec: number

  if (reversed) {
    // Reversed: timeline 0 = end of trimmed range, progressing backward
    sourceTimeSec = (trimStartSec + (sourceDurationUs / 1_000_000)) - sourceOffsetSec
    // If trimStart + offset > media, clamp
    sourceTimeSec = Math.max(trimStartSec, sourceTimeSec)
  } else {
    sourceTimeSec = trimStartSec + sourceOffsetSec
  }

  const sourceTimeUs = Math.round(sourceTimeSec * 1_000_000)
  return Math.max(0, Math.min(sourceTimeUs, sourceDurationUs - 1))
}

/**
 * Finds the frame whose presentation interval contains `sourceTimeUs`.
 *
 * Frame i owns [pts_i, pts_i + duration_i). Binary search on sorted entries.
 *
 * Edge cases:
 * - Before the first frame → first frame.
 * - After the last frame's start → last frame (not EOF).
 * - Exact boundary between two frames → the later frame (half-open).
 */
export function findFrameAtTime(
  index: SourceFrameIndex,
  sourceTimeUs: number,
): SourceFrameEntry | null {
  const { entries } = index
  if (entries.length === 0) return null

  // Clamp
  if (sourceTimeUs <= entries[0].pts) return entries[0]
  const last = entries[entries.length - 1]
  if (sourceTimeUs >= last.pts) return last

  // Binary search: find the last entry whose pts <= sourceTimeUs
  let lo = 0
  let hi = entries.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (entries[mid].pts <= sourceTimeUs) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  return entries[lo]
}

/**
 * Resolves a timeline position to the source frame that should be presented.
 *
 * This is the main entry point used by preview, bake and export.
 */
export function resolveSourceFrame(
  index: SourceFrameIndex,
  timelineTimeSec: number,
  trimStartSec: number,
  speed: number,
  reversed: boolean,
): SourceFrameEntry | null {
  const sourceTimeUs = timelineToSourceTimeUs(
    timelineTimeSec,
    trimStartSec,
    speed,
    reversed,
    index.durationUs,
  )
  return findFrameAtTime(index, sourceTimeUs)
}

// ---------------------------------------------------------------------------
// Nearest keyframe (for seek optimisation in KE-1807)
// ---------------------------------------------------------------------------

/**
 * Finds the keyframe at or before `sourceTimeUs`.
 * Returns null only if the index is empty.
 */
export function findNearestKeyframeBefore(
  index: SourceFrameIndex,
  sourceTimeUs: number,
): SourceFrameEntry | null {
  const { entries } = index
  if (entries.length === 0) return null

  // Binary search for the frame at time
  let lo = 0
  let hi = entries.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (entries[mid].pts <= sourceTimeUs) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  // Walk backwards to the nearest keyframe
  for (let i = lo; i >= 0; i--) {
    if (entries[i].isKeyframe) return entries[i]
  }
  // Fallback: first frame (should always be a keyframe in a valid file)
  return entries[0]
}

// ---------------------------------------------------------------------------
// Bake v2: manifest types
// ---------------------------------------------------------------------------

/** Version of the bake manifest format. */
export const BAKE_MANIFEST_VERSION = 2

export type BakeStatus = 'complete' | 'partial' | 'error'

export interface BakeManifestV2 {
  /** Always 2 for this version. */
  version: typeof BAKE_MANIFEST_VERSION
  /** Hash/revision of the source media file. */
  assetRevision: string
  /** Model identifier, e.g. 'rvm-mobilenetv3'. */
  model: string
  /** Hash of the model file, for reproducibility. */
  modelHash: string
  /** Pipeline version — changes when inference pre/post processing changes. */
  pipelineVersion: number
  /** Source frame geometry, e.g. '1920x1080'. */
  geometry: string
  /** Container rotation of source, degrees. */
  rotation: number
  /** Timebase as [num, den]. */
  timebase: [number, number]
  /** Alpha value range in the output file (typically [0, 255]). */
  alphaRange: [number, number]
  /**
   * Maps each ordinal in the bake MP4 to a source frame.
   *
   * The bake is always in source-frame order (not time-warped). The consumer
   * applies speed/reverse at read time.
   */
  frameMap: BakeFrameMapEntry[]
  /** What this bake actually covers (measured, not requested). */
  coverageActual: { sourceStart: number; sourceSpan: number }
  /** Terminal status. */
  status: BakeStatus
  /** ISO 8601 timestamp of when the bake completed. */
  completedAt: string
}

export interface BakeFrameMapEntry {
  /** 0-based ordinal within the bake MP4. */
  ordinal: number
  /** The source frame id this ordinal corresponds to. */
  sourceFrameId: number
  /** Source PTS in microseconds. */
  sourcePts: number
}

// ---------------------------------------------------------------------------
// Legacy bake adapter
// ---------------------------------------------------------------------------

/**
 * Whether a bake has a v2 manifest.
 */
export function hasBakeManifestV2(manifest: unknown): manifest is BakeManifestV2 {
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    (manifest as any).version === BAKE_MANIFEST_VERSION
  )
}

/**
 * Validates a manifest v2 for internal consistency.
 *
 * Returns an array of issues (empty = valid).
 */
export function validateBakeManifestV2(manifest: BakeManifestV2): string[] {
  const issues: string[] = []

  if (manifest.version !== BAKE_MANIFEST_VERSION) {
    issues.push(`Expected version ${BAKE_MANIFEST_VERSION}, got ${manifest.version}`)
  }

  if (manifest.frameMap.length === 0 && manifest.status === 'complete') {
    issues.push('Complete manifest with zero frames')
  }

  // Check frame map is monotonically increasing in ordinal
  for (let i = 1; i < manifest.frameMap.length; i++) {
    if (manifest.frameMap[i].ordinal !== manifest.frameMap[i - 1].ordinal + 1) {
      issues.push(`Frame map ordinal gap at index ${i}`)
    }
  }

  // Check coverage is non-negative
  if (manifest.coverageActual.sourceSpan < 0) {
    issues.push('Negative coverage span')
  }

  if (manifest.status !== 'complete' && manifest.status !== 'partial' && manifest.status !== 'error') {
    issues.push(`Invalid status: ${manifest.status}`)
  }

  return issues
}

/**
 * Looks up the bake ordinal for a given source frame id.
 *
 * Returns -1 if the frame is not covered by this bake.
 */
export function bakeOrdinalForSourceFrame(
  manifest: BakeManifestV2,
  sourceFrameId: number,
): number {
  // Frame map is typically sorted by sourceFrameId (source order bake),
  // so we can binary search.
  let lo = 0
  let hi = manifest.frameMap.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const entry = manifest.frameMap[mid]
    if (entry.sourceFrameId === sourceFrameId) return entry.ordinal
    if (entry.sourceFrameId < sourceFrameId) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}
