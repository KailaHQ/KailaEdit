import React from 'react'
import { Video } from 'lucide-react'
import { AudioWaveform } from '../../../components/AudioWaveform'
import { pathToFileUrl } from '../../../lib/file-url'
import type { TimelineClip, Timeline } from '../../../types/project-model'
import { LutCanvas, type LutCanvasRef } from './LutCanvas'
import { isImageClip, MAX_COMPOSITING_CANVASES } from './preview-frame-engine'
import type { FrameOverlayState, MonitorRenderMode, FrameRenderState } from './preview-frame-engine'
import { getTransitionBgColor } from '../video-editor-utils'
import { isAutoMatteBakeValid } from '@core/auto-matte'
import { stabilizedClipPath } from '@core/stabilization'
import { isTimelineShapeClip, timelineShapeToDataUrl } from '../timeline-shape-utils'

/**
 * The baked matte to hand a clip, or undefined to fall back to live inference.
 *
 * Every LutCanvas below needs this, and each of them needs the whole Remove BG prop set —
 * `autoMatte`, `customMatte`, `stroke`, `clipId`, `trimStart` and `speed`.
 * Dropping any one of them silently turns the feature off for that layer: `LutCanvas`
 * decides it has nothing to draw and passes the picture through untouched, background and
 * all, with no error anywhere. That is exactly what happened when this component was split
 * out of ProgramMonitor — the props did not come across, so background removal stopped
 * working in the preview for every clip while the Remove BG panel still reported
 * "matte ready".
 */
function bakedMattePath(clip: TimelineClip | null | undefined): string | undefined {
  if (!clip?.autoMatte?.bake?.path) return undefined
  // A clip here is already resolved onto its stabilized file, if it has one; a matte of
  // the original can cover the same seconds and still not line up with those pixels.
  const stabilizedPath = stabilizedClipPath(clip)
  const valid = isAutoMatteBakeValid(clip.autoMatte.bake, {
    trimStart: clip.trimStart,
    duration: clip.duration,
    speed: clip.speed,
    reversed: clip.reversed,
    model: clip.autoMatte.model || 'rvm-mobilenetv3',
    quality: clip.autoMatte.quality || 'standard',
    ...(stabilizedPath ? { assetKey: stabilizedPath } : {}),
  })
  return valid ? clip.autoMatte.bake.path : undefined
}

export interface MonitorCompositingStackProps {
  activeTimeline: Timeline | null | undefined
  effectiveDimensions: { width: number; height: number; aspectRatio: number }
  frameScene: FrameOverlayState
  compositingStack: TimelineClip[]
  activeClip: TimelineClip | null | undefined
  activeStickerClips: TimelineClip[]
  crossDissolveState: {
    outgoing: TimelineClip
    incoming: TimelineClip
    progress: number
  } | null
  isPlaying: boolean
  currentTime: number
  getClipPath: (clip: TimelineClip) => string
  /** Refs */
  blurCanvasRef: React.RefObject<HTMLCanvasElement>
  videoPoolContainerRef: React.RefObject<HTMLDivElement>
  lutCanvasRef: React.RefObject<LutCanvasRef>
  incomingLutCanvasRef: React.RefObject<LutCanvasRef>
  incomingDissolveVideoRef: React.MutableRefObject<HTMLVideoElement | null>
  incomingDissolveImageRef: React.MutableRefObject<HTMLImageElement | null>
  transitionBgRef: React.RefObject<HTMLDivElement>
  compositingMediaRefs: React.MutableRefObject<Map<string, HTMLVideoElement | HTMLImageElement>>
  compositingSlotMapRef: React.MutableRefObject<Map<string, number>>
  compLutCanvasRefs: React.RefObject<LutCanvasRef>[]
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  activePoolPathRef: React.MutableRefObject<string>
  /** Callbacks */
  attachActiveImage: (el: HTMLImageElement | null) => void
  activeImageEl: HTMLImageElement | null
  applyFrameVisuals: (state: FrameRenderState, mode: MonitorRenderMode) => void
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
  webCodecsFrame?: VideoFrame | null
}

/**
 * Renders all compositing layers inside the video frame wrapper:
 * background, compositing stack, LUT canvases, active image/video,
 * cross-dissolve, transition bg, and the audio-only / empty states.
 */
export const MonitorCompositingStack = React.memo(function MonitorCompositingStack({
  activeTimeline,
  effectiveDimensions,
  frameScene,
  compositingStack,
  activeClip,
  activeStickerClips,
  crossDissolveState,
  isPlaying,
  currentTime,
  getClipPath,
  blurCanvasRef,
  videoPoolContainerRef,
  lutCanvasRef,
  incomingLutCanvasRef,
  incomingDissolveVideoRef,
  incomingDissolveImageRef,
  transitionBgRef,
  compositingMediaRefs,
  compositingSlotMapRef,
  compLutCanvasRefs,
  videoPoolRef,
  activePoolPathRef,
  attachActiveImage,
  activeImageEl,
  applyFrameVisuals,
  lastFrameRequestRef,
  webCodecsFrame,
}: MonitorCompositingStackProps) {
  return (
    <>
      {/* Timeline Background: custom image or blur layer behind composited clips */}
      {activeTimeline?.background?.type === 'image' && activeTimeline.background.imagePath && (
        <img
          src={pathToFileUrl(activeTimeline.background.imagePath)}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none z-[0]"
        />
      )}
      {activeTimeline?.background?.type === 'blur' && (
        <canvas
          ref={blurCanvasRef}
          width={Math.min(360, effectiveDimensions.width || 360)}
          height={Math.round(Math.min(360, effectiveDimensions.width || 360) / (effectiveDimensions.aspectRatio || (16 / 9)))}
          className="absolute inset-0 w-full h-full pointer-events-none z-[0]"
          style={{
            filter: `blur(${Math.max(2, Math.round((activeTimeline.background.blur ?? 40) * 0.35))}px)`,
            transform: 'scale(1.15)',
          }}
        />
      )}

      {/* Compositing: render clips from lower tracks underneath the active clip */}
      {compositingStack.map(lowerClip => {
        const lowerPath = getClipPath(lowerClip) || lowerClip.asset?.path || ''
        const lowerFileUrl = isTimelineShapeClip(lowerClip)
          ? timelineShapeToDataUrl(lowerClip)
          : (lowerPath ? pathToFileUrl(lowerPath) : '')
        if (isImageClip(lowerClip)) {
          return (
            <img
              key={`comp-${lowerClip.id}`}
              src={lowerFileUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
              onLoad={() => {
                const slot = compositingSlotMapRef.current.get(lowerClip.id)
                if (slot !== undefined) {
                  compLutCanvasRefs[slot]?.current?.renderNow()
                }
              }}
              ref={(el) => {
                if (el) compositingMediaRefs.current.set(lowerClip.id, el)
                else compositingMediaRefs.current.delete(lowerClip.id)
              }}
            />
          )
        }
        return (
          <video
            key={`comp-${lowerClip.id}`}
            id={`comp-video-${lowerClip.id}`}
            src={lowerFileUrl}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
            muted
            playsInline
            preload="auto"
            ref={(el) => {
              if (el) {
                compositingMediaRefs.current.set(lowerClip.id, el)
                el.muted = true
              } else {
                compositingMediaRefs.current.delete(lowerClip.id)
              }
            }}
          />
        )
      })}

      {/* Pooled WebGL2 LUT canvases for lower compositing layers */}
      {Array.from({ length: MAX_COMPOSITING_CANVASES }).map((_, slotIndex) => {
        const assignedClipId = Array.from(compositingSlotMapRef.current.entries())
          .find(([_, s]) => s === slotIndex)?.[0]
        const assignedClip = assignedClipId ? compositingStack.find(c => c.id === assignedClipId) : null
        const assignedFilter = assignedClip ? frameScene.compositingFilters[assignedClip.id] : undefined
        const sourceEl = assignedClip ? compositingMediaRefs.current.get(assignedClip.id) ?? null : null

        return (
          <LutCanvas
            key={`comp-lut-slot-${slotIndex}`}
            ref={compLutCanvasRefs[slotIndex]}
            sourceElement={sourceEl}
            filterId={assignedFilter?.id}
            intensity={assignedFilter?.intensity ?? 100}
            chromaKey={assignedClip?.chromaKey}
            autoMatte={assignedClip?.autoMatte}
            customMatte={assignedClip?.customMatte}
            stroke={assignedClip?.stroke}
            clipId={assignedClip?.id}
            bakeVideoPath={bakedMattePath(assignedClip)}
            trimStart={assignedClip?.trimStart}
            speed={assignedClip?.speed}
            isPlaying={isPlaying}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
          />
        )
      })}

      {/* Transition background overlay */}
      {activeClip && (() => {
        const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
        const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
        const bg = tInBg || tOutBg
        if (!bg) return null
        return <div ref={transitionBgRef} className="absolute inset-0 z-10 pointer-events-none hidden" />
      })()}
      {/* Video pool container — during dissolve, fade out with progress */}
      <div
        ref={videoPoolContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-[2] hidden"
      />

      {activeClip && isImageClip(activeClip) && (
        <img
          ref={attachActiveImage}
          src={
            isTimelineShapeClip(activeClip)
              ? timelineShapeToDataUrl(activeClip)
              : pathToFileUrl(getClipPath(activeClip) || activeClip.asset?.path || '')
          }
          alt=""
          onLoad={() => {
            lutCanvasRef.current?.renderNow()
            if (blurCanvasRef.current && activeTimeline?.background?.type === 'blur') {
              const last = lastFrameRequestRef.current
              if (last) applyFrameVisuals(last.state, last.mode)
            }
          }}
          className="absolute inset-0 w-full h-full object-contain z-[2]"
        />
      )}

      {/* 3D LUT WebGL2 preview canvas */}
      {(() => {
        const isFrameValid = Boolean(
          webCodecsFrame &&
          typeof VideoFrame !== 'undefined' &&
          webCodecsFrame instanceof VideoFrame &&
          webCodecsFrame.format !== null
        )
        const activeClipPath = activeClip && !isImageClip(activeClip)
          ? (getClipPath(activeClip) || activeClip.asset?.path || '')
          : ''
        const pooledVideo = activeClipPath ? videoPoolRef.current.get(activeClipPath) ?? null : null
        const fallbackVideo = activePoolPathRef.current ? videoPoolRef.current.get(activePoolPathRef.current) ?? null : null
        const activeSource =
          (isFrameValid ? webCodecsFrame : null) ||
          (isImageClip(activeClip) ? activeImageEl : (pooledVideo || fallbackVideo))

        return (
          <LutCanvas
            ref={lutCanvasRef}
            sourceElement={activeSource}
            filterId={frameScene.activeFilter?.id}
            intensity={frameScene.activeFilter?.intensity ?? 100}
            chromaKey={activeClip?.chromaKey}
            autoMatte={activeClip?.autoMatte}
            customMatte={activeClip?.customMatte}
            stroke={activeClip?.stroke}
            clipId={activeClip?.id}
            bakeVideoPath={bakedMattePath(activeClip)}
            trimStart={activeClip?.trimStart}
            speed={activeClip?.speed}
            isPlaying={isPlaying}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[2]"
          />
        )
      })()}

      {/* Cross-dissolve incoming clip overlay */}
      {crossDissolveState && (() => {
        const { incoming } = crossDissolveState
        const inPath = getClipPath(incoming) || incoming.asset?.path || ''
        const inFileUrl = inPath ? pathToFileUrl(inPath) : ''
        if (incoming.asset?.type === 'video') {
          return (
            <video
              ref={incomingDissolveVideoRef}
              key={`dissolve-in-${incoming.id}`}
              src={inFileUrl}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
              playsInline
              muted
              preload="auto"
            />
          )
        }
        if (incoming.asset?.type === 'image') {
          return (
            <img
              ref={incomingDissolveImageRef}
              key={`dissolve-in-${incoming.id}`}
              src={inFileUrl}
              alt=""
              onLoad={() => {
                incomingLutCanvasRef.current?.renderNow()
              }}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
            />
          )
        }
        return null
      })()}

      {/* Cross-dissolve incoming WebGL2 LUT canvas */}
      <LutCanvas
        key="incoming-lut-canvas"
        ref={incomingLutCanvasRef}
        sourceElement={
          crossDissolveState?.incoming.asset?.type === 'video'
            ? incomingDissolveVideoRef.current
            : incomingDissolveImageRef.current
        }
        filterId={frameScene.incomingFilter?.id}
        intensity={frameScene.incomingFilter?.intensity ?? 100}
        chromaKey={crossDissolveState?.incoming.chromaKey}
        autoMatte={crossDissolveState?.incoming.autoMatte}
        customMatte={crossDissolveState?.incoming.customMatte}
        stroke={crossDissolveState?.incoming.stroke}
        clipId={crossDissolveState?.incoming.id}
        bakeVideoPath={bakedMattePath(crossDissolveState?.incoming)}
        trimStart={crossDissolveState?.incoming.trimStart}
        speed={crossDissolveState?.incoming.speed}
        isPlaying={isPlaying}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[3]"
      />

      {/* Note: Clip-level masks will be implemented in KE-501 (resolved in KE-106). */}

      {/* Audio waveform or empty state when no video/image clip is visible */}
      {!activeClip && activeStickerClips.length === 0 && (() => {
        const audioAtPlayhead = frameScene.audioOnlyClips
        return audioAtPlayhead.length > 0 ? (
          <div className="absolute inset-0">
            <AudioWaveform
              audioClips={audioAtPlayhead.map(c => ({
                url: pathToFileUrl(getClipPath(c) || c.asset?.path || ''),
                name: c.asset?.path || c.importedName || 'Audio',
                startTime: c.startTime,
                duration: c.duration,
              }))}
              currentTime={currentTime}
              isPlaying={isPlaying}
            />
          </div>
        ) : !isPlaying ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <Video className="h-8 w-8 text-zinc-600" />
            </div>
            <p className="text-zinc-500 text-sm">No clip at playhead</p>
            <p className="text-zinc-600 text-xs mt-1">Move playhead over a clip to preview</p>
          </div>
        ) : null
      })()}
    </>
  )
})
