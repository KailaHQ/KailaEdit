import React, { useState, useRef, useCallback } from 'react'
import type { TimelineClip } from '../../../types/project-model'
import type { ToolType } from '../video-editor-utils'
import { useEditorActions } from '../editor-store'

export interface TimelineAudioEnvelopeProps {
  clip: TimelineClip
  pixelsPerSecond: number
  trackHeight: number
  drawnDuration: number
  drawnStart?: number
  activeTool: ToolType
}

interface DraggingPoint {
  originalT: number
  currentT: number
  currentV: number
}

export const volumeToY = (vol: number, height: number): number => {
  const clampedVol = Math.max(0, Math.min(2.0, vol))
  const usableH = Math.max(10, height - 12)
  // vol = 0 => height - 6 (bottom), vol = 2.0 => 6 (top), vol = 1.0 => height / 2 (center)
  return (height - 6) - (clampedVol / 2.0) * usableH
}

export const yToVolume = (y: number, height: number): number => {
  const usableH = Math.max(10, height - 12)
  const normalized = ((height - 6) - y) / usableH
  return Math.max(0, Math.min(2.0, normalized * 2.0))
}

export const TimelineAudioEnvelope: React.FC<TimelineAudioEnvelopeProps> = ({
  clip,
  pixelsPerSecond,
  trackHeight,
  drawnDuration,
  drawnStart,
  activeTool,
}) => {
  const { setKeyframe, moveKeyframe, removeKeyframeAt } = useEditorActions()
  const [draggingPoint, setDraggingPoint] = useState<DraggingPoint | null>(null)
  const [hoveredPointT, setHoveredPointT] = useState<number | null>(null)
  const containerRef = useRef<SVGSVGElement | null>(null)

  const offsetFromClipStart = (drawnStart ?? clip.startTime) - clip.startTime
  const volumeTrack = clip.keyframes?.find(k => k.property === 'volume')
  const rawPoints = volumeTrack ? [...volumeTrack.points].sort((a, b) => a.t - b.t) : []
  const baseVolume = clip.volume ?? 1

  // Merge dragging point into display points
  const displayPoints = rawPoints.map(p => {
    if (draggingPoint && Math.abs(p.t - draggingPoint.originalT) <= 0.05) {
      return { ...p, t: draggingPoint.currentT, value: draggingPoint.currentV }
    }
    return p
  }).sort((a, b) => a.t - b.t)

  const clipWidthPx = Math.max(drawnDuration * pixelsPerSecond, 4)
  const unityY = volumeToY(1.0, trackHeight)

  // Build SVG path segments
  const pathD = React.useMemo(() => {
    if (displayPoints.length === 0) {
      const y = volumeToY(baseVolume, trackHeight)
      return `M 0 ${y} L ${clipWidthPx} ${y}`
    }

    const segments: string[] = []
    const first = displayPoints[0]
    const firstY = volumeToY(first.value, trackHeight)
    segments.push(`M 0 ${firstY}`)

    for (const pt of displayPoints) {
      const x = Math.max(0, Math.min(clipWidthPx, (pt.t - offsetFromClipStart) * pixelsPerSecond))
      const y = volumeToY(pt.value, trackHeight)
      segments.push(`L ${x} ${y}`)
    }

    const last = displayPoints[displayPoints.length - 1]
    const lastY = volumeToY(last.value, trackHeight)
    segments.push(`L ${clipWidthPx} ${lastY}`)

    return segments.join(' ')
  }, [displayPoints, baseVolume, trackHeight, clipWidthPx, pixelsPerSecond, offsetFromClipStart])

  // Area fill path underneath line
  const areaD = React.useMemo(() => {
    if (!pathD) return ''
    return `${pathD} L ${clipWidthPx} ${trackHeight} L 0 ${trackHeight} Z`
  }, [pathD, clipWidthPx, trackHeight])

  // Double-click on envelope path to add a keyframe
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'blade' || activeTool === 'trackForward') return
    e.stopPropagation()
    e.preventDefault()

    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    const newT = Math.max(0, Math.min(clip.duration, clickX / pixelsPerSecond + offsetFromClipStart))
    const newV = yToVolume(clickY, trackHeight)

    setKeyframe(clip.id, 'volume', Number(newT.toFixed(2)), Number(newV.toFixed(2)))
  }, [activeTool, clip.duration, clip.id, pixelsPerSecond, setKeyframe, trackHeight, offsetFromClipStart])

  // Drag a keyframe node
  const handleNodePointerDown = useCallback((e: React.PointerEvent, pt: { t: number; value: number }) => {
    if (e.button !== 0) return // Left click only
    if (activeTool === 'blade' || activeTool === 'trackForward') return
    e.stopPropagation()
    e.preventDefault()

    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    const startX = e.clientX
    const startY = e.clientY
    const initialT = pt.t
    const initialV = pt.value

    setDraggingPoint({ originalT: initialT, currentT: initialT, currentV: initialV })

    const handlePointerMove = (moveEv: PointerEvent) => {
      const deltaX = moveEv.clientX - startX
      const deltaY = moveEv.clientY - startY

      const rawT = initialT + deltaX / pixelsPerSecond
      const clampedT = Math.max(0, Math.min(clip.duration, rawT))

      const initialY = volumeToY(initialV, trackHeight)
      const currentY = initialY + deltaY
      const clampedV = yToVolume(currentY, trackHeight)

      setDraggingPoint({
        originalT: initialT,
        currentT: clampedT,
        currentV: clampedV,
      })
    }

    const handlePointerUp = (upEv: PointerEvent) => {
      try {
        target.releasePointerCapture(upEv.pointerId)
      } catch {}
      target.removeEventListener('pointermove', handlePointerMove)
      target.removeEventListener('pointerup', handlePointerUp)
      target.removeEventListener('pointercancel', handlePointerUp)

      setDraggingPoint(latest => {
        if (latest) {
          moveKeyframe(
            clip.id,
            'volume',
            latest.originalT,
            Number(latest.currentT.toFixed(2)),
            0.05,
            Number(latest.currentV.toFixed(2)),
          )
        }
        return null
      })
    }

    target.addEventListener('pointermove', handlePointerMove)
    target.addEventListener('pointerup', handlePointerUp)
    target.addEventListener('pointercancel', handlePointerUp)
  }, [activeTool, clip.duration, clip.id, moveKeyframe, pixelsPerSecond, trackHeight])

  // Right-click to remove node
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, t: number) => {
    e.preventDefault()
    e.stopPropagation()
    removeKeyframeAt(clip.id, 'volume', t)
  }, [clip.id, removeKeyframeAt])

  const isInteractive = activeTool !== 'blade' && activeTool !== 'trackForward'

  return (
    <svg
      ref={containerRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-15 overflow-visible"
      style={{ width: `${clipWidthPx}px`, height: `${trackHeight}px` }}
    >
      {/* Unity (0 dB) reference line */}
      <line
        x1={0}
        y1={unityY}
        x2={clipWidthPx}
        y2={unityY}
        stroke="rgba(255, 255, 255, 0.2)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />

      {/* Shaded volume area under envelope */}
      <path
        d={areaD}
        fill="rgba(56, 189, 248, 0.08)"
        pointerEvents="none"
      />

      {/* Wide invisible hit area for double-clicking anywhere along the volume curve */}
      {isInteractive && (
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          className="cursor-crosshair pointer-events-stroke"
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}

      {/* Visible envelope gain line */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(56, 189, 248, 0.85)"
        strokeWidth={1.5}
        pointerEvents="none"
      />

      {/* Keyframe control nodes */}
      {displayPoints.map((pt, idx) => {
        const cx = Math.max(0, Math.min(clipWidthPx, (pt.t - offsetFromClipStart) * pixelsPerSecond))
        const cy = volumeToY(pt.value, trackHeight)
        const isDragged = draggingPoint && Math.abs(pt.t - draggingPoint.currentT) <= 0.05
        const isHovered = hoveredPointT !== null && Math.abs(pt.t - hoveredPointT) <= 0.05
        const decibels = pt.value > 0.001 ? 20 * Math.log10(pt.value) : null

        return (
          <g key={`vol-pt-${idx}-${pt.t.toFixed(2)}`}>
            {/* Outer hit area */}
            <circle
              cx={cx}
              cy={cy}
              r={isInteractive ? 8 : 4}
              fill="transparent"
              className={isInteractive ? 'cursor-grab active:cursor-grabbing pointer-events-auto' : 'pointer-events-none'}
              onPointerDown={(e) => isInteractive && handleNodePointerDown(e, pt)}
              onContextMenu={(e) => isInteractive && handleNodeContextMenu(e, pt.t)}
              onMouseEnter={() => setHoveredPointT(pt.t)}
              onMouseLeave={() => setHoveredPointT(null)}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />

            {/* Visual node circle */}
            <circle
              cx={cx}
              cy={cy}
              r={isDragged ? 5.5 : isHovered ? 5 : 4}
              fill={isDragged ? '#38bdf8' : '#ffffff'}
              stroke="#0f172a"
              strokeWidth={1.5}
              className="pointer-events-none transition-transform"
            />

            {/* Tooltip while dragging or hovering */}
            {(isDragged || isHovered) && (
              <g className="pointer-events-none">
                <rect
                  x={Math.max(4, Math.min(clipWidthPx - 94, cx - 45))}
                  y={Math.max(2, cy - 24)}
                  width={90}
                  height={18}
                  rx={3}
                  fill="#09090b"
                  stroke="#27272a"
                  strokeWidth={1}
                />
                <text
                  x={Math.max(4, Math.min(clipWidthPx - 94, cx - 45)) + 45}
                  y={Math.max(2, cy - 24) + 12}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9"
                  fontFamily="sans-serif"
                >
                  {decibels === null ? '-∞ dB' : `${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`} ({Math.round(pt.value * 100)}%)
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
