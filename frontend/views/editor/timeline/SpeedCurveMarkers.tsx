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

const INK = 'rgba(255, 255, 255, 0.92)'
const BAND_HEIGHT = 14
const LINE_Y = BAND_HEIGHT / 2
/** Arrows closer than this would read as a solid line. */
const MIN_ARROW_GAP_PX = 6
/** Roughly how far apart arrows sit while the clip plays at its mean speed. */
const TARGET_ARROW_GAP_PX = 16
const HEAD = 2.25

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
      if (markers.some(m => Math.abs(m.x - x) < 5)) continue
      arrows.push(x)
      last = x
    }
    return { markers, arrows }
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
      <line x1={0} x2={clipWidthPx} y1={LINE_Y} y2={LINE_Y} stroke={INK} strokeWidth={1} opacity={0.55} />
      <g fill="none" stroke={INK} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">
        {geometry.arrows.map(x => (
          <polyline key={x} points={`${x - HEAD},${LINE_Y - HEAD} ${x + HEAD * 0.6},${LINE_Y} ${x - HEAD},${LINE_Y + HEAD}`} />
        ))}
      </g>
      {geometry.markers.map((marker, index) => {
        // End bars sit inside the clip's edge so they are not clipped by it.
        const x = marker.isEnd ? Math.min(clipWidthPx - 1.5, Math.max(1.5, marker.x)) : marker.x
        return (
          <g key={index} data-speed-curve-marker={index}>
            <title>{formatClipSpeed(marker.v)}</title>
            <rect x={x - 1.5} y={0.5} width={3} height={BAND_HEIGHT - 1} rx={1.5} fill="#ffffff" stroke="rgba(0,0,0,0.45)" strokeWidth={0.75} />
          </g>
        )
      })}
    </svg>
  )
}
