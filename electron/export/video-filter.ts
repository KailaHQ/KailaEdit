import type { TimelineBackground, ClipMask, ChromaKey } from '../../core/src/project-model'
import type { ExportClip } from './timeline'
import { autoMatteBakeOffset, autoMattePlaybackRate } from '../../core/src/auto-matte'
import { matteAlphaBand, matteFeatherSigma, hasMatteClean, hasMatteFeather } from '../../core/src/matte-edge'
import { buildClipEffectChain } from './effects-filter'
import { buildLutFilter } from './lut-filter'
import { buildTransitionRuns, runTimeline, xfadeOffsets, type ExportTransition } from './transition-runs'
import { getTransitionDefinition } from '../../core/src/transitions'
import {
  getKeyframeTrack,
  hasKeyframesForProperty,
  buildKeyframeFfmpegExpression,
  buildSpeedRampSetptsExpression,
  computeClipTotalMediaDuration,
} from '../../core/src/keyframes'
import { ffmpegBlendModeFor } from '../../core/src/blend-modes'

/**
 * The xfade name for a transition id, falling back to a plain cross-fade.
 *
 * An unknown id reaching here means the catalogue and the project disagree —
 * an older file, or a newer one. Rendering a dissolve is wrong but watchable;
 * failing the export over a name is not.
 */
function xfadeNameFor(type: string): string {
  return getTransitionDefinition(type)?.xfade ?? 'fade'
}

export interface ExportSubtitle {
  text: string; startTime: number; endTime: number;
  style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean };
}

export const SEEK_HANDLE_SEC = 2

export function computePreInputSeek(trimStart: number, handleSec = SEEK_HANDLE_SEC): {
  seekSec: number
  seekArg: string
  adjustedTrimStart: number
} {
  const seekSec = Math.max(0, trimStart - handleSec)
  const seekArg = Number(seekSec.toFixed(6)).toString()
  const adjustedTrimStart = trimStart - seekSec
  return { seekSec, seekArg, adjustedTrimStart }
}

/** Escape a string for use inside an ffmpeg drawtext `text=` value. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n')
}

function hexToFfmpegColor(color: string, fallback = '0xFFFFFF'): string {
  const hex = color.replace('#', '')
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) return fallback
  return `0x${hex.slice(0, 6)}`
}

/**
 * Colour correction sliders are all -100..100 around a neutral 0. Map them onto
 * ffmpeg's `eq` (and a colour-balance pass for temperature/tint), skipping the
 * filter entirely when everything is neutral so untouched clips stay untouched.
 */
function buildColorCorrectionChain(cc: ExportClip['colorCorrection']): string {
  if (!cc) return ''
  const parts: string[] = []

  const brightness = (cc.brightness ?? 0) / 100 * 0.5
  const contrast = 1 + (cc.contrast ?? 0) / 100
  const saturation = 1 + (cc.saturation ?? 0) / 100
  // Exposure behaves like a gamma lift; keep it away from 0 to avoid a black frame.
  const gamma = Math.max(0.1, 1 - (cc.exposure ?? 0) / 200)

  const eqParams: string[] = []
  if (Math.abs(brightness) > 1e-6) eqParams.push(`brightness=${brightness.toFixed(4)}`)
  if (Math.abs(contrast - 1) > 1e-6) eqParams.push(`contrast=${contrast.toFixed(4)}`)
  if (Math.abs(saturation - 1) > 1e-6) eqParams.push(`saturation=${saturation.toFixed(4)}`)
  if (Math.abs(gamma - 1) > 1e-6) eqParams.push(`gamma=${gamma.toFixed(4)}`)
  if (eqParams.length > 0) parts.push(`eq=${eqParams.join(':')}`)

  // Temperature warms/cools by trading red against blue; tint trades green against magenta.
  const temperature = (cc.temperature ?? 0) / 100
  const tint = (cc.tint ?? 0) / 100
  if (Math.abs(temperature) > 1e-6 || Math.abs(tint) > 1e-6) {
    const rs = (temperature * 0.3).toFixed(4)
    const bs = (-temperature * 0.3).toFixed(4)
    const gs = (tint * 0.3).toFixed(4)
    parts.push(`colorbalance=rm=${rs}:gm=${gs}:bm=${bs}`)
  }

  // Highlights/shadows: lift or crush the ends of the curve.
  const highlights = (cc.highlights ?? 0) / 100
  const shadows = (cc.shadows ?? 0) / 100
  if (Math.abs(highlights) > 1e-6 || Math.abs(shadows) > 1e-6) {
    const low = Math.max(0, Math.min(0.4, 0.25 + shadows * 0.25)).toFixed(3)
    const high = Math.max(0.6, Math.min(1, 0.75 + highlights * 0.25)).toFixed(3)
    parts.push(`curves=all='0/0 0.25/${low} 0.75/${high} 1/1'`)
  }

  return parts.length > 0 ? `,${parts.join(',')}` : ''
}

/**
 * Alpha fades that implement transitionIn/transitionOut. `dissolve` fades the
 * clip's own alpha so whatever sits underneath shows through; the fade-to-colour
 * variants fade against an opaque colour instead.
 */
function buildTransitionChain(clip: ExportClip, visibleDuration: number): string {
  const parts: string[] = []

  const addFade = (
    transition: { type: string; duration: number } | undefined,
    direction: 'in' | 'out',
  ) => {
    if (!transition || transition.type === 'none') return
    const d = Math.min(Math.max(transition.duration, 0), visibleDuration / 2)
    if (d <= 0.001) return
    const st = direction === 'in' ? 0 : Math.max(0, visibleDuration - d)

    if (transition.type === 'fade-to-black' || transition.type === 'fade-to-white') {
      const color = transition.type === 'fade-to-black' ? 'black' : 'white'
      parts.push(`fade=t=${direction}:st=${st.toFixed(4)}:d=${d.toFixed(4)}:color=${color}`)
      return
    }

    // dissolve and the wipes all degrade to an alpha fade; a true directional
    // wipe needs a second stream, which this per-clip chain does not have.
    parts.push(`fade=t=${direction}:st=${st.toFixed(4)}:d=${d.toFixed(4)}:alpha=1`)
  }

  addFade(clip.transitionIn, 'in')
  addFade(clip.transitionOut, 'out')

  return parts.length > 0 ? `,${parts.join(',')}` : ''
}

/**
 * Build FFmpeg geq filter for clip mask (rectangle, ellipse, linear) with rotation, feather, and invert.
 * Applies directly onto the alpha channel (a='...') in yuva420p format.
 */
export function buildMaskChain(mask: ClipMask | undefined): string {
  if (!mask || mask.enabled === false) return ''

  const { shape, x, y, width, height, rotation = 0, feather = 0, invert = false } = mask
  const rotRad = (rotation * Math.PI) / 180
  const cosRot = Math.cos(rotRad).toFixed(6)
  const sinRot = Math.sin(rotRad).toFixed(6)

  // Mask center in normalized 0..1 coordinates
  const cx = (x / 100).toFixed(6)
  const cy = (y / 100).toFixed(6)

  // Half-extents in normalized 0..1 coordinates
  const hw = Math.max(0.001, (width / 200)).toFixed(6)
  const hh = Math.max(0.001, (height / 200)).toFixed(6)

  // Feather softness in normalized units (feather / 100 * 0.25)
  const f = Math.max(0.0001, (feather / 100) * 0.25).toFixed(6)

  // Centered & rotated coordinates relative to mask center:
  // dx = (X/W - cx), dy = (Y/H - cy)
  // rx = dx * cos - dy * sin
  // ry = dx * sin + dy * cos
  const dxExpr = `(X/W-${cx})`
  const dyExpr = `(Y/H-${cy})`
  const rxExpr = `(${dxExpr}*${cosRot}-${dyExpr}*${sinRot})`
  const ryExpr = `(${dxExpr}*${sinRot}+${dyExpr}*${cosRot})`

  let alphaExpr = ''

  if (shape === 'rectangle') {
    if (feather > 0) {
      // Smooth distance from box edges
      const distX = `(${hw}-abs(${rxExpr}))`
      const distY = `(${hh}-abs(${ryExpr}))`
      const dMin = `min(${distX},${distY})`
      alphaExpr = `255*clip(${dMin}/${f},0,1)`
    } else {
      alphaExpr = `if(lte(abs(${rxExpr}),${hw})*lte(abs(${ryExpr}),${hh}),255,0)`
    }
  } else if (shape === 'ellipse') {
    if (feather > 0) {
      // Normalized radial distance: 1 - sqrt((rx/hw)^2 + (ry/hh)^2)
      const normDist = `(1-hypot(${rxExpr}/${hw},${ryExpr}/${hh}))`
      // Scale by half-width for feather ramp
      alphaExpr = `255*clip((${normDist}*${hw})/${f},0,1)`
    } else {
      alphaExpr = `if(lte(hypot(${rxExpr}/${hw},${ryExpr}/${hh}),1),255,0)`
    }
  } else if (shape === 'linear') {
    if (feather > 0) {
      // Linear half-plane: ry >= 0 is inside (white)
      alphaExpr = `255*clip((${ryExpr})/${f}+0.5,0,1)`
    } else {
      alphaExpr = `if(gte(${ryExpr},0),255,0)`
    }
  }

  if (!alphaExpr) return ''

  // Combine with existing alpha: alpha = alpha * (mask_alpha / 255)
  // If inverted: mask_alpha = 255 - mask_alpha
  const finalAlpha = invert
    ? `alpha(X,Y)*(1-(${alphaExpr})/255)`
    : `alpha(X,Y)*((${alphaExpr})/255)`

  return `,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${finalAlpha}'`
}

/**
 * Build FFmpeg filter chain for chroma keying (green/blue screen removal).
 * Uses colorkey filter on RGB/yuva420p video, followed by optional despill filter.
 */
export function buildChromaKeyChain(chromaKey: ChromaKey | undefined): string {
  if (!chromaKey || chromaKey.enabled === false) return ''

  const { color, similarity, smoothness, spill, featherEdge = 0, cleanEdge = 0 } = chromaKey
  const sim = Math.max(0.0001, Math.min(1.0, similarity / 100)).toFixed(4)
  const blend = Math.max(0, Math.min(1.0, smoothness / 100)).toFixed(4)
  const colorHex = color.startsWith('#') ? color : `#${color}`

  let chain = `,format=rgba,colorkey=color=${colorHex}:similarity=${sim}:blend=${blend}`

  if (spill > 0) {
    const cleanHex = color.replace('#', '')
    const r = parseInt(cleanHex.substring(0, 2) || '0', 16)
    const g = parseInt(cleanHex.substring(2, 4) || '0', 16)
    const b = parseInt(cleanHex.substring(4, 6) || '0', 16)
    const type = b > g && b > r ? 'blue' : 'green'
    const mix = Math.max(0, Math.min(1.0, spill / 100)).toFixed(2)
    chain += `,despill=type=${type}:mix=${mix}`
  }

  if (cleanEdge > 0) {
    const n = Math.max(1, Math.round(cleanEdge / 25))
    for (let i = 0; i < n; i++) {
      chain += ',erosion=threshold0=0:threshold1=0:threshold2=0'
    }
  }

  if (featherEdge > 0) {
    const sigma = Math.max(0.1, featherEdge / 10).toFixed(2)
    chain += `,gblur=sigma=${sigma}:planes=8`
  }

  chain += ',format=yuva420p'

  return chain
}

/**
 * Trim percentages off each side and pad the trimmed edges back with transparency,
 * so cropping hides content without zooming what remains. Runs after the fit-scale
 * and mirrors the preview's `clip-path: inset(...)`.
 */
function buildCropChain(transform: ExportClip['transform']): string {
  if (!transform) return ''
  const left = Math.max(0, Math.min(0.9, (transform.cropLeft ?? 0) / 100))
  const right = Math.max(0, Math.min(0.9, (transform.cropRight ?? 0) / 100))
  const top = Math.max(0, Math.min(0.9, (transform.cropTop ?? 0) / 100))
  const bottom = Math.max(0, Math.min(0.9, (transform.cropBottom ?? 0) / 100))
  if (left + right + top + bottom < 1e-6) return ''

  const w = Math.max(0.05, 1 - left - right)
  const h = Math.max(0.05, 1 - top - bottom)
  const crop = `crop=iw*${w.toFixed(4)}:ih*${h.toFixed(4)}:iw*${left.toFixed(4)}:ih*${top.toFixed(4)}`
  // `iw`/`ih` here are the cropped dimensions, so dividing by the kept fraction
  // recovers the pre-crop size.
  const pad = `pad=iw/${w.toFixed(4)}:ih/${h.toFixed(4)}:iw*${(left / w).toFixed(4)}:ih*${(top / h).toFixed(4)}:color=0x00000000`
  return `,${crop},${pad}`
}

/**
 * Build the ffmpeg filter_complex script and input arguments for the video pass.
 *
 * Every visual clip becomes its own input, is transformed independently, then is
 * composited onto a full-length base canvas with `overlay` in track order, so
 * higher tracks sit on top of lower ones instead of replacing them. Pure string
 * building — zero I/O.
 */
export function buildVideoFilterGraph(
  clips: ExportClip[],
  opts: {
    width: number; height: number; fps: number; totalDuration: number;
    background?: TimelineBackground;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: ExportSubtitle[];
    transitions?: ExportTransition[];
  },
): { inputs: string[]; filterScript: string } {
  const { width, height, fps, totalDuration, background, letterbox, subtitles } = opts
  const inputs: string[] = []
  const filterParts: string[] = []

  // Lowest track first so higher tracks composite on top.
  const visualClips = clips
    .filter(clip => clip.type === 'video' || clip.type === 'image')
    .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)

  const textClips = clips
    .filter(clip => clip.type === 'text' && clip.textStyle)
    .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)

  let inputIdx = 0
  let accLabel = 'base'

  // Base canvas spanning the whole timeline.
  if (background?.type === 'image' && background.imagePath) {
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', totalDuration.toFixed(6), '-i', background.imagePath)
    filterParts.push(`[${inputIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuva420p,setsar=1[base]`)
    inputIdx++
  } else {
    const bgHex = (background?.type === 'color' && background.color) ? background.color : '#000000'
    const bgColor = hexToFfmpegColor(bgHex, '0x000000')
    inputs.push('-f', 'lavfi', '-i', `color=c=${bgColor}:s=${width}x${height}:r=${fps}:d=${totalDuration.toFixed(6)}`)
    filterParts.push(`[${inputIdx}:v]format=yuva420p,setsar=1[base]`)
    inputIdx++
  }

  // Clips joined by a transition have to become one stream before they can be
  // composited, because xfade consumes two and returns one. Everything else is
  // a run of one and takes the same path it always did.
  const runs = buildTransitionRuns(visualClips, opts.transitions ?? [])
  let runIdx = 0

  for (const run of runs) {
    const clipLabels: string[] = []

    for (const clip of run.clips) {
      const transform = clip.transform
      const hasScaleKeyframes = hasKeyframesForProperty(clip as any, 'transform.scale')

      let chain: string
      if (clip.type === 'image') {
        const isGif = clip.path.toLowerCase().endsWith('.gif')
        if (isGif) {
          inputs.push('-ignore_loop', '0', '-t', clip.duration.toFixed(6), '-i', clip.path)
        } else {
          inputs.push('-loop', '1', '-framerate', String(fps), '-t', clip.duration.toFixed(6), '-i', clip.path)
        }
        // `null` is a no-op that exists only to anchor the chain. Every filter
        // below is appended with a leading comma, so a bare `[N:v]` would produce
        // `[N:v],scale=...` — and ffmpeg reads the empty piece before that comma
        // as a filter name, failing the whole export with `No such filter: ''`.
        chain = `[${inputIdx}:v]null`
      } else {
        const { seekArg, adjustedTrimStart } = computePreInputSeek(clip.trimStart)
        const hasSpeedKeyframes = hasKeyframesForProperty(clip as any, 'speed')

        if (hasSpeedKeyframes) {
          const totalMedia = computeClipTotalMediaDuration(clip as any)
          const adjustedTrimEnd = adjustedTrimStart + totalMedia
          inputs.push('-ss', seekArg, '-i', clip.path)
          const setptsExpr = buildSpeedRampSetptsExpression(clip as any)
          chain = `[${inputIdx}:v]trim=start=${adjustedTrimStart.toFixed(6)}:end=${adjustedTrimEnd.toFixed(6)},setpts=PTS-STARTPTS,setpts='${setptsExpr}'`
          if (clip.reversed) chain += ',reverse'
        } else {
          const speed = typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1
          const adjustedTrimEnd = adjustedTrimStart + clip.duration * speed
          inputs.push('-ss', seekArg, '-i', clip.path)
          chain = `[${inputIdx}:v]trim=start=${adjustedTrimStart.toFixed(6)}:end=${adjustedTrimEnd.toFixed(6)},setpts=PTS-STARTPTS`
          if (speed !== 1) chain += `,setpts=PTS/${speed.toFixed(6)}`
          if (clip.reversed) chain += ',reverse'
        }
      }
      inputIdx++

      if (hasScaleKeyframes) {
        const scaleTrack = getKeyframeTrack(clip as any, 'transform.scale')
        const scalePercentExpr = buildKeyframeFfmpegExpression(scaleTrack, transform?.scale ?? 100, 't')
        const dynamicScaleExpr = `max(0.01,(${scalePercentExpr})/100)`
        chain += `,scale=w='max(2,round(${width}*${dynamicScaleExpr}))':h='max(2,round(${height}*${dynamicScaleExpr}))':force_original_aspect_ratio=decrease:eval=frame,setsar=1`
      } else {
        const scaleX = Math.max(1, (transform as any)?.scaleX ?? transform?.scale ?? 100) / 100
        const scaleY = Math.max(1, (transform as any)?.scaleY ?? transform?.scale ?? 100) / 100
        const boxW = Math.max(2, Math.round(width * scaleX))
        const boxH = Math.max(2, Math.round(height * scaleY))
        if ((transform as any)?.scaleX !== undefined || (transform as any)?.scaleY !== undefined) {
          chain += `,scale=${boxW}:${boxH},setsar=1`
        } else {
          chain += `,scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,setsar=1`
        }
      }

      if (clip.flipH) chain += ',hflip'
      if (clip.flipV) chain += ',vflip'
      chain += buildColorCorrectionChain(clip.colorCorrection)
      chain += buildLutFilter(clip.filter)
      chain += buildClipEffectChain(clip.effects)

      const hasAutoMatte = Boolean(clip.autoMatte?.enabled && clip.autoMatte.bake?.path)
      /**
       * Where this clip starts inside the baked matte.
       *
       * A matte no longer has to begin on the clip's first frame: one bake serves every
       * trim that falls inside the range it covers. 0 for a bake that does start there,
       * which is every bake made before ranges were recorded.
       *
       * The stroke input below is seeked by this SAME value. A stroke frame is drawn from
       * the matte frame at the same instant, so the two share one clock; keeping it a
       * single constant is what stops them drifting apart.
       */
      const matteOffset = autoMatteBakeOffset(clip.autoMatte?.bake, clip.trimStart ?? 0, clip.speed ?? 1)
      const matteRate = autoMattePlaybackRate(clip.autoMatte?.bake, clip.speed ?? 1)
      // Everything past this point needs an alpha channel.
      // If chroma key is active without autoMatte, use format=rgba to preserve full 4:4:4 chroma before colorkey.
      chain += (clip.chromaKey?.enabled && !hasAutoMatte) ? ',format=rgba' : ',format=yuva420p'
      chain += buildCropChain(transform)

      if (hasAutoMatte && clip.autoMatte?.bake?.path) {
        if (matteOffset > 0.0005) inputs.push('-ss', matteOffset.toFixed(6))
        inputs.push('-i', clip.autoMatte.bake.path)
        const matteInputIdx = inputIdx++

        let matteChain = `[${matteInputIdx}:v]setpts=PTS-STARTPTS`
        if (matteRate !== 1) matteChain += `,setpts=PTS/${matteRate.toFixed(6)}`
        if (hasScaleKeyframes) {
          const scaleTrack = getKeyframeTrack(clip as any, 'transform.scale')
          const scalePercentExpr = buildKeyframeFfmpegExpression(scaleTrack, transform?.scale ?? 100, 't')
          const dynamicScaleExpr = `max(0.01,(${scalePercentExpr})/100)`
          matteChain += `,scale=w='max(2,round(${width}*${dynamicScaleExpr}))':h='max(2,round(${height}*${dynamicScaleExpr}))':force_original_aspect_ratio=decrease:eval=frame,setsar=1`
        } else {
          const scale = Math.max(1, transform?.scale ?? 100) / 100
          const boxW = Math.max(2, Math.round(width * scale))
          const boxH = Math.max(2, Math.round(height * scale))
          matteChain += `,scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,setsar=1`
        }

        if (clip.flipH) matteChain += ',hflip'
        if (clip.flipV) matteChain += ',vflip'
        matteChain += buildCropChain(transform)

        // `cleanEdge` and `featherEdge` are defined in core, shared with the preview
        // shader — see matte-edge.ts for what they used to do to each side separately.
        //
        // Clean was `erosion` repeated N times. Morphological erosion eats whole pixels
        // off the silhouette and takes thin detail (fingers, hair) with them, and it is
        // not something a fragment shader can mirror. It is a remap of alpha now: the
        // same pointwise expression the preview runs, as a lut over the matte's luma,
        // which alphamerge reads.
        if (hasMatteClean(clip.autoMatte.cleanEdge)) {
          const { lo, hi } = matteAlphaBand(clip.autoMatte.cleanEdge)
          const loVal = (lo * 255).toFixed(3)
          const span = Math.max(1e-6, hi - lo) * 255
          matteChain += `,lut=y='clip((val-${loVal})*${(255 / span).toFixed(6)},0,255)'`
        }

        if (hasMatteFeather(clip.autoMatte.featherEdge)) {
          const sigma = matteFeatherSigma(clip.autoMatte.featherEdge).toFixed(2)
          matteChain += `,gblur=sigma=${sigma}`
        }

        const matteLabel = `m${runIdx}_${clipLabels.length}`
        matteChain += `[${matteLabel}]`
        filterParts.push(matteChain)

        const preMatteLabel = `cpre${runIdx}_${clipLabels.length}`
        chain += `[${preMatteLabel}]`
        filterParts.push(chain)

        const postMatteLabel = `cpost${runIdx}_${clipLabels.length}`
        filterParts.push(`[${preMatteLabel}][${matteLabel}]alphamerge[${postMatteLabel}]`)
        chain = `[${postMatteLabel}]null`
      }

      chain += buildChromaKeyChain(clip.chromaKey)
      chain += buildMaskChain(clip.mask)

      const hasStroke = Boolean(
        clip.stroke?.enabled &&
        clip.stroke.style !== 'none' &&
        clip.strokeBakePath
      )
      if (hasStroke && clip.strokeBakePath) {
        // Seeked exactly like the matte. The stroke is now baked across the WHOLE matte
        // rather than this clip's window of it — one bake per clip instead of one per
        // render-cache segment — so it starts where the matte starts, not where the clip
        // does. Leaving this unseeked would put the outline `matteOffset` seconds ahead of
        // the subject on any trimmed clip.
        if (matteOffset > 0.0005) inputs.push('-ss', matteOffset.toFixed(6))
        inputs.push('-i', clip.strokeBakePath)
        const strokeInputIdx = inputIdx++

        let strokeChain = `[${strokeInputIdx}:v]setpts=PTS-STARTPTS`
        if (matteRate !== 1) strokeChain += `,setpts=PTS/${matteRate.toFixed(6)}`
        if (hasScaleKeyframes) {
          const scaleTrack = getKeyframeTrack(clip as any, 'transform.scale')
          const scalePercentExpr = buildKeyframeFfmpegExpression(scaleTrack, transform?.scale ?? 100, 't')
          const dynamicScaleExpr = `max(0.01,(${scalePercentExpr})/100)`
          strokeChain += `,scale=w='max(2,round(${width}*${dynamicScaleExpr}))':h='max(2,round(${height}*${dynamicScaleExpr}))':force_original_aspect_ratio=decrease:eval=frame,setsar=1`
        } else {
          const scale = Math.max(1, transform?.scale ?? 100) / 100
          const boxW = Math.max(2, Math.round(width * scale))
          const boxH = Math.max(2, Math.round(height * scale))
          strokeChain += `,scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,setsar=1`
        }

        if (clip.flipH) strokeChain += ',hflip'
        if (clip.flipV) strokeChain += ',vflip'
        strokeChain += buildCropChain(transform)
        strokeChain += ',format=yuva420p'

        const strokeLabel = `strk${runIdx}_${clipLabels.length}`
        strokeChain += `[${strokeLabel}]`
        filterParts.push(strokeChain)

        const preStrokeLabel = `cpre_strk${runIdx}_${clipLabels.length}`
        chain += `[${preStrokeLabel}]`
        filterParts.push(chain)

        const postStrokeLabel = `cpost_strk${runIdx}_${clipLabels.length}`
        filterParts.push(`[${strokeLabel}][${preStrokeLabel}]overlay=shortest=1:format=auto[${postStrokeLabel}]`)
        chain = `[${postStrokeLabel}]null`
      }

      const hasRotKeyframes = hasKeyframesForProperty(clip as any, 'transform.rotation')
      if (hasRotKeyframes) {
        const rotTrack = getKeyframeTrack(clip as any, 'transform.rotation')
        const rotDegExpr = buildKeyframeFfmpegExpression(rotTrack, transform?.rotation ?? 0, 't')
        const rotRadExpr = `((${rotDegExpr})*PI/180)`
        chain += `,rotate=a='${rotRadExpr}':c=none:ow='hypot(in_w,in_h)':oh='hypot(in_w,in_h)'`
      } else {
        const rotation = transform?.rotation ?? 0
        if (Math.abs(rotation) > 1e-6) {
          const radians = (rotation * Math.PI) / 180
          chain += `,rotate=${radians.toFixed(6)}:c=none:ow=rotw(${radians.toFixed(6)}):oh=roth(${radians.toFixed(6)})`
        }
      }

      chain += buildTransitionChain(clip, clip.duration)

      const hasOpacityKeyframes = hasKeyframesForProperty(clip as any, 'opacity')
      if (hasOpacityKeyframes) {
        const opTrack = getKeyframeTrack(clip as any, 'opacity')
        const opExpr = buildKeyframeFfmpegExpression(opTrack, clip.opacity ?? 100, 't')
        const dynamicAlphaExpr = `max(0,min(1,(${opExpr})/100))`
        chain += `,colorchannelmixer=aa='${dynamicAlphaExpr}'`
      } else {
        const opacity = Math.max(0, Math.min(100, clip.opacity ?? 100)) / 100
        if (opacity < 1) chain += `,colorchannelmixer=aa=${opacity.toFixed(4)}`
      }

      const label = `c${runIdx}_${clipLabels.length}`
      chain += `[${label}]`
      filterParts.push(chain)
      clipLabels.push(label)
    }

    const { startTime } = runTimeline(run)

    let runLabel: string
    if (run.transitions.length === 0) {
      runLabel = clipLabels[0]
    } else {
      // xfade needs both sides the same size, and a clip is only as big as its
      // own scale allows — so each one is laid onto a full-frame transparent
      // canvas at its own position first. That also keeps every clip's own
      // placement instead of making the whole run share the first one's.
      const framed: string[] = []
      for (let k = 0; k < run.clips.length; k++) {
        const clip = run.clips[k]
        const hasPosX = hasKeyframesForProperty(clip as any, 'transform.positionX')
        const hasPosY = hasKeyframesForProperty(clip as any, 'transform.positionY')

        inputs.push('-f', 'lavfi', '-i', `color=c=black@0.0:s=${width}x${height}:r=${fps}:d=${clip.duration.toFixed(6)}`)
        const canvasLabel = `f${runIdx}_${k}`
        filterParts.push(`[${inputIdx}:v]format=yuva420p,setsar=1[${canvasLabel}bg]`)
        inputIdx++

        if (hasPosX || hasPosY) {
          const trackX = getKeyframeTrack(clip as any, 'transform.positionX')
          const trackY = getKeyframeTrack(clip as any, 'transform.positionY')
          const exprX = buildKeyframeFfmpegExpression(trackX, clip.transform?.positionX ?? 0, 't')
          const exprY = buildKeyframeFfmpegExpression(trackY, clip.transform?.positionY ?? 0, 't')
          filterParts.push(
            `[${canvasLabel}bg][${clipLabels[k]}]overlay=x='(main_w-overlay_w)/2+(main_w*((${exprX})/100))':y='(main_h-overlay_h)/2+(main_h*((${exprY})/100))':eval=frame:format=auto:eof_action=pass:repeatlast=0[${canvasLabel}]`,
          )
        } else {
          const cdx = ((clip.transform?.positionX ?? 0) / 100).toFixed(6)
          const cdy = ((clip.transform?.positionY ?? 0) / 100).toFixed(6)
          filterParts.push(
            `[${canvasLabel}bg][${clipLabels[k]}]overlay=x=(main_w-overlay_w)/2+(main_w*${cdx}):y=(main_h-overlay_h)/2+(main_h*${cdy}):format=auto:eof_action=pass:repeatlast=0[${canvasLabel}]`,
          )
        }
        framed.push(canvasLabel)
      }

      const offsets = xfadeOffsets(run)
      let folded = framed[0]
      for (let k = 0; k < run.transitions.length; k++) {
        const transition = run.transitions[k]
        const xfadeName = xfadeNameFor(transition.type)
        const nextFold = `x${runIdx}_${k}`
        filterParts.push(
          `[${folded}][${framed[k + 1]}]xfade=transition=${xfadeName}:duration=${transition.duration.toFixed(6)}:offset=${offsets[k].toFixed(6)},format=yuva420p[${nextFold}]`,
        )
        folded = nextFold
      }
      runLabel = folded
    }

    // Delay the run to its timeline position with transparent padding, so the
    // overlay below composites it only during its own window.
    let placedLabel = runLabel
    if (startTime > 0.001) {
      placedLabel = `p${runIdx}`
      filterParts.push(
        `[${runLabel}]tpad=start_duration=${startTime.toFixed(6)}:start_mode=add:color=0x00000000[${placedLabel}]`,
      )
    }

    // A folded run is already frame-sized and positioned; only a lone clip
    // still needs its offset applied here.
    let xExpr: string
    let yExpr: string
    let evalParam = ''

    if (run.transitions.length > 0) {
      xExpr = '0'
      yExpr = '0'
    } else {
      const loneClip = run.clips[0]
      const hasPosX = hasKeyframesForProperty(loneClip as any, 'transform.positionX')
      const hasPosY = hasKeyframesForProperty(loneClip as any, 'transform.positionY')

      if (hasPosX || hasPosY) {
        evalParam = ':eval=frame'
        const clipTimeExpr = startTime > 0.001 ? `(t-${startTime.toFixed(6)})` : 't'
        const trackX = getKeyframeTrack(loneClip as any, 'transform.positionX')
        const trackY = getKeyframeTrack(loneClip as any, 'transform.positionY')
        const exprX = buildKeyframeFfmpegExpression(trackX, loneClip.transform?.positionX ?? 0, clipTimeExpr)
        const exprY = buildKeyframeFfmpegExpression(trackY, loneClip.transform?.positionY ?? 0, clipTimeExpr)
        xExpr = `'(main_w-overlay_w)/2+(main_w*((${exprX})/100))'`
        yExpr = `'(main_h-overlay_h)/2+(main_h*((${exprY})/100))'`
      } else {
        const dx = ((loneClip.transform?.positionX ?? 0) / 100).toFixed(6)
        const dy = ((loneClip.transform?.positionY ?? 0) / 100).toFixed(6)
        xExpr = `(main_w-overlay_w)/2+(main_w*${dx})`
        yExpr = `(main_h-overlay_h)/2+(main_h*${dy})`
      }
    }

    // If background mode is blur, generate a blurred background from the run's primary clip
    // scaled to cover the canvas, and composite it onto accLabel before placing the foreground clip.
    if (background?.type === 'blur') {
      const primaryClip = run.clips[0]
      const blurAmount = typeof background.blur === 'number' ? background.blur : 40
      const sigma = Math.max(1, Math.round(blurAmount * 0.4))
      const blurInputIdx = inputIdx++
      
      let blurChain: string
      if (primaryClip.type === 'image') {
        const isGif = primaryClip.path.toLowerCase().endsWith('.gif')
        if (isGif) {
          inputs.push('-ignore_loop', '0', '-t', primaryClip.duration.toFixed(6), '-i', primaryClip.path)
        } else {
          inputs.push('-loop', '1', '-framerate', String(fps), '-t', primaryClip.duration.toFixed(6), '-i', primaryClip.path)
        }
        blurChain = `[${blurInputIdx}:v]`
      } else {
        const { seekArg, adjustedTrimStart } = computePreInputSeek(primaryClip.trimStart)
        const speed = typeof primaryClip.speed === 'number' && Number.isFinite(primaryClip.speed) && primaryClip.speed > 0 ? primaryClip.speed : 1
        const adjustedTrimEnd = adjustedTrimStart + primaryClip.duration * speed
        inputs.push('-ss', seekArg, '-i', primaryClip.path)
        blurChain = `[${blurInputIdx}:v]trim=start=${adjustedTrimStart.toFixed(6)}:end=${adjustedTrimEnd.toFixed(6)},setpts=PTS-STARTPTS`
        if (speed !== 1) blurChain += `,setpts=PTS/${speed.toFixed(6)}`
        if (primaryClip.reversed) blurChain += ',reverse'
      }

      const blurRawLabel = `b_raw_${runIdx}`
      const blurProcessedLabel = `b_blur_${runIdx}`
      filterParts.push(
        `${blurChain},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=luma_radius=${sigma}:luma_power=2,format=yuva420p,setsar=1[${blurRawLabel}]`,
      )

      let placedBlurLabel = blurRawLabel
      if (startTime > 0.001) {
        placedBlurLabel = `p_blur_${runIdx}`
        filterParts.push(
          `[${blurRawLabel}]tpad=start_duration=${startTime.toFixed(6)}:start_mode=add:color=0x00000000[${placedBlurLabel}]`,
        )
      }

      const bgOvLabel = `bgov${runIdx}`
      filterParts.push(
        `[${accLabel}][${placedBlurLabel}]overlay=x=0:y=0:format=auto:eof_action=pass:repeatlast=0[${bgOvLabel}]`,
      )
      accLabel = bgOvLabel
    }

    const runBlendMode = run.clips[0]?.blendMode
    const hasBlendMode = runBlendMode && runBlendMode !== 'normal'

    if (hasBlendMode) {
      // ffmpeg `blend=all_mode=...` requires both inputs to be identical dimensions.
      // If the run has no transitions, it hasn't been placed on a full-size canvas yet.
      // We overlay it onto a transparent full-size canvas first, then blend it onto accLabel.
      let fullFrameRunLabel = placedLabel
      if (run.transitions.length === 0) {
        const framedLabel = `bf${runIdx}`
        inputs.push('-f', 'lavfi', '-i', `color=c=black@0.0:s=${width}x${height}:r=${fps}:d=${totalDuration.toFixed(6)}`)
        filterParts.push(`[${inputIdx}:v]format=yuva420p,setsar=1[${framedLabel}bg]`)
        inputIdx++
        filterParts.push(
          `[${framedLabel}bg][${placedLabel}]overlay=x=${xExpr}:y=${yExpr}${evalParam}:format=auto:eof_action=pass:repeatlast=0[${framedLabel}]`,
        )
        fullFrameRunLabel = framedLabel
      }

      const ffmpegMode = ffmpegBlendModeFor(runBlendMode)
      const nextLabel = `bl${runIdx}`
      filterParts.push(
        `[${accLabel}][${fullFrameRunLabel}]blend=all_mode='${ffmpegMode}':all_opacity=1,format=yuva420p[${nextLabel}]`,
      )
      accLabel = nextLabel
    } else {
      const nextLabel = `ov${runIdx}`
      filterParts.push(
        `[${accLabel}][${placedLabel}]overlay=x=${xExpr}:y=${yExpr}${evalParam}:format=auto:eof_action=pass:repeatlast=0[${nextLabel}]`,
      )
      accLabel = nextLabel
    }
    runIdx++
  }

  // Normalise the frame rate once over the whole composite, the way an NLE does,
  // so per-clip duration quantisation cannot accumulate.
  filterParts.push(`[${accLabel}]format=yuv420p,fps=${fps}[fpsout]`)
  let lastLabel = 'fpsout'

  // Text overlay clips burn in above the video, below subtitles.
  for (let t = 0; t < textClips.length; t++) {
    const clip = textClips[t]
    const style = clip.textStyle!
    const fontSize = Math.max(1, Math.round(style.fontSize * (height / 1080)))
    const fontColor = hexToFfmpegColor(style.color)
    const alpha = Math.max(0, Math.min(100, style.opacity ?? 100)) / 100

    const clipTimeExpr = `(t-${clip.startTime.toFixed(3)})`
    const hasPosX = hasKeyframesForProperty(clip as any, 'transform.positionX')
    const hasPosY = hasKeyframesForProperty(clip as any, 'transform.positionY')
    const hasScale = hasKeyframesForProperty(clip as any, 'transform.scale')
    const hasOpacity = hasKeyframesForProperty(clip as any, 'opacity')
    const hasTypewriter = hasKeyframesForProperty(clip as any, 'text.progress')

    // positionX/positionY are percentages of the frame, anchored at the text centre.
    let xExpr = `(w-text_w)*${(style.positionX / 100).toFixed(4)}`
    if (hasPosX) {
      const trackX = getKeyframeTrack(clip as any, 'transform.positionX')
      const exprX = buildKeyframeFfmpegExpression(trackX, 0, clipTimeExpr)
      xExpr = `(w-text_w)*(${(style.positionX / 100).toFixed(4)}+(${exprX})/100)`
    }

    let yExpr = `(h-text_h)*${(style.positionY / 100).toFixed(4)}`
    if (hasPosY) {
      const trackY = getKeyframeTrack(clip as any, 'transform.positionY')
      const exprY = buildKeyframeFfmpegExpression(trackY, 0, clipTimeExpr)
      yExpr = `(h-text_h)*(${(style.positionY / 100).toFixed(4)}+(${exprY})/100)`
    }

    let fontSizeExpr = `${fontSize}`
    if (hasScale) {
      const trackScale = getKeyframeTrack(clip as any, 'transform.scale')
      const exprScale = buildKeyframeFfmpegExpression(trackScale, 100, clipTimeExpr)
      fontSizeExpr = `'${fontSize}*(${exprScale})/100'`
    }

    let fontColorPart = `fontcolor=${fontColor}@${alpha.toFixed(2)}`
    if (hasOpacity) {
      const trackOp = getKeyframeTrack(clip as any, 'opacity')
      const exprOp = buildKeyframeFfmpegExpression(trackOp, style.opacity ?? 100, clipTimeExpr)
      const alphaExpr = `min(1\\,max(0\\,(${exprOp})/100))`
      fontColorPart = `fontcolor=${fontColor}:alpha='${alphaExpr}'`
    }

    let boxPart = ''
    if (style.backgroundColor && style.backgroundColor !== 'transparent') {
      const bgHex = style.backgroundColor.replace('#', '')
      const bgColor = hexToFfmpegColor(style.backgroundColor, '0x000000')
      const bgAlpha = bgHex.length > 6 ? (parseInt(bgHex.slice(6), 16) / 255).toFixed(2) : '0.6'
      boxPart = `:box=1:boxcolor=${bgColor}@${bgAlpha}:boxborderw=${Math.max(0, Math.round(style.padding))}`
    }

    let borderPart = ''
    if (style.strokeWidth > 0 && style.strokeColor && style.strokeColor !== 'transparent') {
      borderPart = `:borderw=${Math.round(style.strokeWidth)}:bordercolor=${hexToFfmpegColor(style.strokeColor, '0x000000')}`
    }

    const start = clip.startTime.toFixed(3)
    const end = (clip.startTime + clip.duration).toFixed(3)

    if (hasTypewriter && style.text.length > 1) {
      const trackProg = getKeyframeTrack(clip as any, 'text.progress')!
      const lastPoint = trackProg.points[trackProg.points.length - 1]
      const typeDur = Math.max(0.1, lastPoint ? lastPoint.t : clip.duration)
      const textLen = style.text.length
      const stepDur = typeDur / textLen

      for (let s = 0; s < textLen; s++) {
        const subText = style.text.slice(0, s + 1)
        const stepStart = (clip.startTime + s * stepDur).toFixed(3)
        const stepEnd = s === textLen - 1 ? end : (clip.startTime + (s + 1) * stepDur).toFixed(3)
        const nextSubLabel = `txt${t}_${s}`
        const dtFilter = `drawtext=text='${escapeDrawtext(subText)}':fontsize=${fontSizeExpr}:${fontColorPart}:x=${xExpr}:y=${yExpr}${boxPart}${borderPart}:enable='between(t\\,${stepStart}\\,${stepEnd})'`
        filterParts.push(`[${lastLabel}]${dtFilter}[${nextSubLabel}]`)
        lastLabel = nextSubLabel
      }
    } else {
      const nextLabel = `txt${t}`
      const dtFilter = `drawtext=text='${escapeDrawtext(style.text)}':fontsize=${fontSizeExpr}:${fontColorPart}:x=${xExpr}:y=${yExpr}${boxPart}${borderPart}:enable='between(t\\,${start}\\,${end})'`
      filterParts.push(`[${lastLabel}]${dtFilter}[${nextLabel}]`)
      lastLabel = nextLabel
    }
  }

  // Letterbox overlay (drawbox)
  if (letterbox) {
    const containerRatio = width / height
    const targetRatio = letterbox.ratio
    const hexColor = letterbox.color.replace('#', '')
    const alphaHex = Math.round(letterbox.opacity * 255).toString(16).padStart(2, '0')
    const colorStr = `0x${hexColor}${alphaHex}`
    const nextLabel = 'lbout'

    if (targetRatio >= containerRatio) {
      const visibleH = Math.round(width / targetRatio)
      const barH = Math.round((height - visibleH) / 2)
      if (barH > 0) {
        filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=iw:h=${barH}:c=${colorStr}:t=fill,drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:c=${colorStr}:t=fill[${nextLabel}]`)
        lastLabel = nextLabel
      }
    } else {
      const visibleW = Math.round(height * targetRatio)
      const barW = Math.round((width - visibleW) / 2)
      if (barW > 0) {
        filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill,drawbox=x=iw-${barW}:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill[${nextLabel}]`)
        lastLabel = nextLabel
      }
    }
  }

  // Subtitle burn-in (drawtext) — always on top.
  if (subtitles && subtitles.length > 0) {
    for (let si = 0; si < subtitles.length; si++) {
      const sub = subtitles[si]
      const nextLabel = `sub${si}`
      const fontSize = Math.round(sub.style.fontSize * (height / 1080))
      const fontColor = hexToFfmpegColor(sub.style.color)

      let yExpr: string
      if (sub.style.position === 'top') {
        yExpr = '20'
      } else if (sub.style.position === 'center') {
        yExpr = '(h-text_h)/2'
      } else {
        yExpr = 'h-text_h-30'
      }

      let boxPart = ''
      if (sub.style.backgroundColor && sub.style.backgroundColor !== 'transparent') {
        const bgHex = sub.style.backgroundColor.replace('#', '')
        const bgColor = hexToFfmpegColor(sub.style.backgroundColor, '0x000000')
        const bgAlpha = bgHex.length > 6 ? (parseInt(bgHex.slice(6), 16) / 255).toFixed(2) : '0.6'
        boxPart = `:box=1:boxcolor=${bgColor}@${bgAlpha}:boxborderw=8`
      }

      const dtFilter = `drawtext=text='${escapeDrawtext(sub.text)}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${yExpr}${boxPart}:enable='between(t\\,${sub.startTime.toFixed(3)}\\,${sub.endTime.toFixed(3)})'`

      filterParts.push(`[${lastLabel}]${dtFilter}[${nextLabel}]`)
      lastLabel = nextLabel
    }
  }

  if (lastLabel !== 'outv') {
    filterParts.push(`[${lastLabel}]null[outv]`)
  }

  return { inputs, filterScript: filterParts.join(';\n') }
}
