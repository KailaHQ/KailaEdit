import React from 'react'
import { Loader2, RotateCcw, AlertTriangle, Sparkles, CheckCircle2 } from 'lucide-react'
import type { TimelineClip, AutoMatte, AutoMatteQuality } from '@core/project-model'
import { DEFAULT_AUTO_MATTE } from '@core/project-model'
import { isAutoMatteBakeValid } from '@core/auto-matte'
import { PropertyToggle } from '../PropertyControls'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions } from '../editor-store'
import { useMatteBake } from '../../../hooks/useMatteBake'

export interface AutoRemovalCardProps {
  clip: TimelineClip
}

export const AutoRemovalCard: React.FC<AutoRemovalCardProps> = ({ clip }) => {
  const { t } = useTranslation()
  const { setClipAutoMatte } = useEditorActions()
  const { isBaking, error, startBake, cancelBake } = useMatteBake(clip)

  const autoMatte: AutoMatte = clip.autoMatte ?? DEFAULT_AUTO_MATTE
  const isEnabled = Boolean(clip.autoMatte?.enabled)

  const hasValidBake = clip
    ? isAutoMatteBakeValid(clip.autoMatte?.bake, {
        trimStart: clip.trimStart,
        duration: clip.duration,
        speed: clip.speed ?? 1,
        reversed: Boolean(clip.reversed),
        model: autoMatte.model || 'rvm-mobilenetv3',
        quality: autoMatte.quality || 'standard',
      })
    : false

  const updateAutoMatte = (patch: Partial<AutoMatte>) => {
    setClipAutoMatte(clip.id, {
      ...autoMatte,
      ...patch,
      enabled: patch.enabled !== undefined ? patch.enabled : true,
    })
  }

  const handleQualityChange = (q: AutoMatteQuality) => {
    if (autoMatte.quality === q) return
    updateAutoMatte({ quality: q })
    if (hasValidBake && !isBaking) {
      startBake({ quality: q })
    }
  }

  const handleToggle = (checked: boolean) => {
    if (checked) {
      updateAutoMatte({
        enabled: true,
        featherEdge: 0,
        cleanEdge: 0,
      })
      if (!hasValidBake && !isBaking) {
        startBake()
      }
    } else {
      if (isBaking) {
        cancelBake()
      }
      updateAutoMatte({ enabled: false })
    }
  }

  // No bake starts on its own here. This card re-mounts every time the selection moves,
  // so an effect that baked whatever clip was enabled-but-unbaked fired on clips the user
  // had only clicked — turning the toggle off on one clip appeared to start a run on
  // another. A bake now only starts from an explicit action on THIS clip: the toggle,
  // "Bake now", "Re-bake" or "Retry".

  return (
    <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-200">
            {t('clipProperties.removeBg.autoRemoval')}
          </span>
        </div>
        <PropertyToggle checked={isEnabled} onChange={handleToggle} />
      </div>

      {isEnabled && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {/* Quality Picker */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 font-medium">
              {t('clipProperties.removeBg.quality')}
            </span>
            <div className="flex items-center bg-[#121214] border border-zinc-800 rounded p-0.5">
              {(['draft', 'standard', 'high'] as const).map((q) => {
                const isSelected = (autoMatte.quality || 'standard') === q
                const label =
                  q === 'draft'
                    ? t('clipProperties.removeBg.qualityDraft')
                    : q === 'standard'
                    ? t('clipProperties.removeBg.qualityStandard')
                    : t('clipProperties.removeBg.qualityHigh')
                return (
                  <button
                    key={q}
                    type="button"
                    disabled={isBaking}
                    onClick={() => handleQualityChange(q)}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                      isSelected
                        ? 'bg-zinc-700 text-white font-medium shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 disabled:opacity-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          {/* Progress lives on the timeline clip box (ClipMatteProgress) so it is
              obvious WHICH clip is being processed; the panel only shows outcome. */}
          {isBaking && (
            <div className="flex items-center gap-1.5 bg-[#141416] border border-cyan-800/40 rounded-lg px-2.5 py-1.5 text-[11px] text-cyan-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              <span>{t('clipProperties.removeBg.bakingOnTimeline')}</span>
            </div>
          )}

          {/* Bake Status: Ready */}
          {!isBaking && hasValidBake && (
            <div className="flex items-center justify-between bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-2.5 py-1.5 text-[11px]">
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{t('clipProperties.removeBg.bakeReady')}</span>
              </span>
              <button
                type="button"
                onClick={() => startBake()}
                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-cyan-400 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800/80"
                title={t('clipProperties.removeBg.rebake')}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{t('clipProperties.removeBg.rebake')}</span>
              </button>
            </div>
          )}

          {/* Bake Status: Live Preview Only / Needs Bake */}
          {!isBaking && !hasValidBake && !error && (
            <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-2.5 py-1.5 text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                <span>{t('clipProperties.removeBg.livePreviewOnly')}</span>
              </span>
              <button
                type="button"
                onClick={() => startBake()}
                className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/50 hover:bg-cyan-900/40"
              >
                <span>{t('clipProperties.removeBg.bakeNow')}</span>
              </button>
            </div>
          )}

          {/* Bake Error Alert */}
          {error && !isBaking && (
            <div className="flex items-start justify-between bg-rose-950/20 border border-rose-800/30 rounded-lg p-2.5 text-[11px] text-rose-300">
              <div className="flex items-start gap-1.5 pr-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-rose-400">{t('clipProperties.removeBg.bakeError')}</div>
                  <div className="text-[10px] text-rose-300/80 break-all mt-0.5">{error}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => startBake()}
                className="flex items-center gap-1 text-[10px] text-zinc-300 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 flex-shrink-0"
              >
                <RotateCcw className="h-3 w-3" />
                <span>{t('clipProperties.removeBg.retry')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
