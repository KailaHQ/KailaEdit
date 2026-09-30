import React from 'react'
import type { TextCoverElement } from '../types'
import { COVER_TEXT_PRESETS } from '../cover-text-presets'

export interface CoverTextTabProps {
  onAddText?: (type?: 'heading' | 'subheading' | 'body', customProps?: Partial<TextCoverElement>) => void
}

export const CoverTextTab: React.FC<CoverTextTabProps> = ({ onAddText }) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Action buttons (Add a title, Add a subtitle, Add body text) */}
      <div className="p-4 border-b border-zinc-800/80 space-y-2.5 flex-shrink-0">
        <button
          onClick={() => onAddText?.('heading')}
          className="w-full h-12 rounded-xl bg-zinc-800/90 hover:bg-zinc-750 active:bg-zinc-700 text-white font-bold text-base transition-all border border-zinc-700/50 hover:border-zinc-600 flex items-center justify-center shadow-sm"
        >
          Add a title
        </button>
        <button
          onClick={() => onAddText?.('subheading')}
          className="w-full h-11 rounded-xl bg-zinc-800/80 hover:bg-zinc-750 active:bg-zinc-700 text-zinc-200 font-semibold text-sm transition-all border border-zinc-700/50 hover:border-zinc-600 flex items-center justify-center shadow-sm"
        >
          Add a subtitle
        </button>
        <button
          onClick={() => onAddText?.('body')}
          className="w-full h-10 rounded-xl bg-zinc-800/70 hover:bg-zinc-750 active:bg-zinc-700 text-zinc-300 font-normal text-xs transition-all border border-zinc-700/50 hover:border-zinc-600 flex items-center justify-center shadow-sm"
        >
          Add body text
        </button>
      </div>

      {/* Recommended section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs font-bold text-zinc-200 tracking-wide">
          Recommended
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {COVER_TEXT_PRESETS.map(preset => {
            const s = preset.style
            // Every length below is measured against the preset's own font size, so the
            // tile shrinks them by the same factor it shrinks the font.
            const tileFont = Math.min(16, (s.fontSize || 32) * 0.42)
            const k = tileFont / (s.fontSize || 32)
            const textShadow = s.shadow?.enabled
              ? `${s.shadow.offsetX * k}px ${s.shadow.offsetY * k}px ${s.shadow.blur * k}px ${s.shadow.color}`
              : undefined
            const webkitTextStroke = s.stroke?.enabled
              ? `${s.stroke.width * k}px ${s.stroke.color}`
              : undefined

            return (
              <button
                key={preset.id}
                onClick={() => onAddText?.('heading', s)}
                className="group relative h-28 rounded-xl bg-[#23252b] hover:bg-[#2b2d35] border border-zinc-800/80 hover:border-sky-500/60 transition-all flex items-center justify-center p-2.5 text-center overflow-hidden shadow-sm hover:shadow-md cursor-pointer"
                title={`Add "${preset.name}"`}
              >
                <span
                  className="transition-transform group-hover:scale-105 leading-tight line-clamp-2 select-none"
                  style={{
                    fontFamily: s.fontFamily,
                    fontSize: tileFont,
                    fontWeight: s.fontWeight,
                    fontStyle: s.fontStyle,
                    color: s.color,
                    textTransform: s.textTransform,
                    letterSpacing: s.letterSpacing ? `${s.letterSpacing * k}px` : undefined,
                    paintOrder: 'stroke fill',
                    textShadow,
                    WebkitTextStroke: webkitTextStroke,
                    backgroundColor: s.backgroundColor ? `${s.backgroundColor}` : undefined,
                    padding: s.backgroundColor ? '2px 6px' : undefined,
                    borderRadius: s.backgroundColor ? '4px' : undefined,
                  }}
                >
                  {preset.previewText}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
