import React from 'react'
import { loadLut } from '../../../lib/lut-cache'
import type { CubeLut } from '@core/lut'
import type { ChromaKey, AutoMatte, ClipStroke, CustomMatte } from '@core/project-model'
import { matteEngine } from './MatteEngine'
import { matteTimeForSourceTime, autoMattePlaybackRate } from '@core/auto-matte'
import { decideBakeMatteSync, resolveMatteReadiness, type MatteReadiness, type MatteReadinessInput } from '@core/matte-preview-policy'
import { FramePairCoordinator } from '@core/frame-pair-coordinator'
import { BakedMattePair } from './BakedMattePair'
import { initLutWebgl, create3DLutTexture } from './gl/lut-webgl-init'
import {
  bindChromaUniforms,
  bindMatteEdgeUniforms,
  bindCustomMatteUniforms,
  bindStrokeUniforms,
} from './gl/lut-uniform-binder'
import { useSourceSync } from './gl/useSourceSync'
import { useBakeVideo } from './gl/useBakeVideo'

export interface LutCanvasRef {
  renderNow: (overrideSource?: HTMLVideoElement | HTMLImageElement | VideoFrame | null, scrub?: { sourceTime: number } | null) => void
  getCanvas: () => HTMLCanvasElement | null
  clear: () => void
  hasContent: () => boolean
  getMatteReadiness: () => MatteReadiness
}

export interface LutCanvasProps {
  sourceElement: HTMLVideoElement | HTMLImageElement | VideoFrame | null
  filterId?: string
  intensity?: number // 0..100
  chromaKey?: ChromaKey
  autoMatte?: AutoMatte
  customMatte?: CustomMatte
  stroke?: ClipStroke
  clipId?: string
  playbackResolution?: 1 | 0.5 | 0.25
  bakeVideoPath?: string
  trimStart?: number
  speed?: number
  isPlaying?: boolean
  className?: string
  style?: React.CSSProperties
}

export const LutCanvas = React.forwardRef<LutCanvasRef, LutCanvasProps>(function LutCanvas(
  {
    sourceElement,
    filterId,
    intensity = 100,
    chromaKey,
    autoMatte,
    customMatte,
    stroke,
    clipId,
    playbackResolution = 1,
    bakeVideoPath,
    trimStart,
    speed,
    isPlaying = false,
    className,
    style,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const glRef = React.useRef<WebGL2RenderingContext | null>(null)
  const programRef = React.useRef<WebGLProgram | null>(null)
  const imageTextureRef = React.useRef<WebGLTexture | null>(null)
  const dummyLutTextureRef = React.useRef<WebGLTexture | null>(null)
  const matteTextureRef = React.useRef<WebGLTexture | null>(null)
  const bakeTextureRef = React.useRef<WebGLTexture | null>(null)
  const customMatteTextureRef = React.useRef<WebGLTexture | null>(null)
  const customMatteHashRef = React.useRef<string>('')
  const bakeVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const lutTextureCacheRef = React.useRef<Map<string, { texture: WebGLTexture; size: number }>>(new Map())
  const activeLutRef = React.useRef<CubeLut | null>(null)
  const animFrameIdRef = React.useRef<number>(0)
  const isMountedRef = React.useRef(true)
  const hasValidMatteRef = React.useRef(false)
  const lastMatteStampRef = React.useRef<string | null>(null)
  const lastMatteSeekAtRef = React.useRef(0)
  const pendingMatteSeekRef = React.useRef<number | null>(null)
  const uploadedMatteTimeRef = React.useRef<number | null>(null)
  const sourceDecodedTimeRef = React.useRef<number>(0)
  const bakeDecodedTimeRef = React.useRef<number>(0)
  const lastSourceSeekAtRef = React.useRef<number>(0)
  const liveInferTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveInferringRef = React.useRef(false)
  const bakedPairRef = React.useRef<BakedMattePair | null>(null)
  const lastSourceRef = React.useRef<HTMLVideoElement | HTMLImageElement | VideoFrame | null>(null)
  const sourceWatchRef = React.useRef<{ source: HTMLVideoElement; dispose: () => void } | null>(null)
  const sourceClockRef = React.useRef(new WeakMap<HTMLVideoElement, number>())
  const scrubTargetRef = React.useRef<{ source: HTMLVideoElement; time: number } | null>(null)
  const matteFrameRef = React.useRef<VideoFrame | null>(null)
  const matteTextureSizeRef = React.useRef<{ width: number; height: number }>({ width: 1, height: 1 })
  const hasContentRef = React.useRef(false)
  const matteReadinessRef = React.useRef<MatteReadiness>('preparing')
  const lastClipIdRef = React.useRef<string | null>(clipId ?? null)

  const coordinatorRef = React.useRef(new FramePairCoordinator())

  React.useEffect(() => {
    coordinatorRef.current.setMatteEnabled(Boolean(autoMatte?.enabled))
  }, [autoMatte?.enabled])

  React.useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      sourceWatchRef.current?.dispose()
      sourceWatchRef.current = null
      if (liveInferTimeoutRef.current !== null) {
        clearTimeout(liveInferTimeoutRef.current)
        liveInferTimeoutRef.current = null
      }
    }
  }, [])

  // Reset matte validation state when switching clips unless a cached matte exists
  React.useEffect(() => {
    if (lastClipIdRef.current !== (clipId ?? null)) {
      lastSourceRef.current = sourceElement
      lastClipIdRef.current = clipId ?? null
      glRef.current?.clear(glRef.current.COLOR_BUFFER_BIT)
      hasContentRef.current = false
      coordinatorRef.current.nextGeneration()
      const activeId = clipId || 'clip-preview'
      const cached = matteEngine.getCachedResult(activeId)
      if (!cached) {
        hasValidMatteRef.current = false
        lastMatteStampRef.current = null
        uploadedMatteTimeRef.current = null
      }
      pendingMatteSeekRef.current = null
      matteFrameRef.current = null
    }
  }, [clipId, sourceElement])

  React.useEffect(() => { if (sourceElement) lastSourceRef.current = sourceElement }, [sourceElement])

  const drawRef = React.useRef<(presentOnly?: boolean) => void>(() => {})
  const isPlayingRef = React.useRef(isPlaying)
  isPlayingRef.current = isPlaying

  const bakeFailedRef = React.useRef(false)

  // One owner for paired snapshots; async completion redraws even while paused.
  React.useEffect(() => {
    if (!bakeVideoPath || !autoMatte?.enabled || typeof VideoDecoder === 'undefined') return
    const pair = new BakedMattePair(bakeVideoPath, () => drawRef.current(true))
    bakedPairRef.current = pair
    hasValidMatteRef.current = false
    return () => {
      pair.destroy()
      if (bakedPairRef.current === pair) bakedPairRef.current = null
    }
  }, [bakeVideoPath, autoMatte?.enabled, clipId])

  // Manage bake video element
  useBakeVideo(
    bakeVideoPath,
    autoMatte,
    drawRef,
    isPlayingRef,
    bakeVideoRef,
    bakeFailedRef,
    bakeDecodedTimeRef,
    lastMatteSeekAtRef,
    pendingMatteSeekRef,
  )

  const [glGeneration, setGlGeneration] = React.useState(0)
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onLost = (event: Event) => {
      event.preventDefault()
      console.warn('[LutCanvas] WebGL context lost; waiting for the browser to restore it.')
      glRef.current = null
      programRef.current = null
    }
    const onRestored = () => {
      console.warn('[LutCanvas] WebGL context restored, rebuilding.')
      setGlGeneration(n => n + 1)
    }

    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [])

  // WebGL initialization
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) {
      console.warn('[LutCanvas] WebGL2 is not supported on this device.')
      return
    }
    glRef.current = gl

    const res = initLutWebgl(gl)
    if (!res) return

    programRef.current = res.program
    imageTextureRef.current = res.imgTex
    dummyLutTextureRef.current = res.dummyTex
    matteTextureRef.current = res.matteTex
    bakeTextureRef.current = res.bakeTex
    customMatteTextureRef.current = res.customTex

    return () => {
      const cached = lutTextureCacheRef.current
      for (const { texture } of cached.values()) {
        gl.deleteTexture(texture)
      }
      cached.clear()

      gl.deleteTexture(res.imgTex)
      gl.deleteTexture(res.dummyTex)
      gl.deleteTexture(res.matteTex)
      gl.deleteTexture(res.bakeTex)
      gl.deleteTexture(res.customTex)
      gl.deleteProgram(res.program)
      gl.deleteBuffer(res.vbo)
      glRef.current = null
      programRef.current = null
      matteTextureRef.current = null
      bakeTextureRef.current = null
      customMatteTextureRef.current = null
    }
  }, [glGeneration])

  const ensureLutTexture = React.useCallback((lut: CubeLut, id: string) => {
    const gl = glRef.current
    if (!gl) return
    const cache = lutTextureCacheRef.current
    if (cache.has(id)) return
    const tex = create3DLutTexture(gl, lut)
    if (!tex) return
    cache.set(id, { texture: tex, size: lut.size })
  }, [])

  const clearCanvas = React.useCallback(() => {
    const gl = glRef.current
    if (!gl) return
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    hasContentRef.current = false
  }, [])

  // Load LUT data when filterId changes
  React.useEffect(() => {
    if (!filterId) {
      activeLutRef.current = null
      clearCanvas()
      return
    }

    let cancelled = false
    loadLut(filterId)
      .then(lut => {
        if (cancelled) return
        activeLutRef.current = lut
        ensureLutTexture(lut, filterId)
        if (drawRef.current) drawRef.current()
      })
      .catch(err => {
        console.warn(`[LutCanvas] Failed to load LUT ${filterId}:`, err)
        activeLutRef.current = null
      })

    return () => {
      cancelled = true
    }
  }, [filterId, clearCanvas, ensureLutTexture])

  // Draw loop
  const draw = React.useCallback((overrideSource?: HTMLVideoElement | HTMLImageElement | VideoFrame | null, presentOnly = false) => {
    const gl = glRef.current
    const program = programRef.current
    const canvas = canvasRef.current
    if (overrideSource) lastSourceRef.current = overrideSource
    let source = overrideSource ?? lastSourceRef.current ?? sourceElement

    if (source instanceof HTMLVideoElement && sourceWatchRef.current?.source !== source) {
      sourceWatchRef.current?.dispose()
      const video = source
      const redraw = () => drawRef.current()
      const seeking = () => {
        sourceClockRef.current.delete(video)
        if (scrubTargetRef.current?.source !== video) bakedPairRef.current?.invalidate()
      }
      let frameCallback = 0
      let watching = true
      const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (!watching) return
        sourceClockRef.current.set(video, metadata.mediaTime)
        redraw()
        frameCallback = video.requestVideoFrameCallback(onFrame)
      }
      if (video.requestVideoFrameCallback) frameCallback = video.requestVideoFrameCallback(onFrame)
      video.addEventListener('seeking', seeking)
      for (const event of ['loadeddata', 'seeked', 'canplay']) video.addEventListener(event, redraw)
      sourceWatchRef.current = {
        source: video,
        dispose: () => {
          watching = false
          if (frameCallback) video.cancelVideoFrameCallback(frameCallback)
          video.removeEventListener('seeking', seeking)
          for (const event of ['loadeddata', 'seeked', 'canplay']) video.removeEventListener(event, redraw)
        },
      }
    }
    const currentFilterId = filterId

    const hasLut = Boolean(currentFilterId && lutTextureCacheRef.current.has(currentFilterId))
    const hasChroma = Boolean(chromaKey && chromaKey.enabled)
    const hasMatte = Boolean(autoMatte && autoMatte.enabled)
    const hasCustomMatte = Boolean(customMatte && customMatte.enabled && customMatte.strokes && customMatte.strokes.length > 0)
    const hasStroke = Boolean(stroke && stroke.enabled && stroke.style !== 'none' && stroke.width > 0)

    if (!gl || !program || !canvas) return
    if (!source || (!hasLut && !hasChroma && !hasMatte && !hasCustomMatte && !hasStroke)) {
      clearCanvas()
      return
    }

    let isVideo = source instanceof HTMLVideoElement
    const isImage = source instanceof HTMLImageElement
    let isFrame = typeof VideoFrame !== 'undefined' && source instanceof VideoFrame && source.format !== null

    const scrubTarget = source instanceof HTMLVideoElement && scrubTargetRef.current?.source === source
      ? scrubTargetRef.current.time : undefined
    const independentTarget = scrubTarget !== undefined && hasMatte && Boolean(bakeVideoPath) && typeof VideoDecoder !== 'undefined'
    const independentScrub = independentTarget && !isPlaying
    if (source instanceof HTMLVideoElement && (source.readyState < 2 || (source.seeking && !independentTarget))) return
    if (source instanceof HTMLImageElement && !source.complete) {
      clearCanvas()
      return
    }
    if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame && source.format === null) {
      return
    }

    const isBakeUsable = Boolean(
      hasMatte &&
      autoMatte &&
      bakeVideoPath &&
      bakeVideoRef.current &&
      !bakeFailedRef.current &&
      !bakeVideoRef.current.error &&
      bakeVideoRef.current.networkState !== 3
    )

    const sourceW = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.displayWidth
    const sourceH = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.displayHeight
    if (!sourceW || !sourceH) return

    // The source element plays at the clip's speed at this instant — which a
    // speed curve changes every frame — so the matte follows its rate rather
    // than the clip's mean speed.
    const liveSpeed = source instanceof HTMLVideoElement && !source.paused ? source.playbackRate : (speed ?? 1)

    let currentSourceTime = source instanceof HTMLVideoElement
      ? sourceClockRef.current.get(source) ?? source.currentTime
      : isFrame ? (source as VideoFrame).timestamp / 1_000_000 : 0
    let pairedAlpha: VideoFrame | null = null
    if (hasMatte && autoMatte && bakeVideoPath && typeof VideoDecoder !== 'undefined') {
      if (source instanceof HTMLVideoElement) currentSourceTime = scrubTarget ?? source.currentTime
      const mapTime = (time: number) => matteTimeForSourceTime(
        time, autoMatte.bake?.sourceStart ?? trimStart ?? 0, autoMatte.bake?.speed ?? 1,
        Boolean(autoMatte.bake?.reversed), autoMatte.bake?.sourceSpan ?? 0,
      )
      const pair = presentOnly ? bakedPairRef.current?.getCurrentPair() : bakedPairRef.current?.request(
        source, currentSourceTime, mapTime(currentSourceTime), isPlaying, mapTime, independentScrub)
      matteReadinessRef.current = bakedPairRef.current?.error ? 'error' : pair ? 'ready' : 'preparing'
      canvas.dataset.scrubProxy = bakedPairRef.current?.proxyState ?? 'idle'
      if (!pair) return
      canvas.dataset.pairWidth = String(pair.source.displayWidth)
      source = pair.source
      pairedAlpha = pair.alpha
      currentSourceTime = pair.sourceTime
      isVideo = false
      isFrame = true
    }
    const activeClipId = clipId || 'clip-preview'

    const runLiveInference = () => {
      if (liveInferringRef.current) return
      liveInferringRef.current = true
      const capturedGeneration = coordinatorRef.current.getGeneration()
      matteEngine.processFrame(source, {
        clipId: activeClipId,
        timestamp: currentSourceTime,
        quality: autoMatte?.quality,
        isPlaying,
      }).then(res => {
        liveInferringRef.current = false
        if (!isMountedRef.current || !res) return
        if (!coordinatorRef.current.isGenerationCurrent(capturedGeneration)) return

        const stamp = `${activeClipId}:${res.timestamp}`
        if (lastMatteStampRef.current === stamp) return
        lastMatteStampRef.current = stamp
        uploadedMatteTimeRef.current = res.timestamp

        const currentGl = glRef.current
        const mTex = matteTextureRef.current
        if (!currentGl || !mTex) return

        currentGl.activeTexture(currentGl.TEXTURE2)
        currentGl.bindTexture(currentGl.TEXTURE_2D, mTex)
        currentGl.pixelStorei(currentGl.UNPACK_ALIGNMENT, 1)
        currentGl.texImage2D(
          currentGl.TEXTURE_2D,
          0,
          currentGl.R8,
          res.width,
          res.height,
          0,
          currentGl.RED,
          currentGl.UNSIGNED_BYTE,
          res.alphaData,
        )
        matteTextureSizeRef.current = { width: res.width, height: res.height }
        hasValidMatteRef.current = true
        if (!isPlayingRef.current) {
          draw()
        }
      }).catch(err => {
        liveInferringRef.current = false
        console.warn('[LutCanvas] Matte inference error:', err)
      })
    }

    if (hasMatte && autoMatte && !pairedAlpha) {
      const wantMatteTime = matteTimeForSourceTime(
        currentSourceTime,
        autoMatte.bake?.sourceStart ?? trimStart ?? 0,
        autoMatte.bake?.speed ?? 1,
        Boolean(autoMatte.bake?.reversed),
        autoMatte.bake?.sourceSpan ?? 0,
      )

      if (isBakeUsable && bakeVideoRef.current) {
        matteFrameRef.current = null
        const bakeVideo = bakeVideoRef.current
        const seekDrift = Math.abs(bakeVideo.currentTime - wantMatteTime)

        const isVideoSource = isVideo || isFrame
        if (isVideoSource) {
          if (bakeVideo.playbackRate !== autoMattePlaybackRate(autoMatte.bake, liveSpeed)) {
            bakeVideo.playbackRate = autoMattePlaybackRate(autoMatte.bake, liveSpeed)
          }
          if (seekDrift > 0.03) {
            if (!bakeVideo.seeking) {
              bakeVideo.currentTime = wantMatteTime
              lastMatteSeekAtRef.current = performance.now()
            } else {
              pendingMatteSeekRef.current = wantMatteTime
            }
          }
        }
      } else if (!bakeVideoPath || bakeFailedRef.current) {
        matteFrameRef.current = null
        const stamp = `${activeClipId}:${currentSourceTime}`
        if (lastMatteStampRef.current !== stamp) {
          runLiveInference()
        }
      }
    }

    const resScale = playbackResolution ?? 1
    const maxDim = 1280
    let targetW = Math.round(sourceW * resScale)
    let targetH = Math.round(sourceH * resScale)
    if (targetW > maxDim || targetH > maxDim) {
      const down = maxDim / Math.max(targetW, targetH)
      targetW = Math.round(targetW * down)
      targetH = Math.round(targetH * down)
    }
    targetW = Math.max(2, Math.round(targetW / 2) * 2)
    targetH = Math.max(2, Math.round(targetH / 2) * 2)

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)

    // Unit 0: Video frame
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, imageTextureRef.current)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    } catch (err) {
      console.warn('[LutCanvas] Failed to upload source frame:', err)
      return
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)

    // Unit 1: 3D LUT
    gl.activeTexture(gl.TEXTURE1)
    if (hasLut && currentFilterId) {
      const lutEntry = lutTextureCacheRef.current.get(currentFilterId)
      if (lutEntry) {
        gl.bindTexture(gl.TEXTURE_3D, lutEntry.texture)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 1)
        const normIntensity = Math.max(0, Math.min(100, intensity)) / 100
        gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), normIntensity)
        gl.uniform1f(gl.getUniformLocation(program, 'u_lut_size'), lutEntry.size)
      } else {
        gl.bindTexture(gl.TEXTURE_3D, dummyLutTextureRef.current)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 0)
      }
    } else {
      gl.bindTexture(gl.TEXTURE_3D, dummyLutTextureRef.current)
      gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
      gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 0)
      gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), 0)
      gl.uniform1f(gl.getUniformLocation(program, 'u_lut_size'), 1)
    }

    // Chroma key uniforms
    bindChromaUniforms(gl, program, chromaKey)

    // Unit 2: Auto Matte (WebCodecs VideoFrame, Bake HTMLVideoElement, or Realtime inference)
    gl.activeTexture(gl.TEXTURE2)
    if (hasMatte && autoMatte) {
      const isWebCodecsActive = Boolean(pairedAlpha)

      matteFrameRef.current = pairedAlpha
      if (isWebCodecsActive && matteFrameRef.current && typeof VideoFrame !== 'undefined' && matteFrameRef.current instanceof VideoFrame) {
        const frame = matteFrameRef.current
        gl.bindTexture(gl.TEXTURE_2D, bakeTextureRef.current)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
        matteTextureSizeRef.current = {
          width: frame.displayWidth || 1,
          height: frame.displayHeight || 1,
        }
        hasValidMatteRef.current = true
      } else if (!isWebCodecsActive && isBakeUsable && bakeVideoRef.current) {
        const bakeVideo = bakeVideoRef.current
        const wantTime = matteTimeForSourceTime(
          currentSourceTime,
          autoMatte.bake?.sourceStart ?? trimStart ?? 0,
          autoMatte.bake?.speed ?? 1,
          Boolean(autoMatte.bake?.reversed),
          autoMatte.bake?.sourceSpan ?? 0,
        )
        const drift = Math.abs(bakeVideo.currentTime - wantTime)

        const sync = decideBakeMatteSync({
          drift,
          isPlaying,
          ready: bakeVideo.readyState >= 2,
          msSinceLastSeek: performance.now() - lastMatteSeekAtRef.current,
        })

        const isVideoSource = isVideo || isFrame
        if (isVideoSource) {
          if (bakeVideo.playbackRate !== autoMattePlaybackRate(autoMatte.bake, liveSpeed)) {
            bakeVideo.playbackRate = autoMattePlaybackRate(autoMatte.bake, liveSpeed)
          }
          if (sync.seek) {
            if (!bakeVideo.seeking) {
              bakeVideo.currentTime = wantTime
              lastMatteSeekAtRef.current = performance.now()
            } else {
              pendingMatteSeekRef.current = wantTime
            }
          }
          if (isPlaying && bakeVideo.paused) {
            bakeVideo.play().catch(() => {})
          } else if (!isPlaying && !bakeVideo.paused) {
            bakeVideo.pause()
          }
        } else {
          if (bakeVideo.currentTime !== 0 && !bakeVideo.seeking) {
            bakeVideo.currentTime = 0
          }
        }

        const shouldUploadBake =
          !bakeVideo.seeking &&
          bakeVideo.readyState >= 2 &&
          (sync.use || (!isPlaying && bakeVideo.readyState >= 2) || !hasValidMatteRef.current)

        if (shouldUploadBake) {
          gl.bindTexture(gl.TEXTURE_2D, bakeTextureRef.current)
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bakeVideo)
          matteTextureSizeRef.current = {
            width: bakeVideo.videoWidth || 1,
            height: bakeVideo.videoHeight || 1,
          }
          hasValidMatteRef.current = true
        } else if (sync.drop) {
          hasValidMatteRef.current = false
        } else if (!hasValidMatteRef.current) {
          const cachedRes = matteEngine.getCachedResult(activeClipId)
          if (cachedRes) {
            gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.R8,
              cachedRes.width,
              cachedRes.height,
              0,
              gl.RED,
              gl.UNSIGNED_BYTE,
              cachedRes.alphaData,
            )
            matteTextureSizeRef.current = { width: cachedRes.width, height: cachedRes.height }
            hasValidMatteRef.current = true
          }
        }

      } else if (!bakeVideoPath || bakeFailedRef.current) {
        gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)

        const cachedRes = matteEngine.getCachedResult(activeClipId)
        if (cachedRes && ((!isVideo && !isFrame) || lastMatteStampRef.current === null)) {
          const stamp = `${activeClipId}:${cachedRes.timestamp}`
          if (lastMatteStampRef.current !== stamp) {
            lastMatteStampRef.current = stamp
            uploadedMatteTimeRef.current = cachedRes.timestamp
            gl.activeTexture(gl.TEXTURE2)
            gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.R8,
              cachedRes.width,
              cachedRes.height,
              0,
              gl.RED,
              gl.UNSIGNED_BYTE,
              cachedRes.alphaData,
            )
            matteTextureSizeRef.current = { width: cachedRes.width, height: cachedRes.height }
            hasValidMatteRef.current = true
          }
        }

        const stamp = `${activeClipId}:${currentSourceTime}`
        if (lastMatteStampRef.current !== stamp) {
          runLiveInference()
        }
      }

      const currentMatteTime = isWebCodecsActive && matteFrameRef.current
        ? matteFrameRef.current.timestamp / 1_000_000
        : (bakeVideoRef.current ? bakeVideoRef.current.currentTime : -1)
      const wantMatteTime = matteTimeForSourceTime(
        currentSourceTime,
        autoMatte.bake?.sourceStart ?? trimStart ?? 0,
        autoMatte.bake?.speed ?? 1,
        Boolean(autoMatte.bake?.reversed),
        autoMatte.bake?.sourceSpan ?? 0,
      )
      const drift = currentMatteTime >= 0 ? Math.abs(currentMatteTime - wantMatteTime) : 999

      const readinessInput: MatteReadinessInput = {
        matteEnabled: true,
        hasBake: Boolean(bakeVideoPath),
        bakeFailed: bakeFailedRef.current,
        hasValidTexture: hasValidMatteRef.current,
        drift: pairedAlpha || isImage ? 0 : !bakeVideoPath && uploadedMatteTimeRef.current !== null ? Math.abs(currentSourceTime - uploadedMatteTimeRef.current) : drift,
        isInferring: liveInferringRef.current,
        hasCachedResult: Boolean(matteEngine.getCachedResult(activeClipId)),
      }

      const sourceFrameId = Math.round(currentSourceTime * 1_000_000)
      const alphaFrameId = pairedAlpha ? sourceFrameId
        : !bakeVideoPath && uploadedMatteTimeRef.current !== null
          ? Math.round(uploadedMatteTimeRef.current * 1_000_000)
          : Math.abs(currentMatteTime - wantMatteTime) < 0.001 && !bakeVideoRef.current?.seeking ? sourceFrameId : -1
      const decision = coordinatorRef.current.decide(
        {
          frameId: sourceFrameId,
          pts: Math.round(currentSourceTime * 1_000_000),
          duration: 33333,
          dts: Math.round(currentSourceTime * 1_000_000),
          isKeyframe: true,
        },
        alphaFrameId,
        readinessInput,
        coordinatorRef.current.getGeneration(),
      )

      if (decision.action === 'hold') {
        return
      }
      if (decision.action === 'skip') {
        clearCanvas()
        return
      }

      bindMatteEdgeUniforms(gl, program, autoMatte, hasValidMatteRef.current, matteTextureSizeRef.current)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
      gl.uniform1i(gl.getUniformLocation(program, 'u_matte_enabled'), 0)
    }

    // Unit 3: Custom Matte (additive in R, subtractive in G)
    bindCustomMatteUniforms(
      gl,
      program,
      customMatte,
      canvas,
      Boolean(autoMatte?.enabled),
      currentSourceTime,
      trimStart,
      speed,
      customMatteTextureRef.current,
      customMatteHashRef,
    )

    // Stroke uniforms
    bindStrokeUniforms(gl, program, stroke, canvas)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    canvas.dataset.sourceTime = String(currentSourceTime)
    canvas.dataset.matteTime = pairedAlpha ? String(pairedAlpha.timestamp / 1e6) : ''
    hasContentRef.current = true
  }, [clearCanvas, filterId, intensity, chromaKey, autoMatte, customMatte, stroke, clipId, playbackResolution, bakeVideoPath, isPlaying, sourceElement, trimStart, speed])

  drawRef.current = presentOnly => draw(undefined, presentOnly)

  // Source media sync (Image, Video, VideoFrame)
  useSourceSync(sourceElement, drawRef, sourceDecodedTimeRef, lastSourceSeekAtRef, isPlayingRef)

  // Playback requestAnimationFrame loop
  React.useEffect(() => {
    const shouldPlay = isPlaying && (
      (Boolean(filterId) && intensity > 0) ||
      Boolean(chromaKey?.enabled) ||
      Boolean(autoMatte?.enabled) ||
      Boolean(stroke?.enabled && stroke.style !== 'none' && stroke.width > 0)
    )
    if (!shouldPlay) {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = 0
      }
      return
    }

    const loop = () => {
      draw()
      animFrameIdRef.current = requestAnimationFrame(loop)
    }

    animFrameIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = 0
      }
    }
  }, [draw, isPlaying, filterId, intensity, chromaKey, autoMatte, customMatte, stroke])

  // Redraw when source, filter, intensity, chromaKey, autoMatte, customMatte, or stroke changes while paused
  React.useEffect(() => {
    if (!isPlaying) {
      draw()
    }
  }, [draw, isPlaying, filterId, intensity, chromaKey, autoMatte, customMatte, stroke, playbackResolution, bakeVideoPath])

  React.useImperativeHandle(
    ref,
    () => ({
      renderNow: (overrideSource, scrub) => {
        if (scrub !== undefined) {
          scrubTargetRef.current = scrub && Number.isFinite(scrub.sourceTime) && overrideSource instanceof HTMLVideoElement
            ? { source: overrideSource, time: scrub.sourceTime } : null
          if (overrideSource instanceof HTMLVideoElement) {
            if (!isPlaying && scrubTargetRef.current && bakedPairRef.current?.proxyState === 'ready') overrideSource.dataset.matteScrubOwned = 'true'
            else delete overrideSource.dataset.matteScrubOwned
          }
        }
        draw(overrideSource)
      },
      getCanvas: () => canvasRef.current,
      clear: clearCanvas,
      hasContent: () => hasContentRef.current,
      getMatteReadiness: () => {
        if (!autoMatte?.enabled) return 'missing'
        if (bakedPairRef.current) return matteReadinessRef.current
        return resolveMatteReadiness({
          matteEnabled: true,
          hasBake: Boolean(bakeVideoPath),
          bakeFailed: bakeFailedRef.current,
          hasValidTexture: hasValidMatteRef.current,
          drift: Math.abs(bakeDecodedTimeRef.current - (sourceDecodedTimeRef.current || 0)),
          isInferring: liveInferringRef.current,
          hasCachedResult: Boolean(matteEngine.getCachedResult(clipId || 'clip-preview')),
        })
      },
    }),
    [clearCanvas, draw, autoMatte?.enabled, bakeVideoPath, clipId, isPlaying],
  )

  const isVisible = Boolean(
    (filterId && intensity > 0) ||
    (chromaKey && chromaKey.enabled) ||
    (autoMatte && autoMatte.enabled) ||
    (customMatte && customMatte.enabled && customMatte.strokes && customMatte.strokes.length > 0) ||
    (stroke && stroke.enabled && stroke.style !== 'none' && stroke.width > 0)
  )

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        ...style,
        display: isVisible ? style?.display ?? 'block' : 'none',
      }}
    />
  )
})
