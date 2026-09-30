import React, { useLayoutEffect, useRef, useState } from 'react'
import { X, RotateCw } from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import { hasKeyframes, hasKeyframesForProperty, sampleClipAt } from '@core/keyframes'

/** Frame height a text style's sizes are written against — the export scales by height / 1080. */
export const TEXT_REFERENCE_FRAME_HEIGHT = 1080
/** Breathing room around text without padding of its own, so it stays easy to grab. */
export const TEXT_HIT_PADDING = 8
/** The width a text box may grow to when none is set (percent of the frame's width). */
export const DEFAULT_TEXT_MAX_WIDTH = 80

/**
 * Screen pixels per text-style pixel: the frame's height over 1080.
 *
 * Text used to be sized in `vh`, against the window. The picture is sized against the
 * monitor, so enlarging the monitor (or shrinking the window) grew the picture but not the
 * text, and the two came apart. Measured against the frame, text keeps its share of the
 * picture at any monitor size — and it is the share the export burns in.
 */
export function useFrameTextUnit(
  frameElement: HTMLElement | null,
  boxRef?: React.RefObject<HTMLElement>,
): number {
  // Layout height, not the on-screen box: the monitor's zoom is a CSS scale on an ancestor,
  // which already enlarges the text along with the picture.
  const [height, setHeight] = useState(() => frameElement?.offsetHeight ?? 0)
  useLayoutEffect(() => {
    // The monitor hands over its frame through a ref read during render, which is still
    // null on the first one — and a paused monitor may not render again. The text box sits
    // directly in the frame, so its parent is the frame whenever the ref is not there yet.
    const target = frameElement ?? boxRef?.current?.parentElement ?? null
    if (!target) return
    const measure = () => setHeight(target.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [frameElement, boxRef])
  // Before the frame is measured, the old window-relative size (0.05vh) is the nearest guess.
  if (!(height > 0)) return typeof window !== 'undefined' ? window.innerHeight * 0.0005 : 0.5
  return height / TEXT_REFERENCE_FRAME_HEIGHT
}

/** What a text clip's keyframes make of it at one instant. */
export interface AnimatedTextState {
  posX: number
  posY: number
  scale: number
  rotation: number
  opacity: number
  text: string
}

export function animatedTextState(clip: TimelineClip, time: number): AnimatedTextState {
  const ts = clip.textStyle!
  const timeInClip = Math.max(0, Math.min(clip.duration, time - clip.startTime))
  const sampled = hasKeyframes(clip) ? sampleClipAt(clip, timeInClip) : null
  const has = (property: Parameters<typeof hasKeyframesForProperty>[1]) => Boolean(sampled) && hasKeyframesForProperty(clip, property)

  let text = ts.text || 'Text'
  // Typewriter effect via textProgress (0..100)
  if (sampled && sampled.textProgress < 100) {
    const visibleChars = Math.max(0, Math.min(ts.text.length, Math.floor((ts.text.length * sampled.textProgress) / 100)))
    text = ts.text.slice(0, visibleChars)
  }
  return {
    posX: ts.positionX + (sampled && has('transform.positionX') ? sampled.positionX : 0),
    posY: ts.positionY + (sampled && has('transform.positionY') ? sampled.positionY : 0),
    scale: sampled && has('transform.scale') ? sampled.scale / 100 : 1,
    rotation: sampled && has('transform.rotation') ? sampled.rotation : (clip.transform?.rotation ?? 0),
    opacity: (sampled && has('opacity') ? sampled.opacity : (ts.opacity ?? 100)) / 100,
    text,
  }
}

export function textBoxTransform(state: Pick<AnimatedTextState, 'scale' | 'rotation'>): string {
  const parts = ['translate(-50%, -50%)']
  if (state.scale !== 1) parts.push(`scale(${state.scale})`)
  if (state.rotation !== 0) parts.push(`rotate(${state.rotation}deg)`)
  return parts.join(' ')
}

export interface TextBoundingBoxProps {
  clip: TimelineClip
  isSelected: boolean
  currentTime: number
  /**
   * While playing, `currentTime` only reaches the store four times a second, which is far too
   * slow to animate text with. The live time is read from here instead, every frame.
   */
  isPlaying?: boolean
  playbackTimeRef?: React.MutableRefObject<number>
  frameElement: HTMLElement | null
  onSelect: () => void
  onDoubleClick: () => void
  onUpdatePosition: (posX: number, posY: number) => void
  onUpdateFontSize: (fontSize: number) => void
  onUpdateMaxWidth: (maxWidth: number) => void
  onUpdateRotation: (rotation: number) => void
  onDelete: () => void
  onInteractionStart?: () => void
  onInteractionEnd?: () => void
}

export const TextBoundingBox: React.FC<TextBoundingBoxProps> = ({
  clip,
  isSelected,
  currentTime,
  isPlaying = false,
  playbackTimeRef,
  frameElement,
  onSelect,
  onDoubleClick,
  onUpdatePosition,
  onUpdateFontSize,
  onUpdateMaxWidth,
  onUpdateRotation,
  onDelete,
  onInteractionStart,
  onInteractionEnd,
}) => {
  const ts = clip.textStyle!
  const boxRef = useRef<HTMLDivElement>(null)
  const unit = useFrameTextUnit(frameElement, boxRef)

  // High-frequency local state for smooth 60fps interaction during dragging
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)
  const [localFontSize, setLocalFontSize] = useState<number | null>(null)
  const [localMaxWidth, setLocalMaxWidth] = useState<number | null>(null)
  const [localRotation, setLocalRotation] = useState<number | null>(null)

  // Sample keyframe animation if available. Playing reads the live clock: the store's
  // `currentTime` is published at 4 Hz, and text animated from it moved in 4 Hz steps.
  const live = isPlaying && playbackTimeRef ? playbackTimeRef.current : currentTime
  const animated = animatedTextState(clip, live)

  const effectivePosX = localPos ? localPos.x : animated.posX
  const effectivePosY = localPos ? localPos.y : animated.posY
  const effectiveFontSize = localFontSize ?? ts.fontSize
  const effectiveMaxWidth = localMaxWidth ?? (ts.maxWidth > 0 ? ts.maxWidth : DEFAULT_TEXT_MAX_WIDTH)
  const effectiveRotation = localRotation ?? animated.rotation
  const opacity = animated.opacity

  const transform = textBoxTransform({ scale: animated.scale, rotation: effectiveRotation })

  // The words live in a node React never touches, so the frame loop below can rewrite them
  // (the typewriter) without the two fighting over it.
  const textRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (textRef.current && textRef.current.textContent !== animated.text) textRef.current.textContent = animated.text
  })

  // Every frame of playback: place the box straight from the clock, bypassing React.
  useLayoutEffect(() => {
    if (!isPlaying || !playbackTimeRef) return
    let frame = 0
    const tick = () => {
      const box = boxRef.current
      const state = animatedTextState(clip, playbackTimeRef.current)
      if (box && !localPos && localFontSize === null && localMaxWidth === null && localRotation === null) {
        box.style.left = `${state.posX}%`
        box.style.top = `${state.posY}%`
        box.style.transform = textBoxTransform(state)
        box.style.opacity = String(state.opacity)
        const words = textRef.current
        if (words && words.textContent !== state.text) words.textContent = state.text
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, playbackTimeRef, clip, localPos, localFontSize, localMaxWidth, localRotation])

  // Drag text box to move position
  const handleBoxMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    onInteractionStart?.()
    onSelect()
    if (!frameElement) return

    const rect = frameElement.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startPosX = effectivePosX
    const startPosY = effectivePosY

    let currentPx = startPosX
    let currentPy = startPosY

    const onMove = (ev: MouseEvent) => {
      const dxPercent = ((ev.clientX - startX) / rect.width) * 100
      const dyPercent = ((ev.clientY - startY) / rect.height) * 100
      let px = Math.max(0, Math.min(100, startPosX + dxPercent))
      let py = Math.max(0, Math.min(100, startPosY + dyPercent))
      if (Math.abs(px - 50) < 1.5) px = 50
      if (Math.abs(py - 50) < 1.5) py = 50
      currentPx = px
      currentPy = py
      setLocalPos({ x: px, y: py })
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLocalPos(null)
      onUpdatePosition(currentPx, currentPy)
      onInteractionEnd?.()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drag left/right pill handles to widen / narrow text space
  const handleWidthMouseDown = (e: React.MouseEvent, _side: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    onInteractionStart?.()
    onSelect()
    if (!frameElement) return

    const rect = frameElement.getBoundingClientRect()
    const centerX = rect.left + (effectivePosX / 100) * rect.width
    const centerY = rect.top + (effectivePosY / 100) * rect.height
    const rotRad = (effectiveRotation * Math.PI) / 180
    const cosR = Math.cos(rotRad)
    const sinR = Math.sin(rotRad)

    let finalWidth = effectiveMaxWidth

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - centerX
      const dy = ev.clientY - centerY
      // Project onto local X axis rotated by effectiveRotation
      const localX = dx * cosR + dy * sinR
      const halfWidthPx = Math.abs(localX)
      const totalWidthPx = halfWidthPx * 2
      const widthPercent = Math.max(8, Math.min(100, Math.round((totalWidthPx / rect.width) * 100)))
      finalWidth = widthPercent
      setLocalMaxWidth(widthPercent)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLocalMaxWidth(null)
      onUpdateMaxWidth(finalWidth)
      onInteractionEnd?.()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drag corner handles to scale text size (zoom in / zoom out)
  const handleScaleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onInteractionStart?.()
    onSelect()
    if (!frameElement) return

    const rect = frameElement.getBoundingClientRect()
    const centerX = rect.left + (effectivePosX / 100) * rect.width
    const centerY = rect.top + (effectivePosY / 100) * rect.height
    const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY)
    const startFontSize = effectiveFontSize
    const startMaxWidth = effectiveMaxWidth
    const hadCustomWidth = (ts.maxWidth > 0 && ts.maxWidth < 80) || localMaxWidth !== null

    let finalFontSize = startFontSize
    let finalMaxWidth = startMaxWidth

    const onMove = (ev: MouseEvent) => {
      const curDist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY)
      const ratio = curDist / Math.max(10, startDist)
      const newSize = Math.max(12, Math.min(250, Math.round(startFontSize * ratio)))
      finalFontSize = newSize
      setLocalFontSize(newSize)

      if (hadCustomWidth) {
        const newWidth = Math.max(8, Math.min(100, Math.round(startMaxWidth * ratio)))
        finalMaxWidth = newWidth
        setLocalMaxWidth(newWidth)
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLocalFontSize(null)
      setLocalMaxWidth(null)
      onUpdateFontSize(finalFontSize)
      if (hadCustomWidth) {
        onUpdateMaxWidth(finalMaxWidth)
      }
      onInteractionEnd?.()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drag bottom rotate handle to rotate text
  const handleRotateMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onInteractionStart?.()
    onSelect()
    if (!frameElement) return

    const rect = frameElement.getBoundingClientRect()
    const centerX = rect.left + (effectivePosX / 100) * rect.width
    const centerY = rect.top + (effectivePosY / 100) * rect.height
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI)
    const startRot = effectiveRotation

    let finalRot = startRot

    const onMove = (ev: MouseEvent) => {
      const curAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI)
      const diff = curAngle - startAngle
      let newRot = Math.round((startRot + diff) % 360)
      if (newRot < 0) newRot += 360
      // Snapping to cardinal angles:
      if (Math.abs(newRot) < 3 || Math.abs(newRot - 360) < 3) newRot = 0
      else if (Math.abs(newRot - 90) < 3) newRot = 90
      else if (Math.abs(newRot - 180) < 3) newRot = 180
      else if (Math.abs(newRot - 270) < 3) newRot = 270
      finalRot = newRot
      setLocalRotation(newRot)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLocalRotation(null)
      onUpdateRotation(finalRot)
      onInteractionEnd?.()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Use explicit width once modified, or snug fit-content for untouched default
  const isCustomWidth = (ts.maxWidth > 0 && ts.maxWidth < 80) || localMaxWidth !== null

  return (
    <div
      ref={boxRef}
      className="absolute z-[24] select-none"
      style={{
        left: `${effectivePosX}%`,
        top: `${effectivePosY}%`,
        transform,
        width: isCustomWidth ? `${effectiveMaxWidth}%` : 'max-content',
        maxWidth: `${effectiveMaxWidth}%`,
        opacity,
        pointerEvents: 'auto',
        cursor: 'move',
      }}
      onMouseDown={handleBoxMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onSelect()
        onDoubleClick()
      }}
    >
      {/* Text rendering */}
      <div
        ref={textRef}
        style={{
          fontFamily: ts.fontFamily,
          fontSize: `${effectiveFontSize * unit}px`,
          fontWeight: ts.fontWeight,
          fontStyle: ts.fontStyle,
          textDecoration: ts.underline ? 'underline' : undefined,
          color: ts.color,
          backgroundColor: ts.backgroundColor,
          textAlign: ts.textAlign,
          padding: `${(ts.padding > 0 ? ts.padding : TEXT_HIT_PADDING) * unit}px`,
          borderRadius: ts.borderRadius > 0 ? `${ts.borderRadius * unit}px` : undefined,
          letterSpacing: ts.letterSpacing !== 0 ? `${ts.letterSpacing * unit}px` : undefined,
          lineHeight: ts.lineHeight,
          textShadow:
            ts.shadowBlur > 0 || ts.shadowOffsetX !== 0 || ts.shadowOffsetY !== 0
              ? `${ts.shadowOffsetX * unit}px ${ts.shadowOffsetY * unit}px ${ts.shadowBlur * unit}px ${ts.shadowColor}`
              : undefined,
          WebkitTextStroke:
            ts.strokeWidth > 0 && ts.strokeColor !== 'transparent'
              ? `${ts.strokeWidth * unit}px ${ts.strokeColor}`
              : undefined,
          paintOrder: 'stroke fill',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          userSelect: 'none',
        }}
      />

      {/* Bounding box & handles (only when selected) */}
      {isSelected && (
        <>
          {/* White border with dark outline */}
          <div className="absolute inset-0 pointer-events-none border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] rounded-[2px]" />

          {/* Top-Left: Delete button (x) */}
          <button
            type="button"
            className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full bg-white text-zinc-800 border border-zinc-400 flex items-center justify-center cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.5)] hover:bg-red-50 hover:text-red-600 active:scale-95 transition-all z-30"
            title="Delete text clip"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <X className="w-3 h-3 stroke-[2.5]" />
          </button>

          {/* Top-Right: Scale corner handle */}
          <div
            className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-nesw-resize hover:scale-125 transition-transform z-30"
            title="Scale text size"
            onMouseDown={handleScaleMouseDown}
          />

          {/* Bottom-Left: Scale corner handle */}
          <div
            className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-nesw-resize hover:scale-125 transition-transform z-30"
            title="Scale text size"
            onMouseDown={handleScaleMouseDown}
          />

          {/* Bottom-Right: Scale corner handle */}
          <div
            className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-nwse-resize hover:scale-125 transition-transform z-30"
            title="Scale text size"
            onMouseDown={handleScaleMouseDown}
          />

          {/* Left Pill: Width handle (drag to widen / narrow text space) */}
          <div
            className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2 h-5.5 rounded-full bg-white border border-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-ew-resize hover:scale-115 transition-transform z-30 flex items-center justify-center"
            title="Drag to adjust text width"
            onMouseDown={(e) => handleWidthMouseDown(e, 'left')}
          >
            <div className="w-0.5 h-2.5 bg-zinc-500 rounded-full" />
          </div>

          {/* Right Pill: Width handle (drag to widen / narrow text space) */}
          <div
            className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2 h-5.5 rounded-full bg-white border border-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-ew-resize hover:scale-115 transition-transform z-30 flex items-center justify-center"
            title="Drag to adjust text width"
            onMouseDown={(e) => handleWidthMouseDown(e, 'right')}
          >
            <div className="w-0.5 h-2.5 bg-zinc-500 rounded-full" />
          </div>

          {/* Bottom Center: Rotate handle (🔄) */}
          <div
            className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center z-30 cursor-grab active:cursor-grabbing"
            title="Rotate text"
            onMouseDown={handleRotateMouseDown}
          >
            <div className="w-px h-2 bg-white/90 shadow-sm" />
            <div className="w-5 h-5 rounded-full bg-white text-zinc-800 border border-zinc-400 flex items-center justify-center shadow-[0_1px_3px_rgba(0,0,0,0.5)] hover:scale-110 active:scale-95 transition-transform">
              <RotateCw className="w-3 h-3 stroke-[2.5]" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
