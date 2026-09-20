import React, { useRef, useEffect, useState, useCallback } from 'react'
import type { TimelineClip, BrushStroke } from '@core/project-model'
import { useEditorStore, useEditorActions } from '../editor-store'
import { selectCustomMatteBrushMode, selectCustomMatteBrushSize } from '@core/editor-selectors'
import { matteTimeForSourceTime } from '@core/auto-matte'

export interface BrushOverlayProps {
  selectedClip: TimelineClip | null
  videoFrameSize: { width: number; height: number }
  sourceElement?: HTMLVideoElement | HTMLImageElement | null
}

export const BrushOverlay: React.FC<BrushOverlayProps> = ({
  selectedClip,
  videoFrameSize,
  sourceElement,
}) => {
  const brushMode = useEditorStore(selectCustomMatteBrushMode)
  const brushSize = useEditorStore(selectCustomMatteBrushSize)
  const { addCustomMatteStroke, setCustomMatteBrushMode } = useEditorActions()

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)
  const currentStrokePointsRef = useRef<Array<[number, number]>>([])
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  /** Where the playhead sits inside this clip, in seconds. */
  const clipLocalTime = () => {
    const video = sourceElement as HTMLVideoElement | null | undefined
    if (!video || typeof video.currentTime !== 'number' || !selectedClip) return 0
    return matteTimeForSourceTime(video.currentTime, selectedClip.trimStart ?? 0, selectedClip.speed ?? 1)
  }

  const isVisualClip = Boolean(
    selectedClip && (selectedClip.type === 'video' || selectedClip.type === 'image'),
  )

  const isActive = Boolean(brushMode && isVisualClip && videoFrameSize.width > 0 && videoFrameSize.height > 0)

  // Calculate brush radius in pixels on the overlay canvas
  const shortEdge = Math.min(videoFrameSize.width, videoFrameSize.height)
  const brushRadiusPx = Math.max(1, (brushSize / 100) * shortEdge * 0.5)

  // Clear or redraw temporary strokes and brush cursor
  const renderOverlay = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 1. Draw in-progress stroke if drawing
    const points = currentStrokePointsRef.current
    if (points.length > 1 && brushMode) {
      ctx.save()
      const isAdditive = brushMode === 'brush' || brushMode === 'region-brush'
      ctx.strokeStyle = isAdditive ? 'rgba(52, 211, 153, 0.75)' : 'rgba(248, 113, 113, 0.75)'
      ctx.lineWidth = brushRadiusPx * 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      const p0 = points[0]
      ctx.moveTo(p0[0] * canvas.width, p0[1] * canvas.height)
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        ctx.lineTo(p[0] * canvas.width, p[1] * canvas.height)
      }
      ctx.stroke()
      ctx.restore()
    }

    // 2. Draw circular brush cursor indicator
    if (cursorPos) {
      ctx.save()
      const isAdditive = brushMode === 'brush' || brushMode === 'region-brush'
      const strokeColor = isAdditive ? '#34d399' : '#f87171'
      const fillColor = isAdditive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)'

      ctx.beginPath()
      ctx.arc(cursorPos.x, cursorPos.y, brushRadiusPx, 0, Math.PI * 2)
      ctx.fillStyle = fillColor
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = strokeColor
      ctx.setLineDash([4, 3])
      ctx.stroke()

      // Center dot
      ctx.beginPath()
      ctx.arc(cursorPos.x, cursorPos.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = strokeColor
      ctx.fill()
      ctx.restore()
    }
  }, [brushMode, brushRadiusPx, cursorPos])

  useEffect(() => {
    renderOverlay()
  }, [renderOverlay])

  // Key listener for Escape to exit brush mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && brushMode) {
        setCustomMatteBrushMode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [brushMode, setCustomMatteBrushMode])

  if (!isActive || !selectedClip) {
    return null
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const normX = Math.max(0, Math.min(1, x / canvas.width))
    const normY = Math.max(0, Math.min(1, y / canvas.height))

    isDrawingRef.current = true
    currentStrokePointsRef.current = [[normX, normY]]
    setCursorPos({ x, y })

    // Capture pointer
    canvas.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setCursorPos({ x, y })

    if (isDrawingRef.current && brushMode) {
      const normX = Math.max(0, Math.min(1, x / canvas.width))
      const normY = Math.max(0, Math.min(1, y / canvas.height))
      currentStrokePointsRef.current.push([normX, normY])
      renderOverlay()
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    const canvas = canvasRef.current
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }

    const points = currentStrokePointsRef.current
    if (points.length > 0 && brushMode && selectedClip) {
      const stroke: BrushStroke = {
        mode: brushMode,
        size: brushSize,
        points: points.map(([px, py]) => [Math.round(px * 10000) / 10000, Math.round(py * 10000) / 10000]),
        // Time INSIDE the clip, in seconds — the frame whose colours the region criterion
        // is taken from. Not a wall-clock timestamp: `Date.now()` here pointed the
        // criterion at a frame billions of seconds into a clip that is seconds long, and
        // made two identical strokes hash differently, which forced a rebuild of work that
        // had not changed.
        paintedAt: clipLocalTime(),
      }
      addCustomMatteStroke(selectedClip.id, stroke)
    }

    currentStrokePointsRef.current = []
    renderOverlay()
  }

  const handlePointerLeave = () => {
    setCursorPos(null)
  }

  return (
    <div
      className="absolute inset-0 z-[25] pointer-events-auto"
      style={{
        width: videoFrameSize.width,
        height: videoFrameSize.height,
        cursor: 'none', // Custom brush cursor drawn on canvas
      }}
    >
      <canvas
        ref={canvasRef}
        width={videoFrameSize.width}
        height={videoFrameSize.height}
        className="w-full h-full block touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />
    </div>
  )
}
