import { useState } from 'react'
import { RotateCcw, Minus, Plus } from 'lucide-react'
import type { TimelineClip, ShapeProperties } from '../../../types/project-model'
import { useEditorActions } from '../editor-store'
import { getShapeDefinitionForClip } from '../timeline-shape-utils'
import { PropertyNumberInput } from '../PropertyControls'

export interface ShapePropertiesSectionProps {
  selectedClip: TimelineClip
}

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

export function ShapePropertiesSection({ selectedClip }: ShapePropertiesSectionProps) {
  const { updateClip } = useEditorActions()

  // Popovers state (matching Cover Studio toolbar)
  const [showFillPicker, setShowFillPicker] = useState(false)
  const [showBorderPicker, setShowBorderPicker] = useState(false)
  const [showBorderStylePopover, setShowBorderStylePopover] = useState(false)
  const [showCornerPopover, setShowCornerPopover] = useState(false)
  const [showOpacityPopover, setShowOpacityPopover] = useState(false)

  const closeAllPopovers = () => {
    setShowFillPicker(false)
    setShowBorderPicker(false)
    setShowBorderStylePopover(false)
    setShowCornerPopover(false)
    setShowOpacityPopover(false)
  }

  const { shapeType, shapeDef } = getShapeDefinitionForClip(selectedClip)
  const isLine = Boolean(
    shapeDef?.category === 'line' ||
    shapeType.startsWith('line') ||
    shapeType.startsWith('arrow')
  )

  const isPolygonCapable = Boolean(
    shapeType === 'polygon' ||
    shapeType === 'square' ||
    shapeType === 'rounded-rect' ||
    shapeType === 'pentagon' ||
    shapeType === 'triangle' ||
    shapeType === 'hexagon' ||
    shapeType === 'octagon'
  )

  const isCornerRoundingCapable = Boolean(
    !isLine &&
    (isPolygonCapable || shapeType === 'diamond')
  )

  const defaultSides =
    shapeType === 'triangle' ? 3 :
    shapeType === 'square' || shapeType === 'rounded-rect' ? 4 :
    shapeType === 'pentagon' ? 5 :
    shapeType === 'hexagon' ? 6 :
    shapeType === 'octagon' ? 8 : 4

  const currentProps: ShapeProperties = selectedClip.shapeProperties || {}
  const fillColor = currentProps.fillColor ?? shapeDef?.defaultFill ?? (isLine ? 'transparent' : '#3b82f6')
  const strokeColor = currentProps.strokeColor ?? shapeDef?.defaultStroke ?? (isLine ? '#ffffff' : '#ffffff')
  const strokeWidth = currentProps.strokeWidth !== undefined
    ? currentProps.strokeWidth
    : (shapeDef?.defaultStrokeWidth ?? (isLine ? 4 : 0))
  const strokeDasharray = currentProps.strokeDasharray ?? shapeDef?.defaultStrokeDasharray
  const cornerRounding = currentProps.cornerRounding ?? shapeDef?.defaultCornerRounding ?? (shapeType === 'rounded-rect' ? 24 : 0)
  const sides = currentProps.sides ?? shapeDef?.defaultSides ?? defaultSides
  const opacity = selectedClip.opacity ?? 100

  const updateShapeProps = (patch: Partial<ShapeProperties>) => {
    updateClip(selectedClip.id, {
      shapeProperties: {
        ...currentProps,
        fillColor,
        strokeColor,
        strokeWidth,
        strokeDasharray,
        cornerRounding,
        // Only a polygon has sides. Writing them on every edit made a circle or a star
        // look polygon-capable to this panel (and, before, to the renderer as well).
        ...(isPolygonCapable ? { sides } : {}),
        ...patch,
      },
    })
  }

  const handleResetShape = () => {
    updateClip(selectedClip.id, {
      shapeProperties: undefined,
    })
  }

  return (
    <div className="space-y-3 pb-3 border-b border-zinc-800/80">
      {/* Section Header */}
      <div className="flex items-center justify-between h-6">
        <span className="text-xs font-semibold text-zinc-200">Shape</span>
        <button
          type="button"
          onClick={handleResetShape}
          className="text-zinc-400 hover:text-cyan-400 transition-colors p-0.5"
          title="Reset Shape Properties"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Quick Toolbar Row (Exact Cover Edit 5 Icons) */}
      <div className="flex items-center justify-around bg-[#141416] p-1.5 rounded-xl border border-zinc-800/90 select-none relative">
        {/* 1. Fill Color (Solid Circle) */}
        {!isLine && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                const next = !showFillPicker
                closeAllPopovers()
                setShowFillPicker(next)
              }}
              className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
                showFillPicker ? 'bg-zinc-800 ring-1 ring-cyan-500/50' : 'hover:bg-zinc-800'
              }`}
              title="Fill Color"
            >
              {fillColor === 'transparent' ? (
                <div className="w-5 h-5 rounded-full border border-zinc-500 relative overflow-hidden bg-white/5 flex items-center justify-center">
                  <div className="w-[130%] h-[1.5px] bg-red-500 rotate-45" />
                </div>
              ) : (
                <div
                  className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                  style={{ backgroundColor: fillColor }}
                />
              )}
            </button>

            {showFillPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                <div
                  onClick={e => e.stopPropagation()}
                  className="absolute top-9 left-0 w-64 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
                >
                  <div className="text-[11px] text-zinc-400 mb-2 font-medium flex items-center justify-between">
                    <span>Fill Color</span>
                    <button
                      type="button"
                      onClick={() => {
                        updateShapeProps({ fillColor: 'transparent' })
                        setShowFillPicker(false)
                      }}
                      className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-zinc-800"
                    >
                      <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 relative overflow-hidden flex items-center justify-center">
                        <div className="w-[130%] h-[1px] bg-red-400 rotate-45" />
                      </div>
                      <span>None</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 mb-2.5">
                    {QUICK_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          updateShapeProps({ fillColor: c })
                          setShowFillPicker(false)
                        }}
                        className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                          fillColor === c ? 'border-cyan-400 ring-2 ring-cyan-500/80' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                    <span className="text-[10px] text-zinc-400">Custom:</span>
                    <input
                      type="color"
                      value={fillColor === 'transparent' ? '#3b82f6' : fillColor}
                      onChange={e => updateShapeProps({ fillColor: e.target.value })}
                      className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={fillColor}
                      onChange={e => updateShapeProps({ fillColor: e.target.value })}
                      className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-cyan-400 outline-none"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 2. Shape Border Color (Donut Ring) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !showBorderPicker
              closeAllPopovers()
              setShowBorderPicker(next)
            }}
            className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
              showBorderPicker ? 'bg-zinc-800 ring-1 ring-cyan-500/50' : 'hover:bg-zinc-800'
            }`}
            title="Border Color"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="7.5"
                stroke={strokeWidth > 0 ? strokeColor : '#71717a'}
                strokeWidth="3.5"
              />
              {(strokeWidth === 0 || strokeColor === 'transparent') && (
                <line x1="6.5" y1="17.5" x2="17.5" y2="6.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>

          {showBorderPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
              <div
                onClick={e => e.stopPropagation()}
                className="absolute top-9 left-1/2 -translate-x-1/2 w-64 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
              >
                <div className="text-[11px] text-zinc-400 mb-2 font-medium flex items-center justify-between">
                  <span>Border Color</span>
                  <button
                    type="button"
                    onClick={() => {
                      updateShapeProps({ strokeWidth: 0, strokeColor: 'transparent' })
                      setShowBorderPicker(false)
                    }}
                    className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-zinc-800"
                  >
                    <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 relative overflow-hidden flex items-center justify-center">
                      <div className="w-[130%] h-[1px] bg-red-400 rotate-45" />
                    </div>
                    <span>None</span>
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-1.5 mb-2.5">
                  {QUICK_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        updateShapeProps({
                          strokeColor: c,
                          strokeWidth: strokeWidth > 0 ? strokeWidth : 3,
                        })
                        setShowBorderPicker(false)
                      }}
                      className={`w-6 h-6 rounded-md border hover:scale-110 transition-transform shadow-sm ${
                        strokeColor === c && strokeWidth > 0
                          ? 'border-cyan-400 ring-2 ring-cyan-500/80'
                          : 'border-white/20'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                  <span className="text-[10px] text-zinc-400">Custom:</span>
                  <input
                    type="color"
                    value={strokeColor || '#ffffff'}
                    onChange={e =>
                      updateShapeProps({
                        strokeColor: e.target.value,
                        strokeWidth: strokeWidth > 0 ? strokeWidth : 3,
                      })
                    }
                    className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={strokeColor || '#ffffff'}
                    onChange={e =>
                      updateShapeProps({
                        strokeColor: e.target.value,
                        strokeWidth: strokeWidth > 0 ? strokeWidth : 3,
                      })
                    }
                    className="flex-1 px-2 py-1 text-xs bg-zinc-800 rounded-lg border border-zinc-700 uppercase font-mono text-zinc-200 focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 3. Border Style & Weight (3 Horizontal Lines Icon) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !showBorderStylePopover
              closeAllPopovers()
              setShowBorderStylePopover(next)
            }}
            className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
              showBorderStylePopover ? 'bg-zinc-800 ring-1 ring-cyan-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
            }`}
            title="Border style & weight"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <rect x="2" y="3" width="16" height="1.5" rx="0.75" />
              <rect x="2" y="7.5" width="16" height="3" rx="1.5" />
              <rect x="2" y="13.5" width="16" height="4.5" rx="2" />
            </svg>
          </button>

          {showBorderStylePopover && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
              <div
                onClick={e => e.stopPropagation()}
                className="absolute top-9 left-1/2 -translate-x-1/2 w-72 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 space-y-3.5 backdrop-blur-md"
              >
                {/* 5 Border Style Buttons */}
                <div className="grid grid-cols-5 gap-1.5">
                  {/* Button 1: None */}
                  <button
                    type="button"
                    onClick={() => updateShapeProps({ strokeWidth: 0 })}
                    className={`h-9 rounded-xl flex items-center justify-center border transition-all ${
                      strokeWidth === 0
                        ? 'border-cyan-500 ring-1 ring-cyan-500 bg-cyan-500/20 text-cyan-400'
                        : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                    title="None"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="8" />
                      <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
                    </svg>
                  </button>

                  {/* Button 2: Solid */}
                  <button
                    type="button"
                    onClick={() =>
                      updateShapeProps({
                        strokeDasharray: undefined,
                        strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                        strokeColor: strokeColor || '#ffffff',
                      })
                    }
                    className={`h-9 rounded-xl flex items-center justify-center border transition-all ${
                      strokeWidth > 0 && !strokeDasharray
                        ? 'border-cyan-500 ring-1 ring-cyan-500 bg-cyan-500/20 text-cyan-400'
                        : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                    }`}
                    title="Solid"
                  >
                    <svg className="w-6 h-3" viewBox="0 0 28 8" fill="none">
                      <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </button>

                  {/* Button 3: Dashed */}
                  <button
                    type="button"
                    onClick={() =>
                      updateShapeProps({
                        strokeDasharray: '8 6',
                        strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                        strokeColor: strokeColor || '#ffffff',
                      })
                    }
                    className={`h-9 rounded-xl flex items-center justify-center border transition-all ${
                      strokeWidth > 0 && strokeDasharray === '8 6'
                        ? 'border-cyan-500 ring-1 ring-cyan-500 bg-cyan-500/20 text-cyan-400'
                        : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                    }`}
                    title="Dashed"
                  >
                    <svg className="w-6 h-3" viewBox="0 0 28 8" fill="none">
                      <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
                    </svg>
                  </button>

                  {/* Button 4: Short Dash */}
                  <button
                    type="button"
                    onClick={() =>
                      updateShapeProps({
                        strokeDasharray: '4 4',
                        strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                        strokeColor: strokeColor || '#ffffff',
                      })
                    }
                    className={`h-9 rounded-xl flex items-center justify-center border transition-all ${
                      strokeWidth > 0 && strokeDasharray === '4 4'
                        ? 'border-cyan-500 ring-1 ring-cyan-500 bg-cyan-500/20 text-cyan-400'
                        : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                    }`}
                    title="Short Dash"
                  >
                    <svg className="w-6 h-3" viewBox="0 0 28 8" fill="none">
                      <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
                    </svg>
                  </button>

                  {/* Button 5: Dotted */}
                  <button
                    type="button"
                    onClick={() =>
                      updateShapeProps({
                        strokeDasharray: '2 4',
                        strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                        strokeColor: strokeColor || '#ffffff',
                      })
                    }
                    className={`h-9 rounded-xl flex items-center justify-center border transition-all ${
                      strokeWidth > 0 && (strokeDasharray === '2 4' || strokeDasharray === '1.5 3')
                        ? 'border-cyan-500 ring-1 ring-cyan-500 bg-cyan-500/20 text-cyan-400'
                        : 'border-zinc-700/80 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                    }`}
                    title="Dotted"
                  >
                    <svg className="w-6 h-3" viewBox="0 0 28 8" fill="none">
                      <line x1="2" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="1.5 3.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Stroke weight slider */}
                <div>
                  <div className="text-xs font-medium text-zinc-300 mb-1.5">Stroke weight</div>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      value={strokeWidth}
                      onChange={e => updateShapeProps({ strokeWidth: parseInt(e.target.value, 10) })}
                      className="flex-1 accent-cyan-400 cursor-pointer"
                    />
                    <PropertyNumberInput
                      value={strokeWidth}
                      min={0}
                      max={100}
                      suffix="px"
                      className="w-14"
                      onChange={val => updateShapeProps({ strokeWidth: val })}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 4. Corner Rounding & Sides (Curved Corner Icon) */}
        {isCornerRoundingCapable && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                const next = !showCornerPopover
                closeAllPopovers()
                setShowCornerPopover(next)
              }}
              className={`h-7 w-7 rounded-full transition-colors flex items-center justify-center ${
                showCornerPopover ? 'bg-zinc-800 ring-1 ring-cyan-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
              }`}
              title="Corner rounding & Sides"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                <path d="M5 15V10C5 7.23858 7.23858 5 10 5H15" strokeWidth="2" strokeLinecap="round" />
                <circle cx="15" cy="5" r="2.5" fill="currentColor" />
              </svg>
            </button>

            {showCornerPopover && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeAllPopovers} />
                <div
                  onClick={e => e.stopPropagation()}
                  className="absolute top-9 left-1/2 -translate-x-1/2 w-64 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 space-y-3.5 text-zinc-200 backdrop-blur-md"
                >
                  {/* Corner rounding */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-300 mb-1.5">
                      <span>Corner rounding</span>
                      <PropertyNumberInput
                        value={cornerRounding}
                        min={0}
                        max={100}
                        className="w-12"
                        onChange={val => updateShapeProps({ cornerRounding: val })}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={cornerRounding}
                      onChange={e => updateShapeProps({ cornerRounding: parseInt(e.target.value, 10) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  {/* Sides (for polygon-capable shapes) */}
                  {isPolygonCapable && (
                    <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-300">
                        <span>Sides</span>
                        <div className="flex items-center gap-1 bg-zinc-800 rounded-lg border border-zinc-700 p-0.5">
                          <button
                            type="button"
                            onClick={() => updateShapeProps({ sides: Math.max(3, sides - 1) })}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-300 hover:text-white"
                            title="Decrease sides"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-7 text-center text-xs font-semibold text-white">
                            {sides}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateShapeProps({ sides: Math.min(16, sides + 1) })}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-300 hover:text-white"
                            title="Increase sides"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 5. Opacity / Transparency (Checkerboard 4x4 Icon) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const next = !showOpacityPopover
              closeAllPopovers()
              setShowOpacityPopover(next)
            }}
            className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
              showOpacityPopover ? 'bg-zinc-800 ring-1 ring-cyan-500/50 text-white' : 'hover:bg-zinc-800 text-zinc-300 hover:text-white'
            }`}
            title="Opacity / Transparency"
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
                className="absolute top-9 right-0 w-60 p-3.5 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md"
              >
                <div className="flex justify-between text-xs text-zinc-400 mb-2 font-medium">
                  <span>Opacity</span>
                  <span>{Math.round(opacity)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity)}
                  onChange={e => updateClip(selectedClip.id, { opacity: parseInt(e.target.value, 10) })}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Detailed Inline Controls inside Basic Panel */}
      <div className="space-y-2.5 pt-1">
        {/* Fill Color Row */}
        {!isLine && (
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Fill</span>
            <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
              <button
                type="button"
                onClick={() => updateShapeProps({ fillColor: 'transparent' })}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  fillColor === 'transparent'
                    ? 'border-red-500 bg-red-500/20 text-red-300'
                    : 'border-zinc-800 hover:border-zinc-700 text-zinc-400'
                }`}
                title="Transparent Fill"
              >
                None
              </button>
              <input
                type="color"
                value={fillColor === 'transparent' ? '#3b82f6' : fillColor}
                onChange={e => updateShapeProps({ fillColor: e.target.value })}
                className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer flex-shrink-0"
              />
              <input
                type="text"
                value={fillColor}
                onChange={e => updateShapeProps({ fillColor: e.target.value })}
                className="w-20 px-2 py-0.5 text-[11px] bg-[#19191c] rounded border border-zinc-800 uppercase font-mono text-zinc-200 focus:border-cyan-400 outline-none"
              />
            </div>
          </div>
        )}

        {/* Border Color Row */}
        <div className="flex items-center justify-between gap-2 h-7">
          <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Border</span>
          <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
            <button
              type="button"
              onClick={() => updateShapeProps({ strokeWidth: 0, strokeColor: 'transparent' })}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                strokeWidth === 0 || strokeColor === 'transparent'
                  ? 'border-red-500 bg-red-500/20 text-red-300'
                  : 'border-zinc-800 hover:border-zinc-700 text-zinc-400'
              }`}
              title="No Border"
            >
              None
            </button>
            <input
              type="color"
              value={strokeColor || '#ffffff'}
              onChange={e =>
                updateShapeProps({
                  strokeColor: e.target.value,
                  strokeWidth: strokeWidth > 0 ? strokeWidth : 3,
                })
              }
              className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer flex-shrink-0"
            />
            <input
              type="text"
              value={strokeColor || '#ffffff'}
              onChange={e =>
                updateShapeProps({
                  strokeColor: e.target.value,
                  strokeWidth: strokeWidth > 0 ? strokeWidth : 3,
                })
              }
              className="w-20 px-2 py-0.5 text-[11px] bg-[#19191c] rounded border border-zinc-800 uppercase font-mono text-zinc-200 focus:border-cyan-400 outline-none"
            />
          </div>
        </div>

        {/* Border Style Row */}
        <div className="flex items-center justify-between gap-2 h-7">
          <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Style</span>
          <div className="flex items-center gap-1 flex-1 justify-end">
            {/* Solid */}
            <button
              type="button"
              onClick={() =>
                updateShapeProps({
                  strokeDasharray: undefined,
                  strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                  strokeColor: strokeColor || '#ffffff',
                })
              }
              className={`h-6 px-2 rounded flex items-center justify-center border text-xs transition-colors ${
                strokeWidth > 0 && !strokeDasharray
                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-400'
                  : 'border-zinc-800 bg-[#19191c] text-zinc-400 hover:text-zinc-200'
              }`}
              title="Solid"
            >
              Solid
            </button>
            {/* Dashed */}
            <button
              type="button"
              onClick={() =>
                updateShapeProps({
                  strokeDasharray: '8 6',
                  strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                  strokeColor: strokeColor || '#ffffff',
                })
              }
              className={`h-6 px-2 rounded flex items-center justify-center border text-xs transition-colors ${
                strokeWidth > 0 && strokeDasharray === '8 6'
                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-400'
                  : 'border-zinc-800 bg-[#19191c] text-zinc-400 hover:text-zinc-200'
              }`}
              title="Dashed"
            >
              Dash
            </button>
            {/* Dotted */}
            <button
              type="button"
              onClick={() =>
                updateShapeProps({
                  strokeDasharray: '2 4',
                  strokeWidth: strokeWidth === 0 ? 4 : strokeWidth,
                  strokeColor: strokeColor || '#ffffff',
                })
              }
              className={`h-6 px-2 rounded flex items-center justify-center border text-xs transition-colors ${
                strokeWidth > 0 && (strokeDasharray === '2 4' || strokeDasharray === '1.5 3')
                  ? 'border-cyan-500 bg-cyan-500/20 text-cyan-400'
                  : 'border-zinc-800 bg-[#19191c] text-zinc-400 hover:text-zinc-200'
              }`}
              title="Dotted"
            >
              Dot
            </button>
          </div>
        </div>

        {/* Stroke Weight Row */}
        <div className="flex items-center justify-between gap-2 h-7">
          <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Weight</span>
          <input
            type="range"
            min={0}
            max={40}
            value={strokeWidth}
            onChange={e => updateShapeProps({ strokeWidth: parseInt(e.target.value, 10) })}
            className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
          />
          <PropertyNumberInput
            value={strokeWidth}
            min={0}
            max={100}
            suffix="px"
            className="w-16 flex-shrink-0"
            onChange={val => updateShapeProps({ strokeWidth: val })}
          />
        </div>

        {/* Corner Rounding Row */}
        {isCornerRoundingCapable && (
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Corners</span>
            <input
              type="range"
              min={0}
              max={100}
              value={cornerRounding}
              onChange={e => updateShapeProps({ cornerRounding: parseInt(e.target.value, 10) })}
              className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
            />
            <PropertyNumberInput
              value={cornerRounding}
              min={0}
              max={100}
              suffix="%"
              className="w-16 flex-shrink-0"
              onChange={val => updateShapeProps({ cornerRounding: val })}
            />
          </div>
        )}

        {/* Sides Row (Polygons) */}
        {isPolygonCapable && (
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-16 flex-shrink-0">Sides</span>
            <div className="flex items-center gap-1 bg-[#19191c] rounded-md border border-zinc-800 p-0.5">
              <button
                type="button"
                onClick={() => updateShapeProps({ sides: Math.max(3, sides - 1) })}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                title="Decrease sides"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-8 text-center text-xs font-semibold text-white">
                {sides}
              </span>
              <button
                type="button"
                onClick={() => updateShapeProps({ sides: Math.min(16, sides + 1) })}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                title="Increase sides"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
