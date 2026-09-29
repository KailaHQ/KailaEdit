import type { TimelineClip } from '../../types/project-model'
import {
  COVER_SHAPES,
  SHAPE_MAP,
  generatePolygonPath,
  shapeToFullSvgString,
  type CoverShapeDef,
} from './cover/cover-shapes'
import type { ShapeCoverElement } from './cover/types'

/**
 * Checks if a timeline clip is a shape clip (added from ShapesLibrary or has shapeProperties)
 */
export function isTimelineShapeClip(clip?: TimelineClip | null): boolean {
  if (!clip) return false
  return Boolean(clip.stickerId?.startsWith('shape-') || clip.shapeProperties)
}

/**
 * Returns the shape ID and CoverShapeDef for a clip
 */
export function getShapeDefinitionForClip(clip: TimelineClip): {
  shapeType: string
  shapeDef?: CoverShapeDef
} {
  const shapeType = clip.stickerId?.replace(/^shape-/, '') || 'square'
  const shapeDef = SHAPE_MAP.get(shapeType) || COVER_SHAPES.find(s => s.id === shapeType)
  return { shapeType, shapeDef }
}

/** Shapes drawn as a regular polygon (generatePolygonPath), with a side count. */
const POLYGON_SHAPES = new Set(['polygon', 'triangle', 'pentagon', 'hexagon', 'octagon'])

/** Shapes drawn as a rectangle, whose corner rounding must stay circular at any size. */
function isRectShape(shapeType: string, sides: number | undefined): boolean {
  return shapeType === 'square' || shapeType === 'rounded-rect' || (shapeType === 'polygon' && sides === 4)
}

/**
 * Width over height of the box a shape clip is shown in.
 *
 * A shape is a square image (its sticker asset is 512×512), fitted into the frame and then
 * scaled by `scaleX` × `scaleY` — by CSS in the preview, by the filtergraph on export. The
 * box it ends up in therefore has exactly this aspect.
 */
export function shapeBoxAspect(transform: TimelineClip['transform'] | undefined): number {
  const scale = transform?.scale ?? 100
  const sx = Math.max(1e-3, transform?.scaleX ?? scale)
  const sy = Math.max(1e-3, transform?.scaleY ?? scale)
  // Rounded so that small jitter in a drag does not produce a new image every frame.
  return Math.round((sx / sy) * 1000) / 1000
}

/**
 * Generate full SVG string for a timeline shape clip with all custom properties applied.
 *
 * The image is always `widthPx × heightPx` (square), because every pipeline fits it as a
 * square and then stretches it by the clip's scaleX / scaleY. Drawing a rectangle straight
 * into that square let the stretch squash its corners into uneven ellipses and thin its
 * stroke on one axis. So a rectangle is drawn in the coordinates of the box it will
 * finally fill — `aspect : 1` — and mapped into the square with a non-uniform viewBox.
 * The stretch then undoes that mapping exactly: corners come out round, strokes even.
 */
export function timelineShapeToSvgString(
  clip: TimelineClip,
  widthPx = 512,
  heightPx = 512,
  transform: TimelineClip['transform'] | undefined = clip.transform,
): string {
  const { shapeType, shapeDef } = getShapeDefinitionForClip(clip)
  const isLine = Boolean(
    shapeDef?.category === 'line' ||
    shapeType.startsWith('line') ||
    shapeType.startsWith('arrow')
  )
  const props = clip.shapeProperties || {}

  const defaultSides =
    shapeType === 'triangle' ? 3 :
    shapeType === 'square' || shapeType === 'rounded-rect' ? 4 :
    shapeType === 'pentagon' ? 5 :
    shapeType === 'hexagon' ? 6 :
    shapeType === 'octagon' ? 8 : 4

  // Only shapes that ARE polygons have sides. Handing every shape a side count sent
  // circles, stars, hearts, lines and arrows down the polygon branch of the drawing code,
  // and with the default of 4 each of them came out as a plain square.
  const hasSides = POLYGON_SHAPES.has(shapeType) || shapeType === 'square' || shapeType === 'rounded-rect'
  const sides = hasSides ? (props.sides ?? shapeDef?.defaultSides ?? defaultSides) : undefined
  const cornerRounding =
    props.cornerRounding ??
    shapeDef?.defaultCornerRounding ??
    (shapeType === 'rounded-rect' ? 24 : 0)
  const fillColor = props.fillColor ?? shapeDef?.defaultFill ?? (isLine ? 'transparent' : '#3b82f6')
  const strokeColor = props.strokeColor ?? shapeDef?.defaultStroke ?? (isLine ? '#ffffff' : undefined)
  const strokeWidth =
    props.strokeWidth !== undefined
      ? props.strokeWidth
      : (shapeDef?.defaultStrokeWidth ?? (isLine ? 4 : 0))
  const strokeDasharray = props.strokeDasharray ?? shapeDef?.defaultStrokeDasharray

  // Create temporary shape element matching ShapeCoverElement interface
  const shapeElem: ShapeCoverElement = {
    id: clip.id,
    type: 'shape',
    name: clip.importedName || 'Shape',
    shapeType:
      sides && sides !== 4 && (shapeType === 'square' || shapeType === 'polygon')
        ? 'polygon'
        : (shapeType as any),
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fillColor,
    strokeColor: strokeWidth > 0 ? (strokeColor || '#ffffff') : undefined,
    strokeWidth,
    strokeDasharray,
    cornerRounding,
    sides,
    rotation: 0,
    zIndex: 1,
    opacity: 1, // Opacity is handled at clip level by video editor pipeline
  }

  const isRect = isRectShape(shapeElem.shapeType, sides)
  // A diamond is a four-sided polygon on its vertex. Drawn as one it can be rounded too —
  // its own markup ignored the Corners control the panel offers for it.
  const isDiamond = shapeElem.shapeType === 'diamond'
  const isPolygon = !isRect && (POLYGON_SHAPES.has(shapeElem.shapeType) || isDiamond)
  if (!isRect && !isPolygon) {
    return shapeToFullSvgString(shapeElem, widthPx, heightPx)
  }

  // Box-space size: the longer side keeps the image's resolution.
  const aspect = shapeBoxAspect(transform) * (widthPx / heightPx)
  const boxW = Number((aspect >= 1 ? widthPx : widthPx * aspect).toFixed(2))
  const boxH = Number((aspect >= 1 ? widthPx / aspect : widthPx).toFixed(2))

  if (isRect) {
    const svg = shapeToFullSvgString(shapeElem, boxW, boxH)
    // Keep the viewBox (box space, preserveAspectRatio="none"); present it at the square size.
    return svg.replace(/ width="[^"]*" height="[^"]*"/, ` width="${widthPx}" height="${heightPx}"`)
  }

  // A polygon is specified on a 100×100 canvas — its inset, stroke width and dashes are in
  // those units. Drawn for the box, one of those units is a hundredth of its long side,
  // which is exactly what it was before on the square.
  const unit = Math.max(boxW, boxH) / 100
  const d = generatePolygonPath(isDiamond ? 4 : (sides ?? 5), cornerRounding, 1 * unit, boxW, boxH, isDiamond)
  const strokeAttr = shapeElem.strokeColor
    ? `stroke="${shapeElem.strokeColor}" stroke-width="${Number(((shapeElem.strokeWidth || 2) * unit).toFixed(3))}"`
    : ''
  const dashAttr = shapeElem.strokeDasharray
    ? `stroke-dasharray="${shapeElem.strokeDasharray.split(/[\s,]+/).filter(Boolean).map(v => Number((Number(v) * unit).toFixed(3))).join(' ')}"`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boxW} ${boxH}" preserveAspectRatio="none" width="${widthPx}" height="${heightPx}" style="overflow:visible"><path d="${d}" fill="${shapeElem.fillColor}" ${strokeAttr} ${dashAttr} stroke-linejoin="round" /></svg>`
}

/**
 * Returns a data:image/svg+xml URI for immediate rendering in <img> tags.
 * `transform` overrides the clip's own, for a transform still being dragged.
 */
export function timelineShapeToDataUrl(clip: TimelineClip, transform?: TimelineClip['transform']): string {
  const svg = timelineShapeToSvgString(clip, 512, 512, transform ?? clip.transform)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Rasterizes shape SVG to a high-resolution PNG base64 string using an offscreen canvas
 */
export async function rasterizeShapeClipToPngBase64(
  clip: TimelineClip,
  width = 1024,
  height = 1024
): Promise<string> {
  const svg = timelineShapeToSvgString(clip, width, height)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'))
          return
        }
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        resolve(base64)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = (e) => reject(new Error('Failed to load SVG for rasterization: ' + e))
    img.src = svgDataUrl
  })
}
