import React, { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { TimelineClip, StrokeStyle, ClipStroke } from '@core/project-model'
import { DEFAULT_CLIP_STROKE } from '@core/project-model'
import { PropertyToggle, PropertyNumberInput } from '../PropertyControls'
import { StrokeThumbnail } from './StrokeThumbnail'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions } from '../editor-store'

export interface StrokePickerProps {
  clip: TimelineClip
}

const STROKE_STYLES_GRID: StrokeStyle[] = [
  'none',
  'paper',
  'luminescence',
  'hand-drawn',
  'straight',
  'solid',
  'offset',
  'dotted',
]

export const StrokePicker: React.FC<StrokePickerProps> = ({ clip }) => {
  const { t } = useTranslation()
  const { setClipStroke } = useEditorActions()
  const [isExpanded, setIsExpanded] = useState(true)

  const stroke: ClipStroke = clip.stroke ?? {
    ...DEFAULT_CLIP_STROKE,
    enabled: false,
    style: 'none',
  }
  const isEnabled = Boolean(clip.stroke?.enabled)
  const currentStyle: StrokeStyle = stroke.style || 'none'

  const updateStroke = (patch: Partial<ClipStroke>) => {
    setClipStroke(clip.id, {
      ...stroke,
      ...patch,
      // If setting a property other than enabled, ensure it is enabled unless explicitly passed
      enabled: patch.enabled !== undefined ? patch.enabled : true,
    })
  }

  const handleToggleEnabled = (checked: boolean) => {
    if (checked) {
      // If enabling and style was none, default to solid
      const nextStyle = stroke.style === 'none' ? 'solid' : stroke.style
      const nextWidth = stroke.width > 0 ? stroke.width : DEFAULT_CLIP_STROKE.width
      setClipStroke(clip.id, {
        ...stroke,
        enabled: true,
        style: nextStyle,
        width: nextWidth,
      })
    } else {
      setClipStroke(clip.id, {
        ...stroke,
        enabled: false,
      })
    }
  }

  const handleSelectStyle = (newStyle: StrokeStyle) => {
    if (newStyle === 'none') {
      updateStroke({ style: 'none', enabled: false })
    } else {
      const nextWidth = stroke.width > 0 ? stroke.width : DEFAULT_CLIP_STROKE.width
      updateStroke({ style: newStyle, enabled: true, width: nextWidth })
    }
  }

  return (
    <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 hover:text-white transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
          )}
          <span>{t('clipProperties.removeBg.stroke')}</span>
        </button>
        <PropertyToggle checked={isEnabled} onChange={handleToggleEnabled} />
      </div>

      {isExpanded && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {/* 4x2 Thumbnail Grid */}
          <div className="grid grid-cols-4 gap-2 min-w-0">
            {STROKE_STYLES_GRID.map((st) => (
              <StrokeThumbnail
                key={st}
                style={st}
                selected={st === 'none' ? !isEnabled || currentStyle === 'none' : isEnabled && currentStyle === st}
                color={stroke.color}
                onClick={() => handleSelectStyle(st)}
              />
            ))}
          </div>

          {/* Dynamic parameter controls when a stroke style is active */}
          {isEnabled && currentStyle !== 'none' && (
            <div className="space-y-3 pt-3 border-t border-zinc-800/60">
              {/* Color picker */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-400">
                  {t('clipProperties.removeBg.strokeParams.color')}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={stroke.color.startsWith('#') ? stroke.color : `#${stroke.color}`}
                    onChange={(e) => updateStroke({ color: e.target.value.toUpperCase() })}
                    className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={stroke.color}
                    onChange={(e) => {
                      const val = e.target.value
                      if (/^#?[0-9a-fA-F]{0,6}$/.test(val)) {
                        updateStroke({ color: val.toUpperCase() })
                      }
                    }}
                    placeholder="#FFFFFF"
                    className="w-20 px-2 py-1 text-[11px] font-mono rounded bg-zinc-800 text-zinc-200 border border-zinc-700 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              {/* Width Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{t('clipProperties.removeBg.strokeParams.width')}</span>
                  <span className="text-[10px] text-zinc-500 tabular-nums">
                    {Math.round(stroke.width)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={50}
                    step={1}
                    value={stroke.width}
                    onChange={(e) => updateStroke({ width: parseFloat(e.target.value) })}
                    className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                  />
                  <PropertyNumberInput
                    value={Math.round(stroke.width)}
                    min={1}
                    max={50}
                    step={1}
                    suffix="%"
                    className="w-14"
                    onChange={(val) => updateStroke({ width: val })}
                  />
                </div>
              </div>

              {/* Opacity Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{t('clipProperties.removeBg.strokeParams.opacity')}</span>
                  <span className="text-[10px] text-zinc-500 tabular-nums">
                    {Math.round(stroke.opacity)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={stroke.opacity}
                    onChange={(e) => updateStroke({ opacity: parseFloat(e.target.value) })}
                    className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                  />
                  <PropertyNumberInput
                    value={Math.round(stroke.opacity)}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    className="w-14"
                    onChange={(val) => updateStroke({ opacity: val })}
                  />
                </div>
              </div>

              {/* Style-specific parameters */}
              {currentStyle === 'offset' && (
                <div className="space-y-2 pt-2 border-t border-zinc-800/40">
                  {/* Offset X */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>{t('clipProperties.removeBg.strokeParams.offsetX')}</span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {Math.round(stroke.offsetX)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        value={stroke.offsetX}
                        onChange={(e) => updateStroke({ offsetX: parseFloat(e.target.value) })}
                        className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                      />
                      <PropertyNumberInput
                        prefix="X"
                        value={Math.round(stroke.offsetX)}
                        min={-100}
                        max={100}
                        step={1}
                        className="w-16"
                        onChange={(val) => updateStroke({ offsetX: val })}
                      />
                    </div>
                  </div>

                  {/* Offset Y */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>{t('clipProperties.removeBg.strokeParams.offsetY')}</span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {Math.round(stroke.offsetY)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        value={stroke.offsetY}
                        onChange={(e) => updateStroke({ offsetY: parseFloat(e.target.value) })}
                        className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                      />
                      <PropertyNumberInput
                        prefix="Y"
                        value={Math.round(stroke.offsetY)}
                        min={-100}
                        max={100}
                        step={1}
                        className="w-16"
                        onChange={(val) => updateStroke({ offsetY: val })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentStyle === 'luminescence' && (
                <div className="space-y-1 pt-2 border-t border-zinc-800/40">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{t('clipProperties.removeBg.strokeParams.glow')}</span>
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      {Math.round(stroke.glow)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={stroke.glow}
                      onChange={(e) => updateStroke({ glow: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                    />
                    <PropertyNumberInput
                      value={Math.round(stroke.glow)}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      className="w-14"
                      onChange={(val) => updateStroke({ glow: val })}
                    />
                  </div>
                </div>
              )}

              {(currentStyle === 'hand-drawn' || currentStyle === 'paper') && (
                <div className="space-y-1 pt-2 border-t border-zinc-800/40">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{t('clipProperties.removeBg.strokeParams.roughness')}</span>
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      {Math.round(stroke.roughness)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={stroke.roughness}
                      onChange={(e) => updateStroke({ roughness: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                    />
                    <PropertyNumberInput
                      value={Math.round(stroke.roughness)}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      className="w-14"
                      onChange={(val) => updateStroke({ roughness: val })}
                    />
                  </div>
                </div>
              )}

              {currentStyle === 'dotted' && (
                <div className="space-y-1 pt-2 border-t border-zinc-800/40">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{t('clipProperties.removeBg.strokeParams.gap')}</span>
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      {Math.round(stroke.gap)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={1}
                      value={stroke.gap}
                      onChange={(e) => updateStroke({ gap: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
                    />
                    <PropertyNumberInput
                      value={Math.round(stroke.gap)}
                      min={10}
                      max={100}
                      step={1}
                      suffix="%"
                      className="w-14"
                      onChange={(val) => updateStroke({ gap: val })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
