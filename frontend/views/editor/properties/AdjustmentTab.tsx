import { Layers } from 'lucide-react'
import type { TimelineClip, LetterboxSettings } from '../../../types/project-model'
import { DEFAULT_LETTERBOX } from '../../../types/project-model'
import { useEditorActions } from '../editor-store'

export interface AdjustmentTabProps {
  selectedClip: TimelineClip
}

export function AdjustmentTab({ selectedClip }: AdjustmentTabProps) {
  const { updateClip } = useEditorActions()
  const lb = { ...DEFAULT_LETTERBOX, ...selectedClip.letterbox }
  const updateLetterbox = (patch: Partial<LetterboxSettings>) => {
    updateClip(selectedClip.id, { letterbox: { ...lb, ...patch } })
  }

  return (
    <div className="bg-blue-950/30 border border-blue-700/30 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Layers className="h-4 w-4 text-blue-400" />
        <h4 className="text-xs font-semibold text-blue-300">Adjustment Layer</h4>
      </div>

      {/* Letterbox toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Letterbox</span>
        <button
          onClick={() => updateLetterbox({ enabled: !lb.enabled })}
          className={`px-2.5 py-0.5 rounded text-[10px] border transition-colors ${
            lb.enabled
              ? 'bg-blue-600/30 text-blue-300 border-blue-500/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700'
          }`}
        >
          {lb.enabled ? 'On' : 'Off'}
        </button>
      </div>

      {lb.enabled && (
        <>
          {/* Aspect ratio */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400">Aspect Ratio</span>
            <select
              value={lb.aspectRatio}
              onChange={e => updateLetterbox({ aspectRatio: e.target.value as LetterboxSettings['aspectRatio'] })}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-blue-500/50"
            >
              <option value="2.39:1">2.39:1 (Anamorphic)</option>
              <option value="2.35:1">2.35:1 (Cinemascope)</option>
              <option value="2.76:1">2.76:1 (Ultra Panavision)</option>
              <option value="1.85:1">1.85:1 (Flat Widescreen)</option>
              <option value="4:3">4:3 (Classic TV)</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Custom ratio input */}
          {lb.aspectRatio === 'custom' && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-400">Custom Ratio</span>
              <input
                type="number"
                step={0.01}
                min={1}
                max={4}
                value={lb.customRatio || 2.35}
                onChange={e => updateLetterbox({ customRatio: parseFloat(e.target.value) || 2.35 })}
                onKeyDown={e => e.stopPropagation()}
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white text-center focus:outline-none focus:border-blue-500/50"
              />
            </div>
          )}

          {/* Bar color */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400">Bar Color</span>
            <input
              type="color"
              value={lb.color}
              onChange={e => updateLetterbox({ color: e.target.value })}
              className="w-7 h-6 rounded cursor-pointer border border-zinc-700"
            />
          </div>

          {/* Bar opacity */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400">Bar Opacity</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={lb.opacity}
                onChange={e => updateLetterbox({ opacity: parseInt(e.target.value, 10) })}
                className="w-20 accent-blue-500"
              />
              <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{lb.opacity}%</span>
            </div>
          </div>
        </>
      )}

      {/* Color correction note */}
      <p className="text-[9px] text-zinc-600 pt-1 border-t border-zinc-800">
        Color correction on this layer affects all tracks below.
      </p>
    </div>
  )
}
