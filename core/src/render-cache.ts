import type { Timeline, TimelineClip } from './project-model'

export interface ComplexSegment {
  id: string
  startTime: number
  endTime: number
  duration: number
  reasons: string[]
}

/**
 * Longest segment the render cache will take on in one piece.
 *
 * Must stay at or below the preview renderer's own ceiling (see startPreviewJob), which
 * silently clamps anything longer.
 */
export const MAX_CACHE_SEGMENT_SECONDS = 30

const PREVIEW_SHORT_SIDE: Record<string, number> = { '360p': 360, '480p': 480, '720p': 720 }

/**
 * Pixel size of a cached preview segment for a timeline of the given aspect ratio.
 *
 * The resolution names the short side, so a 9:16 timeline at 480p renders 480x854 and a
 * 16:9 one 854x480. This used to be a fixed landscape table: every portrait project was
 * rendered into a 16:9 frame, its clip positions and crops were laid out against the
 * wrong width and height, and the monitor played that picture back whenever it hit a
 * multi-layer segment — the upper video showed up again lower down, only during playback.
 */
export function previewFrameSize(
  resolution: string = '480p',
  aspectRatio: number = 16 / 9,
): { width: number; height: number } {
  const shortSide = PREVIEW_SHORT_SIDE[resolution] ?? PREVIEW_SHORT_SIDE['480p']
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / ratio) }
}

export interface RawInterval {
  start: number
  end: number
  reason: string
}

/**
 * 64-bit deterministic hash combining two 32-bit FNV-1a hashes.
 * Runs identically in Node, browser, and test environments without crypto dependency.
 */
export function fastHash64(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x27d4eb2f
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ ((code << 5) | (code >>> 27)), 0x5bd1e995)
  }
  const s1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const s2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return `${s1}${s2}`
}

/**
 * Identifies complex segments on the timeline that warrant pre-rendering to cache:
 * 1. Transitions between clips (xfade overlap window).
 * 2. Overlapping visual layers (2 or more visual clips playing simultaneously).
 * 3. Chroma key, custom alpha masks, non-normal blend modes.
 * 4. Adjustment layers.
 */
export function findComplexSegments(timeline: Timeline): ComplexSegment[] {
  const clips = (timeline.clips || []).filter(c => c.type !== 'audio')
  const transitions = timeline.transitions || []
  const rawIntervals: RawInterval[] = []

  // 1. Transitions
  for (const trans of transitions) {
    const left = clips.find(c => c.id === trans.leftClipId)
    const right = clips.find(c => c.id === trans.rightClipId)
    if (left && right) {
      const start = right.startTime
      const end = left.startTime + left.duration
      if (end > start) {
        rawIntervals.push({ start, end, reason: 'transition' })
      }
    }
  }

  // 2. Heavy compositing features (adjustment layers, non-normal blend modes)
  // Single-clip effects (stroke, speed, auto-matte, chroma key) are rendered 100% in-memory
  // in realtime via WebGL and WebCodecs, without requiring slow and wasteful background video bakes.
  for (const clip of clips) {
    const start = clip.startTime
    const end = clip.startTime + clip.duration
    if (clip.type === 'adjustment') {
      rawIntervals.push({ start, end, reason: 'adjustment' })
    }
    if (clip.blendMode && clip.blendMode !== 'normal') {
      rawIntervals.push({ start, end, reason: 'blendmode' })
    }
  }

  // 3. Multi-layer visual overlaps
  if (clips.length > 1) {
    const timePoints = new Set<number>()
    for (const c of clips) {
      timePoints.add(c.startTime)
      timePoints.add(c.startTime + c.duration)
    }
    const sortedTimes = Array.from(timePoints).sort((a, b) => a - b)
    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const t0 = sortedTimes[i]
      const t1 = sortedTimes[i + 1]
      if (t1 - t0 < 0.05) continue
      const mid = (t0 + t1) / 2
      const activeCount = clips.filter(c => c.startTime <= mid && mid < c.startTime + c.duration).length
      if (activeCount >= 2) {
        rawIntervals.push({ start: t0, end: t1, reason: 'multi_layer' })
      }
    }
  }

  if (rawIntervals.length === 0) return []

  // Sort intervals by start time
  rawIntervals.sort((a, b) => a.start - b.start)

  // Merge contiguous or overlapping intervals
  const merged: Array<{ start: number; end: number; reasons: Set<string> }> = []
  for (const item of rawIntervals) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ start: item.start, end: item.end, reasons: new Set([item.reason]) })
      continue
    }

    // Merge if overlapping or abutting within 0.1s tolerance
    if (item.start <= last.end + 0.1) {
      last.end = Math.max(last.end, item.end)
      last.reasons.add(item.reason)
    } else {
      merged.push({ start: item.start, end: item.end, reasons: new Set([item.reason]) })
    }
  }

  // Filter out micro-segments (< 0.25s), split what is too long to cache, format output
  const segments: ComplexSegment[] = []
  for (const m of merged) {
    const mergedStart = Number(m.start.toFixed(3))
    const mergedEnd = Number(m.end.toFixed(3))
    const mergedDuration = mergedEnd - mergedStart
    if (mergedDuration < 0.25) continue

    // A segment is cached by rendering it, and that renderer will not produce more than
    // MAX_CACHE_SEGMENT_SECONDS in one pass. A longer segment used to be handed over
    // whole, come back truncated, and still be marked ready for its full span — so the
    // preview played the cache past the end of the file and froze on the last frame.
    // Splitting here keeps every segment inside what can actually be rendered, and has
    // the side benefit that editing one part of a long overlap only invalidates its own
    // chunk.
    const parts = Math.max(1, Math.ceil(mergedDuration / MAX_CACHE_SEGMENT_SECONDS))
    const partDuration = mergedDuration / parts

    for (let i = 0; i < parts; i++) {
      const start = Number((mergedStart + i * partDuration).toFixed(3))
      const end = Number((i === parts - 1 ? mergedEnd : mergedStart + (i + 1) * partDuration).toFixed(3))
      const duration = Number((end - start).toFixed(3))
      if (duration < 0.25) continue
      segments.push({
        id: `seg_${start.toFixed(2)}_${end.toFixed(2)}`,
        startTime: start,
        endTime: end,
        duration,
        reasons: Array.from(m.reasons),
      })
    }
  }

  return segments
}

/**
 * The part of a clip's auto matte that changes the picture.
 *
 * `autoMatte.bake` carries `createdAt: Date.now()` and a frame count, neither of which
 * the rendered frame depends on. Hashing the whole object meant that finishing a bake —
 * even one that produced a byte-identical matte — changed every segment hash that clip
 * appeared in, threw away the cached segments, and started the renders again. The bake's
 * fingerprint is kept, because a *different* matte really is a different picture.
 */
function stableAutoMatte(autoMatte: TimelineClip['autoMatte']): unknown {
  if (!autoMatte) return undefined
  return {
    enabled: autoMatte.enabled,
    model: autoMatte.model,
    quality: autoMatte.quality,
    featherEdge: autoMatte.featherEdge,
    cleanEdge: autoMatte.cleanEdge,
    bakeFingerprint: autoMatte.bake?.fingerprint ?? null,
  }
}

/**
 * Computes a deterministic content hash for a complex segment.
 * If any visual property (clip positions, trims, colors, transforms, masks,
 * blend modes, transitions, keyframes, background) inside the segment changes,
 * the hash changes, invalidating any old cache automatically.
 */
export function computeSegmentContentHash(
  segment: { startTime: number; endTime: number },
  timeline: Timeline,
  resolution = '540p',
  aspectRatio?: number,
): string {
  const { startTime, endTime } = segment

  // 1. Clips intersecting this range
  const intersectingClips = (timeline.clips || [])
    .filter(clip => {
      const clipStart = clip.startTime
      const clipEnd = clip.startTime + clip.duration
      return clipEnd > startTime && clipStart < endTime
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(c => ({
      id: c.id,
      assetId: c.assetId,
      path: c.asset?.path || (c as any).path || '',
      type: c.type,
      trackIndex: c.trackIndex,
      startTime: c.startTime,
      duration: c.duration,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      speed: c.speed,
      speedCurve: c.speedCurve,
      reversed: c.reversed,
      opacity: c.opacity,
      transform: c.transform,
      colorCorrection: c.colorCorrection,
      filter: c.filter,
      mask: c.mask,
      masks: c.masks,
      chromaKey: c.chromaKey,
      autoMatte: stableAutoMatte(c.autoMatte),
      customMatte: c.customMatte ? {
        enabled: c.customMatte.enabled,
        strokesCount: c.customMatte.strokes?.length ?? 0,
        appliedHash: c.customMatte.appliedHash ?? null,
        // The matte follows the camera; a re-tracked shot is a different picture.
        motion: c.customMatte.motion
          ? fastHash64(`${c.customMatte.motion.t0}:${c.customMatte.motion.step}:${c.customMatte.motion.m.map(v => v.toFixed(3)).join(',')}`)
          : null,
      } : null,
      stroke: c.stroke ? {
        enabled: c.stroke.enabled,
        style: c.stroke.style,
        width: c.stroke.width,
        color: c.stroke.color,
        opacity: c.stroke.opacity,
        offsetX: c.stroke.offsetX,
        offsetY: c.stroke.offsetY,
        glow: c.stroke.glow,
        roughness: c.stroke.roughness,
        gap: c.stroke.gap,
        seed: c.stroke.seed,
      } : null,
      blendMode: c.blendMode,
      keyframes: c.keyframes,
      textStyle: c.textStyle,
    }))

  // 2. Transitions intersecting this range
  const intersectingTransitions = (timeline.transitions || [])
    .filter(trans => {
      const left = timeline.clips?.find(c => c.id === trans.leftClipId)
      const right = timeline.clips?.find(c => c.id === trans.rightClipId)
      if (!left || !right) return false
      const tStart = right.startTime
      const tEnd = left.startTime + left.duration
      return tEnd > startTime && tStart < endTime
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => ({
      id: t.id,
      type: t.type,
      duration: t.duration,
      leftClipId: t.leftClipId,
      rightClipId: t.rightClipId,
    }))

  const canonicalPayload = {
    startTime,
    endTime,
    resolution,
    // The frame shape decides where every clip lands, so a segment rendered for 16:9
    // must never be served to a 9:16 timeline.
    aspectRatio: aspectRatio !== undefined ? Number(aspectRatio.toFixed(4)) : null,
    background: timeline.background,
    clips: intersectingClips,
    transitions: intersectingTransitions,
  }

  return fastHash64(JSON.stringify(canonicalPayload))
}
