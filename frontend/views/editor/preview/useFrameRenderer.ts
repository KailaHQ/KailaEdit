import React from 'react'
import type { TimelineClip, Timeline, Track } from '../../../types/project-model'
import { pathToFileUrl } from '../../../lib/file-url'
import { transitionLayerStyles } from '@core/transition-styles'
import { getClipEffectStyles, getTransitionBgColor, formatTime, resolveEffectiveClipFilter, type TimecodeDisplayFormat } from '../video-editor-utils'
import type { LutCanvasRef } from './LutCanvas'
import { useEditorStore } from '../editor-store'
import { selectCustomMatteBrushMode } from '@core/editor-selectors'
import {
  type MonitorRenderMode,
  type FrameOverlayState,
  type FrameRenderState,
  type FrameRenderCache,
  MAX_COMPOSITING_CANVASES,
  VIDEO_POOL_PREROLL_SECONDS,
  isImageClip,
  clipNeedsAlphaCanvas,
  clearEffectStyle,
  applyEffectStyle,
  deriveFrameRenderState,
  sameFrameOverlayState,
  sameFrameRenderState,
  getClipTargetTime,
} from './preview-frame-engine'
import type { UseVideoPoolManagerResult, VideoPoolRefs } from './useVideoPoolManager'
import type { CachedSegmentInfo } from '../render-cache-store'
import { syncCachePlayback, type CacheSlotState } from './cache-video-manager'

/** A transform being dragged on screen, not yet committed to the clip. */
export interface TransformOverride {
  clipId: string
  transform: NonNullable<TimelineClip['transform']>
}

export interface FrameRendererRefs {
  activeImageRef: React.MutableRefObject<HTMLImageElement | null>
  lutCanvasRef: React.RefObject<LutCanvasRef | null>
  incomingLutCanvasRef: React.RefObject<LutCanvasRef | null>
  compLutCanvasRefs: React.RefObject<LutCanvasRef | null>[]
  compositingSlotMapRef: React.MutableRefObject<Map<string, number>>
  blurCanvasRef: React.RefObject<HTMLCanvasElement | null>
  transitionBgRef: React.RefObject<HTMLDivElement | null>
  incomingDissolveVideoRef: React.MutableRefObject<HTMLVideoElement | null>
  incomingDissolveImageRef: React.MutableRefObject<HTMLImageElement | null>
  stickerImageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>
  cachedVideoRefA: React.MutableRefObject<HTMLVideoElement | null>
  cachedVideoRefB: React.MutableRefObject<HTMLVideoElement | null>
  playbackTimecodeRef: React.MutableRefObject<HTMLSpanElement | null>
  /** Set while the transform box is being dragged; that clip is drawn with it. */
  transformOverrideRef?: React.MutableRefObject<TransformOverride | null>
}

export interface FrameRendererDeps {
  tracksRef: React.MutableRefObject<Track[]>
  frameRenderCacheRef: React.MutableRefObject<FrameRenderCache>
  cachedSegmentsRef: React.MutableRefObject<CachedSegmentInfo[]>
  activeTimeline: Timeline | null | undefined
  playbackResolution: 1 | 0.5 | 0.25
  fps: number
  timecodeFormat: TimecodeDisplayFormat
  resolveClipPathRef: (clip: TimelineClip) => string
  getNextVideoClipRef: (afterClip: TimelineClip) => TimelineClip | null
}

export interface UseFrameRendererResult {
  frameScene: FrameOverlayState
  hasActiveCache: boolean
  activeCacheSlot: 0 | 1
  lastFrameRequestRef: React.MutableRefObject<{ state: FrameRenderState; mode: MonitorRenderMode } | null>
  syncFrameScene: (nextState: FrameRenderState) => void
  syncPlaybackTimecode: (time: number) => void
  applyFrameVisuals: (state: FrameRenderState, mode: MonitorRenderMode) => void
  renderFrame: (atTime: number, mode: MonitorRenderMode) => void
}

export function useFrameRenderer(
  poolManager: UseVideoPoolManagerResult,
  poolRefs: VideoPoolRefs,
  frameRefs: FrameRendererRefs,
  deps: FrameRendererDeps,
  _playbackTimeRef: React.MutableRefObject<number>,
): UseFrameRendererResult {
  const {
    ensurePoolVideo,
    syncVideoElement,
    getContributorKey,
    ensureContributorSyncState,
    syncPlaybackContributorVideo,
    syncRetainedPoolVideos,
  } = poolManager

  const {
    videoPoolRef,
    videoPoolContainerRef,
    activePoolPathRef,
    activePoolClipIdRef,
    contributorSyncStatesRef,
    preSeekDoneRef,
    compositingMediaRefs,
    lastFrameRequestRef: poolLastFrameRequestRef,
  } = poolRefs

  const {
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
  } = frameRefs

  const {
    tracksRef,
    frameRenderCacheRef,
    cachedSegmentsRef,
    activeTimeline,
    playbackResolution,
    fps,
    timecodeFormat,
    resolveClipPathRef,
    getNextVideoClipRef,
  } = deps

  const customMatteBrushMode = useEditorStore(selectCustomMatteBrushMode)
  const fallbackLastFrameRequestRef = React.useRef<{ state: FrameRenderState; mode: MonitorRenderMode } | null>(null)
  const lastFrameRequestRef = poolLastFrameRequestRef || fallbackLastFrameRequestRef
  const applyFrameVisualsRef = React.useRef<(state: FrameRenderState, mode: MonitorRenderMode) => void>(() => {})
  const [hasActiveCache, setHasActiveCache] = React.useState(false)
  const [activeCacheSlot, setActiveCacheSlot] = React.useState<0 | 1>(0)
  const cacheSlotStateRef = React.useRef<CacheSlotState>({
    activeSlot: 0,
    hasActiveCache: false,
    slotCachePaths: { 0: null, 1: null },
  })

  const onSlotChange = React.useCallback((slot: 0 | 1) => {
    setActiveCacheSlot(slot)
  }, [])

  const onActiveCacheChange = React.useCallback((active: boolean) => {
    setHasActiveCache(active)
  }, [])

  const [frameScene, setFrameScene] = React.useState<FrameOverlayState>(() => {
    const initial = deriveFrameRenderState(frameRenderCacheRef.current, tracksRef.current, 0)
    return {
      activeClip: initial.activeClip,
      crossDissolve: initial.crossDissolve,
      crossDissolveType: initial.crossDissolveType,
      compositingStack: initial.compositingStack,
      activeTextClips: initial.activeTextClips,
      activeStickerClips: initial.activeStickerClips,
      activeSubtitles: initial.activeSubtitles,
      activeLetterbox: initial.activeLetterbox,
      activeAdjustmentEffects: initial.activeAdjustmentEffects,
      activeFilter: initial.activeFilter,
      incomingFilter: initial.incomingFilter,
      compositingFilters: initial.compositingFilters,
      activeAdjustmentSources: initial.activeAdjustmentSources,
      audioOnlyClips: initial.audioOnlyClips,
    }
  })
  const frameSceneRef = React.useRef(frameScene)

  const syncFrameScene = React.useCallback((nextState: FrameRenderState) => {
    setFrameScene(prevState => {
      const nextOverlayState: FrameOverlayState = {
        activeClip: nextState.activeClip,
        crossDissolve: nextState.crossDissolve,
        crossDissolveType: nextState.crossDissolveType,
        compositingStack: nextState.compositingStack,
        activeTextClips: nextState.activeTextClips,
        activeStickerClips: nextState.activeStickerClips,
        activeSubtitles: nextState.activeSubtitles,
        activeLetterbox: nextState.activeLetterbox,
        activeAdjustmentEffects: nextState.activeAdjustmentEffects,
        activeFilter: nextState.activeFilter,
        incomingFilter: nextState.incomingFilter,
        compositingFilters: nextState.compositingFilters,
        activeAdjustmentSources: nextState.activeAdjustmentSources,
        audioOnlyClips: nextState.audioOnlyClips,
      }
      if (sameFrameOverlayState(prevState, nextOverlayState)) {
        frameSceneRef.current = prevState
        return prevState
      }
      frameSceneRef.current = nextOverlayState
      return nextOverlayState
    })
  }, [])

  const syncPlaybackTimecode = React.useCallback((time: number) => {
    const el = playbackTimecodeRef.current
    if (!el) return
    const nextText = formatTime(time, fps, timecodeFormat)
    if (el.textContent !== nextText) {
      el.textContent = nextText
    }
  }, [fps, playbackTimecodeRef, timecodeFormat])

  const applyFrameVisuals = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    syncRetainedPoolVideos(state, mode)

    const { activeClip, crossDissolve, crossDissolveProgress, compositingStack, atTime, activeVideoContributors } = state
    const pool = videoPoolRef.current
    const poolContainer = videoPoolContainerRef.current
    const contributorsByKey = new Map(activeVideoContributors.map(contributor => [getContributorKey(contributor), contributor]))
    const activeVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    const incomingVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'incoming') ?? null
    const compositingVideoContributors = new Map(
      activeVideoContributors
        .filter(contributor => contributor.target === 'compositing')
        .map(contributor => [contributor.clip.id, contributor]),
    )

    for (const key of contributorSyncStatesRef.current.keys()) {
      if (!contributorsByKey.has(key)) contributorSyncStatesRef.current.delete(key)
    }

    if (poolContainer) {
      const shouldShowPool = activeClip?.asset?.type === 'video' || Boolean(crossDissolve?.outgoing.asset?.type === 'video')
      poolContainer.classList.toggle('hidden', !shouldShowPool)
    }

    const outgoingClip = crossDissolve?.outgoing ?? activeClip
    if (activeVideoContributor) {
      const clipPath = resolveClipPathRef(activeVideoContributor.clip)
      if (clipPath) {
        const video = ensurePoolVideo(clipPath)
        const contributorSyncState = ensureContributorSyncState(activeVideoContributor)
        // A freshly created element has no picture and no duration, so the sync below can
        // only bail out; nothing else re-renders when the file finishes loading, which left
        // the monitor black after a restart until an unrelated state change repainted it.
        if (video.readyState < 2 && !(video as { __loadRepaintHooked?: boolean }).__loadRepaintHooked) {
          ;(video as { __loadRepaintHooked?: boolean }).__loadRepaintHooked = true
          const onReady = () => {
            video.removeEventListener('loadeddata', onReady)
            ;(video as { __loadRepaintHooked?: boolean }).__loadRepaintHooked = false
            const last = lastFrameRequestRef.current
            if (!last || videoPoolRef.current.get(clipPath) !== video) return
            const active = last.state.activeVideoContributors.find(c => c.target === 'active')
            if (active) ensureContributorSyncState(active).pendingHardSync = true
            applyFrameVisualsRef.current(last.state, last.mode)
          }
          video.addEventListener('loadeddata', onReady)
        }
        const isNewClip = activePoolClipIdRef.current !== activeVideoContributor.clip.id
        const previousPoolPath = activePoolPathRef.current
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        // A clip cut in two plays on through the cut: the second half starts exactly where the
        // first ended, in the same file. Seeking there anyway flushes the decoder, and the
        // picture goes black until the new frame lands — the flash at every cut. So while the
        // element is already playing at the right place the cut needs no seek at all.
        let isSeamlessCut = false
        if (
          isNewClip && clipPath === previousPoolPath && mode === 'playback' &&
          !activeVideoContributor.clip.reversed && !video.paused && !video.seeking &&
          video.duration && !Number.isNaN(video.duration)
        ) {
          const continuedTime = getClipTargetTime(activeVideoContributor.clip, video.duration, atTime)
          isSeamlessCut = Math.abs(video.currentTime - continuedTime) <= 0.3
        }
        const shouldForceSyncActive = mode === 'scrub' || (isNewClip && !isSeamlessCut) || hasPlaybackJump
        if (poolContainer && !video.parentElement) poolContainer.appendChild(video)

        for (const [poolPath, pooledVideo] of pool) {
          if (poolPath === clipPath) continue
          pooledVideo.style.opacity = '0'
          pooledVideo.style.zIndex = '0'
        }

        if (clipPath !== previousPoolPath) {
          const oldVid = pool.get(previousPoolPath)
          if (oldVid) {
            oldVid.style.opacity = '0'
            oldVid.style.zIndex = '0'
            oldVid.pause()
          }
          activePoolPathRef.current = clipPath
          preSeekDoneRef.current = null
        }
        if (isNewClip) {
          activePoolClipIdRef.current = activeVideoContributor.clip.id
          preSeekDoneRef.current = null
        }

        const isReusedMediaNewCut = isNewClip && clipPath === previousPoolPath && !isSeamlessCut
        let needsSeekHide = false
        if (isReusedMediaNewCut && video.duration && !Number.isNaN(video.duration)) {
          const targetTime = getClipTargetTime(activeVideoContributor.clip, video.duration, atTime)
          if (Math.abs(video.currentTime - targetTime) > 0.08) {
            needsSeekHide = true
          }
        }

        if (needsSeekHide) {
          video.style.opacity = '0'
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked)
            video.style.opacity = '1'
          }
          video.addEventListener('seeked', onSeeked)
        } else if (!video.seeking) {
          video.style.opacity = '1'
        }
        video.style.zIndex = '1'
        if (shouldForceSyncActive) {
          contributorSyncState.pendingHardSync = true
        }
        syncPlaybackContributorVideo(video, activeVideoContributor, atTime, mode)

        if (!crossDissolve && mode === 'playback') {
          const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
          if (nextClip && nextClip.id !== preSeekDoneRef.current) {
            const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - atTime
            if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
              const nextSrc = resolveClipPathRef(nextClip)
              // Only preroll a DIFFERENT source; seeking the current video element while playing ruins current clip!
              const nextVideo = (nextSrc && nextSrc !== clipPath) ? ensurePoolVideo(nextSrc) : null
              if (nextVideo && nextVideo.readyState >= 1) {
                const nextTargetTime = nextClip.reversed
                  ? nextClip.trimStart + (nextVideo.duration || 0) - nextClip.trimStart - nextClip.trimEnd
                  : nextClip.trimStart
                if (!Number.isNaN(nextTargetTime)) {
                  if (typeof (nextVideo as { fastSeek?: (time: number) => void }).fastSeek === 'function') {
                    ;(nextVideo as { fastSeek: (time: number) => void }).fastSeek(nextTargetTime)
                  } else {
                    nextVideo.currentTime = nextTargetTime
                  }
                }
                preSeekDoneRef.current = nextClip.id
              }
            }
          }
        }
      }
    } else {
      const curVid = pool.get(activePoolPathRef.current)
      if (curVid) {
        curVid.style.opacity = '0'
        curVid.style.zIndex = '0'
        if (!curVid.paused) {
          curVid.pause()
        }
      }
      activePoolClipIdRef.current = null
    }

    // The transition's own geometry, shared with the exporter's xfade choice
    // and with the library thumbnails. `opacity` is only one of the ways an
    // effect hides a layer — a wipe clips it, a slide moves it — so the styles
    // are applied to the element rather than folded into an opacity number.
    const layerStyles = crossDissolve
      ? transitionLayerStyles(state.crossDissolveType, crossDissolveProgress)
      : null

    /**
     * Lays the transition's own movement over a layer that applyEffectStyle has
     * already positioned.
     */
    const applyLayer = (
      el: HTMLElement | null,
      side: 'outgoing' | 'incoming',
      baseTransform?: React.CSSProperties['transform'],
    ) => {
      if (!el) return
      const wanted = layerStyles?.[side] ?? {}
      if (wanted.clipPath) {
        el.style.clipPath = wanted.clipPath
      }
      el.style.transform = [wanted.transform, baseTransform]
        .filter((part): part is string => Boolean(part))
        .join(' ')
      if (wanted.filter !== undefined) el.style.filter = wanted.filter
    }

    const hasActiveLut = Boolean(state.activeFilter && (state.activeFilter.intensity ?? 100) > 0)
    // Remove BG owns presentation from frame zero. A missing matte is preparing,
    // never permission to reveal the raw DOM video under the transparent canvas.
    const canvasReady = (canvas: LutCanvasRef | null | undefined) => canvas?.hasContent() ?? false
    const outgoingNeedsCanvas = clipNeedsAlphaCanvas(outgoingClip)
    const activeNeedsCanvas = clipNeedsAlphaCanvas(activeClip)
    // While a brush tool is picked the whole picture stays visible: with the rest cut away
    // there would be nothing to see where to paint. The result shows once the tool is left.
    const paintingCutout = customMatteBrushMode !== null && Boolean(activeClip?.customMatte?.enabled)
    const outgoingIsCutOut = !paintingCutout && outgoingNeedsCanvas && (Boolean(outgoingClip?.autoMatte?.enabled) || canvasReady(lutCanvasRef.current))
    const activeIsCutOut = !paintingCutout && activeNeedsCanvas && (Boolean(activeClip?.autoMatte?.enabled) || canvasReady(lutCanvasRef.current))
    // Anything less than this and the branch below CLEARS the canvas every frame, which
    // is the other half of why background removal did not show in the preview: the
    // cut-out was drawn and then wiped, and the clip's transform and opacity never
    // reached the canvas at all.
    const hasActiveCanvas = hasActiveLut || activeNeedsCanvas || outgoingNeedsCanvas

    // A clip under the transform box mid-drag is drawn with the dragged transform, so the
    // picture follows the handles instead of waiting for the release to commit it. Its
    // transform keyframes are set aside for the drag: they would otherwise win over it.
    const override = transformOverrideRef?.current ?? null
    const withOverride = (clip: TimelineClip): TimelineClip => {
      if (!override || override.clipId !== clip.id) return clip
      return {
        ...clip,
        transform: override.transform,
        keyframes: clip.keyframes?.filter(track => !track.property.startsWith('transform.')),
      }
    }
    // The active clip's fade to black / white is drawn as the overlay below, not as opacity.
    const gradedStyle = (clip: TimelineClip, at: number) =>
      getClipEffectStyles(withOverride(clip), at, {
        lutApproximation: !hasActiveCanvas,
        fadeToColourAsOverlay: clip.id === activeClip?.id,
      })

    if (poolContainer) {
      if (outgoingClip?.asset?.type === 'video') {
        const baseStyle = gradedStyle(outgoingClip, Math.max(0, atTime - outgoingClip.startTime))
        const outgoingOpacity = crossDissolve
          ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
          : baseStyle.opacity
        applyEffectStyle(poolContainer, baseStyle, typeof outgoingOpacity === 'number' ? outgoingOpacity : undefined)
        applyLayer(poolContainer, 'outgoing', baseStyle.transform)
        if (outgoingIsCutOut) {
          poolContainer.style.opacity = '0'
        }
      } else {
        clearEffectStyle(poolContainer)
        poolContainer.style.opacity = '0'
      }
    }

    if (activeImageRef.current && activeClip && isImageClip(activeClip)) {
      activeImageRef.current.style.display = ''
      const baseStyle = gradedStyle(activeClip, Math.max(0, atTime - activeClip.startTime))
      const opacity = crossDissolve
        ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
        : baseStyle.opacity
      applyEffectStyle(activeImageRef.current, baseStyle, typeof opacity === 'number' ? opacity : undefined)
      applyLayer(activeImageRef.current, 'outgoing', baseStyle.transform)
      if (activeIsCutOut) {
        activeImageRef.current.style.opacity = '0'
      }
    } else if (activeImageRef.current) {
      clearEffectStyle(activeImageRef.current)
      activeImageRef.current.style.opacity = '0'
      activeImageRef.current.style.display = 'none'
    }

    // Stickers sit above the picture and carry their own transform, opacity and
    // keyframes, exactly as they did when one of them was the active layer.
    for (const stickerClip of state.activeStickerClips) {
      const element = stickerImageRefs.current.get(stickerClip.id)
      if (!element) continue
      const baseStyle = gradedStyle(stickerClip, Math.max(0, atTime - stickerClip.startTime))
      applyEffectStyle(element, baseStyle, typeof baseStyle.opacity === 'number' ? baseStyle.opacity : undefined)
      element.style.transform = baseStyle.transform ? String(baseStyle.transform) : ''
    }

    const lutCanvas = lutCanvasRef.current?.getCanvas()
    if (lutCanvas) {
      if (activeClip && hasActiveCanvas && (activeClip.asset?.type === 'video' || isImageClip(activeClip))) {
        const baseStyle = gradedStyle(activeClip, Math.max(0, atTime - activeClip.startTime))
        const opacity = crossDissolve
          ? Number(layerStyles?.outgoing.opacity ?? 1) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
          : baseStyle.opacity
        applyEffectStyle(lutCanvas, baseStyle, typeof opacity === 'number' ? opacity : undefined)
        const activeClipPath = activeClip ? resolveClipPathRef(activeClip) : ''
        const activeSourceEl = isImageClip(activeClip)
          ? activeImageRef.current
          : (activeClipPath ? videoPoolRef.current.get(activeClipPath) ?? null : null) ||
            (activePoolPathRef.current ? videoPoolRef.current.get(activePoolPathRef.current) ?? null : null)
        lutCanvasRef.current?.renderNow(activeSourceEl, activeSourceEl instanceof HTMLVideoElement
          ? { sourceTime: getClipTargetTime(activeClip, activeSourceEl.duration, atTime) } : null)
      } else {
        clearEffectStyle(lutCanvas)
        lutCanvasRef.current?.clear()
      }
    }

    if (transitionBgRef.current) {
      if (activeClip) {
        const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
        const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
        const bg = tInBg || tOutBg
        if (bg) {
          const effectStyles = getClipEffectStyles(activeClip, Math.max(0, atTime - activeClip.startTime))
          const overlayOpacity = effectStyles.opacity !== undefined ? 1 - (effectStyles.opacity as number) : 0
          transitionBgRef.current.style.backgroundColor = bg
          transitionBgRef.current.style.opacity = overlayOpacity > 0 ? String(overlayOpacity) : '0'
          transitionBgRef.current.style.display = overlayOpacity > 0 ? 'block' : 'none'
        } else {
          transitionBgRef.current.style.display = 'none'
        }
      } else {
        transitionBgRef.current.style.display = 'none'
      }
    }

    if (crossDissolve) {
      const incomingOffset = Math.max(0, atTime - crossDissolve.incoming.startTime)
      const incomingFilter = state.incomingFilter ?? resolveEffectiveClipFilter(
        crossDissolve.incoming,
        state.activeAdjustmentSources,
        tracksRef.current,
        incomingOffset,
      )
      const hasIncomingLut = Boolean(incomingFilter && (incomingFilter.intensity ?? 100) > 0)
      const incomingNeedsCanvas = clipNeedsAlphaCanvas(crossDissolve.incoming)
      const incomingIsCutOut =
        incomingNeedsCanvas && (Boolean(crossDissolve.incoming.autoMatte?.enabled) || canvasReady(incomingLutCanvasRef.current))
      // Same split as above — readiness must not gate whether the canvas draws.
      const hasIncomingCanvas = hasIncomingLut || incomingNeedsCanvas

      const baseIncomingStyle = getClipEffectStyles(
        incomingFilter === crossDissolve.incoming.filter
          ? crossDissolve.incoming
          : { ...crossDissolve.incoming, filter: incomingFilter },
        incomingOffset,
        { lutApproximation: !hasIncomingCanvas },
      )
      const incomingOpacity = String(
        Number(layerStyles?.incoming.opacity ?? 1) * ((crossDissolve.incoming.opacity ?? 100) / 100),
      )
      const inStyle = {
        ...baseIncomingStyle,
        opacity: incomingOpacity,
      }

      if (incomingVideoContributor && incomingDissolveVideoRef.current) {
        const incomingPath = resolveClipPathRef(incomingVideoContributor.clip)
        const video = incomingDissolveVideoRef.current
        const contributorSyncState = ensureContributorSyncState(incomingVideoContributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncIncoming = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        const incomingFileUrl = incomingPath ? pathToFileUrl(incomingPath) : ''
        if (incomingFileUrl && video.src !== incomingFileUrl && !video.src.endsWith(incomingFileUrl)) {
          video.src = incomingFileUrl
          video.load()
        }
        applyEffectStyle(video, inStyle)
        applyLayer(video, 'incoming', inStyle.transform)
        if (incomingIsCutOut) {
          video.style.opacity = '0'
        }
        if (shouldForceSyncIncoming) {
          contributorSyncState.pendingHardSync = true
        }
        if (video.readyState >= 2) {
          syncVideoElement(video, incomingVideoContributor.clip, atTime, {
            forceSeek: contributorSyncState.pendingHardSync,
            paused: mode !== 'playback' || Boolean(incomingVideoContributor.clip.reversed),
          })
          if (contributorSyncState.pendingHardSync) {
            contributorSyncState.pendingHardSync = false
          }
          contributorSyncState.lastAtTime = atTime
        } else if (!(video as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            video.removeEventListener('loadeddata', onLoaded)
            ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncVideoElement(video, incomingVideoContributor.clip, atTime, {
              forceSeek: contributorSyncState.pendingHardSync,
              paused: true,
            })
            if (contributorSyncState.pendingHardSync) {
              contributorSyncState.pendingHardSync = false
            }
            contributorSyncState.lastAtTime = atTime
          }
          video.addEventListener('loadeddata', onLoaded)
        }
      }

      if (crossDissolve.incoming.asset?.type === 'image' && incomingDissolveImageRef.current) {
        applyEffectStyle(incomingDissolveImageRef.current, inStyle)
        applyLayer(incomingDissolveImageRef.current, 'incoming', inStyle.transform)
        if (incomingIsCutOut) {
          incomingDissolveImageRef.current.style.opacity = '0'
        }
      }

      const incomingCanvas = incomingLutCanvasRef.current?.getCanvas()
      if (incomingCanvas) {
        if (hasIncomingCanvas) {
          applyEffectStyle(incomingCanvas, inStyle)
          applyLayer(incomingCanvas, 'incoming', inStyle.transform)
          const incomingSource = crossDissolve.incoming.asset?.type === 'video'
            ? incomingDissolveVideoRef.current : incomingDissolveImageRef.current
          incomingLutCanvasRef.current?.renderNow(incomingSource, incomingSource instanceof HTMLVideoElement
            ? { sourceTime: getClipTargetTime(crossDissolve.incoming, incomingSource.duration, atTime) } : null)
        } else {
          clearEffectStyle(incomingCanvas)
          incomingLutCanvasRef.current?.clear()
        }
      }

      if (crossDissolve.incoming.asset?.type === 'video') {
        const inPath = resolveClipPathRef(crossDissolve.incoming)
        if (inPath) ensurePoolVideo(inPath)
      }
    } else {
      if (incomingDissolveVideoRef.current) clearEffectStyle(incomingDissolveVideoRef.current)
      if (incomingDissolveImageRef.current) clearEffectStyle(incomingDissolveImageRef.current)
      const incomingCanvas = incomingLutCanvasRef.current?.getCanvas()
      if (incomingCanvas) {
        clearEffectStyle(incomingCanvas)
        incomingLutCanvasRef.current?.clear()
      }
    }

    const compositingIds = new Set(compositingStack.map(clip => clip.id))
    for (const [clipId, element] of compositingMediaRefs.current.entries()) {
      if (!compositingIds.has(clipId)) {
        clearEffectStyle(element)
        element.style.opacity = '0'
        element.style.display = 'none'
      }
    }

    // Pool assignment for compositing canvases
    const lowerClipsWithVisuals = compositingStack.filter(clip => {
      const filter = state.compositingFilters[clip.id]
      const hasLut = Boolean(filter && (filter.intensity ?? 100) > 0)
      return hasLut || clipNeedsAlphaCanvas(clip)
    })

    const slotMap = compositingSlotMapRef.current
    const activeCompIds = new Set(lowerClipsWithVisuals.map(c => c.id))
    for (const clipId of Array.from(slotMap.keys())) {
      if (!activeCompIds.has(clipId)) {
        slotMap.delete(clipId)
      }
    }

    const occupiedSlots = new Set(slotMap.values())
    for (const clip of lowerClipsWithVisuals) {
      if (!slotMap.has(clip.id)) {
        for (let s = 0; s < MAX_COMPOSITING_CANVASES; s++) {
          if (!occupiedSlots.has(s)) {
            slotMap.set(clip.id, s)
            occupiedSlots.add(s)
            break
          }
        }
      }
    }

    for (const clip of compositingStack) {
      const element = compositingMediaRefs.current.get(clip.id)
      if (!element) continue
      element.style.display = ''

      const inherited = state.compositingFilters[clip.id]
      const assignedSlot = slotMap.get(clip.id)
      const hasCompCanvas = assignedSlot !== undefined
      const isCutOut =
        clipNeedsAlphaCanvas(clip) &&
        (Boolean(clip.autoMatte?.enabled) || canvasReady(assignedSlot !== undefined ? compLutCanvasRefs[assignedSlot]?.current : null))

      const clipStyle = getClipEffectStyles(
        inherited === clip.filter ? clip : { ...clip, filter: inherited },
        Math.max(0, atTime - clip.startTime),
        { lutApproximation: !hasCompCanvas },
      )
      applyEffectStyle(element, clipStyle)
      if (isCutOut) {
        element.style.opacity = '0'
      }

      if (hasCompCanvas) {
        const compRef = compLutCanvasRefs[assignedSlot]
        const compCanvas = compRef?.current?.getCanvas()
        if (compCanvas) {
          applyEffectStyle(compCanvas, clipStyle)
          compRef?.current?.renderNow(element, element instanceof HTMLVideoElement
            ? { sourceTime: getClipTargetTime(clip, element.duration, atTime) } : null)
        }
      }

      if (element instanceof HTMLVideoElement) {
        const contributor = compositingVideoContributors.get(clip.id)
        if (!contributor) {
          if (!element.paused) {
            element.pause()
          }
          continue
        }
        const contributorSyncState = ensureContributorSyncState(contributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncCompositing = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        if (shouldForceSyncCompositing) {
          contributorSyncState.pendingHardSync = true
        }
        if (element.readyState >= 2) {
          syncPlaybackContributorVideo(element, contributor, atTime, mode)
        } else if (!(element as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            element.removeEventListener('loadeddata', onLoaded)
            ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncPlaybackContributorVideo(element, contributor, atTime, mode)
          }
          element.addEventListener('loadeddata', onLoaded)
        }
      }
    }

    // Clear unused compositing canvas slots
    for (let s = 0; s < MAX_COMPOSITING_CANVASES; s++) {
      if (!occupiedSlots.has(s)) {
        const compRef = compLutCanvasRefs[s]
        const compCanvas = compRef?.current?.getCanvas()
        if (compCanvas) {
          clearEffectStyle(compCanvas)
          compRef?.current?.clear()
        }
      }
    }

  }, [customMatteBrushMode, activeImageRef, activePoolClipIdRef, activePoolPathRef, activeTimeline?.background, blurCanvasRef, compLutCanvasRefs, compositingMediaRefs, compositingSlotMapRef, contributorSyncStatesRef, ensureContributorSyncState, ensurePoolVideo, getContributorKey, getNextVideoClipRef, incomingDissolveImageRef, incomingDissolveVideoRef, incomingLutCanvasRef, lutCanvasRef, preSeekDoneRef, resolveClipPathRef, stickerImageRefs, transformOverrideRef, syncPlaybackContributorVideo, syncRetainedPoolVideos, syncVideoElement, tracksRef, transitionBgRef, videoPoolContainerRef, videoPoolRef])

  applyFrameVisualsRef.current = applyFrameVisuals

  const renderFrame = React.useCallback((atTime: number, mode: MonitorRenderMode) => {
    const nextState = deriveFrameRenderState(frameRenderCacheRef.current, tracksRef.current, atTime)
    const slotState = cacheSlotStateRef.current

    // The live picture under the cache is ready when the video that will show is on the right
    // frame and not mid-seek (or hidden while it seeks).
    const liveReady = () => nextState.activeVideoContributors.every(contributor => {
      if (contributor.target !== 'active' || contributor.clip.asset?.type !== 'video') return true
      const path = resolveClipPathRef(contributor.clip)
      const video = path ? videoPoolRef.current.get(path) : undefined
      if (!video || !video.duration || Number.isNaN(video.duration)) return false
      const wanted = getClipTargetTime(contributor.clip, video.duration, atTime)
      return video.readyState >= 2 && !video.seeking && video.style.opacity !== '0' && Math.abs(video.currentTime - wanted) < 0.15
    })

    // 1. Sync complex segment render cache if playhead is within a ready segment
    const wasCached = slotState.hasActiveCache
    const wasHolding = Boolean(slotState.holding)
    syncCachePlayback(
      atTime,
      mode,
      cachedSegmentsRef.current,
      cachedVideoRefA.current,
      cachedVideoRefB.current,
      slotState,
      playbackResolution,
      onSlotChange,
      onActiveCacheChange,
      liveReady,
    )

    if ((wasCached && !slotState.hasActiveCache) || (!wasHolding && slotState.holding)) {
      // Past the end of a cached segment. The live videos were paused underneath it and are
      // behind the playhead by the segment's length; put each back where the playhead is
      // instead of leaving it to catch up, which showed the picture from before the segment.
      for (const contributor of nextState.activeVideoContributors) {
        ensureContributorSyncState(contributor).pendingHardSync = true
      }
      lastFrameRequestRef.current = null
    }

    if (slotState.hasActiveCache && !slotState.holding) {
      // Pause underlying pool videos to avoid duplicate decoding during complex segment playback
      for (const [, pooledVideo] of videoPoolRef.current) {
        if (!pooledVideo.paused) pooledVideo.pause()
      }
      for (const [, compMedia] of compositingMediaRefs.current) {
        if (compMedia instanceof HTMLVideoElement && !compMedia.paused) compMedia.pause()
      }
    }

    const lastFrame = lastFrameRequestRef.current

    if (lastFrame && lastFrame.mode === mode && sameFrameRenderState(lastFrame.state, nextState)) {
      syncPlaybackTimecode(atTime)
      return
    }

    lastFrameRequestRef.current = { state: nextState, mode }
    syncPlaybackTimecode(atTime)
    syncFrameScene(nextState)
    applyFrameVisuals(nextState, mode)
  }, [applyFrameVisuals, cachedSegmentsRef, cachedVideoRefA, cachedVideoRefB, compositingMediaRefs, ensureContributorSyncState, frameRenderCacheRef, lastFrameRequestRef, onActiveCacheChange, onSlotChange, playbackResolution, resolveClipPathRef, syncFrameScene, syncPlaybackTimecode, tracksRef, videoPoolRef])

  return {
    frameScene,
    hasActiveCache,
    activeCacheSlot,
    lastFrameRequestRef,
    syncFrameScene,
    syncPlaybackTimecode,
    applyFrameVisuals,
    renderFrame,
  }
}
