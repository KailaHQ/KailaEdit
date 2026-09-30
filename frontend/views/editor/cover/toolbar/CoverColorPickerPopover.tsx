import React from 'react'

export const QUICK_COLORS = [
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

export interface CoverColorPickerPopoverProps {
  currentColor: string
  onSelectColor: (color: string) => void
  onClose: () => void
  title?: string
  showNoneOption?: boolean
  onSelectNone?: () => void
}

export const CoverColorPickerPopover: React.FC<CoverColorPickerPopoverProps> = ({
  currentColor,
  onSelectColor,
  onClose,
  title = 'Palette',
  showNoneOption = false,
  onSelectNone,
}) => {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        onClick={e => e.stopPropagation()}
        className="absolute top-11 left-1/2 -translate-x-1/2 w-64 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
      >
        <div className="text-[11px] font-semibold text-zinc-400 mb-2 flex items-center justify-between">
          <span>{title}</span>
          {showNoneOption && onSelectNone && (
            <button
              onClick={() => {
                onSelectNone()
                onClose()
              }}
              className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-zinc-800"
              title="None (Transparent)"
            >
              <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 relative overflow-hidden flex items-center justify-center">
                <div className="w-[130%] h-[1px] bg-red-400 rotate-45" />
              </div>
              <span>None</span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-6 gap-1.5 mb-3">
          {QUICK_COLORS.map(c => (
            <button
              key={c}
              onClick={() => {
                onSelectColor(c)
                onClose()
              }}
              className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                currentColor === c ? 'border-sky-400 ring-2 ring-sky-500/80' : 'border-white/20'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2.5 border-t border-zinc-800">
          <span className="text-[10px] text-zinc-400">Custom:</span>
          <input
            type="color"
            value={currentColor === 'transparent' ? '#ffffff' : currentColor || '#ffffff'}
            onChange={e => onSelectColor(e.target.value)}
            className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
          />
          <input
            type="text"
            value={currentColor === 'transparent' ? 'transparent' : currentColor || '#ffffff'}
            onChange={e => onSelectColor(e.target.value)}
            className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-sky-400"
          />
        </div>
      </div>
    </>
  )
}
