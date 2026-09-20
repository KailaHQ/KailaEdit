import * as ort from 'onnxruntime-web'
import type { AutoMatteQuality } from '@core/project-model'
import { decideMattePreview } from '@core/matte-preview-policy'

// The onnxruntime runtime files, resolved by the bundler rather than served from /public.
//
// These cannot live in `public/`: onnxruntime loads the `.mjs` with a dynamic `import()`,
// and Vite refuses to serve anything under `public/` as a module — "This file is in
// /public and will be copied as-is ... should not be imported from source code". Served
// from the package instead, the exact same file imports cleanly. The specifiers are the
// ones onnxruntime-web actually exports — its `exports` map publishes these runtime files
// at the package root, and a `dist/` path is not exported at all.
import ortJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

/** WebGPU runs on the jsep build; plain wasm runs on the other one. */
const ORT_RUNTIME_FILES = {
  webgpu: { mjs: ortJsepMjsUrl, wasm: ortJsepWasmUrl },
  wasm: { mjs: ortWasmMjsUrl, wasm: ortWasmBinaryUrl },
} as const
import { downsampleRatioForInferenceSize } from '@core/auto-matte'

/** Model outputs the preview actually consumes — see the note at the `run` call. */
const MATTE_FETCH_OUTPUTS = ['pha', 'r1o', 'r2o', 'r3o', 'r4o']

export interface MatteProcessOptions {
  clipId: string
  timestamp: number
  quality?: AutoMatteQuality | string
  isPlaying?: boolean
  force?: boolean
}

export interface MatteFrameResult {
  alphaData: Uint8Array
  width: number
  height: number
  timestamp: number
}

// Ensure offline WASM files load from local /wasm/ directory without touching external network
if (typeof window !== 'undefined' && ort.env?.wasm) {
  // Threads need cross-origin isolation (COOP/COEP). Without it onnxruntime prints a
  // warning and drops to one thread anyway, so asking for eighteen only added noise to a
  // console that turned out to be the only place the real failure was visible.
  const isolated = typeof globalThis !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
  const concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.floor(concurrency / 2)) : 1
}

const QUALITY_DIMS: Record<string, number> = {
  draft: 256,
  standard: 384,
  high: 512,
}

export class MatteEngine {
  private static instance: MatteEngine | null = null
  private session: ort.InferenceSession | null = null
  private provider: 'webgpu' | 'wasm' = 'wasm'
  private lastInferenceAt = 0
  private isDetecting = true
  private initPromise: Promise<ort.InferenceSession> | null = null

  // Single-slot queue state
  private isProcessing = false
  private pendingRequest: {
    source: CanvasImageSource
    options: MatteProcessOptions
    resolve: (res: MatteFrameResult | null) => void
    reject: (err: any) => void
  } | null = null

  // Recurrent state persistence across frames for RVM
  private r1: ort.Tensor | null = null
  private r2: ort.Tensor | null = null
  private r3: ort.Tensor | null = null
  private r4: ort.Tensor | null = null
  private lastClipId: string | null = null
  private lastTimestamp: number = 0

  // Offscreen canvas for frame resizing and RGB extraction
  private offscreenCanvas: HTMLCanvasElement | null = null
  private offscreenCtx: CanvasRenderingContext2D | null = null

  // Performance budget tracking
  private consecutiveSlowCount = 0
  private downgradedQuality: string | null = null
  private lastFrameResult: Map<string, MatteFrameResult> = new Map()

  static getInstance(): MatteEngine {
    if (!MatteEngine.instance) {
      MatteEngine.instance = new MatteEngine()
    }
    return MatteEngine.instance
  }

  getProvider(): 'webgpu' | 'wasm' {
    return this.provider
  }

  isDetectingProvider(): boolean {
    return this.isDetecting
  }

  getCachedResult(clipId: string): MatteFrameResult | undefined {
    return this.lastFrameResult.get(clipId)
  }

  resetStates(): void {
    const zero = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    this.r1 = zero
    this.r2 = zero
    this.r3 = zero
    this.r4 = zero
  }

  async initSession(): Promise<ort.InferenceSession> {
    if (this.session) return this.session
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      this.resetStates()

      // Detect WebGPU support in renderer
      let preferredProvider: 'webgpu' | 'wasm' = 'wasm'
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter()
          if (adapter) {
            preferredProvider = 'webgpu'
          }
        } catch {
          preferredProvider = 'wasm'
        }
      }

      console.log(`[MatteEngine] Detected preferred provider: ${preferredProvider}`)

      const modelUrl = '/models/rvm_mobilenetv3.onnx'
      let session: ort.InferenceSession | null = null

      if (preferredProvider === 'webgpu') {
        try {
          ort.env.wasm.wasmPaths = ORT_RUNTIME_FILES.webgpu
          session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: ['webgpu'],
          })
          this.provider = 'webgpu'
          console.log('[MatteEngine] Initialized session with WebGPU provider')
        } catch (err) {
          console.warn('[MatteEngine] Failed to create WebGPU session, falling back to WASM:', err)
        }
      }

      if (!session) {
        ort.env.wasm.wasmPaths = ORT_RUNTIME_FILES.wasm
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm'],
        })
        this.provider = 'wasm'
        console.log('[MatteEngine] Initialized session with WASM provider')
      }

      this.session = session
      this.isDetecting = false
      return session
    })()

    return this.initPromise
  }

  /**
   * Process a video or image frame to extract the alpha matte.
   * Single-slot queue: if inference is in progress, the newest frame replaces any older pending frame.
   */
  async processFrame(
    source: CanvasImageSource,
    options: MatteProcessOptions,
  ): Promise<MatteFrameResult | null> {
    const isImage = typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement
    const cached = this.lastFrameResult.get(options.clipId)

    // For static images, the picture never changes across timeline seconds.
    // If a matte is already cached for this clip and not forced, reuse it immediately.
    if (isImage && cached && !options.force) {
      return cached
    }

    const clipChanged = this.lastClipId !== options.clipId
    const seekJump = !isImage && Math.abs(options.timestamp - this.lastTimestamp) > 0.25

    if (clipChanged || seekJump) {
      this.resetStates()
    }

    // The rule itself lives in core with tests — see the comment there for why it matters.
    const decision = decideMattePreview({
      clipChanged,
      timestampDelta: options.timestamp - this.lastTimestamp,
      hasCached: Boolean(cached),
      isPlaying: Boolean(options.isPlaying),
      provider: this.provider,
      msSinceLastInference: performance.now() - this.lastInferenceAt,
      force: options.force,
    })

    if (decision === 'cached' && cached) {
      return cached
    }

    this.lastClipId = options.clipId
    this.lastTimestamp = options.timestamp

    // Single-slot queue: Drop any existing pending frame and wait for the new one
    if (this.isProcessing) {
      return new Promise<MatteFrameResult | null>((resolve, reject) => {
        if (this.pendingRequest) {
          // Drop older pending frame
          this.pendingRequest.resolve(null)
        }
        this.pendingRequest = { source, options, resolve, reject }
      })
    }

    return this.executeInference(source, options)
  }

  private async executeInference(
    source: CanvasImageSource,
    options: MatteProcessOptions,
  ): Promise<MatteFrameResult | null> {
    this.isProcessing = true
    const startTime = performance.now()
    this.lastInferenceAt = startTime

    try {
      const session = await this.initSession()

      const srcW = (source as any).videoWidth || (source as any).naturalWidth || (source as any).displayWidth || (source as any).width || 640
      const srcH = (source as any).videoHeight || (source as any).naturalHeight || (source as any).displayHeight || (source as any).height || 360

      const isStaticOrForced = Boolean(options.force || (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement))
      const rawQuality = isStaticOrForced ? (options.quality || 'high') : (this.downgradedQuality || options.quality || 'standard')
      const maxDim = isStaticOrForced ? 768 : (QUALITY_DIMS[rawQuality] || 384)
      const aspect = srcW / srcH

      let inferW = srcW
      let inferH = srcH
      if (inferW > maxDim || inferH > maxDim) {
        if (aspect >= 1) {
          inferW = maxDim
          inferH = Math.round(maxDim / aspect)
        } else {
          inferH = maxDim
          inferW = Math.round(maxDim * aspect)
        }
      }

      // Clamp to multiples of 2
      inferW = Math.max(16, Math.round(inferW / 2) * 2)
      inferH = Math.max(16, Math.round(inferH / 2) * 2)

      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas')
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })
      }

      this.offscreenCanvas.width = inferW
      this.offscreenCanvas.height = inferH
      const ctx = this.offscreenCtx!

      ctx.drawImage(source, 0, 0, inferW, inferH)
      const imgData = ctx.getImageData(0, 0, inferW, inferH)
      const rgba = imgData.data

      const totalPixels = inferW * inferH
      const planarData = new Float32Array(3 * totalPixels)
      const offsetG = totalPixels
      const offsetB = 2 * totalPixels

      for (let i = 0; i < totalPixels; i++) {
        const rgbaIdx = i * 4
        planarData[i] = rgba[rgbaIdx] / 255.0
        planarData[offsetG + i] = rgba[rgbaIdx + 1] / 255.0
        planarData[offsetB + i] = rgba[rgbaIdx + 2] / 255.0
      }

      const srcTensor = new ort.Tensor('float32', planarData, [1, 3, inferH, inferW])
      const dsRatio = new ort.Tensor(
        'float32',
        new Float32Array([downsampleRatioForInferenceSize(Math.max(inferW, inferH))]),
        [1],
      )

      if (!this.r1) this.resetStates()

      // Warmup ConvGRU recurrent states for static images or forced single frames
      if (isStaticOrForced) {
        for (let w = 0; w < 4; w++) {
          const warmupFeeds: Record<string, ort.Tensor> = {
            src: srcTensor,
            r1i: this.r1!,
            r2i: this.r2!,
            r3i: this.r3!,
            r4i: this.r4!,
            downsample_ratio: dsRatio,
          }
          const warmRes = await session.run(warmupFeeds, ['r1o', 'r2o', 'r3o', 'r4o'])
          this.r1 = warmRes.r1o
          this.r2 = warmRes.r2o
          this.r3 = warmRes.r3o
          this.r4 = warmRes.r4o
        }
      }

      const feeds: Record<string, ort.Tensor> = {
        src: srcTensor,
        r1i: this.r1!,
        r2i: this.r2!,
        r3i: this.r3!,
        r4i: this.r4!,
        downsample_ratio: dsRatio,
      }

      // `fgr` (the foreground colour estimate) is never read here, and asking for it makes
      // WebGPU read a full-resolution three-channel float tensor back to the CPU on every
      // frame. Fetching only what the matte needs is the single biggest win in this loop.
      const results = await session.run(feeds, MATTE_FETCH_OUTPUTS)

      // Carry recurrent states forward to preserve video temporal consistency
      this.r1 = results.r1o
      this.r2 = results.r2o
      this.r3 = results.r3o
      this.r4 = results.r4o

      const pha = results.pha
      const phaData = pha.data as Float32Array
      const alphaData = new Uint8Array(totalPixels)

      // Writing through a clamped view of the same memory lets the engine do the clamp
      // and the round, which is what the branchy expression here used to do by hand —
      // same bytes out, about a third less time in the loop. `alphaData` is untouched as
      // a Uint8Array for its callers.
      const alphaClamped = new Uint8ClampedArray(alphaData.buffer)
      for (let i = 0; i < totalPixels; i++) alphaClamped[i] = phaData[i] * 255

      const durationMs = performance.now() - startTime

      // Performance budget management:
      // Only track and downgrade quality for continuous timeline playback, never for forced still frames
      if (!isStaticOrForced) {
        if (durationMs > 33) {
          this.consecutiveSlowCount++
          if (this.consecutiveSlowCount >= 3) {
            if (!this.downgradedQuality && rawQuality === 'high') {
              this.downgradedQuality = 'standard'
              console.warn('[MatteEngine] 3 consecutive slow inferences, downgraded quality from high to standard')
            } else if (this.downgradedQuality === 'standard' || rawQuality === 'standard') {
              this.downgradedQuality = 'draft'
              console.warn('[MatteEngine] 3 consecutive slow inferences, downgraded quality to draft')
            }
            this.consecutiveSlowCount = 0
          }
        } else {
          this.consecutiveSlowCount = 0
        }
      }

      const result: MatteFrameResult = {
        alphaData,
        width: inferW,
        height: inferH,
        timestamp: options.timestamp,
      }

      this.lastFrameResult.set(options.clipId, result)
      return result
    } catch (err) {
      console.error('[MatteEngine] Inference error:', err)
      return null
    } finally {
      this.isProcessing = false

      // Process single queued pending request if one arrived while busy
      if (this.pendingRequest) {
        const next = this.pendingRequest
        this.pendingRequest = null
        this.executeInference(next.source, next.options).then(next.resolve, next.reject)
      }
    }
  }

  dispose(): void {
    if (this.session) {
      try {
        this.session.release()
      } catch {}
      this.session = null
    }
    this.r1 = null
    this.r2 = null
    this.r3 = null
    this.r4 = null
    this.lastFrameResult.clear()
    this.initPromise = null
  }
}

export const matteEngine = MatteEngine.getInstance()
