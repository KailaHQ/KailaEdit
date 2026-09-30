import React from 'react'
import { RotateCcw } from 'lucide-react'
import type { CoverElement, ImageCoverElement } from '../types'

export interface CoverEditTabProps {
  selectedElement: CoverElement | null
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
}

export const CoverEditTab: React.FC<CoverEditTabProps> = ({
  selectedElement,
  onUpdateElement,
}) => {
  if (!selectedElement || (selectedElement.type !== 'image' && selectedElement.type !== 'background')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs">
        <p>Select an image or background element to adjust colors and filters.</p>
      </div>
    )
  }

  const el = selectedElement as ImageCoverElement
  const filters = el.filters || {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    hue: 0,
  }

  const updateFilter = (key: keyof typeof filters, val: number) => {
    onUpdateElement(el.id, {
      filters: { ...filters, [key]: val },
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <span className="font-semibold text-zinc-200">Adjustments</span>
        <button
          onClick={() =>
            onUpdateElement(el.id, {
              filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0, hue: 0 },
            })
          }
          className="p-1 rounded text-zinc-400 hover:text-white flex items-center gap-1 text-[11px]"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>Brightness</span>
          <span>{filters.brightness}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={filters.brightness}
          onChange={e => updateFilter('brightness', parseInt(e.target.value, 10))}
          className="w-full accent-sky-400"
        />
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>Contrast</span>
          <span>{filters.contrast}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={filters.contrast}
          onChange={e => updateFilter('contrast', parseInt(e.target.value, 10))}
          className="w-full accent-sky-400"
        />
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>Saturation</span>
          <span>{filters.saturation}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={filters.saturation}
          onChange={e => updateFilter('saturation', parseInt(e.target.value, 10))}
          className="w-full accent-sky-400"
        />
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
          <span>Blur</span>
          <span>{filters.blur}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={filters.blur}
          onChange={e => updateFilter('blur', parseInt(e.target.value, 10))}
          className="w-full accent-sky-400"
        />
      </div>
    </div>
  )
}
