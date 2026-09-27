import { Type, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import type { TimelineClip, TextOverlayStyle } from '../../../types/project-model'
import { TEXT_PRESETS, TEXT_ANIMATIONS } from '@core/text-presets'

import { useEditorActions } from '../editor-store'

import { FontPicker } from '../FontPicker'

export interface TextPropertiesTabProps {
  selectedClip: TimelineClip
}

export function TextPropertiesTab({ selectedClip }: TextPropertiesTabProps) {
  const {
    updateClip,
    applyTextPresetToClip,
    applyTextAnimationToClip,
    clearKeyframes,
  } = useEditorActions()

  if (selectedClip.type !== 'text' || !selectedClip.textStyle) return null

  const ts = selectedClip.textStyle
  const updateText = (patch: Partial<TextOverlayStyle>) => {
    updateClip(selectedClip.id, { textStyle: { ...ts, ...patch } })
  }

  return (
    <div className="bg-cyan-950/30 border border-cyan-700/30 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Type className="h-4 w-4 text-cyan-400" />
        <h4 className="text-xs font-semibold text-cyan-300">Text Overlay</h4>
      </div>

      {/* Text content */}
      <div className="space-y-1">
        <span className="text-[10px] text-zinc-400">Content</span>
        <textarea
          value={ts.text}
          onChange={(e) => updateText({ text: e.target.value })}
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-cyan-500/50"
          placeholder="Enter text..."
        />
      </div>

      {/* Preset selector */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Preset Style</span>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) {
              applyTextPresetToClip(selectedClip.id, e.target.value)
              e.target.value = ''
            }
          }}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50 max-w-[140px]"
        >
          <option value="" disabled>
            Apply Preset...
          </option>
          {TEXT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Animation selector */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Animation</span>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value === 'none') {
              clearKeyframes(selectedClip.id)
            } else if (e.target.value) {
              applyTextAnimationToClip(selectedClip.id, e.target.value)
            }
            e.target.value = ''
          }}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50 max-w-[140px]"
        >
          <option value="" disabled>
            Apply Animation...
          </option>
          <option value="none">None (Clear Keyframes)</option>
          {TEXT_ANIMATIONS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Font family */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Font</span>
        <FontPicker
          value={ts.fontFamily}
          onChange={(newVal) => updateText({ fontFamily: newVal })}
          dropdownAlign="right"
        />
      </div>

      {/* Font size */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Size</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={12}
            max={200}
            value={ts.fontSize}
            onChange={(e) => updateText({ fontSize: parseInt(e.target.value) })}
            className="w-20 accent-cyan-500"
          />
          <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{ts.fontSize}</span>
        </div>
      </div>

      {/* Font weight & style */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Weight</span>
        <select
          value={ts.fontWeight}
          onChange={(e) =>
            updateText({ fontWeight: e.target.value as TextOverlayStyle['fontWeight'] })
          }
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50"
        >
          <option value="100">Thin</option>
          <option value="300">Light</option>
          <option value="normal">Normal</option>
          <option value="500">Medium</option>
          <option value="600">Semibold</option>
          <option value="bold">Bold</option>
          <option value="800">Extra Bold</option>
          <option value="900">Black</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            updateText({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' })
          }
          className={`px-2 py-1 rounded text-[10px] border ${
            ts.fontStyle === 'italic'
              ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
          }`}
        >
          <em>Italic</em>
        </button>

        <button
          type="button"
          onClick={() => {
            const isUpper = ts.text === ts.text.toUpperCase() && ts.text !== ts.text.toLowerCase()
            updateText({ text: isUpper ? ts.text.toLowerCase() : ts.text.toUpperCase() })
          }}
          className={`px-2 py-1 rounded text-[10px] border font-bold ${
            ts.text === ts.text.toUpperCase() && ts.text !== ts.text.toLowerCase()
              ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
          }`}
          title="All Caps (Chữ in hoa)"
        >
          aA
        </button>
      </div>

      {/* Text color */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Color</span>
        <input
          type="color"
          value={ts.color}
          onChange={(e) => updateText({ color: e.target.value })}
          className="w-7 h-6 rounded cursor-pointer border border-zinc-700"
        />
      </div>

      {/* Background color */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Background</span>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={
              ts.backgroundColor === 'transparent'
                ? '#000000'
                : ts.backgroundColor.slice(0, 7)
            }
            onChange={(e) => updateText({ backgroundColor: e.target.value + 'cc' })}
            className="w-7 h-6 rounded cursor-pointer border border-zinc-700"
          />
          <button
            type="button"
            onClick={() =>
              updateText({
                backgroundColor:
                  ts.backgroundColor === 'transparent' ? 'rgba(0,0,0,0.7)' : 'transparent',
              })
            }
            className={`px-1.5 py-0.5 rounded text-[9px] border ${
              ts.backgroundColor !== 'transparent'
                ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700'
            }`}
          >
            {ts.backgroundColor !== 'transparent' ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Text alignment */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Align</span>
        <div className="flex gap-0.5">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              onClick={() => updateText({ textAlign: align })}
              className={`p-1.5 rounded ${
                ts.textAlign === align
                  ? 'bg-cyan-600/30 text-cyan-300'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {align === 'left' ? (
                <AlignLeft className="h-3 w-3" />
              ) : align === 'center' ? (
                <AlignCenter className="h-3 w-3" />
              ) : (
                <AlignRight className="h-3 w-3" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Position */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-zinc-400">Position</span>
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="text-[9px] text-zinc-500">X</span>
            <input
              type="range"
              min={0}
              max={100}
              value={ts.positionX}
              onChange={(e) => updateText({ positionX: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>
          <div className="flex-1">
            <span className="text-[9px] text-zinc-500">Y</span>
            <input
              type="range"
              min={0}
              max={100}
              value={ts.positionY}
              onChange={(e) => updateText({ positionY: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Opacity */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Opacity</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={ts.opacity}
            onChange={(e) => updateText({ opacity: parseInt(e.target.value) })}
            className="w-20 accent-cyan-500"
          />
          <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{ts.opacity}%</span>
        </div>
      </div>

      {/* Stroke */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Outline</span>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={ts.strokeWidth}
            onChange={(e) => updateText({ strokeWidth: parseFloat(e.target.value) })}
            className="w-16 accent-cyan-500"
          />
          <input
            type="color"
            value={ts.strokeColor === 'transparent' ? '#000000' : ts.strokeColor}
            onChange={(e) =>
              updateText({
                strokeColor: e.target.value,
                strokeWidth: Math.max(ts.strokeWidth, 1),
              })
            }
            className="w-5 h-5 rounded cursor-pointer border border-zinc-700"
          />
        </div>
      </div>

      {/* Shadow */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Shadow</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={20}
            value={ts.shadowBlur}
            onChange={(e) => updateText({ shadowBlur: parseInt(e.target.value) })}
            className="w-16 accent-cyan-500"
          />
          <span className="text-[10px] text-zinc-300 w-4 text-right tabular-nums">{ts.shadowBlur}</span>
        </div>
      </div>

      {/* Presets */}
      <div className="pt-2 border-t border-zinc-800">
        <span className="text-[10px] text-zinc-400 block mb-1.5">Apply Preset</span>
        <div className="grid grid-cols-2 gap-1">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => updateText({ ...preset.style })}
              className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-300 hover:border-cyan-500/40 hover:bg-cyan-900/20 transition-colors truncate"
              title={preset.name}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
