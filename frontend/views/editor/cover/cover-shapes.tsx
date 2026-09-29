import React from 'react'
import type { ShapeCoverElement } from './types'

export interface CoverShapeDef {
  id: string
  name: string
  category: 'line' | 'basic'
  viewBox: string
  defaultWidth: number // percent of canvas width
  defaultHeight: number // percent of canvas height
  defaultFill: string
  defaultStroke?: string
  defaultStrokeWidth?: number
  defaultStrokeDasharray?: string
  defaultSides?: number
  defaultCornerRounding?: number
  renderSvg: (fillColor: string, strokeColor?: string, strokeWidth?: number, sides?: number, cornerRounding?: number) => React.ReactNode
  toSvgMarkup: (fillColor: string, strokeColor?: string, strokeWidth?: number, sides?: number, cornerRounding?: number) => string
}

/**
 * Friendly name for polygons based on sides count
 */
export function getPolygonName(sides: number): string {
  switch (sides) {
    case 3:
      return 'Triangle (3 sides)'
    case 4:
      return 'Quadrilateral (4 sides)'
    case 5:
      return 'Pentagon (5 sides)'
    case 6:
      return 'Hexagon (6 sides)'
    case 7:
      return 'Heptagon (7 sides)'
    case 8:
      return 'Octagon (8 sides)'
    case 9:
      return 'Nonagon (9 sides)'
    case 10:
      return 'Decagon (10 sides)'
    case 11:
      return 'Hendecagon (11 sides)'
    case 12:
      return 'Dodecagon (12 sides)'
    default:
      return `Polygon (${sides} sides)`
  }
}

/**
 * Generates an SVG path for a regular polygon with N sides and smooth corner rounding.
 * Vertices are normalized to fill [1, 99] on the 100x100 canvas, flush with the bounding box border.
 *
 * `width` × `height` draws it for a box of that size instead — stretched to fill it, but
 * with the corners rounded in the box's own units, so every corner comes out symmetric.
 * Rounding in the 100×100 square and stretching afterwards turned them lopsided.
 */
export function generatePolygonPath(
  sides: number = 5,
  cornerRounding: number = 0,
  inset: number = 1,
  width: number = 100,
  height: number = 100,
  /** Stand a four-sided polygon on a vertex — a diamond — instead of an upright square. */
  pointUp: boolean = false,
): string {
  const n = Math.max(3, Math.min(20, Math.round(sides)))
  const rRound = Math.max(0, Math.min(100, cornerRounding)) / 100

  // Vertices starting angle: for n=4 offset by -pi/4 so it forms an upright square with horizontal top/bottom
  const angleOffset = n === 4 && !pointUp ? -Math.PI / 4 : -Math.PI / 2
  const rawVertices: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / n
    rawVertices.push({
      x: Math.cos(angle),
      y: Math.sin(angle),
    })
  }

  // Bounding box of raw unit vertices
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const v of rawVertices) {
    if (v.x < minX) minX = v.x
    if (v.x > maxX) maxX = v.x
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
  }

  const rawWidth = Math.max(0.001, maxX - minX)
  const rawHeight = Math.max(0.001, maxY - minY)

  // Target coordinates: fill [inset, size - inset] on each axis
  const spanX = Math.max(0, width - 2 * Math.max(0, inset))
  const spanY = Math.max(0, height - 2 * Math.max(0, inset))
  const targetMinX = (width - spanX) / 2
  const targetMinY = (height - spanY) / 2

  // Fit vertices so the shape bounds extend right up to the handles/border
  const vertices = rawVertices.map(v => ({
    x: targetMinX + ((v.x - minX) / rawWidth) * spanX,
    y: targetMinY + ((v.y - minY) / rawHeight) * spanY,
  }))

  // Sharp corners if rounding is close to 0
  if (rRound <= 0.005) {
    return `M ${vertices.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' L ')} Z`
  }

  // Find minimum edge length to constrain rounding
  let minEdgeLen = Infinity
  for (let i = 0; i < n; i++) {
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]
    const len = Math.hypot(next.x - curr.x, next.y - curr.y)
    if (len < minEdgeLen) minEdgeLen = len
  }

  // Max rounding distance along edge from each vertex
  const maxD = (minEdgeLen / 2) * 0.96
  const d = rRound * maxD

  const parts: string[] = []

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]

    const inDx = curr.x - prev.x
    const inDy = curr.y - prev.y
    const inLen = Math.hypot(inDx, inDy) || 1
    const uInX = inDx / inLen
    const uInY = inDy / inLen

    const outDx = next.x - curr.x
    const outDy = next.y - curr.y
    const outLen = Math.hypot(outDx, outDy) || 1
    const uOutX = outDx / outLen
    const uOutY = outDy / outLen

    const pStartX = curr.x - d * uInX
    const pStartY = curr.y - d * uInY
    const pEndX = curr.x + d * uOutX
    const pEndY = curr.y + d * uOutY

    if (i === 0) {
      parts.push(`M ${pStartX.toFixed(2)},${pStartY.toFixed(2)}`)
    } else {
      parts.push(`L ${pStartX.toFixed(2)},${pStartY.toFixed(2)}`)
    }

    parts.push(`Q ${curr.x.toFixed(2)},${curr.y.toFixed(2)} ${pEndX.toFixed(2)},${pEndY.toFixed(2)}`)
  }

  parts.push('Z')
  return parts.join(' ')
}

export const COVER_SHAPES: CoverShapeDef[] = [
  // ─── 1. Lines & Arrows ─────────────────────────────────────────────
  {
    id: 'line-solid',
    name: 'Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 4,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <line x1="8" y1="10" x2="92" y2="10" stroke={stroke} strokeWidth={width} strokeLinecap="round" />
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="92" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" />`,
  },
  {
    id: 'line-dashed',
    name: 'Dashed Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 4,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    defaultStrokeDasharray: '8 6',
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <line x1="8" y1="10" x2="92" y2="10" stroke={stroke} strokeWidth={width} strokeDasharray="8 6" strokeLinecap="round" />
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="92" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="8 6" stroke-linecap="round" />`,
  },
  {
    id: 'line-dotted',
    name: 'Dotted Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 4,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    defaultStrokeDasharray: '3 4',
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <line x1="8" y1="10" x2="92" y2="10" stroke={stroke} strokeWidth={width} strokeDasharray="3 4" strokeLinecap="round" />
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="92" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="3 4" stroke-linecap="round" />`,
  },
  {
    id: 'arrow-right',
    name: 'Arrow',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="8" y1="10" x2="86" y2="10" stroke={stroke} strokeWidth={width} strokeLinecap="round" />
        <polyline points="76,4 88,10 76,16" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="86" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" /><polyline points="76,4 88,10 76,16" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`,
  },
  {
    id: 'arrow-right-filled',
    name: 'Arrow (Filled)',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: '#a1a1aa',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="8" y1="10" x2="80" y2="10" stroke={stroke} strokeWidth={width} strokeLinecap="round" />
        <polygon points="78,3 93,10 78,17" fill={fill} />
      </g>
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="80" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" /><polygon points="78,3 93,10 78,17" fill="${fill}" />`,
  },
  {
    id: 'arrow-right-dotted',
    name: 'Dotted Arrow',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="8" y1="10" x2="84" y2="10" stroke={stroke} strokeWidth={width} strokeDasharray="3 4" strokeLinecap="round" />
        <polyline points="74,4 86,10 74,16" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="8" y1="10" x2="84" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="3 4" stroke-linecap="round" /><polyline points="74,4 86,10 74,16" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`,
  },
  {
    id: 'arrow-bidirectional',
    name: 'Double Arrow',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="16" y1="10" x2="84" y2="10" stroke={stroke} strokeWidth={width} />
        <polyline points="24,4 12,10 24,16" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="76,4 88,10 76,16" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="16" y1="10" x2="84" y2="10" stroke="${stroke}" stroke-width="${width}" /><polyline points="24,4 12,10 24,16" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" /><polyline points="76,4 88,10 76,16" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`,
  },
  {
    id: 'arrow-bidirectional-filled-dotted',
    name: 'Double Filled Dotted Arrow',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: '#a1a1aa',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="22" y1="10" x2="78" y2="10" stroke={stroke} strokeWidth={width} strokeDasharray="3 4" />
        <polygon points="22,3 7,10 22,17" fill={fill} />
        <polygon points="78,3 93,10 78,17" fill={fill} />
      </g>
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) =>
      `<line x1="22" y1="10" x2="78" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="3 4" /><polygon points="22,3 7,10 22,17" fill="${fill}" /><polygon points="78,3 93,10 78,17" fill="${fill}" />`,
  },
  {
    id: 'line-tee',
    name: 'Tee Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="12" y1="10" x2="88" y2="10" stroke={stroke} strokeWidth={width} />
        <line x1="12" y1="3" x2="12" y2="17" stroke={stroke} strokeWidth={width} strokeLinecap="round" />
        <line x1="88" y1="3" x2="88" y2="17" stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="12" y1="10" x2="88" y2="10" stroke="${stroke}" stroke-width="${width}" /><line x1="12" y1="3" x2="12" y2="17" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" /><line x1="88" y1="3" x2="88" y2="17" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" />`,
  },
  {
    id: 'line-circle-ends',
    name: 'Circle Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: '#a1a1aa',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="18" y1="10" x2="82" y2="10" stroke={stroke} strokeWidth={width} />
        <circle cx="14" cy="10" r="5" fill={fill} />
        <circle cx="86" cy="10" r="5" fill={fill} />
      </g>
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) =>
      `<line x1="18" y1="10" x2="82" y2="10" stroke="${stroke}" stroke-width="${width}" /><circle cx="14" cy="10" r="5" fill="${fill}" /><circle cx="86" cy="10" r="5" fill="${fill}" />`,
  },
  {
    id: 'line-square-ends',
    name: 'Square Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: '#a1a1aa',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="18" y1="10" x2="82" y2="10" stroke={stroke} strokeWidth={width} />
        <rect x="9" y="5" width="10" height="10" rx="1.5" fill={fill} />
        <rect x="81" y="5" width="10" height="10" rx="1.5" fill={fill} />
      </g>
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) =>
      `<line x1="18" y1="10" x2="82" y2="10" stroke="${stroke}" stroke-width="${width}" /><rect x="9" y="5" width="10" height="10" rx="1.5" fill="${fill}" /><rect x="81" y="5" width="10" height="10" rx="1.5" fill="${fill}" />`,
  },
  {
    id: 'line-diamond-ends',
    name: 'Diamond Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: '#a1a1aa',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="20" y1="10" x2="80" y2="10" stroke={stroke} strokeWidth={width} />
        <polygon points="12,10 18,4 24,10 18,16" fill={fill} />
        <polygon points="76,10 82,4 88,10 82,16" fill={fill} />
      </g>
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke = '#a1a1aa', width = 3) =>
      `<line x1="20" y1="10" x2="80" y2="10" stroke="${stroke}" stroke-width="${width}" /><polygon points="12,10 18,4 24,10 18,16" fill="${fill}" /><polygon points="76,10 82,4 88,10 82,16" fill="${fill}" />`,
  },
  {
    id: 'line-hollow-circle',
    name: 'Hollow Circle Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="20" y1="10" x2="80" y2="10" stroke={stroke} strokeWidth={width} />
        <circle cx="14" cy="10" r="5" fill="none" stroke={stroke} strokeWidth={2.5} />
        <circle cx="86" cy="10" r="5" fill="none" stroke={stroke} strokeWidth={2.5} />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="20" y1="10" x2="80" y2="10" stroke="${stroke}" stroke-width="${width}" /><circle cx="14" cy="10" r="5" fill="none" stroke="${stroke}" stroke-width="2.5" /><circle cx="86" cy="10" r="5" fill="none" stroke="${stroke}" stroke-width="2.5" />`,
  },
  {
    id: 'line-hollow-square',
    name: 'Hollow Square Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="20" y1="10" x2="80" y2="10" stroke={stroke} strokeWidth={width} />
        <rect x="9" y="5" width="10" height="10" rx="1.5" fill="none" stroke={stroke} strokeWidth={2.5} />
        <rect x="81" y="5" width="10" height="10" rx="1.5" fill="none" stroke={stroke} strokeWidth={2.5} />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="20" y1="10" x2="80" y2="10" stroke="${stroke}" stroke-width="${width}" /><rect x="9" y="5" width="10" height="10" rx="1.5" fill="none" stroke="${stroke}" stroke-width="2.5" /><rect x="81" y="5" width="10" height="10" rx="1.5" fill="none" stroke="${stroke}" stroke-width="2.5" />`,
  },
  {
    id: 'line-hollow-diamond',
    name: 'Hollow Diamond Ends Line',
    category: 'line',
    viewBox: '0 0 100 20',
    defaultWidth: 45,
    defaultHeight: 5,
    defaultFill: 'transparent',
    defaultStroke: '#a1a1aa',
    defaultStrokeWidth: 3,
    renderSvg: (_fill, stroke = '#a1a1aa', width = 3) => (
      <g>
        <line x1="22" y1="10" x2="78" y2="10" stroke={stroke} strokeWidth={width} />
        <polygon points="12,10 18,4 24,10 18,16" fill="none" stroke={stroke} strokeWidth={2.5} />
        <polygon points="76,10 82,4 88,10 82,16" fill="none" stroke={stroke} strokeWidth={2.5} />
      </g>
    ),
    toSvgMarkup: (_fill, stroke = '#a1a1aa', width = 3) =>
      `<line x1="22" y1="10" x2="78" y2="10" stroke="${stroke}" stroke-width="${width}" /><polygon points="12,10 18,4 24,10 18,16" fill="none" stroke="${stroke}" stroke-width="2.5" /><polygon points="76,10 82,4 88,10 82,16" fill="none" stroke="${stroke}" stroke-width="2.5" />`,
  },

  // ─── 2. Basic Geometric Shapes ──────────────────────────────────────
  {
    id: 'square',
    name: 'Square',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 30,
    defaultHeight: 17,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <rect x="1" y="1" width="98" height="98" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<rect x="1" y="1" width="98" height="98" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} />`,
  },
  {
    id: 'rounded-rect',
    name: 'Rounded Rectangle',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 30,
    defaultHeight: 17,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <rect x="1" y="1" width="98" height="98" rx="20" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<rect x="1" y="1" width="98" height="98" rx="20" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} />`,
  },
  {
    id: 'circle',
    name: 'Circle',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 30,
    defaultHeight: 17,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <circle cx="50" cy="50" r="49" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<circle cx="50" cy="50" r="49" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} />`,
  },
  {
    id: 'polygon',
    name: 'Polygon',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    defaultSides: 5,
    defaultCornerRounding: 0,
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth, sides = 5, cornerRounding = 0) => (
      <path
        d={generatePolygonPath(sides, cornerRounding)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth, sides = 5, cornerRounding = 0) =>
      `<path d="${generatePolygonPath(sides, cornerRounding)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'triangle',
    name: 'Triangle',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    defaultSides: 3,
    defaultCornerRounding: 0,
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth, sides = 3, cornerRounding = 0) => (
      <path
        d={generatePolygonPath(sides, cornerRounding)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth, sides = 3, cornerRounding = 0) =>
      `<path d="${generatePolygonPath(sides, cornerRounding)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'triangle-down',
    name: 'Inverted Triangle',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <polygon points="50,99 99,1 1,1" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<polygon points="50,99 99,1 1,1" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'pentagon',
    name: 'Pentagon',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    defaultSides: 5,
    defaultCornerRounding: 0,
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth, sides = 5, cornerRounding = 0) => (
      <path
        d={generatePolygonPath(sides, cornerRounding)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth, sides = 5, cornerRounding = 0) =>
      `<path d="${generatePolygonPath(sides, cornerRounding)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'diamond',
    name: 'Diamond',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <polygon points="50,1 99,50 50,99 1,50" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<polygon points="50,1 99,50 50,99 1,50" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'star',
    name: 'Star',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <polygon
        points="50,1 64.7,35 99,37.6 72.1,62.3 80.6,99 50,80.7 19.4,99 27.9,62.3 1,37.6 35.3,35"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<polygon points="50,1 64.7,35 99,37.6 72.1,62.3 80.6,99 50,80.7 19.4,99 27.9,62.3 1,37.6 35.3,35" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'heart',
    name: 'Heart',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth) => (
      <path
        d="M50,99 C50,99 1,66.5 1,31.5 C1,12.5 15.5,1 32.8,1 C41.3,1 47.1,6.4 50,11.9 C52.9,6.4 58.7,1 67.2,1 C84.5,1 99,12.5 99,31.5 C99,66.5 50,99 50,99 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth) =>
      `<path d="M50,99 C50,99 1,66.5 1,31.5 C1,12.5 15.5,1 32.8,1 C41.3,1 47.1,6.4 50,11.9 C52.9,6.4 58.7,1 67.2,1 C84.5,1 99,12.5 99,31.5 C99,66.5 50,99 50,99 Z" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    defaultSides: 6,
    defaultCornerRounding: 0,
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth, sides = 6, cornerRounding = 0) => (
      <path
        d={generatePolygonPath(sides, cornerRounding)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth, sides = 6, cornerRounding = 0) =>
      `<path d="${generatePolygonPath(sides, cornerRounding)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
  {
    id: 'octagon',
    name: 'Octagon',
    category: 'basic',
    viewBox: '0 0 100 100',
    defaultWidth: 25,
    defaultHeight: 25,
    defaultFill: '#a1a1aa',
    defaultSides: 8,
    defaultCornerRounding: 0,
    renderSvg: (fill = '#a1a1aa', stroke, strokeWidth, sides = 8, cornerRounding = 0) => (
      <path
        d={generatePolygonPath(sides, cornerRounding)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    ),
    toSvgMarkup: (fill = '#a1a1aa', stroke, strokeWidth, sides = 8, cornerRounding = 0) =>
      `<path d="${generatePolygonPath(sides, cornerRounding)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth || 2}"` : ''} stroke-linejoin="round" />`,
  },
]

export const SHAPE_MAP = new Map<string, CoverShapeDef>(
  COVER_SHAPES.map(shape => [shape.id, shape])
)

/**
 * Render Shape in React
 */
export const ShapeSvgRenderer: React.FC<{
  shape: ShapeCoverElement
  className?: string
  widthPx?: number
  heightPx?: number
}> = ({ shape, className = 'w-full h-full', widthPx, heightPx }) => {
  const def = SHAPE_MAP.get(shape.shapeType) || COVER_SHAPES[0]
  const isLine = def.category === 'line'

  // If square or rounded-rect (or 4-sided polygon): render with real widthPx and heightPx so it stretches into a rectangle
  if (shape.shapeType === 'square' || shape.shapeType === 'rounded-rect' || (shape.shapeType === 'polygon' && shape.sides === 4)) {
    const w = widthPx && widthPx > 0 ? widthPx : 100
    const h = heightPx && heightPx > 0 ? heightPx : 100
    const maxR = Math.min(w, h) / 2
    const rPercent = shape.cornerRounding ?? (shape.shapeType === 'rounded-rect' ? 24 : 0)
    const rx = Math.max(0, Math.min(maxR, (rPercent / 100) * maxR))
    const sw = shape.strokeWidth || 0

    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className={className}
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        <rect
          x={sw / 2}
          y={sw / 2}
          width={Math.max(1, w - sw)}
          height={Math.max(1, h - sw)}
          rx={rx}
          ry={rx}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={shape.strokeDasharray}
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  // If shape is a regular polygon or polygon-capable
  const isPolygon =
    shape.shapeType === 'polygon' ||
    shape.shapeType === 'triangle' ||
    shape.shapeType === 'pentagon' ||
    shape.shapeType === 'hexagon' ||
    shape.shapeType === 'octagon' ||
    shape.sides !== undefined

  if (isPolygon) {
    const defaultSides =
      shape.shapeType === 'triangle'
        ? 3
        : shape.shapeType === 'hexagon'
        ? 6
        : shape.shapeType === 'octagon'
        ? 8
        : 5
    const sides = shape.sides ?? defaultSides
    const cornerRounding = shape.cornerRounding ?? 0
    const d = generatePolygonPath(sides, cornerRounding)
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={className}
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        <path
          d={d}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={shape.strokeDasharray}
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox={def.viewBox}
      preserveAspectRatio={isLine ? 'none' : 'xMidYMid meet'}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {def.renderSvg(shape.fillColor, shape.strokeColor, shape.strokeWidth, shape.sides, shape.cornerRounding)}
    </svg>
  )
}

/**
 * Convert a shape to full SVG string for Canvas drawing
 */
export function shapeToFullSvgString(shape: ShapeCoverElement, widthPx: number, heightPx: number): string {
  const def = SHAPE_MAP.get(shape.shapeType) || COVER_SHAPES[0]
  const isLine = def.category === 'line'
  const strokeAttr = shape.strokeColor ? `stroke="${shape.strokeColor}" stroke-width="${shape.strokeWidth || 2}"` : ''
  const dashAttr = shape.strokeDasharray ? `stroke-dasharray="${shape.strokeDasharray}"` : ''

  if (shape.shapeType === 'square' || shape.shapeType === 'rounded-rect' || (shape.shapeType === 'polygon' && shape.sides === 4)) {
    const w = widthPx
    const h = heightPx
    const maxR = Math.min(w, h) / 2
    const rPercent = shape.cornerRounding ?? (shape.shapeType === 'rounded-rect' ? 24 : 0)
    const rx = Math.max(0, Math.min(maxR, (rPercent / 100) * maxR))
    const sw = shape.strokeWidth || 0
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}" style="overflow:visible"><rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(1, w - sw)}" height="${Math.max(1, h - sw)}" rx="${rx}" ry="${rx}" fill="${shape.fillColor}" ${strokeAttr} ${dashAttr} stroke-linejoin="round" /></svg>`
  }

  const isPolygon =
    shape.shapeType === 'polygon' ||
    shape.shapeType === 'triangle' ||
    shape.shapeType === 'pentagon' ||
    shape.shapeType === 'hexagon' ||
    shape.shapeType === 'octagon' ||
    shape.sides !== undefined

  if (isPolygon) {
    const defaultSides =
      shape.shapeType === 'triangle'
        ? 3
        : shape.shapeType === 'hexagon'
        ? 6
        : shape.shapeType === 'octagon'
        ? 8
        : 5
    const sides = shape.sides ?? defaultSides
    const cornerRounding = shape.cornerRounding ?? 0
    const d = generatePolygonPath(sides, cornerRounding)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="${widthPx}" height="${heightPx}" style="overflow:visible"><path d="${d}" fill="${shape.fillColor}" ${strokeAttr} ${dashAttr} stroke-linejoin="round" /></svg>`
  }

  const innerMarkup = def.toSvgMarkup(shape.fillColor, shape.strokeColor, shape.strokeWidth, shape.sides, shape.cornerRounding)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}" preserveAspectRatio="${isLine ? 'none' : 'xMidYMid meet'}" width="${widthPx}" height="${heightPx}" style="overflow:visible">${innerMarkup}</svg>`
}
