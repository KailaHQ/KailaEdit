import React from 'react'
import { Layers } from 'lucide-react'
import type { TimelineClip, Asset } from '../../types/project-model'
import { formatTime } from './video-editor-utils'

import { getEffectiveTimelineDimensions } from '@core/video-resolution'
import { type LutCanvasRef } from './preview/LutCanvas'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import { useSettings } from '../../contexts/SettingsContext'
import { useTranslation } from '../../i18n/I18nContext'
import {
  selectActiveTimeline,
  selectAssets,
  selectClips,
  selectCropMode,
  selectCurrentTime,
  selectContentDuration,
  selectEyedropperMode,
  selectIsPlaying,
  selectMaskMode,
  selectPreviewAsset,
  selectSelectedClipForProperties,
  selectSelectedClipIds,
  selectSubtitles,
  selectTotalDuration,
  selectTracks,
} from './editor-selectors'
import { clipScreenBox } from '@core/video-editor-utils'

import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { useRenderCacheStore } from './render-cache-store'
import { useStabilizedClips } from './useStabilizedClips'

import {
  type FrameRenderState,
  type VideoContributorSyncState,
  resolveClipPathFromAssets,
  buildFrameRenderCache,
  EMPTY_TRANSITIONS,
} from './preview/preview-frame-engine'
import { useVideoPoolManager, type VideoPoolRefs } from './preview/useVideoPoolManager'
import { useFrameRenderer, type FrameRendererRefs, type FrameRendererDeps, type TransformOverride } from './preview/useFrameRenderer'
import { MonitorTransportBar } from './preview/MonitorTransportBar'
import { useWebCodecsPreview } from './preview/webcodecs/useWebCodecsPreview'
import { isTimelineShapeClip, timelineShapeToDataUrl } from './timeline-shape-utils'
import { useMonitorDrop } from './preview/useMonitorDrop'
import { useMonitorEyedropper } from './preview/useMonitorEyedropper'
import { MonitorHeader } from './preview/MonitorHeader'
import { useMonitorZoomPan } from './preview/useMonitorZoomPan'
import { useMonitorPlaybackLoop } from './preview/useMonitorPlaybackLoop'
import { MonitorStage } from './preview/MonitorStage'

export interface ProgramMonitorProps {
  playbackTimeRef: React.MutableRefObject<number>
  kbLayout: KeyboardLayout
  importFiles?: (files: FileList | File[]) => Promise<Asset[]>
}

export interface ProgramMonitorHandle {
  toggleFullscreen: () => void
}

export const ProgramMonitor = React.forwardRef<ProgramMonitorHandle, ProgramMonitorProps>(function ProgramMonitor({
  playbackTimeRef,
  kbLayout,
  importFiles,
}: ProgramMonitorProps, ref) {
  const {
    clearClipSelection,
    pause,
    play,
    selectClip,
    setClipTextPosition,
    setClipTextStyleField,
    deleteClips,
    setCurrentTime,
    setShowPropertiesPanel,
    stepCurrentTime,
    openProjectSettingsModal,
    setClipTransform,
    setCropMode,
    toggleCropMode,
    setClipMask,
    setEyedropperMode,
    setClipChromaKey,
    setPreviewAssetId,
    insertAssetsToTimeline,
  } = useEditorActions()
  const { t } = useTranslation()

  const currentTime = useEditorStore(selectCurrentTime)
  const totalDuration = useEditorStore(selectTotalDuration)
  const contentDuration = useEditorStore(selectContentDuration)
  const getEditorState = useEditorGetState()
  const isPlaying = useEditorStore(selectIsPlaying)
  const assets = useEditorStore(selectAssets)
  const previewAsset = useEditorStore(selectPreviewAsset)
  const isPreviewingVideo = Boolean(previewAsset && previewAsset.type === 'video')

  const [sourceVideoDimensions, setSourceVideoDimensions] = React.useState<{ width: number; height: number } | null>(null)
  const [previewVideoPlaying, setPreviewVideoPlaying] = React.useState(true)
  const [previewVideoCurrentTime, setPreviewVideoCurrentTime] = React.useState(0)
  const [previewVideoDuration, setPreviewVideoDuration] = React.useState(0)
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null)

  React.useEffect(() => {
    if (previewAsset && previewAsset.type === 'video') {
      if (previewAsset.width && previewAsset.height) {
        setSourceVideoDimensions({ width: previewAsset.width, height: previewAsset.height })
      } else {
        setSourceVideoDimensions(null)
      }
      setPreviewVideoPlaying(true)
      setPreviewVideoCurrentTime(0)
      setPreviewVideoDuration(previewAsset.duration || 0)
    } else {
      setSourceVideoDimensions(null)
      setPreviewVideoPlaying(false)
    }
  }, [previewAsset?.id, previewAsset?.type, previewAsset?.width, previewAsset?.height, previewAsset?.duration])

  React.useEffect(() => {
    const handleToggle = () => {
      if (!isPreviewingVideo || !previewVideoRef.current) return
      if (previewVideoRef.current.paused) {
        previewVideoRef.current.play().then(() => setPreviewVideoPlaying(true)).catch(() => {})
      } else {
        previewVideoRef.current.pause()
        setPreviewVideoPlaying(false)
      }
    }
    window.addEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
    return () => window.removeEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
  }, [isPreviewingVideo])

  // Stabilized clips play their baked file; everything below sees them already swapped.
  const clips = useStabilizedClips(useEditorStore(selectClips), assets)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const { settings } = useSettings()
  const proxyEnabled = settings.proxyEnabled
  const getClipPath = React.useCallback(
    (clip: TimelineClip) => resolveClipPathFromAssets(assets, clip, proxyEnabled),
    [assets, proxyEnabled],
  )
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const cropMode = useEditorStore(selectCropMode)
  const maskMode = useEditorStore(selectMaskMode)
  const eyedropperMode = useEditorStore(selectEyedropperMode)
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const activeTimelineName = activeTimeline?.name ?? ''
  const activeTimelineFps = activeTimeline?.fps
  const fps = activeTimelineFps ?? settings.defaultFps ?? 30
  const timecodeFormat = settings.timecodeFormat ?? 'timecode'

  const effectiveDimensions = React.useMemo(() => {
    return getEffectiveTimelineDimensions(activeTimeline, assets, fps)
  }, [activeTimeline, assets, fps])

  const clickedTextOverlayRef = React.useRef(false)
  const transformInteractionRef = React.useRef(false)
  const previewContainerRef = React.useRef<HTMLDivElement>(null)
  const videoFrameWrapperRef = React.useRef<HTMLDivElement>(null)
  const videoPoolContainerRef = React.useRef<HTMLDivElement>(null)
  const incomingDissolveVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const incomingDissolveImageRef = React.useRef<HTMLImageElement | null>(null)
  const activeImageRef = React.useRef<HTMLImageElement | null>(null)
  const [activeImageEl, setActiveImageEl] = React.useState<HTMLImageElement | null>(null)
  const attachActiveImage = React.useCallback((element: HTMLImageElement | null) => {
    activeImageRef.current = element
    setActiveImageEl(element)
  }, [])
  const lutCanvasRef = React.useRef<LutCanvasRef>(null)
  const incomingLutCanvasRef = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef0 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef1 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRef2 = React.useRef<LutCanvasRef>(null)
  const compLutCanvasRefs = React.useMemo(
    () => [compLutCanvasRef0, compLutCanvasRef1, compLutCanvasRef2],
    [],
  )
  const compositingSlotMapRef = React.useRef<Map<string, number>>(new Map())
  const blurCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const transitionBgRef = React.useRef<HTMLDivElement | null>(null)
  const videoPoolRef = React.useRef<Map<string, HTMLVideoElement>>(new Map())
  const compositingMediaRefs = React.useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  const stickerImageRefs = React.useRef<Map<string, HTMLImageElement>>(new Map())
  const activePoolPathRef = React.useRef('')
  const activePoolClipIdRef = React.useRef<string | null>(null)
  const contributorSyncStatesRef = React.useRef<Map<string, VideoContributorSyncState>>(new Map())
  const preSeekDoneRef = React.useRef<string | null>(null)
  const clipsRef = React.useRef(clips)
  const tracksRef = React.useRef(tracks)
  const getClipPathRef = React.useRef(getClipPath)
  const cachedSegments = useRenderCacheStore(state => state.segments)
  const cachedSegmentsRef = React.useRef(cachedSegments)
  cachedSegmentsRef.current = cachedSegments
  const cachedVideoRefA = React.useRef<HTMLVideoElement | null>(null)
  const cachedVideoRefB = React.useRef<HTMLVideoElement | null>(null)

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [playbackResOpen, setPlaybackResOpen] = React.useState(false)
  const [playbackResolution, setPlaybackResolution] = React.useState<1 | 0.5 | 0.25>(0.5)
  const [videoFrameSize, setVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [sourceVideoFrameSize, setSourceVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [showSafeZoneGuide, setShowSafeZoneGuide] = React.useState(false)

  const {
    previewZoom,
    setPreviewZoom,
    previewPan,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handlePanMouseLeave,
  } = useMonitorZoomPan({ containerRef: previewContainerRef })

  const { isDragOver, handleDragOver, handleDragLeave, handleDrop } = useMonitorDrop({
    importFiles,
    currentTime,
    setPreviewAssetId,
    insertAssetsToTimeline,
    assets,
  })

  React.useEffect(() => {
    const container = previewContainerRef.current
    if (!container) return

    const updateFrameSize = () => {
      const rect = container.getBoundingClientRect()
      const cw = rect.width
      const ch = rect.height
      if (cw <= 0 || ch <= 0) return
      const containerRatio = cw / ch

      const timelineRatio = effectiveDimensions.aspectRatio || 16 / 9
      let tfw: number
      let tfh: number
      if (containerRatio > timelineRatio) {
        tfh = ch
        tfw = ch * timelineRatio
      } else {
        tfw = cw
        tfh = cw / timelineRatio
      }
      const tw = Math.round(tfw)
      const th = Math.round(tfh)
      setVideoFrameSize(prev => (prev.width === tw && prev.height === th ? prev : { width: tw, height: th }))

      if (isPreviewingVideo) {
        const sourceRatio = sourceVideoDimensions
          ? sourceVideoDimensions.width / sourceVideoDimensions.height
          : (previewAsset?.width && previewAsset?.height ? previewAsset.width / previewAsset.height : 16 / 9)
        let sfw: number
        let sfh: number
        if (containerRatio > sourceRatio) {
          sfh = ch
          sfw = ch * sourceRatio
        } else {
          sfw = cw
          sfh = cw / sourceRatio
        }
        const sw = Math.round(sfw)
        const sh = Math.round(sfh)
        setSourceVideoFrameSize(prev => (prev.width === sw && prev.height === sh ? prev : { width: sw, height: sh }))
      }
    }

    updateFrameSize()
    const observer = new ResizeObserver(() => updateFrameSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [effectiveDimensions.aspectRatio, isPreviewingVideo, sourceVideoDimensions, previewAsset?.width, previewAsset?.height])

  const timelineTransitions = useEditorStore(
    state => selectActiveTimeline(state)?.transitions ?? EMPTY_TRANSITIONS,
  )
  const frameRenderCache = React.useMemo(
    () => buildFrameRenderCache(clips, subtitles, timelineTransitions),
    [clips, subtitles, timelineTransitions],
  )
  const frameRenderCacheRef = React.useRef(frameRenderCache)
  const playbackTimecodeRef = React.useRef<HTMLSpanElement | null>(null)

  const toggleFullscreen = React.useCallback(() => {
    const el = previewContainerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {})
      return
    }
    el.requestFullscreen().catch(() => {})
  }, [])

  React.useImperativeHandle(ref, () => ({ toggleFullscreen }), [toggleFullscreen])

  React.useEffect(() => { clipsRef.current = clips }, [clips])
  React.useEffect(() => { tracksRef.current = tracks }, [tracks])
  React.useEffect(() => { getClipPathRef.current = getClipPath }, [getClipPath])
  React.useEffect(() => { frameRenderCacheRef.current = frameRenderCache }, [frameRenderCache])

  const resolveClipPathRef = React.useCallback((clip: TimelineClip): string => {
    const resolved = getClipPathRef.current(clip)
    return resolved || clip.asset?.path || ''
  }, [])

  const getNextVideoClipRef = React.useCallback((afterClip: TimelineClip): TimelineClip | null => {
    const all = clipsRef.current
    const endTime = afterClip.startTime + afterClip.duration
    let best: TimelineClip | null = null
    for (const clip of all) {
      if (clip.type === 'audio' || clip.type === 'adjustment' || clip.type === 'text') continue
      if (clip.asset?.type !== 'video') continue
      if (clip.startTime >= endTime - 0.01) {
        if (!best || clip.startTime < best.startTime) best = clip
      }
    }
    return best
  }, [])

  const lastFrameRequestRef = React.useRef<{ state: FrameRenderState; mode: import('./preview/preview-frame-engine').MonitorRenderMode } | null>(null)
  const poolRefs: VideoPoolRefs = {
    videoPoolRef,
    videoPoolContainerRef,
    activePoolPathRef,
    activePoolClipIdRef,
    contributorSyncStatesRef,
    preSeekDoneRef,
    compositingMediaRefs,
    clipsRef,
    lastFrameRequestRef,
  }

  const poolManager = useVideoPoolManager(
    poolRefs,
    resolveClipPathRef,
    getNextVideoClipRef,
    playbackTimeRef,
    playbackResolution,
  )
  const { destroyPoolVideo } = poolManager

  const transformOverrideRef = React.useRef<TransformOverride | null>(null)
  const transformPreviewRafRef = React.useRef(0)

  const frameRendererRefs: FrameRendererRefs = {
    activeImageRef,
    lutCanvasRef,
    incomingLutCanvasRef,
    compLutCanvasRefs,
    compositingSlotMapRef,
    blurCanvasRef,
    transitionBgRef,
    incomingDissolveVideoRef,
    incomingDissolveImageRef,
    stickerImageRefs,
    cachedVideoRefA,
    cachedVideoRefB,
    playbackTimecodeRef,
    transformOverrideRef,
  }

  const frameRendererDeps: FrameRendererDeps = {
    tracksRef,
    frameRenderCacheRef,
    cachedSegmentsRef: cachedSegmentsRef as React.MutableRefObject<import('./render-cache-store').CachedSegmentInfo[]>,
    activeTimeline,
    playbackResolution,
    fps,
    timecodeFormat: timecodeFormat as import('./video-editor-utils').TimecodeDisplayFormat,
    resolveClipPathRef,
    getNextVideoClipRef,
  }

  const {
    frameScene,
    hasActiveCache,
    activeCacheSlot,
    applyFrameVisuals,
    renderFrame,
  } = useFrameRenderer(poolManager, poolRefs, frameRendererRefs, frameRendererDeps, playbackTimeRef)

  useMonitorPlaybackLoop({
    isPlaying,
    playbackTimeRef,
    currentTime,
    clips,
    subtitles,
    tracks,
    isPreviewingVideo,
    playbackResolution,
    videoPoolRef,
    cachedVideoRefA,
    cachedVideoRefB,
    lastFrameRequestRef,
    lutCanvasRef,
    destroyPoolVideo,
    renderFrame,
    applyFrameVisuals,
    containerRef: previewContainerRef,
    setIsFullscreen,
    selectedClip,
    cropMode,
    eyedropperMode,
    toggleCropMode,
    setCropMode,
    setEyedropperMode,
    setPreviewAssetId,
  })

  React.useLayoutEffect(() => {
    const lastFrame = lastFrameRequestRef.current
    if (!lastFrame) return
    applyFrameVisuals(lastFrame.state, lastFrame.mode)
  }, [applyFrameVisuals, frameScene])

  React.useEffect(() => {
    if (!playbackResOpen) return
    const handler = () => setPlaybackResOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [playbackResOpen])

  const handlePreviewTransform = React.useCallback((transform: TimelineClip['transform'] | null) => {
    const clip = selectedClip
    if (!transform || !clip) {
      transformOverrideRef.current = null
      return
    }
    transformOverrideRef.current = { clipId: clip.id, transform }
    if (transformPreviewRafRef.current) return
    transformPreviewRafRef.current = requestAnimationFrame(() => {
      transformPreviewRafRef.current = 0
      const override = transformOverrideRef.current
      if (!override) return
      const last = lastFrameRequestRef.current
      if (last) applyFrameVisuals(last.state, last.mode)
      const shapeImage = stickerImageRefs.current.get(override.clipId)
      if (shapeImage && isTimelineShapeClip(clip)) {
        const src = timelineShapeToDataUrl(clip, override.transform)
        if (shapeImage.getAttribute('src') !== src) shapeImage.setAttribute('src', src)
      }
    })
  }, [selectedClip, applyFrameVisuals])

  React.useEffect(() => () => {
    if (transformPreviewRafRef.current) cancelAnimationFrame(transformPreviewRafRef.current)
  }, [])

  const activeClip = frameScene.activeClip
  const compositingStack = frameScene.compositingStack
  const activeTextClips = frameScene.activeTextClips
  const activeStickerClips = frameScene.activeStickerClips

  const { videoFrame: webCodecsFrame } = useWebCodecsPreview({
    activeClip: activeClip ?? null,
    currentTime,
    isPlaying,
    resolveClipPath: getClipPath,
    enabled: !activeClip?.autoMatte?.enabled,
  })

  const selectVisualClipAtPoint = React.useCallback((event: React.MouseEvent) => {
    if (transformInteractionRef.current) {
      transformInteractionRef.current = false
      return
    }

    const wrapper = videoFrameWrapperRef.current
    if (!wrapper) {
      clearClipSelection()
      return
    }

    const rect = wrapper.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const frame = { width: rect.width, height: rect.height }

    const candidates = [...compositingStack, ...(activeClip ? [activeClip] : []), ...activeStickerClips]
    for (let i = candidates.length - 1; i >= 0; i--) {
      const clip = candidates[i]
      if (!clip || clip.type === 'audio') continue
      const asset = clip.assetId ? assets.find(a => a.id === clip.assetId) : clip.asset
      const box = clipScreenBox(frame, asset, clip.transform)
      if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
        selectClip(clip.id)
        return
      }
    }

    clearClipSelection()
  }, [activeClip, activeStickerClips, assets, clearClipSelection, compositingStack, selectClip])

  const activeSubtitles = frameScene.activeSubtitles
  const activeLetterbox = frameScene.activeLetterbox
  const activeAdjustmentEffects = frameScene.activeAdjustmentEffects
  const crossDissolveState = frameScene.crossDissolve
    ? {
      ...frameScene.crossDissolve,
      progress: lastFrameRequestRef.current?.state.crossDissolveProgress ?? 0,
    }
    : null

  const { sampleColorAtEvent } = useMonitorEyedropper({
    selectedClip,
    activeClip: activeClip ?? null,
    videoFrameWrapperRef,
    activeImageRef,
    videoPoolRef,
    activePoolPathRef,
    setClipChromaKey,
    setEyedropperMode,
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-zinc-900">
      <MonitorHeader
        activeTimelineName={activeTimelineName}
        isPreviewingVideo={isPreviewingVideo}
        sourceVideoDimensions={sourceVideoDimensions}
        effectiveDimensions={effectiveDimensions}
        showSafeZoneGuide={showSafeZoneGuide}
        onToggleSafeZoneGuide={() => setShowSafeZoneGuide(prev => !prev)}
        onOpenProjectSettings={() => openProjectSettingsModal()}
      />

      <div
        ref={previewContainerRef}
        className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${isFullscreen ? 'bg-black' : ''}`}
        style={{ backgroundColor: '#000', ...(previewZoom !== 'fit' ? { cursor: 'grab' } : {}) }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={(e) => {
          if (isPreviewingVideo && !((e.target as HTMLElement).closest('[data-source-video-preview]'))) {
            setPreviewAssetId(null)
          }
        }}
        onMouseDown={handlePanMouseDown}
        onMouseMove={handlePanMouseMove}
        onMouseUp={handlePanMouseUp}
        onMouseLeave={handlePanMouseLeave}
      >
        {isDragOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-600/20 border-2 border-dashed border-blue-400 backdrop-blur-[2px] pointer-events-none">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/95 text-white font-medium text-xs shadow-2xl border border-blue-500/40">
              <Layers className="w-4 h-4 text-blue-400 animate-bounce" />
              <span>{t('monitor.dropVideoPrompt', { time: formatTime(currentTime, fps, timecodeFormat) })}</span>
            </div>
          </div>
        )}

        <MonitorStage
          clips={clips}
          isPreviewingVideo={isPreviewingVideo}
          previewAsset={previewAsset}
          sourceVideoDimensions={sourceVideoDimensions}
          sourceVideoFrameSize={sourceVideoFrameSize}
          previewVideoRef={previewVideoRef}
          setSourceVideoDimensions={setSourceVideoDimensions}
          setPreviewVideoDuration={setPreviewVideoDuration}
          setPreviewVideoCurrentTime={setPreviewVideoCurrentTime}
          setPreviewVideoPlaying={setPreviewVideoPlaying}
          setPreviewAssetId={setPreviewAssetId}
          eyedropperMode={eyedropperMode}
          setEyedropperMode={setEyedropperMode}
          videoFrameWrapperRef={videoFrameWrapperRef}
          videoFrameSize={videoFrameSize}
          effectiveDimensions={effectiveDimensions}
          activeTimeline={activeTimeline}
          transformInteractionRef={transformInteractionRef}
          clickedTextOverlayRef={clickedTextOverlayRef}
          sampleColorAtEvent={sampleColorAtEvent}
          selectVisualClipAtPoint={selectVisualClipAtPoint}
          previewZoom={previewZoom}
          previewPan={previewPan}
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
          cachedVideoRefA={cachedVideoRefA}
          cachedVideoRefB={cachedVideoRefB}
          hasActiveCache={hasActiveCache}
          activeCacheSlot={activeCacheSlot}
          activeAdjustmentEffects={activeAdjustmentEffects}
          stickerImageRefs={stickerImageRefs}
          activeSubtitles={activeSubtitles}
          tracks={tracks}
          activeLetterbox={activeLetterbox}
          activeTextClips={activeTextClips}
          selectedClipIds={selectedClipIds}
          playbackTimeRef={playbackTimeRef}
          selectedClip={selectedClip ?? null}
          assets={assets}
          cropMode={cropMode}
          maskMode={maskMode}
          showSafeZoneGuide={showSafeZoneGuide}
          onSelectClip={(id) => {
            clickedTextOverlayRef.current = true
            selectClip(id)
          }}
          onShowPropertiesPanel={() => setShowPropertiesPanel(true)}
          onUpdateTextPosition={(clipId, posX, posY) => setClipTextPosition(clipId, posX, posY)}
          onUpdateTextFontSize={(clipId, fontSize) => setClipTextStyleField(clipId, 'fontSize', fontSize)}
          onUpdateTextMaxWidth={(clipId, maxWidth) => setClipTextStyleField(clipId, 'maxWidth', maxWidth)}
          onUpdateTextRotation={(clipId, rotation) => setClipTransform(clipId, { rotation })}
          onDeleteClips={(ids) => deleteClips(ids)}
          onToggleCropMode={() => toggleCropMode()}
          onUpdateTransform={(patch, options) => {
            if (selectedClip) {
              setClipTransform(selectedClip.id, patch, options)
            }
          }}
          onPreviewTransform={handlePreviewTransform}
          onUpdateMask={(patch) => {
            if (selectedClip) {
              setClipMask(selectedClip.id, patch)
            }
          }}
        />
      </div>

      <MonitorTransportBar
        playbackTimecodeRef={playbackTimecodeRef}
        isPreviewingVideo={isPreviewingVideo}
        previewVideoPlaying={previewVideoPlaying}
        previewVideoCurrentTime={previewVideoCurrentTime}
        previewVideoDuration={previewVideoDuration}
        currentTime={currentTime}
        contentDuration={contentDuration}
        totalDuration={totalDuration}
        fps={fps}
        timecodeFormat={timecodeFormat}
        isPlaying={isPlaying}
        kbLayout={kbLayout}
        playbackResolution={playbackResolution}
        setPlaybackResolution={setPlaybackResolution}
        previewZoom={previewZoom}
        setPreviewZoom={setPreviewZoom}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onStepBackward={() => {
          if (isPreviewingVideo && previewVideoRef.current) {
            previewVideoRef.current.pause()
            previewVideoRef.current.currentTime = Math.max(0, previewVideoRef.current.currentTime - (1 / fps))
          } else {
            pause()
            stepCurrentTime(-1 / fps)
          }
        }}
        onTogglePlayPause={() => {
          if (isPreviewingVideo && previewVideoRef.current) {
            if (previewVideoRef.current.paused) {
              previewVideoRef.current.play().catch(() => {})
            } else {
              previewVideoRef.current.pause()
            }
          } else {
            if (isPlaying) {
              pause()
            } else {
              const cd = selectContentDuration(getEditorState())
              if (cd > 0 && (currentTime >= cd - 0.04 || playbackTimeRef.current >= cd - 0.04)) {
                playbackTimeRef.current = 0
                setCurrentTime(0)
              }
              play()
            }
          }
        }}
        onStepForward={() => {
          if (isPreviewingVideo && previewVideoRef.current) {
            previewVideoRef.current.pause()
            previewVideoRef.current.currentTime = Math.min(previewVideoDuration, previewVideoRef.current.currentTime + (1 / fps))
          } else {
            pause()
            setCurrentTime(Math.min(contentDuration > 0 ? contentDuration : totalDuration, currentTime + (1 / fps)))
          }
        }}
      />
    </div>
  )
})
