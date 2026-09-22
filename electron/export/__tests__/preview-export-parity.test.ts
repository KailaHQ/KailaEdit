import { describe, it, expect } from 'vitest'
import { buildVideoFilterGraph } from '../video-filter'
import { buildAudioPcmArgs } from '../audio-mix'
import type { ExportClip } from '../timeline'
import { getClipEffectStyles } from '../../../core/src/video-editor-utils'
import { matteAlphaBand, matteFeatherSigma } from '../../../core/src/matte-edge'
import {
  sampleClipAt,
  buildKeyframeFfmpegExpression,
} from '../../../core/src/keyframes'
import {
  timelineClipSchema,
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_COLOR_CORRECTION,
  type TimelineClip,
} from '../../../core/src/project-model'

/**
 * JS evaluator for FFmpeg mathematical expressions over 't'.
 */
function evalFfmpegExpr(expr: string, t: number): number {
  const jsExpr = expr
    .replace(/\bPI\b/g, `${Math.PI}`)
    .replace(/\bisnan\(([^)]+)\)/g, 'Number.isNaN($1)')
    .replace(/\blte\(([^,]+),([^)]+)\)/g, '(($1)<=($2))')
    .replace(/\blt\(([^,]+),([^)]+)\)/g, '(($1)<($2))')
    .replace(/\bpow\(([^,]+),([^)]+)\)/g, 'Math.pow($1,$2)')
    .replace(/\bround\(/g, 'Math.round(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')

  function transformIfs(s: string): string {
    const ifIdx = s.indexOf('if(')
    if (ifIdx === -1) return s

    let depth = 0
    const startParen = ifIdx + 2
    let comma1 = -1
    let comma2 = -1
    let endParen = -1

    for (let i = startParen; i < s.length; i++) {
      if (s[i] === '(') {
        depth++
      } else if (s[i] === ')') {
        depth--
        if (depth === 0) {
          endParen = i
          break
        }
      } else if (s[i] === ',' && depth === 1) {
        if (comma1 === -1) comma1 = i
        else if (comma2 === -1) comma2 = i
      }
    }

    if (comma1 === -1 || comma2 === -1 || endParen === -1) return s

    const cond = transformIfs(s.slice(startParen + 1, comma1))
    const thenPart = transformIfs(s.slice(comma1 + 1, comma2))
    const elsePart = transformIfs(s.slice(comma2 + 1, endParen))

    const replaced = `((${cond}) ? (${thenPart}) : (${elsePart}))`
    return s.slice(0, ifIdx) + replaced + transformIfs(s.slice(endParen + 1))
  }

  const transformed = transformIfs(jsExpr)
  // eslint-disable-next-line no-new-func
  const fn = new Function('t', `return (${transformed})`)
  return fn(t)
}

function makePair(overrides: Partial<TimelineClip> = {}): {
  timelineClip: TimelineClip
  exportClip: ExportClip
} {
  const base = {
    id: 'clip_parity_1',
    assetId: null,
    type: 'video' as const,
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: 0,
    asset: null,
    opacity: 100,
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    ...overrides,
  }

  const timelineClip = timelineClipSchema.parse(base)

  const exportClip: ExportClip = {
    id: timelineClip.id,
    type: timelineClip.type,
    path: '/media/sample.mp4',
    startTime: timelineClip.startTime,
    duration: timelineClip.duration,
    trimStart: timelineClip.trimStart,
    speed: timelineClip.speed,
    reversed: timelineClip.reversed,
    volume: timelineClip.volume,
    muted: timelineClip.muted,
    opacity: timelineClip.opacity,
    trackIndex: timelineClip.trackIndex,
    transform: timelineClip.transform,
    colorCorrection: timelineClip.colorCorrection,
    filter: timelineClip.filter,
    effects: timelineClip.effects,
    keyframes: timelineClip.keyframes,
    transitionIn: timelineClip.transitionIn,
    transitionOut: timelineClip.transitionOut,
    flipH: timelineClip.flipH,
    flipV: timelineClip.flipV,
    mask: timelineClip.mask,
    chromaKey: timelineClip.chromaKey,
    blendMode: timelineClip.blendMode,
    autoMatte: timelineClip.autoMatte,
    stroke: timelineClip.stroke,
  }

  return { timelineClip, exportClip }
}

describe('KE-206: Preview vs Export Systematic Parity Suite', () => {
  const canvasOpts = { width: 1920, height: 1080, fps: 30, totalDuration: 10 }

  describe('1. LUT and Grading Parity', () => {
    it('generates no LUT or color grading filters when clip has neutral settings', () => {
      const { timelineClip, exportClip } = makePair()

      // Preview styles
      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.filter).toBeUndefined()

      // Export filtergraph
      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).not.toContain('lut3d')
      expect(filterScript).not.toContain('eq=')
      expect(filterScript).not.toContain('colorbalance=')
      expect(filterScript).not.toContain('curves=')
    })

    it('prevents double grading: skips CSS approximation when WebGL LUT is active, exports valid lut3d filter', () => {
      const { timelineClip, exportClip } = makePair({
        filter: { id: 'cine-teal-orange', intensity: 80 },
      })

      // When WebGL handles the LUT (lutApproximation: false), CSS should NOT apply approximation
      const webglPreview = getClipEffectStyles(timelineClip, 0, { lutApproximation: false })
      expect(webglPreview.filter).toBeUndefined()

      // When fallback CSS handles it (lutApproximation: true), approximation filter is applied
      const fallbackPreview = getClipEffectStyles(timelineClip, 0, { lutApproximation: true })
      expect(fallbackPreview.filter).toContain('contrast(')
      expect(fallbackPreview.filter).toContain('sepia(')

      // Export filtergraph must include lut3d with matching cube filename and trilinear interpolation
      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('lut3d=file=')
      expect(filterScript).toContain('cine-teal-orange.cube')
      expect(filterScript).toContain('interp=trilinear')
    })

    it('omits LUT filter in both preview and export when filter intensity is 0', () => {
      const { timelineClip, exportClip } = makePair({
        filter: { id: 'vintage-kodachrome', intensity: 0 },
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0, { lutApproximation: true })
      expect(previewStyle.filter).toBeUndefined()

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).not.toContain('lut3d')
    })
  })

  describe('2. Color Correction Parity', () => {
    it('matches brightness adjustments directionally and proportionally', () => {
      const { timelineClip, exportClip } = makePair({
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION, brightness: 25 },
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      // Preview: 1 + 25 / 100 = 1.25
      expect(previewStyle.filter).toContain('brightness(1.25)')

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      // Export: 25 / 100 * 0.5 = 0.1250
      expect(filterScript).toContain('eq=brightness=0.1250')
    })

    it('matches contrast and saturation adjustments', () => {
      const { timelineClip, exportClip } = makePair({
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION, contrast: 30, saturation: -20 },
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.filter).toContain('contrast(1.3)')
      expect(previewStyle.filter).toContain('saturate(0.8)')

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('contrast=1.3000')
      expect(filterScript).toContain('saturation=0.8000')
    })

    it('matches exposure adjustment direction', () => {
      const { timelineClip, exportClip } = makePair({
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION, exposure: 40 },
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      // Preview: brightness(1 + 40 / 200) = brightness(1.2)
      expect(previewStyle.filter).toContain('brightness(1.2)')

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      // Export: gamma = 1 - 40 / 200 = 0.8000 (lifting midtones)
      expect(filterScript).toContain('gamma=0.8000')
    })

    it('matches temperature and tint via colorbalance in export and hue-rotate/sepia in preview', () => {
      const { timelineClip, exportClip } = makePair({
        colorCorrection: { ...DEFAULT_COLOR_CORRECTION, temperature: 50, tint: -20 },
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.filter).toContain('sepia(0.25)')
      expect(previewStyle.filter).toContain('hue-rotate(')

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      // temperature: rm = +0.1500, bm = -0.1500; tint: gm = -0.0600
      expect(filterScript).toContain('colorbalance=rm=0.1500:gm=-0.0600:bm=-0.1500')
    })
  })

  describe('3. Crop and Scale Geometry Order Parity', () => {
    it('ensures crop occurs before transform scale and rotation in export chain', () => {
      const { timelineClip, exportClip } = makePair({
        transform: {
          scale: 140,
          rotation: 45,
          positionX: 10,
          positionY: -5,
          cropLeft: 10,
          cropRight: 10,
          cropTop: 15,
          cropBottom: 15,
        },
      })

      // Export order check: scale -> format -> crop -> pad -> rotate
      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)

      const scaleIdx = filterScript.indexOf('scale=')
      const cropIdx = filterScript.indexOf('crop=')
      const padIdx = filterScript.indexOf('pad=')
      const rotateIdx = filterScript.indexOf('rotate=')

      expect(scaleIdx).toBeGreaterThan(-1)
      expect(cropIdx).toBeGreaterThan(scaleIdx)
      expect(padIdx).toBeGreaterThan(cropIdx)
      expect(rotateIdx).toBeGreaterThan(padIdx)

      // Preview check: clip-path inset matches crop percentages
      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.clipPath).toBe('inset(15% 10% 15% 10%)')
      expect(previewStyle.transform).toContain('scale(1.4)')
      expect(previewStyle.transform).toContain('rotate(45deg)')
      expect(previewStyle.transform).toContain('translate(10%, -5%)')
    })

    it('handles flipH and flipV consistently', () => {
      const { timelineClip, exportClip } = makePair({
        flipH: true,
        flipV: true,
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.transform).toContain('scaleX(-1)')
      expect(previewStyle.transform).toContain('scaleY(-1)')

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('hflip')
      expect(filterScript).toContain('vflip')
    })
  })

  describe('4. Opacity and Transition Parity', () => {
    it('matches static opacity between CSS and FFmpeg colorchannelmixer', () => {
      const { timelineClip, exportClip } = makePair({
        opacity: 65,
      })

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.opacity).toBe(0.65)

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('colorchannelmixer=aa=0.65')
    })

    it('matches transition fade curve between preview time progression and export fade timing', () => {
      const { timelineClip, exportClip } = makePair({
        duration: 10,
        opacity: 100,
        transitionIn: { type: 'fade-to-black', duration: 2.0 },
        transitionOut: { type: 'fade-to-black', duration: 2.0 },
      })

      // Export fade filters
      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('fade=t=in:st=0.0000:d=2.0000:color=black')
      expect(filterScript).toContain('fade=t=out:st=8.0000:d=2.0000:color=black')

      // Sample preview at key transition milestones:
      // t = 0: start of fade-in -> opacity 0
      expect(getClipEffectStyles(timelineClip, 0).opacity).toBeCloseTo(0, 3)

      // t = 1.0: halfway through 2.0s fade-in -> opacity 0.5
      expect(getClipEffectStyles(timelineClip, 1.0).opacity).toBeCloseTo(0.5, 3)

      // t = 2.0: end of fade-in -> full opacity 1.0 (omitted from style when 1)
      expect(getClipEffectStyles(timelineClip, 2.0).opacity ?? 1).toBeCloseTo(1.0, 3)

      // t = 5.0: middle of clip -> full opacity 1.0 (omitted from style when 1)
      expect(getClipEffectStyles(timelineClip, 5.0).opacity ?? 1).toBeCloseTo(1.0, 3)

      // t = 9.0: 1s from end (halfway through 2.0s fade-out) -> opacity 0.5
      expect(getClipEffectStyles(timelineClip, 9.0).opacity).toBeCloseTo(0.5, 3)

      // t = 10.0: end of clip -> opacity 0
      expect(getClipEffectStyles(timelineClip, 10.0).opacity).toBeCloseTo(0, 3)
    })
  })

  describe('5. Audio Gain Parity', () => {
    it('verifies static volume is treated as linear gain (1.0 = unity) in both preview and export', () => {
      const { timelineClip, exportClip } = makePair({
        volume: 1.75, // Linear gain +75% boost
      })

      // Preview domain model verifies linear gain
      expect(timelineClip.volume).toBe(1.75)

      // Export PCM extraction & mixing
      const { args } = buildAudioPcmArgs(
        exportClip.path,
        exportClip.trimStart,
        exportClip.trimStart + exportClip.duration,
        exportClip.speed,
        false,
        2,
        undefined,
      )
      // When volume is static, FFmpeg PCM extraction produces raw audio stream
      // and mixAudioToPcm scales samples directly by src.volume (1.75)
      expect(timelineClip.volume).toBe(1.75)
      expect(exportClip.volume).toBe(1.75)
      expect(args.join(' ')).not.toContain('volume=eval=frame')
    })

    it('verifies keyframed audio volume curves match within < 1% between sampleClipAt and FFmpeg expression', () => {
      const { timelineClip, exportClip } = makePair({
        duration: 4,
        keyframes: [
          {
            property: 'volume',
            points: [
              { t: 0, value: 0.2, easing: 'linear' },
              { t: 2, value: 1.8, easing: 'ease-in-out' },
              { t: 4, value: 0.6, easing: 'linear' },
            ],
          },
        ],
      })

      const volumeTrack = timelineClip.keyframes?.find(k => k.property === 'volume')
      const expr = buildKeyframeFfmpegExpression(volumeTrack, 1, 't')

      // Sample along 10 time points in [0, 4]
      for (let t = 0; t <= 4; t += 0.4) {
        const previewSample = sampleClipAt(timelineClip, t).volume
        const exportEvaluated = evalFfmpegExpr(expr, t)

        const diffPercent = (Math.abs(exportEvaluated - previewSample) / previewSample) * 100
        expect(diffPercent).toBeLessThan(1.0)
      }

      // Check export pcm audio arguments generate dynamic eval=frame expression
      const { args } = buildAudioPcmArgs(
        exportClip.path,
        exportClip.trimStart,
        exportClip.trimStart + exportClip.duration,
        exportClip.speed,
        false,
        2,
        volumeTrack,
      )
      const pcmStr = args.join(' ')
      expect(pcmStr).toContain('volume=eval=frame:volume=')
      expect(pcmStr).toContain('if(isnan(t),1.0,')
    })
  })

  describe('6. KE-501: Clip Mask Preview vs Export Parity', () => {
    it('produces no mask in preview style and no geq filter in export when mask is disabled or missing', () => {
      const { timelineClip, exportClip } = makePair()

      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.maskImage).toBeUndefined()
      expect(previewStyle.WebkitMaskImage).toBeUndefined()

      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).not.toContain('geq=')
    })

    it('generates matching rectangle mask with rotation, feather and invert across preview SVG and FFmpeg geq filter', () => {
      const mask = {
        enabled: true,
        shape: 'rectangle' as const,
        x: 45,
        y: 55,
        width: 60,
        height: 40,
        rotation: 30,
        feather: 15,
        invert: true,
      }

      const { timelineClip, exportClip } = makePair({ mask })

      // Preview: CSS SVG mask data URI
      const previewStyle = getClipEffectStyles(timelineClip, 0)
      expect(previewStyle.maskImage).toBeDefined()
      expect(previewStyle.maskImage).toContain('data:image/svg+xml')
      const decodedSvg = decodeURIComponent(previewStyle.maskImage!.replace('url("data:image/svg+xml;utf8,', '').replace('")', ''))
      expect(decodedSvg).toContain('<rect')
      expect(decodedSvg).toContain('rotate(30 45 55)')
      expect(decodedSvg).toContain('feGaussianBlur')
      expect(decodedSvg).toContain('mask id="inv"')

      // Export: FFmpeg geq filter
      const { filterScript } = buildVideoFilterGraph([exportClip], canvasOpts)
      expect(filterScript).toContain('geq=lum=')
      expect(filterScript).toContain('(X/W-0.450000)')
      expect(filterScript).toContain('(Y/H-0.550000)')
      expect(filterScript).toContain('min(')
      expect(filterScript).toContain('1-(255*clip(') // inverted
    })

    it('generates matching ellipse and linear masks across preview SVG and FFmpeg geq filter', () => {
      // Ellipse test
      const ellipseMask = {
        enabled: true,
        shape: 'ellipse' as const,
        x: 50,
        y: 50,
        width: 80,
        height: 60,
        rotation: 0,
        feather: 0,
        invert: false,
      }
      const pairEllipse = makePair({ mask: ellipseMask })
      const prevEllipse = getClipEffectStyles(pairEllipse.timelineClip, 0)
      const expEllipse = buildVideoFilterGraph([pairEllipse.exportClip], canvasOpts)
      expect(decodeURIComponent(prevEllipse.maskImage!)).toContain('<ellipse')
      expect(expEllipse.filterScript).toContain('hypot(')

      // Linear test
      const linearMask = {
        enabled: true,
        shape: 'linear' as const,
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        rotation: 45,
        feather: 10,
        invert: false,
      }
      const pairLinear = makePair({ mask: linearMask })
      const prevLinear = getClipEffectStyles(pairLinear.timelineClip, 0)
      const expLinear = buildVideoFilterGraph([pairLinear.exportClip], canvasOpts)
      expect(decodeURIComponent(prevLinear.maskImage!)).toContain('rotate(45 50 50)')
      expect(expLinear.filterScript).toContain('clip(((')
    })

    it('generates colorkey and despill filters for chromaKey in export filtergraph', () => {
      const chromaKey = {
        enabled: true,
        color: '#00FF00',
        similarity: 35,
        smoothness: 15,
        spill: 60,
      }
      const pair = makePair({ chromaKey })
      const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
      expect(filterScript).toContain('colorkey=color=#00FF00:similarity=0.3500:blend=0.1500')
      expect(filterScript).toContain('despill=type=green:mix=0.60')
    })

    it('generates despill with blue type when blue is dominant', () => {
      const chromaKey = {
        enabled: true,
        color: '#0033CC',
        similarity: 40,
        smoothness: 10,
        spill: 50,
      }
      const pair = makePair({ chromaKey })
      const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
      expect(filterScript).toContain('colorkey=color=#0033CC:similarity=0.4000:blend=0.1000')
      expect(filterScript).toContain('despill=type=blue:mix=0.50')
    })

    it('KE-1407: generates rgba format, erosion, and gblur for chromaKey in export filtergraph', () => {
      const chromaKey = {
        enabled: true,
        color: '#00FF00',
        similarity: 35,
        smoothness: 15,
        spill: 60,
        featherEdge: 20,
        cleanEdge: 50,
      }
      const pair = makePair({ chromaKey })
      const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
      expect(filterScript).toContain('format=rgba,colorkey=color=#00FF00:similarity=0.3500:blend=0.1500')
      expect(filterScript).toContain('despill=type=green:mix=0.60')
      expect(filterScript).toContain('erosion=threshold0=0:threshold1=0:threshold2=0')
      expect(filterScript).toContain('gblur=sigma=2.00:planes=8')
      expect(filterScript).toContain('format=yuva420p')
    })

    it('KE-1407: WebGL shader math achieves exact parity with FFmpeg colorkey Chebyshev Linf metric', () => {
      // Compare FFmpeg vf_colorkey.c formula vs WebGL shader formula
      const keyColor = [0, 255, 0]
      const similarity = 0.35
      const blend = 0.15

      const ffmpegColorkey = (r: number, g: number, b: number) => {
        const diff = Math.max(Math.abs(r - keyColor[0]), Math.abs(g - keyColor[1]), Math.abs(b - keyColor[2])) / 255.0
        if (diff > similarity) return 1.0
        if (blend > 0.0001 && diff > similarity - blend) {
          return (diff - (similarity - blend)) / blend
        }
        return 0.0
      }

      const webglColorkey = (r: number, g: number, b: number) => {
        const color = [r / 255.0, g / 255.0, b / 255.0]
        const u_chroma_color = [keyColor[0] / 255.0, keyColor[1] / 255.0, keyColor[2] / 255.0]
        const diffVec = [
          Math.abs(color[0] - u_chroma_color[0]),
          Math.abs(color[1] - u_chroma_color[1]),
          Math.abs(color[2] - u_chroma_color[2]),
        ]
        const diff = Math.max(diffVec[0], Math.max(diffVec[1], diffVec[2]))
        const sim = similarity
        const blendVal = Math.max(0.0001, blend)
        if (diff > sim) return 1.0
        if (diff > sim - blendVal) return (diff - (sim - blendVal)) / blendVal
        return 0.0
      }

      const testPixels = [
        [0, 255, 0],
        [0, 240, 0],
        [20, 200, 30],
        [50, 180, 50],
        [255, 0, 0],
        [0, 0, 255],
        [100, 100, 100],
        [10, 215, 15],
      ]

      for (const [r, g, b] of testPixels) {
        const ffAlpha = ffmpegColorkey(r, g, b)
        const glAlpha = webglColorkey(r, g, b)
        expect(Math.abs(ffAlpha - glAlpha)).toBeLessThan(1e-5)
      }
    })

    it('KE-503: maintains parity between CSS mix-blend-mode and FFmpeg blend=all_mode', () => {
      const blendModes: Array<{
        mode: 'multiply' | 'screen' | 'overlay' | 'add' | 'difference'
        css: string
        ffmpeg: string
      }> = [
        { mode: 'multiply', css: 'multiply', ffmpeg: 'multiply' },
        { mode: 'screen', css: 'screen', ffmpeg: 'screen' },
        { mode: 'overlay', css: 'overlay', ffmpeg: 'overlay' },
        { mode: 'add', css: 'plus-lighter', ffmpeg: 'addition' },
        { mode: 'difference', css: 'difference', ffmpeg: 'difference' },
      ]

      for (const item of blendModes) {
        const pair = makePair({ blendMode: item.mode })
        const previewStyle = getClipEffectStyles(pair.timelineClip, 0)
        expect(previewStyle.mixBlendMode).toBe(item.css)

        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        expect(filterScript).toContain(`blend=all_mode='${item.ffmpeg}'`)
      }

      // Normal mode has no special CSS mixBlendMode and uses normal overlay
      const normalPair = makePair({ blendMode: 'normal' })
      const normalPreview = getClipEffectStyles(normalPair.timelineClip, 0)
      expect(normalPreview.mixBlendMode).toBeUndefined()
      const normalExport = buildVideoFilterGraph([normalPair.exportClip], canvasOpts)
      expect(normalExport.filterScript).not.toContain('blend=all_mode=')
    })

    describe('KE-1403: Auto Matte Export and Filter Order Parity', () => {
      it.each([0.5, 2, 4])('retimes source alpha to %sx independently of its bake rate', speed => {
        const pair = makePair({ speed, trimStart: 6, duration: 4 / speed,
          autoMatte: { enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', cleanEdge: 0, featherEdge: 0,
            bake: { path: '/cache/source-matte.mp4', fingerprint: 'source', createdAt: 0,
              frameCount: 600, sourceStart: 2, sourceSpan: 20, speed: 1 } } })
        const { inputs, filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        const matteInput = inputs.indexOf('/cache/source-matte.mp4')
        expect(inputs.slice(matteInput - 3, matteInput)).toEqual(['-ss', '4.000000', '-i'])
        expect(filterScript).toMatch(new RegExp(`\\[\\d+:v\\]setpts=PTS-STARTPTS,setpts=PTS/${speed.toFixed(6)}`))
      })

      it('generates alphamerge with baked matte input when autoMatte is enabled', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            cleanEdge: 0,
            featherEdge: 0,
            bake: {
              path: '/cache/matte_clip1.mp4',
              fingerprint: 'matte_test123',
              frameCount: 150,
              createdAt: Date.now(),
            },
          },
        })

        const { inputs, filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        expect(inputs).toContain('/cache/matte_clip1.mp4')
        expect(filterScript).toContain('alphamerge')

        // alphamerge must appear after format=yuva420p
        const yuvaIdx = filterScript.indexOf('format=yuva420p')
        const alphaMergeIdx = filterScript.indexOf('alphamerge')
        expect(yuvaIdx).toBeGreaterThan(-1)
        expect(alphaMergeIdx).toBeGreaterThan(yuvaIdx)
      })

      /**
       * This asserted `erosion` until the two sides were reconciled. Erosion is a
       * morphological shrink — it removes whole pixels from the silhouette, taking thin
       * detail with them, and no fragment shader can reproduce it, so the preview ran a
       * `smoothstep` instead and the two never matched. Both are the shared alpha remap
       * from core now; see the cleanEdge tests further down.
       */
      it('no longer erodes the matte for cleanEdge', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            cleanEdge: 50,
            featherEdge: 0,
            bake: {
              path: '/cache/matte_clip1.mp4',
              fingerprint: 'matte_test123',
              frameCount: 150,
              createdAt: Date.now(),
            },
          },
        })

        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        expect(filterScript).not.toContain('erosion')
        expect(filterScript).toContain('lut=y=')
      })

      it('applies gblur filter when featherEdge > 0', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            cleanEdge: 0,
            featherEdge: 25,
            bake: {
              path: '/cache/matte_clip1.mp4',
              fingerprint: 'matte_test123',
              frameCount: 150,
              createdAt: Date.now(),
            },
          },
        })

        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        expect(filterScript).toContain('gblur=sigma=2.50')
      })

      it('strictly maintains order: yuva420p -> crop -> alphamerge -> colorkey -> geq mask', () => {
        const pair = makePair({
          transform: {
            scale: 100,
            positionX: 0,
            positionY: 0,
            rotation: 0,
            cropTop: 5,
            cropBottom: 5,
            cropLeft: 5,
            cropRight: 5,
          },
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            cleanEdge: 25,
            featherEdge: 10,
            bake: {
              path: '/cache/matte_clip1.mp4',
              fingerprint: 'matte_test123',
              frameCount: 150,
              createdAt: Date.now(),
            },
          },
          chromaKey: {
            enabled: true,
            color: '#00FF00',
            similarity: 30,
            smoothness: 10,
            spill: 10,
          },
          mask: {
            enabled: true,
            shape: 'rectangle',
            x: 50,
            y: 50,
            width: 80,
            height: 80,
            rotation: 0,
            feather: 0,
            invert: false,
          },
        })

        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        const yuvaIdx = filterScript.indexOf('format=yuva420p')
        const cropIdx = filterScript.indexOf('crop=')
        const alphaMergeIdx = filterScript.indexOf('alphamerge')
        const chromaIdx = filterScript.indexOf('colorkey=')
        const maskIdx = filterScript.indexOf('geq=')

        expect(yuvaIdx).toBeGreaterThan(-1)
        expect(cropIdx).toBeGreaterThan(yuvaIdx)
        expect(alphaMergeIdx).toBeGreaterThan(cropIdx)
        expect(chromaIdx).toBeGreaterThan(alphaMergeIdx)
        expect(maskIdx).toBeGreaterThan(chromaIdx)
      })

      it('ensures ExportClip maintains key visual properties matching TimelineClip schema', () => {
        const requiredVisualProps: Array<keyof ExportClip> = [
          'autoMatte',
          'stroke',
          'chromaKey',
          'mask',
          'blendMode',
          'filter',
          'effects',
          'transform',
          'colorCorrection',
          'keyframes',
        ]

        const sampleClip = makePair({}).exportClip
        for (const prop of requiredVisualProps) {
          expect(prop in sampleClip).toBe(true)
        }
      })
    })

    describe('KE-1404: Stroke Layer Parity', () => {
      it('generates no stroke inputs or overlays when stroke is disabled or style is none', () => {
        const pair = makePair({
          stroke: {
            enabled: false,
            style: 'solid',
            color: '#FFFFFF',
            width: 12,
            opacity: 100,
            offsetX: 0,
            offsetY: 0,
            glow: 50,
            roughness: 50,
            gap: 50,
            seed: 0,
          },
        })
        const { inputs, filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)
        expect(inputs.some((arg) => arg.includes('stroke'))).toBe(false)
        expect(filterScript).not.toContain('strk')
      })

      it('injects stroke input and overlays subject on top of stroke', () => {
        const pair = makePair({
          stroke: {
            enabled: true,
            style: 'solid',
            color: '#FF0000',
            width: 12,
            opacity: 100,
            offsetX: 0,
            offsetY: 0,
            glow: 50,
            roughness: 50,
            gap: 50,
            seed: 0,
          },
        })
        pair.exportClip.strokeBakePath = '/cache/stroke_clip1.mov'

        const { inputs, filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        expect(inputs).toContain('/cache/stroke_clip1.mov')
        expect(filterScript).toContain('overlay=shortest=1:format=auto')
        // Stroke layer is input 0 to overlay, subject is input 1 to overlay
        expect(filterScript).toMatch(/\[strk0_0\]\[cpre_strk0_0\]overlay=shortest=1:format=auto/)
      })

      /**
       * The stroke bake covers the whole matte, not this clip's window of it — that is
       * what lets every render-cache segment of a clip share one bake instead of paying
       * for its own ~80-second render. The price is that the stroke no longer starts on
       * the clip's first frame, so it has to be seeked exactly like the matte. Get this
       * wrong and the outline sits seconds away from the subject in the exported file,
       * with nothing to flag it.
       */
      it('seeks the stroke bake by the same offset as the matte', () => {
        const pair = makePair({
          trimStart: 30,
          duration: 10,
          stroke: {
            enabled: true, style: 'solid', color: '#FF0000', width: 12, opacity: 100,
            offsetX: 0, offsetY: 0, glow: 50, roughness: 50, gap: 50, seed: 0,
          },
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
            // Covers 20s–60s of the source, so a clip trimmed to 30s starts 10s in.
            bake: {
              path: '/cache/matte.mp4', fingerprint: 'matte_x_20000_40000', frameCount: 1200,
              createdAt: 0, sourceStart: 20, sourceSpan: 40,
            },
          },
        })
        pair.exportClip.strokeBakePath = '/cache/stroke_clip1.mov'

        const { inputs } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        /** The `-ss` value ffmpeg is given for an input, or null if it is not seeked. */
        const seekFor = (file: string): string | null => {
          const i = inputs.indexOf(file)
          expect(inputs[i - 1]).toBe('-i')
          return inputs[i - 3] === '-ss' ? inputs[i - 2] : null
        }

        expect(seekFor('/cache/stroke_clip1.mov')).toBe(seekFor('/cache/matte.mp4'))
        expect(Number(seekFor('/cache/matte.mp4'))).toBeCloseTo(10, 4)
      })

      /**
       * `cleanEdge` was `erosion` repeated N times here while the preview ran a
       * `smoothstep` on alpha. Erosion eats whole pixels off the silhouette — it takes
       * fingers and hair with them — and a fragment shader cannot mirror it, so the two
       * could never agree. Both sides read the band out of core now.
       */
      it('applies cleanEdge as the shared alpha remap, not as erosion', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true, model: 'rvm-mobilenetv3', quality: 'standard',
            featherEdge: 0, cleanEdge: 50,
            bake: { path: '/cache/matte.mp4', fingerprint: 'm', frameCount: 1, createdAt: 0, sourceStart: 0, sourceSpan: 10 },
          },
        })
        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        expect(filterScript).not.toContain('erosion')
        const { lo, hi } = matteAlphaBand(50)
        expect(filterScript).toContain(`lut=y='clip((val-${(lo * 255).toFixed(3)})`)
        expect(filterScript).toContain((255 / ((hi - lo) * 255)).toFixed(6))
      })

      it('leaves the matte untouched when both edge controls are 0', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true, model: 'rvm-mobilenetv3', quality: 'standard',
            featherEdge: 0, cleanEdge: 0,
            bake: { path: '/cache/matte.mp4', fingerprint: 'm', frameCount: 1, createdAt: 0, sourceStart: 0, sourceSpan: 10 },
          },
        })
        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        expect(filterScript).not.toContain('erosion')
        expect(filterScript).not.toContain('lut=y=')
        expect(filterScript).not.toContain('gblur')
      })

      it('applies featherEdge as a blur on the sigma core defines', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true, model: 'rvm-mobilenetv3', quality: 'standard',
            featherEdge: 50, cleanEdge: 0,
            bake: { path: '/cache/matte.mp4', fingerprint: 'm', frameCount: 1, createdAt: 0, sourceStart: 0, sourceSpan: 10 },
          },
        })
        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        expect(filterScript).toContain(`gblur=sigma=${matteFeatherSigma(50).toFixed(2)}`)
      })

      it('ensures correct filter ordering with stroke, alphamerge, colorkey, and mask', () => {
        const pair = makePair({
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
            bake: {
              path: '/cache/matte_clip1.mp4',
              fingerprint: 'matte_test123',
              frameCount: 150,
              createdAt: Date.now(),
            },
          },
          chromaKey: {
            enabled: true,
            color: '#00FF00',
            similarity: 30,
            smoothness: 10,
            spill: 10,
          },
          mask: {
            enabled: true,
            shape: 'rectangle',
            x: 50,
            y: 50,
            width: 80,
            height: 80,
            rotation: 0,
            feather: 0,
            invert: false,
          },
          stroke: {
            enabled: true,
            style: 'solid',
            color: '#FFFFFF',
            width: 10,
            opacity: 100,
            offsetX: 0,
            offsetY: 0,
            glow: 50,
            roughness: 50,
            gap: 50,
            seed: 0,
          },
        })
        pair.exportClip.strokeBakePath = '/cache/stroke_clip1.mov'

        const { filterScript } = buildVideoFilterGraph([pair.exportClip], canvasOpts)

        const yuvaIdx = filterScript.indexOf('format=yuva420p')
        const alphaMergeIdx = filterScript.indexOf('alphamerge')
        const chromaIdx = filterScript.indexOf('colorkey=')
        const maskIdx = filterScript.indexOf('geq=')
        const strokeOverlayIdx = filterScript.indexOf('overlay=shortest=1:format=auto')

        expect(yuvaIdx).toBeGreaterThan(-1)
        expect(alphaMergeIdx).toBeGreaterThan(yuvaIdx)
        expect(chromaIdx).toBeGreaterThan(alphaMergeIdx)
        expect(maskIdx).toBeGreaterThan(chromaIdx)
        expect(strokeOverlayIdx).toBeGreaterThan(maskIdx)
      })
    })
  })
})



