import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Droplet, RotateCw } from 'lucide-react'
import type { Asset, TimelineClip, ClipMask } from '../../../types/project-model'
import { DEFAULT_CLIP_MASK, getClipMasks } from '../../../types/project-model'
import { buildMaskDimSvg } from '@core/clip-effect-styles'
import { selectActiveMaskId } from '../editor-selectors'
import { useEditorStore } from '../editor-store'

export interface MaskBoundingBoxProps {
  selectedClip: TimelineClip | null
  assets: Asset[]
  videoFrameSize: { width: number; height: number }
  currentTime: number
  maskMode: boolean
  onUpdateMask: (patch: Partial<ClipMask>) => void
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
  | 'feather'

/** How far the feather handle sits from the mask's line (or edge) when the feather is 0. */
const FEATHER_HANDLE_GAP = 40
/** How far the rotate handle sits from the mask's line. */
const ROTATE_HANDLE_GAP = 20
/** The soft zone is about this many picture heights, either side of the edge, at feather 100. */
const FEATHER_REACH = 0.5

const HANDLE_COLOR = '#22d3ee'

const degToRad = (deg: number) => (deg * Math.PI) / 180

/**
 * The on-canvas editor for the clip's masks.
 *
 * The picture is shown whole with the part the masks hide blacked out, so the cut can be seen as it is
 * dragged. The real mask is left off the clip meanwhile (see `maskEditClipId` in ProgramMonitor),
 * which is also why every drag shows at once: the black overlay is drawn from the mask as it is
 * being dragged, and the stored mask is written when the pointer is released.
 */
export const MaskBoundingBox: React.FC<MaskBoundingBoxProps> = ({
  selectedClip,
  assets,
  videoFrameSize,
  currentTime,
  maskMode,
  onUpdateMask,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  const [activeDrag, setActiveDrag] = useState<DragMode | null>(null)
  const [localMask, setLocalMask] = useState<ClipMask | null>(null)

  const liveAsset = useMemo(() => {
    if (!selectedClip || selectedClip.type === 'audio' || selectedClip.type === 'adjustment') return null
    if (selectedClip.assetId) {
      return assets.find(a => a.id === selectedClip.assetId) || selectedClip.asset
    }
    return selectedClip.asset
  }, [selectedClip, assets])

  const isClipActive = useMemo(() => {
    if (!selectedClip) return false
    return currentTime >= selectedClip.startTime - 0.05 && currentTime <= selectedClip.startTime + selectedClip.duration + 0.05
  }, [selectedClip, currentTime])

  // The mask being edited is the one picked in the panel, else the clip's first.
  const activeMaskId = useEditorStore(selectActiveMaskId)
  const allMasks = useMemo(() => (selectedClip ? getClipMasks(selectedClip) : []), [selectedClip])
  const editedMask = useMemo(
    () => allMasks.find(mask => mask.id === activeMaskId) ?? allMasks[0],
    [allMasks, activeMaskId],
  )
  const clipMask = editedMask ?? DEFAULT_CLIP_MASK
  const currentMask = localMask ?? clipMask

  useEffect(() => {
    setLocalMask(null)
  }, [selectedClip?.id, editedMask?.id])

  // Fitted dimensions inside video frame container
  const fitted = useMemo(() => {
    const fw = videoFrameSize.width || 1
    const fh = videoFrameSize.height || 1
    const aw = liveAsset?.width || fw
    const ah = liveAsset?.height || fh
    const targetRatio = aw / ah
    const containerRatio = fw / fh

    let bw: number
    let bh: number
    if (containerRatio > targetRatio) {
      bh = fh
      bw = fh * targetRatio
    } else {
      bw = fw
      bh = fw / targetRatio
    }

    return {
      width: Math.round(bw),
      height: Math.round(bh),
    }
  }, [videoFrameSize, liveAsset])

  // The picture as it sits in the frame: its size with the clip's scale, centred on the clip's position.
  const clipTf = selectedClip?.transform
  const clipScale = (clipTf?.scale ?? 100) / 100
  const clipW = fitted.width * clipScale
  const clipH = fitted.height * clipScale
  const pictureOffsetX = ((clipTf?.positionX ?? 0) / 100) * (videoFrameSize.width || 1)
  const pictureOffsetY = ((clipTf?.positionY ?? 0) / 100) * (videoFrameSize.height || 1)

  /** Where the dragged mask's centre is, in pixels from the frame's centre. */
  const centreOf = (mask: ClipMask) => ({
    x: pictureOffsetX + ((mask.x - 50) / 100) * clipW,
    y: pictureOffsetY + ((mask.y - 50) / 100) * clipH,
  })

  // The black overlay: every switched-on mask, the edited one as it is being dragged.
  const dimImage = useMemo(() => {
    const shown = allMasks
      .map(mask => (mask.id === editedMask?.id ? currentMask : mask))
      .filter(mask => mask.enabled !== false)
    if (shown.length === 0) return ''
    const svg = buildMaskDimSvg(shown, fitted.width / Math.max(1, fitted.height))
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  }, [allMasks, editedMask?.id, currentMask, fitted])

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    setActiveDrag(mode)

    const startX = e.clientX
    const startY = e.clientY
    const startMask = { ...(localMask ?? clipMask) }

    const containerEl = containerRef.current
    if (!containerEl) return
    const rect = containerEl.getBoundingClientRect()

    const clipLeft = rect.left + rect.width / 2 + pictureOffsetX - clipW / 2
    const clipTop = rect.top + rect.height / 2 + pictureOffsetY - clipH / 2

    // Centre of mask on screen
    const maskCenterX = clipLeft + (startMask.x / 100) * clipW
    const maskCenterY = clipTop + (startMask.y / 100) * clipH

    const initialAngle = Math.atan2(startY - maskCenterY, startX - maskCenterX) * (180 / Math.PI)
    const initialDistance = Math.hypot(startX - maskCenterX, startY - maskCenterY) || 1

    const rotation = startMask.rotation ?? 0
    const isLine = startMask.shape === 'linear'
    const maskPixelH = (startMask.height / 100) * clipH
    // The feather handle's resting distance from the centre, along the mask's own "up".
    const featherBase = isLine ? FEATHER_HANDLE_GAP : maskPixelH / 2 + FEATHER_HANDLE_GAP / 2
    const upX = Math.sin(degToRad(rotation)) * (isLine ? 1 : -1)
    const upY = -Math.cos(degToRad(rotation)) * (isLine ? 1 : -1)

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      if (mode === 'move') {
        const deltaXPct = (dx / clipW) * 100
        const deltaYPct = (dy / clipH) * 100
        const newX = Math.max(0, Math.min(100, Math.round((startMask.x + deltaXPct) * 10) / 10))
        const newY = Math.max(0, Math.min(100, Math.round((startMask.y + deltaYPct) * 10) / 10))

        setLocalMask(prev => ({
          ...(prev ?? startMask),
          x: newX,
          y: newY,
        }))
      } else if (mode === 'rotate') {
        const curAngle = Math.atan2(ev.clientY - maskCenterY, ev.clientX - maskCenterX) * (180 / Math.PI)
        const deltaAngle = curAngle - initialAngle
        let newRotation = (startMask.rotation ?? 0) + deltaAngle

        if (ev.shiftKey) {
          newRotation = Math.round(newRotation / 15) * 15
        }

        while (newRotation > 180) newRotation -= 360
        while (newRotation < -180) newRotation += 360

        setLocalMask(prev => ({
          ...(prev ?? startMask),
          rotation: Math.round(newRotation * 10) / 10,
        }))
      } else if (mode.startsWith('scale-')) {
        const curDist = Math.hypot(ev.clientX - maskCenterX, ev.clientY - maskCenterY)
        const ratio = curDist / initialDistance

        let newW = Math.max(5, Math.min(200, Math.round(startMask.width * ratio)))
        let newH = Math.max(5, Math.min(200, Math.round(startMask.height * ratio)))

        if (mode === 'scale-e' || mode === 'scale-w') {
          newH = startMask.height
        } else if (mode === 'scale-n' || mode === 'scale-s') {
          newW = startMask.width
        }

        setLocalMask(prev => ({
          ...(prev ?? startMask),
          width: newW,
          height: newH,
        }))
      } else if (mode === 'feather') {
        // How far the handle was dragged along the mask's "up", past where it rests.
        const along = (ev.clientX - maskCenterX) * upX + (ev.clientY - maskCenterY) * upY
        const reach = Math.max(0, along - featherBase)
        const newFeather = Math.max(0, Math.min(100, Math.round((reach / (FEATHER_REACH * clipH)) * 100)))

        setLocalMask(prev => ({
          ...(prev ?? startMask),
          feather: newFeather,
        }))
      }
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setActiveDrag(null)

      setLocalMask(finalMask => {
        if (finalMask) {
          onUpdateMask(finalMask)
        }
        return null
      })
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [localMask, clipMask, clipW, clipH, pictureOffsetX, pictureOffsetY, onUpdateMask])

  if (!selectedClip || !isClipActive || !editedMask?.enabled || !maskMode) {
    return null
  }

  const { shape, x, y, width, height, rotation = 0, feather = 0, roundCorners = 0 } = currentMask
  const centre = centreOf(currentMask)
  const isLine = shape === 'linear'
  const isBand = shape === 'mirror'
  const isEllipse = shape === 'ellipse'

  const maskPixelW = isBand ? clipW : (width / 100) * clipW
  const maskPixelH = (height / 100) * clipH
  const featherPx = (feather / 100) * FEATHER_REACH * clipH

  const heading = degToRad(rotation)
  const dirX = Math.cos(heading)
  const dirY = Math.sin(heading)
  // The mask's "up": the side of a split line the feather and rotate handles sit on.
  const upX = Math.sin(heading)
  const upY = -Math.cos(heading)

  // Where the split line leaves the picture in each direction, so it spans the whole picture.
  const reachAlong = (sign: 1 | -1) => {
    const mx = ((x - 50) / 100) * clipW
    const my = ((y - 50) / 100) * clipH
    let reach = Infinity
    const sx = dirX * sign
    const sy = dirY * sign
    if (Math.abs(sx) > 1e-6) reach = Math.min(reach, ((sx > 0 ? clipW / 2 : -clipW / 2) - mx) / sx)
    if (Math.abs(sy) > 1e-6) reach = Math.min(reach, ((sy > 0 ? clipH / 2 : -clipH / 2) - my) / sy)
    return Math.max(0, Number.isFinite(reach) ? reach : 0)
  }

  const at = (px: number, py: number): React.CSSProperties => ({
    left: `calc(50% + ${px}px)`,
    top: `calc(50% + ${py}px)`,
  })

  const featherHandle = (offset: number, ux: number, uy: number) => (
    <div
      className="absolute z-[2] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 bg-white shadow active:cursor-grabbing"
      style={{ ...at(centre.x + ux * offset, centre.y + uy * offset), borderColor: HANDLE_COLOR, pointerEvents: 'auto' }}
      onPointerDown={e => handlePointerDown(e, 'feather')}
      title="Feather"
    >
      <Droplet className="h-3 w-3 text-zinc-800" />
    </div>
  )

  const rotateHandle = (offset: number) => (
    <div
      className="absolute z-[2] flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 bg-white shadow active:cursor-grabbing"
      style={{ ...at(centre.x + upX * offset, centre.y + upY * offset), borderColor: HANDLE_COLOR, pointerEvents: 'auto' }}
      onPointerDown={e => handlePointerDown(e, 'rotate')}
      title="Rotate mask"
    >
      <RotateCw className="h-3 w-3 text-zinc-800" />
    </div>
  )

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-[30] overflow-hidden"
    >
      {/* The picture with what the masks hide in black. */}
      {dimImage && (
        <div
          className="absolute"
          style={{
            ...at(pictureOffsetX, pictureOffsetY),
            width: clipW,
            height: clipH,
            transform: 'translate(-50%, -50%)',
            backgroundImage: dimImage,
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
            pointerEvents: 'none',
          }}
        />
      )}

      {isLine ? (
        <>
          {/* The split line, across the whole picture; dragging it moves the split. */}
          {(() => {
            const forward = reachAlong(1)
            const backward = reachAlong(-1)
            const length = forward + backward
            const midX = centre.x + dirX * ((forward - backward) / 2)
            const midY = centre.y + dirY * ((forward - backward) / 2)
            const end = (sign: 1 | -1, reach: number) => ({
              x: centre.x + dirX * sign * reach,
              y: centre.y + dirY * sign * reach,
            })
            const a = end(1, forward)
            const b = end(-1, backward)
            return (
              <>
                {featherPx > 0 && (
                  <>
                    <div className="absolute" style={{ ...at(midX + upX * featherPx, midY + upY * featherPx), width: length, height: 0, borderTop: `1px dashed ${HANDLE_COLOR}`, opacity: 0.7, transform: `translate(-50%, -50%) rotate(${rotation}deg)`, pointerEvents: 'none' }} />
                    <div className="absolute" style={{ ...at(midX - upX * featherPx, midY - upY * featherPx), width: length, height: 0, borderTop: `1px dashed ${HANDLE_COLOR}`, opacity: 0.7, transform: `translate(-50%, -50%) rotate(${rotation}deg)`, pointerEvents: 'none' }} />
                  </>
                )}
                <div
                  className="absolute flex items-center"
                  style={{
                    ...at(midX, midY),
                    width: length,
                    height: 18,
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    cursor: activeDrag === 'move' ? 'grabbing' : 'move',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={e => handlePointerDown(e, 'move')}
                >
                  <div className="w-full" style={{ borderTop: `2px dashed ${HANDLE_COLOR}` }} />
                </div>
                {[a, b].map((point, index) => (
                  <div
                    key={index}
                    className="absolute z-[2] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-white shadow active:cursor-grabbing"
                    style={{ ...at(point.x, point.y), borderColor: HANDLE_COLOR, pointerEvents: 'auto' }}
                    onPointerDown={e => handlePointerDown(e, 'rotate')}
                    title="Rotate mask"
                  />
                ))}
                {rotateHandle(ROTATE_HANDLE_GAP)}
                {featherHandle(FEATHER_HANDLE_GAP + featherPx, upX, upY)}
              </>
            )
          })()}
        </>
      ) : (
        <>
          <div
            className="absolute"
            style={{
              ...at(centre.x, centre.y),
              width: maskPixelW,
              height: maskPixelH,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              pointerEvents: 'none',
            }}
          >
            {/* Main mask bounding outline */}
            <div
              className={`absolute inset-0 border-2 border-dashed ${isEllipse ? 'rounded-full' : ''}`}
              style={{
                borderColor: HANDLE_COLOR,
                borderRadius: shape === 'rectangle' && roundCorners > 0 ? `${(roundCorners / 100) * (Math.min(maskPixelW, maskPixelH) / 2)}px` : undefined,
                cursor: activeDrag === 'move' ? 'grabbing' : 'move',
                pointerEvents: 'auto',
              }}
              onPointerDown={e => handlePointerDown(e, 'move')}
            >
              {/* Center drag crosshair */}
              <div className="absolute inset-0 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HANDLE_COLOR }} />
              </div>

              {/* Feather band: how far the soft edge reaches. */}
              {feather > 0 && (
                <div
                  className={`absolute border border-dotted pointer-events-none ${isEllipse ? 'rounded-full' : ''}`}
                  style={{ inset: -featherPx, borderColor: HANDLE_COLOR, opacity: 0.6 }}
                />
              )}

              {/* Scale corner & edge handles */}
              {[
                ['-top-1.5 -left-1.5 cursor-nwse-resize', 'scale-nw'],
                ['-top-1.5 -right-1.5 cursor-nesw-resize', 'scale-ne'],
                ['-bottom-1.5 -right-1.5 cursor-nwse-resize', 'scale-se'],
                ['-bottom-1.5 -left-1.5 cursor-nesw-resize', 'scale-sw'],
              ].map(([cls, mode]) => (
                <div
                  key={mode}
                  className={`absolute w-3 h-3 bg-white border rounded-sm shadow ${cls}`}
                  style={{ borderColor: HANDLE_COLOR, pointerEvents: 'auto' }}
                  onPointerDown={e => handlePointerDown(e, mode as DragMode)}
                />
              ))}
              {[
                ['-top-1 left-1/2 -translate-x-1/2 w-3 h-2 cursor-ns-resize', 'scale-n'],
                ['-bottom-1 left-1/2 -translate-x-1/2 w-3 h-2 cursor-ns-resize', 'scale-s'],
                ['-left-1 top-1/2 -translate-y-1/2 w-2 h-3 cursor-ew-resize', 'scale-w'],
                ['-right-1 top-1/2 -translate-y-1/2 w-2 h-3 cursor-ew-resize', 'scale-e'],
              ].map(([cls, mode]) => (
                <div
                  key={mode}
                  className={`absolute bg-white border rounded-sm shadow ${cls}`}
                  style={{ borderColor: HANDLE_COLOR, pointerEvents: 'auto' }}
                  onPointerDown={e => handlePointerDown(e, mode as DragMode)}
                />
              ))}
            </div>
          </div>

          {/* Rotate handle above the shape; feather handle below it. Both turn with the mask. */}
          {rotateHandle(maskPixelH / 2 + ROTATE_HANDLE_GAP)}
          {featherHandle(maskPixelH / 2 + FEATHER_HANDLE_GAP / 2 + featherPx, -upX, -upY)}
        </>
      )}
    </div>
  )
}
