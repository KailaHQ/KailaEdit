import { useState } from 'react'
import {
  Film,
  Sparkles,
  Trash2,
  Eye,
  X,
  Palette,
  RotateCcw,
  Sun,
  Contrast,
  Droplets,
  Thermometer,
  SunDim,
  Moon,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { TimelineClip, TransitionType } from '../../../types/project-model'
import { DEFAULT_COLOR_CORRECTION } from '../../../types/project-model'
import { EFFECT_DEFINITIONS } from '../../../types/project'
import { getFilterDefinition } from '@core/filters'
import { hasKeyframesForProperty } from '@core/keyframes'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectCurrentTime } from '../editor-selectors'
import { useEditorActions, useEditorGetState } from '../editor-store'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'

interface EffectsPropertiesTabProps {
  selectedClip: TimelineClip
  hasTransitionControls: boolean
  hasVisualTransformControls: boolean
  hasColorCorrectionControls: boolean
}

export function EffectsPropertiesTab({
  selectedClip,
  hasTransitionControls,
  hasVisualTransformControls,
  hasColorCorrectionControls,
}: EffectsPropertiesTabProps) {
  const { t } = useTranslation()
  const {
    clearClipEffects,
    removeClipEffect,
    setClipEffectEnabled,
    setClipEffectParam,
    removeClipFilter,
    setClipFilterIntensity,
    updateClip,
    setKeyframe,
  } = useEditorActions()
  const getEditorState = useEditorGetState()

  const [showTransitions, setShowTransitions] = useState(false)
  const [showColorCorrection, setShowColorCorrection] = useState(false)

  return (
    <div className="space-y-4">
      {/* Transitions */}
      {hasTransitionControls && (
        <div className="pt-3 border-t border-zinc-800">
          <button
            className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
            onClick={() => setShowTransitions(!showTransitions)}
          >
            {showTransitions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Film className="h-3.5 w-3.5" />
            Transitions
          </button>
          {showTransitions && (
            <div className="space-y-3 pl-5">
              {/* Transition In */}
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition In</label>
                <select
                  value={selectedClip.transitionIn?.type || 'none'}
                  onChange={(e) => updateClip(selectedClip.id, {
                    transitionIn: { ...selectedClip.transitionIn, type: e.target.value as TransitionType }
                  })}
                  className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                >
                  <option value="none">None</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="fade-to-black">Fade from Black</option>
                  <option value="fade-to-white">Fade from White</option>
                  <option value="wipe-left">Wipe Left</option>
                  <option value="wipe-right">Wipe Right</option>
                  <option value="wipe-up">Wipe Up</option>
                  <option value="wipe-down">Wipe Down</option>
                </select>
                {selectedClip.transitionIn?.type !== 'none' && (
                  <div className="mt-1.5">
                    <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.1}
                        max={Math.min(2, selectedClip.duration / 2)}
                        step={0.1}
                        value={selectedClip.transitionIn?.duration || 0.5}
                        onChange={(e) => updateClip(selectedClip.id, {
                          transitionIn: { ...selectedClip.transitionIn, duration: parseFloat(e.target.value) }
                        })}
                        className="flex-1"
                      />
                      <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionIn?.duration || 0.5).toFixed(1)}s</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Transition Out */}
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition Out</label>
                <select
                  value={selectedClip.transitionOut?.type || 'none'}
                  onChange={(e) => updateClip(selectedClip.id, {
                    transitionOut: { ...selectedClip.transitionOut, type: e.target.value as TransitionType }
                  })}
                  className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                >
                  <option value="none">None</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="fade-to-black">Fade to Black</option>
                  <option value="fade-to-white">Fade to White</option>
                  <option value="wipe-left">Wipe Left</option>
                  <option value="wipe-right">Wipe Right</option>
                  <option value="wipe-up">Wipe Up</option>
                  <option value="wipe-down">Wipe Down</option>
                </select>
                {selectedClip.transitionOut?.type !== 'none' && (
                  <div className="mt-1.5">
                    <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.1}
                        max={Math.min(2, selectedClip.duration / 2)}
                        step={0.1}
                        value={selectedClip.transitionOut?.duration || 0.5}
                        onChange={(e) => updateClip(selectedClip.id, {
                          transitionOut: { ...selectedClip.transitionOut, duration: parseFloat(e.target.value) }
                        })}
                        className="flex-1"
                      />
                      <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionOut?.duration || 0.5).toFixed(1)}s</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Applied Effects */}
      {hasVisualTransformControls && (selectedClip.effects?.length ?? 0) > 0 && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
              <Sparkles className="h-3.5 w-3.5" />
              Effects
            </div>
            <button
              className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
              onClick={() => clearClipEffects(selectedClip.id)}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
          <div className="space-y-2 pl-1">
            {selectedClip.effects!.map(effect => {
              const definition = EFFECT_DEFINITIONS[effect.type]
              return (
                <div key={effect.id} className="rounded-lg bg-zinc-800/50 p-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setClipEffectEnabled(selectedClip.id, effect.id, !effect.enabled)}
                      className={`transition-colors ${effect.enabled ? 'text-blue-400' : 'text-zinc-600'}`}
                      title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <span className={`flex-1 text-[11px] ${effect.enabled ? 'text-zinc-200' : 'text-zinc-500'}`}>
                      {definition?.name ?? effect.type}
                    </span>
                    <button
                      onClick={() => removeClipEffect(selectedClip.id, effect.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                      title="Remove effect"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {effect.enabled && definition && Object.entries(definition.paramRanges).map(([param, range]) => (
                    <div key={param} className="mt-1.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-zinc-500">{range.label}</span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">
                          {effect.params[param] ?? definition.defaultParams[param] ?? 0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={effect.params[param] ?? definition.defaultParams[param] ?? 0}
                        onChange={(e) => setClipEffectParam(selectedClip.id, effect.id, param, parseFloat(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3D LUT Filter */}
      {(selectedClip.type === 'video' || selectedClip.type === 'image' || selectedClip.type === 'adjustment') && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
              <Sparkles className="h-3.5 w-3.5 text-teal-400" />
              <span>{t('filters.tabTitle')}</span>
            </div>
            {selectedClip.filter && (
              <button
                onClick={() => removeClipFilter(selectedClip.id)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                title={t('filters.removeFilter')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {selectedClip.filter ? (
            <div className="rounded-[6px] bg-zinc-900/60 p-2.5 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-zinc-200">
                  {getFilterDefinition(selectedClip.filter.id)?.name || selectedClip.filter.id}
                </span>
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {selectedClip.filter.intensity ?? 100}%
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">{t('filters.intensity')}</span>
                    <KeyframeDiamondButton
                      clip={selectedClip}
                      property="filter.intensity"
                      currentValue={selectedClip.filter.intensity ?? 100}
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={selectedClip.filter.intensity ?? 100}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    const curTime = selectCurrentTime(getEditorState())
                    const timeInClip = curTime - selectedClip.startTime
                    if (hasKeyframesForProperty(selectedClip, 'filter.intensity') && timeInClip >= 0 && timeInClip <= selectedClip.duration) {
                      setKeyframe(selectedClip.id, 'filter.intensity', timeInClip, val)
                    } else {
                      setClipFilterIntensity(selectedClip.id, val)
                    }
                  }}
                  className="w-full accent-teal-400"
                />
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500 italic">
              {t('filters.noSelection')}
            </p>
          )}
        </div>
      )}

      {/* Color Correction */}
      {hasColorCorrectionControls && (
        <div className="pt-3 border-t border-zinc-800">
          <button
            className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
            onClick={() => setShowColorCorrection(!showColorCorrection)}
          >
            {showColorCorrection ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Palette className="h-3.5 w-3.5" />
            Color Correction
            {selectedClip.colorCorrection && Object.values(selectedClip.colorCorrection).some(v => v !== 0) && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </button>
          {showColorCorrection && (
            <div className="space-y-2.5 pl-1">
              <button
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                onClick={() => updateClip(selectedClip.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
              >
                <RotateCcw className="h-3 w-3" />
                Reset All
              </button>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Exposure</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.exposure || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.exposure || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), exposure: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Brightness</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.brightness || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.brightness || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), brightness: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Contrast className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Contrast</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.contrast || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.contrast || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), contrast: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Droplets className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Saturation</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.saturation || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.saturation || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), saturation: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Temperature</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.temperature || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.temperature || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), temperature: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Cool</span>
                  <span>Warm</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Palette className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Tint</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.tint || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.tint || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), tint: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Green</span>
                  <span>Magenta</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <SunDim className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Highlights</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.highlights || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.highlights || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), highlights: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Moon className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Shadows</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.shadows || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.shadows || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), shadows: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
