import React, { useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Wand2,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import type { ImageCoverElement, CoverDrawerTab } from '../types'

export interface CoverImageToolbarProps {
  elementId: string
  imgElem: ImageCoverElement
  isBackground: boolean
  activeDrawerTab: CoverDrawerTab | null
  onOpenDrawerTab: (tab: CoverDrawerTab) => void
  onUpdateImage: (updates: Partial<ImageCoverElement>) => void
  onReplaceImage?: () => void
  onRunBgRemoval?: (id: string) => Promise<void>
  onRestoreBg?: (id: string) => void
  isProcessingBgRemoval?: boolean
}

export const CoverImageToolbar: React.FC<CoverImageToolbarProps> = ({
  elementId,
  imgElem,
  isBackground,
  activeDrawerTab,
  onOpenDrawerTab,
  onUpdateImage,
  onReplaceImage,
  onRunBgRemoval,
  onRestoreBg,
  isProcessingBgRemoval = false,
}) => {
  const [showFlipPopover, setShowFlipPopover] = useState(false)
  const [showOpacityPopover, setShowOpacityPopover] = useState(false)

  return (
    <>
      {/* Edit Image Button */}
      <button
        onClick={() => onOpenDrawerTab('edit')}
        className={`h-8 px-3 rounded-full text-xs font-semibold flex items-center justify-center transition-colors ${
          activeDrawerTab === 'edit'
            ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50'
            : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
        }`}
      >
        <span>Edit image</span>
      </button>

      {/* Replace Button */}
      {onReplaceImage && !isBackground && (
        <button
          onClick={onReplaceImage}
          className="h-8 px-3 rounded-full text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="h-3 w-3 text-zinc-400" />
          <span>Replace</span>
        </button>
      )}

      {/* Remove BG (Built-in cutout) */}
      {imgElem.bgRemoved ? (
        <button
          onClick={() => onRestoreBg?.(elementId)}
          className="h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30"
          title="Restore original background image"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Restore BG</span>
        </button>
      ) : (
        <button
          onClick={() => {
            if (onRunBgRemoval) {
              onRunBgRemoval(elementId)
            } else {
              onOpenDrawerTab('bg-remover')
            }
          }}
          disabled={isProcessingBgRemoval}
          className={`h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
            isProcessingBgRemoval
              ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50 cursor-wait'
              : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
          title="Auto remove image background"
        >
          {isProcessingBgRemoval ? (
            <>
              <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin" />
              <span className="text-sky-400">Removing...</span>
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5 text-sky-400" />
              <span>Remove BG</span>
            </>
          )}
        </button>
      )}

      {/* Flip Button & Popover */}
      <div className="relative">
        <button
          onClick={() => {
            setShowOpacityPopover(false)
            setShowFlipPopover(!showFlipPopover)
          }}
          className={`h-8 px-2.5 rounded-full text-xs font-semibold flex items-center gap-1 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors ${
            showFlipPopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : ''
          }`}
          title="Flip"
        >
          <span>Flip</span>
          <ChevronDown className="h-3 w-3 text-zinc-400" />
        </button>

        {showFlipPopover && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowFlipPopover(false)} />
            <div className="absolute top-11 left-1/2 -translate-x-1/2 w-44 p-1.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 space-y-1 backdrop-blur-md">
              <button
                onClick={() => {
                  onUpdateImage({ flipH: !imgElem.flipH })
                  setShowFlipPopover(false)
                }}
                className="w-full px-3 py-1.5 rounded-xl hover:bg-zinc-800 text-left text-xs font-medium flex items-center gap-2"
              >
                <FlipHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                <span>Flip horizontal</span>
              </button>
              <button
                onClick={() => {
                  onUpdateImage({ flipV: !imgElem.flipV })
                  setShowFlipPopover(false)
                }}
                className="w-full px-3 py-1.5 rounded-xl hover:bg-zinc-800 text-left text-xs font-medium flex items-center gap-2"
              >
                <FlipVertical className="h-3.5 w-3.5 text-zinc-400" />
                <span>Flip vertical</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Transparency (Canva checkerboard icon) */}
      <div className="relative">
        <button
          onClick={() => {
            setShowFlipPopover(false)
            setShowOpacityPopover(!showOpacityPopover)
          }}
          className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
            showOpacityPopover
              ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white'
              : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
          }`}
          title="Transparency"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="0" y="0" width="4" height="4" />
            <rect x="8" y="0" width="4" height="4" />
            <rect x="4" y="4" width="4" height="4" />
            <rect x="12" y="4" width="4" height="4" />
            <rect x="0" y="8" width="4" height="4" />
            <rect x="8" y="8" width="4" height="4" />
            <rect x="4" y="12" width="4" height="4" />
            <rect x="12" y="12" width="4" height="4" />
          </svg>
        </button>

        {showOpacityPopover && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowOpacityPopover(false)} />
            <div
              onClick={e => e.stopPropagation()}
              className="absolute top-11 left-1/2 -translate-x-1/2 w-60 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
            >
              <div className="flex justify-between text-xs text-zinc-400 mb-2 font-medium">
                <span>Transparency</span>
                <span>{Math.round((imgElem.opacity ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((imgElem.opacity ?? 1) * 100)}
                onChange={e => onUpdateImage({ opacity: parseInt(e.target.value, 10) / 100 })}
                className="w-full accent-sky-400 cursor-pointer"
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}
