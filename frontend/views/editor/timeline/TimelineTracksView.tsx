import React, { useCallback, useMemo } from 'react'
import type { TimelineClip, Track, SubtitleClip, Asset, EffectType } from '../../../types/project-model'
import type { ToolType } from '../video-editor-utils'
import { isExternalFileDrag, hasMediaFiles } from '../external-file-drop'
import { trackRowHeight } from '@core/timeline-rows'
import {
  TimelineClipItem,
  SCISSORS_CURSOR,
  TRACK_FWD_ALL_CURSOR,
  TRACK_FWD_ONE_CURSOR,
} from './TimelineClipItem'
import { TimelineSubtitleItem } from './TimelineSubtitleItem'
import { TimelineCutPointItem, type CutPointData } from './TimelineCutPointItem'
import { clipEdgeExtents, visibleClipBounds } from '@core/timeline-cuts'

export interface TimelineTracksViewProps {
  trackContainerRef: React.RefObject<HTMLDivElement>
  trackContentRef: React.RefObject<HTMLDivElement>
  playheadOverlayRef: React.RefObject<HTMLDivElement>
  currentTimeRef: React.MutableRefObject<number>
  pixelsPerSecond: number
  totalDuration: number
  activeTool: ToolType
  bladeShiftHeld: boolean
  orderedTracks: { track: Track; realIndex: number; displayRow: number }[]
  tracks: Track[]
  clips: TimelineClip[]
  subtitles: SubtitleClip[]
  cutPoints: CutPointData[]
  selectedClipIds: Set<string>
  selectedSubtitleId: string | null
  editingSubtitleId: string | null
  draggingClip: { clipId: string } | null
  slipSlideClip: { clipId: string } | null
  resizingClip: { clipId: string; edge: 'left' | 'right' } | null
  snapGuideTime?: number | null
  bladeHoverInfo: { clipId: string; offsetX: number; time: number } | null
  hoveredCutPoint: { leftClipId: string; rightClipId: string; time: number; trackIndex: number } | null
  lassoRect: { startX: number; startY: number; currentX: number; currentY: number } | null
  lassoOriginRef: React.MutableRefObject<{ scrollLeft: number; containerLeft: number; containerTop: number } | null>
  timelineHoverRef: React.MutableRefObject<{ time: number; trackIndex: number } | null>
  assets: Asset[]
  videoTrackHeight: number
  audioTrackHeight: number
  stickerTrackHeight: number
  subtitleTrackHeight: number
  trackTopPx: (trackIndex: number, padding?: number) => number
  getTrackHeight: (trackIndex: number) => number
  handleTimelineScroll: () => void
  handleGeneralTimelineDrop: (e: React.DragEvent) => void
  handleTimelineBgContextMenu: (e: React.MouseEvent) => void
  startSelectionLasso: (clientX: number, clientY: number, shiftKey: boolean) => void
  scrubFromEvent: (clientX: number) => void
  handlePlayheadMouseDown?: (e: React.MouseEvent) => void
  setIsPlaying: (playing: boolean) => void
  setSelectedClipIds: (ids: Set<string>) => void
  setSelectedSubtitleId: (id: string | null) => void
  setEditingSubtitleId: (id: string | null) => void
  handleTrackDrop: (e: React.DragEvent, trackIndex: number) => void
  addSubtitleClip: (trackIndex: number) => void
  importFiles: (files: FileList | File[]) => Promise<Asset[]>
  insertAssetsToTimeline: (params: { assets: Asset[]; trackIndex: number; startTime?: number }) => void
  handleClipMouseDown: (e: React.MouseEvent, clip: TimelineClip) => void
  handleClipContextMenu: (e: React.MouseEvent, clip: TimelineClip) => void
  handleResizeStart: (e: React.MouseEvent, clip: TimelineClip, edge: 'left' | 'right') => void
  onClipDoubleClick: (clip: TimelineClip) => void
  setBladeHoverInfo: (info: { clipId: string; offsetX: number; time: number } | null) => void
  setHoveredCutPoint: (point: { leftClipId: string; rightClipId: string; time: number; trackIndex: number } | null) => void
  addClipEffect: (clipId: string, effectType: EffectType) => void
  getClipPath: (clip: TimelineClip) => string
  getLiveAsset: (clip: TimelineClip) => Asset | null
  getClipResolution: (clip: TimelineClip) => { label: string; displayName: string; color: string } | null
  updateSubtitle: (id: string, patch: Partial<SubtitleClip>) => void
  setTransition: (leftClipId: string, rightClipId: string, type: string, duration: number) => void
  /** Shared entry point for transitions dropped anywhere on a track. */
  applyTransitionAtPoint: (trackIndex: number, time: number, type: string, snapSeconds: number) => boolean
  /** Alt-drop of media onto a clip: replace its media (see TimelineClipItem). */
  onDropReplace: (clipId: string, payload: { assetId?: string; files?: FileList }) => void
  removeTransition: (transitionId: string) => void
  /** Seeks the playhead to a cut, which is how the library knows where to apply. */
  onFocusCut: (time: number) => void
  setClips: (updater: (prev: TimelineClip[]) => TimelineClip[]) => void
}

export const TimelineTracksView: React.FC<TimelineTracksViewProps> = ({
  trackContainerRef,
  trackContentRef,
  playheadOverlayRef,
  currentTimeRef,
  pixelsPerSecond,
  totalDuration,
  activeTool,
  bladeShiftHeld,
  orderedTracks,
  tracks,
  clips,
  subtitles,
  cutPoints,
  selectedClipIds,
  selectedSubtitleId,
  editingSubtitleId,
  draggingClip,
  slipSlideClip,
  resizingClip,
  snapGuideTime,
  bladeHoverInfo,
  hoveredCutPoint,
  lassoRect,
  lassoOriginRef,
  timelineHoverRef,
  assets,
  videoTrackHeight,
  audioTrackHeight,
  stickerTrackHeight,
  subtitleTrackHeight,
  trackTopPx,
  getTrackHeight,
  handleTimelineScroll,
  handleGeneralTimelineDrop,
  handleTimelineBgContextMenu,
  startSelectionLasso,
  scrubFromEvent,
  handlePlayheadMouseDown,
  setIsPlaying,
  setSelectedClipIds,
  setSelectedSubtitleId,
  setEditingSubtitleId,
  handleTrackDrop,
  addSubtitleClip,
  importFiles,
  insertAssetsToTimeline,
  handleClipMouseDown,
  handleClipContextMenu,
  handleResizeStart,
  onClipDoubleClick,
  setBladeHoverInfo,
  setHoveredCutPoint,
  addClipEffect,
  getClipPath,
  getLiveAsset,
  getClipResolution,
  updateSubtitle,
  setTransition,
  applyTransitionAtPoint,
  onDropReplace,
  removeTransition,
  onFocusCut,
}) => {
  /* Clips are drawn without the seconds they lent to a transition, so growing
     or shrinking a band re-times the effect on screen and leaves every clip
     edge exactly where the user put it. */
  const clipExtents = useMemo(() => clipEdgeExtents(cutPoints), [cutPoints])

  const rowHeights = useMemo(() => ({
    video: videoTrackHeight,
    audio: audioTrackHeight,
    subtitle: subtitleTrackHeight,
    sticker: stickerTrackHeight,
  }), [videoTrackHeight, audioTrackHeight, subtitleTrackHeight, stickerTrackHeight])

  const localHandlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setIsPlaying(false)
    scrubFromEvent(e.clientX)

    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault()
      scrubFromEvent(ev.clientX)
    }

    const onUp = () => {
      document.body.style.cursor = prevCursor
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [scrubFromEvent, setIsPlaying])

  const onPlayheadMouseDown = handlePlayheadMouseDown || localHandlePlayheadMouseDown

  return (
    <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
      {/* Full-height playhead line with interactive draggable scrub handle */}
      <div
        ref={playheadOverlayRef}
        className="absolute -top-[2px] bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
        style={{ left: `${Math.max(0, currentTimeRef.current * pixelsPerSecond - (trackContainerRef.current?.scrollLeft || 0))}px` }}
      >
        {/* Grab hit area: 16px wide, centered on this 2px line (-left-[7px] so 7px + 2px + 7px = 16px) */}
        <div
          className="absolute top-0 bottom-0 w-4 -left-[7px] cursor-ew-resize pointer-events-auto"
          onMouseDown={onPlayheadMouseDown}
        />
      </div>
      {/* Spacer matching the add-track button bar height */}
      <div className="flex-shrink-0 h-7 border-b border-zinc-700/50" />

      <div
        ref={trackContainerRef}
        className="flex flex-1 flex-col overflow-auto select-none"
        onScroll={handleTimelineScroll}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase())
          if (isExternalFileDrag(e) || types.includes('assetid') || types.includes('assetids') || types.includes('asset') || types.includes('timeline') || types.some(t => t.includes('transition') || t === 'text/plain')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={handleGeneralTimelineDrop}
        onMouseMove={(e) => {
          const content = trackContentRef.current
          if (!content) return
          const rect = content.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top

          let trackIndex = -1
          let accY = 0
          for (const entry of orderedTracks) {
            const th = trackRowHeight(entry.track, rowHeights)
            if (y >= accY && y < accY + th) {
              trackIndex = entry.realIndex
              break
            }
            accY += th
          }
          timelineHoverRef.current = trackIndex < 0
            ? null
            : { time: Math.max(0, x / pixelsPerSecond), trackIndex }
        }}
        onMouseLeave={() => { timelineHoverRef.current = null }}
        onMouseDown={(e) => {
          // Clicks that land on the scroll container itself (the empty area below
          // the last track or past the end of the timeline) still move the playhead.
          if (e.target !== e.currentTarget) return
          if (e.button !== 0) return
          const container = e.currentTarget
          const rect = container.getBoundingClientRect()
          // Ignore clicks on the native scrollbars.
          if (e.clientX - rect.left > container.clientWidth) return
          if (e.clientY - rect.top > container.clientHeight) return
          if (activeTool !== 'select') return
          setIsPlaying(false)
          scrubFromEvent(e.clientX)
          startSelectionLasso(e.clientX, e.clientY, e.shiftKey)
        }}
      >
        <div
          ref={trackContentRef}
          style={{
            minWidth: `${totalDuration * pixelsPerSecond}px`,
            ...(activeTool === 'blade' ? { cursor: SCISSORS_CURSOR }
              : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR }
              : {}),
          }}
          className="relative my-auto"
          onDragOver={(e) => {
            const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase())
            if (isExternalFileDrag(e) || types.includes('assetid') || types.includes('assetids') || types.includes('asset') || types.includes('timeline') || types.some(t => t.includes('transition') || t.includes('filter') || t === 'text/plain')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            e.stopPropagation()
            handleGeneralTimelineDrop(e)
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-track-bg]')) {
              handleTimelineBgContextMenu(e)
            }
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-track-bg]')) {
              if (activeTool === 'trackForward') {
                setSelectedSubtitleId(null)
                setEditingSubtitleId(null)
                const container = trackContainerRef.current
                if (container) {
                  const rect = container.getBoundingClientRect()
                  const scrollLeft = container.scrollLeft
                  const clickX = e.clientX - rect.left + scrollLeft
                  const clickY = e.clientY - (trackContentRef.current?.getBoundingClientRect().top ?? rect.top)
                  const clickTime = clickX / pixelsPerSecond

                  let clickedRealTrackIndex = -1
                  let accY = 0
                  for (const entry of orderedTracks) {
                    const th = trackRowHeight(entry.track, rowHeights)
                    if (clickY >= accY && clickY < accY + th) {
                      clickedRealTrackIndex = entry.realIndex
                      break
                    }
                    accY += th
                  }

                  const forwardClips = clips.filter(c => {
                    if (e.shiftKey) {
                      return c.trackIndex === clickedRealTrackIndex && c.startTime >= clickTime - 0.01
                    } else {
                      return c.startTime >= clickTime - 0.01
                    }
                  })
                  setSelectedClipIds(new Set(forwardClips.map(c => c.id)))
                }
              } else if (activeTool === 'select') {
                setIsPlaying(false)
                scrubFromEvent(e.clientX)
                startSelectionLasso(e.clientX, e.clientY, e.shiftKey)
              }
            }
          }}
        >
          {/* Track background lanes */}
          {orderedTracks.map(({ track, realIndex }) => (
            <React.Fragment key={track.id}>
              <div
                data-track-bg="true"
                className={`border-b border-zinc-800/60 bg-zinc-950 ${track.locked ? 'opacity-50' : ''}`}
                style={{ height: trackRowHeight(track, rowHeights) }}
                onDrop={(e) => {
                  e.stopPropagation()
                  if (track.type === 'subtitle') {
                    e.preventDefault()
                    return
                  }
                  if (isExternalFileDrag(e)) {
                    e.preventDefault()
                    const files = e.dataTransfer.files
                    if (!hasMediaFiles(files)) return
                    const content = trackContentRef.current
                    const dropX = content ? e.clientX - content.getBoundingClientRect().left : 0
                    const dropTime = Math.max(0, dropX / pixelsPerSecond)
                    void importFiles(files).then(imported => {
                      if (imported.length > 0) {
                        insertAssetsToTimeline({
                          assets: imported,
                          trackIndex: realIndex,
                          startTime: dropTime,
                        })
                      }
                    })
                    return
                  }
                  handleTrackDrop(e, realIndex)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDoubleClick={() => {
                  if (track.type === 'subtitle' && !track.locked) {
                    addSubtitleClip(realIndex)
                  }
                }}
              />
            </React.Fragment>
          ))}

          {/* Lasso selection rectangle */}
          {lassoRect && lassoOriginRef.current && (() => {
            const origin = lassoOriginRef.current!
            const container = trackContainerRef.current
            if (!container) return null
            const scrollLeft = container.scrollLeft
            const scrollTop = container.scrollTop
            const x1 = Math.min(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
            const x2 = Math.max(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
            const y1 = Math.min(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
            const y2 = Math.max(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
            return (
              <div
                className="absolute border border-blue-400 bg-blue-500/10 z-30 pointer-events-none rounded-sm"
                style={{
                  left: x1,
                  top: y1,
                  width: x2 - x1,
                  height: y2 - y1,
                }}
              />
            )
          })()}

          {/* Vertical magnetic snap guide line */}
          {snapGuideTime !== null && snapGuideTime !== undefined && (
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 z-30 pointer-events-none shadow-[0_0_10px_rgba(56,189,248,0.9)]"
              style={{ left: `${snapGuideTime * pixelsPerSecond}px` }}
            >
              <div className="sticky top-0 -left-6 transform -translate-x-1/2 px-1.5 py-0.5 bg-cyan-500 text-zinc-950 text-[9px] font-mono font-bold rounded-b shadow whitespace-nowrap">
                {snapGuideTime.toFixed(2)}s
              </div>
            </div>
          )}

          {/* Clips */}
          {clips.map(clip => {
            const bounds = visibleClipBounds(clip, clipExtents.get(clip.id))
            return (
            <TimelineClipItem
              key={clip.id}
              clip={clip}
              displayStartTime={bounds.startTime}
              displayDuration={bounds.duration}
              assets={assets}
              selectedClipIds={selectedClipIds}
              activeTool={activeTool}
              bladeShiftHeld={bladeShiftHeld}
              isDragging={draggingClip?.clipId === clip.id || Boolean(draggingClip && selectedClipIds.has(clip.id))}
              isSlipSlide={slipSlideClip?.clipId === clip.id}
              resizingClip={resizingClip}
              bladeHoverInfo={bladeHoverInfo}
              pixelsPerSecond={pixelsPerSecond}
              trackTopPx={trackTopPx}
              getTrackHeight={getTrackHeight}
              handleClipMouseDown={handleClipMouseDown}
              handleClipContextMenu={handleClipContextMenu}
              handleResizeStart={handleResizeStart}
              onDoubleClick={() => onClipDoubleClick(clip)}
              setBladeHoverInfo={setBladeHoverInfo}
              addClipEffect={addClipEffect}
              getClipPath={getClipPath}
              getLiveAsset={getLiveAsset}
              getClipResolution={getClipResolution}
              applyTransitionAtPoint={applyTransitionAtPoint}
              onDropReplace={onDropReplace}
            />
            )
          })}

          {/* Subtitle clips on subtitle tracks */}
          {subtitles.map(sub => (
            <TimelineSubtitleItem
              key={sub.id}
              sub={sub}
              track={tracks[sub.trackIndex]}
              isSelected={selectedSubtitleId === sub.id}
              isEditing={editingSubtitleId === sub.id}
              pixelsPerSecond={pixelsPerSecond}
              trackTopPx={trackTopPx}
              getTrackHeight={getTrackHeight}
              onSelect={() => setSelectedSubtitleId(sub.id)}
              onStartEdit={() => setEditingSubtitleId(sub.id)}
              onFinishEdit={(newText) => {
                updateSubtitle(sub.id, { text: newText })
                setEditingSubtitleId(null)
              }}
              onCancelEdit={() => setEditingSubtitleId(null)}
              updateSubtitle={updateSubtitle}
            />
          ))}

          {/* Cut point indicators for active transitions */}
          {cutPoints.filter((cp) => Boolean(cp.transition)).map((cp) => (
            <TimelineCutPointItem
              key={`cut-${cp.leftClip.id}-${cp.rightClip.id}`}
              cp={cp}
              isHovered={hoveredCutPoint?.leftClipId === cp.leftClip.id && hoveredCutPoint?.rightClipId === cp.rightClip.id}
              pixelsPerSecond={pixelsPerSecond}
              trackTopPx={trackTopPx}
              getTrackHeight={getTrackHeight}
              onMouseEnter={() => setHoveredCutPoint({
                leftClipId: cp.leftClip.id,
                rightClipId: cp.rightClip.id,
                time: cp.time,
                trackIndex: cp.trackIndex,
              })}
              onMouseLeave={() => setHoveredCutPoint(null)}
              setTransition={setTransition}
              applyTransitionAtPoint={applyTransitionAtPoint}
              removeTransition={removeTransition}
              onFocusCut={onFocusCut}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
