import React from 'react'

export interface UseMonitorZoomPanOptions {
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function useMonitorZoomPan({ containerRef }: UseMonitorZoomPanOptions) {
  const [previewZoom, setPreviewZoom] = React.useState<number | 'fit'>('fit')
  const [previewZoomOpen, setPreviewZoomOpen] = React.useState(false)
  const [previewPan, setPreviewPan] = React.useState({ x: 0, y: 0 })
  const previewPanRef = React.useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  })

  // Close zoom dropdown on outside click
  React.useEffect(() => {
    if (!previewZoomOpen) return
    const handler = () => setPreviewZoomOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [previewZoomOpen])

  // Reset pan when returning to fit
  React.useEffect(() => {
    if (previewZoom === 'fit') {
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [previewZoom])

  // Ctrl / Meta + Wheel to zoom
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setPreviewZoom(prev => {
        const current = prev === 'fit' ? 100 : prev
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        return Math.round(Math.min(1600, Math.max(10, current * delta)))
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [containerRef])

  const handlePanMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (previewZoom === 'fit') return
    if (e.button !== 0 && e.button !== 1) return
    previewPanRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: previewPan.x,
      startPanY: previewPan.y,
    }
  }, [previewZoom, previewPan.x, previewPan.y])

  const handlePanMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!previewPanRef.current.dragging) return
    setPreviewPan({
      x: previewPanRef.current.startPanX + (e.clientX - previewPanRef.current.startX),
      y: previewPanRef.current.startPanY + (e.clientY - previewPanRef.current.startY),
    })
  }, [])

  const handlePanMouseUp = React.useCallback(() => {
    previewPanRef.current.dragging = false
  }, [])

  const handlePanMouseLeave = React.useCallback(() => {
    previewPanRef.current.dragging = false
  }, [])

  return {
    previewZoom,
    setPreviewZoom,
    previewZoomOpen,
    setPreviewZoomOpen,
    previewPan,
    setPreviewPan,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handlePanMouseLeave,
  }
}
