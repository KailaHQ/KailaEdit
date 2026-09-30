import React, { useState } from 'react'
import {
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
} from 'lucide-react'
import { FontPicker } from '../../FontPicker'
import type { TextCoverElement } from '../types'
import { CoverColorPickerPopover } from './CoverColorPickerPopover'

export interface CoverTextToolbarProps {
  textElem: TextCoverElement
  onUpdateText: (updates: Partial<TextCoverElement>) => void
}

export const CoverTextToolbar: React.FC<CoverTextToolbarProps> = ({
  textElem,
  onUpdateText,
}) => {
  const [showTextColorPicker, setShowTextColorPicker] = useState(false)
  const [showSpacingPopover, setShowSpacingPopover] = useState(false)

  const isBold =
    textElem.fontWeight === 'bold' ||
    textElem.fontWeight === '700' ||
    textElem.fontWeight === '800' ||
    textElem.fontWeight === '900' ||
    Number(textElem.fontWeight) >= 600

  return (
    <>
      {/* Font Family Picker */}
      <div className="w-36 flex-shrink-0">
        <FontPicker
          value={textElem.fontFamily || 'Inter'}
          onChange={font => onUpdateText({ fontFamily: font })}
          className="h-8 text-xs bg-transparent border-0 hover:bg-zinc-800 text-zinc-200"
        />
      </div>

      <div className="h-4 w-[1px] bg-zinc-700/80 mx-0.5" />

      {/* Font Size (+ / - / input) */}
      <div className="flex items-center h-8 rounded-full border border-zinc-700/70 bg-zinc-850/60 overflow-hidden text-xs">
        <button
          onClick={() => onUpdateText({ fontSize: Math.max(8, (textElem.fontSize || 32) - 2) })}
          className="px-2 h-full hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
          title="Decrease font size"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          value={textElem.fontSize || 32}
          onChange={e => onUpdateText({ fontSize: parseInt(e.target.value, 10) || 12 })}
          className="w-9 text-center bg-transparent text-xs font-semibold text-zinc-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => onUpdateText({ fontSize: Math.min(240, (textElem.fontSize || 32) + 2) })}
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
            setShowSpacingPopover(false)
            setShowTextColorPicker(!showTextColorPicker)
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
          <CoverColorPickerPopover
            currentColor={textElem.color || '#ffffff'}
            onSelectColor={c => onUpdateText({ color: c })}
            onClose={() => setShowTextColorPicker(false)}
            title="Text Color"
          />
        )}
      </div>

      {/* B, I, U, S formatting */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onUpdateText({ fontWeight: isBold ? 'normal' : 'bold' })}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            isBold ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/40' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
          }`}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>

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

        {/* ALL CAPS */}
        <button
          onClick={() => onUpdateText({ textTransform: textElem.textTransform === 'uppercase' ? 'none' : 'uppercase' })}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            textElem.textTransform === 'uppercase' ? 'bg-zinc-800 text-sky-400 ring-1 ring-sky-500/40 font-bold' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
          }`}
          title="All Caps"
        >
          <span className="text-[11px] font-black tracking-tight leading-none select-none">aA</span>
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
            setShowTextColorPicker(false)
            setShowSpacingPopover(!showSpacingPopover)
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
            <div className="fixed inset-0 z-40" onClick={() => setShowSpacingPopover(false)} />
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
  )
}
