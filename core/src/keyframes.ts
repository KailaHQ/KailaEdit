import type {
  KeyframeProperty,
  KeyframeEasing,
  KeyframePoint,
  KeyframeTrack,
  TimelineClip,
} from './project-model'
import { DEFAULT_CLIP_TRANSFORM } from './project-model'

/**
 * Result of sampling clip properties at a specific point in time.
 * Note: timeInClip is measured in SECONDS relative to the clip start.
 */
export interface SampledClipProperties {
  scale: number
  positionX: number
  positionY: number
  rotation: number
  opacity: number
  /** Linear gain (1 = unity, 0 = silence). NOT a percentage! */
  volume: number
  /** Playback speed factor at this moment (e.g. 1 = normal, 0.5 = slow, 2 = fast) */
  speed: number
  filterIntensity: number
  /** Percentage of text characters visible (0 to 100). Default is 100. */
  textProgress: number
  chromaKeySimilarity?: number
  chromaKeySmoothness?: number
  chromaKeySpill?: number
  chromaKeyFeatherEdge?: number
  chromaKeyCleanEdge?: number
}

/**
 * Evaluate an easing function for a normalized progress [0, 1].
 */
export function evaluateEasing(progress: number, easing: KeyframeEasing = 'linear'): number {
  const p = Math.max(0, Math.min(1, progress))
  switch (easing) {
    case 'linear':
      return p
    case 'ease-in':
      return p * p
    case 'ease-out':
      return p * (2 - p)
    case 'ease-in-out':
      return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    case 'hold':
      return 0
    default:
      return p
  }
}

/**
 * Interpolate between two keyframe points at time t.
 * Easing is determined by the starting keyframe point (p0.easing).
 */
export function interpolatePoints(p0: KeyframePoint, p1: KeyframePoint, t: number): number {
  if (p1.t <= p0.t) return p0.value
  if (t <= p0.t) return p0.value
  if (t >= p1.t) return p1.value
  const progress = (t - p0.t) / (p1.t - p0.t)
  const easedProgress = evaluateEasing(progress, p0.easing)
  return p0.value + (p1.value - p0.value) * easedProgress
}

/**
 * Find the keyframe track for a specific property on a clip.
 */
export function getKeyframeTrack(
  clip: TimelineClip,
  property: KeyframeProperty,
): KeyframeTrack | undefined {
  return clip.keyframes?.find(k => k.property === property)
}

/**
 * Check whether a clip has any keyframes at all.
 */
export function hasKeyframes(clip: TimelineClip): boolean {
  return Boolean(clip.keyframes && clip.keyframes.some(k => k.points.length > 0))
}

/**
 * Check whether a clip has keyframes for a specific property.
 */
export function hasKeyframesForProperty(
  clip: TimelineClip,
  property: KeyframeProperty,
): boolean {
  const track = getKeyframeTrack(clip, property)
  return Boolean(track && track.points.length > 0)
}

/**
 * Sample a keyframe track at a given time in seconds within the clip.
 *
 * Rules:
 * 1. If no track or points exist, returns defaultValue.
 * 2. If exactly 1 point, returns that point's value everywhere.
 * 3. Boundary handling:
 *    - For timeInClip <= firstPoint.t: clamps to firstPoint.value.
 *    - For timeInClip >= lastPoint.t: clamps to lastPoint.value.
 * 4. Between two points: interpolates using the first point's easing curve.
 */
export function sampleKeyframeTrack(
  track: KeyframeTrack | undefined,
  timeInClip: number,
  defaultValue: number,
): number {
  if (!track || !track.points || track.points.length === 0) {
    return defaultValue
  }

  const points = track.points
  if (points.length === 1) {
    return points[0].value
  }

  // Clamping at boundaries
  if (timeInClip <= points[0].t) {
    return points[0].value
  }
  if (timeInClip >= points[points.length - 1].t) {
    return points[points.length - 1].value
  }

  // Find surrounding interval [points[i], points[i+1]]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    if (timeInClip >= p0.t && timeInClip <= p1.t) {
      return interpolatePoints(p0, p1, timeInClip)
    }
  }

  return points[points.length - 1].value
}

/**
 * Sample all animatable properties of a clip at a specific time in seconds within the clip.
 * When a property has no keyframe track, its static value on the clip is returned.
 *
 * @param clip The timeline clip to sample
 * @param timeInClip Time in SECONDS relative to clip start (0 <= timeInClip <= clip.duration)
 */
export function sampleClipAt(clip: TimelineClip, timeInClip: number): SampledClipProperties {
  const tf = clip.transform ?? DEFAULT_CLIP_TRANSFORM

  const scale = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.scale'),
    timeInClip,
    tf.scale ?? 100,
  )
  const positionX = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.positionX'),
    timeInClip,
    tf.positionX ?? 0,
  )
  const positionY = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.positionY'),
    timeInClip,
    tf.positionY ?? 0,
  )
  const rotation = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.rotation'),
    timeInClip,
    tf.rotation ?? 0,
  )
  const opacity = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'opacity'),
    timeInClip,
    clip.opacity ?? 100,
  )
  const volume = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'volume'),
    timeInClip,
    clip.volume ?? 1,
  )
  const speed = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'speed'),
    timeInClip,
    clip.speed ?? 1,
  )
  const filterIntensity = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'filter.intensity'),
    timeInClip,
    clip.filter?.intensity ?? 100,
  )
  const textProgress = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'text.progress'),
    timeInClip,
    100,
  )

  const chromaKeySimilarity = clip.chromaKey
    ? sampleKeyframeTrack(
        getKeyframeTrack(clip, 'chromaKey.similarity'),
        timeInClip,
        clip.chromaKey.similarity ?? 30,
      )
    : undefined
  const chromaKeySmoothness = clip.chromaKey
    ? sampleKeyframeTrack(
        getKeyframeTrack(clip, 'chromaKey.smoothness'),
        timeInClip,
        clip.chromaKey.smoothness ?? 10,
      )
    : undefined
  const chromaKeySpill = clip.chromaKey
    ? sampleKeyframeTrack(
        getKeyframeTrack(clip, 'chromaKey.spill'),
        timeInClip,
        clip.chromaKey.spill ?? 10,
      )
    : undefined
  const chromaKeyFeatherEdge = clip.chromaKey
    ? sampleKeyframeTrack(
        getKeyframeTrack(clip, 'chromaKey.featherEdge'),
        timeInClip,
        clip.chromaKey.featherEdge ?? 0,
      )
    : undefined
  const chromaKeyCleanEdge = clip.chromaKey
    ? sampleKeyframeTrack(
        getKeyframeTrack(clip, 'chromaKey.cleanEdge'),
        timeInClip,
        clip.chromaKey.cleanEdge ?? 0,
      )
    : undefined

  return {
    scale,
    positionX,
    positionY,
    rotation,
    opacity,
    volume,
    speed,
    filterIntensity,
    textProgress,
    chromaKeySimilarity,
    chromaKeySmoothness,
    chromaKeySpill,
    chromaKeyFeatherEdge,
    chromaKeyCleanEdge,
  }
}

/**
 * Add or update a keyframe point on a clip's property track, keeping points sorted by t.
 * Returns a new clip instance with updated keyframes.
 */
export function upsertKeyframe(
  clip: TimelineClip,
  property: KeyframeProperty,
  point: KeyframePoint,
  timeTolerance = 0.005,
): TimelineClip {
  const currentKeyframes = clip.keyframes ? [...clip.keyframes] : []
  const trackIndex = currentKeyframes.findIndex(k => k.property === property)

  let track: KeyframeTrack
  if (trackIndex >= 0) {
    track = {
      ...currentKeyframes[trackIndex],
      points: [...currentKeyframes[trackIndex].points],
    }
  } else {
    track = { property, points: [] }
    currentKeyframes.push(track)
  }

  // Check if an existing point is close enough to update
  const existingIdx = track.points.findIndex(p => Math.abs(p.t - point.t) <= timeTolerance)
  if (existingIdx >= 0) {
    track.points[existingIdx] = { ...point }
  } else {
    track.points.push({ ...point })
  }

  // Keep points sorted by t
  track.points.sort((a, b) => a.t - b.t)

  const updatedKeyframes = currentKeyframes.map(k => (k.property === property ? track : k))

  return {
    ...clip,
    keyframes: updatedKeyframes,
  }
}

/**
 * Remove a keyframe point near the given time within tolerance.
 * Returns a new clip instance with updated keyframes.
 */
export function removeKeyframe(
  clip: TimelineClip,
  property: KeyframeProperty,
  timeInClip: number,
  timeTolerance = 0.05,
): TimelineClip {
  if (!clip.keyframes) return clip

  const currentKeyframes = clip.keyframes.map(track => {
    if (track.property !== property) return track
    const filteredPoints = track.points.filter(p => Math.abs(p.t - timeInClip) > timeTolerance)
    return { ...track, points: filteredPoints }
  }).filter(track => track.points.length > 0)

  return {
    ...clip,
    keyframes: currentKeyframes.length > 0 ? currentKeyframes : undefined,
  }
}

/**
 * Find a keyframe point on a track near time t within tolerance.
 */
export function getKeyframeAt(
  track: KeyframeTrack | undefined,
  timeInClip: number,
  tolerance = 0.05,
): KeyframePoint | undefined {
  if (!track || !track.points) return undefined
  return track.points.find(p => Math.abs(p.t - timeInClip) <= tolerance)
}

/**
 * Move an existing keyframe point from oldT to newT.
 * Keeps points sorted by t and clamped within clip duration.
 */
export function moveKeyframePoint(
  clip: TimelineClip,
  property: KeyframeProperty,
  oldT: number,
  newT: number,
  tolerance = 0.05,
  newValue?: number,
): TimelineClip {
  if (!clip.keyframes) return clip
  const track = getKeyframeTrack(clip, property)
  if (!track || !track.points.length) return clip

  const existingPoint = track.points.find(p => Math.abs(p.t - oldT) <= tolerance)
  if (!existingPoint) return clip

  const clampedNewT = Math.max(0, Math.min(clip.duration, newT))
  const withoutOld = removeKeyframe(clip, property, oldT, tolerance)
  return upsertKeyframe(withoutOld, property, {
    ...existingPoint,
    t: clampedNewT,
    value: newValue !== undefined ? newValue : existingPoint.value,
  })
}

/**
 * Update the easing curve of a keyframe at time t.
 */
export function updateKeyframeEasing(
  clip: TimelineClip,
  property: KeyframeProperty,
  timeInClip: number,
  easing: KeyframeEasing,
  tolerance = 0.05,
): TimelineClip {
  if (!clip.keyframes) return clip
  const track = getKeyframeTrack(clip, property)
  if (!track) return clip

  const point = track.points.find(p => Math.abs(p.t - timeInClip) <= tolerance)
  if (!point) return clip

  return upsertKeyframe(clip, property, { ...point, easing }, tolerance)
}

/**
 * Clear keyframes for a single property, or all properties if property is omitted.
 */
export function clearKeyframesForProperty(
  clip: TimelineClip,
  property?: KeyframeProperty,
): TimelineClip {
  if (!clip.keyframes) return clip
  if (!property) {
    return { ...clip, keyframes: undefined }
  }
  const remaining = clip.keyframes.filter(k => k.property !== property)
  return {
    ...clip,
    keyframes: remaining.length > 0 ? remaining : undefined,
  }
}

/**
 * Format a number cleanly for ffmpeg expressions without exponential notation.
 */
function formatExprNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  return Number(n.toFixed(6)).toString()
}

/**
 * Build an FFmpeg nested ternary `if(...)` expression for a keyframe track.
 *
 * Evaluates piecewise interpolation over variable `timeVar` (e.g. 't' or 'T').
 * If track has no points, returns `defaultValue`.
 * If track has 1 point, returns that point's value.
 * Otherwise, generates nested if(lte(timeVar, t_i), ...) matching `sampleKeyframeTrack`.
 *
 * @param track Keyframe track
 * @param defaultValue Fallback value if no keyframes exist
 * @param timeVar Variable name representing time in the filter (defaults to 't')
 */
export function buildKeyframeFfmpegExpression(
  track: KeyframeTrack | undefined,
  defaultValue: number,
  timeVar = 't',
): string {
  if (!track || !track.points || track.points.length === 0) {
    return formatExprNumber(defaultValue)
  }

  const points = [...track.points].sort((a, b) => a.t - b.t)
  if (points.length === 1) {
    return formatExprNumber(points[0].value)
  }

  const pLast = points[points.length - 1]
  let expr = formatExprNumber(pLast.value)

  for (let i = points.length - 2; i >= 0; i--) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dt = p1.t - p0.t
    const dv = p1.value - p0.value

    let segExpr: string
    if (dt <= 1e-6 || Math.abs(dv) < 1e-6) {
      segExpr = formatExprNumber(p0.value)
    } else {
      const u = `((${timeVar}-${formatExprNumber(p0.t)})/${formatExprNumber(dt)})`
      const v0Str = formatExprNumber(p0.value)
      const dvStr = formatExprNumber(dv)

      switch (p0.easing) {
        case 'hold':
          segExpr = v0Str
          break
        case 'ease-in':
          segExpr = `(${v0Str}+(${dvStr})*pow(${u},2))`
          break
        case 'ease-out':
          segExpr = `(${v0Str}+(${dvStr})*(${u}*(2-${u})))`
          break
        case 'ease-in-out':
          segExpr = `(${v0Str}+(${dvStr})*if(lt(${u},0.5),2*pow(${u},2),-1+(4-2*${u})*${u}))`
          break
        case 'linear':
        default:
          segExpr = `(${v0Str}+(${dvStr})*${u})`
          break
      }
    }

    if (i === 0) {
      expr = `if(lte(${timeVar},${formatExprNumber(p0.t)}),${formatExprNumber(p0.value)},if(lt(${timeVar},${formatExprNumber(p1.t)}),${segExpr},${expr}))`
    } else {
      expr = `if(lt(${timeVar},${formatExprNumber(p1.t)}),${segExpr},${expr})`
    }
  }

  return expr
}

/**
 * Detect audio fade-in and fade-out durations (in seconds) from the clip's 'volume' keyframe track.
 */
export function getAudioFadeDurations(clip: TimelineClip): { fadeIn: number; fadeOut: number } {
  const track = getKeyframeTrack(clip, 'volume')
  if (!track || !track.points || track.points.length < 2) {
    return { fadeIn: 0, fadeOut: 0 }
  }

  const sorted = [...track.points].sort((a, b) => a.t - b.t)
  let fadeIn = 0
  let fadeOut = 0

  // Check fade in: point near t = 0 with value = 0 and subsequent point with value > 0
  if (sorted[0].t <= 0.05 && sorted[0].value <= 0.001) {
    if (sorted[1] && sorted[1].value > 0.001 && sorted[1].t <= clip.duration) {
      fadeIn = sorted[1].t
    }
  }

  // Check fade out: last point near t = duration with value = 0 and preceding point with value > 0
  const last = sorted[sorted.length - 1]
  if (last.t >= clip.duration - 0.05 && last.value <= 0.001) {
    const prev = sorted[sorted.length - 2]
    if (prev && prev.value > 0.001 && prev.t >= 0) {
      fadeOut = clip.duration - prev.t
    }
  }

  return { fadeIn, fadeOut }
}

/**
 * Apply or update audio fade in/out durations on the clip by generating or adjusting
 * keyframe points on the 'volume' track.
 */
export function applyAudioFadeKeyframes(
  clip: TimelineClip,
  fadeIn?: number,
  fadeOut?: number,
): TimelineClip {
  const currentFades = getAudioFadeDurations(clip)
  const newFadeIn = fadeIn !== undefined ? Math.max(0, Math.min(clip.duration, fadeIn)) : currentFades.fadeIn
  const newFadeOut = fadeOut !== undefined ? Math.max(0, Math.min(clip.duration - newFadeIn, fadeOut)) : currentFades.fadeOut

  const track = getKeyframeTrack(clip, 'volume')
  const baseVolume = clip.volume ?? 1
  const existingPoints = track ? [...track.points].sort((a, b) => a.t - b.t) : []

  // Filter out the old fade boundary points
  const interiorPoints = existingPoints.filter(p => {
    if (currentFades.fadeIn > 0 && p.t <= 0.05) return false
    if (currentFades.fadeIn > 0 && Math.abs(p.t - currentFades.fadeIn) <= 0.05) return false
    if (currentFades.fadeOut > 0 && p.t >= clip.duration - 0.05) return false
    if (currentFades.fadeOut > 0 && Math.abs(p.t - (clip.duration - currentFades.fadeOut)) <= 0.05) return false
    return true
  })

  const newPoints: KeyframePoint[] = [...interiorPoints]

  if (newFadeIn > 0.01) {
    newPoints.push({ t: 0, value: 0, easing: 'linear' })
    newPoints.push({ t: newFadeIn, value: baseVolume, easing: 'linear' })
  }

  if (newFadeOut > 0.01) {
    const fadeOutStartT = clip.duration - newFadeOut
    if (Math.abs(fadeOutStartT - newFadeIn) > 0.02) {
      newPoints.push({ t: fadeOutStartT, value: baseVolume, easing: 'linear' })
    }
    newPoints.push({ t: clip.duration, value: 0, easing: 'linear' })
  }

  newPoints.sort((a, b) => a.t - b.t)
  const deduped: KeyframePoint[] = []
  for (const p of newPoints) {
    const last = deduped[deduped.length - 1]
    if (last && Math.abs(last.t - p.t) <= 0.02) {
      deduped[deduped.length - 1] = p
    } else {
      deduped.push(p)
    }
  }

  const currentKeyframes = clip.keyframes ? [...clip.keyframes] : []
  const trackIdx = currentKeyframes.findIndex(k => k.property === 'volume')

  if (deduped.length === 0) {
    const filtered = currentKeyframes.filter(k => k.property !== 'volume')
    return {
      ...clip,
      keyframes: filtered.length > 0 ? filtered : undefined,
    }
  }

  const updatedTrack: KeyframeTrack = {
    property: 'volume',
    points: deduped,
  }

  if (trackIdx >= 0) {
    currentKeyframes[trackIdx] = updatedTrack
  } else {
    currentKeyframes.push(updatedTrack)
  }

  return {
    ...clip,
    keyframes: currentKeyframes,
  }
}

// ── Speed Ramp & Time Mapping Integration ───────────────────────────

/**
 * Integrate speed over a single interval [t0, t1] where speed varies from v0 to v1 with easing.
 */
export function integrateSpeedSegment(
  t0: number,
  t1: number,
  v0: number,
  v1: number,
  easing: KeyframeEasing = 'linear',
): number {
  const dt = t1 - t0
  if (dt <= 1e-6) return 0
  const dv = v1 - v0

  switch (easing) {
    case 'hold':
      return v0 * dt
    case 'linear':
      // Integral of v0 + dv * u from u=0 to 1 with du = dt is dt * (v0 + dv / 2)
      return dt * (v0 + dv * 0.5)
    case 'ease-in':
      // Integral of v0 + dv * u^2 from u=0 to 1 is dt * (v0 + dv / 3)
      return dt * (v0 + dv / 3)
    case 'ease-out':
      // Integral of v0 + dv * u * (2 - u) = dt * (v0 + dv * (1 - 1/3)) = dt * (v0 + dv * 2/3)
      return dt * (v0 + dv * (2 / 3))
    case 'ease-in-out': {
      // Piecewise:
      // u in [0, 0.5]: 2 * u^2 -> int = 2 * (0.5^3)/3 = 2 * (1/8)/3 = 1/12
      // u in [0.5, 1]: -1 + 4u - 2u^2 -> int = [-u + 2u^2 - (2/3)u^3]_{0.5}^1 = 5/12
      // total integral of eased u over [0, 1] is 1/12 + 5/12 = 6/12 = 0.5
      // By symmetry, the integral is exactly dt * (v0 + dv * 0.5)
      return dt * (v0 + dv * 0.5)
    }
    default:
      return dt * (v0 + dv * 0.5)
  }
}

/**
 * Compute the elapsed media duration (in seconds) that has passed when playback reaches
 * `timeInClip` on the timeline, by integrating the clip's speed keyframe curve.
 *
 * M(t) = \int_0^t v(\tau) d\tau
 *
 * @param clip TimelineClip to evaluate
 * @param timeInClip Time in seconds relative to the start of the clip (0 <= timeInClip <= clip.duration)
 */
export function computeMediaTimeFromTimelineTime(clip: TimelineClip, timeInClip: number): number {
  const clampedT = Math.max(0, Math.min(clip.duration, timeInClip))
  const track = getKeyframeTrack(clip, 'speed')

  // Case 1: No speed keyframes -> constant speed
  if (!track || !track.points || track.points.length === 0) {
    const constSpeed = typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
    return clampedT * constSpeed
  }

  const points = [...track.points].sort((a, b) => a.t - b.t)
  if (points.length === 1) {
    return clampedT * points[0].value
  }

  let totalMedia = 0
  let currentT = 0

  // 1. If playback starts before the first keyframe, speed is clamped to points[0].value
  const firstPt = points[0]
  if (firstPt.t > 0) {
    const tSpan = Math.min(clampedT, firstPt.t)
    totalMedia += tSpan * firstPt.value
    currentT = tSpan
    if (currentT >= clampedT) return totalMedia
  }

  // 2. Integrate segments between keyframe points
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]

    if (clampedT <= p0.t) {
      break
    }

    const segEnd = Math.min(clampedT, p1.t)
    const segStart = Math.max(currentT, p0.t)

    if (segEnd > segStart) {
      // If evaluating within the segment, calculate fractional endpoint value
      const vStart = interpolatePoints(p0, p1, segStart)
      const vEnd = interpolatePoints(p0, p1, segEnd)
      totalMedia += integrateSpeedSegment(segStart, segEnd, vStart, vEnd, p0.easing)
      currentT = segEnd
    }

    if (currentT >= clampedT) break
  }

  // 3. If playback extends past the last keyframe, speed is clamped to points[last].value
  const lastPt = points[points.length - 1]
  if (clampedT > lastPt.t) {
    const segStart = Math.max(currentT, lastPt.t)
    totalMedia += (clampedT - segStart) * lastPt.value
  }

  return totalMedia
}

/**
 * Compute the total source media duration consumed by this clip across its entire timeline duration.
 * For constant speed: clip.duration * clip.speed.
 * For speed ramp: M(clip.duration).
 */
export function computeClipTotalMediaDuration(clip: TimelineClip): number {
  return computeMediaTimeFromTimelineTime(clip, clip.duration)
}

/**
 * Build an FFmpeg `setpts` expression for speed ramp that maps media presentation timestamps
 * to timeline presentation timestamps matching `computeMediaTimeFromTimelineTime`.
 *
 * For a constant speed `s`: `PTS / s`
 * For speed keyframes: converts PTS (media seconds / TB) to output seconds.
 * Since FFmpeg `setpts` evaluates `PTS` per frame, we build a piecewise approximation
 * where each segment `[M_i, M_{i+1}]` is mapped to `[T_i, T_{i+1}]`.
 */
export function buildSpeedRampSetptsExpression(
  clip: TimelineClip,
): string {
  const track = getKeyframeTrack(clip, 'speed')
  const baseSpeed = typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1

  if (!track || !track.points || track.points.length === 0) {
    return baseSpeed !== 1 ? `PTS/${baseSpeed.toFixed(6)}` : 'PTS'
  }

  const points = [...track.points].sort((a, b) => a.t - b.t)
  if (points.length === 1) {
    const s = points[0].value > 0 ? points[0].value : 1
    return s !== 1 ? `PTS/${s.toFixed(6)}` : 'PTS'
  }

  // Pre-calculate cumulative media times at each keyframe point
  const cumulativeMediaTimes: number[] = []
  for (let i = 0; i < points.length; i++) {
    cumulativeMediaTimes.push(computeMediaTimeFromTimelineTime(clip, points[i].t))
  }

  // We evaluate T (media timestamp in seconds = T = (PTS*TB))
  // and map it to timeline seconds t(T).
  // Then the output PTS is t(T) / TB.
  // Reverse iteration to construct nested if(lte(T, M_i), ...)
  const n = points.length
  const lastM = cumulativeMediaTimes[n - 1]
  const lastT = points[n - 1].t
  const lastSpeed = points[n - 1].value > 0 ? points[n - 1].value : 1

  // Fallback for T >= lastM: lastT + (T - lastM) / lastSpeed
  let currentExpr = `(${formatExprNumber(lastT)}+(T-${formatExprNumber(lastM)})/${formatExprNumber(lastSpeed)})`

  for (let i = n - 2; i >= 0; i--) {
    const t0 = points[i].t
    const t1 = points[i + 1].t
    const m0 = cumulativeMediaTimes[i]
    const m1 = cumulativeMediaTimes[i + 1]
    const dm = m1 - m0
    const dt = t1 - t0

    let segExpr: string
    if (dm <= 1e-6 || dt <= 1e-6) {
      segExpr = formatExprNumber(t0)
    } else {
      // Linear mapping of media time interval [m0, m1] to timeline interval [t0, t1]
      const avgSpeed = dm / dt
      segExpr = `(${formatExprNumber(t0)}+(T-${formatExprNumber(m0)})/${formatExprNumber(avgSpeed)})`
    }

    currentExpr = `if(lt(T,${formatExprNumber(m1)}),${segExpr},${currentExpr})`
  }

  // Handle head: if first keyframe is at t > 0
  const firstM = cumulativeMediaTimes[0]
  const firstT = points[0].t
  const firstSpeed = points[0].value > 0 ? points[0].value : 1
  if (firstT > 0 || firstM > 0) {
    const headExpr = `(T/${formatExprNumber(firstSpeed)})`
    currentExpr = `if(lt(T,${formatExprNumber(firstM)}),${headExpr},${currentExpr})`
  }

  // Output setpts expression in seconds divided by TB
  return `(${currentExpr})/TB`
}

