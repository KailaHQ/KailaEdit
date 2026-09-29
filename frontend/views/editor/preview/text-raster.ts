import type { KeyframeTrack, TextOverlayStyle, TimelineClip } from '../../../types/project-model'
import { fitMediaInFrame } from '@core/video-editor-utils'
import { DEFAULT_TEXT_MAX_WIDTH, TEXT_HIT_PADDING, TEXT_REFERENCE_FRAME_HEIGHT } from './TextBoundingBox'

/**
 * Drawing a text clip into a picture, exactly as the monitor draws it.
 *
 * The export used to burn text in with ffmpeg's drawtext, which knows a font size, a
 * colour, an outline and a box — and nothing else. The font, bold, italic, underline,
 * shadow, letter and line spacing, alignment and wrapping the monitor shows were all
 * dropped, so what came out of the export was not what had been designed. Here the text
 * is laid out with the monitor's own rules (TextBoundingBox) and painted by the browser's
 * own text engine, then handed to the export as an image clip.
 */

export interface TextMeasure {
  (text: string): number
}

/** Lines the text breaks into inside `maxWidth`, as CSS `white-space: pre-wrap; word-break: break-word` does. */
export function layoutTextLines(text: string, measure: TextMeasure, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    // A word wider than the whole box breaks between letters.
    const addByLetter = (word: string) => {
      for (const ch of Array.from(word)) {
        if (line !== '' && measure(line + ch) > maxWidth) {
          lines.push(line)
          line = ''
        }
        line += ch
      }
    }
    for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
      // Spaces never start a wrap: at the end of a line they hang past the edge.
      if (/^\s+$/.test(token)) { line += token; continue }
      if (measure(line + token) <= maxWidth) { line += token; continue }
      if (line.trim() !== '') lines.push(line.trimEnd())
      line = ''
      if (measure(token) <= maxWidth) line = token
      else addByLetter(token)
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export interface TextBoxLayout {
  /** Pixels per text-style pixel at this frame size. */
  unit: number
  fontPx: number
  padding: number
  lineHeightPx: number
  lines: string[]
  lineWidths: number[]
  /** Width of the text column inside the padding. */
  contentWidth: number
  /** The box the monitor draws (background included), in frame pixels. */
  boxWidth: number
  boxHeight: number
}

/** The monitor's text box for this style on a frame this size. */
export function layoutTextBox(style: TextOverlayStyle, frame: { width: number; height: number }, measure: TextMeasure): TextBoxLayout {
  const unit = frame.height / TEXT_REFERENCE_FRAME_HEIGHT
  const fontPx = style.fontSize * unit
  const padding = (style.padding > 0 ? style.padding : TEXT_HIT_PADDING) * unit
  const lineHeightPx = fontPx * (style.lineHeight || 1.2)
  const maxWidthPercent = style.maxWidth > 0 ? style.maxWidth : DEFAULT_TEXT_MAX_WIDTH
  // A width set narrower than the default is a fixed width; otherwise the box hugs the text.
  const isCustomWidth = style.maxWidth > 0 && style.maxWidth < DEFAULT_TEXT_MAX_WIDTH
  const maxBoxWidth = (maxWidthPercent / 100) * frame.width
  const columnMax = Math.max(1, maxBoxWidth - 2 * padding)

  const text = style.text || 'Text'
  const lines = layoutTextLines(text, measure, columnMax)
  const lineWidths = lines.map(line => measure(line))
  // `width: max-content` capped by `max-width`: the unwrapped width of the longest
  // paragraph, so text that has to wrap fills the whole capped width.
  const maxContent = Math.max(0, ...text.split('\n').map(paragraph => measure(paragraph.trimEnd())))
  const contentWidth = isCustomWidth ? columnMax : Math.min(columnMax, maxContent)
  return {
    unit,
    fontPx,
    padding,
    lineHeightPx,
    lines,
    lineWidths,
    contentWidth,
    boxWidth: contentWidth + 2 * padding,
    boxHeight: lines.length * lineHeightPx + 2 * padding,
  }
}

function cssFont(style: TextOverlayStyle, fontPx: number): string {
  const weight = style.fontWeight === 'normal' ? 400 : style.fontWeight === 'bold' ? 700 : style.fontWeight
  return `${style.fontStyle === 'italic' ? 'italic' : 'normal'} ${weight} ${fontPx}px ${style.fontFamily}`
}

export interface RasterizedText {
  canvas: HTMLCanvasElement
  /** The box's centre, in percent of the frame — where the monitor centres it. */
  centerX: number
  centerY: number
}

/**
 * The text drawn at `frame` size. The picture is the text box plus room for its outline
 * and shadow on every side, so its centre is the box's centre.
 */
export async function rasterizeTextStyle(style: TextOverlayStyle, frame: { width: number; height: number }): Promise<RasterizedText> {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('Canvas is not available')
  const fontPx = style.fontSize * (frame.height / TEXT_REFERENCE_FRAME_HEIGHT)
  const font = cssFont(style, fontPx)
  try { await document.fonts?.load(font, style.text) } catch { /* a missing font falls back, as on screen */ }

  const unit = frame.height / TEXT_REFERENCE_FRAME_HEIGHT
  const letterSpacing = `${(style.letterSpacing || 0) * unit}px`
  const prepare = (ctx: CanvasRenderingContext2D) => {
    ctx.font = font
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = letterSpacing
  }
  prepare(probe)
  const measure: TextMeasure = text => probe.measureText(text).width
  const box = layoutTextBox(style, frame, measure)

  const strokeWidth = style.strokeWidth > 0 && style.strokeColor !== 'transparent' ? style.strokeWidth * unit : 0
  const hasShadow = style.shadowBlur > 0 || style.shadowOffsetX !== 0 || style.shadowOffsetY !== 0
  const margin = Math.ceil(
    strokeWidth
    + (hasShadow ? style.shadowBlur * unit * 2 + Math.max(Math.abs(style.shadowOffsetX), Math.abs(style.shadowOffsetY)) * unit : 0)
    + 2,
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(box.boxWidth + 2 * margin))
  canvas.height = Math.max(1, Math.ceil(box.boxHeight + 2 * margin))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  // The box sits centred in the picture, whatever rounding did to its size.
  const left = (canvas.width - box.boxWidth) / 2
  const top = (canvas.height - box.boxHeight) / 2

  if (style.backgroundColor && style.backgroundColor !== 'transparent') {
    ctx.fillStyle = style.backgroundColor
    ctx.beginPath()
    ctx.roundRect(left, top, box.boxWidth, box.boxHeight, Math.max(0, style.borderRadius || 0) * unit)
    ctx.fill()
  }

  prepare(ctx)
  const metrics = ctx.measureText('Hg')
  const ascent = metrics.fontBoundingBoxAscent ?? fontPx * 0.8
  const descent = metrics.fontBoundingBoxDescent ?? fontPx * 0.2
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'

  const columnLeft = left + box.padding
  const lineX = (i: number) => {
    const slack = box.contentWidth - box.lineWidths[i]
    if (style.textAlign === 'center') return columnLeft + slack / 2
    if (style.textAlign === 'right') return columnLeft + slack
    return columnLeft
  }
  const baseline = (i: number) => top + box.padding + i * box.lineHeightPx + (box.lineHeightPx - (ascent + descent)) / 2 + ascent

  // Paint order: stroke first (behind), then fill on top — matches CSS `paintOrder: 'stroke fill'`
  // that the monitor and preset tiles use.  Stroke sits behind the fill so outlined text keeps
  // its full body weight instead of being eaten by the outline.

  // 1. Stroke (no shadow — the shadow belongs to the visible fill on top)
  if (strokeWidth > 0) {
    ctx.strokeStyle = style.strokeColor
    ctx.lineWidth = strokeWidth
    ctx.lineJoin = 'round'
    box.lines.forEach((line, i) => ctx.strokeText(line, lineX(i), baseline(i)))
  }

  // 2. Fill (with shadow and underline)
  if (hasShadow) {
    ctx.shadowColor = style.shadowColor
    ctx.shadowBlur = style.shadowBlur * unit
    ctx.shadowOffsetX = style.shadowOffsetX * unit
    ctx.shadowOffsetY = style.shadowOffsetY * unit
  }
  ctx.fillStyle = style.color
  box.lines.forEach((line, i) => {
    ctx.fillText(line, lineX(i), baseline(i))
    if (style.underline && box.lineWidths[i] > 0) {
      const thickness = Math.max(1, fontPx / 16)
      ctx.fillRect(lineX(i), baseline(i) + Math.max(1, fontPx * 0.09), box.lineWidths[i], thickness)
    }
  })
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  return { canvas, centerX: style.positionX, centerY: style.positionY }
}

/** Keyframes a typewriter reveal needs cannot be one picture; such text stays with drawtext. */
export function canRasterizeTextClip(clip: Pick<TimelineClip, 'type' | 'textStyle' | 'keyframes'>): boolean {
  if (clip.type !== 'text' || !clip.textStyle) return false
  return !(clip.keyframes ?? []).some(track => track.property === 'text.progress' && track.points.length > 0)
}

/**
 * The image clip that stands in for a text clip in the export: `raster` placed where the
 * monitor draws the text, with the text's animation carried over.
 *
 * Text keyframes are relative — position is an offset added to the style's position,
 * scale a factor on the text's size — while an image's are absolute, so they are rebased
 * on the way.
 */
export function textClipAsImage<T extends {
  type: string
  path: string
  opacity: number
  transform?: { scale: number; positionX: number; positionY: number; rotation: number; cropTop: number; cropRight: number; cropBottom: number; cropLeft: number; scaleX?: number; scaleY?: number }
  keyframes?: KeyframeTrack[]
  textStyle?: unknown
}>(
  clip: T,
  style: TextOverlayStyle,
  raster: { width: number; height: number; centerX: number; centerY: number },
  frame: { width: number; height: number },
  path: string,
): T {
  const fitted = fitMediaInFrame(frame, raster)
  const scale = (raster.width / fitted.width) * 100
  const baseX = raster.centerX - 50
  const baseY = raster.centerY - 50
  const keyframes = (clip.keyframes ?? []).flatMap((track): KeyframeTrack[] => {
    if (track.property === 'transform.positionX') {
      return [{ ...track, points: track.points.map(p => ({ ...p, value: baseX + p.value })) }]
    }
    if (track.property === 'transform.positionY') {
      return [{ ...track, points: track.points.map(p => ({ ...p, value: baseY + p.value })) }]
    }
    if (track.property === 'transform.scale') {
      return [{ ...track, points: track.points.map(p => ({ ...p, value: (scale * p.value) / 100 })) }]
    }
    if (track.property === 'transform.rotation' || track.property === 'opacity') return [track]
    return []
  })

  return {
    ...clip,
    type: 'image',
    path,
    textStyle: undefined,
    opacity: Math.round(((style.opacity ?? 100) * (clip.opacity ?? 100)) / 100),
    transform: {
      scale,
      positionX: baseX,
      positionY: baseY,
      rotation: clip.transform?.rotation ?? 0,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0,
    },
    keyframes: keyframes.length > 0 ? keyframes : undefined,
  }
}
