import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  LayoutTemplate,
  Type,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  Shapes,
  Layers,
  Undo2,
  Redo2,
  Check,
  LogOut,
  BookmarkPlus,
  BookmarkCheck,
  Loader2,
} from 'lucide-react'
import type { TimelineCover, TimelineCoverTextItem } from '@core/project-model'
import {
  COVER_TEMPLATES,
  type CoverTemplate,
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
} from './cover-templates'
import { useTranslation } from '../../../i18n/I18nContext'
import { Tooltip } from '../../../components/ui/tooltip'
import type {
  CoverElement,
  CoverDrawerTab,
  TextCoverElement,
  ImageCoverElement,
  BackgroundCoverElement,
  UploadedCoverImage,
  ShapeCoverElement,
} from './types'
import {
  getStoredCoverImages,
  saveCoverImage,
  deleteStoredCoverImage,
} from './cover-image-storage'
import {
  type CoverShapeDef,
  ShapeSvgRenderer,
  shapeToFullSvgString,
} from './cover-shapes'
import { CoverTransformBox } from './CoverTransformBox'
import { CoverContextualToolbar } from './CoverContextualToolbar'
import { CoverLeftDrawer } from './CoverLeftDrawer'
import { removeImageBackground } from './cover-image-utils'
import { isCoverBackground } from './cover-to-overlay'

export interface CoverDesignModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (cover: TimelineCover) => void
  onDeleteCover?: () => void
  initialFrameDataUrl: string
  selectedTime: number
  isLocalImage: boolean
  currentCover?: TimelineCover
  projectName?: string
  /**
   * Ctrl+C on the canvas: puts these elements on the editor's clipboard, for a Ctrl+V on
   * the timeline. Resolves to how many could be copied.
   */
  onCopyElements?: (elements: CoverElement[]) => Promise<number>
}

export const CoverDesignModal: React.FC<CoverDesignModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDeleteCover: _onDeleteCover,
  initialFrameDataUrl,
  selectedTime,
  isLocalImage,
  currentCover,
  projectName: _projectName = 'Project',
  onCopyElements,
}) => {
  const { t } = useTranslation()

  // Base canvas dimension for vertical 9:16 (standard TikTok/Reels/Shorts cover)
  const BASE_WIDTH = 720
  const BASE_HEIGHT = 1280

  // Zoom scale for canvas preview
  const [zoom, setZoom] = useState<number>(0.65)

  // Drawer state
  const [activeDrawerTab, setActiveDrawerTab] = useState<CoverDrawerTab | null>('templates')

  // Selected template ID
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    currentCover?.templateId || 'bookish-weekend'
  )

  // Custom templates state
  const [customTemplates, setCustomTemplates] = useState<CoverTemplate[]>(() => getCustomTemplates())
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templatePreviewThumb, setTemplatePreviewThumb] = useState<string | null>(null)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isUpdatingTemplate, setIsUpdatingTemplate] = useState(false)
  const [isJustUpdated, setIsJustUpdated] = useState(false)

  // Convert legacy text items to unified CoverElement format
  const initializeElements = (): CoverElement[] => {
    const list: CoverElement[] = []

    // 1. Background image layer (from video frame or saved cover)
    const effectiveBgSrc =
      initialFrameDataUrl ||
      currentCover?.customImagePath ||
      currentCover?.thumbnailDataUrl ||
      ''

    const bgElem: ImageCoverElement = {
      id: 'background-layer',
      type: 'image',
      name: 'Video Frame',
      src: effectiveBgSrc,
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      isLocked: false,
      visible: true,
      aspectRatioLocked: false,
      crop: { x: 0, y: 0, width: 100, height: 100 },
    }
    list.push(bgElem)

    // 2. If currentCover has saved elements (custom shapes, overlays, styled text), restore them!
    if (currentCover?.elements && currentCover.elements.length > 0) {
      const cloned = currentCover.elements.map((el, idx) => ({
        ...JSON.parse(JSON.stringify(el)),
        zIndex: idx + 2,
      }))
      list.push(...cloned)
      return list
    }

    // 3. Otherwise text items from currentCover or default template
    const sourceTexts: TimelineCoverTextItem[] =
      currentCover?.texts && currentCover.texts.length > 0
        ? currentCover.texts
        : (() => {
            const allTpls = [...COVER_TEMPLATES, ...getCustomTemplates()]
            const initialTpl =
              allTpls.find(tpl => tpl.id === selectedTemplateId) || COVER_TEMPLATES[0]
            return JSON.parse(JSON.stringify(initialTpl.texts))
          })()

    sourceTexts.forEach((item, index) => {
      const textElem: TextCoverElement = {
        id: item.id || `text-${Date.now()}-${index}`,
        type: 'text',
        name: item.text || `Heading ${index + 1}`,
        text: item.text,
        fontFamily: item.fontFamily === 'serif' ? 'Playfair Display, serif' : item.fontFamily === 'cursive' ? 'Caveat, cursive' : 'Inter, sans-serif',
        fontSize: item.fontSize || 32,
        fontWeight: item.fontWeight || 'bold',
        fontStyle: (item.fontStyle as 'normal' | 'italic') || 'normal',
        color: item.color || '#ffffff',
        backgroundColor: item.backgroundColor || undefined,
        textAlign: item.textAlign || 'center',
        x: item.x ?? 50,
        y: item.y ?? (30 + index * 18),
        width: 70,
        height: 12,
        rotation: item.rotation || 0,
        opacity: 1,
        zIndex: index + 2,
        isLocked: false,
        visible: true,
        letterSpacing: item.letterSpacing,
        lineHeight: item.lineHeight,
        textTransform: item.textTransform,
        shadow: item.shadow
          ? { enabled: true, color: '#000000', blur: 10, offsetX: 0, offsetY: 4 }
          : undefined,
        stroke: item.stroke && item.strokeWidth
          ? { enabled: true, color: item.stroke, width: item.strokeWidth }
          : undefined,
      }
      list.push(textElem)
    })

    return list
  }

  // All design elements
  const [elements, setElements] = useState<CoverElement[]>(initializeElements)

  // Selected element ID
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)

  // Elements picked by dragging a selection box over the canvas (two or more; one
  // picked element becomes the ordinary single selection instead).
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([])
  // The selection box being dragged, in the canvas viewport's scrolled coordinates.
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const copyNoticeTimerRef = useRef<number | null>(null)
  const selectedElementIdRef = useRef(selectedElementId)
  selectedElementIdRef.current = selectedElementId
  const multiSelectedIdsRef = useRef(multiSelectedIds)
  multiSelectedIdsRef.current = multiSelectedIds

  // Picking one element on its own ends a box selection.
  useEffect(() => {
    if (selectedElementId) setMultiSelectedIds([])
  }, [selectedElementId])

  useEffect(() => () => {
    if (copyNoticeTimerRef.current) window.clearTimeout(copyNoticeTimerRef.current)
  }, [])

  // Inline text editing ID (when double-clicking a text item)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)

  // Undo / Redo history stacks
  const [history, setHistory] = useState<CoverElement[][]>([])
  const [future, setFuture] = useState<CoverElement[][]>([])

  // Uploaded images library
  const [uploadedImages, setUploadedImages] = useState<UploadedCoverImage[]>([])

  // Load uploaded images from storage
  useEffect(() => {
    let isMounted = true
    getStoredCoverImages().then(imgs => {
      if (isMounted) {
        setUploadedImages(imgs)
      }
    })
    return () => {
      isMounted = false
    }
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Update background source if initialFrameDataUrl or currentCover changes
  useEffect(() => {
    const effectiveBgSrc =
      initialFrameDataUrl ||
      currentCover?.customImagePath ||
      currentCover?.thumbnailDataUrl ||
      ''
    if (effectiveBgSrc) {
      setElements(prev => {
        const hasBg = prev.some(el => el.id === 'background-layer' || el.type === 'background')
        if (hasBg) {
          return prev.map(el =>
            el.id === 'background-layer' || el.type === 'background'
              ? { ...el, src: (el as ImageCoverElement).src || effectiveBgSrc }
              : el
          )
        }
        return prev
      })
    }
  }, [initialFrameDataUrl, currentCover])

  const elementsRef = useRef<CoverElement[]>(elements)
  elementsRef.current = elements

  const dragStartSnapshotRef = useRef<CoverElement[] | null>(null)
  const frameMouseDownTargetRef = useRef<EventTarget | null>(null)

  // Record history snapshot before an edit
  const pushHistory = useCallback((newElements: CoverElement[]) => {
    setHistory(prev => [...prev.slice(-30), elementsRef.current])
    setFuture([])
    setElements(newElements)
  }, [])

  const handleStartTransform = useCallback(() => {
    dragStartSnapshotRef.current = elementsRef.current
  }, [])

  const handleCommitTransform = useCallback(() => {
    if (dragStartSnapshotRef.current) {
      const snapshot = dragStartSnapshotRef.current
      dragStartSnapshotRef.current = null
      setHistory(prev => [...prev.slice(-30), snapshot])
      setFuture([])
    }
  }, [])

  const handleUndo = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setFuture(f => [elementsRef.current, ...f])
    setElements(prev)
  }, [history])

  const handleRedo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setHistory(h => [...h, elementsRef.current])
    setElements(next)
  }, [future])

  const showCopyNotice = useCallback((message: string) => {
    setCopyNotice(message)
    if (copyNoticeTimerRef.current) window.clearTimeout(copyNoticeTimerRef.current)
    copyNoticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 3500)
  }, [])

  /**
   * Ctrl+C: the box-selected elements, or else the one selected element, go on the
   * editor's clipboard — Ctrl+V on the timeline lays them at the playhead.
   */
  const handleCopySelection = useCallback(async () => {
    if (!onCopyElements) return
    const ids = multiSelectedIdsRef.current.length > 0
      ? multiSelectedIdsRef.current
      : selectedElementIdRef.current ? [selectedElementIdRef.current] : []
    const picked = elementsRef.current.filter(el => ids.includes(el.id) && !isCoverBackground(el))
    if (picked.length === 0) return
    try {
      const count = await onCopyElements(picked)
      showCopyNotice(count > 0 ? t('cover.copied', { count }) : t('cover.copyFailed'))
    } catch {
      showCopyNotice(t('cover.copyFailed'))
    }
  }, [onCopyElements, showCopyNotice, t])

  // Global Undo / Redo keyboard shortcuts inside Cover Studio
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void handleCopySelection()
      } else if (e.key === 'Escape' && multiSelectedIdsRef.current.length > 0) {
        setMultiSelectedIds([])
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault()
          handleRedo()
        } else {
          e.preventDefault()
          handleUndo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo, handleCopySelection])

  // Currently selected element object
  const selectedElement = elements.find(el => el.id === selectedElementId) || null

  // Update an element's properties
  const handleUpdateElement = (id: string, updates: Partial<CoverElement>) => {
    setElements(prev =>
      prev.map(el => (el.id === id ? ({ ...el, ...updates } as CoverElement) : el))
    )
  }

  // ─── Built-in Offline Background Removal ──────────────────────────────────
  const [isProcessingBgRemoval, setIsProcessingBgRemoval] = useState(false)

  const handleRunBgRemoval = async (id: string) => {
    const el = elements.find(e => e.id === id)
    if (!el || (el.type !== 'image' && el.type !== 'background')) return
    const imgEl = el as ImageCoverElement
    if (!imgEl.src) return

    try {
      setIsProcessingBgRemoval(true)
      const currentSrc = imgEl.src
      const cutoutPng = await removeImageBackground(currentSrc)
      handleUpdateElement(id, {
        src: cutoutPng,
        originalSrc: imgEl.originalSrc || currentSrc,
        bgRemoved: true,
      })
    } catch (err) {
      console.error('[CoverDesignModal] Failed to remove background:', err)
    } finally {
      setIsProcessingBgRemoval(false)
    }
  }

  const handleRestoreBg = (id: string) => {
    const el = elements.find(e => e.id === id)
    if (!el || (el.type !== 'image' && el.type !== 'background')) return
    const imgEl = el as ImageCoverElement
    if (imgEl.originalSrc) {
      handleUpdateElement(id, {
        src: imgEl.originalSrc,
        bgRemoved: false,
      })
    }
  }

  // Duplicate element
  const handleDuplicateElement = (id: string) => {
    const target = elements.find(el => el.id === id)
    if (!target || target.type === 'background') return

    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)
    const clone: CoverElement = {
      ...JSON.parse(JSON.stringify(target)),
      id: `${target.type}-${Date.now()}`,
      name: `${target.name} (Copy)`,
      x: Math.min(95, target.x + 4),
      y: Math.min(95, target.y + 4),
      zIndex: maxZ + 1,
    }

    pushHistory([...elements, clone])
    setSelectedElementId(clone.id)
  }

  // Delete element
  const handleDeleteElement = (id: string) => {
    const target = elements.find(el => el.id === id)
    if (!target || target.type === 'background') return

    pushHistory(elements.filter(el => el.id !== id))
    if (selectedElementId === id) setSelectedElementId(null)
  }

  // Lock / Unlock toggle
  const handleLockToggle = (id: string) => {
    setElements(prev =>
      prev.map(el => (el.id === id ? { ...el, isLocked: !el.isLocked } : el))
    )
  }

  // Layer ordering helpers
  const handleBringForward = (id: string) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const idx = list.findIndex(e => e.id === id)
    if (idx === -1 || idx === list.length - 1) return
    const temp = list[idx].zIndex
    list[idx].zIndex = list[idx + 1].zIndex
    list[idx + 1].zIndex = temp
    pushHistory([...list])
  }

  const handleSendBackward = (id: string) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const idx = list.findIndex(e => e.id === id)
    if (idx <= 1) return // Keep background at 0
    const temp = list[idx].zIndex
    list[idx].zIndex = list[idx - 1].zIndex
    list[idx - 1].zIndex = temp
    pushHistory([...list])
  }

  const handleBringToFront = (id: string) => {
    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)
    pushHistory(elements.map(el => (el.id === id ? { ...el, zIndex: maxZ + 1 } : el)))
  }

  const handleSendToBack = (id: string) => {
    pushHistory(elements.map(el => (el.id === id ? { ...el, zIndex: 1 } : el)))
  }

  // Immediate drag-to-move for canvas elements on mousedown
  const handleStartMoveElement = (e: React.MouseEvent, el: CoverElement) => {
    e.stopPropagation()
    setSelectedElementId(el.id)

    if (el.isLocked) return

    dragStartSnapshotRef.current = elementsRef.current
    let hasMoved = false

    const startX = e.clientX
    const startY = e.clientY
    const origX = el.x
    const origY = el.y

    let rafId: number | null = null
    let latestEv: MouseEvent | null = null

    const processMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!hasMoved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        hasMoved = true
      }

      const newX = origX + (dx / renderedCanvasWidth) * 100
      const newY = origY + (dy / renderedCanvasHeight) * 100

      handleUpdateElement(el.id, {
        x: Math.round(newX * 10000) / 10000,
        y: Math.round(newY * 10000) / 10000,
      })
    }

    const onMouseMove = (ev: MouseEvent) => {
      latestEv = ev
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          if (latestEv) {
            processMove(latestEv)
          }
        })
      }
    }

    const onMouseUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (latestEv) {
        processMove(latestEv)
        latestEv = null
      }
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (hasMoved) {
        handleCommitTransform()
      } else {
        dragStartSnapshotRef.current = null
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  /**
   * Press and drag over the canvas to draw a selection box: every element it touches is
   * picked. Starts from empty space or from the video frame behind everything (unless the
   * frame itself is the selected element, which drags as before). A press that does not
   * move is left to the click handlers, which select or deselect as they always have.
   */
  const handleStartMarquee = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const container = containerRef.current
    if (!container) return
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    let hits: string[] = []

    const update = (clientX: number, clientY: number) => {
      const left = Math.min(startX, clientX)
      const right = Math.max(startX, clientX)
      const top = Math.min(startY, clientY)
      const bottom = Math.max(startY, clientY)
      const box = container.getBoundingClientRect()
      setMarquee({
        left: left - box.left + container.scrollLeft,
        top: top - box.top + container.scrollTop,
        width: right - left,
        height: bottom - top,
      })
      // Hit-test what is actually drawn: text has no stored height, and rotation moves
      // the corners.
      hits = elementsRef.current
        .filter(el => !isCoverBackground(el) && el.visible !== false && !el.isLocked)
        .filter(el => {
          const node = document.getElementById(`cover-el-${el.id}`)
          if (!node) return false
          const r = node.getBoundingClientRect()
          return r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom
        })
        .map(el => el.id)
      setMultiSelectedIds(prev => (prev.length === hits.length && prev.every((id, i) => id === hits[i]) ? prev : hits))
    }

    const onMove = (ev: MouseEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        moved = true
        setSelectedElementId(null)
        setInlineEditingId(null)
      }
      update(ev.clientX, ev.clientY)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMarquee(null)
      if (!moved) return
      // The click that ends the drag must not reselect what it was released over.
      const swallowClick = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallowClick, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0)
      if (hits.length === 1) {
        setMultiSelectedIds([])
        setSelectedElementId(hits[0])
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const multiSelectedSet = new Set(multiSelectedIds)
  /** The outline a box-selected element wears. */
  const multiSelectOutline = (id: string): React.CSSProperties =>
    multiSelectedSet.has(id) ? { outline: '2px solid #38bdf8', outlineOffset: '2px' } : {}

  // Add new Text element (customizable via preset or type)
  const handleAddText = (
    type: 'heading' | 'subheading' | 'body' = 'heading',
    customProps?: Partial<TextCoverElement>
  ) => {
    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)
    let defaultText = 'Add a title'
    let defaultFontSize = 38
    let defaultFontWeight: string | number = 'bold'
    let defaultHeight = 12

    if (type === 'subheading') {
      defaultText = 'Add a subtitle'
      defaultFontSize = 26
      defaultFontWeight = 600
      defaultHeight = 10
    } else if (type === 'body') {
      defaultText = 'Add body text'
      defaultFontSize = 18
      defaultFontWeight = 'normal'
      defaultHeight = 8
    }

    const newTextElem: TextCoverElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      name: customProps?.name || (type === 'heading' ? 'Heading Text' : type === 'subheading' ? 'Subtitle Text' : 'Body Text'),
      text: customProps?.text || defaultText,
      fontFamily: customProps?.fontFamily || 'Inter, sans-serif',
      fontSize: customProps?.fontSize || defaultFontSize,
      fontWeight: customProps?.fontWeight || defaultFontWeight,
      fontStyle: customProps?.fontStyle || 'normal',
      color: customProps?.color || '#ffffff',
      backgroundColor: customProps?.backgroundColor,
      textAlign: customProps?.textAlign || 'center',
      x: customProps?.x ?? 50,
      y: customProps?.y ?? 50,
      width: customProps?.width ?? 75,
      height: customProps?.height ?? defaultHeight,
      rotation: customProps?.rotation ?? 0,
      opacity: customProps?.opacity ?? 1,
      zIndex: maxZ + 1,
      visible: true,
      shadow: customProps?.shadow !== undefined
        ? customProps.shadow
        : { enabled: true, color: '#000000', blur: 10, offsetX: 0, offsetY: 4 },
      stroke: customProps?.stroke,
      letterSpacing: customProps?.letterSpacing,
      lineHeight: customProps?.lineHeight,
      textTransform: customProps?.textTransform,
      backgroundBadge: customProps?.backgroundBadge,
      textDecoration: customProps?.textDecoration,
    }

    pushHistory([...elements, newTextElem])
    setSelectedElementId(newTextElem.id)
  }

  // Add new Shape element
  const handleAddShape = (shapeDef: CoverShapeDef) => {
    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)

    // Compute visually balanced 1:1 square dimensions for basic shapes to prevent distortion
    let initWidth = shapeDef.defaultWidth
    let initHeight = shapeDef.defaultHeight

    if (shapeDef.category === 'basic') {
      const cW = renderedCanvasWidth || 720
      const cH = renderedCanvasHeight || 405
      const minCanvasDim = Math.min(cW, cH)
      const targetSizePx = Math.round(minCanvasDim * 0.35)
      initWidth = Math.round(((targetSizePx / cW) * 100) * 100) / 100
      initHeight = Math.round(((targetSizePx / cH) * 100) * 100) / 100
    }

    const newShapeElem: ShapeCoverElement = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      name: shapeDef.name,
      shapeType: shapeDef.id,
      fillColor: shapeDef.defaultFill,
      strokeColor: shapeDef.defaultStroke,
      strokeWidth: shapeDef.defaultStrokeWidth,
      strokeDasharray: shapeDef.defaultStrokeDasharray,
      x: 50,
      y: 50,
      width: initWidth,
      height: initHeight,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      visible: true,
      aspectRatioLocked: false,
      sides: shapeDef.defaultSides,
      cornerRounding: shapeDef.defaultCornerRounding ?? 0,
    }

    pushHistory([...elements, newShapeElem])
    setSelectedElementId(newShapeElem.id)
  }

  // Add new Image overlay element with natural aspect ratio fitted into canvas
  const handleAddImage = (src: string, name: string = 'Image Overlay') => {
    const img = new Image()
    img.onload = () => {
      const natW = img.naturalWidth || 1000
      const natH = img.naturalHeight || 1000
      const imgRatio = natW / natH

      // Canvas reference base dimensions (340 x 604)
      const baseCanvasW = 340
      const baseCanvasH = 604
      const maxW_px = baseCanvasW * 0.60
      const maxH_px = baseCanvasH * 0.45

      let fitW_px = maxW_px
      let fitH_px = fitW_px / imgRatio

      if (fitH_px > maxH_px) {
        fitH_px = maxH_px
        fitW_px = fitH_px * imgRatio
      }

      const widthPercent = Math.round(((fitW_px / baseCanvasW) * 100) * 10000) / 10000
      const heightPercent = Math.round(((fitH_px / baseCanvasH) * 100) * 10000) / 10000

      const maxZ = Math.max(...elementsRef.current.map(e => e.zIndex || 0), 0)
      const newImgElem: ImageCoverElement = {
        id: `image-${Date.now()}`,
        type: 'image',
        name,
        src,
        x: 50,
        y: 50,
        width: widthPercent,
        height: heightPercent,
        rotation: 0,
        opacity: 1,
        zIndex: maxZ + 1,
        visible: true,
        aspectRatioLocked: true,
        crop: { x: 0, y: 0, width: 100, height: 100 },
      }

      pushHistory([...elementsRef.current, newImgElem])
      setSelectedElementId(newImgElem.id)
    }
    img.src = src
  }

  // Apply template
  const handleApplyTemplate = (tpl: CoverTemplate) => {
    setSelectedTemplateId(tpl.id)

    // If it's a custom template with full foreground elements saved
    if (tpl.elements && tpl.elements.length > 0) {
      const bgElements = elements.filter(el => el.id === 'background-layer' || el.type === 'background')
      const clonedForeground: CoverElement[] = tpl.elements.map((el, idx) => ({
        ...JSON.parse(JSON.stringify(el)),
        id: `${el.type}-tpl-${Date.now()}-${idx}`,
        zIndex: idx + 1,
      }))
      pushHistory([...bgElements, ...clonedForeground])
      setSelectedElementId(null)
      return
    }

    const nonTexts = elements.filter(el => el.type !== 'text')
    const templateTexts: TextCoverElement[] = tpl.texts.map((item, idx) => ({
      id: item.id || `text-tpl-${Date.now()}-${idx}`,
      type: 'text',
      name: item.text || `Text ${idx + 1}`,
      text: item.text,
      fontFamily: item.fontFamily === 'serif' ? 'Playfair Display, serif' : item.fontFamily === 'cursive' ? 'Caveat, cursive' : 'Inter, sans-serif',
      fontSize: item.fontSize || 32,
      fontWeight: item.fontWeight || 'bold',
      fontStyle: (item.fontStyle as 'normal' | 'italic') || 'normal',
      color: item.color || '#ffffff',
      backgroundColor: item.backgroundColor || undefined,
      textAlign: item.textAlign || 'center',
      x: item.x ?? 50,
      y: item.y ?? (30 + idx * 16),
      width: 75,
      height: 12,
      rotation: item.rotation || 0,
      opacity: 1,
      zIndex: idx + 1,
      visible: true,
      letterSpacing: item.letterSpacing,
      lineHeight: item.lineHeight,
      textTransform: item.textTransform,
      shadow: item.shadow
        ? { enabled: true, color: '#000000', blur: 10, offsetX: 0, offsetY: 4 }
        : undefined,
      stroke: item.stroke && item.strokeWidth
        ? { enabled: true, color: item.stroke, width: item.strokeWidth }
        : undefined,
    }))

    pushHistory([...nonTexts, ...templateTexts])
    setSelectedElementId(null)
  }

  // Custom templates management
  const handleDeleteCustomTemplate = (id: string) => {
    const updated = deleteCustomTemplate(id)
    setCustomTemplates(updated)
  }

  // Active custom template (if currently editing or applied one)
  const activeCustomTemplate = customTemplates.find(t => t.id === selectedTemplateId) || null

  // Direct 1-click update of the current custom template
  const handleUpdateCurrentTemplate = async () => {
    if (!activeCustomTemplate) return
    setIsUpdatingTemplate(true)
    try {
      const thumb = await generateCompositeThumbnail()
      const texts: TimelineCoverTextItem[] = elements
        .filter(el => el.type === 'text')
        .map(el => {
          const tEl = el as TextCoverElement
          return {
            id: tEl.id,
            text: tEl.text,
            fontFamily: tEl.fontFamily,
            fontSize: tEl.fontSize,
            fontWeight: String(tEl.fontWeight),
            fontStyle: tEl.fontStyle,
            color: tEl.color,
            backgroundColor: tEl.backgroundBadge?.enabled ? tEl.backgroundBadge.color : tEl.backgroundColor,
            textAlign: tEl.textAlign,
            x: tEl.x,
            y: tEl.y,
            rotation: tEl.rotation,
            letterSpacing: tEl.letterSpacing,
            lineHeight: tEl.lineHeight,
            textTransform: tEl.textTransform,
            shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
            stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
            strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
          }
        })

      const foregroundElements = elements.filter(
        el => el.id !== 'background-layer' && el.type !== 'background'
      )

      const updatedTemplate: CoverTemplate = {
        ...activeCustomTemplate,
        previewThumbnail: thumb || activeCustomTemplate.previewThumbnail,
        texts,
        elements: foregroundElements,
      }

      const updated = saveCustomTemplate(updatedTemplate)
      setCustomTemplates(updated)
      setIsJustUpdated(true)
      setTimeout(() => setIsJustUpdated(false), 2500)
    } catch (err) {
      console.error('[CoverDesignModal] Failed to update template:', err)
    } finally {
      setIsUpdatingTemplate(false)
    }
  }

  // Open modal for creating a new template (Save Template / Save as Template)
  const handleOpenSaveTemplateModal = async () => {
    try {
      const thumb = await generateCompositeThumbnail()
      setTemplatePreviewThumb(thumb)
    } catch (e) {
      console.error('[CoverDesignModal] Failed to generate thumbnail for template:', e)
    }

    if (activeCustomTemplate) {
      setTemplateNameInput(`${activeCustomTemplate.name} (Copy)`)
    } else {
      setTemplateNameInput(`Template ${customTemplates.length + 1}`)
    }
    setShowSaveTemplateModal(true)
  }

  // Confirm creation of a new template
  const handleConfirmSaveTemplate = () => {
    if (!templateNameInput.trim()) return
    setIsSavingTemplate(true)
    try {
      const texts: TimelineCoverTextItem[] = elements
        .filter(el => el.type === 'text')
        .map(el => {
          const tEl = el as TextCoverElement
          return {
            id: tEl.id,
            text: tEl.text,
            fontFamily: tEl.fontFamily,
            fontSize: tEl.fontSize,
            fontWeight: String(tEl.fontWeight),
            fontStyle: tEl.fontStyle,
            color: tEl.color,
            backgroundColor: tEl.backgroundBadge?.enabled ? tEl.backgroundBadge.color : tEl.backgroundColor,
            textAlign: tEl.textAlign,
            x: tEl.x,
            y: tEl.y,
            rotation: tEl.rotation,
            letterSpacing: tEl.letterSpacing,
            lineHeight: tEl.lineHeight,
            textTransform: tEl.textTransform,
            shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
            stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
            strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
          }
        })

      const foregroundElements = elements.filter(
        el => el.id !== 'background-layer' && el.type !== 'background'
      )

      const targetId = `custom-tpl-${Date.now()}`

      const newTemplate: CoverTemplate = {
        id: targetId,
        name: templateNameInput.trim(),
        category: 'custom',
        isCustom: true,
        createdAt: Date.now(),
        previewThumbnail: templatePreviewThumb || undefined,
        texts,
        elements: foregroundElements,
      }

      const updated = saveCustomTemplate(newTemplate)
      setCustomTemplates(updated)
      setSelectedTemplateId(targetId)
      setShowSaveTemplateModal(false)
      setActiveDrawerTab('templates')
    } catch (err) {
      console.error('[CoverDesignModal] Failed to save template:', err)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  // Process uploaded image file: add to library and add to canvas
  const processImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const res = reader.result as string
      const newImgItem: UploadedCoverImage = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        src: res,
        name: file.name,
        addedAt: Date.now(),
      }
      await saveCoverImage(newImgItem)
      setUploadedImages(prev => [newImgItem, ...prev.filter(i => i.id !== newImgItem.id)])
      handleAddImage(res, file.name)
    }
    reader.readAsDataURL(file)
  }, [handleAddImage])

  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processImageFile(file)
    }
    e.target.value = ''
  }

  // Drag-and-drop file handler
  const handleDropFiles = useCallback((files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      processImageFile(files[i])
    }
  }, [processImageFile])

  // Delete image from library
  const handleDeleteUploadedImage = useCallback(async (id: string) => {
    await deleteStoredCoverImage(id)
    setUploadedImages(prev => prev.filter(img => img.id !== id))
  }, [])

  // Render composite canvas to data URL on save
  const generateCompositeThumbnail = async (): Promise<string> => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return initialFrameDataUrl

    canvas.width = BASE_WIDTH
    canvas.height = BASE_HEIGHT

    // Sort visible elements by zIndex
    const sorted = [...elements]
      .filter(el => el.visible !== false)
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))

    for (const el of sorted) {
      ctx.save()
      const pxX = (el.x / 100) * BASE_WIDTH
      const pxY = (el.y / 100) * BASE_HEIGHT
      const pxW = (el.width / 100) * BASE_WIDTH
      const pxH = (el.height / 100) * BASE_HEIGHT

      ctx.globalAlpha = el.opacity ?? 1
      ctx.translate(pxX, pxY)
      if (el.rotation) {
        ctx.rotate(((el.rotation || 0) * Math.PI) / 180)
      }

      if (el.type === 'background') {
        const bg = el as BackgroundCoverElement
        if (bg.src) {
          const img = new Image()
          if (bg.src.startsWith('http://') || bg.src.startsWith('https://')) {
            img.crossOrigin = 'anonymous'
          }
          img.src = bg.src
          await new Promise(r => {
            img.onload = r
            img.onerror = r
          })
          if (img.naturalWidth > 0 && img.naturalHeight > 0 && pxW > 0 && pxH > 0) {
            ctx.drawImage(img, -pxW / 2, -pxH / 2, pxW, pxH)
          }
        } else {
          ctx.fillStyle = '#141416'
          ctx.fillRect(-pxW / 2, -pxH / 2, pxW, pxH)
        }
      } else if (el.type === 'image') {
        const imgEl = el as ImageCoverElement
        if (imgEl.src) {
          const img = new Image()
          if (imgEl.src.startsWith('http://') || imgEl.src.startsWith('https://')) {
            img.crossOrigin = 'anonymous'
          }
          img.src = imgEl.src
          await new Promise(r => {
            img.onload = r
            img.onerror = r
          })

          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            ctx.save()
            if (imgEl.flipH || imgEl.flipV) {
              ctx.scale(imgEl.flipH ? -1 : 1, imgEl.flipV ? -1 : 1)
            }

            // CSS-like filters
            if (imgEl.filters) {
              const f = imgEl.filters
              ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`
            }

            const crop = imgEl.crop || { x: 0, y: 0, width: 100, height: 100 }
            const natW = img.naturalWidth
            const natH = img.naturalHeight
            const sx = Math.max(0, ((crop.x || 0) / 100) * natW)
            const sy = Math.max(0, ((crop.y || 0) / 100) * natH)
            const sW = Math.min(natW - sx, ((crop.width || 100) / 100) * natW)
            const sH = Math.min(natH - sy, ((crop.height || 100) / 100) * natH)

            if (sW > 0 && sH > 0) {
              ctx.drawImage(img, sx, sy, sW, sH, -pxW / 2, -pxH / 2, pxW, pxH)
            }
            ctx.restore()
          }
        }
      } else if (el.type === 'shape') {
        const sEl = el as ShapeCoverElement
        try {
          const svgStr = shapeToFullSvgString(sEl, pxW, pxH)
          const img = new Image()
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`
          await new Promise(r => {
            img.onload = r
            img.onerror = r
          })
          if (img.naturalWidth > 0 && img.naturalHeight > 0 && pxW > 0 && pxH > 0) {
            ctx.drawImage(img, -pxW / 2, -pxH / 2, pxW, pxH)
          }
        } catch (e) {
          console.warn('[CoverDesignModal] Failed to draw shape in thumbnail:', e)
        }
      } else if (el.type === 'text') {
        const tEl = el as TextCoverElement
        const scaledFontSize = Math.round((tEl.fontSize || 32) * 1.6)
        const fontFam = tEl.fontFamily || 'Inter, sans-serif'
        const fontStyle = tEl.fontStyle || 'normal'
        const fontWeight = tEl.fontWeight || 'bold'

        ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFam}`
        ctx.textAlign = (tEl.textAlign as CanvasTextAlign) || 'center'
        ctx.textBaseline = 'middle'

        // Word wrapping based on box width
        const rawWords = (tEl.text || '').split(' ')
        const lines: string[] = []
        let currentLine = ''

        for (let n = 0; n < rawWords.length; n++) {
          const testLine = currentLine ? `${currentLine} ${rawWords[n]}` : rawWords[n]
          const metrics = ctx.measureText(testLine)
          if (metrics.width > pxW && currentLine) {
            lines.push(currentLine)
            currentLine = rawWords[n]
          } else {
            currentLine = testLine
          }
        }
        if (currentLine) lines.push(currentLine)
        if (lines.length === 0) lines.push(tEl.text || '')

        const lineHeight = scaledFontSize * (tEl.lineHeight || 1.2)
        const totalHeight = lines.length * lineHeight
        const startY = -(totalHeight / 2) + (lineHeight / 2)

        // Background Badge
        if (tEl.backgroundBadge?.enabled) {
          let maxLineWidth = 0
          for (const line of lines) {
            maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width)
          }
          const padX = (tEl.backgroundBadge.paddingX ?? 10) * 1.6
          const padY = (tEl.backgroundBadge.paddingY ?? 4) * 1.6
          const bgW = Math.min(pxW + padX * 2, maxLineWidth + padX * 2)
          const bgH = totalHeight + padY * 2
          const rad = (tEl.backgroundBadge.borderRadius ?? 4) * 1.6

          if (bgW > 0 && bgH > 0) {
            ctx.fillStyle = tEl.backgroundBadge.color || '#000000'
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(-bgW / 2, -bgH / 2, bgW, bgH, Math.max(0, rad))
            } else {
              ctx.rect(-bgW / 2, -bgH / 2, bgW, bgH)
            }
            ctx.fill()
          }
        }

        // Render each line: stroke first (behind), then fill on top
        // — matches CSS paintOrder: 'stroke fill' used by the canvas preview.
        lines.forEach((line, idx) => {
          const lineY = startY + idx * lineHeight
          if (tEl.stroke?.enabled) {
            ctx.strokeStyle = tEl.stroke.color || '#000000'
            ctx.lineWidth = (tEl.stroke.width ?? 1) * 2
            ctx.lineJoin = 'round'
            ctx.strokeText(line, 0, lineY)
          }
        })

        // Fill (with shadow) on top so stroke sits behind
        if (tEl.shadow?.enabled) {
          ctx.shadowColor = tEl.shadow.color || 'rgba(0,0,0,0.85)'
          ctx.shadowBlur = (tEl.shadow.blur ?? 10) * 1.6
          ctx.shadowOffsetX = (tEl.shadow.offsetX ?? 0) * 1.6
          ctx.shadowOffsetY = (tEl.shadow.offsetY ?? 4) * 1.6
        }
        ctx.fillStyle = tEl.color || '#ffffff'
        lines.forEach((line, idx) => {
          const lineY = startY + idx * lineHeight
          ctx.fillText(line, 0, lineY)
        })
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
      }

      ctx.restore()
    }

    return canvas.toDataURL('image/png', 0.92)
  }

  const handleSave = async () => {
    try {
      let thumbUrl = ''
      try {
        thumbUrl = await generateCompositeThumbnail()
      } catch (thumbErr) {
        console.warn('[CoverDesignModal] generateCompositeThumbnail failed, using fallback:', thumbErr)
        thumbUrl = initialFrameDataUrl || currentCover?.thumbnailDataUrl || ''
      }

      // Convert TextCoverElements back to TimelineCoverTextItem
      const savedTexts: TimelineCoverTextItem[] = elements
        .filter(el => el.type === 'text')
        .map(el => {
          const tEl = el as TextCoverElement
          return {
            id: tEl.id,
            text: tEl.text,
            fontFamily: tEl.fontFamily,
            fontSize: tEl.fontSize,
            fontWeight: String(tEl.fontWeight),
            fontStyle: tEl.fontStyle,
            color: tEl.color,
            backgroundColor: tEl.backgroundBadge?.enabled ? tEl.backgroundBadge.color : tEl.backgroundColor,
            textAlign: tEl.textAlign,
            x: tEl.x,
            y: tEl.y,
            rotation: tEl.rotation,
            letterSpacing: tEl.letterSpacing,
            lineHeight: tEl.lineHeight,
            textTransform: tEl.textTransform,
            shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
            stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
            strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
          }
        })

      const foregroundElements = elements.filter(
        el => el.id !== 'background-layer' && el.type !== 'background'
      )

      const bgLayer = elements.find(
        el => el.id === 'background-layer' || el.type === 'background'
      ) as ImageCoverElement | undefined

      const bgImageSrc =
        bgLayer?.src ||
        initialFrameDataUrl ||
        currentCover?.customImagePath ||
        currentCover?.thumbnailDataUrl

      const newCover: TimelineCover = {
        type: isLocalImage ? 'custom_image' : 'video_frame',
        time: selectedTime,
        customImagePath: bgImageSrc,
        templateId: selectedTemplateId,
        texts: savedTexts,
        elements: foregroundElements,
        thumbnailDataUrl: thumbUrl,
        updatedAt: Date.now(),
      }

      onSave(newCover)
      onClose()
    } catch (err) {
      console.error('Error saving cover:', err)
      onClose()
    }
  }

  if (!isOpen) return null

  // Rendered canvas pixel dimensions
  const renderedCanvasWidth = 340 * (zoom / 0.65)
  const renderedCanvasHeight = 604 * (zoom / 0.65)

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-[#111113] text-zinc-100 select-none overflow-hidden"
      // While the studio is open its keys are its own: the editor behind it must not also
      // undo, copy or paste on the timeline (see useEditorKeyboard).
      data-editor-shortcuts="off"
    >
      {/* ─── Top Studio Bar ─────────────────────────────────────────── */}
      <div
        className="h-12 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-950 flex-shrink-0 z-30"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-zinc-200 tracking-wide flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            Cover Studio
          </span>

          <div className="h-4 w-[1px] bg-zinc-800 mx-1" />

          {/* Undo / Redo controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={e => {
                e.stopPropagation()
                handleUndo()
              }}
              disabled={history.length === 0}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent text-zinc-400 hover:text-white transition-colors"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={e => {
                e.stopPropagation()
                handleRedo()
              }}
              disabled={future.length === 0}
              title="Redo (Ctrl+Y)"
              className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent text-zinc-400 hover:text-white transition-colors"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={e => {
              e.stopPropagation()
              onClose()
            }}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ─── Main Studio Body ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* 1. Left Vertical Icon Sidebar */}
        <div
          className="w-14 border-r border-zinc-800/80 bg-zinc-950 flex flex-col items-center py-3 gap-3 flex-shrink-0 z-30"
          onClick={e => e.stopPropagation()}
        >
          <Tooltip content="Templates" side="right">
            <button
              onClick={() => setActiveDrawerTab(activeDrawerTab === 'templates' ? null : 'templates')}
              className={`p-2.5 rounded-xl transition-all ${
                activeDrawerTab === 'templates'
                  ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <LayoutTemplate className="h-5 w-5" />
            </button>
          </Tooltip>

          <Tooltip content="Text" side="right">
            <button
              onClick={() => setActiveDrawerTab(activeDrawerTab === 'text' ? null : 'text')}
              className={`p-2.5 rounded-xl transition-all ${
                activeDrawerTab === 'text'
                  ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Type className="h-5 w-5" />
            </button>
          </Tooltip>

          <Tooltip content="Images" side="right">
            <button
              onClick={() => setActiveDrawerTab(activeDrawerTab === 'images' ? null : 'images')}
              className={`p-2.5 rounded-xl transition-all ${
                activeDrawerTab === 'images'
                  ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <ImageIcon className="h-5 w-5" />
            </button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <Tooltip content="Shapes" side="right">
            <button
              onClick={() => setActiveDrawerTab(activeDrawerTab === 'shapes' ? null : 'shapes')}
              className={`p-2.5 rounded-xl transition-all ${
                activeDrawerTab === 'shapes'
                  ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Shapes className="h-5 w-5" />
            </button>
          </Tooltip>

          <Tooltip content="Layers" side="right">
            <button
              onClick={() => setActiveDrawerTab(activeDrawerTab === 'position' ? null : 'position')}
              className={`p-2.5 rounded-xl transition-all ${
                activeDrawerTab === 'position'
                  ? 'bg-sky-500/20 text-sky-400 shadow ring-1 ring-sky-500/40'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Layers className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        {/* 2. Left Secondary Drawer (Position / Layers / Effects / Edit / Templates / Images) */}
        <CoverLeftDrawer
          isOpen={activeDrawerTab !== null}
          activeTab={activeDrawerTab}
          onClose={() => setActiveDrawerTab(null)}
          selectedElement={selectedElement}
          elements={elements}
          canvasWidth={renderedCanvasWidth}
          canvasHeight={renderedCanvasHeight}
          onSelectElement={id => setSelectedElementId(id)}
          onUpdateElement={handleUpdateElement}
          onReorderElements={reordered => pushHistory(reordered)}
          onApplyTemplate={handleApplyTemplate}
          customTemplates={customTemplates}
          onDeleteCustomTemplate={handleDeleteCustomTemplate}
          onSaveCurrentAsTemplate={handleOpenSaveTemplateModal}
          onRunBgRemoval={handleRunBgRemoval}
          onRestoreBg={handleRestoreBg}
          isProcessingBgRemoval={isProcessingBgRemoval}
          uploadedImages={uploadedImages}
          onAddImageToCanvas={handleAddImage}
          onUploadNewImage={() => fileInputRef.current?.click()}
          onDeleteUploadedImage={handleDeleteUploadedImage}
          onDropFiles={handleDropFiles}
          onAddText={handleAddText}
          onAddShape={handleAddShape}
        />

        {/* 3. Center Canvas Workspace Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0c0c0e] relative">
          {/* Top Contextual Action Toolbar */}
          <CoverContextualToolbar
            selectedElement={selectedElement}
            activeDrawerTab={activeDrawerTab}
            onOpenDrawerTab={tab => setActiveDrawerTab(tab)}
            onUpdateText={updates => {
              if (selectedElementId) handleUpdateElement(selectedElementId, updates)
            }}
            onUpdateImage={updates => {
              if (selectedElementId) handleUpdateElement(selectedElementId, updates)
            }}
            onUpdateShape={updates => {
              if (selectedElementId) handleUpdateElement(selectedElementId, updates)
            }}
            onReplaceImage={() => setActiveDrawerTab('images')}
            onDuplicate={handleDuplicateElement}
            onRunBgRemoval={handleRunBgRemoval}
            onRestoreBg={handleRestoreBg}
            isProcessingBgRemoval={isProcessingBgRemoval}
          />

          {/* Canvas Viewport */}
          <div
            ref={containerRef}
            className="flex-1 flex items-center justify-center relative overflow-auto p-16 select-none"
            onMouseDown={e => {
              if (e.target === containerRef.current) {
                setSelectedElementId(null)
                setMultiSelectedIds([])
                handleStartMarquee(e)
              }
            }}
            onClick={e => {
              if (e.target === containerRef.current) setSelectedElementId(null)
            }}
          >
            {/* Outer Artboard Wrapper (overflow-visible allows transform box & handles to extend beyond canvas) */}
            <div
              className="relative select-none flex-shrink-0"
              style={{
                width: `${renderedCanvasWidth}px`,
                height: `${renderedCanvasHeight}px`,
              }}
            >
              {/* Interactive Cover Canvas Frame (Clipped) */}
              <div
                className="absolute inset-0 rounded-lg overflow-hidden bg-black border border-zinc-800 shadow-2xl transition-all"
                onMouseDown={e => {
                  frameMouseDownTargetRef.current = e.target
                  if (e.target === e.currentTarget) {
                    setSelectedElementId(null)
                    setInlineEditingId(null)
                    setMultiSelectedIds([])
                    handleStartMarquee(e)
                  }
                }}
                onClick={e => {
                  if (e.target === e.currentTarget && frameMouseDownTargetRef.current === e.currentTarget) {
                    setSelectedElementId(null)
                    setInlineEditingId(null)
                  }
                  frameMouseDownTargetRef.current = null
                }}
              >
                {/* Render sorted elements */}
              {elements
                .filter(el => el.visible !== false)
                .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
                .map(el => {
                  const pxX = (el.x / 100) * renderedCanvasWidth
                  const pxY = (el.y / 100) * renderedCanvasHeight
                  const pxW = (el.width / 100) * renderedCanvasWidth
                  const pxH = (el.height / 100) * renderedCanvasHeight

                  if (el.type === 'image' || el.type === 'background') {
                    const imgEl = el as ImageCoverElement
                    const crop = imgEl.crop || { x: 0, y: 0, width: 100, height: 100 }
                    const cropW = Math.max(1, crop.width || 100)
                    const cropH = Math.max(1, crop.height || 100)
                    const cropX = crop.x || 0
                    const cropY = crop.y || 0

                    const innerW = (100 / cropW) * 100
                    const innerH = (100 / cropH) * 100
                    const innerLeft = -(cropX / cropW) * 100
                    const innerTop = -(cropY / cropH) * 100

                    return (
                      <div
                        key={el.id}
                        id={`cover-el-${el.id}`}
                        onMouseDown={e => {
                          e.stopPropagation()
                          // The frame behind everything is where a selection box starts;
                          // once it is itself selected, it drags like anything else.
                          if (isCoverBackground(el) && selectedElementId !== el.id) {
                            setMultiSelectedIds([])
                            handleStartMarquee(e)
                            return
                          }
                          handleStartMoveElement(e, el)
                        }}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedElementId(el.id)
                        }}
                        className="absolute cursor-move transition-opacity select-none"
                        style={{
                          left: `${pxX}px`,
                          top: `${pxY}px`,
                          width: `${pxW}px`,
                          height: `${pxH}px`,
                          transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                          zIndex: el.zIndex,
                          opacity: el.opacity ?? 1,
                          overflow: 'hidden',
                          ...multiSelectOutline(el.id),
                          borderRadius: imgEl.borderRadius ? `${imgEl.borderRadius}px` : undefined,
                        }}
                      >
                        <div className="relative w-full h-full overflow-hidden">
                          {imgEl.src ? (
                            <img
                              src={imgEl.src}
                              alt={imgEl.name || 'Image'}
                              className="absolute select-none pointer-events-none max-w-none"
                              style={{
                                width: `${innerW}%`,
                                height: `${innerH}%`,
                                left: `${innerLeft}%`,
                                top: `${innerTop}%`,
                                transform: `scale(${imgEl.flipH ? -1 : 1}, ${imgEl.flipV ? -1 : 1})`,
                                filter: imgEl.filters
                                  ? `brightness(${imgEl.filters.brightness}%) contrast(${imgEl.filters.contrast}%) saturate(${imgEl.filters.saturation}%) blur(${imgEl.filters.blur}px)`
                                  : undefined,
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-zinc-950 flex items-center justify-center">
                              <ImageIcon className="h-12 w-12 text-zinc-700" />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  }

                  if (el.type === 'shape') {
                    const sEl = el as ShapeCoverElement
                    return (
                      <div
                        key={el.id}
                        id={`cover-el-${el.id}`}
                        onMouseDown={e => {
                          e.stopPropagation()
                          handleStartMoveElement(e, el)
                        }}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedElementId(el.id)
                        }}
                        className="absolute cursor-move transition-opacity select-none"
                        style={{
                          left: `${pxX}px`,
                          top: `${pxY}px`,
                          width: `${pxW}px`,
                          height: `${pxH}px`,
                          transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                          zIndex: el.zIndex,
                          opacity: el.opacity ?? 1,
                          overflow: 'visible',
                          ...multiSelectOutline(el.id),
                        }}
                      >
                        <ShapeSvgRenderer shape={sEl} widthPx={pxW} heightPx={pxH} />
                      </div>
                    )
                  }

                  if (el.type === 'text') {
                    const tEl = el as TextCoverElement
                    const isInline = inlineEditingId === el.id

                    return (
                      <div
                        key={el.id}
                        id={`cover-el-${el.id}`}
                        onMouseDown={e => {
                          e.stopPropagation()
                          if (!isInline) {
                            handleStartMoveElement(e, el)
                          }
                        }}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedElementId(el.id)
                        }}
                        onDoubleClick={e => {
                          e.stopPropagation()
                          setSelectedElementId(el.id)
                          setInlineEditingId(el.id)
                        }}
                        className={`absolute select-none ${isInline ? 'cursor-text' : 'cursor-move'}`}
                        style={{
                          left: `${pxX}px`,
                          top: `${pxY}px`,
                          width: `${pxW}px`,
                          transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                          zIndex: isInline ? el.zIndex + 20 : el.zIndex,
                          opacity: el.opacity ?? 1,
                          ...multiSelectOutline(el.id),
                        }}
                      >
                        {isInline ? (
                          <div className="relative w-full">
                            <textarea
                              autoFocus
                              ref={textarea => {
                                if (textarea) {
                                  textarea.style.height = 'auto'
                                  textarea.style.height = `${Math.max(textarea.scrollHeight, 24)}px`
                                  if (document.activeElement !== textarea) {
                                    textarea.focus()
                                    textarea.select()
                                  }
                                }
                              }}
                              value={tEl.text}
                              onChange={e => {
                                handleUpdateElement(el.id, { text: e.target.value })
                                e.target.style.height = 'auto'
                                e.target.style.height = `${Math.max(e.target.scrollHeight, 24)}px`
                              }}
                              onMouseDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onDoubleClick={e => e.stopPropagation()}
                              onBlur={() => setInlineEditingId(null)}
                              onKeyDown={e => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setInlineEditingId(null)
                                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault()
                                  setInlineEditingId(null)
                                }
                              }}
                              className="w-full outline-none resize-none overflow-hidden block border-2 border-sky-400 rounded cursor-text"
                              style={{
                                width: '100%',
                                color: tEl.color || '#ffffff',
                                fontSize: `${(tEl.fontSize || 28) * (zoom / 0.65)}px`,
                                fontFamily: tEl.fontFamily || 'Inter, sans-serif',
                                fontWeight: tEl.fontWeight || 'bold',
                                fontStyle: tEl.fontStyle || 'normal',
                                textDecoration: tEl.textDecoration || 'none',
                                textTransform: tEl.textTransform || 'none',
                                textAlign: tEl.textAlign || 'center',
                                letterSpacing: tEl.letterSpacing ? `${tEl.letterSpacing}px` : undefined,
                                lineHeight: tEl.lineHeight || 1.2,
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                backgroundColor: tEl.backgroundBadge?.enabled
                                  ? tEl.backgroundBadge.color
                                  : tEl.backgroundColor && tEl.backgroundColor !== 'transparent'
                                    ? tEl.backgroundColor
                                    : 'transparent',
                                padding: tEl.backgroundBadge?.enabled
                                  ? `${tEl.backgroundBadge.paddingY}px ${tEl.backgroundBadge.paddingX}px`
                                  : '0px',
                                borderRadius: tEl.backgroundBadge?.enabled
                                  ? `${tEl.backgroundBadge.borderRadius}px`
                                  : '4px',
                                textShadow: tEl.shadow?.enabled
                                  ? `${tEl.shadow.offsetX}px ${tEl.shadow.offsetY}px ${tEl.shadow.blur}px ${tEl.shadow.color}`
                                  : undefined,
                                WebkitTextStroke: tEl.stroke?.enabled
                                  ? `${tEl.stroke.width}px ${tEl.stroke.color}`
                                  : undefined,
                                paintOrder: 'stroke fill',
                                caretColor: '#38bdf8',
                                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.25)',
                              }}
                            />

                            {/* Corner handles & edge pills to match the exact focus state */}
                            <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                            <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                            <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                            <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-1.5 h-3.5 bg-white border border-sky-500 rounded-full shadow pointer-events-none" />
                            <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-1.5 h-3.5 bg-white border border-sky-500 rounded-full shadow pointer-events-none" />

                            {/* Dimension badge at bottom-right */}
                            <div className="absolute -bottom-6 right-0 px-1.5 py-0.5 bg-zinc-900/90 border border-zinc-700/80 rounded text-[10px] text-zinc-300 font-mono shadow pointer-events-none whitespace-nowrap">
                              {Math.round(pxW)} × {Math.round(pxH || 54)} px
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              color: tEl.color || '#ffffff',
                              fontSize: `${(tEl.fontSize || 28) * (zoom / 0.65)}px`,
                              fontFamily: tEl.fontFamily || 'Inter, sans-serif',
                              fontWeight: tEl.fontWeight || 'bold',
                              fontStyle: tEl.fontStyle || 'normal',
                              textDecoration: tEl.textDecoration || 'none',
                              textTransform: tEl.textTransform || 'none',
                              textAlign: tEl.textAlign || 'center',
                              letterSpacing: tEl.letterSpacing ? `${tEl.letterSpacing}px` : undefined,
                              lineHeight: tEl.lineHeight || 1.2,
                              wordBreak: 'break-word',
                              whiteSpace: 'pre-wrap',
                              backgroundColor: tEl.backgroundBadge?.enabled
                                ? tEl.backgroundBadge.color
                                : tEl.backgroundColor || 'transparent',
                              padding: tEl.backgroundBadge?.enabled
                                ? `${tEl.backgroundBadge.paddingY}px ${tEl.backgroundBadge.paddingX}px`
                                : undefined,
                              borderRadius: tEl.backgroundBadge?.enabled
                                ? `${tEl.backgroundBadge.borderRadius}px`
                                : undefined,
                              textShadow: tEl.shadow?.enabled
                                ? `${tEl.shadow.offsetX}px ${tEl.shadow.offsetY}px ${tEl.shadow.blur}px ${tEl.shadow.color}`
                                : undefined,
                              WebkitTextStroke: tEl.stroke?.enabled
                                ? `${tEl.stroke.width}px ${tEl.stroke.color}`
                                : undefined,
                              paintOrder: 'stroke fill',
                            }}
                          >
                            {tEl.text}
                          </div>
                        )}
                      </div>
                    )
                  }

                  return null
                })}
              </div>

              {/* 2. Selection Transform Box Overlay (OVERFLOW VISIBLE - outside clipped canvas) */}
              {selectedElement && inlineEditingId !== selectedElement.id && (
                <div className="absolute inset-0 overflow-visible pointer-events-none z-30">
                  <div className="pointer-events-auto">
                    <CoverTransformBox
                      element={selectedElement}
                      canvasWidth={renderedCanvasWidth}
                      canvasHeight={renderedCanvasHeight}
                      onChange={updates => handleUpdateElement(selectedElement.id, updates)}
                      onStartTransform={handleStartTransform}
                      onCommit={handleCommitTransform}
                      onDuplicate={handleDuplicateElement}
                      onDelete={handleDeleteElement}
                      onLockToggle={handleLockToggle}
                      onBringForward={handleBringForward}
                      onSendBackward={handleSendBackward}
                      onBringToFront={handleBringToFront}
                      onSendToBack={handleSendToBack}
                      onDoubleClick={() => {
                        if (selectedElement.type === 'text') {
                          setInlineEditingId(selectedElement.id)
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Selection box being dragged */}
            {marquee && (
              <div
                data-cover-marquee
                className="absolute z-40 pointer-events-none border border-sky-400 bg-sky-400/10 rounded-sm"
                style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
              />
            )}

            {/* What Ctrl+C just did */}
            {copyNotice && (
              <div
                data-cover-copy-notice
                className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-zinc-900/95 border border-sky-500/50 text-xs text-zinc-100 shadow-xl pointer-events-none whitespace-nowrap"
              >
                {copyNotice}
              </div>
            )}

            {/* Bottom Zoom Controller Bar */}
            <div className="absolute bottom-4 left-6 flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300 shadow-lg">
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom(prev => Math.min(1.2, prev + 0.1))}
                  className="hover:text-white"
                  title="Zoom in"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setZoom(prev => Math.max(0.35, prev - 0.1))}
                  className="hover:text-white"
                  title="Zoom out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Bottom-Right Action Buttons: Save Template, Exit & Save */}
            <div className="absolute bottom-4 right-6 flex items-center gap-3 z-30">
              {activeCustomTemplate ? (
                <>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleUpdateCurrentTemplate()
                    }}
                    disabled={isUpdatingTemplate}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-600/60 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title={`Cập nhật thay đổi trực tiếp vào template "${activeCustomTemplate.name}"`}
                  >
                    {isJustUpdated ? (
                      <BookmarkCheck className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isUpdatingTemplate ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : (
                      <BookmarkCheck className="h-3.5 w-3.5" />
                    )}
                    <span>{isJustUpdated ? 'Đã cập nhật!' : isUpdatingTemplate ? 'Đang cập nhật...' : 'Update Template'}</span>
                  </button>

                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleOpenSaveTemplateModal()
                    }}
                    className="px-3.5 py-2 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Tạo template mới từ thiết kế hiện tại"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 text-amber-400" />
                    <span>Save as Template</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleOpenSaveTemplateModal()
                  }}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Lưu thiết kế hiện tại thành template riêng"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  <span>Save Template</span>
                </button>
              )}

              <button
                onClick={e => {
                  e.stopPropagation()
                  onClose()
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
                title="Exit without saving"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{t('common.cancel') || 'Exit'}</span>
              </button>

              <button
                onClick={e => {
                  e.stopPropagation()
                  handleSave()
                }}
                className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-sky-500 hover:bg-sky-400 shadow-xl shadow-sky-500/25 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Save cover changes"
              >
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>{t('common.save') || 'Save Cover'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ─── SAVE TEMPLATE MODAL DIALOG ───────────────────────────── */}
        {showSaveTemplateModal && (
          <div
            className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
            onMouseDown={e => {
              if (e.target === e.currentTarget) {
                setShowSaveTemplateModal(false)
              }
            }}
          >
            <div
              className="bg-[#18181b] border border-zinc-700/80 rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4 text-zinc-200"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              onKeyUp={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <BookmarkPlus className="w-4 h-4" />
                  <span>Lưu làm Template của bạn</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)}
                  className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Preview Thumbnail Card */}
              <div className="flex gap-4 items-center p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <div className="w-16 h-28 rounded-lg overflow-hidden border border-zinc-700/60 bg-black flex-shrink-0 relative shadow">
                  {templatePreviewThumb ? (
                    <img
                      src={templatePreviewThumb}
                      alt="Template Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                      Preview
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-1 text-xs">
                  <p className="font-semibold text-zinc-200">Bản mẫu tái sử dụng</p>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Template này sẽ lưu lại toàn bộ kiểu chữ, hình khối và bố cục đang có để bạn dễ dàng áp dụng cho các video khác sau này.
                  </p>
                </div>
              </div>

              {/* Input for Template Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Tên Template
                </label>
                <input
                  type="text"
                  value={templateNameInput}
                  onChange={e => setTemplateNameInput(e.target.value)}
                  onFocus={e => e.target.select()}
                  placeholder="Nhập tên template (ví dụ: Vlog Daily, Review...)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700/80 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                  autoFocus
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      handleConfirmSaveTemplate()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setShowSaveTemplateModal(false)
                    }
                  }}
                  onKeyUp={e => e.stopPropagation()}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={!templateNameInput.trim() || isSavingTemplate}
                  onClick={handleConfirmSaveTemplate}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>{isSavingTemplate ? 'Đang lưu...' : 'Lưu Template'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
