import React from 'react'
import { Paintbrush, Eraser, Wand2, CircleSlash, RotateCcw, Check } from 'lucide-react'
import type { TimelineClip, CustomMatte, BrushMode } from '@core/project-model'
import { DEFAULT_CUSTOM_MATTE } from '@core/project-model'
import { computeStrokesHash } from '@core/custom-matte'
import { PropertyToggle, PropertyNumberInput } from '../PropertyControls'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions, useEditorStore } from '../editor-store'
import { selectCustomMatteBrushMode, selectCustomMatteBrushSize } from '@core/editor-selectors'

export interface CustomRemovalCardProps {
  clip: TimelineClip
}

export const CustomRemovalCard: React.FC<CustomRemovalCardProps> = ({ clip }) => {
  const { t } = useTranslation()
  const {
    setClipCustomMatte,
    clearCustomMatteStrokes,
    setCustomMatteBrushMode,
    setCustomMatteBrushSize,
  } = useEditorActions()

  const activeBrushMode = useEditorStore(selectCustomMatteBrushMode)
  const activeBrushSize = useEditorStore(selectCustomMatteBrushSize)

  const customMatte: CustomMatte = clip.customMatte ?? DEFAULT_CUSTOM_MATTE
  const isEnabled = Boolean(clip.customMatte?.enabled)
  const strokes = customMatte.strokes || []
  const strokeCount = strokes.length

  const currentHash = strokeCount > 0 ? computeStrokesHash(strokes) : ''
  const isApplied = strokeCount > 0 && customMatte.appliedHash === currentHash
  const hasUnappliedChanges = strokeCount > 0 && !isApplied

  const updateCustomMatte = (patch: Partial<CustomMatte>) => {
    setClipCustomMatte(clip.id, {
      ...customMatte,
      ...patch,
      enabled: patch.enabled !== undefined ? patch.enabled : true,
    })
  }

  const handleToggle = (checked: boolean) => {
    if (checked) {
      updateCustomMatte({ enabled: true })
      if (!activeBrushMode) {
        setCustomMatteBrushMode('brush')
      }
    } else {
      updateCustomMatte({ enabled: false })
      setCustomMatteBrushMode(null)
    }
  }

  const handleModeSelect = (mode: BrushMode) => {
    if (!isEnabled) {
      updateCustomMatte({ enabled: true })
    }
    if (activeBrushMode === mode) {
      setCustomMatteBrushMode(null)
    } else {
      setCustomMatteBrushMode(mode)
    }
  }

  const handleApply = () => {
    if (strokeCount > 0) {
      updateCustomMatte({
        appliedHash: currentHash,
      })
    }
  }

  const handleReset = () => {
    clearCustomMatteStrokes(clip.id)
  }

  const modes: Array<{
    id: BrushMode
    labelKey: string
    icon: React.ComponentType<{ className?: string }>
    hintKey: string
  }> = [
    {
      id: 'region-brush',
      labelKey: 'clipProperties.customRemoval.regionBrush',
      icon: Wand2,
      hintKey: 'clipProperties.customRemoval.regionBrushHint',
    },
    {
      id: 'region-eraser',
      labelKey: 'clipProperties.customRemoval.regionEraser',
      icon: CircleSlash,
      hintKey: 'clipProperties.customRemoval.regionEraserHint',
    },
    {
      id: 'brush',
      labelKey: 'clipProperties.customRemoval.brush',
      icon: Paintbrush,
      hintKey: 'clipProperties.customRemoval.brushHint',
    },
    {
      id: 'eraser',
      labelKey: 'clipProperties.customRemoval.eraser',
      icon: Eraser,
      hintKey: 'clipProperties.customRemoval.eraserHint',
    },
  ]

  return (
    <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paintbrush className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200">
            {t('clipProperties.customRemoval.title')}
          </span>
        </div>
        <PropertyToggle checked={isEnabled} onChange={handleToggle} />
      </div>

      {isEnabled && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {/* 4 Brush Modes */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-400">
              {t('clipProperties.customRemoval.tools')}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {modes.map((m) => {
                const Icon = m.icon
                const isActive = activeBrushMode === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModeSelect(m.id)}
                    title={t(m.hintKey)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded text-left transition-colors text-xs font-medium border ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                        : 'bg-zinc-900/60 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                    <span className="truncate">{t(m.labelKey)}</span>
                  </button>
                )
              })}
            </div>
            {activeBrushMode && (
              <p className="text-[10px] text-emerald-400/80 pt-0.5">
                {t(modes.find(m => m.id === activeBrushMode)?.hintKey || '')}
              </p>
            )}
          </div>

          {/* Brush Size Slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.customRemoval.size')}</span>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {activeBrushSize.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={50}
                step={0.5}
                value={activeBrushSize}
                onChange={(e) => setCustomMatteBrushSize(parseFloat(e.target.value))}
                className="flex-1 h-1.5 accent-emerald-400 cursor-pointer"
              />
              <PropertyNumberInput
                value={Math.round(activeBrushSize)}
                min={1}
                max={50}
                step={1}
                onChange={(v) => setCustomMatteBrushSize(v)}
              />
            </div>
          </div>

          {/* Stroke Count & Apply / Reset Actions */}
          <div className="pt-2 border-t border-zinc-800/40 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-zinc-400">
                {t('clipProperties.customRemoval.strokes', { count: strokeCount })}
              </span>
              {hasUnappliedChanges && (
                <span className="text-[10px] text-amber-400 font-medium">
                  ({t('clipProperties.customRemoval.unapplied')})
                </span>
              )}
              {isApplied && (
                <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-0.5">
                  <Check className="h-3 w-3" />
                  {t('clipProperties.customRemoval.applied')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {strokeCount > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-400 transition-colors px-2 py-1 rounded bg-zinc-800/60 hover:bg-zinc-800"
                  title={t('clipProperties.customRemoval.resetHint')}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{t('clipProperties.customRemoval.reset')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleApply}
                disabled={strokeCount === 0 || isApplied}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                  hasUnappliedChanges
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Check className="h-3 w-3" />
                <span>{t('clipProperties.customRemoval.apply')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
