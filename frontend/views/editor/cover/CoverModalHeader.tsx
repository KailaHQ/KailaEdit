import React from 'react'
import { Undo2, Redo2, X } from 'lucide-react'

export interface CoverModalHeaderProps {
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onClose: () => void
}

export const CoverModalHeader: React.FC<CoverModalHeaderProps> = ({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClose,
}) => {
  return (
    <div
      className="h-12 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-950 flex-shrink-0 z-30"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-zinc-200 tracking-wide flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          Cover Studio
        </span>

        <div className="h-4 w-[1px] bg-zinc-800 mx-1" />

        {/* Undo / Redo controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={e => {
              e.stopPropagation()
              onUndo()
            }}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent text-zinc-400 hover:text-white transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={e => {
              e.stopPropagation()
              onRedo()
            }}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent text-zinc-400 hover:text-white transition-colors"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Header Right Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={e => {
            e.stopPropagation()
            onClose()
          }}
          className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
