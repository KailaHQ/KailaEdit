import { textAnimationSpan } from '@core/text-presets'
import type { TimelineClip } from '../../../types/project-model'
import { useTranslation } from '../../../i18n/I18nContext'

export interface TextAnimationMarkersProps {
  clip: TimelineClip
  pixelsPerSecond: number
  /** Width the clip box is drawn at. */
  clipWidthPx: number
}

const ARROW = 'rgba(255, 255, 255, 0.9)'
const HEAD = 3.5

/**
 * The text clip's animations, drawn on the clip itself: an arrow for the entrance and one for
 * the exit, each as long as the time the animation takes. The entrance points forward, the
 * exit points back toward the clip's end, so the direction reads at a glance.
 */
export function TextAnimationMarkers({ clip, pixelsPerSecond, clipWidthPx }: TextAnimationMarkersProps) {
  const { t } = useTranslation()
  const selection = clip.textAnimation
  if (clip.type !== 'text' || !selection) return null

  const inPx = Math.min(clipWidthPx / 2, textAnimationSpan(selection.in, clip.duration, selection.inDuration) * pixelsPerSecond)
  const outPx = Math.min(clipWidthPx / 2, textAnimationSpan(selection.out, clip.duration, selection.outDuration) * pixelsPerSecond)
  const y = 12
  const hasIn = Boolean(selection.in) && inPx >= 4
  const hasOut = Boolean(selection.out) && outPx >= 4
  const hasLoop = Boolean(selection.loop)
  if (!hasIn && !hasOut && !hasLoop) return null

  return (
    <svg
      data-text-animation-markers
      className="absolute bottom-0 left-0 z-10 pointer-events-none overflow-visible"
      style={{ width: `${clipWidthPx}px`, height: `${y * 2}px` }}
    >
      {hasLoop && (
        <line
          x1={hasIn ? inPx + 4 : 2}
          x2={hasOut ? clipWidthPx - outPx - 4 : clipWidthPx - 2}
          y1={y}
          y2={y}
          stroke={ARROW}
          strokeWidth={1.25}
          strokeDasharray="3 3"
          opacity={0.7}
        >
          <title>{t('textAnimation.loop')}</title>
        </line>
      )}
      {hasIn && (
        <g stroke={ARROW} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <title>{t('textAnimation.in')}</title>
          <line x1={2} y1={y} x2={inPx} y2={y} />
          <polyline points={`${inPx - HEAD},${y - HEAD} ${inPx},${y} ${inPx - HEAD},${y + HEAD}`} />
        </g>
      )}
      {hasOut && (
        <g stroke={ARROW} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <title>{t('textAnimation.out')}</title>
          <line x1={clipWidthPx - outPx} y1={y} x2={clipWidthPx - 2} y2={y} />
          <polyline points={`${clipWidthPx - outPx + HEAD},${y - HEAD} ${clipWidthPx - outPx},${y} ${clipWidthPx - outPx + HEAD},${y + HEAD}`} />
        </g>
      )}
    </svg>
  )
}
