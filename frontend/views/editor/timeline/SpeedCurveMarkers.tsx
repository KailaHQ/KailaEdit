import { useMemo } from 'react'
import {
  clipHasSpeedCurve,
  clipSourceSpan,
  clipTimeAtSourceOffset,
} from '@core/speed-curve'
import { formatClipSpeed } from '@core/clip-speed'
import type { TimelineClip } from '../../../types/project-model'

export interface SpeedCurveMarkersProps {
  clip: TimelineClip
  /** Width the clip box is drawn at. */
  clipWidthPx: number
}

const INK = '#ffffff'
/** The strip along the clip's top edge; bars are a little taller than it. */
const BAND_HEIGHT = 16
const LINE_Y = BAND_HEIGHT / 2
/** Arrows closer than this would read as a solid line. */
const MIN_ARROW_GAP_PX = 9
/** Roughly how far apart arrows sit while the clip plays at its mean speed. */
const TARGET_ARROW_GAP_PX = 18
/** Arrows and dots keep this far from a bar. */
const BAR_CLEARANCE_PX = 7
const ARROW_HALF_HEIGHT = 2.75
const ARROW_HALF_WIDTH = 2.25
const DOT_RADIUS = 1.6
const ARROW_STROKE = 1.2
/** Width of the bar that marks a curve point. */
const BAR_WIDTH = 3

interface Marker {
  x: number
  v: number
  isEnd: boolean
}

/**
 * Where the speed curve's points fall on the clip, drawn along its top edge.
 *
 * A bar marks each curve point at the timeline position where the footage it
 * names is shown, and arrows run between them at equal steps of footage — so
 * they bunch up where the clip plays fast and spread out where it plays slow,
 * which is how the shape of the curve reads without opening the Speed tab.
 */
export function SpeedCurveMarkers({ clip, clipWidthPx }: SpeedCurveMarkersProps) {
  const curve = clip.speedCurve
  const geometry = useMemo(() => {
    if (!curve || !clipHasSpeedCurve(clip) || clip.duration <= 0 || clipWidthPx <= 0) return null
    const span = clipSourceSpan(clip)
    if (span <= 0) return null
    const toPx = (sourceOffset: number) =>
      Math.min(clipWidthPx, Math.max(0, (clipTimeAtSourceOffset(clip, sourceOffset) / clip.duration) * clipWidthPx))

    const markers: Marker[] = curve.points.map((point, index) => ({
      x: toPx(point.x * span),
      v: point.v,
      isEnd: index === 0 || index === curve.points.length - 1,
    }))

    // Equal steps of footage, sized so a clip at its mean speed gets arrows
    // TARGET_ARROW_GAP_PX apart.
    const steps = Math.max(2, Math.round(clipWidthPx / TARGET_ARROW_GAP_PX))
    const arrows: number[] = []
    let last = -Infinity
    for (let i = 1; i < steps; i++) {
      const x = toPx((span * (i - 0.5)) / steps)
      if (x - last < MIN_ARROW_GAP_PX) continue
      if (markers.some(m => Math.abs(m.x - x) < BAR_CLEARANCE_PX + 2)) continue
      arrows.push(x)
      last = x
    }
    // A dot sits just inside each bar, on the side that faces the stretch of
    // arrows it borders, like the editor this mirrors.
    const dots: number[] = []
    markers.forEach((marker, index) => {
      const prev = markers[index - 1]
      const next = markers[index + 1]
      if (next && next.x - marker.x > BAR_CLEARANCE_PX * 3) dots.push(marker.x + BAR_CLEARANCE_PX)
      if (prev && marker.x - prev.x > BAR_CLEARANCE_PX * 3) dots.push(marker.x - BAR_CLEARANCE_PX)
    })
    return { markers, arrows, dots }
    // `clip` as a whole is not a dependency: only what the geometry reads is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, clip.duration, clip.speed, clipWidthPx])

  if (!geometry) return null

  return (
    <svg
      data-speed-curve-markers
      className="absolute left-0 top-0 z-10 pointer-events-none overflow-visible"
      style={{ width: `${clipWidthPx}px`, height: `${BAND_HEIGHT}px` }}
    >
      <rect x={0} y={0} width={clipWidthPx} height={BAND_HEIGHT} fill="#0d4651" opacity={0.96} />
      <g fill={INK}>
        {geometry.dots.map((x, index) => (
          <circle key={`d${index}`} cx={x} cy={LINE_Y} r={DOT_RADIUS} opacity={0.9} />
        ))}
      </g>
      {/* Chevrons, drawn as strokes: the tip is the second point. */}
      <g fill="none" stroke={INK} strokeWidth={ARROW_STROKE} strokeLinecap="round" strokeLinejoin="round">
        {geometry.arrows.map(x => (
          <polyline
            key={x}
            data-speed-curve-arrow
            points={`${x - ARROW_HALF_WIDTH},${LINE_Y - ARROW_HALF_HEIGHT} ${x},${LINE_Y} ${x - ARROW_HALF_WIDTH},${LINE_Y + ARROW_HALF_HEIGHT}`}
            opacity={0.95}
          />
        ))}
      </g>
      {geometry.markers.map((marker, index) => {
        // End bars sit inside the clip's edge so they are not clipped by it.
        const x = marker.isEnd ? Math.min(clipWidthPx - BAR_WIDTH / 2, Math.max(BAR_WIDTH / 2, marker.x)) : marker.x
        return (
          <g key={index} data-speed-curve-marker={index}>
            <title>{formatClipSpeed(marker.v)}</title>
            <rect x={x - BAR_WIDTH / 2} y={1} width={BAR_WIDTH} height={BAND_HEIGHT - 2} rx={BAR_WIDTH / 2} fill={INK} />
          </g>
        )
      })}
    </svg>
  )
}
