import React, { useState } from 'react'
import {
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Type,
  Image as ImageIcon,
  Film,
} from 'lucide-react'
import type { CoverElement, PositionSubTab, TextCoverElement } from '../types'

export interface CoverPositionTabProps {
  selectedElement: CoverElement | null
  elements: CoverElement[]
  canvasWidth: number
  canvasHeight: number
  onSelectElement: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
  onReorderElements: (reordered: CoverElement[]) => void
}

export const CoverPositionTab: React.FC<CoverPositionTabProps> = ({
  selectedElement,
  elements,
  canvasWidth,
  canvasHeight,
  onSelectElement,
  onUpdateElement,
  onReorderElements,
}) => {
  const [positionSubTab, setPositionSubTab] = useState<PositionSubTab>('arrange')

  // Sort elements by zIndex descending for the Layers list
  const sortedLayers = [...elements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))

  const handleAlign = (type: 'top' | 'middle' | 'bottom' | 'left' | 'center' | 'right') => {
    if (!selectedElement || selectedElement.isLocked) return

    const halfW = (selectedElement.width || 20) / 2
    const halfH = (selectedElement.height || 10) / 2

    switch (type) {
      case 'top':
        onUpdateElement(selectedElement.id, { y: halfH })
        break
      case 'middle':
        onUpdateElement(selectedElement.id, { y: 50 })
        break
      case 'bottom':
        onUpdateElement(selectedElement.id, { y: 100 - halfH })
        break
      case 'left':
        onUpdateElement(selectedElement.id, { x: halfW })
        break
      case 'center':
        onUpdateElement(selectedElement.id, { x: 50 })
        break
      case 'right':
        onUpdateElement(selectedElement.id, { x: 100 - halfW })
        break
    }
  }

  const moveLayer = (id: string, delta: number) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const index = list.findIndex(e => e.id === id)
    if (index === -1) return

    const newIndex = index + delta
    if (newIndex < 0 || newIndex >= list.length) return

    const item = list.splice(index, 1)[0]
    list.splice(newIndex, 0, item)

    const updated = list.map((el, i) => ({ ...el, zIndex: i + 1 }))
    onReorderElements(updated)
  }

  const moveLayerToExtreme = (id: string, toFront: boolean) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const index = list.findIndex(e => e.id === id)
    if (index === -1) return

    const item = list.splice(index, 1)[0]
    if (toFront) {
      list.push(item)
    } else {
      list.unshift(item)
    }

    const updated = list.map((el, i) => ({ ...el, zIndex: i + 1 }))
    onReorderElements(updated)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Arrange / Layers sub-tabs */}
      <div className="flex border-b border-zinc-800 px-4 pt-2 gap-4 flex-shrink-0">
        <button
          onClick={() => setPositionSubTab('arrange')}
          className={`pb-2 text-xs font-semibold transition-all relative ${
            positionSubTab === 'arrange'
              ? 'text-sky-400 font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Arrange
          {positionSubTab === 'arrange' && (
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-sky-400 rounded-full" />
          )}
        </button>
        <button
          onClick={() => setPositionSubTab('layers')}
          className={`pb-2 text-xs font-semibold transition-all relative ${
            positionSubTab === 'layers'
              ? 'text-sky-400 font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Layers
          {positionSubTab === 'layers' && (
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-sky-400 rounded-full" />
          )}
        </button>
      </div>

      {/* Sub-tab Arrange */}
      {positionSubTab === 'arrange' && !selectedElement && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs">
          <p>Select an element on the canvas to arrange its position, or switch to the Layers tab.</p>
          <button
            onClick={() => setPositionSubTab('layers')}
            className="mt-3 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sky-400 font-medium transition-colors"
          >
            View all layers
          </button>
        </div>
      )}

      {positionSubTab === 'arrange' && selectedElement && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300">
          {/* Layer Ordering (Forward, Backward, To front, To back) */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400 mb-2">Order</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => moveLayer(selectedElement.id, 1)}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowUp className="h-3.5 w-3.5 text-zinc-400" />
                <span>Forward</span>
              </button>
              <button
                onClick={() => moveLayer(selectedElement.id, -1)}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowDown className="h-3.5 w-3.5 text-zinc-400" />
                <span>Backward</span>
              </button>
              <button
                onClick={() => moveLayerToExtreme(selectedElement.id, true)}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <ChevronsUp className="h-3.5 w-3.5 text-zinc-400" />
                <span>To front</span>
              </button>
              <button
                onClick={() => moveLayerToExtreme(selectedElement.id, false)}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <ChevronsDown className="h-3.5 w-3.5 text-zinc-400" />
                <span>To back</span>
              </button>
            </div>
          </div>

          {/* Align to page */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400 mb-2">Align to page</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleAlign('top')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignVerticalJustifyStart className="h-3.5 w-3.5 text-zinc-400" />
                <span>Top</span>
              </button>
              <button
                onClick={() => handleAlign('left')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignHorizontalJustifyStart className="h-3.5 w-3.5 text-zinc-400" />
                <span>Left</span>
              </button>
              <button
                onClick={() => handleAlign('middle')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignVerticalJustifyCenter className="h-3.5 w-3.5 text-zinc-400" />
                <span>Middle</span>
              </button>
              <button
                onClick={() => handleAlign('center')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignHorizontalJustifyCenter className="h-3.5 w-3.5 text-zinc-400" />
                <span>Center</span>
              </button>
              <button
                onClick={() => handleAlign('bottom')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignVerticalJustifyEnd className="h-3.5 w-3.5 text-zinc-400" />
                <span>Bottom</span>
              </button>
              <button
                onClick={() => handleAlign('right')}
                className="p-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/70 flex items-center justify-center gap-2 transition-colors"
              >
                <AlignHorizontalJustifyEnd className="h-3.5 w-3.5 text-zinc-400" />
                <span>Right</span>
              </button>
            </div>
          </div>

          {/* Advanced Controls */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400 mb-2">Advanced</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Width</label>
                <div className="flex items-center px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700">
                  <input
                    type="number"
                    value={Math.round((selectedElement.width / 100) * canvasWidth)}
                    onChange={e => {
                      const px = parseFloat(e.target.value) || 0
                      onUpdateElement(selectedElement.id, {
                        width: Math.max(1, Math.round((px / canvasWidth) * 1000) / 10),
                      })
                    }}
                    className="w-full bg-transparent text-xs text-white outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 ml-1">px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Height</label>
                <div className="flex items-center px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700">
                  <input
                    type="number"
                    value={Math.round((selectedElement.height / 100) * canvasHeight)}
                    onChange={e => {
                      const px = parseFloat(e.target.value) || 0
                      onUpdateElement(selectedElement.id, {
                        height: Math.max(1, Math.round((px / canvasHeight) * 1000) / 10),
                      })
                    }}
                    className="w-full bg-transparent text-xs text-white outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 ml-1">px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Ratio</label>
                <button
                  onClick={() =>
                    onUpdateElement(selectedElement.id, {
                      aspectRatioLocked: !selectedElement.aspectRatioLocked,
                    })
                  }
                  className={`w-full py-1.5 rounded-lg border flex items-center justify-center transition-colors ${
                    selectedElement.aspectRatioLocked
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                  title={selectedElement.aspectRatioLocked ? 'Aspect Ratio Locked' : 'Lock Aspect Ratio'}
                >
                  {selectedElement.aspectRatioLocked ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Unlock className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">X</label>
                <div className="flex items-center px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700">
                  <input
                    type="number"
                    value={Math.round((selectedElement.x / 100) * canvasWidth)}
                    onChange={e => {
                      const px = parseFloat(e.target.value) || 0
                      onUpdateElement(selectedElement.id, {
                        x: Math.round((px / canvasWidth) * 1000) / 10,
                      })
                    }}
                    className="w-full bg-transparent text-xs text-white outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 ml-1">px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Y</label>
                <div className="flex items-center px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700">
                  <input
                    type="number"
                    value={Math.round((selectedElement.y / 100) * canvasHeight)}
                    onChange={e => {
                      const px = parseFloat(e.target.value) || 0
                      onUpdateElement(selectedElement.id, {
                        y: Math.round((px / canvasHeight) * 1000) / 10,
                      })
                    }}
                    className="w-full bg-transparent text-xs text-white outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 ml-1">px</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Rotate</label>
                <div className="flex items-center px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700">
                  <input
                    type="number"
                    value={selectedElement.rotation || 0}
                    onChange={e => {
                      const deg = parseInt(e.target.value, 10) || 0
                      onUpdateElement(selectedElement.id, { rotation: deg })
                    }}
                    className="w-full bg-transparent text-xs text-white outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 ml-1">°</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab Layers */}
      {positionSubTab === 'layers' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-[11px] font-semibold text-zinc-400 mb-2">All Layers</div>
          {sortedLayers.map(el => {
            const isSelected = selectedElement?.id === el.id
            return (
              <div
                key={el.id}
                onClick={() => onSelectElement(el.id)}
                className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-sky-500/10 border-sky-400 text-white shadow'
                    : 'bg-zinc-800/60 border-zinc-750 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  {el.type === 'text' ? (
                    <Type className="h-4 w-4 text-sky-400 flex-shrink-0" />
                  ) : el.type === 'background' ? (
                    <Film className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate">
                    {el.type === 'text' ? (el as TextCoverElement).text : el.name || el.type}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {/* Visibility toggle */}
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onUpdateElement(el.id, { visible: el.visible !== false ? false : true })
                    }}
                    className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white"
                  >
                    {el.visible !== false ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-zinc-500" />
                    )}
                  </button>

                  {/* Lock toggle */}
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onUpdateElement(el.id, { isLocked: !el.isLocked })
                    }}
                    className={`p-1 rounded hover:bg-zinc-700 ${
                      el.isLocked ? 'text-amber-400' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {el.isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
