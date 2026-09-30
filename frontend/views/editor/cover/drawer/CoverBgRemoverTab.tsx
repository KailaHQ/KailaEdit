import React from 'react'
import { Wand2, Loader2, Sparkles, Check } from 'lucide-react'
import type { CoverElement, ImageCoverElement } from '../types'

export interface CoverBgRemoverTabProps {
  selectedElement: CoverElement | null
  onRunBgRemoval?: (id: string) => Promise<void>
  onRestoreBg?: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
  isProcessingBgRemoval?: boolean
}

export const CoverBgRemoverTab: React.FC<CoverBgRemoverTabProps> = ({
  selectedElement,
  onRunBgRemoval,
  onRestoreBg,
  onUpdateElement,
  isProcessingBgRemoval = false,
}) => {
  if (!selectedElement || (selectedElement.type !== 'image' && selectedElement.type !== 'background')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs">
        <p>Select an image or background on the canvas to remove background.</p>
      </div>
    )
  }

  const isBgRemoved = (selectedElement as ImageCoverElement).bgRemoved

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300">
      <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/80 text-center space-y-3">
        <div className="w-10 h-10 mx-auto rounded-full bg-sky-500/10 text-sky-400 flex items-center justify-center shadow">
          <Wand2 className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-sm text-zinc-100">Auto Remove Background</h4>
          <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
            Automatically isolate portraits or subjects from the background using on-device AI.
          </p>
        </div>

        <button
          onClick={() => onRunBgRemoval && onRunBgRemoval(selectedElement.id)}
          disabled={isProcessingBgRemoval}
          className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 cursor-pointer"
        >
          {isProcessingBgRemoval ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Removing background...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              <span>Remove Background</span>
            </>
          )}
        </button>
      </div>

      {isBgRemoved && (
        <div className="p-3 rounded-lg bg-zinc-800/80 border border-zinc-700/80 flex items-center justify-between">
          <span className="text-emerald-400 font-medium flex items-center gap-1.5 text-xs">
            <Check className="h-4 w-4" />
            Background removed
          </span>
          <button
            onClick={() => {
              if (onRestoreBg) {
                onRestoreBg(selectedElement.id)
              } else {
                onUpdateElement(selectedElement.id, { bgRemoved: false })
              }
            }}
            className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
          >
            Restore original image
          </button>
        </div>
      )}
    </div>
  )
}
