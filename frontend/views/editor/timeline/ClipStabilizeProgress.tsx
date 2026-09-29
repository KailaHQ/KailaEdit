import React from 'react'
import { Loader2, X } from 'lucide-react'
import { cancelClipStabilization, useStabilizeBakeStatus } from '../../../hooks/useStabilizeBake'
import { useTranslation } from '../../../i18n/I18nContext'

export interface ClipStabilizeProgressProps {
  clipId: string
  /** Drawn width of the clip box, in px — decides how much of the badge fits. */
  clipWidthPx: number
}

/**
 * Stabilization progress, drawn on the clip it belongs to — the same treatment as
 * ClipMatteProgress, for the same reason: the properties panel shows whichever clip is
 * selected, so progress shown there reads as belonging to the wrong clip.
 *
 * Its own component so progress events re-render this badge, not the clip list.
 */
export const ClipStabilizeProgress: React.FC<ClipStabilizeProgressProps> = ({ clipId, clipWidthPx }) => {
  const { t } = useTranslation()
  const { isBaking, percent, phase } = useStabilizeBakeStatus(clipId)

  if (!isBaking) return null

  const phaseText = phase === 'analyzing'
    ? t('clipProperties.stabilize.analyzing')
    : phase === 'stabilizing'
      ? t('clipProperties.stabilize.stabilizing')
      : t('clipProperties.stabilize.queued')

  const showLabel = clipWidthPx >= 90
  const showCancel = clipWidthPx >= 130

  return (
    <div
      className="absolute inset-0 z-30 rounded overflow-hidden pointer-events-none"
      title={`${phaseText} — ${percent}%`}
    >
      {/* Dim the part still waiting, so the clip itself reads as the progress bar */}
      <div
        className="absolute inset-y-0 right-0 bg-black/45 transition-[width] duration-300"
        style={{ width: `${Math.max(0, 100 - percent)}%` }}
      />
      <div
        className="absolute bottom-0 left-0 h-[3px] bg-cyan-400 transition-[width] duration-300"
        style={{ width: `${Math.max(2, percent)}%` }}
      />
      <div className="absolute top-1 left-1 flex items-center gap-1 rounded bg-zinc-950/85 border border-cyan-700/50 px-1.5 py-0.5 text-[9px] font-medium text-cyan-300 shadow">
        <Loader2 className="h-2.5 w-2.5 animate-spin flex-shrink-0" />
        {showLabel && <span className="whitespace-nowrap">{t('clipProperties.stabilize.title')}</span>}
        <span className="tabular-nums font-mono">{percent}%</span>
        {showCancel && (
          <button
            type="button"
            className="pointer-events-auto ml-0.5 rounded p-[1px] text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
            title={t('clipProperties.stabilize.cancel')}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              cancelClipStabilization(clipId)
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}
