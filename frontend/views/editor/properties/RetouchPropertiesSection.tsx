import { Sparkles, Trash2, RotateCcw } from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import { DEFAULT_COLOR_CORRECTION } from '../../../types/project-model'
import { getFilterDefinition } from '@core/filters'
import { hasKeyframesForProperty } from '@core/keyframes'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectCurrentTime } from '../editor-selectors'
import { useEditorActions, useEditorGetState } from '../editor-store'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'

interface RetouchPropertiesSectionProps {
  selectedClip: TimelineClip
}

export function RetouchPropertiesSection({ selectedClip }: RetouchPropertiesSectionProps) {
  const { t } = useTranslation()
  const {
    removeClipFilter,
    setClipFilterIntensity,
    setKeyframe,
    updateClip,
  } = useEditorActions()
  const getEditorState = useEditorGetState()

  return (
    <div className="space-y-4">
      {/* 3D LUT Filter */}
      <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-semibold text-zinc-200">{t('filters.tabTitle')}</span>
          </div>
          {selectedClip.filter && (
            <button
              type="button"
              onClick={() => removeClipFilter(selectedClip.id)}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
              title={t('filters.removeFilter')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {selectedClip.filter ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200">
                {getFilterDefinition(selectedClip.filter.id)?.name || selectedClip.filter.id}
              </span>
              <span className="text-xs text-zinc-400 tabular-nums">
                {selectedClip.filter.intensity ?? 100}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={selectedClip.filter.intensity ?? 100}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  const curTime = selectCurrentTime(getEditorState())
                  const tInClip = curTime - selectedClip.startTime
                  if (hasKeyframesForProperty(selectedClip, 'filter.intensity') && tInClip >= 0 && tInClip <= selectedClip.duration) {
                    setKeyframe(selectedClip.id, 'filter.intensity', tInClip, val)
                  } else {
                    setClipFilterIntensity(selectedClip.id, val)
                  }
                }}
                className="flex-1 h-1.5 accent-cyan-400"
              />
              <KeyframeDiamondButton
                clip={selectedClip}
                property="filter.intensity"
                currentValue={selectedClip.filter.intensity ?? 100}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic">
            No filter applied. Choose a filter from the library to preview.
          </p>
        )}
      </div>

      {/* Color Adjustments */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-300">Adjustments</span>
          {selectedClip.colorCorrection && Object.values(selectedClip.colorCorrection).some(v => v !== 0) && (
            <button
              type="button"
              onClick={() => updateClip(selectedClip.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-cyan-400 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>

        {[
          { key: 'exposure' as const, label: 'Exposure', min: -100, max: 100 },
          { key: 'brightness' as const, label: 'Brightness', min: -100, max: 100 },
          { key: 'contrast' as const, label: 'Contrast', min: -100, max: 100 },
          { key: 'saturation' as const, label: 'Saturation', min: -100, max: 100 },
          { key: 'temperature' as const, label: 'Temperature', min: -100, max: 100 },
        ].map((ctrl) => {
          const currentVal = selectedClip.colorCorrection?.[ctrl.key] ?? 0
          return (
            <div key={ctrl.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{ctrl.label}</span>
                <span className="text-[10px] text-zinc-500 tabular-nums">{currentVal}</span>
              </div>
              <input
                type="range"
                min={ctrl.min}
                max={ctrl.max}
                step={1}
                value={currentVal}
                onChange={(e) => updateClip(selectedClip.id, {
                  colorCorrection: {
                    ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION),
                    [ctrl.key]: parseInt(e.target.value, 10),
                  }
                })}
                className="w-full h-1.5 accent-cyan-400"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
