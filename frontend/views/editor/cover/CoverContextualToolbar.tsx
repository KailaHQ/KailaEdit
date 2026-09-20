import React, { useState } from 'react'
import {
  ChevronDown,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  SlidersHorizontal,
  Minus,
  Plus,
  RefreshCw,
  Wand2,
  FlipHorizontal,
  FlipVertical,
  Sparkles,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import type {
  CoverElement,
  CoverDrawerTab,
  TextCoverElement,
  ImageCoverElement,
  ShapeCoverElement,
} from './types'

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

const AVAILABLE_FONTS = [
  { name: 'Inter (Sans)', value: 'Inter, sans-serif' },
  { name: 'Roboto', value: 'Roboto, sans-serif' },
  { name: 'Montserrat', value: 'Montserrat, sans-serif' },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Playfair Display (Serif)', value: 'Playfair Display, serif' },
  { name: 'Merriweather', value: 'Merriweather, serif' },
  { name: 'Lora', value: 'Lora, serif' },
  { name: 'Caveat (Script)', value: 'Caveat, cursive' },
  { name: 'Dancing Script', value: 'Dancing Script, cursive' },
  { name: 'Pacifico', value: 'Pacifico, cursive' },
  { name: 'Courier Prime (Mono)', value: 'Courier Prime, monospace' },
  { name: 'Fira Code', value: 'Fira Code, monospace' },
]

const QUICK_COLORS = [
  '#ffffff',
  '#000000',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#71717a',
]

// Helper for polygon sides to name
function getPolygonName(sides: number): string {
  switch (sides) {
    case 3:
      return 'Triangle (3 sides)'
    case 4:
      return 'Square (4 sides)'
    case 5:
      return 'Pentagon (5 sides)'
    case 6:
      return 'Hexagon (6 sides)'
    case 7:
      return 'Heptagon (7 sides)'
    case 8:
      return 'Octagon (8 sides)'
    case 9:
      return 'Nonagon (9 sides)'
    case 10:
      return 'Decagon (10 sides)'
    case 12:
      return 'Dodecagon (12 sides)'
    default:
      return `Polygon (${sides} sides)`
  }
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
  const [showTextColorPicker, setShowTextColorPicker] = useState(false)
  const [showSpacingPopover, setShowSpacingPopover] = useState(false)
  const [showOpacityPopover, setShowOpacityPopover] = useState(false)
  const [showFontDropdown, setShowFontDropdown] = useState(false)
  const [showShapeCornerPopover, setShowShapeCornerPopover] = useState(false)
  const [showShapeFillPicker, setShowShapeFillPicker] = useState(false)
  const [showShapeBorderPicker, setShowShapeBorderPicker] = useState(false)
  const [showShapeBorderStylePopover, setShowShapeBorderStylePopover] = useState(false)
  const [showFlipPopover, setShowFlipPopover] = useState(false)

  const closeAllPopovers = () => {
    setShowTextColorPicker(false)
    setShowSpacingPopover(false)
    setShowOpacityPopover(false)
    setShowFontDropdown(false)
    setShowShapeCornerPopover(false)
    setShowShapeFillPicker(false)
    setShowShapeBorderPicker(false)
    setShowShapeBorderStylePopover(false)
    setShowFlipPopover(false)
  }

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
  const isLine = Boolean(shapeElem?.shapeType.startsWith('line') || shapeElem?.shapeType.startsWith('arrow'))

  const isPolygonCapable = Boolean(
    shapeElem &&
      (shapeElem.shapeType === 'polygon' ||
        shapeElem.shapeType === 'square' ||
        shapeElem.shapeType === 'rounded-rect' ||
        shapeElem.shapeType === 'pentagon' ||
        shapeElem.shapeType === 'triangle' ||
        shapeElem.shapeType === 'hexagon' ||
        shapeElem.shapeType === 'octagon' ||
        shapeElem.sides !== undefined)
  )

  const isCornerRoundingCapable = Boolean(
    shapeElem &&
      !isLine &&
      (isPolygonCapable || shapeElem.shapeType === 'diamond')
  )

  return (
    <div
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      className="w-full px-4 pt-3 pb-1 flex items-center justify-center z-40 select-none overflow-visible relative flex-shrink-0"
    >
      {/* ─── CANVA FLOATING PILL TOOLBAR (CENTERED & DARK THEME) ─────────────── */}
      <div className="inline-flex items-center gap-1 bg-[#18181b]/95 text-zinc-200 rounded-full shadow-2xl shadow-black/60 border border-zinc-700/80 h-10 px-3 select-none relative max-w-full overflow-visible backdrop-blur-md">
        {/* ─── TEXT CONTROLS ────────────────────────────────────────────── */}
        {isText && textElem && (
          <>
            {/* Font Family Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showFontDropdown
                  closeAllPopovers()
                  setShowFontDropdown(next)
                }}
                className="h-8 px-2.5 rounded-full hover:bg-zinc-800 flex items-center gap-2 max-w-[130px] transition-colors text-zinc-200"
              >
                <span className="truncate font-medium text-xs">
                  {AVAILABLE_FONTS.find(f => f.value === textElem.fontFamily)?.name || textElem.fontFamily || 'Font'}
                </span>
                <ChevronDown className="h-3 w-3 text-zinc-400 flex-shrink-0" />
              </button>

              {showFontDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div className="absolute top-11 left-0 w-52 max-h-64 overflow-y-auto bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 py-1.5 z-50 text-zinc-200 backdrop-blur-md">
                    {AVAILABLE_FONTS.map(f => (
                      <button
                        key={f.value}
                        onClick={() => {
                          onUpdateText({ fontFamily: f.value })
                          setShowFontDropdown(false)
                        }}
                        className={`w-full px-3.5 py-1.5 text-left text-xs hover:bg-zinc-800 flex items-center justify-between transition-colors ${
                          textElem.fontFamily === f.value ? 'text-sky-400 font-bold bg-zinc-800/80' : 'text-zinc-300'
                        }`}
                        style={{ fontFamily: f.value }}
                      >
                        <span>{f.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="h-4 w-[1px] bg-zinc-700/80 mx-0.5" />

            {/* Font Size [-] [size] [+] */}
            <div className="flex items-center rounded-full border border-zinc-700 overflow-hidden h-7 bg-zinc-800/80 shadow-sm">
              <button
                onClick={() => onUpdateText({ fontSize: Math.max(10, (textElem.fontSize || 24) - 2) })}
                className="px-2 h-full hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                title="Decrease font size"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="number"
                value={Math.round(textElem.fontSize || 24)}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val > 4) onUpdateText({ fontSize: val })
                }}
                className="w-9 h-full bg-transparent text-center text-xs font-semibold text-white outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => onUpdateText({ fontSize: Math.min(200, (textElem.fontSize || 24) + 2) })}
                className="px-2 h-full hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                title="Increase font size"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>

            <div className="h-4 w-[1px] bg-zinc-700/80 mx-0.5" />

            {/* Font Color 'A' */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showTextColorPicker
                  closeAllPopovers()
                  setShowTextColorPicker(next)
                }}
                className={`h-8 w-8 rounded-full hover:bg-zinc-800 flex flex-col items-center justify-center transition-colors relative ${
                  showTextColorPicker ? 'bg-zinc-800 ring-1 ring-sky-500/50' : ''
                }`}
                title="Text Color"
              >
                <span className="font-bold text-sm leading-none text-white">A</span>
                <div
                  className="w-4 h-1 rounded-sm mt-0.5 border border-white/20"
                  style={{ backgroundColor: textElem.color || '#ffffff' }}
                />
              </button>

              {showTextColorPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-60 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
                  >
                    <div className="text-[11px] font-semibold text-zinc-400 mb-2">Palette</div>
                    <div className="grid grid-cols-6 gap-1.5 mb-3">
                      {QUICK_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => {
                            onUpdateText({ color: c })
                            setShowTextColorPicker(false)
                          }}
                          className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                            textElem.color === c ? 'border-sky-400 ring-2 ring-sky-500/60' : 'border-white/20'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2.5 border-t border-zinc-800">
                      <span className="text-[10px] text-zinc-400">Custom:</span>
                      <input
                        type="color"
                        value={textElem.color || '#ffffff'}
                        onChange={e => onUpdateText({ color: e.target.value })}
                        className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={textElem.color || '#ffffff'}
                        onChange={e => onUpdateText({ color: e.target.value })}
                        className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-sky-400"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* B, I, U, S formatting */}
            <div className="flex items-center gap-0.5">
              {(() => {
                const isBold =
                  textElem.fontWeight === 'bold' ||
                  textElem.fontWeight === '700' ||
                  textElem.fontWeight === '800' ||
                  textElem.fontWeight === '900' ||
                  Number(textElem.fontWeight) >= 600

                return (
                  <button
                    onClick={() => onUpdateText({ fontWeight: isBold ? 'normal' : 'bold' })}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                      isBold ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/40' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                    title="Bold"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                )
              })()}

              <button
                onClick={() => onUpdateText({ fontStyle: textElem.fontStyle === 'italic' ? 'normal' : 'italic' })}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  textElem.fontStyle === 'italic' ? 'bg-zinc-800 text-sky-400 ring-1 ring-sky-500/40' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Italic"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => onUpdateText({ textDecoration: textElem.textDecoration === 'underline' ? 'none' : 'underline' })}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  textElem.textDecoration === 'underline' ? 'bg-zinc-800 text-sky-400 ring-1 ring-sky-500/40' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Underline"
              >
                <Underline className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => onUpdateText({ textDecoration: textElem.textDecoration === 'line-through' ? 'none' : 'line-through' })}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  textElem.textDecoration === 'line-through' ? 'bg-zinc-800 text-sky-400 ring-1 ring-sky-500/40' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Strikethrough"
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Alignment */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  const alignments: ('left' | 'center' | 'right')[] = ['left', 'center', 'right']
                  const nextIdx = (alignments.indexOf(textElem.textAlign || 'center') + 1) % alignments.length
                  onUpdateText({ textAlign: alignments[nextIdx] })
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                title={`Align: ${textElem.textAlign || 'center'}`}
              >
                {textElem.textAlign === 'left' && <AlignLeft className="h-3.5 w-3.5" />}
                {(!textElem.textAlign || textElem.textAlign === 'center') && <AlignCenter className="h-3.5 w-3.5" />}
                {textElem.textAlign === 'right' && <AlignRight className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Spacing Popover */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showSpacingPopover
                  closeAllPopovers()
                  setShowSpacingPopover(next)
                }}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  showSpacingPopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
                title="Spacing"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>

              {showSpacingPopover && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-64 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 space-y-3.5 text-zinc-200 backdrop-blur-md"
                  >
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1 font-medium">
                        <span>Letter spacing</span>
                        <span>{textElem.letterSpacing || 0}px</span>
                      </div>
                      <input
                        type="range"
                        min={-5}
                        max={30}
                        value={textElem.letterSpacing || 0}
                        onChange={e => onUpdateText({ letterSpacing: parseInt(e.target.value, 10) })}
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1 font-medium">
                        <span>Line height</span>
                        <span>{(textElem.lineHeight || 1.2).toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.8}
                        max={2.5}
                        step={0.1}
                        value={textElem.lineHeight || 1.2}
                        onChange={e => onUpdateText({ lineHeight: parseFloat(e.target.value) })}
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ─── IMAGE / VIDEO CONTROLS ────────────────────────────────────── */}
        {isImage && imgElem && (
          <>
            {/* Edit Image Button */}
            <button
              onClick={() => onOpenDrawerTab('edit')}
              className={`h-8 px-3 rounded-full text-xs font-semibold flex items-center justify-center transition-colors ${
                activeDrawerTab === 'edit' ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50' : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <span>Edit image</span>
            </button>

            {/* Replace Button */}
            {onReplaceImage && selectedElement.type !== 'background' && (
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
                onClick={() => onRestoreBg?.(selectedElement.id)}
                className="h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30"
                title="Khôi phục lại ảnh nền gốc"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Restore BG</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (onRunBgRemoval) {
                    onRunBgRemoval(selectedElement.id)
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
                title="Tự động xóa nền ảnh"
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
                  const next = !showFlipPopover
                  closeAllPopovers()
                  setShowFlipPopover(next)
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
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
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
                  const next = !showOpacityPopover
                  closeAllPopovers()
                  setShowOpacityPopover(next)
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  showOpacityPopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
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
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
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
        )}

        {/* ─── SHAPE CONTROLS (EXACT CANVA ORDER & ICONS) ────────────────────── */}
        {isShape && shapeElem && (
          <>
            {/* 1. Edit button */}
            <button
              onClick={() => onOpenDrawerTab('edit')}
              className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                activeDrawerTab === 'edit' ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50' : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <span>Edit</span>
            </button>

            {/* 2. Shape Fill Color (Solid Circle) */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showShapeFillPicker
                  closeAllPopovers()
                  setShowShapeFillPicker(next)
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  showShapeFillPicker ? 'bg-zinc-800 ring-1 ring-sky-500/50' : 'hover:bg-zinc-800'
                }`}
                title="Fill Color"
              >
                {shapeElem.fillColor === 'transparent' ? (
                  <div className="w-5 h-5 rounded-full border border-zinc-500 relative overflow-hidden bg-white/5 flex items-center justify-center">
                    <div className="w-[130%] h-[1.5px] bg-red-500 rotate-45" />
                  </div>
                ) : (
                  <div
                    className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: shapeElem.fillColor || '#3b82f6' }}
                  />
                )}
              </button>

              {showShapeFillPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-64 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
                  >
                    <div className="text-[11px] text-zinc-400 mb-2 font-medium flex items-center justify-between">
                      <span>Shape Color</span>
                      <button
                        onClick={() => {
                          onUpdateShape?.({ fillColor: 'transparent' })
                          setShowShapeFillPicker(false)
                        }}
                        className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-zinc-800"
                        title="No fill (Transparent)"
                      >
                        <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 relative overflow-hidden flex items-center justify-center">
                          <div className="w-[130%] h-[1px] bg-red-400 rotate-45" />
                        </div>
                        <span>None</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5 mb-3">
                      {QUICK_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => {
                            onUpdateShape?.({ fillColor: c })
                            setShowShapeFillPicker(false)
                          }}
                          className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                            shapeElem.fillColor === c ? 'border-sky-400 ring-2 ring-sky-500/80' : 'border-white/20'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2.5 border-t border-zinc-800">
                      <span className="text-[10px] text-zinc-400">Custom:</span>
                      <input
                        type="color"
                        value={shapeElem.fillColor === 'transparent' ? '#3b82f6' : shapeElem.fillColor || '#3b82f6'}
                        onChange={e => onUpdateShape?.({ fillColor: e.target.value })}
                        className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={shapeElem.fillColor === 'transparent' ? 'transparent' : shapeElem.fillColor || '#3b82f6'}
                        onChange={e => onUpdateShape?.({ fillColor: e.target.value })}
                        className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-sky-400"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 3. Shape Border Color (Donut Ring) */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showShapeBorderPicker
                  closeAllPopovers()
                  setShowShapeBorderPicker(next)
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  showShapeBorderPicker ? 'bg-zinc-800 ring-1 ring-sky-500/50' : 'hover:bg-zinc-800'
                }`}
                title="Border Color"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="7.5"
                    stroke={shapeElem.strokeWidth ? shapeElem.strokeColor || '#ffffff' : '#71717a'}
                    strokeWidth="3.5"
                  />
                  {(!shapeElem.strokeWidth || shapeElem.strokeWidth === 0 || shapeElem.strokeColor === 'transparent') && (
                    <line x1="6.5" y1="17.5" x2="17.5" y2="6.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
                  )}
                </svg>
              </button>

              {showShapeBorderPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-64 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
                  >
                    <div className="text-[11px] text-zinc-400 mb-2 font-medium flex items-center justify-between">
                      <span>Border Color</span>
                      <button
                        onClick={() => {
                          onUpdateShape?.({ strokeWidth: 0, strokeColor: 'transparent' })
                          setShowShapeBorderPicker(false)
                        }}
                        className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-zinc-800"
                        title="No border"
                      >
                        <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 relative overflow-hidden flex items-center justify-center">
                          <div className="w-[130%] h-[1px] bg-red-400 rotate-45" />
                        </div>
                        <span>None</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5 mb-3">
                      {QUICK_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => {
                            onUpdateShape?.({
                              strokeColor: c,
                              strokeWidth: shapeElem.strokeWidth && shapeElem.strokeWidth > 0 ? shapeElem.strokeWidth : 3,
                            })
                            setShowShapeBorderPicker(false)
                          }}
                          className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                            shapeElem.strokeColor === c && (shapeElem.strokeWidth || 0) > 0
                              ? 'border-sky-400 ring-2 ring-sky-500/80'
                              : 'border-white/20'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2.5 border-t border-zinc-800">
                      <span className="text-[10px] text-zinc-400">Custom:</span>
                      <input
                        type="color"
                        value={shapeElem.strokeColor || '#ffffff'}
                        onChange={e =>
                          onUpdateShape?.({
                            strokeColor: e.target.value,
                            strokeWidth: shapeElem.strokeWidth && shapeElem.strokeWidth > 0 ? shapeElem.strokeWidth : 3,
                          })
                        }
                        className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={shapeElem.strokeColor || '#ffffff'}
                        onChange={e =>
                          onUpdateShape?.({
                            strokeColor: e.target.value,
                            strokeWidth: shapeElem.strokeWidth && shapeElem.strokeWidth > 0 ? shapeElem.strokeWidth : 3,
                          })
                        }
                        className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-sky-400"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 4. Border Style & Weight (Canva 3-lines icon) */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showShapeBorderStylePopover
                  closeAllPopovers()
                  setShowShapeBorderStylePopover(next)
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  showShapeBorderStylePopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
                title="Border style & weight"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <rect x="2" y="3" width="16" height="1.5" rx="0.75" />
                  <rect x="2" y="7.5" width="16" height="3" rx="1.5" />
                  <rect x="2" y="13.5" width="16" height="4.5" rx="2" />
                </svg>
              </button>

              {showShapeBorderStylePopover && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-80 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 space-y-4 backdrop-blur-md"
                  >
                    {/* Top row: 5 Border Style Buttons */}
                    <div className="grid grid-cols-5 gap-2">
                      {/* Button 1: None */}
                      <button
                        type="button"
                        onClick={() => onUpdateShape?.({ strokeWidth: 0 })}
                        className={`h-11 rounded-xl flex items-center justify-center border transition-all ${
                          !shapeElem.strokeWidth || shapeElem.strokeWidth === 0
                            ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/20 text-sky-400 shadow-sm'
                            : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                        title="None"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="8" />
                          <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
                        </svg>
                      </button>

                      {/* Button 2: Solid */}
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateShape?.({
                            strokeDasharray: undefined,
                            strokeWidth: (shapeElem.strokeWidth || 0) === 0 ? 4 : shapeElem.strokeWidth,
                            strokeColor: shapeElem.strokeColor || '#ffffff',
                          })
                        }
                        className={`h-11 rounded-xl flex items-center justify-center border transition-all ${
                          (shapeElem.strokeWidth || 0) > 0 && !shapeElem.strokeDasharray
                            ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/20 text-sky-400 shadow-sm'
                            : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                        }`}
                        title="Solid"
                      >
                        <svg className="w-7 h-4" viewBox="0 0 28 8" fill="none">
                          <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      </button>

                      {/* Button 3: Long Dash */}
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateShape?.({
                            strokeDasharray: '8 6',
                            strokeWidth: (shapeElem.strokeWidth || 0) === 0 ? 4 : shapeElem.strokeWidth,
                            strokeColor: shapeElem.strokeColor || '#ffffff',
                          })
                        }
                        className={`h-11 rounded-xl flex items-center justify-center border transition-all ${
                          (shapeElem.strokeWidth || 0) > 0 && shapeElem.strokeDasharray === '8 6'
                            ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/20 text-sky-400 shadow-sm'
                            : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                        }`}
                        title="Dashed"
                      >
                        <svg className="w-7 h-4" viewBox="0 0 28 8" fill="none">
                          <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
                        </svg>
                      </button>

                      {/* Button 4: Short Dash */}
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateShape?.({
                            strokeDasharray: '4 4',
                            strokeWidth: (shapeElem.strokeWidth || 0) === 0 ? 4 : shapeElem.strokeWidth,
                            strokeColor: shapeElem.strokeColor || '#ffffff',
                          })
                        }
                        className={`h-11 rounded-xl flex items-center justify-center border transition-all ${
                          (shapeElem.strokeWidth || 0) > 0 && shapeElem.strokeDasharray === '4 4'
                            ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/20 text-sky-400 shadow-sm'
                            : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                        }`}
                        title="Short Dash"
                      >
                        <svg className="w-7 h-4" viewBox="0 0 28 8" fill="none">
                          <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
                        </svg>
                      </button>

                      {/* Button 5: Dotted */}
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateShape?.({
                            strokeDasharray: '2 4',
                            strokeWidth: (shapeElem.strokeWidth || 0) === 0 ? 4 : shapeElem.strokeWidth,
                            strokeColor: shapeElem.strokeColor || '#ffffff',
                          })
                        }
                        className={`h-11 rounded-xl flex items-center justify-center border transition-all ${
                          (shapeElem.strokeWidth || 0) > 0 && (shapeElem.strokeDasharray === '2 4' || shapeElem.strokeDasharray === '1.5 3')
                            ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/20 text-sky-400 shadow-sm'
                            : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                        }`}
                        title="Dotted"
                      >
                        <svg className="w-7 h-4" viewBox="0 0 28 8" fill="none">
                          <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="1.5 3.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>

                    {/* Bottom row: Stroke weight slider & number input */}
                    <div className="pt-1">
                      <div className="text-xs font-medium text-zinc-300 mb-2">Stroke weight</div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={40}
                          value={shapeElem.strokeWidth || 0}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10)
                            onUpdateShape?.({
                              strokeWidth: val,
                              strokeColor: shapeElem.strokeColor || '#ffffff',
                            })
                          }}
                          className="flex-1 accent-sky-400 cursor-pointer"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={shapeElem.strokeWidth || 0}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val)) {
                              onUpdateShape?.({
                                strokeWidth: Math.max(0, Math.min(100, val)),
                                strokeColor: shapeElem.strokeColor || '#ffffff',
                              })
                            }
                          }}
                          className="w-12 h-9 px-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-center text-xs font-semibold text-white outline-none focus:border-sky-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 5. Corner Rounding & Sides (Canva curved corner icon) */}
            {isCornerRoundingCapable && (
              <div className="relative">
                <button
                  onClick={() => {
                    const next = !showShapeCornerPopover
                    closeAllPopovers()
                    setShowShapeCornerPopover(next)
                  }}
                  className={`h-8 w-8 rounded-full transition-colors flex items-center justify-center ${
                    showShapeCornerPopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                  title="Corner rounding & Sides"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                    <path d="M5 15V10C5 7.23858 7.23858 5 10 5H15" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="15" cy="5" r="2.5" fill="currentColor" />
                  </svg>
                </button>

                {showShapeCornerPopover && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                    <div
                      onClick={e => e.stopPropagation()}
                      className="absolute top-11 left-1/2 -translate-x-1/2 w-72 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 space-y-4 text-zinc-200 backdrop-blur-md"
                    >
                      {/* 1. Corner rounding */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-medium text-zinc-300 mb-2">
                          <span>Corner rounding</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={shapeElem.cornerRounding ?? (shapeElem.shapeType === 'rounded-rect' ? 24 : 0)}
                            onChange={e => {
                              const val = parseInt(e.target.value, 10)
                              if (!isNaN(val)) {
                                onUpdateShape?.({ cornerRounding: Math.max(0, Math.min(100, val)) })
                              }
                            }}
                            className="w-12 h-8 px-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-center text-xs font-semibold text-white outline-none focus:border-sky-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={shapeElem.cornerRounding ?? (shapeElem.shapeType === 'rounded-rect' ? 24 : 0)}
                          onChange={e => onUpdateShape?.({ cornerRounding: parseInt(e.target.value, 10) })}
                          className="w-full accent-sky-400 cursor-pointer"
                        />
                      </div>

                      {/* 2. Sides (for regular polygons and square) */}
                      {isPolygonCapable && (() => {
                        const currentSides = shapeElem.sides ?? (
                          shapeElem.shapeType === 'triangle' ? 3 :
                          shapeElem.shapeType === 'square' || shapeElem.shapeType === 'rounded-rect' ? 4 :
                          shapeElem.shapeType === 'hexagon' ? 6 :
                          shapeElem.shapeType === 'octagon' ? 8 :
                          shapeElem.shapeType === 'pentagon' ? 5 : 4
                        )
                        return (
                          <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                            <div className="flex items-center justify-between text-xs font-medium text-zinc-300">
                              <span>Sides</span>
                              <div className="flex items-center gap-1 bg-zinc-800 rounded-xl border border-zinc-700 p-0.5">
                                <button
                                  onClick={() => {
                                    const newSides = Math.max(3, currentSides - 1)
                                    onUpdateShape?.({
                                      sides: newSides,
                                      shapeType: newSides === 4 ? 'square' : 'polygon',
                                      name: getPolygonName(newSides),
                                    })
                                  }}
                                  className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                                  title="Decrease sides"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <input
                                  type="number"
                                  min={3}
                                  max={16}
                                  value={currentSides}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10)
                                    if (!isNaN(val)) {
                                      const clamped = Math.max(3, Math.min(16, val))
                                      onUpdateShape?.({
                                        sides: clamped,
                                        shapeType: clamped === 4 ? 'square' : 'polygon',
                                        name: getPolygonName(clamped),
                                      })
                                    }
                                  }}
                                  className="w-8 h-6 bg-transparent text-center text-xs font-semibold text-white outline-none focus:text-sky-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                  onClick={() => {
                                    const newSides = Math.min(16, currentSides + 1)
                                    onUpdateShape?.({
                                      sides: newSides,
                                      shapeType: newSides === 4 ? 'square' : 'polygon',
                                      name: getPolygonName(newSides),
                                    })
                                  }}
                                  className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
                                  title="Increase sides"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={3}
                              max={12}
                              value={currentSides}
                              onChange={e => {
                                const newSides = parseInt(e.target.value, 10)
                                onUpdateShape?.({
                                  sides: newSides,
                                  shapeType: newSides === 4 ? 'square' : 'polygon',
                                  name: getPolygonName(newSides),
                                })
                              }}
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                            <div className="text-[11px] text-sky-400/90 font-medium">
                              {getPolygonName(currentSides)}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 6. Transparency / Opacity (Canva checkerboard icon) */}
            <div className="relative">
              <button
                onClick={() => {
                  const next = !showOpacityPopover
                  closeAllPopovers()
                  setShowOpacityPopover(next)
                }}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  showOpacityPopover ? 'bg-zinc-800 ring-1 ring-sky-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
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
                  <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                  <div
                    onClick={e => e.stopPropagation()}
                    className="absolute top-11 left-1/2 -translate-x-1/2 w-60 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
                  >
                    <div className="flex justify-between text-xs text-zinc-400 mb-2 font-medium">
                      <span>Transparency</span>
                      <span>{Math.round((shapeElem.opacity ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((shapeElem.opacity ?? 1) * 100)}
                      onChange={e => onUpdateShape?.({ opacity: parseInt(e.target.value, 10) / 100 })}
                      className="w-full accent-sky-400 cursor-pointer"
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ─── COMMON CANVA ACTIONS (EFFECTS, ANIMATE, POSITION, COPY STYLE) ─── */}
        {/* Effects */}
        <button
          onClick={() => onOpenDrawerTab('effects')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'effects' ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50' : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <span>Effects</span>
        </button>

        {/* Template (formerly Animate) */}
        <button
          onClick={() => onOpenDrawerTab('templates')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'templates' ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50' : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
          }`}
          title="Templates"
        >
          <span>Template</span>
        </button>

        {/* Position */}
        <button
          onClick={() => onOpenDrawerTab('position')}
          className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            activeDrawerTab === 'position' ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50' : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
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
