import React, { useMemo, useRef, useState } from 'react'
import { Bookmark, Plus } from 'lucide-react'
import { formatTime, formatRulerTime, parseTime } from '../video-editor-utils'
import { useSettings } from '../../../contexts/SettingsContext'
import { useRenderCacheStore } from '../render-cache-store'
import { useEditorStore, useEditorActions } from '../editor-store'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectMarkers } from '../editor-selectors'
import { MarkerEditModal } from './MarkerEditModal'
import type { TimelineMarker } from '../../../types/project-model'

export interface TimelineRulerProps {
  totalDuration: number
  pixelsPerSecond: number
  isPlaying: boolean
  playbackTimeRef: React.MutableRefObject<number>
  currentTimeRef: React.MutableRefObject<number>
  setCurrentTime: (time: number) => void
  timelineRef: React.RefObject<HTMLDivElement>
  rulerScrollRef: React.RefObject<HTMLDivElement>
  playheadRulerRef: React.RefObject<HTMLDivElement>
  timelineTimecodeRef: React.RefObject<HTMLSpanElement>
  handleRulerMouseDown: (e: React.MouseEvent) => void
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
  totalDuration,
  pixelsPerSecond,
  isPlaying,
  playbackTimeRef,
  currentTimeRef,
  setCurrentTime,
  timelineRef,
  rulerScrollRef,
  playheadRulerRef,
  timelineTimecodeRef,
  handleRulerMouseDown,
}) => {
  const { settings } = useSettings()
  const timecodeFormat = settings.timecodeFormat ?? 'timecode'
  const fps = settings.defaultFps ?? 24
  const cacheSegments = useRenderCacheStore((state) => state.segments)

  const markers = useEditorStore(selectMarkers)
  const actions = useEditorActions()
  const { t } = useTranslation()

  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  const [editingMarker, setEditingMarker] = useState<TimelineMarker | null>(null)
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null)
  const [dragPreviewTime, setDragPreviewTime] = useState<number | null>(null)

  const rulerInterval = useMemo(() => {
    const minLabelSpacing = 80
    const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    for (const interval of intervals) {
      if (interval * pixelsPerSecond >= minLabelSpacing) return interval
    }
    return 600
  }, [pixelsPerSecond])

  const rulerSubInterval = useMemo(() => {
    if (rulerInterval <= 1) return 0.5
    if (rulerInterval <= 5) return 1
    if (rulerInterval <= 15) return 5
    if (rulerInterval <= 60) return 10
    if (rulerInterval <= 300) return 60
    return 60
  }, [rulerInterval])

  const handleMarkerMouseDown = (e: React.MouseEvent, marker: TimelineMarker) => {
    e.stopPropagation()
    if (e.button !== 0) return

    const startX = e.clientX
    const initialTime = marker.time
    let hasMoved = false
    let currentDragTime = initialTime

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaPx = moveEvent.clientX - startX
      if (Math.abs(deltaPx) > 3) {
        hasMoved = true
        setDraggingMarkerId(marker.id)
      }
      if (hasMoved) {
        const newTime = Math.max(0, Math.min(totalDuration, initialTime + deltaPx / pixelsPerSecond))
        currentDragTime = Math.round(newTime * 1000) / 1000
        setDragPreviewTime(currentDragTime)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      if (hasMoved) {
        actions.updateMarker(marker.id, { time: currentDragTime })
        setDraggingMarkerId(null)
        setDragPreviewTime(null)
      } else {
        // Single click: seek to marker time
        setCurrentTime(marker.time)
        playbackTimeRef.current = marker.time
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleMarkerDoubleClick = (e: React.MouseEvent, marker: TimelineMarker) => {
    e.stopPropagation()
    setEditingMarker(marker)
  }

  const handleMarkerLaneClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickedTime = Math.max(0, Math.min(totalDuration, clickX / pixelsPerSecond))
    setCurrentTime(clickedTime)
    playbackTimeRef.current = clickedTime
  }

  const handleMarkerLaneDoubleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickedTime = Math.max(0, Math.min(totalDuration, clickX / pixelsPerSecond))
    actions.addMarker({ time: Math.round(clickedTime * 1000) / 1000 })
  }

  return (
    <>
      <div className="flex flex-shrink-0">
        {/* Left column (w-32) - Track header & timecode */}
        <div className="w-32 flex-shrink-0 flex flex-col border-r border-zinc-800">
          {/* Timecode box */}
          <div className="h-6 border-b border-zinc-800 bg-zinc-900 flex items-center justify-center">
            <div
              className="w-full h-full flex items-center justify-center cursor-text"
              onClick={() => {
                if (!editingTimecode) {
                  setTimecodeInput(formatTime(isPlaying ? playbackTimeRef.current : currentTimeRef.current, fps, timecodeFormat))
                  setEditingTimecode(true)
                  requestAnimationFrame(() => timecodeInputRef.current?.select())
                }
              }}
            >
              {editingTimecode ? (
                <input
                  ref={timecodeInputRef}
                  autoFocus
                  className="w-full h-full bg-zinc-950 text-amber-400 text-[11px] font-mono font-medium text-center outline-none border-none tabular-nums tracking-tight px-1"
                  value={timecodeInput}
                  onChange={e => setTimecodeInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const t = parseTime(timecodeInput, fps, timecodeFormat)
                      if (t !== null) {
                        const clamped = Math.max(0, Math.min(totalDuration, t))
                        setCurrentTime(clamped)
                        playbackTimeRef.current = clamped
                      }
                      setEditingTimecode(false)
                    } else if (e.key === 'Escape') {
                      setEditingTimecode(false)
                    }
                    e.stopPropagation()
                  }}
                  onClick={e => e.stopPropagation()}
                  onBlur={() => setEditingTimecode(false)}
                />
              ) : (
                <span
                  ref={timelineTimecodeRef}
                  className="text-[11px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none"
                >
                  {formatTime(currentTimeRef.current, fps, timecodeFormat)}
                </span>
              )}
            </div>
          </div>

          {/* Markers track header */}
          <div className="h-5 border-b border-zinc-800 bg-zinc-900/90 flex items-center justify-between px-2 text-[10px] text-zinc-400 font-medium select-none">
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3 h-3 text-amber-400" />
              <span>Markers</span>
              {markers.length > 0 && (
                <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1 rounded-full font-mono">
                  {markers.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => actions.addMarker({ time: isPlaying ? playbackTimeRef.current : currentTimeRef.current })}
              className="p-0.5 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
              title={t('timeline.markers.addAtPlayhead')}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Timeline Cover gutter on ruler (w-[64px]) */}
        <div className="w-[64px] flex-shrink-0 flex flex-col select-none pointer-events-none">
          <div className="h-6 bg-zinc-900 border-b border-zinc-800" />
          <div className="h-5 bg-zinc-900/60 border-b border-zinc-800/80" />
        </div>

        {/* Ruler ticks, markers lane & playhead */}
        <div ref={rulerScrollRef} className="flex-1 overflow-hidden">
          <div
            ref={timelineRef}
            style={{ minWidth: `${totalDuration * pixelsPerSecond}px` }}
            className="flex flex-col select-none relative"
          >
            {/* Row 1: Ruler ticks & render cache */}
            <div
              className="h-6 bg-zinc-900 border-b border-zinc-800 relative select-none cursor-pointer"
              onMouseDown={handleRulerMouseDown}
            >
              {(() => {
                const ticks: React.ReactNode[] = []
                const end = totalDuration + rulerInterval
                for (let t = 0; t < end; t = +(t + rulerSubInterval).toFixed(4)) {
                  const isMajor = Math.abs(t % rulerInterval) < 0.001 || Math.abs(t % rulerInterval - rulerInterval) < 0.001
                  const leftPx = t * pixelsPerSecond
                  ticks.push(
                    <div
                      key={t}
                      className="absolute top-0 bottom-0"
                      style={{ left: `${leftPx}px` }}
                    >
                      <div className={`h-full border-l ${isMajor ? 'border-zinc-700' : 'border-zinc-800'}`} />
                      {isMajor && (
                        <span className="absolute left-1 top-1 text-[10px] font-mono text-zinc-400 whitespace-nowrap leading-none select-none pointer-events-none">
                          {formatRulerTime(t, rulerInterval < 1, fps, timecodeFormat)}
                        </span>
                      )}
                    </div>
                  )
                }
                return ticks
              })()}

              {/* Render cache indicator bar */}
              {cacheSegments.map((seg) => {
                const leftPx = seg.startTime * pixelsPerSecond
                const widthPx = Math.max(2, seg.duration * pixelsPerSecond)
                return (
                  <div
                    key={seg.id || seg.hash}
                    className={`absolute bottom-0 h-[2.5px] rounded-sm z-20 pointer-events-auto transition-colors ${
                      seg.ready
                        ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                        : seg.rendering
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-amber-500/70'
                    }`}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                    title={`${t('timeline.renderCache.title')}: ${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s (${
                      seg.ready ? t('timeline.renderCache.ready') : seg.rendering ? t('timeline.renderCache.rendering') : t('timeline.renderCache.needed')
                    })`}
                  />
                )
              })}
            </div>

            {/* Row 2: Markers lane */}
            <div
              className="h-5 bg-zinc-900/40 border-b border-zinc-800 relative cursor-pointer group"
              onClick={handleMarkerLaneClick}
              onDoubleClick={handleMarkerLaneDoubleClick}
              title={t('timeline.markers.laneTooltip')}
            >
              {markers.map((m) => {
                const isDragging = draggingMarkerId === m.id
                const displayTime = isDragging && dragPreviewTime !== null ? dragPreviewTime : m.time
                const leftPx = displayTime * pixelsPerSecond

                return (
                  <div
                    key={m.id}
                    className={`absolute top-0.5 -translate-x-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium text-white shadow transition-transform ${
                      isDragging
                        ? 'z-40 scale-105 cursor-grabbing ring-2 ring-white shadow-lg'
                        : 'z-20 cursor-grab hover:scale-105 hover:z-30'
                    }`}
                    style={{
                      left: `${leftPx}px`,
                      backgroundColor: m.color || '#3b82f6',
                    }}
                    onMouseDown={(e) => handleMarkerMouseDown(e, m)}
                    onDoubleClick={(e) => handleMarkerDoubleClick(e, m)}
                    title={`${m.label || t('timeline.markers.defaultLabel')} (${formatTime(displayTime, fps, timecodeFormat)})\n${t('timeline.markers.itemTooltip')}`}
                  >
                    <Bookmark className="w-2.5 h-2.5 fill-current flex-shrink-0" />
                    <span className="truncate max-w-[80px] select-none pointer-events-none">
                      {m.label || 'Marker'}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Playhead pointer on ruler (spans both ticks and marker lane) */}
            <div
              ref={playheadRulerRef}
              className="absolute top-0 -bottom-[2px] w-0.5 bg-red-500 z-30 pointer-events-none"
              style={{ left: `${currentTimeRef.current * pixelsPerSecond}px` }}
            >
              {/* Playhead knob: a rounded tab on the ruler, tapering into the line */}
              <div
                className="absolute top-0 -left-[6px] w-[14px] h-[18px] cursor-ew-resize pointer-events-auto select-none"
                onMouseDown={handleRulerMouseDown}
                title={t('timeline.ruler.scrubTooltip')}
              >
                <svg
                  width="14"
                  height="18"
                  viewBox="0 0 14 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 2C0 0.89543 0.89543 0 2 0H12C13.1046 0 14 0.89543 14 2V11L7 18L0 11V2Z"
                    fill="#ef4444"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Marker edit modal */}
      <MarkerEditModal
        marker={editingMarker}
        isOpen={Boolean(editingMarker)}
        onClose={() => setEditingMarker(null)}
        onSave={(id, patch) => actions.updateMarker(id, patch)}
        onDelete={(id) => actions.deleteMarker(id)}
        fps={fps}
        timecodeFormat={timecodeFormat}
      />
    </>
  )
}
