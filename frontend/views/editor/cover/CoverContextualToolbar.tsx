import React from 'react'
import { Sparkles } from 'lucide-react'
import type {
  CoverElement,
  CoverDrawerTab,
  TextCoverElement,
  ImageCoverElement,
  ShapeCoverElement,
} from './types'
import { CoverTextToolbar } from './toolbar/CoverTextToolbar'
import { CoverImageToolbar } from './toolbar/CoverImageToolbar'
import { CoverShapeToolbar } from './toolbar/CoverShapeToolbar'

export interface CoverContextualToolbarProps {
  selectedElement: CoverElement | null
  activeDrawerTab: CoverDrawerTab | null
  onOpenDrawerTab: (tab: CoverDrawerTab) => void
  onUpdateText: (updates: Partial<TextCoverElement>) => void
  onUpdateImage: (updates: Partial<ImageCoverElement>) => void
  onUpdateShape?: (updates: Partial<ShapeCoverElement>) => void
  onReplaceImage?: () => void
  onDuplicate?: (id: string) => void
  onRunBgRemoval?: (id: string) => Promise<void>
  onRestoreBg?: (id: string) => void
  isProcessingBgRemoval?: boolean
}

export const CoverContextualToolbar: React.FC<CoverContextualToolbarProps> = ({
  selectedElement,
  activeDrawerTab,
  onOpenDrawerTab,
  onUpdateText,
  onUpdateImage,
  onUpdateShape,
  onReplaceImage,
  onDuplicate,
  onRunBgRemoval,
  onRestoreBg,
  isProcessingBgRemoval = false,
}) => {
  // ─── NO ELEMENT SELECTED STATE (CENTERED PILL) ─────────────────────────────
  if (!selectedElement) {
    return (
      <div
        onClick={e => e.stopPropagation()}
        className="w-full px-4 pt-3 pb-1 flex items-center justify-center z-40 select-none overflow-visible relative flex-shrink-0"
      >
        <div className="inline-flex items-center gap-2 bg-[#18181b]/95 text-zinc-400 rounded-full shadow-2xl shadow-black/50 border border-zinc-700/80 h-10 px-5 text-xs font-medium backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>Click any element on the cover to customize it, or add items from the left panel</span>
        </div>
      </div>
    )
  }

  const isText = selectedElement.type === 'text'
  const textElem = isText ? (selectedElement as TextCoverElement) : null
  const isImage = selectedElement.type === 'image' || selectedElement.type === 'background'
  const imgElem = isImage ? (selectedElement as ImageCoverElement) : null
  const isShape = selectedElement.type === 'shape'
  const shapeElem = isShape ? (selectedElement as ShapeCoverElement) : null

  return (
    <div
      onClick={e => e.stopPropagation()}
      className="w-full px-4 pt-3 pb-1 flex items-center justify-center z-40 select-none overflow-visible relative flex-shrink-0"
    >
      <div className="inline-flex items-center gap-1.5 bg-[#18181b]/95 border border-zinc-700/80 rounded-full shadow-2xl shadow-black/80 h-11 px-3 backdrop-blur-md max-w-full">
        {/* TEXT CONTROLS */}
        {isText && textElem && (
          <CoverTextToolbar textElem={textElem} onUpdateText={onUpdateText} />
        )}

        {/* IMAGE / VIDEO CONTROLS */}
        {isImage && imgElem && (
          <CoverImageToolbar
            elementId={selectedElement.id}
            imgElem={imgElem}
            isBackground={selectedElement.type === 'background'}
            activeDrawerTab={activeDrawerTab}
            onOpenDrawerTab={onOpenDrawerTab}
            onUpdateImage={onUpdateImage}
            onReplaceImage={onReplaceImage}
            onRunBgRemoval={onRunBgRemoval}
            onRestoreBg={onRestoreBg}
            isProcessingBgRemoval={isProcessingBgRemoval}
          />
        )}

        {/* SHAPE CONTROLS */}
        {isShape && shapeElem && (
          <CoverShapeToolbar
            shapeElem={shapeElem}
            activeDrawerTab={activeDrawerTab}
            onOpenDrawerTab={onOpenDrawerTab}
            onUpdateShape={onUpdateShape}
          />
        )}

        {/* COMMON CANVA ACTIONS (EFFECTS, ANIMATE, POSITION, COPY STYLE) */}
        {/* Effects */}
        <button
          onClick={() => onOpenDrawerTab('effects')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'effects'
              ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50'
              : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <span>Effects</span>
        </button>

        {/* Template (formerly Animate) */}
        <button
          onClick={() => onOpenDrawerTab('templates')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'templates'
              ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50'
              : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
          title="Templates"
        >
          <span>Template</span>
        </button>

        {/* Position */}
        <button
          onClick={() => onOpenDrawerTab('position')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'position'
              ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50'
              : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <span>Position</span>
        </button>

        {/* Vertical divider */}
        <div className="h-4 w-[1px] bg-zinc-700/80 mx-1 flex-shrink-0" />

        {/* Paint Roller (Copy style / Duplicate) */}
        <button
          onClick={() => {
            if (selectedElement && onDuplicate) {
              onDuplicate(selectedElement.id)
            }
          }}
          className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Duplicate / Copy style"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="16" height="6" rx="2" />
            <path d="M10 8v4a2 2 0 0 0 2 2h2" />
            <path d="M14 14v6a1 1 0 0 0 1 1h0a1 1 0 0 0 1-1v-6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
