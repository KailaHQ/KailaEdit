import React, { useState } from 'react'
import {
  GripVertical,
  Layers,
  Type,
  Music, Link2,
} from 'lucide-react'
import { ClipWaveform } from '../../../components/AudioWaveform'
import type { TimelineClip, Asset, EffectType } from '../../../types/project-model'
import { pathToFileUrl } from '../../../lib/file-url'
import { type ToolType, getColorLabel } from '../video-editor-utils'
import { useEditorActions } from '../editor-store'
import { getFilterDefinition } from '@core/filters'
import { getAudioFadeDurations, hasKeyframesForProperty } from '@core/keyframes'
import { TimelineKeyframeRow } from './TimelineKeyframeRow'
import { TimelineAudioEnvelope } from './TimelineAudioEnvelope'
import { ClipMatteProgress } from './ClipMatteProgress'

// Custom scissors cursor SVG for the blade tool
const SCISSORS_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='6' cy='6' r='3'/><path d='M8.12 8.12 12 12'/><path d='M20 4 8.12 15.88'/><circle cx='6' cy='18' r='3'/><path d='M14.8 14.8 20 20'/></svg>`
export const SCISSORS_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SCISSORS_CURSOR_SVG)}") 12 12, crosshair`

// Track Select Forward cursors
const TRACK_FWD_ALL_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='28' viewBox='0 0 24 28' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 1l5 5-5 5'/><path d='M8 16l5 5-5 5'/></svg>`
export const TRACK_FWD_ALL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ALL_SVG)}") 12 12, e-resize`
const TRACK_FWD_ONE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 6l6 6-6 6'/></svg>`
export const TRACK_FWD_ONE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ONE_SVG)}") 12 12, e-resize`

export interface TimelineClipItemProps {
  clip: TimelineClip
  assets: Asset[]
  selectedClipIds: Set<string>
  activeTool: ToolType
  bladeShiftHeld: boolean
  isDragging: boolean
  isSlipSlide: boolean
  resizingClip: { clipId: string; edge: 'left' | 'right' } | null
  bladeHoverInfo: { clipId: string; offsetX: number; time: number } | null
  pixelsPerSecond: number
  /**
   * Where the clip is drawn, which is not always where it plays: a clip that
   * bought a transition with its trimmed-off media plays into the overlap, and
   * showing that literally makes both clips appear to stretch every time the
   * band is re-timed. Drawn at these bounds instead, the visible edges are the
   * ones the user placed. Defaults to the clip's own bounds.
   */
  displayStartTime?: number
  displayDuration?: number
  trackTopPx: (trackIndex: number, padding?: number) => number
  getTrackHeight: (trackIndex: number) => number
  handleClipMouseDown: (e: React.MouseEvent, clip: TimelineClip) => void
  handleClipContextMenu: (e: React.MouseEvent, clip: TimelineClip) => void
  handleResizeStart: (e: React.MouseEvent, clip: TimelineClip, edge: 'left' | 'right') => void
  onDoubleClick: () => void
  setBladeHoverInfo: (info: { clipId: string; offsetX: number; time: number } | null) => void
  addClipEffect: (clipId: string, effectType: EffectType) => void
  getClipPath: (clip: TimelineClip) => string
  getLiveAsset: (clip: TimelineClip) => Asset | null
  getClipResolution: (clip: TimelineClip) => { label: string; displayName: string; color: string } | null
  /**
   * Place a transition at a point on this clip's track. One shared funnel with
   * the track lane and the cut marker, so a drop on an overlay track — where the
   * clips rarely touch exactly — behaves the same as one on the main track.
   */
  applyTransitionAtPoint?: (trackIndex: number, time: number, type: string, snapSeconds: number) => boolean
}

export const TimelineClipItem: React.FC<TimelineClipItemProps> = ({
  clip,
  assets,
  selectedClipIds,
  activeTool,
  bladeShiftHeld,
  isDragging,
  isSlipSlide,
  resizingClip,
  bladeHoverInfo,
  pixelsPerSecond,
  displayStartTime,
  displayDuration,
  trackTopPx,
  getTrackHeight,
  handleClipMouseDown,
  handleClipContextMenu,
  handleResizeStart,
  onDoubleClick,
  setBladeHoverInfo,
  addClipEffect,
  getClipPath,
  getLiveAsset,
  getClipResolution,
  applyTransitionAtPoint,
}) => {
  const drawnStart = displayStartTime ?? clip.startTime
  const drawnDuration = displayDuration ?? clip.duration
  const liveAsset = clip.assetId ? assets.find(a => a.id === clip.assetId) : null
  const clipColor = getColorLabel(clip.colorLabel || liveAsset?.colorLabel || clip.asset?.colorLabel)
  const { setClipFilter, setAudioFade } = useEditorActions()

  const hasAudio = clip.type === 'audio' || (clip.type === 'video' && !clip.muted)
  const [dragFade, setDragFade] = useState<{ type: 'in' | 'out'; currentSec: number } | null>(null)
  const clipFades = hasAudio ? getAudioFadeDurations(clip) : { fadeIn: 0, fadeOut: 0 }
  const effectiveFadeIn = dragFade?.type === 'in' ? dragFade.currentSec : clipFades.fadeIn
  const effectiveFadeOut = dragFade?.type === 'out' ? dragFade.currentSec : clipFades.fadeOut
  const clipWidthPx = Math.max(drawnDuration * pixelsPerSecond, 4)
  const fadeInPx = Math.min(clipWidthPx, Math.max(0, effectiveFadeIn * pixelsPerSecond))
  const fadeOutPx = Math.min(clipWidthPx - fadeInPx, Math.max(0, effectiveFadeOut * pixelsPerSecond))
  const trackHeight = getTrackHeight(clip.trackIndex) - 4

  const handleFadePointerDown = (e: React.PointerEvent, type: 'in' | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    const initialFades = getAudioFadeDurations(clip)
    const startX = e.clientX
    const initialSec = type === 'in' ? initialFades.fadeIn : initialFades.fadeOut

    setDragFade({ type, currentSec: initialSec })

    const handlePointerMove = (moveEv: PointerEvent) => {
      const deltaPx = moveEv.clientX - startX
      const deltaSec = deltaPx / pixelsPerSecond
      if (type === 'in') {
        const maxFade = Math.max(0, clip.duration - initialFades.fadeOut)
        const rawSec = initialSec + deltaSec
        const clamped = Math.max(0, Math.min(maxFade, rawSec))
        const finalSec = clamped * pixelsPerSecond < 6 ? 0 : clamped
        setDragFade({ type: 'in', currentSec: finalSec })
      } else {
        const maxFade = Math.max(0, clip.duration - initialFades.fadeIn)
        const rawSec = initialSec - deltaSec
        const clamped = Math.max(0, Math.min(maxFade, rawSec))
        const finalSec = clamped * pixelsPerSecond < 6 ? 0 : clamped
        setDragFade({ type: 'out', currentSec: finalSec })
      }
    }

    const handlePointerUp = (upEv: PointerEvent) => {
      try {
        target.releasePointerCapture(upEv.pointerId)
      } catch {}
      target.removeEventListener('pointermove', handlePointerMove)
      target.removeEventListener('pointerup', handlePointerUp)
      target.removeEventListener('pointercancel', handlePointerUp)

      setDragFade(latest => {
        if (latest) {
          if (latest.type === 'in') {
            setAudioFade(clip.id, latest.currentSec, undefined)
          } else {
            setAudioFade(clip.id, undefined, latest.currentSec)
          }
        }
        return null
      })
    }

    target.addEventListener('pointermove', handlePointerMove)
    target.addEventListener('pointerup', handlePointerUp)
    target.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <div
      data-clip-id={clip.id}
      /* transition-colors, never transition-all: `all` includes transform,
         left and top, so every drag frame was animated over 150ms — the
         clip trailed the cursor while dragging and slid into place after
         the drop instead of being where it was dropped. */
      className={`group/clip absolute rounded border-2 transition-colors overflow-hidden select-none ${
        selectedClipIds.has(clip.id)
          ? 'border-blue-500 shadow-lg shadow-blue-500/20'
          : (isDragging || isSlipSlide)
            ? 'border-accent bg-accent/20 ring-2 ring-accent/50 z-10'
            : clipColor
              ? `${clipColor.border} ${clipColor.bg} hover:brightness-125`
              : 'border-zinc-600 bg-zinc-800/80 hover:border-zinc-500'
      }`}
      style={{
        left: `${drawnStart * pixelsPerSecond}px`,
        top: `${trackTopPx(clip.trackIndex, 2)}px`,
        width: `${Math.max(drawnDuration * pixelsPerSecond, 4)}px`,
        height: `${getTrackHeight(clip.trackIndex) - 4}px`,
        cursor: activeTool === 'blade'
          ? SCISSORS_CURSOR
          : activeTool === 'trackForward'
            ? (bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR)
            : 'pointer',
      }}
      onMouseDown={(e) => handleClipMouseDown(e, clip)}
      onDoubleClick={onDoubleClick}
      onMouseMove={(e) => {
        if (activeTool === 'blade') {
          const rect = e.currentTarget.getBoundingClientRect()
          const offsetX = e.clientX - rect.left
          const time = drawnStart + offsetX / pixelsPerSecond
          setBladeHoverInfo({ clipId: clip.id, offsetX, time })
        }
      }}
      onMouseLeave={() => {
        if (activeTool === 'blade' && bladeHoverInfo?.clipId === clip.id) {
          setBladeHoverInfo(null)
        }
      }}
      onContextMenu={(e) => handleClipContextMenu(e, clip)}
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase())
        const isEffect = types.includes('effecttype')
        const isFilter = types.includes('filterid') || types.some(t => t.includes('filter'))
        const isTransition = types.some(t => t.includes('transition') || t === 'text/plain')
        if (isEffect || isFilter || isTransition) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const filterId = e.dataTransfer.getData('filterId') ||
          e.dataTransfer.getData('application/x-komfyedit-filter')
        if (filterId) {
          e.preventDefault()
          e.stopPropagation()
          setClipFilter(clip.id, filterId)
          return
        }

        const effectType = e.dataTransfer.getData('effectType')
        if (effectType) {
          e.preventDefault()
          e.stopPropagation()
          addClipEffect(clip.id, effectType as EffectType)
          return
        }

        const transitionType = e.dataTransfer.getData('transitionType') ||
          e.dataTransfer.getData('application/x-komfyedit-transition') ||
          e.dataTransfer.getData('text/plain')

        if (transitionType && applyTransitionAtPoint) {
          e.preventDefault()
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const dropTime = drawnStart + (e.clientX - rect.left) / pixelsPerSecond
          // Anywhere on a narrow clip means "its nearest end"; on a wide one only
          // the ends count, or a drop in the middle would grab a distant junction.
          const edgeThreshold = Math.max(32, Math.min(64, rect.width * 0.4))
          applyTransitionAtPoint(
            clip.trackIndex,
            dropTime,
            transitionType,
            edgeThreshold / pixelsPerSecond,
          )
        }
      }}
    >
      {/* Blade cut indicator line */}
      {activeTool === 'blade' && bladeHoverInfo && (() => {
        const isHoveredClip = bladeHoverInfo.clipId === clip.id
        const isShiftTarget = bladeShiftHeld && !isHoveredClip &&
          bladeHoverInfo.time > drawnStart + 0.05 &&
          bladeHoverInfo.time < drawnStart + drawnDuration - 0.05
        if (!isHoveredClip && !isShiftTarget) return null
        const indicatorPx = isHoveredClip
          ? bladeHoverInfo.offsetX
          : (bladeHoverInfo.time - drawnStart) * pixelsPerSecond
        return (
          <div
            className={`absolute top-0 bottom-0 w-px z-20 pointer-events-none ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`}
            style={{ left: `${indicatorPx}px` }}
          >
            <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
            <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
          </div>
        )
      })()}

      <div
        className={`absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500 hover:text-white ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-grab'}`}
        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
      >
        <GripVertical className="h-3 w-3" />
      </div>

      <div className="h-full flex items-center pl-5 pr-2 gap-2">
        {clip.type === 'adjustment' ? (
          <div className="h-8 w-8 flex-shrink-0 rounded bg-blue-800/30 border border-blue-600/30 flex items-center justify-center">
            <Layers className="h-4 w-4 text-blue-400" />
          </div>
        ) : clip.type === 'text' ? (
          <div className="h-8 w-8 flex-shrink-0 rounded bg-cyan-800/30 border border-cyan-600/30 flex items-center justify-center">
            <Type className="h-4 w-4 text-cyan-400" />
          </div>
        ) : clip.type === 'audio' ? (
          <>
            <ClipWaveform
              url={pathToFileUrl(getClipPath(clip) || clip.asset?.path || '')}
              color="rgba(125, 211, 252, 0.75)"
              sourceDuration={getLiveAsset(clip)?.duration}
              trimStart={clip.trimStart}
              duration={clip.duration}
              speed={clip.speed}
            />
            <div className="h-5 w-5 flex-shrink-0 rounded bg-sky-900/70 flex items-center justify-center relative z-10">
              <Music className="h-3 w-3 text-sky-300" />
            </div>
          </>
        ) : clip.asset && (() => {
          const live = getLiveAsset(clip)
          if (!live) return null
          const thumbPath: string | undefined = live.smallThumbnailPath
          return thumbPath ? (
            <img
              key={`thumb-${clip.id}`}
              src={pathToFileUrl(thumbPath)}
              alt=""
              // Images drag natively in Chromium. Without this, a clip drag that
              // happens to start on the thumbnail becomes an image drag whose
              // drop looks like an OS file drop and imports a phantom asset.
              draggable={false}
              className="h-8 aspect-video object-cover rounded"
            />
          ) : (
            <div className="h-8 aspect-video rounded" />
          )
        })()}
        <div className={`flex-1 min-w-0 ${clip.type === 'audio' ? 'relative z-10' : ''}`}>
          <p className={`text-[10px] truncate ${clip.type === 'adjustment' ? (clip.filter ? 'text-teal-300' : 'text-blue-300') : clip.type === 'text' ? 'text-cyan-300' : clip.type === 'audio' ? 'text-emerald-300' : 'text-zinc-300'}`}>
            {clip.type === 'adjustment'
              ? (clip.filter ? (getFilterDefinition(clip.filter.id)?.name ? `Filter: ${getFilterDefinition(clip.filter.id)?.name}` : clip.importedName || 'Filter') : (clip.importedName || 'Adjustment Layer'))
              : clip.type === 'text'
                ? (clip.textStyle?.text?.slice(0, 30) || 'Text')
                : clip.asset?.prompt?.slice(0, 30) || clip.importedName || 'Clip'}
          </p>
          <div className="flex items-center gap-2 text-[9px] text-zinc-500">
            {/* The length the box actually shows: a clip lending seconds to a
                transition would otherwise read longer than it looks. */}
            <span>{drawnDuration.toFixed(1)}s</span>
            {(() => {
              const resInfo = getClipResolution(clip)
              if (!resInfo) return null
              return <span style={{ color: resInfo.color }} className="font-semibold">{resInfo.displayName}</span>
            })()}
            {hasKeyframesForProperty(clip, 'speed') ? (
              <span className="text-amber-400 font-semibold bg-amber-500/20 px-1 py-0.2 rounded border border-amber-500/30">
                RAMP
              </span>
            ) : clip.speed !== 1 ? (
              <span className="text-yellow-400">{clip.speed}x</span>
            ) : null}
            {clip.reversed && <span className="text-blue-400">REV</span>}
            {clip.muted && <span className="text-red-400">M</span>}
            {(clip.flipH || clip.flipV) && <span className="text-cyan-400">FLIP</span>}
            {clip.colorCorrection && Object.values(clip.colorCorrection).some(v => v !== 0) && <span className="text-orange-400">CC</span>}
            {clip.filter && <span className="text-teal-400 font-semibold">LUT</span>}
            {clip.letterbox?.enabled && <span className="text-blue-400">LB</span>}
            {Boolean(clip.linkedClipIds?.length) && <Link2 className="h-2.5 w-2.5 text-zinc-500 inline" />}
          </div>
        </div>
      </div>

      {/* Video clip audio waveform overlay */}
      {clip.type === 'video' && drawnDuration * pixelsPerSecond > 24 && (
        <div className="absolute inset-x-0 bottom-0 h-[34%] min-h-[10px] overflow-hidden rounded-b bg-black/35 pointer-events-none">
          <ClipWaveform
            url={pathToFileUrl(getClipPath(clip) || clip.asset?.path || '')}
            color="rgba(125, 211, 252, 0.85)"
            sourceDuration={getLiveAsset(clip)?.duration}
            trimStart={clip.trimStart}
            duration={clip.duration}
            speed={clip.speed}
          />
        </div>
      )}

      {/* Transition in indicator */}
      {clip.transitionIn?.type !== 'none' && clip.transitionIn?.duration > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none"
          style={{
            width: `${Math.min(clip.transitionIn.duration / clip.duration * 100, 50)}%`,
            background: 'linear-gradient(to right, rgba(139,92,246,0.4), transparent)',
          }}
        />
      )}
      {/* Transition out indicator */}
      {clip.transitionOut?.type !== 'none' && clip.transitionOut?.duration > 0 && (
        <div
          className="absolute top-0 bottom-0 right-0 pointer-events-none"
          style={{
            width: `${Math.min(clip.transitionOut.duration / clip.duration * 100, 50)}%`,
            background: 'linear-gradient(to left, rgba(139,92,246,0.4), transparent)',
          }}
        />
      )}

      {/* Resolution color bar */}
      {(() => {
        const resInfo = getClipResolution(clip)
        if (!resInfo) return null
        return (
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none"
            style={{ backgroundColor: resInfo.color }}
            title={resInfo.label}
          />
        )
      })()}

      {/* Background-removal progress, on the clip being processed */}
      {Boolean(clip.autoMatte?.enabled) && (
        <ClipMatteProgress clipId={clip.id} clipWidthPx={clipWidthPx} />
      )}

      {/* Keyframe row for selected clip or clip with keyframes */}
      {(selectedClipIds.has(clip.id) || Boolean(clip.keyframes && clip.keyframes.length > 0)) && (
        <TimelineKeyframeRow
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
        />
      )}

      {/* Volume envelope on waveform for audio clips */}
      {clip.type === 'audio' && (
        <TimelineAudioEnvelope
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          trackHeight={trackHeight}
          drawnDuration={drawnDuration}
          activeTool={activeTool}
        />
      )}

      {/* Audio fade ramp overlay */}
      {hasAudio && (effectiveFadeIn > 0.01 || effectiveFadeOut > 0.01) && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden"
          style={{ width: `${clipWidthPx}px`, height: `${trackHeight}px` }}
        >
          {effectiveFadeIn > 0.01 && (
            <g>
              <polygon
                points={`0,0 ${fadeInPx},0 0,${trackHeight}`}
                fill="rgba(0, 0, 0, 0.45)"
              />
              <line
                x1={0}
                y1={trackHeight}
                x2={fadeInPx}
                y2={0}
                stroke="rgba(255, 255, 255, 0.85)"
                strokeWidth={1.5}
              />
            </g>
          )}
          {effectiveFadeOut > 0.01 && (
            <g>
              <polygon
                points={`${clipWidthPx - fadeOutPx},0 ${clipWidthPx},0 ${clipWidthPx},${trackHeight}`}
                fill="rgba(0, 0, 0, 0.45)"
              />
              <line
                x1={clipWidthPx - fadeOutPx}
                y1={0}
                x2={clipWidthPx}
                y2={trackHeight}
                stroke="rgba(255, 255, 255, 0.85)"
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>
      )}

      {/* Audio Fade In handle */}
      {hasAudio && activeTool !== 'blade' && activeTool !== 'trackForward' && (
        <div
          className={`absolute top-0 z-20 w-3 h-3.5 rounded-b bg-white/90 hover:bg-white text-zinc-800 shadow cursor-ew-resize flex items-center justify-center transition-opacity ${
            effectiveFadeIn > 0.01 || dragFade?.type === 'in'
              ? 'opacity-90'
              : 'opacity-0 group-hover/clip:opacity-70 hover:!opacity-100'
          }`}
          style={{ left: `${Math.max(0, Math.min(clipWidthPx - 12, fadeInPx - 6))}px` }}
          title={`Fade In: ${effectiveFadeIn.toFixed(2)}s`}
          onPointerDown={(e) => handleFadePointerDown(e, 'in')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-0.5 h-2 bg-zinc-600 rounded-full pointer-events-none" />
          {dragFade?.type === 'in' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] text-white whitespace-nowrap shadow pointer-events-none z-30">
              In: {dragFade.currentSec.toFixed(2)}s
            </div>
          )}
        </div>
      )}

      {/* Audio Fade Out handle */}
      {hasAudio && activeTool !== 'blade' && activeTool !== 'trackForward' && (
        <div
          className={`absolute top-0 z-20 w-3 h-3.5 rounded-b bg-white/90 hover:bg-white text-zinc-800 shadow cursor-ew-resize flex items-center justify-center transition-opacity ${
            effectiveFadeOut > 0.01 || dragFade?.type === 'out'
              ? 'opacity-90'
              : 'opacity-0 group-hover/clip:opacity-70 hover:!opacity-100'
          }`}
          style={{ left: `${Math.max(0, Math.min(clipWidthPx - 12, clipWidthPx - fadeOutPx - 6))}px` }}
          title={`Fade Out: ${effectiveFadeOut.toFixed(2)}s`}
          onPointerDown={(e) => handleFadePointerDown(e, 'out')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-0.5 h-2 bg-zinc-600 rounded-full pointer-events-none" />
          {dragFade?.type === 'out' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 rounded text-[9px] text-white whitespace-nowrap shadow pointer-events-none z-30">
              Out: {dragFade.currentSec.toFixed(2)}s
            </div>
          )}
        </div>
      )}

      {/* Left resize handle */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
          resizingClip?.clipId === clip.id && resizingClip?.edge === 'left'
            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
        }`}
        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
        onMouseDown={(e) => handleResizeStart(e, clip, 'left')}
      >
        <div className={`w-0.5 h-6 rounded-full ${
          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
        }`} />
      </div>

      {/* Right resize handle */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
          resizingClip?.clipId === clip.id && resizingClip?.edge === 'right'
            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
        }`}
        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
        onMouseDown={(e) => handleResizeStart(e, clip, 'right')}
      >
        <div className={`w-0.5 h-6 rounded-full ${
          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
        }`} />
      </div>
    </div>
  )
}
