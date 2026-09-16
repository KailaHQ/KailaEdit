import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { TimelineClip, KeyframeProperty, KeyframeEasing, KeyframePoint } from '../../../types/project-model'
import { useEditorStore, useEditorActions } from '../editor-store'
import { selectSelectedKeyframe } from '../editor-selectors'

export interface TimelineKeyframeRowProps {
  clip: TimelineClip
  pixelsPerSecond: number
}

interface KeyframeGroup {
  id: string
  t: number
  points: Array<{
    property: KeyframeProperty
    point: KeyframePoint
  }>
}

interface ContextMenuState {
  x: number
  y: number
  group: KeyframeGroup
}

interface EasingOption {
  value: KeyframeEasing
  label: string
  desc: string
  path: string
}

const EASING_OPTIONS: EasingOption[] = [
  {
    value: 'linear',
    label: 'Linear',
    desc: 'Constant speed',
    path: 'M 2 14 L 22 2',
  },
  {
    value: 'ease-in',
    label: 'Ease In',
    desc: 'Slow start, fast end',
    path: 'M 2 14 Q 16 14 22 2',
  },
  {
    value: 'ease-out',
    label: 'Ease Out',
    desc: 'Fast start, soft stop',
    path: 'M 2 14 Q 8 2 22 2',
  },
  {
    value: 'ease-in-out',
    label: 'Ease In-Out',
    desc: 'Smooth S-curve',
    path: 'M 2 14 C 12 14 12 2 22 2',
  },
  {
    value: 'hold',
    label: 'Hold',
    desc: 'Instant step at next point',
    path: 'M 2 14 H 21 V 2 H 22',
  },
]

export const TimelineKeyframeRow: React.FC<TimelineKeyframeRowProps> = ({
  clip,
  pixelsPerSecond,
}) => {
  const selectedKeyframe = useEditorStore(selectSelectedKeyframe)
  const {
    moveKeyframeGroup,
    setKeyframeEasing,
    removeKeyframeAt,
    setCurrentTime,
    setSelectedKeyframe,
    clearSelectedKeyframe,
  } = useEditorActions()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Group keyframe points by time (within 0.04s)
  const keyframeGroups: KeyframeGroup[] = []
  if (clip.keyframes) {
    for (const track of clip.keyframes) {
      for (const pt of track.points) {
        const existing = keyframeGroups.find(g => Math.abs(g.t - pt.t) <= 0.04)
        if (existing) {
          existing.points.push({ property: track.property, point: pt })
        } else {
          keyframeGroups.push({
            id: `${track.property}-${pt.t}`,
            t: pt.t,
            points: [{ property: track.property, point: pt }],
          })
        }
      }
    }
  }

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handleOutside, true)
    return () => window.removeEventListener('mousedown', handleOutside, true)
  }, [contextMenu])

  // Pointer drag handler: provides smooth dragging with live playhead scrub and time badge
  const handleDiamondPointerDown = useCallback(
    (e: React.PointerEvent, group: KeyframeGroup) => {
      if (e.button !== 0) return // Only primary click
      e.stopPropagation()
      e.preventDefault()

      const handleEl = e.currentTarget as HTMLElement
      const badgeEl = handleEl.querySelector('[data-badge]') as HTMLElement | null
      const startX = e.clientX
      const startT = group.t
      const clipDuration = clip.duration

      try {
        handleEl.setPointerCapture(e.pointerId)
      } catch {
        // Fallback if pointer capture fails
      }

      // Immediately select this keyframe when clicked
      setSelectedKeyframe({ clipId: clip.id, t: group.t })

      let isDragging = false

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (Math.abs(deltaX) > 2) {
          isDragging = true
        }

        const newT = Math.max(0, Math.min(clipDuration, startT + deltaX / pixelsPerSecond))
        const actualDeltaPx = (newT - startT) * pixelsPerSecond

        handleEl.style.transform = `translate3d(${actualDeltaPx}px, 0, 0)`
        handleEl.style.zIndex = '30'

        if (badgeEl) {
          badgeEl.textContent = `${newT.toFixed(2)}s`
          badgeEl.style.display = 'block'
        }

        // Live playhead preview scrub while dragging
        setCurrentTime(clip.startTime + newT)
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        try {
          handleEl.releasePointerCapture(upEvent.pointerId)
        } catch {
          // Ignore
        }

        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)

        handleEl.style.transform = ''
        handleEl.style.zIndex = ''
        if (badgeEl) {
          badgeEl.style.display = 'none'
        }

        const finalDeltaX = upEvent.clientX - startX
        const finalT = Math.max(0, Math.min(clipDuration, startT + finalDeltaX / pixelsPerSecond))

        if (isDragging && Math.abs(finalT - startT) > 0.005) {
          // Atomically move all keyframed properties at this timestamp
          moveKeyframeGroup(clip.id, startT, finalT)
        } else {
          // Plain click: seek playhead to this keyframe
          setCurrentTime(clip.startTime + group.t)
          setSelectedKeyframe({ clipId: clip.id, t: group.t })
        }
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [clip.duration, clip.id, clip.startTime, moveKeyframeGroup, pixelsPerSecond, setCurrentTime, setSelectedKeyframe],
  )

  const handleContextMenu = (e: React.MouseEvent, group: KeyframeGroup) => {
    e.stopPropagation()
    e.preventDefault()
    setSelectedKeyframe({ clipId: clip.id, t: group.t })
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      group,
    })
  }

  // If no keyframes exist on this clip, do not render any bottom bar or clutter
  if (!clip.keyframes || clip.keyframes.length === 0) {
    return null
  }

  return (
    <>
      {/* Centered Keyframe Lane across the media */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 z-20 flex items-center select-none pointer-events-none"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {/* Subtle center guide line along the media */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/20 pointer-events-none" />

        <div className="relative w-full h-full">
          {keyframeGroups.map(group => {
            const leftPx = group.t * pixelsPerSecond
            const propsLabel = group.points
              .map(p => `${p.property}: ${Math.round(p.point.value * 100) / 100} (${p.point.easing})`)
              .join('\n')
            const tooltip = `${propsLabel}\nat ${group.t.toFixed(2)}s (drag to move, click to seek, right-click for curves, Del to delete)`

            const isSelected =
              selectedKeyframe?.clipId === clip.id &&
              Math.abs(selectedKeyframe.t - group.t) <= 0.04

            return (
              <div
                key={group.id}
                style={{ left: `${leftPx}px` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
              >
                <div
                  title={tooltip}
                  onPointerDown={e => handleDiamondPointerDown(e, group)}
                  onContextMenu={e => handleContextMenu(e, group)}
                  className="w-6 h-6 flex items-center justify-center cursor-ew-resize active:cursor-grabbing select-none group/kf relative"
                >
                  {/* Real-time dragging timestamp badge */}
                  <div
                    data-badge
                    className="hidden absolute -top-7 px-1.5 py-0.5 bg-zinc-950/95 text-cyan-300 text-[10px] font-mono font-bold rounded border border-cyan-400/80 shadow-xl whitespace-nowrap pointer-events-none z-50 -translate-x-1/2 left-1/2"
                  />

                  <div
                    className={`w-3.5 h-3.5 rotate-45 rounded-[1px] transition-all duration-150 pointer-events-none ${
                      isSelected
                        ? 'bg-cyan-400 border border-white ring-2 ring-cyan-400/70 shadow-[0_0_8px_rgba(34,211,238,0.8)] scale-110'
                        : 'bg-amber-400 border border-amber-200 shadow-sm hover:bg-amber-300 hover:scale-110'
                    }`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating Context Menu for Curves / Easing and Deletion */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: `${Math.min(window.innerWidth - 220, contextMenu.x)}px`,
            top: `${Math.min(window.innerHeight - 260, contextMenu.y)}px`,
            zIndex: 9999,
          }}
          className="w-[210px] bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-2xl py-1.5 text-xs text-zinc-200 backdrop-blur-md"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] font-semibold text-zinc-400 border-b border-zinc-800 uppercase tracking-wider flex items-center justify-between">
            <span>Motion Curve</span>
            <span className="text-zinc-500 font-mono">{contextMenu.group.t.toFixed(2)}s</span>
          </div>

          <div className="py-1 space-y-0.5">
            {EASING_OPTIONS.map(opt => {
              const currentEasing = contextMenu.group.points[0]?.point.easing
              const isActive = currentEasing === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2.5 hover:bg-zinc-800/80 transition-colors ${
                    isActive ? 'bg-amber-500/10 text-amber-400 font-medium' : 'text-zinc-300'
                  }`}
                  onClick={() => {
                    for (const item of contextMenu.group.points) {
                      setKeyframeEasing(clip.id, item.property, item.point.t, opt.value)
                    }
                    setContextMenu(null)
                  }}
                >
                  {/* Visual SVG mini graph */}
                  <div className={`w-6 h-5 rounded flex items-center justify-center p-0.5 border ${
                    isActive
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                      : 'bg-black/50 border-zinc-800 text-zinc-400'
                  }`}>
                    <svg width="24" height="16" viewBox="0 0 24 16" className="w-full h-full">
                      <path
                        d={opt.path}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs truncate">{opt.label}</span>
                      {isActive && <span className="text-amber-400 text-xs">✓</span>}
                    </div>
                    <p className="text-[9px] text-zinc-500 truncate leading-none mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="my-1 border-t border-zinc-800" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors flex items-center justify-between"
            onClick={() => {
              for (const item of contextMenu.group.points) {
                removeKeyframeAt(clip.id, item.property, item.point.t)
              }
              clearSelectedKeyframe()
              setContextMenu(null)
            }}
          >
            <span>Delete Keyframe</span>
            <span className="text-[10px] text-zinc-500 font-mono">Del</span>
          </button>
        </div>
      )}
    </>
  )
}
