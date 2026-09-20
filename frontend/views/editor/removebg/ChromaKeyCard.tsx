import React, { useState } from 'react'
import { Pipette, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import type { TimelineClip } from '@core/project-model'
import { DEFAULT_CHROMA_KEY } from '@core/project-model'
import { PropertyToggle } from '../PropertyControls'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions, useEditorStore } from '../editor-store'
import { selectEyedropperMode } from '../editor-selectors'

export interface ChromaKeyCardProps {
  clip: TimelineClip
}

export const ChromaKeyCard: React.FC<ChromaKeyCardProps> = ({ clip }) => {
  const { t } = useTranslation()
  const { setClipChromaKey, toggleEyedropperMode } = useEditorActions()
  const eyedropperMode = useEditorStore(selectEyedropperMode)
  const [isExpanded, setIsExpanded] = useState(true)

  const chroma = clip.chromaKey ?? DEFAULT_CHROMA_KEY
  const isEnabled = Boolean(clip.chromaKey?.enabled)

  const handleNativeEyedropper = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper()
        const result = await eyeDropper.open()
        if (result?.sRGBHex) {
          setClipChromaKey(clip.id, { color: result.sRGBHex.toUpperCase(), enabled: true })
          return
        }
      } catch {
        return
      }
    }
    toggleEyedropperMode()
  }

  const presets = [
    { name: t('clipProperties.colors.green') || 'Green', hex: '#00FF00' },
    { name: t('clipProperties.colors.blue') || 'Blue', hex: '#0000FF' },
    { name: t('clipProperties.colors.magenta') || 'Magenta', hex: '#FF00FF' },
    { name: t('clipProperties.colors.black') || 'Black', hex: '#000000' },
    { name: t('clipProperties.colors.white') || 'White', hex: '#FFFFFF' },
  ]

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
          <Pipette className="h-3.5 w-3.5 text-cyan-400" />
          <span>{t('clipProperties.removeBg.chromaKey')}</span>
        </button>
        <div className="flex items-center gap-1.5">
          {isEnabled && (
            <button
              type="button"
              onClick={() => setClipChromaKey(clip.id, DEFAULT_CHROMA_KEY)}
              className="text-zinc-400 hover:text-cyan-400 transition-colors p-1 rounded hover:bg-zinc-800"
              title={t('clipProperties.removeBg.resetToDefault')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <PropertyToggle
            checked={isEnabled}
            onChange={(checked) => {
              setClipChromaKey(clip.id, { enabled: checked })
            }}
          />
        </div>
      </div>

      {isExpanded && isEnabled && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {/* Eyedropper & Color Picker */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={chroma.color.startsWith('#') ? chroma.color : `#${chroma.color}`}
                onChange={(e) =>
                  setClipChromaKey(clip.id, {
                    color: e.target.value.toUpperCase(),
                    enabled: true,
                  })
                }
                className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={chroma.color}
                onChange={(e) => {
                  const val = e.target.value
                  if (/^#?[0-9a-fA-F]{0,6}$/.test(val)) {
                    setClipChromaKey(clip.id, {
                      color: val.toUpperCase(),
                      enabled: true,
                    })
                  }
                }}
                placeholder="#00FF00"
                className="w-20 px-2 py-1 text-[11px] font-mono rounded bg-zinc-800 text-zinc-200 border border-zinc-700 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <button
              type="button"
              onClick={handleNativeEyedropper}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                eyedropperMode
                  ? 'bg-cyan-500 text-black shadow-sm'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
              }`}
            >
              <Pipette className="h-3 w-3" />
              {eyedropperMode ? t('clipProperties.samplingColor') : t('clipProperties.removeBg.pickColor')}
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 mr-1">
              {t('clipProperties.removeBg.presets')}
            </span>
            {presets.map((p) => (
              <button
                key={p.hex}
                type="button"
                onClick={() => setClipChromaKey(clip.id, { color: p.hex, enabled: true })}
                className="w-5 h-5 rounded border border-zinc-700/80 hover:scale-110 transition-transform"
                style={{ backgroundColor: p.hex }}
                title={p.name}
              />
            ))}
          </div>

          {/* Similarity / Intensity */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.removeBg.intensity')}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {Math.round(chroma.similarity)}%
                </span>
                <KeyframeDiamondButton
                  clip={clip}
                  property="chromaKey.similarity"
                  currentValue={chroma.similarity}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={chroma.similarity}
              onChange={(e) =>
                setClipChromaKey(clip.id, {
                  similarity: parseFloat(e.target.value),
                  enabled: true,
                })
              }
              className="w-full h-1.5 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Shadow / Smoothness */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.removeBg.shadow')}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {Math.round(chroma.smoothness)}%
                </span>
                <KeyframeDiamondButton
                  clip={clip}
                  property="chromaKey.smoothness"
                  currentValue={chroma.smoothness}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={chroma.smoothness}
              onChange={(e) =>
                setClipChromaKey(clip.id, {
                  smoothness: parseFloat(e.target.value),
                  enabled: true,
                })
              }
              className="w-full h-1.5 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Spill */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.removeBg.spill')}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {Math.round(chroma.spill)}%
                </span>
                <KeyframeDiamondButton
                  clip={clip}
                  property="chromaKey.spill"
                  currentValue={chroma.spill}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={chroma.spill}
              onChange={(e) =>
                setClipChromaKey(clip.id, {
                  spill: parseFloat(e.target.value),
                  enabled: true,
                })
              }
              className="w-full h-1.5 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Feather Edge */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.removeBg.featherEdge')}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {Math.round(chroma.featherEdge ?? 0)}%
                </span>
                <KeyframeDiamondButton
                  clip={clip}
                  property="chromaKey.featherEdge"
                  currentValue={chroma.featherEdge ?? 0}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={chroma.featherEdge ?? 0}
              onChange={(e) =>
                setClipChromaKey(clip.id, {
                  featherEdge: parseFloat(e.target.value),
                  enabled: true,
                })
              }
              className="w-full h-1.5 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Clean Edge */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t('clipProperties.removeBg.cleanEdge')}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {Math.round(chroma.cleanEdge ?? 0)}%
                </span>
                <KeyframeDiamondButton
                  clip={clip}
                  property="chromaKey.cleanEdge"
                  currentValue={chroma.cleanEdge ?? 0}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={chroma.cleanEdge ?? 0}
              onChange={(e) =>
                setClipChromaKey(clip.id, {
                  cleanEdge: parseFloat(e.target.value),
                  enabled: true,
                })
              }
              className="w-full h-1.5 accent-cyan-400 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  )
}
