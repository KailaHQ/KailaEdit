import React, { useRef, useEffect, useState, useCallback } from 'react'
import type { TimelineClip, BrushStroke } from '@core/project-model'
import { useEditorStore, useEditorActions } from '../editor-store'
import { selectCustomMatteBrushMode, selectCustomMatteBrushSize } from '@core/editor-selectors'
import { matteTimeForSourceTime } from '@core/auto-matte'
import { computeStrokesHash, customMatteStartsEmpty, rasterizeStrokes } from '@core/custom-matte'
import { encodeRegionMask, smartSelect, type RegionMask } from '@core/smart-select'
import { samplePoints, type SamPoint } from '@core/sam-prompt'
import { motionAt, motionHash, strokeToReference, type MatteMotion } from '@core/matte-motion'
import { samEngine } from './SamEngine'
import { useTranslation } from '../../../i18n/I18nContext'

const NO_STROKES: BrushStroke[] = []

/** The frame the selection is worked out on: big enough to follow an outline, small enough to be instant. */
const SMART_LONG_EDGE = 448
/** How long the person-matting model may take before the selection goes on without it. */
const SUBJECT_MATTE_TIMEOUT_MS = 30000

const tintCache = new Map<string, HTMLCanvasElement>()
const TINT_LONG_EDGE = 512

/**
 * What the painted strokes come to, as a translucent picture of the picture: the very masks
 * the preview and the export apply, so the tint is the result and not a record of the moves.
 * Stacking every stroke's own colour left an erased area still painted — and a smart eraser
 * over a smart brush's selection came out as red muddled into green.
 *
 * With nothing underneath the picture is a cutout, and only what is kept shows, in green;
 * an area a later stroke erased is simply no longer green. Over a picture that starts whole,
 * what is taken away shows in red.
 */
function netTint(
  strokes: BrushStroke[],
  startsEmpty: boolean,
  aspect: number,
  motion?: MatteMotion,
  trimStart = 0,
  speed = 1,
): HTMLCanvasElement | null {
  const motionKey = motion ? `${motionHash(motion)}:${trimStart.toFixed(3)}:${speed.toFixed(3)}` : ''
  const key = `${startsEmpty ? 'k' : 'w'}:${aspect.toFixed(4)}:${computeStrokesHash(strokes, motionKey)}`
  const cached = tintCache.get(key)
  if (cached) return cached
  const width = aspect >= 1 ? TINT_LONG_EDGE : Math.max(8, Math.round(TINT_LONG_EDGE * aspect))
  const height = aspect >= 1 ? Math.max(8, Math.round(TINT_LONG_EDGE / aspect)) : TINT_LONG_EDGE
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { brushMask, eraserMask } = rasterizeStrokes(strokes, width, height, {
    toReference: motion ? paintedAt => strokeToReference(motion, paintedAt, trimStart, speed) : undefined,
  })
  const image = ctx.createImageData(width, height)
  for (let i = 0; i < brushMask.length; i++) {
    const kept = startsEmpty ? Math.max(0, brushMask[i] - eraserMask[i]) : brushMask[i]
    const removed = startsEmpty ? 0 : eraserMask[i]
    const o = i * 4
    if (removed > kept) {
      image.data[o] = 244; image.data[o + 1] = 63; image.data[o + 2] = 94
      image.data[o + 3] = Math.round(removed * 0.55)
    } else {
      image.data[o] = 20; image.data[o + 1] = 214; image.data[o + 2] = 196
      image.data[o + 3] = Math.round(kept * 0.55)
    }
  }
  ctx.putImageData(image, 0, 0)
  if (tintCache.size > 40) tintCache.clear()
  tintCache.set(key, canvas)
  return canvas
}

/**
 * The smart brush / smart eraser: the object under the painted points, as a mask of the
 * picture. Worked out from the frame on screen; where the person-matting model can be run it
 * also tells which pixels are the subject, so painting a shirt selects the whole person.
 * Resolves with nothing when the frame cannot be read, and the stroke stays a plain one.
 */
async function selectObject(
  source: HTMLVideoElement | HTMLImageElement,
  stroke: BrushStroke,
  clipId: string,
  clipTime: number,
): Promise<RegionMask | null> {
  const width0 = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const height0 = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (!(width0 > 0 && height0 > 0)) return null
  const k = Math.min(1, SMART_LONG_EDGE / Math.max(width0, height0))
  const width = Math.max(8, Math.round(width0 * k))
  const height = Math.max(8, Math.round(height0 * k))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  let rgba: Uint8ClampedArray
  try {
    ctx.drawImage(source, 0, 0, width, height)
    rgba = ctx.getImageData(0, 0, width, height).data
  } catch {
    return null // a frame the page may not read
  }

  // The painted points, as they lie on this smaller frame.
  const seeds = rasterizeStrokes([{ ...stroke, mode: 'brush', size: Math.min(stroke.size, 8), region: undefined }], width, height).brushMask

  let subject: Uint8Array | null = null
  try {
    const { matteEngine } = await import('./MatteEngine')
    // The matting model is recurrent: its first pass over a frame is a rough guess that
    // bleeds into the background, and it settles on the next. Two passes on the same frame
    // give the matte a person's outline can be trusted to follow.
    const options = { clipId: `smart-select-${clipId}`, timestamp: clipTime, force: true, quality: 'high' as const }
    const result = await Promise.race([
      matteEngine.processFrame(source, options).then(() => matteEngine.processFrame(source, options)),
      new Promise<null>(resolve => setTimeout(() => resolve(null), SUBJECT_MATTE_TIMEOUT_MS)),
    ])
    if (result && result.alphaData && result.width > 0 && result.height > 0) {
      subject = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        const sy = Math.min(result.height - 1, Math.floor(((y + 0.5) / height) * result.height))
        for (let x = 0; x < width; x++) {
          const sx = Math.min(result.width - 1, Math.floor(((x + 0.5) / width) * result.width))
          subject[y * width + x] = result.alphaData[sy * result.width + sx]
        }
      }
    }
  } catch {
    subject = null
  }

  return encodeRegionMask(smartSelect({ width, height, rgba, seeds, subject }), width, height)
}

/** The size a smart selection is kept at: long side, in pixels of the picture. */
const SAM_MASK_LONG_EDGE = 512

function pictureSizeOf(source: HTMLVideoElement | HTMLImageElement): { width: number; height: number } | null {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  return width > 0 && height > 0 ? { width, height } : null
}

function frameKey(source: HTMLVideoElement | HTMLImageElement, clipId: string, clipTime: number): string {
  return `${clipId}:${source.currentSrc || source.src}:${clipTime.toFixed(3)}`
}

/**
 * The smart brush and smart eraser, done with Segment Anything (MobileSAM): the object under
 * one stroke's points. Tapping the hair selects the hair; a tap of the eraser on a patch of
 * wall the selection took takes just that patch away.
 *
 * Each stroke is worked out from its own points alone, and the strokes are laid down in
 * order, a later one over an earlier (see rasterizeStrokes). Prompting each stroke with the
 * other tool's points as "not this" looked like refinement, but the points of a person
 * painted whole lie on the hair too: erasing the hair then asked the person's stroke for
 * "the person, not the hair" and it came back without the shirt, and painting the hair back
 * asked for "the hair, not the hair" and got a scrap of it.
 */
async function samRegion(
  source: HTMLVideoElement | HTMLImageElement,
  clipId: string,
  stroke: BrushStroke,
): Promise<RegionMask> {
  const size = pictureSizeOf(source)
  if (!size) throw new Error('The picture is not loaded yet')
  const k = SAM_MASK_LONG_EDGE / Math.max(size.width, size.height)
  const width = Math.max(8, Math.round(size.width * k))
  const height = Math.max(8, Math.round(size.height * k))
  const points: SamPoint[] = samplePoints(stroke.points).map(([x, y]) => ({ x, y, positive: true }))
  const mask = await samEngine.segment(source, frameKey(source, clipId, stroke.paintedAt), points, width, height)
  return encodeRegionMask(mask, width, height)
}

interface Rect { x: number; y: number; w: number; h: number }

function mediaSizeOf(el: HTMLVideoElement | HTMLImageElement | null | undefined): { width: number; height: number } | null {
  if (!el) return null
  const width = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const height = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * Where the picture itself sits in the frame. The strokes are stored as fractions of the
 * picture — that is what the preview's mask and the export's bake both read — but the overlay
 * covers the whole frame, and a picture that does not share the frame's proportions (a 3:4
 * photo in a 9:16 frame) fills only part of it. Fractions of the frame put every stroke in the
 * wrong place on the picture, so the keep/remove areas came out shifted or empty.
 */
function pictureRect(frame: { width: number; height: number }, media: { width: number; height: number } | null): Rect {
  if (!media) return { x: 0, y: 0, w: frame.width, h: frame.height }
  const scale = Math.min(frame.width / media.width, frame.height / media.height)
  const w = media.width * scale
  const h = media.height * scale
  return { x: (frame.width - w) / 2, y: (frame.height - h) / 2, w, h }
}

export interface BrushOverlayProps {
  selectedClip: TimelineClip | null
  videoFrameSize: { width: number; height: number }
  sourceElement?: HTMLVideoElement | HTMLImageElement | null
}

/**
 * Where the pointer is on the canvas, in canvas pixels. The monitor's zoom scales the frame
 * with CSS, so the canvas can be drawn at one size and shown at another; measuring in screen
 * pixels put every stroke — and the cursor — away from the pointer whenever zoom was not 100%.
 */
function canvasPoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
}

export const BrushOverlay: React.FC<BrushOverlayProps> = ({
  selectedClip,
  videoFrameSize,
  sourceElement,
}) => {
  const brushMode = useEditorStore(selectCustomMatteBrushMode)
  const brushSize = useEditorStore(selectCustomMatteBrushSize)
  const { addCustomMatteStroke, setCustomMatteBrushMode } = useEditorActions()
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState(false)

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

  const paintedStrokes: BrushStroke[] = selectedClip?.customMatte?.strokes ?? NO_STROKES

  // Picking a smart tool starts working the picture out, so the first tap is quick.
  const smartToolPicked = brushMode === 'region-brush' || brushMode === 'region-eraser'
  const warmClipId = selectedClip?.id
  useEffect(() => {
    if (!smartToolPicked || !sourceElement || !warmClipId || !pictureSizeOf(sourceElement)) return
    samEngine.embed(sourceElement, frameKey(sourceElement, warmClipId, clipLocalTime())).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartToolPicked, sourceElement, warmClipId])
  const startsEmpty = customMatteStartsEmpty(paintedStrokes, Boolean(selectedClip?.autoMatte?.enabled))

  const picture = pictureRect(videoFrameSize, mediaSizeOf(sourceElement))
  // Calculate brush radius in pixels on the overlay canvas: a share of the picture's short edge
  const shortEdge = Math.min(picture.w, picture.h)
  const brushRadiusPx = Math.max(1, (brushSize / 100) * shortEdge * 0.5)

  // Clear or redraw temporary strokes and brush cursor
  const renderOverlay = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 0. What the strokes already painted come to, so the area does not vanish the moment the
    // button is released. Green is kept, red is taken away.
    if (paintedStrokes.length > 0) {
      const motion = selectedClip?.customMatte?.motion
      const tint = netTint(paintedStrokes, startsEmpty, picture.w / picture.h, motion, selectedClip?.trimStart ?? 0, selectedClip?.speed ?? 1)
      if (tint) {
        // On a moving shot the tint is laid where the picture stands at the playhead, so it
        // sits on what the strokes were painted on, not where the picture began.
        const video = sourceElement as HTMLVideoElement | null | undefined
        const at = motion && video && typeof video.currentTime === 'number' ? motionAt(motion, video.currentTime) : null
        ctx.save()
        ctx.translate(picture.x, picture.y)
        if (at) ctx.transform(at[0], (at[3] * picture.h) / picture.w, (at[1] * picture.w) / picture.h, at[4], at[2] * picture.w, at[5] * picture.h)
        ctx.drawImage(tint, 0, 0, picture.w, picture.h)
        ctx.restore()
      }
    }

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
      ctx.moveTo(picture.x + p0[0] * picture.w, picture.y + p0[1] * picture.h)
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        ctx.lineTo(picture.x + p[0] * picture.w, picture.y + p[1] * picture.h)
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
  }, [brushMode, brushRadiusPx, cursorPos, paintedStrokes, startsEmpty, shortEdge, picture.x, picture.y, picture.w, picture.h, selectedClip?.customMatte?.motion, selectedClip?.trimStart, selectedClip?.speed, sourceElement])

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
    const { x, y } = canvasPoint(canvas, e)

    const normX = Math.max(0, Math.min(1, (x - picture.x) / picture.w))
    const normY = Math.max(0, Math.min(1, (y - picture.y) / picture.h))

    isDrawingRef.current = true
    currentStrokePointsRef.current = [[normX, normY]]
    setCursorPos({ x, y })

    // Capture pointer
    canvas.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { x, y } = canvasPoint(canvas, e)

    setCursorPos({ x, y })

    if (isDrawingRef.current && brushMode) {
      const normX = Math.max(0, Math.min(1, (x - picture.x) / picture.w))
      const normY = Math.max(0, Math.min(1, (y - picture.y) / picture.h))
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
      const clipId = selectedClip.id
      if ((brushMode === 'region-brush' || brushMode === 'region-eraser') && sourceElement) {
        setSelecting(true)
        samRegion(sourceElement, clipId, stroke)
          .then(region => addCustomMatteStroke(clipId, { ...stroke, region }))
          .catch(err => {
            // Without the model (missing file, no GPU and no wasm) fall back to growing by colour.
            console.warn('[BrushOverlay] Segment Anything is unavailable, selecting by colour:', err)
            return selectObject(sourceElement, stroke, clipId, stroke.paintedAt)
              .then(region => addCustomMatteStroke(clipId, region ? { ...stroke, region } : stroke))
              .catch(() => addCustomMatteStroke(clipId, stroke))
          })
          .finally(() => setSelecting(false))
      } else {
        addCustomMatteStroke(clipId, stroke)
      }
    }

    currentStrokePointsRef.current = []
    renderOverlay()
  }

  const handlePointerLeave = () => {
    setCursorPos(null)
  }

  return (
    <div
      data-brush-overlay
      className="absolute inset-0 z-[45] pointer-events-auto"
      // A stroke ends in a click, which the frame would take for "select whatever is here"
      // and move the selection off the clip being painted.
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
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
      {selecting && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-[11px] text-emerald-300 shadow">
          {t('clipProperties.customRemoval.selecting')}
        </div>
      )}
    </div>
  )
}
