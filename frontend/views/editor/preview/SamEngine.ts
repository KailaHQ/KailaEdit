import * as ort from 'onnxruntime-web'
import { samEncoderSize, samMaskFromLogits, samPromptTensors, type SamPoint } from '@core/sam-prompt'
import { ORT_RUNTIME_FILES } from './MatteEngine'

/**
 * MobileSAM in the renderer: the smart brush and smart eraser's "which object is this".
 *
 * The encoder is the slow half (a few hundred ms on WebGPU, a second or two on wasm) and
 * depends only on the picture, so it runs once per frame and is kept; each tap then only
 * runs the decoder, which takes tens of milliseconds.
 */

const ENCODER_URL = '/models/mobile_sam_image_encoder.onnx'
const DECODER_URL = '/models/sam_mask_decoder_single.onnx'

interface Sessions {
  encoder: ort.InferenceSession
  decoder: ort.InferenceSession
  onGpu: boolean
}

interface Embedding {
  key: string
  tensor: ort.Tensor
}

class SamEngine {
  private embedding: Embedding | null = null
  private pendingEmbedding: { key: string; promise: Promise<ort.Tensor> } | null = null

  private sessions: Promise<Sessions> | null = null
  private gpuFailed = false

  private load(): Promise<Sessions> {
    if (this.sessions) return this.sessions
    this.sessions = (async () => {
      const create = async (providers: Array<'webgpu' | 'wasm'>): Promise<Sessions> => ({
        encoder: await ort.InferenceSession.create(ENCODER_URL, { executionProviders: providers }),
        decoder: await ort.InferenceSession.create(DECODER_URL, { executionProviders: ['wasm'] }),
        onGpu: providers[0] === 'webgpu',
      })
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as { gpu?: unknown }).gpu)
      if (!ort.env.wasm.wasmPaths) ort.env.wasm.wasmPaths = hasGpu ? ORT_RUNTIME_FILES.webgpu : ORT_RUNTIME_FILES.wasm
      if (hasGpu && !this.gpuFailed) {
        try {
          return await create(['webgpu'])
        } catch (err) {
          console.warn('[SamEngine] WebGPU session failed, using wasm:', err)
        }
      }
      return create(['wasm'])
    })()
    this.sessions.catch(() => { this.sessions = null })
    return this.sessions
  }

  /**
   * The encoder's run, moved to wasm for good if it fails on WebGPU. A WebGPU session can be
   * created and still fail to run — and one kernel that throws, in any model on the page,
   * leaves the shared WebGPU backend unable to run anything after it — so a failure there
   * is not the end of the smart brush, only of the GPU for it.
   */
  private async encode(input: ort.Tensor): Promise<ort.Tensor> {
    const sessions = await this.load()
    try {
      const out = await sessions.encoder.run({ input_image: input })
      return out.image_embeddings as ort.Tensor
    } catch (err) {
      if (!sessions.onGpu) throw err
      console.warn('[SamEngine] WebGPU run failed, using wasm:', err)
      this.gpuFailed = true
      if ((await this.sessions?.catch(() => null))?.onGpu) this.sessions = null
      const { encoder } = await this.load()
      const out = await encoder.run({ input_image: input })
      return out.image_embeddings as ort.Tensor
    }
  }

  /** The picture's embedding, worked out once per `key` (clip + frame). */
  embed(source: HTMLVideoElement | HTMLImageElement, key: string): Promise<ort.Tensor> {
    if (this.embedding?.key === key) return Promise.resolve(this.embedding.tensor)
    if (this.pendingEmbedding?.key === key) return this.pendingEmbedding.promise
    const promise = (async () => {
      const width0 = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
      const height0 = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
      if (!(width0 > 0 && height0 > 0)) throw new Error('The picture is not loaded yet')
      const { width, height } = samEncoderSize(width0, height0)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Canvas is not available')
      ctx.drawImage(source, 0, 0, width, height)
      const rgba = ctx.getImageData(0, 0, width, height).data
      const hwc = new Float32Array(width * height * 3)
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        hwc[j] = rgba[i]
        hwc[j + 1] = rgba[i + 1]
        hwc[j + 2] = rgba[i + 2]
      }
      const tensor = await this.encode(new ort.Tensor('float32', hwc, [height, width, 3]))
      this.embedding = { key, tensor }
      return tensor
    })()
    this.pendingEmbedding = { key, promise }
    promise.finally(() => { if (this.pendingEmbedding?.promise === promise) this.pendingEmbedding = null }).catch(() => {})
    return promise
  }

  /** The object the points describe, as 0..255 coverage of a `width` x `height` picture. */
  async segment(
    source: HTMLVideoElement | HTMLImageElement,
    key: string,
    points: SamPoint[],
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    const embedding = await this.embed(source, key)
    const { decoder } = await this.load()
    const prompt = samPromptTensors(points, width, height)
    const out = await decoder.run({
      image_embeddings: embedding,
      point_coords: new ort.Tensor('float32', prompt.coords, [1, prompt.count, 2]),
      point_labels: new ort.Tensor('float32', prompt.labels, [1, prompt.count]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
      orig_im_size: new ort.Tensor('float32', new Float32Array([height, width]), [2]),
    })
    const masks = out.masks as ort.Tensor
    return samMaskFromLogits(masks.data as Float32Array, width, height, points)
  }
}

export const samEngine = new SamEngine()
