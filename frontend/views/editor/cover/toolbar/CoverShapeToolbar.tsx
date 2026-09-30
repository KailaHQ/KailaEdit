import React, { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { ShapeCoverElement, CoverDrawerTab } from '../types'
import { CoverColorPickerPopover } from './CoverColorPickerPopover'

export interface CoverShapeToolbarProps {
  shapeElem: ShapeCoverElement
  activeDrawerTab: CoverDrawerTab | null
  onOpenDrawerTab: (tab: CoverDrawerTab) => void
  onUpdateShape?: (updates: Partial<ShapeCoverElement>) => void
}

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

export const CoverShapeToolbar: React.FC<CoverShapeToolbarProps> = ({
  shapeElem,
  activeDrawerTab,
  onOpenDrawerTab,
  onUpdateShape,
}) => {
  const [showShapeFillPicker, setShowShapeFillPicker] = useState(false)
  const [showShapeBorderPicker, setShowShapeBorderPicker] = useState(false)
  const [showShapeBorderStylePopover, setShowShapeBorderStylePopover] = useState(false)
  const [showShapeCornerPopover, setShowShapeCornerPopover] = useState(false)
  const [showOpacityPopover, setShowOpacityPopover] = useState(false)

  const closeAll = () => {
    setShowShapeFillPicker(false)
    setShowShapeBorderPicker(false)
    setShowShapeBorderStylePopover(false)
    setShowShapeCornerPopover(false)
    setShowOpacityPopover(false)
  }

  const isLine = Boolean(shapeElem.shapeType.startsWith('line') || shapeElem.shapeType.startsWith('arrow'))

  const isPolygonCapable = Boolean(
    shapeElem.shapeType === 'polygon' ||
      shapeElem.shapeType === 'square' ||
      shapeElem.shapeType === 'rounded-rect' ||
      shapeElem.shapeType === 'pentagon' ||
      shapeElem.shapeType === 'triangle' ||
      shapeElem.shapeType === 'hexagon' ||
      shapeElem.shapeType === 'octagon' ||
      shapeElem.sides !== undefined
  )

  const isCornerRoundingCapable = Boolean(
    !isLine && (isPolygonCapable || shapeElem.shapeType === 'diamond')
  )

  return (
    <>
      {/* 1. Edit button */}
      <button
        onClick={() => onOpenDrawerTab('edit')}
        className={`h-8 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
          activeDrawerTab === 'edit'
            ? 'bg-zinc-800 text-sky-400 font-bold ring-1 ring-sky-500/50'
            : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
        }`}
      >
        <span>Edit</span>
      </button>

      {/* 2. Shape Fill Color */}
      <div className="relative">
        <button
          onClick={() => {
            const next = !showShapeFillPicker
            closeAll()
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
          <CoverColorPickerPopover
            currentColor={shapeElem.fillColor || '#3b82f6'}
            onSelectColor={c => onUpdateShape?.({ fillColor: c })}
            onClose={() => setShowShapeFillPicker(false)}
            title="Shape Color"
            showNoneOption={true}
            onSelectNone={() => onUpdateShape?.({ fillColor: 'transparent' })}
          />
        )}
      </div>

      {/* 3. Shape Border Color */}
      <div className="relative">
        <button
          onClick={() => {
            const next = !showShapeBorderPicker
            closeAll()
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
          <CoverColorPickerPopover
            currentColor={shapeElem.strokeColor || '#ffffff'}
            onSelectColor={c =>
              onUpdateShape?.({
                strokeColor: c,
                strokeWidth: shapeElem.strokeWidth && shapeElem.strokeWidth > 0 ? shapeElem.strokeWidth : 3,
              })
            }
            onClose={() => setShowShapeBorderPicker(false)}
            title="Border Color"
            showNoneOption={true}
            onSelectNone={() => onUpdateShape?.({ strokeWidth: 0, strokeColor: 'transparent' })}
          />
        )}
      </div>

      {/* 4. Border Style & Weight */}
      <div className="relative">
        <button
          onClick={() => {
            const next = !showShapeBorderStylePopover
            closeAll()
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
            <div className="fixed inset-0 z-40" onClick={closeAll} />
            <div
              onClick={e => e.stopPropagation()}
              className="absolute top-11 left-1/2 -translate-x-1/2 w-80 p-4 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 space-y-4 backdrop-blur-md"
            >
              {/* 5 Border Style Buttons */}
              <div className="grid grid-cols-5 gap-2">
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

              {/* Stroke weight slider & number input */}
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

      {/* 5. Corner Rounding & Sides */}
      {isCornerRoundingCapable && (
        <div className="relative">
          <button
            onClick={() => {
              const next = !showShapeCornerPopover
              closeAll()
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
              <div className="fixed inset-0 z-40" onClick={closeAll} />
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

                {/* 2. Sides */}
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

      {/* 6. Transparency / Opacity */}
      <div className="relative">
        <button
          onClick={() => {
            const next = !showOpacityPopover
            closeAll()
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
            <div className="fixed inset-0 z-40" onClick={closeAll} />
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
  )
}
