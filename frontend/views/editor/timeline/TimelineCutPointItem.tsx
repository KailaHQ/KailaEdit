import React, { useState } from 'react'
import { X } from 'lucide-react'
import type { TimelineCut } from '@core/timeline-cuts'
import {
  clampTransitionDuration,
  getTransitionDefinition,
} from '@core/transitions'
import { useTranslation } from '../../../i18n/I18nContext'

export type CutPointData = TimelineCut

export interface TimelineCutPointItemProps {
  cp: CutPointData
  isHovered: boolean
  pixelsPerSecond: number
  trackTopPx: (trackIndex: number, padding?: number) => number
  getTrackHeight?: (trackIndex: number) => number
  onMouseEnter: () => void
  onMouseLeave: () => void
  /** Places a transition at this cut, or re-times the one already there. */
  setTransition: (leftClipId: string, rightClipId: string, type: string, duration: number) => void
  /** Shared entry point for placing a transition; closes a near-gap when needed. */
  applyTransitionAtPoint: (trackIndex: number, time: number, type: string, snapSeconds: number) => boolean
  removeTransition: (transitionId: string) => void
  /** Moves the playhead onto the cut, which is how the library knows where to apply. */
  onFocusCut: (time: number) => void
}

/**
 * The junction between two clips.
 *
 * Bare, it is a hover and drop target offering to add a transition. With one, it is a
 * band spanning the overlap — the overlap *is* the transition, so its width on
 * screen is its real duration — with a handle at each end to re-time it.
 */
export const TimelineCutPointItem: React.FC<TimelineCutPointItemProps> = ({
  cp,
  isHovered,
  pixelsPerSecond,
  trackTopPx,
  getTrackHeight,
  onMouseEnter,
  onMouseLeave,
  setTransition,
  applyTransitionAtPoint,
  removeTransition,
  onFocusCut,
}) => {
  const { t } = useTranslation()
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [isGlobalTransitionDragging, setIsGlobalTransitionDragging] = useState(false)

  React.useEffect(() => {
    const handleDragStart = () => setIsGlobalTransitionDragging(true)
    const handleDragEnd = () => {
      setIsGlobalTransitionDragging(false)
      setIsDropTarget(false)
    }

    window.addEventListener('komfyedit:transition-drag-start', handleDragStart)
    window.addEventListener('komfyedit:transition-drag-end', handleDragEnd)
    window.addEventListener('dragend', handleDragEnd)
    window.addEventListener('drop', handleDragEnd)

    return () => {
      window.removeEventListener('komfyedit:transition-drag-start', handleDragStart)
      window.removeEventListener('komfyedit:transition-drag-end', handleDragEnd)
      window.removeEventListener('dragend', handleDragEnd)
      window.removeEventListener('drop', handleDragEnd)
    }
  }, [])

  const topPx = trackTopPx(cp.trackIndex, 4)
  const heightPx = getTrackHeight ? getTrackHeight(cp.trackIndex) - 8 : 48
  const transition = cp.transition
  const label = transition
    ? (t(`transitions.items.${transition.type}`) || getTransitionDefinition(transition.type)?.label || transition.type)
    : ''

  const handleDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types).map(type => type.toLowerCase())
    const isTransition = types.some(type => type.includes('transition') || type === 'text/plain')
    if (isTransition) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (!isDropTarget) setIsDropTarget(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDropTarget(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDropTarget(false)
    setIsGlobalTransitionDragging(false)
    const transitionType = e.dataTransfer.getData('transitionType') ||
      e.dataTransfer.getData('application/x-komfyedit-transition') ||
      e.dataTransfer.getData('text/plain')
    if (transitionType) {
      // Through the shared funnel, because this marker also stands on junctions
      // whose clips do not touch yet — those need their gap closed first.
      applyTransitionAtPoint(cp.trackIndex, cp.time, transitionType, 1 / pixelsPerSecond)
    }
  }

  const startResize = (event: React.MouseEvent, edge: 'left' | 'right') => {
    if (!transition) return
    event.stopPropagation()
    event.preventDefault()

    const startX = event.clientX
    const startDuration = transition.duration
    // Measure the room against the clips as they were before this transition
    // borrowed from them, which is what the store clamps against too. Using
    // their overlapped lengths let the handle promise a band the edit then
    // refused, and the drag stuck against an invisible ceiling.
    const leftRoom = cp.leftClip.duration - (transition.leftExtend ?? 0)
    const rightRoom = cp.rightClip.duration - (transition.rightExtend ?? 0)

    // What the last move actually committed. `transition` is captured at
    // mousedown and never updates, so comparing against it would re-issue the
    // same edit for every mouse event once the drag had moved at all.
    let applied = startDuration

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaPx = edge === 'left' ? startX - moveEvent.clientX : moveEvent.clientX - startX
      const requested = startDuration + (deltaPx * 2) / pixelsPerSecond
      const next = +clampTransitionDuration(requested, leftRoom, rightRoom).toFixed(2)
      if (Math.abs(next - applied) < 0.005) return
      applied = next
      setTransition(cp.leftClip.id, cp.rightClip.id, transition.type, next)
    }
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  if (!transition) {
    return null
  }

  // The transition band on the timeline should straddle the visual junction between the clips.
  // The visual junction is the cut boundary: rightClip.startTime + rightExtend.
  const cutJunction = transition
    ? cp.rightClip.startTime + (transition.rightExtend ?? 0)
    : cp.time
  const duration = transition?.duration ?? Math.max(0.1, cp.overlapEnd - cp.overlapStart)
  const bandWidth = Math.max(16, duration * pixelsPerSecond)
  const bandLeft = Math.max(0, (cutJunction - duration / 2) * pixelsPerSecond)

  return (
    <div
      className={`absolute transition-all ${
        isDropTarget
          ? 'z-[60] ring-4 ring-teal-400 border-2 border-teal-300 bg-teal-500/40 rounded-sm'
          : isGlobalTransitionDragging
            ? 'z-[60] ring-2 ring-teal-400/60 border border-dashed border-teal-300/80'
            : 'z-40'
      }`}
      style={{ left: `${bandLeft}px`, top: `${topPx}px`, width: `${bandWidth}px`, height: `${heightPx}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={event => {
        event.stopPropagation()
        onFocusCut(cp.time)
      }}
      title={`${label} · ${transition.duration.toFixed(2)}s — ${t('transitions.clickToChange')}`}
    >
      <div
        className={`absolute inset-0 rounded-sm border-y-2 transition-colors ${
          isDropTarget
            ? 'border-teal-300 bg-teal-500/40'
            : isHovered || isGlobalTransitionDragging
              ? 'border-teal-400 bg-teal-500/25'
              : 'border-teal-500/50 bg-teal-500/15'
        }`}
      />

      {/* The name only fits on a band wide enough to hold it. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1">
        <span className="truncate rounded bg-zinc-950/80 px-1 text-[9px] font-medium text-teal-300">
          {isDropTarget ? t('transitions.dragToCutHint') : bandWidth > 68 ? `${label} ${transition.duration.toFixed(1)}s` : transition.duration.toFixed(1)}
        </span>
      </div>

      {/* Resize handles */}
      <div
        className="absolute inset-y-0 left-0 z-40 w-2.5 cursor-ew-resize hover:bg-teal-400/50"
        onMouseDown={event => startResize(event, 'left')}
      >
        <div className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-teal-400" />
      </div>
      <div
        className="absolute inset-y-0 right-0 z-40 w-2.5 cursor-ew-resize hover:bg-teal-400/50"
        onMouseDown={event => startResize(event, 'right')}
      >
        <div className="absolute inset-y-0 right-0 w-0.5 rounded-full bg-teal-400" />
      </div>

      {isHovered && (
        <button
          onClick={event => {
            event.stopPropagation()
            removeTransition(transition.id)
          }}
          title={t('transitions.removeTransition')}
          className="absolute -top-2 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-zinc-800 text-zinc-200 shadow hover:bg-red-600 hover:text-white transition-colors"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  )
}
