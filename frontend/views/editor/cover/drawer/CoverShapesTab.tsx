import React, { useState } from 'react'
import { COVER_SHAPES, type CoverShapeDef } from '../cover-shapes'

export interface CoverShapesTabProps {
  onAddShape?: (shapeDef: CoverShapeDef) => void
}

export const CoverShapesTab: React.FC<CoverShapesTabProps> = ({ onAddShape }) => {
  const [recentShapes, setRecentShapes] = useState<CoverShapeDef[]>(() => {
    return [
      COVER_SHAPES.find(s => s.id === 'rounded-rect') || COVER_SHAPES[16],
      COVER_SHAPES.find(s => s.id === 'square') || COVER_SHAPES[15],
    ]
  })

  const handleUseShape = (shape: CoverShapeDef) => {
    setRecentShapes(prev => [shape, ...prev.filter(s => s.id !== shape.id)].slice(0, 6))
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-5">
      {/* Recents Section */}
      <div className="space-y-2 flex-shrink-0">
        <div className="text-xs font-bold text-zinc-200 tracking-wide">Recents</div>
        <div className="flex items-center gap-2.5">
          {recentShapes.map(shape => (
            <button
              key={shape.id}
              onClick={() => {
                onAddShape?.(shape)
                handleUseShape(shape)
              }}
              className="w-16 h-16 rounded-xl bg-[#23252b] hover:bg-[#2b2d35] border border-zinc-800/80 hover:border-sky-500/60 transition-all flex items-center justify-center p-3 cursor-pointer shadow-sm group"
              title={`Add ${shape.name}`}
            >
              <svg
                viewBox={shape.viewBox}
                className="w-full h-full text-[#a1a1aa] group-hover:text-white group-hover:scale-105 transition-all"
                style={{ overflow: 'visible' }}
              >
                {shape.renderSvg(shape.defaultFill, shape.defaultStroke, shape.defaultStrokeWidth)}
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* All Shapes Section */}
      <div className="space-y-2.5">
        <div className="text-xs font-bold text-zinc-200 tracking-wide">All</div>
        <div className="grid grid-cols-3 gap-2.5">
          {COVER_SHAPES.map(shape => (
            <button
              key={shape.id}
              onClick={() => {
                onAddShape?.(shape)
                handleUseShape(shape)
              }}
              className="aspect-square rounded-xl bg-[#23252b] hover:bg-[#2b2d35] border border-zinc-800/80 hover:border-sky-500/60 transition-all flex items-center justify-center p-3.5 cursor-pointer shadow-sm group"
              title={`Add ${shape.name}`}
            >
              <svg
                viewBox={shape.viewBox}
                className="w-full h-full text-[#a1a1aa] group-hover:text-white group-hover:scale-105 transition-all"
                style={{ overflow: 'visible' }}
              >
                {shape.renderSvg(shape.defaultFill, shape.defaultStroke, shape.defaultStrokeWidth)}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
