import type {
  KeyframeProperty,
  KeyframeEasing,
  KeyframePoint,
  KeyframeTrack,
  TimelineClip,
} from './project-model'
import { DEFAULT_CLIP_TRANSFORM } from './project-model'
import { clipSpeedAtTime } from './speed-curve'

/**
 * Result of sampling clip properties at a specific point in time.
 * Note: timeInClip is measured in SECONDS relative to the clip start.
 */
export interface SampledClipProperties {
  scale: number
  scaleX?: number
  scaleY?: number
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
  const scaleX = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.scaleX'),
    timeInClip,
    tf.scaleX ?? scale,
  )
  const scaleY = sampleKeyframeTrack(
    getKeyframeTrack(clip, 'transform.scaleY'),
    timeInClip,
    tf.scaleY ?? scale,
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
  const speed = clipSpeedAtTime(clip, timeInClip)
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
    scaleX,
    scaleY,
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

