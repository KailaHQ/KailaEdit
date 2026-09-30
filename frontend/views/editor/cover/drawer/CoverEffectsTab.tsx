import React from 'react'
import { Ban } from 'lucide-react'
import type { CoverElement, TextCoverElement } from '../types'
import {
  COVER_TEXT_STYLE_PRESETS,
  PLAIN_COVER_TEXT_LOOK_ID,
  isCoverTextLook,
  coverTextLookCss,
  applyCoverTextLook,
} from '../cover-text-style-presets'

export interface CoverEffectsTabProps {
  selectedElement: CoverElement | null
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
}

export const CoverEffectsTab: React.FC<CoverEffectsTabProps> = ({
  selectedElement,
  onUpdateElement,
}) => {
  if (!selectedElement || selectedElement.type !== 'text') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs">
        <p>Select a text element to customize its effects, shadows, and strokes.</p>
      </div>
    )
  }

  const el = selectedElement as TextCoverElement

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300">
      {/* Text Style Presets */}
      <div>
        <div className="text-[11px] font-semibold text-zinc-400 mb-2">Style Presets</div>
        <div className="grid grid-cols-4 gap-2">
          {COVER_TEXT_STYLE_PRESETS.map(preset => {
            const active = isCoverTextLook(el, preset.look)
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.id === PLAIN_COVER_TEXT_LOOK_ID ? 'None' : preset.id}
                onClick={() => onUpdateElement(el.id, applyCoverTextLook(preset.look))}
                className={`flex aspect-square items-center justify-center rounded-md bg-[#2a2a2e] transition-colors hover:bg-zinc-700 ${
                  active ? 'ring-2 ring-sky-400' : ''
                }`}
              >
                {preset.id === PLAIN_COVER_TEXT_LOOK_ID ? (
                  <Ban className="h-5 w-5 text-zinc-400" />
                ) : (
                  <span className="text-[15px] font-black leading-none" style={coverTextLookCss(preset.look)}>
                    Aa
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Shadow */}
      <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200">Shadow</span>
          <input
            type="checkbox"
            checked={el.shadow?.enabled ?? false}
            onChange={e =>
              onUpdateElement(el.id, {
                shadow: {
                  enabled: e.target.checked,
                  color: el.shadow?.color || '#000000',
                  blur: el.shadow?.blur || 10,
                  offsetX: el.shadow?.offsetX || 0,
                  offsetY: el.shadow?.offsetY || 4,
                },
              })
            }
            className="accent-sky-400 rounded"
          />
        </div>
        {el.shadow?.enabled && (
          <div className="space-y-2 pt-2 border-t border-zinc-700/40">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Blur</span>
                <span>{el.shadow.blur}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                value={el.shadow.blur}
                onChange={e =>
                  onUpdateElement(el.id, {
                    shadow: { ...el.shadow!, blur: parseInt(e.target.value, 10) },
                  })
                }
                className="w-full accent-sky-400"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Color</span>
              <input
                type="color"
                value={el.shadow.color}
                onChange={e =>
                  onUpdateElement(el.id, {
                    shadow: { ...el.shadow!, color: e.target.value },
                  })
                }
                className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* Stroke */}
      <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200">Stroke</span>
          <input
            type="checkbox"
            checked={el.stroke?.enabled ?? false}
            onChange={e =>
              onUpdateElement(el.id, {
                stroke: {
                  enabled: e.target.checked,
                  color: el.stroke?.color || '#000000',
                  width: el.stroke?.width || 2,
                },
              })
            }
            className="accent-sky-400 rounded"
          />
        </div>
        {el.stroke?.enabled && (
          <div className="space-y-2 pt-2 border-t border-zinc-700/40">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Thickness</span>
                <span>{el.stroke.width}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={15}
                value={el.stroke.width}
                onChange={e =>
                  onUpdateElement(el.id, {
                    stroke: { ...el.stroke!, width: parseInt(e.target.value, 10) },
                  })
                }
                className="w-full accent-sky-400"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Color</span>
              <input
                type="color"
                value={el.stroke.color}
                onChange={e =>
                  onUpdateElement(el.id, {
                    stroke: { ...el.stroke!, color: e.target.value },
                  })
                }
                className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* Background Badge */}
      <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200">Background Badge</span>
          <input
            type="checkbox"
            checked={el.backgroundBadge?.enabled ?? false}
            onChange={e =>
              onUpdateElement(el.id, {
                backgroundBadge: {
                  enabled: e.target.checked,
                  color: el.backgroundBadge?.color || '#000000',
                  paddingX: el.backgroundBadge?.paddingX || 12,
                  paddingY: el.backgroundBadge?.paddingY || 6,
                  borderRadius: el.backgroundBadge?.borderRadius || 6,
                },
              })
            }
            className="accent-sky-400 rounded"
          />
        </div>
        {el.backgroundBadge?.enabled && (
          <div className="space-y-2 pt-2 border-t border-zinc-700/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Badge Color</span>
              <input
                type="color"
                value={el.backgroundBadge.color}
                onChange={e =>
                  onUpdateElement(el.id, {
                    backgroundBadge: { ...el.backgroundBadge!, color: e.target.value },
                  })
                }
                className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Corner Radius</span>
                <span>{el.backgroundBadge.borderRadius}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                value={el.backgroundBadge.borderRadius}
                onChange={e =>
                  onUpdateElement(el.id, {
                    backgroundBadge: {
                      ...el.backgroundBadge!,
                      borderRadius: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full accent-sky-400"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
