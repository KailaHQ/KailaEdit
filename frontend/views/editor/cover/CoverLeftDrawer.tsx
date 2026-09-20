import React, { useState } from 'react'
import {
  X,
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
  Sparkles,
  Wand2,
  Check,
  RotateCcw,
  Upload,
  Trash2,
  Plus,
  Loader2,
  Bookmark,
  BookmarkPlus,
} from 'lucide-react'
import type {
  CoverElement,
  CoverDrawerTab,
  PositionSubTab,
  TextCoverElement,
  ImageCoverElement,
  UploadedCoverImage,
} from './types'
import {
  COVER_TEMPLATES,
  COVER_CATEGORIES,
  type CoverTemplate,
  type CoverCategory,
} from './cover-templates'
import { COVER_TEXT_PRESETS } from './cover-text-presets'
import { COVER_SHAPES, type CoverShapeDef } from './cover-shapes'

export interface CoverLeftDrawerProps {
  isOpen: boolean
  activeTab: CoverDrawerTab | null
  onClose: () => void
  selectedElement: CoverElement | null
  elements: CoverElement[]
  canvasWidth: number
  canvasHeight: number
  onSelectElement: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
  onReorderElements: (reordered: CoverElement[]) => void
  onApplyTemplate: (tpl: CoverTemplate) => void
  customTemplates?: CoverTemplate[]
  onDeleteCustomTemplate?: (templateId: string) => void
  onSaveCurrentAsTemplate?: () => void
  onRunBgRemoval?: (id: string) => Promise<void>
  onRestoreBg?: (id: string) => void
  isProcessingBgRemoval?: boolean
  uploadedImages?: UploadedCoverImage[]
  onAddImageToCanvas?: (src: string, name: string) => void
  onUploadNewImage?: () => void
  onDeleteUploadedImage?: (id: string) => void
  onDropFiles?: (files: FileList) => void
  onAddText?: (type?: 'heading' | 'subheading' | 'body', customProps?: Partial<TextCoverElement>) => void
  onAddShape?: (shapeDef: CoverShapeDef) => void
}

export const CoverLeftDrawer: React.FC<CoverLeftDrawerProps> = ({
  isOpen,
  activeTab,
  onClose,
  selectedElement,
  elements,
  canvasWidth,
  canvasHeight,
  onSelectElement,
  onUpdateElement,
  onReorderElements,
  onApplyTemplate,
  customTemplates = [],
  onDeleteCustomTemplate,
  onSaveCurrentAsTemplate,
  onRunBgRemoval,
  onRestoreBg,
  isProcessingBgRemoval = false,
  uploadedImages = [],
  onAddImageToCanvas,
  onUploadNewImage,
  onDeleteUploadedImage,
  onDropFiles,
  onAddText,
  onAddShape,
}) => {
  const [positionSubTab, setPositionSubTab] = useState<PositionSubTab>('arrange')
  const [activeCategory, setActiveCategory] = useState<CoverCategory>('all')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('bookish-weekend')
  const [isDragOver, setIsDragOver] = useState<boolean>(false)
  const [recentShapes, setRecentShapes] = useState<CoverShapeDef[]>(() => {
    return [
      COVER_SHAPES.find(s => s.id === 'rounded-rect') || COVER_SHAPES[16],
      COVER_SHAPES.find(s => s.id === 'square') || COVER_SHAPES[15],
    ]
  })

  const handleUseShape = (shape: CoverShapeDef) => {
    setRecentShapes(prev => [shape, ...prev.filter(s => s.id !== shape.id)].slice(0, 6))
  }

  if (!isOpen || !activeTab) return null

  // Filter templates (combining custom templates with built-in presets)
  const allTemplates = [...(customTemplates || []), ...COVER_TEMPLATES]
  const filteredTemplates =
    activeCategory === 'all'
      ? allTemplates
      : activeCategory === 'custom'
      ? customTemplates || []
      : COVER_TEMPLATES.filter(tpl => tpl.category === activeCategory)

  // Sort elements by zIndex descending for the Layers list
  const sortedLayers = [...elements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))

  // ── Position Align Helpers ───────────────────────────────────────────
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

  // ── Z-Index Reordering ───────────────────────────────────────────────
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

  // Title header helper
  const getDrawerTitle = () => {
    switch (activeTab) {
      case 'position':
        return 'Position'
      case 'effects':
        return 'Effects'
      case 'edit':
        return 'Edit Photo'
      case 'bg-remover':
        return 'Tách nền'
      case 'templates':
        return 'Templates'
      case 'images':
        return 'Images'
      case 'text':
        return 'Text'
      case 'shapes':
        return 'Shapes'
      case 'layers':
        return 'Layers'
      default:
        return 'Properties'
    }
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      className="w-80 border-r border-zinc-800 bg-zinc-900/95 flex flex-col flex-shrink-0 z-40 select-none shadow-2xl animate-in slide-in-from-left-2 duration-150"
    >
      {/* Drawer Title Header */}
      <div className="h-12 px-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
          <span>{getDrawerTitle()}</span>
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ─── 1. POSITION PANEL (Arrange & Layers) ────────────────────── */}
      {activeTab === 'position' && (
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

              {/* Align to page (Top, Left, Middle, Center, Bottom, Right) */}
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

              {/* Advanced Controls (Width, Height, Ratio, X, Y, Rotate) */}
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
      )}

      {/* ─── 2. EFFECTS PANEL (Text) ─────────────────────────────────── */}
      {activeTab === 'effects' && selectedElement?.type === 'text' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300">
          {(() => {
            const el = selectedElement as TextCoverElement
            return (
              <>
                {/* Shadow */}
                <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">Shadow</span>
                    <input
                      type="checkbox"
                      checked={el.shadow?.enabled ?? false}
                      onChange={e =>
                        onUpdateElement(el.id, {
                          shadow: {
                            enabled: e.target.checked,
                            color: el.shadow?.color || '#000000',
                            blur: el.shadow?.blur || 10,
                            offsetX: el.shadow?.offsetX || 0,
                            offsetY: el.shadow?.offsetY || 4,
                          },
                        })
                      }
                      className="accent-sky-400 rounded"
                    />
                  </div>
                  {el.shadow?.enabled && (
                    <div className="space-y-2 pt-2 border-t border-zinc-700/40">
                      <div>
                        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                          <span>Blur</span>
                          <span>{el.shadow.blur}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={30}
                          value={el.shadow.blur}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              shadow: { ...el.shadow!, blur: parseInt(e.target.value, 10) },
                            })
                          }
                          className="w-full accent-sky-400"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400">Color</span>
                        <input
                          type="color"
                          value={el.shadow.color}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              shadow: { ...el.shadow!, color: e.target.value },
                            })
                          }
                          className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Stroke */}
                <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">Stroke</span>
                    <input
                      type="checkbox"
                      checked={el.stroke?.enabled ?? false}
                      onChange={e =>
                        onUpdateElement(el.id, {
                          stroke: {
                            enabled: e.target.checked,
                            color: el.stroke?.color || '#000000',
                            width: el.stroke?.width || 2,
                          },
                        })
                      }
                      className="accent-sky-400 rounded"
                    />
                  </div>
                  {el.stroke?.enabled && (
                    <div className="space-y-2 pt-2 border-t border-zinc-700/40">
                      <div>
                        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                          <span>Thickness</span>
                          <span>{el.stroke.width}px</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={15}
                          value={el.stroke.width}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              stroke: { ...el.stroke!, width: parseInt(e.target.value, 10) },
                            })
                          }
                          className="w-full accent-sky-400"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400">Color</span>
                        <input
                          type="color"
                          value={el.stroke.color}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              stroke: { ...el.stroke!, color: e.target.value },
                            })
                          }
                          className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Background Badge */}
                <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">Background Badge</span>
                    <input
                      type="checkbox"
                      checked={el.backgroundBadge?.enabled ?? false}
                      onChange={e =>
                        onUpdateElement(el.id, {
                          backgroundBadge: {
                            enabled: e.target.checked,
                            color: el.backgroundBadge?.color || '#000000',
                            paddingX: el.backgroundBadge?.paddingX || 12,
                            paddingY: el.backgroundBadge?.paddingY || 6,
                            borderRadius: el.backgroundBadge?.borderRadius || 6,
                          },
                        })
                      }
                      className="accent-sky-400 rounded"
                    />
                  </div>
                  {el.backgroundBadge?.enabled && (
                    <div className="space-y-2 pt-2 border-t border-zinc-700/40">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-400">Badge Color</span>
                        <input
                          type="color"
                          value={el.backgroundBadge.color}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              backgroundBadge: { ...el.backgroundBadge!, color: e.target.value },
                            })
                          }
                          className="w-6 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                          <span>Corner Radius</span>
                          <span>{el.backgroundBadge.borderRadius}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={30}
                          value={el.backgroundBadge.borderRadius}
                          onChange={e =>
                            onUpdateElement(el.id, {
                              backgroundBadge: {
                                ...el.backgroundBadge!,
                                borderRadius: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full accent-sky-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ─── 3. EDIT / FILTERS PANEL (Image / Video) ──────────────────── */}
      {activeTab === 'edit' && (selectedElement?.type === 'image' || selectedElement?.type === 'background') && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300">
          {(() => {
            const el = selectedElement as ImageCoverElement
            const filters = el.filters || {
              brightness: 100,
              contrast: 100,
              saturation: 100,
              blur: 0,
              hue: 0,
            }

            const updateFilter = (key: keyof typeof filters, val: number) => {
              onUpdateElement(el.id, {
                filters: { ...filters, [key]: val },
              })
            }

            return (
              <>
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <span className="font-semibold text-zinc-200">Adjustments</span>
                  <button
                    onClick={() =>
                      onUpdateElement(el.id, {
                        filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0, hue: 0 },
                      })
                    }
                    className="p-1 rounded text-zinc-400 hover:text-white flex items-center gap-1 text-[11px]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset</span>
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Brightness</span>
                    <span>{filters.brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={filters.brightness}
                    onChange={e => updateFilter('brightness', parseInt(e.target.value, 10))}
                    className="w-full accent-sky-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Contrast</span>
                    <span>{filters.contrast}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={filters.contrast}
                    onChange={e => updateFilter('contrast', parseInt(e.target.value, 10))}
                    className="w-full accent-sky-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Saturation</span>
                    <span>{filters.saturation}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={filters.saturation}
                    onChange={e => updateFilter('saturation', parseInt(e.target.value, 10))}
                    className="w-full accent-sky-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Blur</span>
                    <span>{filters.blur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={filters.blur}
                    onChange={e => updateFilter('blur', parseInt(e.target.value, 10))}
                    className="w-full accent-sky-400"
                  />
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ─── 4. BG REMOVER PANEL (On-Device Built-in Removal) ───────────── */}
      {activeTab === 'bg-remover' && (selectedElement?.type === 'image' || selectedElement?.type === 'background') && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300">
          <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/80 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-sky-500/10 text-sky-400 flex items-center justify-center shadow">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-zinc-100">Tách nền tự động</h4>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Tự động tách chân dung hoặc chủ thể khỏi nền bằng bộ xử lý tích hợp sẵn của ứng dụng.
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
                  <span>Đang tách nền...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Xóa nền ảnh</span>
                </>
              )}
            </button>
          </div>

          {(selectedElement as ImageCoverElement).bgRemoved && (
            <div className="p-3 rounded-lg bg-zinc-800/80 border border-zinc-700/80 flex items-center justify-between">
              <span className="text-emerald-400 font-medium flex items-center gap-1.5 text-xs">
                <Check className="h-4 w-4" />
                Đã tách nền
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
                Khôi phục ảnh gốc
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── 5. TEMPLATES PANEL ──────────────────────────────────────── */}
      {activeTab === 'templates' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-zinc-800 flex-shrink-0 space-y-2">
            {/* Quick Action: Save Current Design as Template */}
            {onSaveCurrentAsTemplate && (
              <button
                onClick={onSaveCurrentAsTemplate}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 hover:border-amber-500/50 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Lưu thiết kế hiện tại làm Template</span>
              </button>
            )}

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {COVER_CATEGORIES.map(cat => {
                const count =
                  cat.id === 'custom'
                    ? (customTemplates || []).length
                    : cat.id === 'all'
                    ? allTemplates.length
                    : COVER_TEMPLATES.filter(t => t.category === cat.id).length
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                      activeCategory === cat.id
                        ? 'bg-zinc-700 text-white font-semibold'
                        : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{cat.fallbackLabel}</span>
                    {count > 0 && (
                      <span className="text-[9px] px-1 py-0.2 rounded-full bg-zinc-600/80 text-zinc-300 font-mono">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Preset / Custom Templates Grid (2 Columns) */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {activeCategory === 'custom' && (!customTemplates || customTemplates.length === 0) ? (
              <div className="py-12 px-4 text-center flex flex-col items-center justify-center text-zinc-400">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                  <Bookmark className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-zinc-200 mb-1">Chưa có Template cá nhân</h4>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4 max-w-[220px]">
                  Tự tạo thiết kế ảnh bìa rồi nhấn <strong>Save Template</strong> ở bên dưới để lưu lại dùng nhiều lần!
                </p>
                {onSaveCurrentAsTemplate && (
                  <button
                    onClick={onSaveCurrentAsTemplate}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>Tạo Template ngay</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {filteredTemplates.map(tpl => {
                  const isSelected = selectedTemplateId === tpl.id
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => {
                        setSelectedTemplateId(tpl.id)
                        onApplyTemplate(tpl)
                      }}
                      className={`relative rounded-lg overflow-hidden cursor-pointer border transition-all aspect-[9/16] group ${
                        tpl.previewGradient ? `bg-gradient-to-b ${tpl.previewGradient}` : 'bg-zinc-900'
                      } ${
                        isSelected
                          ? 'border-sky-400 ring-2 ring-sky-400/40'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      {/* If template has preview thumbnail image */}
                      {tpl.previewThumbnail && (
                        <img
                          src={tpl.previewThumbnail}
                          alt={tpl.name}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}

                      {/* Template Texts Preview (when no thumbnail) */}
                      {!tpl.previewThumbnail && (
                        <div className="absolute inset-0 p-2 flex flex-col justify-between pointer-events-none">
                          <div className="flex flex-col items-center justify-center mt-6 text-center">
                            {tpl.texts.slice(0, 2).map((item, i) => (
                              <span
                                key={i}
                                className="font-bold leading-tight drop-shadow truncate w-full"
                                style={{
                                  color: item.color || '#fff',
                                  fontSize: Math.max(9, Math.min(13, (item.fontSize || 20) * 0.35)),
                                  fontFamily:
                                    item.fontFamily === 'serif'
                                      ? 'serif'
                                      : item.fontFamily === 'cursive'
                                      ? 'cursive'
                                      : 'sans-serif',
                                  textTransform: item.textTransform || 'none',
                                }}
                              >
                                {item.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Template Name Overlay badge at bottom */}
                      <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                        <p className="text-[10px] font-medium text-white truncate text-center">
                          {tpl.name}
                        </p>
                      </div>

                      {/* Custom badge */}
                      {tpl.isCustom && (
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/90 text-black shadow">
                          Của tôi
                        </span>
                      )}

                      {/* Delete button for custom template */}
                      {tpl.isCustom && onDeleteCustomTemplate && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            onDeleteCustomTemplate(tpl.id)
                          }}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/80 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow cursor-pointer z-10"
                          title="Xoá template này"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}

                      {/* Checkmark */}
                      {isSelected && (!tpl.isCustom || !onDeleteCustomTemplate) && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center shadow">
                          <Check className="h-2.5 w-2.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 6. IMAGES LIBRARY PANEL ─────────────────────────────────── */}
      {activeTab === 'images' && (
        <div
          className="flex-1 flex flex-col overflow-hidden relative"
          onDragOver={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(true)
          }}
          onDragLeave={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
          }}
          onDrop={e => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              onDropFiles?.(e.dataTransfer.files)
            }
          }}
        >
          {/* Top Upload Action Header */}
          <div className="p-3 border-b border-zinc-800 flex-shrink-0 space-y-2">
            <button
              onClick={onUploadNewImage}
              className="w-full py-2.5 px-3 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 active:bg-sky-500/30 text-sky-400 border border-sky-500/30 hover:border-sky-500/50 flex items-center justify-center gap-2 font-medium text-xs transition-all shadow-sm group"
            >
              <Upload className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
              <span>Upload Image</span>
            </button>
            <p className="text-[10px] text-zinc-500 text-center">
              PNG, JPG, WebP, SVG • Drag & drop supported
            </p>
          </div>

          {/* Drag Overlay Hint */}
          {isDragOver && (
            <div className="absolute inset-0 z-50 bg-sky-950/80 backdrop-blur-sm border-2 border-dashed border-sky-400 m-2 rounded-xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
              <Upload className="h-10 w-10 text-sky-400 mb-2 animate-bounce" />
              <p className="text-sm font-semibold text-white">Drop images here</p>
              <p className="text-xs text-sky-300 mt-1">They will be added to your library & cover</p>
            </div>
          )}

          {/* Section Header */}
          <div className="px-4 py-2 flex items-center justify-between flex-shrink-0 text-zinc-400">
            <span className="text-[11px] font-semibold text-zinc-300">
              Uploaded Images ({uploadedImages.length})
            </span>
            {uploadedImages.length > 0 && (
              <span className="text-[10px] text-zinc-500 font-normal">
                Click to add
              </span>
            )}
          </div>

          {/* Empty State */}
          {uploadedImages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs gap-3">
              <div className="w-12 h-12 rounded-full bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-500">
                <ImageIcon className="h-6 w-6" />
              </div>
              <div className="space-y-1 max-w-[200px]">
                <p className="font-medium text-zinc-200">No images uploaded</p>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Upload images from your computer to quickly reuse them across your covers.
                </p>
              </div>
              <button
                onClick={onUploadNewImage}
                className="mt-1 px-3.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sky-400 hover:text-sky-300 font-medium text-xs transition-colors flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Upload now</span>
              </button>
            </div>
          ) : (
            /* Uploaded Images Grid */
            <div className="flex-1 overflow-y-auto px-4 py-2 grid grid-cols-2 gap-2.5 content-start">
              {uploadedImages.map(img => (
                <div
                  key={img.id}
                  onClick={() => onAddImageToCanvas?.(img.src, img.name)}
                  className="group relative rounded-lg overflow-hidden border border-zinc-800 hover:border-sky-500/70 bg-zinc-950/80 transition-all cursor-pointer aspect-square flex items-center justify-center hover:shadow-lg hover:shadow-sky-950/30"
                  title={`${img.name} (Click to add)`}
                >
                  <img
                    src={img.src}
                    alt={img.name}
                    className="w-full h-full object-contain p-1.5 transition-transform group-hover:scale-105"
                    loading="lazy"
                  />

                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5">
                    {/* Top Delete Button */}
                    <div className="flex justify-end">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          onDeleteUploadedImage?.(img.id)
                        }}
                        className="p-1 rounded bg-zinc-900/80 hover:bg-red-500 text-zinc-400 hover:text-white transition-colors shadow"
                        title="Delete from library"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Middle Plus Indicator */}
                    <div className="flex items-center justify-center pointer-events-none">
                      <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <Plus className="h-4 w-4 stroke-[2.5]" />
                      </div>
                    </div>

                    {/* Bottom File Name */}
                    <span className="text-[10px] text-zinc-200 font-medium truncate w-full px-1 text-center pointer-events-none">
                      {img.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 7. TEXT PANEL ─────────────────────────────────────────── */}
      {activeTab === 'text' && (
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
                const textShadow = s.shadow?.enabled
                  ? `${s.shadow.offsetX}px ${s.shadow.offsetY}px ${s.shadow.blur}px ${s.shadow.color}`
                  : undefined
                const webkitTextStroke = s.stroke?.enabled
                  ? `${s.stroke.width * 0.75}px ${s.stroke.color}`
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
                        fontSize: Math.min(16, (s.fontSize || 32) * 0.42),
                        fontWeight: s.fontWeight,
                        fontStyle: s.fontStyle,
                        color: s.color,
                        textTransform: s.textTransform,
                        letterSpacing: s.letterSpacing ? `${s.letterSpacing * 0.5}px` : undefined,
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
      )}

      {/* ─── 8. SHAPES PANEL ────────────────────────────────────────── */}
      {activeTab === 'shapes' && (
        <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-5">
          {/* Recents Section */}
          <div className="space-y-2 flex-shrink-0">
            <div className="text-xs font-bold text-zinc-200 tracking-wide">
              Recents
            </div>
            <div className="flex items-center gap-2.5">
              {recentShapes.map(shape => (
                <button
                  key={shape.id}
                  onClick={() => {
                    onAddShape?.(shape)
                    handleUseShape(shape)
                  }}
                  className="w-16 h-16 rounded-xl bg-[#23252b] hover:bg-[#2b2d35] border border-zinc-800/80 hover:border-sky-500/60 transition-all flex items-center justify-center p-3 cursor-pointer shadow-sm group"
                  title={`Add ${shape.name}`}
                >
                  <svg
                    viewBox={shape.viewBox}
                    className="w-full h-full text-[#a1a1aa] group-hover:text-white group-hover:scale-105 transition-all"
                    style={{ overflow: 'visible' }}
                  >
                    {shape.renderSvg(shape.defaultFill, shape.defaultStroke, shape.defaultStrokeWidth)}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* All Shapes Section */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-zinc-200 tracking-wide">
              All
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {COVER_SHAPES.map(shape => (
                <button
                  key={shape.id}
                  onClick={() => {
                    onAddShape?.(shape)
                    handleUseShape(shape)
                  }}
                  className="aspect-square rounded-xl bg-[#23252b] hover:bg-[#2b2d35] border border-zinc-800/80 hover:border-sky-500/60 transition-all flex items-center justify-center p-3.5 cursor-pointer shadow-sm group"
                  title={`Add ${shape.name}`}
                >
                  <svg
                    viewBox={shape.viewBox}
                    className="w-full h-full text-[#a1a1aa] group-hover:text-white group-hover:scale-105 transition-all"
                    style={{ overflow: 'visible' }}
                  >
                    {shape.renderSvg(shape.defaultFill, shape.defaultStroke, shape.defaultStrokeWidth)}
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
