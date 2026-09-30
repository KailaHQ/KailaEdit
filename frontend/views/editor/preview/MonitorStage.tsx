import React from 'react'
import { Layers, Pipette } from 'lucide-react'
import type { TimelineClip, Asset, Timeline, Track, ClipTransform, ClipMask, SubtitleClip } from '../../../types/project-model'
import type { LutCanvasRef } from './LutCanvas'
import type { FrameRenderState, MonitorRenderMode, ActiveLetterboxState } from './preview-frame-engine'
import { SourceVideoPreview } from './SourceVideoPreview'
import { MonitorCompositingStack } from './MonitorCompositingStack'
import { MonitorMediaOverlays } from './MonitorMediaOverlays'
import { MonitorInteractiveOverlays } from './MonitorInteractiveOverlays'

export interface MonitorStageProps {
  clips: TimelineClip[]
  isPreviewingVideo: boolean
  previewAsset: Asset | null
  sourceVideoDimensions: { width: number; height: number } | null
  sourceVideoFrameSize: { width: number; height: number }
  previewVideoRef: React.MutableRefObject<HTMLVideoElement | null>
  setSourceVideoDimensions: (dims: { width: number; height: number } | null) => void
  setPreviewVideoDuration: (dur: number) => void
  setPreviewVideoCurrentTime: (time: number) => void
  setPreviewVideoPlaying: (playing: boolean) => void
  setPreviewAssetId: (id: string | null) => void
  eyedropperMode: boolean
  setEyedropperMode: (mode: boolean) => void
  videoFrameWrapperRef: React.RefObject<HTMLDivElement>
  videoFrameSize: { width: number; height: number }
  effectiveDimensions: { width: number; height: number; aspectRatio: number }
  activeTimeline: Timeline | null | undefined
  transformInteractionRef: React.MutableRefObject<boolean>
  clickedTextOverlayRef: React.MutableRefObject<boolean>
  sampleColorAtEvent: (e: React.MouseEvent) => void
  selectVisualClipAtPoint: (e: React.MouseEvent) => void
  previewZoom: number | 'fit'
  previewPan: { x: number; y: number }
  // Compositing & layers
  frameScene: ReturnType<typeof import('./useFrameRenderer').useFrameRenderer>['frameScene']
  compositingStack: TimelineClip[]
  activeClip: TimelineClip | null
  activeStickerClips: TimelineClip[]
  crossDissolveState: {
    outgoing: TimelineClip
    incoming: TimelineClip
    progress: number
  } | null
  isPlaying: boolean
  currentTime: number
  getClipPath: (clip: TimelineClip) => string
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
  attachActiveImage: (el: HTMLImageElement | null) => void
  activeImageEl: HTMLImageElement | null
  applyFrameVisuals: (state: FrameRenderState, mode: MonitorRenderMode) => void
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
  webCodecsFrame: VideoFrame | null
  cachedVideoRefA: React.MutableRefObject<HTMLVideoElement | null>
  cachedVideoRefB: React.MutableRefObject<HTMLVideoElement | null>
  hasActiveCache: boolean
  activeCacheSlot: 0 | 1
  activeAdjustmentEffects: Array<{
    clip: TimelineClip
    filterStyle: React.CSSProperties
    hasVignette: boolean
    vignetteAmount: number
    hasGrain: boolean
    grainAmount: number
  }>
  stickerImageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>
  activeSubtitles: SubtitleClip[]
  tracks: Track[]
  activeLetterbox: ActiveLetterboxState | null
  activeTextClips: TimelineClip[]
  selectedClipIds: Set<string>
  playbackTimeRef: React.MutableRefObject<number>
  selectedClip: TimelineClip | null
  assets: Asset[]
  cropMode: boolean
  maskMode: boolean
  showSafeZoneGuide: boolean
  // Actions
  onSelectClip: (id: string) => void
  onShowPropertiesPanel: () => void
  onUpdateTextPosition: (clipId: string, posX: number, posY: number) => void
  onUpdateTextFontSize: (clipId: string, fontSize: number) => void
  onUpdateTextMaxWidth: (clipId: string, maxWidth: number) => void
  onUpdateTextRotation: (clipId: string, rotation: number) => void
  onDeleteClips: (ids: string[]) => void
  onToggleCropMode: () => void
  onUpdateTransform: (patch: Partial<ClipTransform>, options?: { recordKeyframeAt?: number }) => void
  onPreviewTransform: (transform: ClipTransform | null) => void
  onUpdateMask: (patch: Partial<ClipMask>) => void
}

export const MonitorStage: React.FC<MonitorStageProps> = ({
  clips,
  isPreviewingVideo,
  previewAsset,
  sourceVideoDimensions,
  sourceVideoFrameSize,
  previewVideoRef,
  setSourceVideoDimensions,
  setPreviewVideoDuration,
  setPreviewVideoCurrentTime,
  setPreviewVideoPlaying,
  setPreviewAssetId,
  eyedropperMode,
  setEyedropperMode,
  videoFrameWrapperRef,
  videoFrameSize,
  effectiveDimensions,
  activeTimeline,
  transformInteractionRef,
  clickedTextOverlayRef,
  sampleColorAtEvent,
  selectVisualClipAtPoint,
  previewZoom,
  previewPan,
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
  cachedVideoRefA,
  cachedVideoRefB,
  hasActiveCache,
  activeCacheSlot,
  activeAdjustmentEffects,
  stickerImageRefs,
  activeSubtitles,
  tracks,
  activeLetterbox,
  activeTextClips,
  selectedClipIds,
  playbackTimeRef,
  selectedClip,
  assets,
  cropMode,
  maskMode,
  showSafeZoneGuide,
  onSelectClip,
  onShowPropertiesPanel,
  onUpdateTextPosition,
  onUpdateTextFontSize,
  onUpdateTextMaxWidth,
  onUpdateTextRotation,
  onDeleteClips,
  onToggleCropMode,
  onUpdateTransform,
  onPreviewTransform,
  onUpdateMask,
}) => {
  if (clips.length === 0 && !isPreviewingVideo) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-48 h-28 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center mb-4 mx-auto">
            <Layers className="h-8 w-8 text-zinc-600 mb-2" />
            <p className="text-zinc-500 text-xs">Drop clips here</p>
          </div>
          <p className="text-zinc-600 text-xs">Click assets or drag them to the timeline</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={previewZoom !== 'fit' ? {
        transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${(previewZoom as number) / 100})`,
        transformOrigin: 'center center',
      } : undefined}
    >
      {/* Dedicated Source Video Preview */}
      {isPreviewingVideo && previewAsset && (
        <SourceVideoPreview
          previewAsset={previewAsset}
          sourceVideoDimensions={sourceVideoDimensions}
          sourceVideoFrameSize={sourceVideoFrameSize}
          videoRef={previewVideoRef}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) {
              setSourceVideoDimensions({ width: v.videoWidth, height: v.videoHeight })
            }
            setPreviewVideoDuration(v.duration || previewAsset.duration || 0)
          }}
          onTimeUpdate={(e) => {
            setPreviewVideoCurrentTime(e.currentTarget.currentTime)
          }}
          onPlay={() => setPreviewVideoPlaying(true)}
          onPause={() => setPreviewVideoPlaying(false)}
          onTogglePlay={(e) => {
            e.stopPropagation()
            if (previewVideoRef.current) {
              if (previewVideoRef.current.paused) {
                previewVideoRef.current.play().catch(() => {})
              } else {
                previewVideoRef.current.pause()
              }
            }
          }}
          onClose={() => setPreviewAssetId(null)}
          closeTooltip="Close preview (Esc)"
        />
      )}

      {/* Eyedropper active banner */}
      {eyedropperMode && !isPreviewingVideo && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-600/90 text-white text-xs shadow-lg backdrop-blur-sm pointer-events-auto">
          <Pipette className="h-3.5 w-3.5 animate-bounce" />
          <span>Click video to sample chroma key background color (Esc to cancel)</span>
          <button
            type="button"
            onClick={() => setEyedropperMode(false)}
            className="ml-1 text-zinc-200 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Video frame wrapper — background with exact timeline dimensions & aspect ratio */}
      <div
        ref={videoFrameWrapperRef}
        className={`relative bg-black shadow-2xl ${isPreviewingVideo ? 'hidden' : ''}`}
        style={{
          display: isPreviewingVideo ? 'none' : undefined,
          cursor: eyedropperMode ? 'crosshair' : undefined,
          ...(videoFrameSize.width > 0
            ? { width: videoFrameSize.width, height: videoFrameSize.height }
            : {
                width: '100%',
                aspectRatio: `${effectiveDimensions.width} / ${effectiveDimensions.height}`,
              }),
          backgroundColor:
            activeTimeline?.background?.type === 'color' && activeTimeline.background.color
              ? activeTimeline.background.color
              : '#000000',
        }}
        onPointerDown={() => {
          transformInteractionRef.current = false
          clickedTextOverlayRef.current = false
        }}
        onClick={(e) => {
          if (clickedTextOverlayRef.current) {
            return
          }
          if (eyedropperMode) {
            e.stopPropagation()
            sampleColorAtEvent(e)
            return
          }
          selectVisualClipAtPoint(e)
        }}
      >
        {/* Media rendering layers */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <MonitorCompositingStack
            activeTimeline={activeTimeline}
            effectiveDimensions={effectiveDimensions}
            frameScene={frameScene}
            compositingStack={compositingStack}
            activeClip={activeClip ?? null}
            activeStickerClips={activeStickerClips}
            crossDissolveState={crossDissolveState}
            isPlaying={isPlaying}
            currentTime={currentTime}
            getClipPath={getClipPath}
            blurCanvasRef={blurCanvasRef}
            videoPoolContainerRef={videoPoolContainerRef}
            lutCanvasRef={lutCanvasRef}
            incomingLutCanvasRef={incomingLutCanvasRef}
            incomingDissolveVideoRef={incomingDissolveVideoRef}
            incomingDissolveImageRef={incomingDissolveImageRef}
            transitionBgRef={transitionBgRef}
            compositingMediaRefs={compositingMediaRefs}
            compositingSlotMapRef={compositingSlotMapRef}
            compLutCanvasRefs={compLutCanvasRefs}
            videoPoolRef={videoPoolRef}
            activePoolPathRef={activePoolPathRef}
            attachActiveImage={attachActiveImage}
            activeImageEl={activeImageEl}
            applyFrameVisuals={applyFrameVisuals}
            lastFrameRequestRef={lastFrameRequestRef}
            webCodecsFrame={webCodecsFrame}
          />

          {/* Pre-rendered complex segment render cache overlay (double buffered A/B) */}
          <video
            ref={cachedVideoRefA}
            className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${
              hasActiveCache && isPlaying ? (activeCacheSlot === 0 ? 'z-[15] opacity-100' : 'z-[14] opacity-0') : 'hidden'
            }`}
            muted
            playsInline
            preload="auto"
          />
          <video
            ref={cachedVideoRefB}
            className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${
              hasActiveCache && isPlaying ? (activeCacheSlot === 1 ? 'z-[15] opacity-100' : 'z-[14] opacity-0') : 'hidden'
            }`}
            muted
            playsInline
            preload="auto"
          />

          <MonitorMediaOverlays
            activeAdjustmentEffects={activeAdjustmentEffects}
            activeStickerClips={activeStickerClips}
            stickerImageRefs={stickerImageRefs}
            getClipPath={getClipPath}
            lastFrameRequestRef={lastFrameRequestRef}
            applyFrameVisuals={applyFrameVisuals}
            activeSubtitles={activeSubtitles}
            tracks={tracks}
            activeLetterbox={activeLetterbox}
          />
        </div>

        <MonitorInteractiveOverlays
          activeTextClips={activeTextClips}
          selectedClipIds={selectedClipIds}
          currentTime={currentTime}
          isPlaying={isPlaying}
          playbackTimeRef={playbackTimeRef}
          frameElement={videoFrameWrapperRef.current}
          selectedClip={selectedClip}
          assets={assets}
          videoFrameSize={videoFrameSize}
          cropMode={cropMode}
          maskMode={maskMode}
          showSafeZoneGuide={showSafeZoneGuide}
          activeImageEl={activeImageEl}
          videoPoolRef={videoPoolRef}
          activePoolPathRef={activePoolPathRef}
          onSelectClip={onSelectClip}
          onShowPropertiesPanel={onShowPropertiesPanel}
          onUpdateTextPosition={onUpdateTextPosition}
          onUpdateTextFontSize={onUpdateTextFontSize}
          onUpdateTextMaxWidth={onUpdateTextMaxWidth}
          onUpdateTextRotation={onUpdateTextRotation}
          onDeleteClips={onDeleteClips}
          onClickedTextOverlay={(flag) => { clickedTextOverlayRef.current = flag }}
          onTransformInteractionStart={() => { transformInteractionRef.current = true }}
          onTransformInteractionEnd={(moved) => { transformInteractionRef.current = moved }}
          onToggleCropMode={onToggleCropMode}
          onUpdateTransform={onUpdateTransform}
          onPreviewTransform={onPreviewTransform}
          onUpdateMask={onUpdateMask}
        />
      </div>

      <div className="absolute inset-0 z-20 pointer-events-none" />
    </div>
  )
}
