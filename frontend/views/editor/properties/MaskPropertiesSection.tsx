import type { TimelineClip, ClipMaskShape } from '../../../types/project-model'
import { DEFAULT_CLIP_MASK } from '../../../types/project-model'
import { selectMaskMode } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'
import { PropertyNumberInput, PropertyToggle } from '../PropertyControls'

interface MaskPropertiesSectionProps {
  selectedClip: TimelineClip
}

export function MaskPropertiesSection({ selectedClip }: MaskPropertiesSectionProps) {
  const { setClipMask, setMaskMode, toggleMaskMode } = useEditorActions()
  const maskMode = useEditorStore(selectMaskMode)

  const mask = selectedClip.mask ?? DEFAULT_CLIP_MASK
  const hasCustomMask = !!selectedClip.mask && selectedClip.mask.enabled

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">Mask Shape</span>
        <PropertyToggle
          checked={hasCustomMask}
          onChange={(checked) => {
            setClipMask(
              selectedClip.id,
              checked
                ? { ...(selectedClip.mask || DEFAULT_CLIP_MASK), enabled: true }
                : { ...(selectedClip.mask || DEFAULT_CLIP_MASK), enabled: false }
            )
            setMaskMode(checked)
          }}
        />
      </div>

      {/* Canvas Edit button */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
            maskMode
              ? 'bg-cyan-500 text-black shadow-sm'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
          }`}
          onClick={() => toggleMaskMode()}
        >
          {maskMode ? 'Active on Canvas' : 'Edit on Canvas'}
        </button>
        {selectedClip.mask && (
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            onClick={() => {
              setClipMask(selectedClip.id, null)
              setMaskMode(false)
            }}
          >
            Reset Mask
          </button>
        )}
      </div>

      {/* Shape Selector Buttons */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['rectangle', 'ellipse', 'linear'] as ClipMaskShape[]).map((shape) => (
          <button
            key={shape}
            type="button"
            onClick={() => setClipMask(selectedClip.id, { shape, enabled: true })}
            className={`py-2 px-2 text-xs rounded-md capitalize transition-colors text-center ${
              mask.shape === shape && selectedClip.mask?.enabled
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-medium'
                : 'bg-[#1c1c1f] text-zinc-400 hover:bg-[#252529] border border-zinc-800'
            }`}
          >
            {shape}
          </button>
        ))}
      </div>

      {/* Dimensions & Controls */}
      <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
        {/* Position X / Y */}
        <div className="space-y-1">
          <span className="text-xs text-zinc-400">Position</span>
          <div className="grid grid-cols-2 gap-2">
            <PropertyNumberInput
              prefix="X"
              value={Math.round(mask.x)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => setClipMask(selectedClip.id, { x: v, enabled: true })}
            />
            <PropertyNumberInput
              prefix="Y"
              value={Math.round(mask.y)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => setClipMask(selectedClip.id, { y: v, enabled: true })}
            />
          </div>
        </div>

        {/* Size (Width / Height) */}
        {mask.shape !== 'linear' && (
          <div className="space-y-1">
            <span className="text-xs text-zinc-400">Size</span>
            <div className="grid grid-cols-2 gap-2">
              <PropertyNumberInput
                prefix="W"
                value={Math.round(mask.width)}
                min={1}
                max={200}
                suffix="%"
                onChange={(v) => setClipMask(selectedClip.id, { width: v, enabled: true })}
              />
              <PropertyNumberInput
                prefix="H"
                value={Math.round(mask.height)}
                min={1}
                max={200}
                suffix="%"
                onChange={(v) => setClipMask(selectedClip.id, { height: v, enabled: true })}
              />
            </div>
          </div>
        )}

        {/* Rotation */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Rotation</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(mask.rotation ?? 0)}°</span>
          </div>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={mask.rotation ?? 0}
            onChange={(e) => setClipMask(selectedClip.id, { rotation: parseFloat(e.target.value), enabled: true })}
            className="w-full h-1.5 accent-cyan-400"
          />
        </div>

        {/* Feather */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Feather</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(mask.feather ?? 0)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={mask.feather ?? 0}
            onChange={(e) => setClipMask(selectedClip.id, { feather: parseFloat(e.target.value), enabled: true })}
            className="w-full h-1.5 accent-cyan-400"
          />
        </div>

        {/* Invert */}
        <div className="pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mask.invert ?? false}
              onChange={(e) => setClipMask(selectedClip.id, { invert: e.target.checked, enabled: true })}
              className="rounded bg-zinc-800 border-zinc-600 accent-cyan-400"
            />
            <span className="text-xs text-zinc-300">Invert Mask</span>
          </label>
        </div>
      </div>
    </div>
  )
}
