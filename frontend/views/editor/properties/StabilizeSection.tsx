import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react'
import type { StabilizationMode, TimelineClip } from '../../../types/project-model'
import {
  DEFAULT_CLIP_STABILIZATION,
  STABILIZATION_SMOOTHING_MAX,
  STABILIZATION_SMOOTHING_MIN,
} from '@core/project-model'
import { describeClipStabilization } from '@core/stabilization'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions, useEditorStore } from '../editor-store'
import { selectAssets } from '../editor-selectors'
import { PropertyNumberInput, PropertyToggle } from '../PropertyControls'
import {
  cancelClipStabilization,
  retryClipStabilization,
  useStabilizeBakeStatus,
} from '../../../hooks/useStabilizeBake'

interface StabilizeSectionProps {
  selectedClip: TimelineClip
}

const MODES: StabilizationMode[] = ['auto', 'tripod']

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Stabilization settings and status for one video clip.
 *
 * The bake itself is the keeper's business (useStabilizeBake): this panel only edits the
 * settings and reports. It never starts a job, so selecting a clip cannot kick one off.
 */
export function StabilizeSection({ selectedClip }: StabilizeSectionProps) {
  const { t } = useTranslation()
  const { setClipStabilization } = useEditorActions()
  const assets = useEditorStore(selectAssets)
  const status = useStabilizeBakeStatus(selectedClip.id)

  const stab = selectedClip.stabilization
  const enabled = Boolean(stab?.enabled)
  const settings = stab ?? DEFAULT_CLIP_STABILIZATION

  // The slider edits a draft and commits on release: one undo step per drag, and the
  // keeper sees one settled value instead of every position the thumb passed through.
  const [draftSmoothing, setDraftSmoothing] = useState(settings.smoothing)
  useEffect(() => { setDraftSmoothing(settings.smoothing) }, [settings.smoothing, selectedClip.id])
  const commitSmoothing = (value: number) => {
    if (value !== settings.smoothing) setClipStabilization(selectedClip.id, { smoothing: value })
  }

  if (selectedClip.type !== 'video') return null

  // The same reading the agent gets from timeline_describe.
  const described = describeClipStabilization(selectedClip, assets)
  const ready = Boolean(described?.bakeReady)
  const zoomPercent = described?.zoomPercent
  const occlusionTimes = described?.occlusionTimes ?? []
  const highZoom = Boolean(described?.warnings?.includes('highZoom'))

  const phaseLabel = status.phase === 'analyzing'
    ? t('clipProperties.stabilize.analyzing')
    : status.phase === 'stabilizing'
      ? t('clipProperties.stabilize.stabilizing')
      : t('clipProperties.stabilize.queued')

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center justify-between h-6">
        <span className="text-xs font-semibold text-zinc-200">{t('clipProperties.stabilize.title')}</span>
        <PropertyToggle
          checked={enabled}
          onChange={checked => setClipStabilization(selectedClip.id, { enabled: checked })}
        />
      </div>

      {!enabled && (
        <p className="text-[11px] leading-snug text-zinc-500">{t('clipProperties.stabilize.description')}</p>
      )}

      {enabled && (
        <>
          {/* Smoothness */}
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">{t('clipProperties.stabilize.smoothing')}</span>
            <input
              type="range"
              min={STABILIZATION_SMOOTHING_MIN}
              max={STABILIZATION_SMOOTHING_MAX}
              step={1}
              value={draftSmoothing}
              aria-label={t('clipProperties.stabilize.smoothing')}
              onChange={e => setDraftSmoothing(Number(e.target.value))}
              onPointerUp={e => commitSmoothing(Number((e.target as HTMLInputElement).value))}
              onKeyUp={e => commitSmoothing(Number((e.target as HTMLInputElement).value))}
              onBlur={e => commitSmoothing(Number(e.target.value))}
              className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
            />
            <PropertyNumberInput
              value={draftSmoothing}
              min={STABILIZATION_SMOOTHING_MIN}
              max={STABILIZATION_SMOOTHING_MAX}
              step={1}
              className="w-16 flex-shrink-0"
              onChange={value => {
                setDraftSmoothing(value)
                commitSmoothing(value)
              }}
            />
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">{t('clipProperties.stabilize.smoothingHint')}</p>

          {/* Mode */}
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">{t('clipProperties.stabilize.mode')}</span>
            <div className="flex flex-1 items-center bg-[#141416] p-0.5 rounded-md border border-zinc-800/80 gap-0.5 select-none">
              {MODES.map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    if (mode !== settings.mode) setClipStabilization(selectedClip.id, { mode })
                  }}
                  className={`flex-1 py-1 px-2 text-[11px] font-medium rounded transition-all text-center ${
                    settings.mode === mode
                      ? 'bg-[#252529] text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  }`}
                >
                  {mode === 'auto' ? t('clipProperties.stabilize.modeAuto') : t('clipProperties.stabilize.modeTripod')}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">
            {settings.mode === 'auto' ? t('clipProperties.stabilize.modeAutoHint') : t('clipProperties.stabilize.modeTripodHint')}
          </p>

          {/* Status */}
          <div className="rounded-md bg-[#141416] border border-zinc-800/80 px-2.5 py-2 text-[11px]">
            {status.isBaking ? (
              <div className="flex items-center gap-2 text-cyan-300">
                <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                <span className="flex-1 truncate">{phaseLabel}</span>
                <span className="tabular-nums font-mono">{status.percent}%</span>
                <button
                  type="button"
                  onClick={() => cancelClipStabilization(selectedClip.id)}
                  className="rounded p-0.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
                  title={t('clipProperties.stabilize.cancel')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : status.phase === 'error' || status.phase === 'cancelled' ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-3 w-3 flex-shrink-0 ${status.phase === 'error' ? 'text-rose-400' : 'text-zinc-400'}`} />
                <span
                  className={`flex-1 truncate ${status.phase === 'error' ? 'text-rose-300' : 'text-zinc-400'}`}
                  title={status.error ?? undefined}
                >
                  {status.phase === 'error' ? t('clipProperties.stabilize.failed') : t('clipProperties.stabilize.cancelled')}
                </span>
                <button
                  type="button"
                  onClick={() => retryClipStabilization(selectedClip.id)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-300 hover:text-cyan-300 hover:bg-zinc-800"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('clipProperties.stabilize.retry')}
                </button>
              </div>
            ) : ready ? (
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                <span className="flex-1">{t('clipProperties.stabilize.ready')}</span>
                {zoomPercent != null && (
                  <span className="text-zinc-400 tabular-nums">
                    {t('clipProperties.stabilize.crop', { percent: zoomPercent.toFixed(1) })}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">{t('clipProperties.stabilize.pending')}</div>
            )}
          </div>

          {/* What the bake noticed */}
          {(occlusionTimes.length > 0 || highZoom) && (
            <div className="space-y-1.5 rounded-md border border-amber-700/40 bg-amber-950/20 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
              {occlusionTimes.length > 0 && (
                <div className="flex gap-1.5">
                  <AlertTriangle className="h-3 w-3 mt-px flex-shrink-0 text-amber-400" />
                  <span>{t('clipProperties.stabilize.warningOcclusion', { times: occlusionTimes.map(formatClock).join(', ') })}</span>
                </div>
              )}
              {highZoom && zoomPercent != null && (
                <div className="flex gap-1.5">
                  <AlertTriangle className="h-3 w-3 mt-px flex-shrink-0 text-amber-400" />
                  <span>{t('clipProperties.stabilize.warningHighZoom', { percent: zoomPercent.toFixed(1) })}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
