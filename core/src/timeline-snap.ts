import type { TimelineClip, TimelineTransition, TimelineMarker } from './project-model'
import { findCutPoints } from './timeline-cuts'

export type SnapTargetType =
  | 'clip-start'
  | 'clip-end'
  | 'cut'
  | 'transition-junction'
  | 'playhead'
  | 'marker'

export interface SnapTarget {
  time: number
  type: SnapTargetType
  trackIndex?: number
  clipId?: string
}

export interface SnapResult {
  snappedTime: number
  delta: number
  snappedTarget: SnapTarget | null
}

export const DEFAULT_SNAP_PIXEL_THRESHOLD = 14
export const MIN_SNAP_SECONDS = 0.15

/**
 * Calculates the snap threshold in seconds based on timeline zoom level (pixelsPerSecond).
 * Ensures a consistent physical pixel distance (~14px) on screen regardless of zoom.
 */
export function computeSnapThresholdSeconds(
  pixelsPerSecond: number,
  pixelThreshold: number = DEFAULT_SNAP_PIXEL_THRESHOLD,
  minSeconds: number = MIN_SNAP_SECONDS,
): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0.2
  return Math.max(minSeconds, pixelThreshold / pixelsPerSecond)
}

/**
 * Collects all candidate snap points across the entire timeline:
 * - Clip start and end boundaries on all tracks
 * - Cut points between adjacent clips
 * - Transition junctions and overlap boundaries
 * - Current playhead position
 * - Timeline markers
 */
export function collectTimelineSnapTargets(params: {
  clips: TimelineClip[]
  transitions?: ReadonlyArray<TimelineTransition>
  currentTime?: number
  markers?: ReadonlyArray<TimelineMarker>
  ignoreClipIds?: ReadonlySet<string>
}): SnapTarget[] {
  const { clips, transitions = [], currentTime, markers = [], ignoreClipIds } = params
  const rawTargets: SnapTarget[] = []

  // 1. Clip start and end boundaries (skipping clips being manipulated)
  for (const clip of clips) {
    if (ignoreClipIds?.has(clip.id)) continue
    if (!Number.isFinite(clip.startTime) || !Number.isFinite(clip.duration)) continue

    rawTargets.push({
      time: clip.startTime,
      type: 'clip-start',
      trackIndex: clip.trackIndex,
      clipId: clip.id,
    })

    rawTargets.push({
      time: clip.startTime + clip.duration,
      type: 'clip-end',
      trackIndex: clip.trackIndex,
      clipId: clip.id,
    })
  }

  // 2. Cut points and transition junctions
  try {
    const cuts = findCutPoints(clips, [...transitions])
    for (const cut of cuts) {
      if (ignoreClipIds?.has(cut.leftClip.id) || ignoreClipIds?.has(cut.rightClip.id)) {
        continue
      }

      // The primary cut point
      rawTargets.push({
        time: cut.time,
        type: 'cut',
        trackIndex: cut.trackIndex,
      })

      // If there is an active transition across the cut
      if (cut.transition) {
        const junctionTime =
          cut.rightClip.startTime + (cut.transition.rightExtend ?? cut.transition.duration / 2)
        rawTargets.push({
          time: junctionTime,
          type: 'transition-junction',
          trackIndex: cut.trackIndex,
        })
        rawTargets.push({
          time: cut.overlapStart,
          type: 'cut',
          trackIndex: cut.trackIndex,
        })
        rawTargets.push({
          time: cut.overlapEnd,
          type: 'cut',
          trackIndex: cut.trackIndex,
        })
      }
    }
  } catch {
    // If findCutPoints fails on invalid timeline data, continue with clip edges
  }

  // 3. Playhead (current time)
  if (typeof currentTime === 'number' && Number.isFinite(currentTime) && currentTime >= 0) {
    rawTargets.push({
      time: currentTime,
      type: 'playhead',
    })
  }

  // 4. Markers
  for (const marker of markers) {
    if (Number.isFinite(marker.time) && marker.time >= 0) {
      rawTargets.push({
        time: marker.time,
        type: 'marker',
      })
    }
  }

  return deduplicateSnapTargets(rawTargets)
}

/**
 * Deduplicates snap targets with virtually identical timestamps (within 2ms).
 * Gives priority to cuts, transition junctions, and clip edges.
 */
export function deduplicateSnapTargets(targets: SnapTarget[]): SnapTarget[] {
  if (targets.length <= 1) return targets

  const priorityOrder: Record<SnapTargetType, number> = {
    'transition-junction': 1,
    cut: 2,
    'clip-end': 3,
    'clip-start': 4,
    playhead: 5,
    marker: 6,
  }

  const sorted = [...targets].sort((a, b) => {
    if (Math.abs(a.time - b.time) > 0.002) {
      return a.time - b.time
    }
    return (priorityOrder[a.type] ?? 99) - (priorityOrder[b.type] ?? 99)
  })

  const deduplicated: SnapTarget[] = []
  for (const target of sorted) {
    if (!Number.isFinite(target.time) || target.time < 0) continue
    const last = deduplicated[deduplicated.length - 1]
    if (!last || Math.abs(target.time - last.time) > 0.002) {
      deduplicated.push(target)
    }
  }

  return deduplicated
}

function roundTime(time: number): number {
  return Math.round(time * 1000) / 1000
}

/**
 * Snaps a clip move (drag).
 * Checks BOTH the start edge and end edge of the moving clip against all snap targets,
 * and selects the target with the minimum distance within snapThreshold.
 */
export function snapClipMove(params: {
  proposedStartTime: number
  duration: number
  targets: SnapTarget[]
  snapThreshold: number
}): SnapResult {
  const { proposedStartTime, duration, targets, snapThreshold } = params
  const proposedEndTime = proposedStartTime + duration

  let bestDelta: number | null = null
  let bestTarget: SnapTarget | null = null
  let minAbsDistance = snapThreshold

  for (const target of targets) {
    // 1. Check clip start edge snapping to target
    const deltaStart = target.time - proposedStartTime
    const absStart = Math.abs(deltaStart)
    if (absStart < minAbsDistance) {
      if (proposedStartTime + deltaStart >= -0.001) {
        minAbsDistance = absStart
        bestDelta = deltaStart
        bestTarget = target
      }
    }

    // 2. Check clip end edge snapping to target
    const deltaEnd = target.time - proposedEndTime
    const absEnd = Math.abs(deltaEnd)
    if (absEnd < minAbsDistance) {
      if (proposedStartTime + deltaEnd >= -0.001) {
        minAbsDistance = absEnd
        bestDelta = deltaEnd
        bestTarget = target
      }
    }
  }

  if (bestDelta !== null && bestTarget !== null) {
    const rawSnapped = Math.max(0, proposedStartTime + bestDelta)
    return {
      snappedTime: roundTime(rawSnapped),
      delta: roundTime(bestDelta),
      snappedTarget: bestTarget,
    }
  }

  return {
    snappedTime: roundTime(Math.max(0, proposedStartTime)),
    delta: 0,
    snappedTarget: null,
  }
}

/**
 * Snaps a clip resize (trim).
 * Snaps either the left edge (proposedStartTime) or the right edge (proposedEndTime)
 * to the nearest target within snapThreshold.
 */
export function snapClipResize(params: {
  edge: 'left' | 'right'
  proposedTime: number
  targets: SnapTarget[]
  snapThreshold: number
}): SnapResult {
  const { proposedTime, targets, snapThreshold } = params

  let bestDelta: number | null = null
  let bestTarget: SnapTarget | null = null
  let minAbsDistance = snapThreshold

  for (const target of targets) {
    const delta = target.time - proposedTime
    const absDistance = Math.abs(delta)
    if (absDistance < minAbsDistance) {
      minAbsDistance = absDistance
      bestDelta = delta
      bestTarget = target
    }
  }

  if (bestDelta !== null && bestTarget !== null) {
    return {
      snappedTime: roundTime(proposedTime + bestDelta),
      delta: roundTime(bestDelta),
      snappedTarget: bestTarget,
    }
  }

  return {
    snappedTime: roundTime(proposedTime),
    delta: 0,
    snappedTarget: null,
  }
}


/** How close (on screen) the playhead must come to an edge before it catches on it. */
export const PLAYHEAD_SNAP_PIXEL_THRESHOLD = 10

/**
 * The playhead's snap distance in seconds. Pixels only, with no floor in seconds: a floor
 * that suits dragging clips would, zoomed in, grab the playhead from far across the screen
 * and make frame-accurate scrubbing impossible.
 */
export function computePlayheadSnapThresholdSeconds(pixelsPerSecond: number): number {
  return computeSnapThresholdSeconds(pixelsPerSecond, PLAYHEAD_SNAP_PIXEL_THRESHOLD, 0)
}

/**
 * What the scrubbing playhead catches on: every clip's start and end on every track, the
 * cuts and transition junctions between them, and markers. Not the playhead itself.
 */
export function collectPlayheadSnapTargets(params: {
  clips: TimelineClip[]
  transitions?: ReadonlyArray<TimelineTransition>
  markers?: ReadonlyArray<TimelineMarker>
}): SnapTarget[] {
  return collectTimelineSnapTargets({ ...params, currentTime: undefined })
}

/**
 * Snaps a scrubbed playhead time to the nearest target within `snapThreshold`, or leaves
 * it where the pointer put it.
 */
export function snapPlayheadTime(params: {
  time: number
  targets: ReadonlyArray<SnapTarget>
  snapThreshold: number
}): SnapResult {
  const { time, targets, snapThreshold } = params
  let bestTarget: SnapTarget | null = null
  let bestDistance = snapThreshold
  for (const target of targets) {
    if (target.type === 'playhead') continue
    const distance = Math.abs(target.time - time)
    if (distance <= bestDistance) {
      bestDistance = distance
      bestTarget = target
    }
  }
  if (!bestTarget) return { snappedTime: time, delta: 0, snappedTarget: null }
  return { snappedTime: bestTarget.time, delta: bestTarget.time - time, snappedTarget: bestTarget }
}
