import type { Asset, TextOverlayStyle } from '@core/project-model'
import { fontWeightValues } from '@core/project-model'
import type { OverlayBox, OverlayClipboardItem } from '@core/overlay-clipboard'
import type { CoverElement, ImageCoverElement, ShapeCoverElement, TextCoverElement } from './types'

/**
 * Turning what the cover designer holds into what the timeline can paste.
 *
 * The cover is drawn on a 9:16 canvas whose element geometry is all percentages of that
 * canvas, so positions and sizes carry straight over as percentages of the video frame.
 * Text size does not: a cover font size is pixels on the designer's reference canvas, a
 * timeline font size is pixels per 1080 of frame height.
 */

/** Height of the cover canvas a cover font size is measured on (the designer at 65%). */
export const COVER_TEXT_REFERENCE_HEIGHT = 604
/** Width of that same reference canvas. */
const COVER_REFERENCE_WIDTH = 340
/** Height a timeline font size is measured on (see the export's drawtext scaling). */
export const TIMELINE_TEXT_REFERENCE_HEIGHT = 1080
const TEXT_SCALE = TIMELINE_TEXT_REFERENCE_HEIGHT / COVER_TEXT_REFERENCE_HEIGHT

/** The background frame the cover is designed over: never selectable, never copied. */
export function isCoverBackground(el: CoverElement): boolean {
  return el.id === 'background-layer' || el.type === 'background'
}

function boxOf(el: CoverElement): OverlayBox {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

function opacityOf(el: CoverElement): number {
  return Math.round(Math.max(0, Math.min(1, el.opacity ?? 1)) * 100)
}

function fontWeightOf(value: TextCoverElement['fontWeight']): TextOverlayStyle['fontWeight'] {
  const text = String(value ?? 'bold')
  return (fontWeightValues as readonly string[]).includes(text)
    ? text as TextOverlayStyle['fontWeight']
    : 'bold'
}

/** The timeline has no text-transform, so the case the cover showed is written into the text. */
function transformedText(text: string, transform: TextCoverElement['textTransform']): string {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/(^|\s)(\S)/g, (_, space: string, ch: string) => space + ch.toUpperCase())
  return text
}

const scaled = (value: number) => Math.round(value * TEXT_SCALE * 10) / 10

export function coverTextToOverlay(el: TextCoverElement): OverlayClipboardItem {
  const badge = el.backgroundBadge?.enabled ? el.backgroundBadge : undefined
  const shadow = el.shadow?.enabled
    ? el.shadow
    // The designer draws every text with this shadow unless one is set.
    : { color: 'rgba(0,0,0,0.8)', blur: 8, offsetX: 0, offsetY: 2 }
  const stroke = el.stroke?.enabled ? el.stroke : undefined

  return {
    kind: 'text',
    rotation: el.rotation || 0,
    textStyle: {
      text: transformedText(el.text, el.textTransform),
      fontFamily: el.fontFamily || 'Inter, sans-serif',
      fontSize: Math.max(1, Math.round((el.fontSize || 28) * TEXT_SCALE)),
      fontWeight: fontWeightOf(el.fontWeight),
      fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
      color: el.color || '#ffffff',
      backgroundColor: badge?.color ?? (el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'transparent'),
      textAlign: el.textAlign || 'center',
      positionX: el.x,
      positionY: el.y,
      strokeColor: stroke?.color ?? 'transparent',
      strokeWidth: stroke ? scaled(stroke.width) : 0,
      shadowColor: shadow.color,
      shadowBlur: scaled(shadow.blur),
      shadowOffsetX: scaled(shadow.offsetX),
      shadowOffsetY: scaled(shadow.offsetY),
      letterSpacing: el.letterSpacing ? scaled(el.letterSpacing) : 0,
      lineHeight: el.lineHeight || 1.2,
      maxWidth: Math.max(8, Math.min(100, Math.round(el.width))),
      padding: badge ? scaled(Math.max(badge.paddingX, badge.paddingY)) : 0,
      borderRadius: badge ? scaled(badge.borderRadius) : 0,
      opacity: opacityOf(el),
    },
  }
}

export function coverShapeToOverlay(el: ShapeCoverElement): OverlayClipboardItem {
  return {
    kind: 'shape',
    shapeType: el.shapeType,
    shapeProperties: {
      fillColor: el.fillColor,
      strokeColor: el.strokeColor,
      strokeWidth: el.strokeWidth,
      strokeDasharray: el.strokeDasharray,
      sides: el.sides,
      cornerRounding: el.cornerRounding,
    },
    box: boxOf(el),
    rotation: el.rotation || 0,
    opacity: opacityOf(el),
  }
}

/**
 * The image as the cover shows it — cropped, flipped, filtered, corners rounded — drawn
 * into one PNG, so the timeline needs none of the cover's image options.
 */
export async function rasterizeCoverImage(el: ImageCoverElement): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not load the cover image'))
    img.src = el.src
  })
  const natW = img.naturalWidth || 1
  const natH = img.naturalHeight || 1
  const crop = el.crop || { x: 0, y: 0, width: 100, height: 100 }
  const sx = (crop.x / 100) * natW
  const sy = (crop.y / 100) * natH
  const sw = Math.max(1, (crop.width / 100) * natW)
  const sh = Math.max(1, (crop.height / 100) * natH)
  const width = Math.max(1, Math.round(sw))
  const height = Math.max(1, Math.round(sh))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')

  if (el.borderRadius) {
    // The cover rounds in pixels of the element as drawn on its 340px-wide reference
    // canvas; the same fraction of this image's width rounds it the same.
    const drawnWidth = Math.max(1, (el.width / 100) * COVER_REFERENCE_WIDTH)
    const radius = Math.min(width / 2, height / 2, (el.borderRadius / drawnWidth) * width)
    ctx.beginPath()
    ctx.roundRect(0, 0, width, height, radius)
    ctx.clip()
  }
  if (el.filters) {
    const f = el.filters
    ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px) hue-rotate(${f.hue}deg)`
  }
  ctx.translate(el.flipH ? width : 0, el.flipV ? height : 0)
  ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

/** Writes a rasterized image somewhere the timeline can load it from; returns its asset. */
export type CoverImageMaterializer = (image: { dataUrl: string; width: number; height: number; name: string }) => Promise<Asset>

/**
 * The cover elements as clipboard items, lowest first — the order the paste stacks them.
 * The background frame is left out; an image that cannot be written is skipped.
 */
export async function coverElementsToOverlays(
  elements: ReadonlyArray<CoverElement>,
  materializeImage: CoverImageMaterializer,
): Promise<OverlayClipboardItem[]> {
  const ordered = elements
    .filter(el => !isCoverBackground(el) && el.visible !== false)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
  const items: OverlayClipboardItem[] = []
  for (const el of ordered) {
    if (el.type === 'text') items.push(coverTextToOverlay(el))
    else if (el.type === 'shape') items.push(coverShapeToOverlay(el))
    else if (el.type === 'image' && el.src) {
      try {
        const image = await rasterizeCoverImage(el)
        const asset = await materializeImage({ ...image, name: el.name || 'Cover image' })
        items.push({ kind: 'image', asset, box: boxOf(el), rotation: el.rotation || 0, opacity: opacityOf(el) })
      } catch (error) {
        console.warn('[cover] Skipped an image that could not be copied:', error)
      }
    }
  }
  return items
}
