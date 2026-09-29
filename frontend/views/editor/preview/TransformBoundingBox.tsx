import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { fitMediaInFrame } from '@core/video-editor-utils'
import { RotateCw, Crop, Check } from 'lucide-react'
import type { Asset, TimelineClip, ClipTransform } from '../../../types/project-model'
import { DEFAULT_CLIP_TRANSFORM } from '../../../types/project-model'

export interface TransformBoundingBoxProps {
  selectedClip: TimelineClip | null
  assets: Asset[]
  videoFrameSize: { width: number; height: number }
  currentTime: number
  cropMode: boolean
  onToggleCropMode: () => void
  onUpdateTransform: (patch: Partial<ClipTransform>, options?: { recordKeyframeAt?: number }) => void
  /**
   * The transform while a drag is in flight, every pointer move; null when it ends.
   * The box redraws from its own state, but the picture is drawn elsewhere, so without
   * this it stayed put until the drag was committed on release.
   */
  onPreviewTransform?: (transform: ClipTransform | null) => void
  /**
   * The press on the box is over. `moved` says whether it was a drag — only then should
   * the click that follows leave the selection alone. A press that never moved was a
   * click, and the click has to be free to pick whatever is on top at that point.
   */
  onInteractionEnd?: (moved: boolean) => void
  /**
   * Raised as soon as a handle is grabbed, before anything moves.
   *
   * The preview clears or re-picks the selection when the frame is clicked,
   * and the click that ends a drag lands there too. Without this the editor
   * hit-tested the clip's OLD rectangle, missed it, and selected whatever
   * sat underneath — dropping a sticker handed focus back to the video on
   * track 1 every single time.
   */
  onInteractionStart?: () => void
}

type DragMode =
  | 'move'
  | 'rotate'
  | 'scale-nw'
  | 'scale-ne'
  | 'scale-se'
  | 'scale-sw'
  | 'scale-n'
  | 'scale-s'
  | 'scale-e'
  | 'scale-w'
  | 'crop-t'
  | 'crop-b'
  | 'crop-l'
  | 'crop-r'
  | 'crop-tl'
  | 'crop-tr'
  | 'crop-bl'
  | 'crop-br'

export const TransformBoundingBox: React.FC<TransformBoundingBoxProps> = ({
  selectedClip,
  assets,
  videoFrameSize,
  currentTime,
  cropMode,
  onToggleCropMode,
  onUpdateTransform,
  onPreviewTransform,
  onInteractionStart,
  onInteractionEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Local drag state for high-frequency 60fps manipulation
  const [activeDrag, setActiveDrag] = useState<DragMode | null>(null)
  const [localTransform, setLocalTransform] = useState<ClipTransform | null>(null)
  const [snapLines, setSnapLines] = useState<{ x?: number; y?: number }>({})

  // Resolve media asset dimensions to compute fitted box
  const liveAsset = useMemo(() => {
    if (!selectedClip || selectedClip.type === 'audio' || selectedClip.type === 'adjustment') return null
    if (selectedClip.assetId) {
      return assets.find(a => a.id === selectedClip.assetId) || selectedClip.asset
    }
    return selectedClip.asset
  }, [selectedClip, assets])

  // Is the selected clip currently in the frame at currentTime?
  const isClipActive = useMemo(() => {
    if (!selectedClip) return false
    return currentTime >= selectedClip.startTime - 0.05 && currentTime <= selectedClip.startTime + selectedClip.duration + 0.05
  }, [selectedClip, currentTime])

  const clipTf = selectedClip?.transform ?? DEFAULT_CLIP_TRANSFORM
  const currentTf = localTransform ?? clipTf

  // Sync local transform when selectedClip changes
  useEffect(() => {
    setLocalTransform(null)
    setSnapLines({})
  }, [selectedClip?.id])

  // Fitted dimensions inside the video frame container. Shared with the click
  // hit test in ProgramMonitor, so the box the user sees and the area that
  // responds to a click cannot drift apart.
  const fitted = useMemo(() => {
    const size = fitMediaInFrame(videoFrameSize, liveAsset)
    return { width: Math.round(size.width), height: Math.round(size.height) }
  }, [videoFrameSize, liveAsset])

  // Start drag interaction
  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (!selectedClip || !containerRef.current) return
    e.stopPropagation()
    onInteractionStart?.()
    e.preventDefault()

    const isShape = Boolean(selectedClip?.stickerId?.startsWith('shape-'))
    const startX = e.clientX
    const startY = e.clientY
    const startTf = { ...(localTransform ?? clipTf) }
    const fw = videoFrameSize.width || 1
    const fh = videoFrameSize.height || 1

    const containerRect = containerRef.current.getBoundingClientRect()
    // Center of the clip in client/screen coordinates
    const centerX = containerRect.left + ((50 + startTf.positionX) / 100) * fw
    const centerY = containerRect.top + ((50 + startTf.positionY) / 100) * fh

    const initialDistance = Math.hypot(startX - centerX, startY - centerY) || 1

    // For shape transforms (proportional corner scale, independent width/height side resize with pinned anchor)
    const startScaleX = startTf.scaleX ?? startTf.scale ?? 100
    const startScaleY = startTf.scaleY ?? startTf.scale ?? 100
    const origWidthPx = Math.max(10, fitted.width * (startScaleX / 100))
    const origHeightPx = Math.max(4, fitted.height * (startScaleY / 100))

    const rotRad = ((startTf.rotation || 0) * Math.PI) / 180
    const cosRot = Math.cos(rotRad)
    const sinRot = Math.sin(rotRad)
    const uXx = cosRot
    const uXy = sinRot
    const uYx = -sinRot
    const uYy = cosRot

    let anchorPxX = centerX
    let anchorPxY = centerY

    if (mode === 'scale-e') {
      anchorPxX = centerX - (origWidthPx / 2) * uXx
      anchorPxY = centerY - (origWidthPx / 2) * uXy
    } else if (mode === 'scale-w') {
      anchorPxX = centerX + (origWidthPx / 2) * uXx
      anchorPxY = centerY + (origWidthPx / 2) * uXy
    } else if (mode === 'scale-s') {
      anchorPxX = centerX - (origHeightPx / 2) * uYx
      anchorPxY = centerY - (origHeightPx / 2) * uYy
    } else if (mode === 'scale-n') {
      anchorPxX = centerX + (origHeightPx / 2) * uYx
      anchorPxY = centerY + (origHeightPx / 2) * uYy
    } else if (mode === 'scale-se') {
      anchorPxX = centerX - (origWidthPx / 2) * uXx - (origHeightPx / 2) * uYx
      anchorPxY = centerY - (origWidthPx / 2) * uXy - (origHeightPx / 2) * uYy
    } else if (mode === 'scale-sw') {
      anchorPxX = centerX + (origWidthPx / 2) * uXx - (origHeightPx / 2) * uYx
      anchorPxY = centerY - (origWidthPx / 2) * uXy - (origHeightPx / 2) * uYy
    } else if (mode === 'scale-ne') {
      anchorPxX = centerX - (origWidthPx / 2) * uXx + (origHeightPx / 2) * uYx
      anchorPxY = centerY - (origWidthPx / 2) * uXy + (origHeightPx / 2) * uYy
    } else if (mode === 'scale-nw') {
      anchorPxX = centerX + (origWidthPx / 2) * uXx + (origHeightPx / 2) * uYx
      anchorPxY = centerY + (origWidthPx / 2) * uXy + (origHeightPx / 2) * uYy
    }

    let accumulatedDeg = startTf.rotation || 0
    let lastAngleRad = Math.atan2(startY - centerY, startX - centerX)

    setActiveDrag(mode)

    // The drag's own running transform. Kept here rather than read back from React
    // state, so the preview and the final commit never depend on a render having run.
    let current: ClipTransform = startTf
    let moved = false
    const apply = (patch: Partial<ClipTransform>) => {
      current = { ...current, ...patch }
      moved = true
      setLocalTransform(current)
      onPreviewTransform?.(current)
    }

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault()
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const newSnap: { x?: number; y?: number } = {}

      if (mode === 'move') {
        const dXPercent = (dx / fw) * 100
        const dYPercent = (dy / fh) * 100

        let newX = startTf.positionX + dXPercent
        let newY = startTf.positionY + dYPercent

        // Snapping: center horizontal (X = 0) and center vertical (Y = 0)
        const snapThresholdX = (8 / fw) * 100
        const snapThresholdY = (8 / fh) * 100

        if (Math.abs(newX) < snapThresholdX) {
          newX = 0
          newSnap.x = 50
        }
        if (Math.abs(newY) < snapThresholdY) {
          newY = 0
          newSnap.y = 50
        }

        // Edge snapping (edges at -50% and +50% of frame center)
        const curScaleX = startTf.scaleX ?? startTf.scale
        const curScaleY = startTf.scaleY ?? startTf.scale
        const halfWidthPercent = ((fitted.width * (curScaleX / 100)) / (2 * fw)) * 100
        const halfHeightPercent = ((fitted.height * (curScaleY / 100)) / (2 * fh)) * 100

        // Left edge aligns with left frame boundary
        if (Math.abs(newX - halfWidthPercent + 50) < snapThresholdX) {
          newX = -50 + halfWidthPercent
          newSnap.x = 0
        }
        // Right edge aligns with right frame boundary
        if (Math.abs(newX + halfWidthPercent - 50) < snapThresholdX) {
          newX = 50 - halfWidthPercent
          newSnap.x = 100
        }
        // Top edge aligns with top frame boundary
        if (Math.abs(newY - halfHeightPercent + 50) < snapThresholdY) {
          newY = -50 + halfHeightPercent
          newSnap.y = 0
        }
        // Bottom edge aligns with bottom frame boundary
        if (Math.abs(newY + halfHeightPercent - 50) < snapThresholdY) {
          newY = 50 - halfHeightPercent
          newSnap.y = 100
        }

        setSnapLines(newSnap)
        apply({
          positionX: Math.round(newX * 10) / 10,
          positionY: Math.round(newY * 10) / 10,
        })
      } else if (mode === 'rotate') {
        const curAngleRad = Math.atan2(ev.clientY - centerY, ev.clientX - centerX)
        let stepRad = curAngleRad - lastAngleRad
        while (stepRad > Math.PI) stepRad -= 2 * Math.PI
        while (stepRad < -Math.PI) stepRad += 2 * Math.PI

        accumulatedDeg += (stepRad * 180) / Math.PI
        lastAngleRad = curAngleRad

        let deg = Math.round(accumulatedDeg)
        deg = ((deg % 360) + 360) % 360
        if (deg > 180) deg -= 360

        if (ev.shiftKey) {
          deg = Math.round(deg / 15) * 15
        } else {
          // Snap to cardinal angles (0, 90, 180, -90) with a 3-degree threshold
          const snapThreshold = 3
          if (Math.abs(deg) <= snapThreshold) deg = 0
          else if (Math.abs(deg - 90) <= snapThreshold) deg = 90
          else if (Math.abs(deg + 90) <= snapThreshold) deg = -90
          else if (Math.abs(Math.abs(deg) - 180) <= snapThreshold) deg = 180
        }

        apply({
          rotation: deg,
        })
      } else if (isShape && (mode === 'scale-e' || mode === 'scale-w')) {
        const localDx = dx * uXx + dy * uXy
        const isEast = mode === 'scale-e'
        const newWidthPx = Math.max(10, isEast ? origWidthPx + localDx : origWidthPx - localDx)

        let newCenterPxX = anchorPxX
        let newCenterPxY = anchorPxY

        if (isEast) {
          newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx
          newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy
        } else {
          newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx
          newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy
        }

        const newX = ((newCenterPxX - containerRect.left) / fw) * 100 - 50
        const newY = ((newCenterPxY - containerRect.top) / fh) * 100 - 50

        const newScaleX = (newWidthPx / fitted.width) * 100
        const newScaleY = startScaleY

        apply({
          positionX: Math.round(newX * 10) / 10,
          positionY: Math.round(newY * 10) / 10,
          scaleX: Math.round(newScaleX * 10) / 10,
          scaleY: Math.round(newScaleY * 10) / 10,
          scale: Math.round(newScaleX),
        })
      } else if (isShape && (mode === 'scale-n' || mode === 'scale-s')) {
        const localDy = dx * uYx + dy * uYy
        const isNorth = mode === 'scale-n'
        const newHeightPx = Math.max(4, isNorth ? origHeightPx - localDy : origHeightPx + localDy)

        let newCenterPxX = anchorPxX
        let newCenterPxY = anchorPxY

        if (isNorth) {
          newCenterPxX = anchorPxX - (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY - (newHeightPx / 2) * uYy
        } else {
          newCenterPxX = anchorPxX + (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY + (newHeightPx / 2) * uYy
        }

        const newX = ((newCenterPxX - containerRect.left) / fw) * 100 - 50
        const newY = ((newCenterPxY - containerRect.top) / fh) * 100 - 50

        const newScaleX = startScaleX
        const newScaleY = (newHeightPx / fitted.height) * 100

        apply({
          positionX: Math.round(newX * 10) / 10,
          positionY: Math.round(newY * 10) / 10,
          scaleX: Math.round(newScaleX * 10) / 10,
          scaleY: Math.round(newScaleY * 10) / 10,
          scale: Math.round(newScaleY),
        })
      } else if (isShape && (mode === 'scale-nw' || mode === 'scale-ne' || mode === 'scale-se' || mode === 'scale-sw')) {
        const localDx = dx * uXx + dy * uXy
        const localDy = dx * uYx + dy * uYy

        let dirX = 1
        let dirY = 1
        if (mode === 'scale-nw') {
          dirX = -1
          dirY = -1
        } else if (mode === 'scale-ne') {
          dirX = 1
          dirY = -1
        } else if (mode === 'scale-sw') {
          dirX = -1
          dirY = 1
        } else if (mode === 'scale-se') {
          dirX = 1
          dirY = 1
        }

        const diagLenSq = Math.max(1, origWidthPx * origWidthPx + origHeightPx * origHeightPx)
        const diagProj = (localDx * dirX * origWidthPx + localDy * dirY * origHeightPx) / diagLenSq
        const cornerScale = 1 + diagProj

        const minScaleW = 10 / Math.max(1, origWidthPx)
        const minScaleH = 4 / Math.max(1, origHeightPx)
        const minScale = Math.max(minScaleW, minScaleH, 0.02)
        const clampedScale = Math.max(minScale, cornerScale)

        const newWidthPx = origWidthPx * clampedScale
        const newHeightPx = origHeightPx * clampedScale

        let newCenterPxX = anchorPxX
        let newCenterPxY = anchorPxY

        if (mode === 'scale-se') {
          newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx + (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy + (newHeightPx / 2) * uYy
        } else if (mode === 'scale-sw') {
          newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx + (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy + (newHeightPx / 2) * uYy
        } else if (mode === 'scale-ne') {
          newCenterPxX = anchorPxX + (newWidthPx / 2) * uXx - (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY + (newWidthPx / 2) * uXy - (newHeightPx / 2) * uYy
        } else if (mode === 'scale-nw') {
          newCenterPxX = anchorPxX - (newWidthPx / 2) * uXx - (newHeightPx / 2) * uYx
          newCenterPxY = anchorPxY - (newWidthPx / 2) * uXy - (newHeightPx / 2) * uYy
        }

        const newX = ((newCenterPxX - containerRect.left) / fw) * 100 - 50
        const newY = ((newCenterPxY - containerRect.top) / fh) * 100 - 50

        const newScaleX = startScaleX * clampedScale
        const newScaleY = startScaleY * clampedScale

        apply({
          positionX: Math.round(newX * 10) / 10,
          positionY: Math.round(newY * 10) / 10,
          scaleX: Math.round(newScaleX * 10) / 10,
          scaleY: Math.round(newScaleY * 10) / 10,
          scale: Math.round(newScaleX),
        })
      } else if (mode.startsWith('scale-')) {
        const curDist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY)
        const ratio = curDist / initialDistance
        let newScale = Math.round(startTf.scale * ratio)
        newScale = Math.max(5, Math.min(500, newScale))

        apply({
          scale: newScale,
        })
      } else if (mode.startsWith('crop-')) {
        // Crop mode adjustments (percentages 0..90)
        const baseW = fitted.width * (startTf.scale / 100)
        const baseH = fitted.height * (startTf.scale / 100)

        let cropTop = startTf.cropTop
        let cropBottom = startTf.cropBottom
        let cropLeft = startTf.cropLeft
        let cropRight = startTf.cropRight

        if (mode.includes('t')) {
          cropTop = Math.max(0, Math.min(90 - cropBottom, Math.round(startTf.cropTop + (dy / baseH) * 100)))
        }
        if (mode.includes('b')) {
          cropBottom = Math.max(0, Math.min(90 - cropTop, Math.round(startTf.cropBottom - (dy / baseH) * 100)))
        }
        if (mode.includes('l')) {
          cropLeft = Math.max(0, Math.min(90 - cropRight, Math.round(startTf.cropLeft + (dx / baseW) * 100)))
        }
        if (mode.includes('r')) {
          cropRight = Math.max(0, Math.min(90 - cropLeft, Math.round(startTf.cropRight - (dx / baseW) * 100)))
        }

        apply({
          cropTop,
          cropBottom,
          cropLeft,
          cropRight,
        })
      }
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setActiveDrag(null)
      setSnapLines({})

      if (moved) {
        const timeInClip = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.startTime))
        onUpdateTransform(current, { recordKeyframeAt: timeInClip })
      }
      setLocalTransform(null)
      onPreviewTransform?.(null)
      onInteractionEnd?.(moved)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [selectedClip, localTransform, clipTf, videoFrameSize, fitted, currentTime, onUpdateTransform, onPreviewTransform, onInteractionStart, onInteractionEnd])

  if (!selectedClip || !isClipActive || selectedClip.type === 'audio' || selectedClip.type === 'adjustment' || selectedClip.type === 'text') {
    return null
  }

  const isShape = Boolean(selectedClip?.stickerId?.startsWith('shape-'))
  const { positionX, positionY, scale, rotation, cropTop, cropRight, cropBottom, cropLeft } = currentTf
  const curScaleX = currentTf.scaleX ?? scale
  const curScaleY = currentTf.scaleY ?? scale
  const boxWidth = fitted.width * (curScaleX / 100)
  const boxHeight = fitted.height * (curScaleY / 100)

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-[25]"
    >
      {/* Visual Snap Guide Lines */}
      {snapLines.x !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-px bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)] z-[30] pointer-events-none"
          style={{ left: `${snapLines.x}%` }}
        />
      )}
      {snapLines.y !== undefined && (
        <div
          className="absolute left-0 right-0 h-px bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)] z-[30] pointer-events-none"
          style={{ top: `${snapLines.y}%` }}
        />
      )}

      {/* Transform Bounding Box Anchor */}
      <div
        className="absolute pointer-events-auto"
        style={{
          left: `${50 + positionX}%`,
          top: `${50 + positionY}%`,
          // Sized directly rather than drawn full size and scaled down. A CSS
          // scale shrinks the outline and the grab handles along with the box,
          // so a small sticker ended up with a hairline border and handles too
          // fine to hit. Baking the scale into the dimensions keeps the chrome
          // one pixel wide at every size.
          width: `${boxWidth}px`,
          height: `${boxHeight}px`,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          transformOrigin: 'center center',
        }}
      >
        {/* Main Bounding Outline */}
        <div
          className={`absolute inset-0 transition-colors ${
            isShape
              ? 'border-2 border-sky-400 rounded bg-sky-500/[0.01] hover:border-sky-300'
              : cropMode
                ? 'border-2 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
                : 'border border-cyan-400/90 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
          }`}
          style={{
            cursor: activeDrag === 'move' ? 'grabbing' : 'move',
            ...(isShape ? { boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.25)' } : {}),
          }}
          onPointerDown={e => handlePointerDown(e, 'move')}
        >
          {/* Subtle center crosshair / drag indicator for non-shapes */}
          {!isShape && (
            <div className="absolute inset-0 flex items-center justify-center opacity-30 hover:opacity-80 transition-opacity">
              <div className="w-3 h-3 border-t-2 border-l-2 border-r-2 border-b-2 border-cyan-400 rounded-full" />
            </div>
          )}

          {/* Real size dimensions badge for shapes (matching CoverTransformBox) */}
          {isShape && (
            <div className="absolute -bottom-6 right-0 px-1.5 py-0.5 bg-zinc-900/90 border border-zinc-700/80 rounded text-[10px] text-zinc-300 font-mono shadow pointer-events-none whitespace-nowrap z-40">
              {Math.round(boxWidth)} × {Math.round(boxHeight)} px
            </div>
          )}

          {/* Crop Mask Overlay if crop is active for non-shapes */}
          {!isShape && (cropTop > 0 || cropRight > 0 || cropBottom > 0 || cropLeft > 0) && (
            <div
              className="absolute inset-0 border border-dashed border-amber-400/60 pointer-events-none"
              style={{
                top: `${cropTop}%`,
                right: `${cropRight}%`,
                bottom: `${cropBottom}%`,
                left: `${cropLeft}%`,
              }}
            />
          )}

          {/* Mode Indicator Badge (Crop / Transform) - only for regular non-shape clips */}
          {!isShape && (
            <div className="absolute -top-7 left-0 flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onToggleCropMode()
                }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shadow-lg transition-colors ${
                  cropMode
                    ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                    : 'bg-zinc-900/90 border border-zinc-700 text-cyan-300 hover:bg-zinc-800'
                }`}
                title="Press 'C' to toggle Crop Mode"
              >
                {cropMode ? (
                  <>
                    <Check className="w-2.5 h-2.5" />
                    Crop (Done)
                  </>
                ) : (
                  <>
                    <Crop className="w-2.5 h-2.5" />
                    Crop
                  </>
                )}
              </button>
              <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-black/60 text-zinc-300 backdrop-blur-sm">
                {Math.round(scale)}% · {Math.round(rotation)}°
              </span>
            </div>
          )}

          {/* Top Rotation Stem and Knob (in Normal Transform mode for non-shapes) */}
          {!isShape && !cropMode && (
            <div
              className="absolute left-1/2 -top-6 -translate-x-1/2 flex flex-col items-center pointer-events-auto cursor-grab active:cursor-grabbing group"
              onPointerDown={e => handlePointerDown(e, 'rotate')}
              title="Drag to rotate (Hold Shift for 15° snap)"
            >
              <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-zinc-950 shadow-md flex items-center justify-center group-hover:scale-125 transition-transform">
                <RotateCw className="w-2 h-2 text-zinc-950 stroke-[3]" />
              </div>
              <div className="w-px h-2.5 bg-cyan-400/80" />
            </div>
          )}

          {/* Bottom Rotation Handle for shapes (matching CoverTransformBox) */}
          {isShape && (
            <div
              className="absolute left-1/2 -bottom-10 -translate-x-1/2 flex items-center justify-center z-30 pointer-events-auto"
              style={{
                transform: `translateX(-50%) rotate(${-(rotation || 0)}deg)`,
              }}
            >
              <div
                onPointerDown={e => handlePointerDown(e, 'rotate')}
                title={`Rotate (${Math.round(rotation || 0)}°)`}
                className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 hover:border-sky-400 text-zinc-300 hover:text-white flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg transition-transform hover:scale-110"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </div>
            </div>
          )}

          {/* Shape Handles: matching CoverTransformBox with 4 corner circles and 4 side pill handles */}
          {isShape && (
            <>
              {/* 4 Corner circular handles (Proportional scale with opposite corner pinned) */}
              <div
                className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-sky-500 rounded-full shadow-md z-30 cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-nw')}
              />
              <div
                className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-sky-500 rounded-full shadow-md z-30 cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-ne')}
              />
              <div
                className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-sky-500 rounded-full shadow-md z-30 cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-sw')}
              />
              <div
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-sky-500 rounded-full shadow-md z-30 cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-se')}
              />

              {/* 2 Width pill handles (East & West) with opposite edge pinned */}
              <div
                className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2 h-5 bg-white border-2 border-sky-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-w')}
                title="Resize width"
              />
              <div
                className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2 h-5 bg-white border-2 border-sky-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-e')}
                title="Resize width"
              />

              {/* 2 Height pill handles (North & South) with opposite edge pinned */}
              <div
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-2 bg-white border-2 border-sky-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-n')}
                title="Resize height"
              />
              <div
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-2 bg-white border-2 border-sky-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-s')}
                title="Resize height"
              />
            </>
          )}

          {/* Handles: Scale Handles in Transform Mode for non-shapes */}
          {!isShape && !cropMode && (
            <>
              {/* 4 Corners */}
              <div
                className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-cyan-500 shadow-sm rounded-sm cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-nw')}
              />
              <div
                className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-cyan-500 shadow-sm rounded-sm cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-ne')}
              />
              <div
                className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-cyan-500 shadow-sm rounded-sm cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-sw')}
              />
              <div
                className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-cyan-500 shadow-sm rounded-sm cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-se')}
              />

              {/* 4 Edge Midpoints */}
              <div
                className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2 bg-white border border-cyan-500 rounded-sm cursor-ns-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-n')}
              />
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2 bg-white border border-cyan-500 rounded-sm cursor-ns-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-s')}
              />
              <div
                className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2.5 bg-white border border-cyan-500 rounded-sm cursor-ew-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-w')}
              />
              <div
                className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2.5 bg-white border border-cyan-500 rounded-sm cursor-ew-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'scale-e')}
              />
            </>
          )}

          {/* Handles: Crop Handles in Crop Mode for non-shapes */}
          {!isShape && cropMode && (
            <>
              {/* L-shaped corner brackets */}
              <div
                className="absolute -top-2 -left-2 w-4 h-4 border-t-4 border-l-4 border-amber-400 cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-tl')}
              />
              <div
                className="absolute -top-2 -right-2 w-4 h-4 border-t-4 border-r-4 border-amber-400 cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-tr')}
              />
              <div
                className="absolute -bottom-2 -left-2 w-4 h-4 border-b-4 border-l-4 border-amber-400 cursor-nesw-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-bl')}
              />
              <div
                className="absolute -bottom-2 -right-2 w-4 h-4 border-b-4 border-r-4 border-amber-400 cursor-nwse-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-br')}
              />

              {/* Edge bars */}
              <div
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-2 bg-amber-400 rounded-sm cursor-ns-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-t')}
              />
              <div
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-8 h-2 bg-amber-400 rounded-sm cursor-ns-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-b')}
              />
              <div
                className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2 h-8 bg-amber-400 rounded-sm cursor-ew-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-l')}
              />
              <div
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2 h-8 bg-amber-400 rounded-sm cursor-ew-resize hover:scale-125 transition-transform"
                onPointerDown={e => handlePointerDown(e, 'crop-r')}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
