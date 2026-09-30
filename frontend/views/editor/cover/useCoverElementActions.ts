import { useState, useCallback } from 'react'
import type { CoverShapeDef } from './cover-shapes'
import type { CoverTemplate } from './cover-templates'
import type {
  CoverElement,
  TextCoverElement,
  ImageCoverElement,
  ShapeCoverElement,
} from './types'
import { removeImageBackground } from './cover-image-utils'

export function useCoverElementActions(
  elements: CoverElement[],
  setElements: React.Dispatch<React.SetStateAction<CoverElement[]>>,
  elementsRef: React.MutableRefObject<CoverElement[]>,
  pushHistory: (newElements: CoverElement[]) => void,
  handleStartTransform: () => void,
  handleCommitTransform: () => void,
  selectedElementId: string | null,
  setSelectedElementId: (id: string | null) => void,
  renderedCanvasWidth: number,
  renderedCanvasHeight: number,
  setSelectedTemplateId: (id: string) => void
) {
  const [isProcessingBgRemoval, setIsProcessingBgRemoval] = useState(false)

  const handleUpdateElement = useCallback((id: string, updates: Partial<CoverElement>) => {
    setElements(prev =>
      prev.map(el => (el.id === id ? ({ ...el, ...updates } as CoverElement) : el))
    )
  }, [setElements])

  const handleRunBgRemoval = useCallback(async (id: string) => {
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
  }, [elements, handleUpdateElement])

  const handleRestoreBg = useCallback((id: string) => {
    const el = elements.find(e => e.id === id)
    if (!el || (el.type !== 'image' && el.type !== 'background')) return
    const imgEl = el as ImageCoverElement
    if (imgEl.originalSrc) {
      handleUpdateElement(id, {
        src: imgEl.originalSrc,
        bgRemoved: false,
      })
    }
  }, [elements, handleUpdateElement])

  const handleDuplicateElement = useCallback((id: string) => {
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
  }, [elements, pushHistory, setSelectedElementId])

  const handleDeleteElement = useCallback((id: string) => {
    const target = elements.find(el => el.id === id)
    if (!target || target.type === 'background') return

    pushHistory(elements.filter(el => el.id !== id))
    if (selectedElementId === id) setSelectedElementId(null)
  }, [elements, pushHistory, selectedElementId, setSelectedElementId])

  const handleLockToggle = useCallback((id: string) => {
    setElements(prev =>
      prev.map(el => (el.id === id ? { ...el, isLocked: !el.isLocked } : el))
    )
  }, [setElements])

  const handleBringForward = useCallback((id: string) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const idx = list.findIndex(e => e.id === id)
    if (idx === -1 || idx === list.length - 1) return
    const temp = list[idx].zIndex
    list[idx].zIndex = list[idx + 1].zIndex
    list[idx + 1].zIndex = temp
    pushHistory([...list])
  }, [elements, pushHistory])

  const handleSendBackward = useCallback((id: string) => {
    const list = [...elements].sort((a, b) => a.zIndex - b.zIndex)
    const idx = list.findIndex(e => e.id === id)
    if (idx <= 1) return
    const temp = list[idx].zIndex
    list[idx].zIndex = list[idx - 1].zIndex
    list[idx - 1].zIndex = temp
    pushHistory([...list])
  }, [elements, pushHistory])

  const handleBringToFront = useCallback((id: string) => {
    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)
    pushHistory(elements.map(el => (el.id === id ? { ...el, zIndex: maxZ + 1 } : el)))
  }, [elements, pushHistory])

  const handleSendToBack = useCallback((id: string) => {
    pushHistory(elements.map(el => (el.id === id ? { ...el, zIndex: 1 } : el)))
  }, [elements, pushHistory])

  const handleStartMoveElement = useCallback((e: React.MouseEvent, el: CoverElement) => {
    e.stopPropagation()
    setSelectedElementId(el.id)
    if (el.isLocked) return

    handleStartTransform()
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
          if (latestEv) processMove(latestEv)
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
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [
    handleCommitTransform,
    handleStartTransform,
    handleUpdateElement,
    renderedCanvasHeight,
    renderedCanvasWidth,
    setSelectedElementId,
  ])

  const handleAddText = useCallback((
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

    const newText: TextCoverElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      name: defaultText,
      text: defaultText,
      fontFamily: 'Inter, sans-serif',
      fontSize: defaultFontSize,
      fontWeight: defaultFontWeight,
      fontStyle: 'normal',
      color: '#ffffff',
      textAlign: 'center',
      x: 50,
      y: 50,
      width: 70,
      height: defaultHeight,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      isLocked: false,
      visible: true,
      shadow: {
        enabled: true,
        color: '#000000',
        blur: 10,
        offsetX: 0,
        offsetY: 4,
      },
      ...customProps,
    }

    pushHistory([...elements, newText])
    setSelectedElementId(newText.id)
  }, [elements, pushHistory, setSelectedElementId])

  const handleAddShape = useCallback((shapeDef: CoverShapeDef) => {
    const maxZ = Math.max(...elements.map(e => e.zIndex || 0), 0)

    const newShape: ShapeCoverElement = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      name: shapeDef.name,
      shapeType: shapeDef.id,
      fillColor: shapeDef.defaultFill || '#ffffff',
      strokeColor: shapeDef.defaultStroke || '#000000',
      strokeWidth: shapeDef.defaultStrokeWidth || 0,
      borderRadius: 0,
      x: 50,
      y: 50,
      width: 30,
      height: 30,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      isLocked: false,
      visible: true,
      aspectRatioLocked: shapeDef.id === 'circle',
    }

    pushHistory([...elements, newShape])
    setSelectedElementId(newShape.id)
  }, [elements, pushHistory, setSelectedElementId])

  const handleAddImage = useCallback((imgSrc: string, name = 'Image Layer') => {
    const maxZ = Math.max(...elementsRef.current.map(e => e.zIndex || 0), 0)

    const newImg: ImageCoverElement = {
      id: `img-${Date.now()}`,
      type: 'image',
      name,
      src: imgSrc,
      x: 50,
      y: 50,
      width: 45,
      height: 45,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      isLocked: false,
      visible: true,
      aspectRatioLocked: false,
      crop: { x: 0, y: 0, width: 100, height: 100 },
    }

    pushHistory([...elementsRef.current, newImg])
    setSelectedElementId(newImg.id)
  }, [elementsRef, pushHistory, setSelectedElementId])

  const handleApplyTemplate = useCallback((tpl: CoverTemplate) => {
    setSelectedTemplateId(tpl.id)

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
  }, [elements, pushHistory, setSelectedElementId, setSelectedTemplateId])

  return {
    isProcessingBgRemoval,
    handleUpdateElement,
    handleRunBgRemoval,
    handleRestoreBg,
    handleDuplicateElement,
    handleDeleteElement,
    handleLockToggle,
    handleBringForward,
    handleSendBackward,
    handleBringToFront,
    handleSendToBack,
    handleStartMoveElement,
    handleAddText,
    handleAddShape,
    handleAddImage,
    handleApplyTemplate,
  }
}
