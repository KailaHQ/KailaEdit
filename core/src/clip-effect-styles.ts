import type { TimelineClip, Track, TransitionType, ClipMask, ClipEffect } from './project-model'
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_COLOR_CORRECTION } from './project-model'
import { cssMixBlendModeFor } from './blend-modes'
import { sampleClipAt, hasKeyframesForProperty } from './keyframes'

/**
 * How far a clip's edges may miss an adjustment layer's and still count as
 * covered by it, in seconds.
 */
export const ADJUSTMENT_COVERAGE_SLACK = 0.05

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
 * clip by `clip.filter` alone. So anything sent there to render, the export and the
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
   * Leave the fade-to-black / fade-to-white ramp out of the element's opacity.
   *
   * The monitor draws those fades as a flat colour laid OVER the picture, at one minus the
   * ramp. Fading the picture itself as well applied the ramp twice: the picture lost
   * brightness as the square of the ramp, so a fade that the export makes linear dwelt in
   * the light and then fell off a cliff. Pass true for the element that has that overlay.
   */
  fadeToColourAsOverlay?: boolean
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
    if (tIn && tIn.duration > 0 && timeInClip < tIn.duration && !options.fadeToColourAsOverlay) {
      if (tIn.type === 'fade-to-black' || tIn.type === 'fade-to-white') {
        opacity = Math.min(opacity, timeInClip / tIn.duration)
      }
    }
    if (tOut && tOut.duration > 0 && !options.fadeToColourAsOverlay) {
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
