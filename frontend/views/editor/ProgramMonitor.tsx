import React from 'react'
import {
  Layers, Menu, Pipette, Shield,
} from 'lucide-react'
import { pathToFileUrl } from '../../lib/file-url'
import type { TimelineClip } from '../../types/project-model'

import { getEffectiveTimelineDimensions } from '@core/video-resolution'
import { type LutCanvasRef } from './preview/LutCanvas'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import { useSettings } from '../../contexts/SettingsContext'
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
import { TransformBoundingBox } from './preview/TransformBoundingBox'
import { clipScreenBox } from '@core/video-editor-utils'

import { MaskBoundingBox } from './preview/MaskBoundingBox'
import { TextBoundingBox } from './preview/TextBoundingBox'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { useRenderCacheStore } from './render-cache-store'

import {
  type FrameRenderState,
  type VideoContributorSyncState,
  resolveClipPathFromAssets,
  applyPlaybackResolution,
  buildFrameRenderCache,
  isImageClip,
  EMPTY_TRANSITIONS,
} from './preview/preview-frame-engine'
import { useVideoPoolManager, type VideoPoolRefs } from './preview/useVideoPoolManager'
import { useFrameRenderer, type FrameRendererRefs, type FrameRendererDeps } from './preview/useFrameRenderer'
import { MonitorSubtitlesOverlay } from './preview/MonitorSubtitlesOverlay'
import { MonitorLetterbox } from './preview/MonitorLetterbox'
import { MonitorSafeZoneGuide } from './preview/MonitorSafeZoneGuide'
import { SourceVideoPreview } from './preview/SourceVideoPreview'
import { MonitorTransportBar } from './preview/MonitorTransportBar'
import { MonitorCompositingStack } from './preview/MonitorCompositingStack'
import { useWebCodecsPreview } from './preview/webcodecs/useWebCodecsPreview'

export interface ProgramMonitorProps {
  playbackTimeRef: React.MutableRefObject<number>
  kbLayout: KeyboardLayout
}

export interface ProgramMonitorHandle {
  toggleFullscreen: () => void
}

export const ProgramMonitor = React.forwardRef<ProgramMonitorHandle, ProgramMonitorProps>(function ProgramMonitor({
  playbackTimeRef,
  kbLayout,
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
  } = useEditorActions()

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

  const clips = useEditorStore(selectClips)
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

  // Press 'C' to toggle Crop mode for selected visual clip, Esc to exit crop / eyedropper / preview
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        if (selectedClip && (selectedClip.type === 'video' || selectedClip.type === 'image')) {
          e.preventDefault()
          toggleCropMode()
        }
      } else if (e.key === 'Escape') {
        if (cropMode) {
          e.preventDefault()
          setCropMode(false)
        }
        if (eyedropperMode) {
          e.preventDefault()
          setEyedropperMode(false)
        }
        if (isPreviewingVideo) {
          e.preventDefault()
          setPreviewAssetId(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cropMode, eyedropperMode, isPreviewingVideo, selectedClip, setCropMode, setEyedropperMode, setPreviewAssetId, toggleCropMode])

  const effectiveDimensions = React.useMemo(() => {
    return getEffectiveTimelineDimensions(activeTimeline, assets, fps)
  }, [activeTimeline, assets, fps])

  // Flag to prevent the video frame wrapper's onClick from clearing selection
  // when the user clicked on a text overlay (mousedown fires first on the overlay,
  // but click may bubble up to the wrapper if the mouse moved slightly).
  const clickedTextOverlayRef = React.useRef(false)
  // Set while a transform handle is being used, so the click that ends the
  // drag does not re-run the selection hit test against a stale rectangle.
  const transformInteractionRef = React.useRef(false)
  const previewContainerRef = React.useRef<HTMLDivElement>(null)
  const videoFrameWrapperRef = React.useRef<HTMLDivElement>(null)
  const videoPoolContainerRef = React.useRef<HTMLDivElement>(null)
  const incomingDissolveVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const incomingDissolveImageRef = React.useRef<HTMLImageElement | null>(null)
  const activeImageRef = React.useRef<HTMLImageElement | null>(null)
  /**
   * The same element as `activeImageRef`, kept in state because the LUT canvas
   * needs it as a prop. A ref read during render is null on the very render
   * that mounts the image, and nothing re-renders when a ref is attached — so
   * the graded canvas was handed `null` and quietly drew nothing, which is why
   * a filter on a still looked like it had not been applied while the same
   * filter on a video (whose element comes from the imperative pool) worked.
   */
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
  /** Sticker overlay images by clip id, styled per frame in applyFrameVisuals. */
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
  const [previewZoom, setPreviewZoom] = React.useState<number | 'fit'>('fit')
  const [previewZoomOpen, setPreviewZoomOpen] = React.useState(false)
  const [previewPan, setPreviewPan] = React.useState({ x: 0, y: 0 })
  const previewPanRef = React.useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [playbackResOpen, setPlaybackResOpen] = React.useState(false)
  const [playbackResolution, setPlaybackResolution] = React.useState<1 | 0.5 | 0.25>(0.5)
  const [videoFrameSize, setVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [sourceVideoFrameSize, setSourceVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [showSafeZoneGuide, setShowSafeZoneGuide] = React.useState(false)

  React.useEffect(() => {
    const container = previewContainerRef.current
    if (!container) return

    const updateFrameSize = () => {
      const rect = container.getBoundingClientRect()
      const cw = rect.width
      const ch = rect.height
      if (cw <= 0 || ch <= 0) return
      const containerRatio = cw / ch

      // Timeline frame dimensions (always follows timeline resolution / ratio)
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

      // Source video preview dimensions (always follows raw asset ratio)
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

    const observer = new ResizeObserver(() => {
      updateFrameSize()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
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

  React.useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  React.useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  React.useEffect(() => {
    getClipPathRef.current = getClipPath
  }, [getClipPath])

  React.useEffect(() => {
    frameRenderCacheRef.current = frameRenderCache
  }, [frameRenderCache])

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
  // ── Video pool & frame rendering hooks ─────────────────────────────────
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

  React.useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      applyPlaybackResolution(video, playbackResolution)
    }
    if (cachedVideoRefA.current) {
      applyPlaybackResolution(cachedVideoRefA.current, playbackResolution)
    }
    if (cachedVideoRefB.current) {
      applyPlaybackResolution(cachedVideoRefB.current, playbackResolution)
    }
  }, [playbackResolution])

  React.useEffect(() => {
    if (!isPlaying) {
      if (cachedVideoRefA.current && !cachedVideoRefA.current.paused) {
        cachedVideoRefA.current.pause()
      }
      if (cachedVideoRefB.current && !cachedVideoRefB.current.paused) {
        cachedVideoRefB.current.pause()
      }
    }
  }, [isPlaying])

  React.useEffect(() => {
    return () => {
      for (const poolPath of Array.from(videoPoolRef.current.keys())) {
        destroyPoolVideo(poolPath)
      }
      for (const ref of [cachedVideoRefA, cachedVideoRefB]) {
        if (ref.current) {
          ref.current.pause()
          ref.current.removeAttribute('src')
          ref.current.load()
        }
      }
    }
  }, [destroyPoolVideo])

  React.useLayoutEffect(() => {
    const lastFrame = lastFrameRequestRef.current
    if (!lastFrame) return
    applyFrameVisuals(lastFrame.state, lastFrame.mode)
  }, [applyFrameVisuals, frameScene])

  React.useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      renderFrame(playbackTimeRef.current, 'playback')
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, playbackTimeRef, renderFrame])

  React.useEffect(() => {
    if (isPlaying) return
    renderFrame(currentTime, 'scrub')
  }, [clips, currentTime, isPlaying, renderFrame, subtitles, tracks])

  // Re-sync timeline visuals when exiting video preview mode so there is never a black screen
  React.useEffect(() => {
    if (!isPreviewingVideo) {
      lastFrameRequestRef.current = null
      renderFrame(currentTime, 'scrub')
      requestAnimationFrame(() => {
        lutCanvasRef.current?.renderNow()
        const last = lastFrameRequestRef.current
        if (last) {
          applyFrameVisuals(last.state, last.mode)
        }
      })
    }
  }, [isPreviewingVideo, currentTime, renderFrame, applyFrameVisuals])

  React.useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === previewContainerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  React.useEffect(() => {
    if (!previewZoomOpen) return
    const handler = () => setPreviewZoomOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [previewZoomOpen])

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

  React.useEffect(() => {
    if (previewZoom === 'fit') {
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [previewZoom])

  React.useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setPreviewZoom(prev => {
        const current = prev === 'fit' ? 100 : prev
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        return Math.round(Math.min(1600, Math.max(10, current * delta)))
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])


  // Compositing stack video sync is handled inside renderFrame.

  const activeClip = frameScene.activeClip
  const compositingStack = frameScene.compositingStack
  const activeTextClips = frameScene.activeTextClips
  const activeStickerClips = frameScene.activeStickerClips

  const { videoFrame: webCodecsFrame } = useWebCodecsPreview({
    activeClip: activeClip ?? null,
    currentTime,
    isPlaying,
    resolveClipPath: getClipPath,
    // Matte snapshots must share the transport's source. A second source decoder
    // on the React clock competes with imperative playhead seeks and can redraw old frames.
    enabled: !activeClip?.autoMatte?.enabled,
  })

  /**
   * Clicking the picture selects the clip under the pointer.
   *
   * Every visual clip is drawn with `pointer-events: none` so the compositing
   * layers never swallow a drag, which meant a click always landed on the frame
   * behind them and cleared the selection — selecting a sticker on the timeline
   * and then clicking it on screen made its transform handles disappear.
   *
   * Topmost first: the compositing stack is drawn lowest track first, so walking
   * it backwards picks what the user can actually see.
   */
  const selectVisualClipAtPoint = React.useCallback((event: React.MouseEvent) => {
    // A drag on the bounding box ends with a click here. The clip stays
    // selected: the user is working on it, and re-picking would hand focus to
    // whatever happens to sit under the pointer.
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

  const sampleColorAtEvent = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedClip) {
      setEyedropperMode(false)
      return
    }

    const wrapper = videoFrameWrapperRef.current
    if (!wrapper) {
      setEyedropperMode(false)
      return
    }

    const rect = wrapper.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      setEyedropperMode(false)
      return
    }

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    let sourceEl: HTMLImageElement | HTMLVideoElement | null = null
    if (activeClip && isImageClip(activeClip)) {
      sourceEl = activeImageRef.current
    } else if (activeClip?.asset?.type === 'video') {
      sourceEl = videoPoolRef.current.get(activePoolPathRef.current) ?? null
    }

    if (!sourceEl) {
      setEyedropperMode(false)
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const sw = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.naturalWidth) || 640
      const sh = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.naturalHeight) || 360
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(sourceEl, 0, 0, sw, sh)
        const px = Math.min(sw - 1, Math.max(0, Math.floor(normX * sw)))
        const py = Math.min(sh - 1, Math.max(0, Math.floor(normY * sh)))
        const pixel = ctx.getImageData(px, py, 1, 1).data
        const r = pixel[0].toString(16).padStart(2, '0')
        const g = pixel[1].toString(16).padStart(2, '0')
        const b = pixel[2].toString(16).padStart(2, '0')
        const hex = `#${r}${g}${b}`.toUpperCase()
        setClipChromaKey(selectedClip.id, { color: hex, enabled: true })
      }
    } catch (err) {
      console.warn('[ProgramMonitor] Eyedropper sample failed:', err)
    } finally {
      setEyedropperMode(false)
    }
  }, [activeClip, selectedClip, setClipChromaKey, setEyedropperMode])

  return (
    // h-full, not flex-1: the resizable Panel that hosts this is a plain block,
    // so a flex-grow here would resolve against nothing and the preview would
    // collapse to its content height.
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-zinc-900">
        {/* Player header — names the pane after the timeline it plays. */}
        <div className="flex h-[34px] flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="truncate text-[13px] text-zinc-100 font-medium">
              Player{activeTimelineName ? ` - ${activeTimelineName}` : ''}
            </span>
            {isPreviewingVideo && sourceVideoDimensions ? (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-950/80 text-blue-300 border border-blue-500/40">
                Gốc: {sourceVideoDimensions.width}×{sourceVideoDimensions.height}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => openProjectSettingsModal()}
                className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-teal-400 transition-colors border border-zinc-700/60"
                title="Change project / timeline dimensions"
              >
                {effectiveDimensions.aspectRatioLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSafeZoneGuide(prev => !prev)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                showSafeZoneGuide
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
              }`}
              title="Toggle TikTok / Reels 9:16 Safe Zone Guide"
            >
              <Shield className="h-3 w-3" />
              Safe Zone
            </button>
          </div>
          <button
            type="button"
            onClick={() => openProjectSettingsModal()}
            className="cc-icon-btn"
            title="Project / timeline settings"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>

        {/* Preview (existing) */}
        <div
          ref={previewContainerRef}
          className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${isFullscreen ? 'bg-black' : ''}`}
          style={{ backgroundColor: '#000', ...(previewZoom !== 'fit' ? { cursor: 'grab' } : {}) }}
          onClick={(e) => {
            if (isPreviewingVideo && !((e.target as HTMLElement).closest('[data-source-video-preview]'))) {
              setPreviewAssetId(null)
            }
          }}
          onMouseDown={(e) => {
            if (previewZoom === 'fit') return
            if (e.button !== 0 && e.button !== 1) return
            previewPanRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: previewPan.x, startPanY: previewPan.y }
          }}
          onMouseMove={(e) => {
            if (!previewPanRef.current.dragging) return
            setPreviewPan({
              x: previewPanRef.current.startPanX + (e.clientX - previewPanRef.current.startX),
              y: previewPanRef.current.startPanY + (e.clientY - previewPanRef.current.startY),
            })
          }}
          onMouseUp={() => { previewPanRef.current.dragging = false }}
          onMouseLeave={() => { previewPanRef.current.dragging = false }}
        >
          {clips.length === 0 && !isPreviewingVideo ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-48 h-28 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center mb-4 mx-auto">
                  <Layers className="h-8 w-8 text-zinc-600 mb-2" />
                  <p className="text-zinc-500 text-xs">Drop clips here</p>
                </div>
                <p className="text-zinc-600 text-xs">Click assets or drag them to the timeline</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={previewZoom !== 'fit' ? {
                transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${(previewZoom as number) / 100})`,
                transformOrigin: 'center center',
              } : undefined}
            >
              {/* Dedicated Source Video Preview (completely isolated from timeline overlays) */}
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
                  closeTooltip="Đóng xem trước (Esc)"
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
                className={`relative bg-black overflow-hidden shadow-2xl ${isPreviewingVideo ? 'hidden' : ''}`}
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
                  // The bounding box stops propagation on its own handles, so a
                  // press that reaches the frame is a press outside them. Clearing
                  // here keeps the flag from surviving a drag that ended off-frame
                  // and swallowing the next click.
                  transformInteractionRef.current = false
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

              {/* Sticker overlay clips. Above the picture and any transition
                  between shots, but below the pre-rendered segment cache at
                  z-15, which already has the sticker composited into it. */}
              {activeStickerClips.map(sc => (
                <img
                  key={`sticker-${sc.id}`}
                  src={pathToFileUrl(getClipPath(sc) || sc.asset?.path || '')}
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
              ))}

              {/* Text overlay clips with bounding box & resize/scale/width/rotate handles */}
              {activeTextClips.map(tc => {
                const isSelected = selectedClipIds.has(tc.id)
                return (
                  <TextBoundingBox
                    key={`text-${tc.id}`}
                    clip={tc}
                    isSelected={isSelected}
                    currentTime={currentTime}
                    frameElement={videoFrameWrapperRef.current}
                    onSelect={() => {
                      clickedTextOverlayRef.current = true
                      selectClip(tc.id)
                    }}
                    onDoubleClick={() => {
                      selectClip(tc.id)
                      setShowPropertiesPanel(true)
                    }}
                    onUpdatePosition={(posX, posY) => {
                      setClipTextPosition(tc.id, posX, posY)
                    }}
                    onUpdateFontSize={(fontSize) => {
                      setClipTextStyleField(tc.id, 'fontSize', fontSize)
                    }}
                    onUpdateMaxWidth={(maxWidth) => {
                      setClipTextStyleField(tc.id, 'maxWidth', maxWidth)
                    }}
                    onUpdateRotation={(rotation) => {
                      setClipTransform(tc.id, { rotation })
                    }}
                    onDelete={() => {
                      deleteClips([tc.id])
                    }}
                    onInteractionStart={() => {
                      clickedTextOverlayRef.current = true
                    }}
                    onInteractionEnd={() => {
                      requestAnimationFrame(() => {
                        clickedTextOverlayRef.current = false
                      })
                    }}
                  />
                )
              })}

              {/* Subtitle overlay */}
              <MonitorSubtitlesOverlay activeSubtitles={activeSubtitles} tracks={tracks} />

              {/* Letterbox overlay from adjustment layers */}
              <MonitorLetterbox activeLetterbox={activeLetterbox} />
              {/* Note: Clip-level masks will be implemented in KE-501 (resolved in KE-106). */}

              {/* Transform Bounding Box for active selected visual clip */}
              <TransformBoundingBox
                selectedClip={selectedClip}
                onInteractionStart={() => { transformInteractionRef.current = true }}
                assets={assets}
                videoFrameSize={videoFrameSize}
                currentTime={currentTime}
                cropMode={cropMode}
                onToggleCropMode={() => toggleCropMode()}
                onUpdateTransform={(patch, options) => {
                  if (selectedClip) {
                    setClipTransform(selectedClip.id, patch, options)
                  }
                }}
              />

              {/* Mask Bounding Box for on-screen mask editing */}
              <MaskBoundingBox
                selectedClip={selectedClip}
                assets={assets}
                videoFrameSize={videoFrameSize}
                currentTime={currentTime}
                maskMode={maskMode}
                onUpdateMask={(patch) => {
                  if (selectedClip) {
                    setClipMask(selectedClip.id, patch)
                  }
                }}
              />

              {/* Safe Zone Guide overlay for 9:16 Shorts/Reels */}
              <MonitorSafeZoneGuide show={Boolean(showSafeZoneGuide)} />
              </div>{/* end video frame wrapper */}

              {/* Transparent overlay to prevent video element default interactions */}
              <div
                className="absolute inset-0 z-20 pointer-events-none"
              />
            </div>
          )}

          {/* Timecode + clip info moved to bottom status bar */}
        </div>

        {/* Transport row */}
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
