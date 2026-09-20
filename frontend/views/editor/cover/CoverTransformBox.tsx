import React, { useState, useEffect, useRef } from 'react'
import {
  Copy,
  Trash2,
  Lock,
  Unlock,
  RotateCw,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Edit3,
} from 'lucide-react'
import type { CoverElement, TextCoverElement, ImageCoverElement } from './types'

export interface CoverTransformBoxProps {
  element: CoverElement
  canvasWidth: number
  canvasHeight: number
  onChange: (updated: Partial<CoverElement> | Record<string, any>) => void
  onStartTransform?: () => void
  onCommit?: () => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onLockToggle: (id: string) => void
  onBringForward: (id: string) => void
  onSendBackward: (id: string) => void
  onBringToFront: (id: string) => void
  onSendToBack: (id: string) => void
  onDoubleClick?: () => void
}

type DragMode = 'move' | 'rotate' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | null

export const CoverTransformBox: React.FC<CoverTransformBoxProps> = ({
  element,
  canvasWidth,
  canvasHeight,
  onChange,
  onStartTransform,
  onCommit,
  onDuplicate,
  onDelete,
  onLockToggle,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onDoubleClick,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const onStartTransformRef = useRef(onStartTransform)
  onStartTransformRef.current = onStartTransform
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const isText = element.type === 'text'

  // Measure actual text element rendered height in the DOM
  useEffect(() => {
    if (isText) {
      const elNode = document.getElementById(`cover-el-${element.id}`)
      if (elNode) {
        setMeasuredHeight(elNode.offsetHeight)
      }
    }
  }, [
    element.id,
    isText,
    element.width,
    (element as TextCoverElement).fontSize,
    (element as TextCoverElement).text,
    canvasWidth,
    canvasHeight,
  ])

  // Pixel metrics
  const pxWidth = Math.max(10, (element.width / 100) * canvasWidth)
  const pxHeight = isText && measuredHeight
    ? Math.max(20, measuredHeight)
    : element.type === 'shape'
      ? Math.max(4, (element.height / 100) * canvasHeight)
      : Math.max(16, (element.height / 100) * canvasHeight)
  const pxCenterX = (element.x / 100) * canvasWidth
  const pxCenterY = (element.y / 100) * canvasHeight

  const roundHigh = (v: number) => Math.round(v * 10000) / 10000

  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    origX: number
    origY: number
    origWidth: number
    origHeight: number
    origWidthPx: number
    origHeightPx: number
    origCrop?: { x: number; y: number; width: number; height: number }
    origFullWidthPx: number
    origFullHeightPx: number
    origFontSize: number
    origRotation: number
    centerPxX: number
    centerPxY: number
    anchorPxX: number
    anchorPxY: number
    uXx: number
    uXy: number
    uYx: number
    uYy: number
    screenCenterX: number
    screenCenterY: number
    lastAngleRad: number
    accumulatedDeg: number
  } | null>(null)

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      if (element.isLocked) return

      const stepPercent = e.shiftKey ? 2 : 0.5

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onStartTransformRef.current?.()
        onChangeRef.current({ x: Math.max(0, element.x - stepPercent) })
        onCommitRef.current?.()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onStartTransformRef.current?.()
        onChangeRef.current({ x: Math.min(100, element.x + stepPercent) })
        onCommitRef.current?.()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        onStartTransformRef.current?.()
        onChangeRef.current({ y: Math.max(0, element.y - stepPercent) })
        onCommitRef.current?.()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        onStartTransformRef.current?.()
        onChangeRef.current({ y: Math.min(100, element.y + stepPercent) })
        onCommitRef.current?.()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDelete(element.id)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        onDuplicate(element.id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [element, onDelete, onDuplicate])

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    if (element.isLocked && mode !== 'move') return

    onStartTransformRef.current?.()
    let hasMoved = false

    const origFontSize = (element as TextCoverElement).fontSize || 32
    const imgCrop = (element as ImageCoverElement).crop || { x: 0, y: 0, width: 100, height: 100 }
    const cropW = Math.max(1, imgCrop.width || 100)
    const cropH = Math.max(1, imgCrop.height || 100)

    const origWidthPx = Math.max(10, (element.width / 100) * canvasWidth)
    const origHeightPx = isText && measuredHeight
      ? Math.max(20, measuredHeight)
      : element.type === 'shape'
        ? Math.max(4, (element.height / 100) * canvasHeight)
        : Math.max(16, (element.height / 100) * canvasHeight)
    const origCenterX = (element.x / 100) * canvasWidth
    const origCenterY = (element.y / 100) * canvasHeight

    const origFullWidthPx = (origWidthPx / cropW) * 100
    const origFullHeightPx = (origHeightPx / cropH) * 100

    const rotRad = ((element.rotation || 0) * Math.PI) / 180
    const cosRot = Math.cos(rotRad)
    const sinRot = Math.sin(rotRad)

    // Unit vectors in screen space:
    // uX: (+cosRot, +sinRot) points towards East handle (+X)
    // uY: (-sinRot, +cosRot) points towards South handle (+Y)
    const uXx = cosRot
    const uXy = sinRot
    const uYx = -sinRot
    const uYy = cosRot

    let anchorPxX = origCenterX
    let anchorPxY = origCenterY

    if (mode === 'e') {
      // East handle dragged -> West edge center is pinned
      anchorPxX = origCenterX - (origWidthPx / 2) * uXx
      anchorPxY = origCenterY - (origWidthPx / 2) * uXy
    } else if (mode === 'w') {
      // West handle dragged -> East edge center is pinned
      anchorPxX = origCenterX + (origWidthPx / 2) * uXx
      anchorPxY = origCenterY + (origWidthPx / 2) * uXy
    } else if (mode === 's') {
      // South handle dragged -> North edge center is pinned
      anchorPxX = origCenterX - (origHeightPx / 2) * uYx
      anchorPxY = origCenterY - (origHeightPx / 2) * uYy
    } else if (mode === 'n') {
      // North handle dragged -> South edge center is pinned
      anchorPxX = origCenterX + (origHeightPx / 2) * uYx
      anchorPxY = origCenterY + (origHeightPx / 2) * uYy
    } else if (mode === 'se') {
      // South-East corner dragged -> North-West corner is pinned
      anchorPxX = origCenterX - (origWidthPx / 2) * uXx - (origHeightPx / 2) * uYx
      anchorPxY = origCenterY - (origWidthPx / 2) * uXy - (origHeightPx / 2) * uYy
    } else if (mode === 'sw') {
      // South-West corner dragged -> North-East corner is pinned
      anchorPxX = origCenterX + (origWidthPx / 2) * uXx - (origHeightPx / 2) * uYx
      anchorPxY = origCenterY + (origWidthPx / 2) * uXy - (origHeightPx / 2) * uYy
    } else if (mode === 'ne') {
      // North-East corner dragged -> South-West corner is pinned
      anchorPxX = origCenterX - (origWidthPx / 2) * uXx + (origHeightPx / 2) * uYx
      anchorPxY = origCenterY - (origWidthPx / 2) * uXy + (origHeightPx / 2) * uYy
    } else if (mode === 'nw') {
      // North-West corner dragged -> South-East corner is pinned
      anchorPxX = origCenterX + (origWidthPx / 2) * uXx + (origHeightPx / 2) * uYx
      anchorPxY = origCenterY + (origWidthPx / 2) * uXy + (origHeightPx / 2) * uYy
    }

    let screenCenterX = e.clientX
    let screenCenterY = e.clientY
    if (boxRef.current) {
      const rect = boxRef.current.getBoundingClientRect()
      screenCenterX = rect.left + rect.width / 2
      screenCenterY = rect.top + rect.height / 2
    }
    const startAngleRad = Math.atan2(e.clientY - screenCenterY, e.clientX - screenCenterX)
    const initialRot = element.rotation || 0

    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: element.x,
      origY: element.y,
      origWidth: element.width,
      origHeight: element.height,
      origWidthPx,
      origHeightPx,
      origCrop: imgCrop,
      origFullWidthPx,
      origFullHeightPx,
      origFontSize,
      origRotation: initialRot,
      centerPxX: origCenterX,
      centerPxY: origCenterY,
      anchorPxX,
      anchorPxY,
      uXx,
      uXy,
      uYx,
      uYy,
      screenCenterX,
      screenCenterY,
      lastAngleRad: startAngleRad,
      accumulatedDeg: initialRot,
    }

    let rafId: number | null = null
    let latestEv: MouseEvent | null = null

    const processMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const {
        mode: currentMode,
        startX,
        startY,
        origX,
        origY,
        origWidthPx,
        origHeightPx,
        origCrop,
        origFullWidthPx,
        origFullHeightPx,
        origFontSize,
        anchorPxX,
        anchorPxY,
        uXx,
        uXy,
        uYx,
        uYy,
      } = dragRef.current

      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      if (!hasMoved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        hasMoved = true
      }

      if (currentMode === 'move') {
        if (element.isLocked) return
        const newX = origX + (dx / canvasWidth) * 100
        const newY = origY + (dy / canvasHeight) * 100
        onChangeRef.current({
          x: roundHigh(newX),
          y: roundHigh(newY),
        })
      } else if (currentMode === 'rotate') {
        const { screenCenterX, screenCenterY, lastAngleRad, accumulatedDeg } = dragRef.current
        const curAngleRad = Math.atan2(ev.clientY - screenCenterY, ev.clientX - screenCenterX)
        let stepRad = curAngleRad - lastAngleRad
        while (stepRad > Math.PI) stepRad -= 2 * Math.PI
        while (stepRad < -Math.PI) stepRad += 2 * Math.PI

        const newAccumulatedDeg = accumulatedDeg + (stepRad * 180) / Math.PI
        dragRef.current.accumulatedDeg = newAccumulatedDeg
        dragRef.current.lastAngleRad = curAngleRad

        let deg = Math.round(newAccumulatedDeg)
        // Normalize into standard range (-180, 180]
        deg = ((deg % 360) + 360) % 360
        if (deg > 180) deg -= 360

        // Snap to cardinal angles (0, 90, 180, -90) with a 3-degree threshold
        const snapThreshold = 3
        if (Math.abs(deg) <= snapThreshold) deg = 0
        else if (Math.abs(deg - 90) <= snapThreshold) deg = 90
        else if (Math.abs(deg + 90) <= snapThreshold) deg = -90
        else if (Math.abs(Math.abs(deg) - 180) <= snapThreshold) deg = 180

        onChangeRef.current({ rotation: deg })
      } else if (currentMode === 'nw' || currentMode === 'ne' || currentMode === 'se' || currentMode === 'sw') {
        // CORNER HANDLES: Proportional scale / zoom (Canva behavior)
        // Mouse delta projected along element axes
        const localDx = dx * uXx + dy * uXy
        const localDy = dx * uYx + dy * uYy

        let dirX = 1
        let dirY = 1
        if (currentMode === 'nw') {
          dirX = -1
          dirY = -1
        } else if (currentMode === 'ne') {
          dirX = 1
          dirY = -1
        } else if (currentMode === 'sw') {
          dirX = -1
          dirY = 1
        } else if (currentMode === 'se') {
          dirX = 1
          dirY = 1
        }

        // Smooth continuous diagonal projection (no discontinuous jump between axes)
        const diagLenSq = Math.max(1, origWidthPx * origWidthPx + origHeightPx * origHeightPx)
        const diagProj = (localDx * dirX * origWidthPx + localDy * dirY * origHeightPx) / diagLenSq
        const scale = 1 + diagProj

        // Enforce minimum dimensions (at least 10px width and min height)
        const minScaleW = 10 / Math.max(1, origWidthPx)
        const minScaleH = (element.type === 'shape' ? 4 : 16) / Math.max(1, origHeightPx)
        const minScale = Math.max(minScaleW, minScaleH, 0.02)
        const clampedScale = Math.max(minScale, scale)

        const newWidthPx = origWidthPx * clampedScale
        const newHeightPx = origHeightPx * clampedScale

        // Calculate new center directly from the pinned anchor point!
        let newCenterPxX = anchorPxX
        let newCenterPxY = anchorPxY

        if (currentMode === 'se') {
          newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx + (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy + (newHeightPx / 2) * uYy
        } else if (currentMode === 'sw') {
          newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx + (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy + (newHeightPx / 2) * uYy
        } else if (currentMode === 'ne') {
          newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx - (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy - (newHeightPx / 2) * uYy
        } else if (currentMode === 'nw') {
          newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx - (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy - (newHeightPx / 2) * uYy
        }

        const newX = (newCenterPxX / canvasWidth) * 100
        const newY = (newCenterPxY / canvasHeight) * 100
        const newWidth = (newWidthPx / canvasWidth) * 100
        const newHeight = (newHeightPx / canvasHeight) * 100

        if (element.type === 'text') {
          const newFontSize = Math.max(10, Math.min(180, Math.round(origFontSize * clampedScale)))
          onChangeRef.current({
            fontSize: newFontSize,
            width: roundHigh(newWidth),
            height: roundHigh(newHeight),
            x: roundHigh(newX),
            y: roundHigh(newY),
          })
        } else {
          onChangeRef.current({
            width: roundHigh(newWidth),
            height: roundHigh(newHeight),
            x: roundHigh(newX),
            y: roundHigh(newY),
          })
        }
      } else if (currentMode === 'e' || currentMode === 'w') {
        const localDx = dx * uXx + dy * uXy

        if (element.type === 'text') {
          // SIDE HANDLES (EAST / WEST) FOR TEXT: Width adjustment / wrapping with pinned anchor
          const isEast = currentMode === 'e'
          const newWidthPx = Math.max(40, isEast ? origWidthPx + localDx : origWidthPx - localDx)

          let newCenterPxX = anchorPxX
          let newCenterPxY = anchorPxY

          if (isEast) {
            newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx
            newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy
          } else {
            newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx
            newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy
          }

          const newWidth = (newWidthPx / canvasWidth) * 100
          const newX = (newCenterPxX / canvasWidth) * 100
          const newY = (newCenterPxY / canvasHeight) * 100

          onChangeRef.current({
            width: roundHigh(newWidth),
            x: roundHigh(newX),
            y: roundHigh(newY),
          })
        } else if (element.type === 'shape') {
          // SIDE HANDLES (EAST / WEST) FOR SHAPES: Width adjustment with opposite edge pinned
          const isEast = currentMode === 'e'
          const newWidthPx = Math.max(10, isEast ? origWidthPx + localDx : origWidthPx - localDx)
          const newHeightPx = origHeightPx

          let newCenterPxX = anchorPxX
          let newCenterPxY = anchorPxY

          if (isEast) {
            newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx
            newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy
          } else {
            newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx
            newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy
          }

          const newWidth = (newWidthPx / canvasWidth) * 100
          const newHeight = (newHeightPx / canvasHeight) * 100
          const newX = (newCenterPxX / canvasWidth) * 100
          const newY = (newCenterPxY / canvasHeight) * 100

          onChangeRef.current({
            width: roundHigh(newWidth),
            height: roundHigh(newHeight),
            x: roundHigh(newX),
            y: roundHigh(newY),
          })
        } else {
          // CANVA-LIKE CROP & EXPAND FOR IMAGE: OPPOSITE EDGE STAYS 100% PINNED!
          const curCropX = origCrop?.x || 0
          const curCropY = origCrop?.y || 0
          const curCropW = origCrop?.width || 100
          const curCropH = origCrop?.height || 100

          if (currentMode === 'e') {
            // Dragging right handle: left edge is pinned at anchorPxX, anchorPxY
            const newWidthPx = Math.max(24, origWidthPx + localDx)
            const deltaW = newWidthPx - origWidthPx
            const deltaCropW = (deltaW / origFullWidthPx) * 100
            const newCropW = Math.max(2, Math.min(100 - curCropX, curCropW + deltaCropW))

            const newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx
            const newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy

            const newWidth = (newWidthPx / canvasWidth) * 100
            const newX = (newCenterPxX / canvasWidth) * 100
            const newY = (newCenterPxY / canvasHeight) * 100

            onChangeRef.current({
              width: roundHigh(newWidth),
              x: roundHigh(newX),
              y: roundHigh(newY),
              crop: {
                x: roundHigh(curCropX),
                y: roundHigh(curCropY),
                width: roundHigh(newCropW),
                height: roundHigh(curCropH),
              },
            })
          } else {
            // Dragging left handle (West): right edge is pinned at anchorPxX, anchorPxY
            const newWidthPx = Math.max(24, origWidthPx - localDx)
            const deltaW = newWidthPx - origWidthPx
            const deltaCropW = (deltaW / origFullWidthPx) * 100
            const origRight = curCropX + curCropW
            const newLeft = Math.max(0, Math.min(origRight - 2, curCropX - deltaCropW))
            const newCropW = Math.max(2, origRight - newLeft)

            const newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx
            const newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy

            const newWidth = (newWidthPx / canvasWidth) * 100
            const newX = (newCenterPxX / canvasWidth) * 100
            const newY = (newCenterPxY / canvasHeight) * 100

            onChangeRef.current({
              width: roundHigh(newWidth),
              x: roundHigh(newX),
              y: roundHigh(newY),
              crop: {
                x: roundHigh(newLeft),
                y: roundHigh(curCropY),
                width: roundHigh(newCropW),
                height: roundHigh(curCropH),
              },
            })
          }
        }
      } else if (currentMode === 'n' || currentMode === 's') {
        const localDy = dx * uYx + dy * uYy

        if (element.type === 'shape') {
          // TOP / BOTTOM HANDLES FOR SHAPES: Height adjustment with opposite edge pinned
          const isNorth = currentMode === 'n'
          const newHeightPx = Math.max(4, isNorth ? origHeightPx - localDy : origHeightPx + localDy)
          const newWidthPx = origWidthPx

          let newCenterPxX = anchorPxX
          let newCenterPxY = anchorPxY

          if (isNorth) {
            newCenterPxX = anchorPxX - (newHeightPx / 2) * uYx
            newCenterPxY = anchorPxY - (newHeightPx / 2) * uYy
          } else {
            newCenterPxX = anchorPxX + (newHeightPx / 2) * uYx
            newCenterPxY = anchorPxY + (newHeightPx / 2) * uYy
          }

          const newWidth = (newWidthPx / canvasWidth) * 100
          const newHeight = (newHeightPx / canvasHeight) * 100
          const newX = (newCenterPxX / canvasWidth) * 100
          const newY = (newCenterPxY / canvasHeight) * 100

          onChangeRef.current({
            width: roundHigh(newWidth),
            height: roundHigh(newHeight),
            x: roundHigh(newX),
            y: roundHigh(newY),
          })
        } else {
          // TOP / BOTTOM HANDLES (NORTH / SOUTH) - CANVA-LIKE CROP & EXPAND FOR IMAGES
          const curCropX = origCrop?.x || 0
          const curCropY = origCrop?.y || 0
          const curCropW = origCrop?.width || 100
          const curCropH = origCrop?.height || 100

          if (currentMode === 'n') {
            // Dragging top handle (North): bottom edge is pinned at anchorPxX, anchorPxY
            const newHeightPx = Math.max(16, origHeightPx - localDy)
            const deltaH = newHeightPx - origHeightPx
            const deltaCropH = (deltaH / origFullHeightPx) * 100
            const origBottom = curCropY + curCropH
            const newTop = Math.max(0, Math.min(origBottom - 2, curCropY - deltaCropH))
            const newCropH = Math.max(2, origBottom - newTop)

            const newCenterPxX = anchorPxX - (newHeightPx / 2) * uYx
            const newCenterPxY = anchorPxY - (newHeightPx / 2) * uYy

            const newHeight = (newHeightPx / canvasHeight) * 100
            const newX = (newCenterPxX / canvasWidth) * 100
            const newY = (newCenterPxY / canvasHeight) * 100

            onChangeRef.current({
              height: roundHigh(newHeight),
              x: roundHigh(newX),
              y: roundHigh(newY),
              crop: {
                x: roundHigh(curCropX),
                y: roundHigh(newTop),
                width: roundHigh(curCropW),
                height: roundHigh(newCropH),
              },
            })
          } else {
            // Dragging bottom handle (South): top edge is pinned at anchorPxX, anchorPxY
            const newHeightPx = Math.max(16, origHeightPx + localDy)
            const deltaH = newHeightPx - origHeightPx
            const deltaCropH = (deltaH / origFullHeightPx) * 100
            const newCropH = Math.max(2, Math.min(100 - curCropY, curCropH + deltaCropH))

            const newCenterPxX = anchorPxX + (newHeightPx / 2) * uYx
            const newCenterPxY = anchorPxY + (newHeightPx / 2) * uYy

            const newHeight = (newHeightPx / canvasHeight) * 100
            const newX = (newCenterPxX / canvasWidth) * 100
            const newY = (newCenterPxY / canvasHeight) * 100

            onChangeRef.current({
              height: roundHigh(newHeight),
              x: roundHigh(newX),
              y: roundHigh(newY),
              crop: {
                x: roundHigh(curCropX),
                y: roundHigh(curCropY),
                width: roundHigh(curCropW),
                height: roundHigh(newCropH),
              },
            })
          }
        }
      }
    }

    const onMouseMove = (ev: MouseEvent) => {
      latestEv = ev
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          if (latestEv) {
            processMouseMove(latestEv)
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
        processMouseMove(latestEv)
        latestEv = null
      }
      dragRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (hasMoved) {
        onCommitRef.current?.()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Corner handle helper
  const renderCornerHandle = (mode: DragMode, className: string, cursor: string) => {
    if (element.isLocked) return null
    return (
      <div
        onMouseDown={e => handleMouseDown(e, mode)}
        className={`absolute w-3.5 h-3.5 bg-white border-2 border-sky-500 rounded-full shadow-md z-30 transition-transform hover:scale-125 ${className}`}
        style={{ cursor }}
      />
    )
  }

  return (
    <div
      ref={boxRef}
      className="absolute pointer-events-auto select-none z-40"
      style={{
        left: `${pxCenterX}px`,
        top: `${pxCenterY}px`,
        width: `${pxWidth}px`,
        height: `${pxHeight}px`,
        transform: `translate(-50%, -50%) rotate(${element.rotation || 0}deg)`,
        transformOrigin: 'center center',
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >

      {/* Selection Bounding Border */}
      <div
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => {
          e.stopPropagation()
          onDoubleClick?.()
        }}
        onMouseDown={e => handleMouseDown(e, 'move')}
        className={`w-full h-full border-2 border-sky-400 rounded bg-sky-500/[0.01] transition-colors ${
          element.isLocked
            ? 'border-amber-400/80 cursor-not-allowed'
            : 'hover:border-sky-300 cursor-move'
        }`}
        style={{
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.25)',
        }}
      >
        {/* Real size dimensions badge */}
        <div className="absolute -bottom-6 right-0 px-1.5 py-0.5 bg-zinc-900/90 border border-zinc-700/80 rounded text-[10px] text-zinc-300 font-mono shadow pointer-events-none whitespace-nowrap">
          {Math.round(pxWidth)} × {Math.round(pxHeight)} px
        </div>
        {/* Floating Mini Action Bar (Top Center) */}
        <div
          className="absolute left-1/2 -top-11 -translate-x-1/2 flex items-center gap-1 px-1.5 py-1 bg-zinc-900/95 border border-zinc-700/80 rounded-full shadow-xl z-40 backdrop-blur-sm text-zinc-300"
          style={{
            transform: `translateX(-50%) rotate(${-(element.rotation || 0)}deg)`,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {/* Edit text content button (for text elements) */}
          {isText && !element.isLocked && (
            <button
              onClick={e => {
                e.stopPropagation()
                onDoubleClick?.()
              }}
              title="Edit text (Double-click)"
              className="p-1.5 rounded-full hover:bg-zinc-800 hover:text-sky-400 text-zinc-300 transition-colors"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Lock / Unlock button */}
          <button
            onClick={() => onLockToggle(element.id)}
            title={element.isLocked ? 'Unlock element' : 'Lock element position'}
            className={`p-1.5 rounded-full hover:bg-zinc-800 transition-colors ${
              element.isLocked ? 'text-amber-400' : 'hover:text-white'
            }`}
          >
            {element.isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>

          {/* Duplicate button */}
          {!element.isLocked && (
            <button
              onClick={() => onDuplicate(element.id)}
              title="Duplicate (Ctrl+D)"
              className="p-1.5 rounded-full hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Delete button */}
          {!element.isLocked && (
            <button
              onClick={() => onDelete(element.id)}
              title="Delete (Backspace / Del)"
              className="p-1.5 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* More actions button */}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(prev => !prev)}
              title="More options"
              className="p-1.5 rounded-full hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {/* Dropdown menu */}
            {showMoreMenu && (
              <div className="absolute top-8 right-0 w-44 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 z-50 text-xs text-zinc-200">
                <button
                  onClick={() => {
                    onBringForward(element.id)
                    setShowMoreMenu(false)
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <ArrowUp className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Bring forward</span>
                </button>
                <button
                  onClick={() => {
                    onSendBackward(element.id)
                    setShowMoreMenu(false)
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <ArrowDown className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Send backward</span>
                </button>
                <button
                  onClick={() => {
                    onBringToFront(element.id)
                    setShowMoreMenu(false)
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <ChevronsUp className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Bring to front</span>
                </button>
                <button
                  onClick={() => {
                    onSendToBack(element.id)
                    setShowMoreMenu(false)
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left"
                >
                  <ChevronsDown className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Send to back</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 4 Corner Resize Handles (Scales proportionally) */}
        {renderCornerHandle('nw', '-top-1.5 -left-1.5', 'nwse-resize')}
        {renderCornerHandle('ne', '-top-1.5 -right-1.5', 'nesw-resize')}
        {renderCornerHandle('se', '-bottom-1.5 -right-1.5', 'nwse-resize')}
        {renderCornerHandle('sw', '-bottom-1.5 -left-1.5', 'nesw-resize')}

        {/* Edge Handles (Canva-like Pill Handles) */}
        {!element.isLocked && (
          <>
            {/* Left & Right Pill Handles (Width adjustment / text wrap) */}
            <div
              onMouseDown={e => handleMouseDown(e, 'w')}
              className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2 h-5 bg-white border-2 border-sky-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
              title="Resize width"
            />
            <div
              onMouseDown={e => handleMouseDown(e, 'e')}
              className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2 h-5 bg-white border-2 border-sky-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
              title="Resize width"
            />

            {/* Top & Bottom Pill Handles (Only for image elements: vertical crop/resize) */}
            {!isText && (
              <>
                <div
                  onMouseDown={e => handleMouseDown(e, 'n')}
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-2 bg-white border-2 border-sky-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
                  title={element.type === 'shape' ? 'Resize height' : 'Crop height'}
                />
                <div
                  onMouseDown={e => handleMouseDown(e, 's')}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-2 bg-white border-2 border-sky-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
                  title={element.type === 'shape' ? 'Resize height' : 'Crop height'}
                />
              </>
            )}
          </>
        )}

        {/* Rotation Control Handle (Bottom Center) */}
        {!element.isLocked && (
          <div
            className="absolute left-1/2 -bottom-10 -translate-x-1/2 flex items-center justify-center z-30"
            style={{
              transform: `translateX(-50%) rotate(${-(element.rotation || 0)}deg)`,
            }}
          >
            {/* Rotate handle button */}
            <div
              onMouseDown={e => handleMouseDown(e, 'rotate')}
              title={`Rotate (${element.rotation || 0}°)`}
              className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 hover:border-sky-400 text-zinc-300 hover:text-white flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg transition-transform hover:scale-110"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
