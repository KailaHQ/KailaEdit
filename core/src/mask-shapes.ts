/**
 * The outlines of the mask shapes that are not a plain box: the star and the heart.
 *
 * Both are described once, in a unit box that is then stretched to the mask's width and height,
 * so the preview (an SVG polygon) and the export (an expression ffmpeg evaluates per pixel)
 * cut the same shape. Coordinates run -1..1 across the mask's box, y pointing down.
 */

/** How far the star's inner points sit from the centre, against its outer points. */
export const STAR_INNER_RATIO = 0.382
const STAR_POINTS = 5

type Point = readonly [number, number]

function boundsOf(points: readonly Point[]) {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** The star's corners with a point straight up, as drawn before being fitted to the box. */
function rawStarPoints(): Point[] {
  const points: Point[] = []
  for (let i = 0; i < STAR_POINTS * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / STAR_POINTS
    const radius = i % 2 === 0 ? 1 : STAR_INNER_RATIO
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  return points
}

const rawStar = rawStarPoints()
const starBounds = boundsOf(rawStar)

/** Where the raw star's box sits: its half-size and centre, used to fit it to -1..1 and back. */
export const STAR_BOX = {
  halfWidth: (starBounds.maxX - starBounds.minX) / 2,
  halfHeight: (starBounds.maxY - starBounds.minY) / 2,
  centerX: (starBounds.maxX + starBounds.minX) / 2,
  centerY: (starBounds.maxY + starBounds.minY) / 2,
}

/** The star's corners fitted to the -1..1 box. */
export function starOutline(): Point[] {
  return rawStar.map(([x, y]) => [
    (x - STAR_BOX.centerX) / STAR_BOX.halfWidth,
    (y - STAR_BOX.centerY) / STAR_BOX.halfHeight,
  ])
}

/**
 * The star's edge as ffmpeg needs it. Inside one fifth of a turn the edge is a straight line from
 * an outer point to the next inner point, so the edge's distance from the centre at an angle
 * `phi` off the outer point is `distance / cos(phi - tilt)`.
 */
export const STAR_EDGE = (() => {
  const tip: Point = [1, 0]
  const valleyAngle = Math.PI / STAR_POINTS
  const valley: Point = [Math.cos(valleyAngle) * STAR_INNER_RATIO, Math.sin(valleyAngle) * STAR_INNER_RATIO]
  const dx = valley[0] - tip[0]
  const dy = valley[1] - tip[1]
  const length = Math.hypot(dx, dy)
  // Unit normal of the edge, pointing away from the centre, and the edge's distance from the centre.
  let nx = dy / length
  let ny = -dx / length
  let distance = nx * tip[0] + ny * tip[1]
  if (distance < 0) { nx = -nx; ny = -ny; distance = -distance }
  return { distance, tilt: Math.atan2(ny, nx), sector: (2 * Math.PI) / STAR_POINTS }
})()

/** Positive inside the heart: the classic implicit curve, fitted by the constants below. */
function heartField(x: number, y: number): number {
  const sum = x * x + y * y - 1
  return x * x * y * y * y - sum * sum * sum
}

/** Distance from the origin to the heart's edge along an angle (y pointing up). */
function heartEdgeAt(angle: number): number {
  let inside = 0
  let outside = 3
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let i = 0; i < 40; i += 1) {
    const mid = (inside + outside) / 2
    if (heartField(cos * mid, sin * mid) >= 0) inside = mid
    else outside = mid
  }
  return inside
}

const rawHeart: Point[] = (() => {
  const points: Point[] = []
  const steps = 96
  for (let i = 0; i < steps; i += 1) {
    const angle = (i * 2 * Math.PI) / steps
    const edge = heartEdgeAt(angle)
    // y flips: the field has the lobes up, the screen counts down.
    points.push([Math.cos(angle) * edge, -Math.sin(angle) * edge])
  }
  return points
})()
const heartBounds = boundsOf(rawHeart)

/** Where the raw heart's box sits, as for the star. */
export const HEART_BOX = {
  halfWidth: (heartBounds.maxX - heartBounds.minX) / 2,
  halfHeight: (heartBounds.maxY - heartBounds.minY) / 2,
  centerX: (heartBounds.maxX + heartBounds.minX) / 2,
  centerY: (heartBounds.maxY + heartBounds.minY) / 2,
}

/** The heart's edge fitted to the -1..1 box. */
export function heartOutline(): Point[] {
  return rawHeart.map(([x, y]) => [
    (x - HEART_BOX.centerX) / HEART_BOX.halfWidth,
    (y - HEART_BOX.centerY) / HEART_BOX.halfHeight,
  ])
}

/** Shapes drawn inside their width and height, which look right only when those are equal on screen. */
export const PROPORTIONAL_MASK_SHAPES = ['rectangle', 'ellipse', 'star', 'heart'] as const

/**
 * The size, as percentages of the picture, a new mask of this shape starts with.
 *
 * A mask's width and height are fractions of the picture's own width and height, so equal
 * percentages are only equal on screen for a square picture: 50% x 50% of a 9:16 picture is a
 * tall oval, not a circle. The closed shapes therefore start as a square on screen, half the
 * picture's shorter side across (540 px on a 1080 x 1920 picture). The split line and the
 * filmstrip band keep the old 50 and 50, which they only use for position and thickness.
 *
 * `aspect` is the picture's width over its height.
 */
export function defaultMaskSize(shape: string, aspect: number): { width: number; height: number } {
  const closed = (PROPORTIONAL_MASK_SHAPES as readonly string[]).includes(shape)
  if (!closed || !Number.isFinite(aspect) || aspect <= 0) return { width: 50, height: 50 }
  return aspect >= 1
    ? { width: 50 / aspect, height: 50 }
    : { width: 50, height: 50 * aspect }
}
