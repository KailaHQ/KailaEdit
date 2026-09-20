import React from 'react'
import { Loader2, X } from 'lucide-react'
import { useMatteBakeStatus, cancelClipBake } from '../../../hooks/useMatteBake'
import { useTranslation } from '../../../i18n/I18nContext'

export interface ClipMatteProgressProps {
  clipId: string
  /** Drawn width of the clip box, in px — decides how much of the badge fits. */
  clipWidthPx: number
}

/**
 * Background-removal progress, drawn on the clip it belongs to.
 *
 * It used to live in the properties panel, which shows whichever clip is selected — so a
 * run on one clip read as a run on whatever the user clicked next. Anchored to the clip
 * box there is no ambiguity about which media is being processed, and several clips can
 * bake at once without the panel having to choose one.
 *
 * Kept as its own component so progress events re-render this badge and not the clip list
 * around it.
 */
export const ClipMatteProgress: React.FC<ClipMatteProgressProps> = ({ clipId, clipWidthPx }) => {
  const { t } = useTranslation()
  const { isBaking, percent, phase } = useMatteBakeStatus(clipId)

  if (!isBaking) return null

  const phaseText =
    phase === 'extracting'
      ? t('clipProperties.removeBg.extractingPhase')
      : phase === 'encoding'
        ? t('clipProperties.removeBg.encodingPhase')
        : t('clipProperties.removeBg.inferringPhase')

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
        {showLabel && <span className="whitespace-nowrap">{t('clipProperties.removeBg.autoRemoval')}</span>}
        <span className="tabular-nums font-mono">{percent}%</span>
        {showCancel && (
          <button
            type="button"
            className="pointer-events-auto ml-0.5 rounded p-[1px] text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
            title={t('clipProperties.removeBg.cancelBake')}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              void cancelClipBake(clipId)
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}
