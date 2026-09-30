import React from 'react'
import type { TimelineClip, Track, SubtitleClip } from '../../../types/project-model'
import { MonitorSubtitlesOverlay } from './MonitorSubtitlesOverlay'
import { MonitorLetterbox } from './MonitorLetterbox'
import { isTimelineShapeClip, timelineShapeToDataUrl } from '../timeline-shape-utils'
import { pathToFileUrl } from '../../../lib/file-url'
import type { FrameRenderState, MonitorRenderMode, ActiveLetterboxState } from './preview-frame-engine'

export interface MonitorMediaOverlaysProps {
  activeAdjustmentEffects: Array<{
    clip: TimelineClip
    filterStyle: React.CSSProperties
    hasVignette: boolean
    vignetteAmount: number
    hasGrain: boolean
    grainAmount: number
  }>
  activeStickerClips: TimelineClip[]
  stickerImageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>
  getClipPath: (clip: TimelineClip) => string
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
  applyFrameVisuals: (state: FrameRenderState, mode: MonitorRenderMode) => void
  activeSubtitles: SubtitleClip[]
  tracks: Track[]
  activeLetterbox: ActiveLetterboxState | null
}

export const MonitorMediaOverlays: React.FC<MonitorMediaOverlaysProps> = ({
  activeAdjustmentEffects,
  activeStickerClips,
  stickerImageRefs,
  getClipPath,
  lastFrameRequestRef,
  applyFrameVisuals,
  activeSubtitles,
  tracks,
  activeLetterbox,
}) => {
  return (
    <>
      {/* Adjustment layer effects */}
      {activeAdjustmentEffects.map(({ clip: adjClip, filterStyle, hasVignette, vignetteAmount, hasGrain, grainAmount }) => {
        const backdropFilter = filterStyle.filter && filterStyle.filter !== 'none' ? String(filterStyle.filter) : undefined
        return (
          <React.Fragment key={`adj-fx-${adjClip.id}`}>
            {backdropFilter && (
              <div
                className="absolute inset-0 z-[22] pointer-events-none"
                style={{ backdropFilter, WebkitBackdropFilter: backdropFilter }}
              />
            )}
            {hasVignette && (
              <div
                className="absolute inset-0 z-[22] pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${vignetteAmount}) 100%)`,
                }}
              />
            )}
            {hasGrain && (
              <canvas
                ref={(canvas) => {
                  if (!canvas) return
                  const ctx = canvas.getContext('2d')
                  if (!ctx) return
                  const w = canvas.width = 256
                  const h = canvas.height = 256
                  const imageData = ctx.createImageData(w, h)
                  for (let i = 0; i < imageData.data.length; i += 4) {
                    const v = Math.random() * 255
                    imageData.data[i] = v
                    imageData.data[i + 1] = v
                    imageData.data[i + 2] = v
                    imageData.data[i + 3] = (grainAmount / 100) * 80
                  }
                  ctx.putImageData(imageData, 0, 0)
                }}
                className="absolute inset-0 z-[22] pointer-events-none w-full h-full"
                style={{ mixBlendMode: 'overlay', imageRendering: 'pixelated' }}
              />
            )}
          </React.Fragment>
        )
      })}

      {/* Sticker overlay clips */}
      {activeStickerClips.map(sc => {
        const src = isTimelineShapeClip(sc)
          ? timelineShapeToDataUrl(sc)
          : pathToFileUrl(getClipPath(sc) || sc.asset?.path || '')
        return (
          <img
            key={`sticker-${sc.id}`}
            src={src}
            alt=""
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[14]"
            ref={(el) => {
              if (el) stickerImageRefs.current.set(sc.id, el)
              else stickerImageRefs.current.delete(sc.id)
            }}
            onLoad={() => {
              const last = lastFrameRequestRef.current
              if (last) applyFrameVisuals(last.state, last.mode)
            }}
          />
        )
      })}

      {/* Subtitle overlay */}
      <MonitorSubtitlesOverlay activeSubtitles={activeSubtitles} tracks={tracks} />

      {/* Letterbox overlay from adjustment layers */}
      <MonitorLetterbox activeLetterbox={activeLetterbox} />
    </>
  )
}
