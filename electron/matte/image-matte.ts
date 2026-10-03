import fs from 'fs'
import os from 'os'
import path from 'path'
import { findFfmpegPath, runFfmpegCapture, runFfmpegCaptureBinary } from '../export/ffmpeg-utils'
import { getImageDimensions } from '../ipc/image-utils'
import { getProviderChain, onnxSessionManager, resolveModelPath } from './onnx-session'
import { matteSingleFrame } from './matte-worker-host'
import { downsampleRatioForInferenceSize } from '../../core/src/auto-matte'
import { logger } from '../logger'

export interface RemoveStillImageBackgroundParams {
  imageSrc: string
  quality?: 'standard' | 'high'
}

export interface RemoveStillImageBackgroundResult {
  success: boolean
  cutoutDataUrl?: string
  error?: string
}

export async function removeStillImageBackground(
  params: RemoveStillImageBackgroundParams,
): Promise<RemoveStillImageBackgroundResult> {
  const { imageSrc, quality = 'high' } = params
  const tempFilesToClean: string[] = []

  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return { success: false, error: 'ffmpeg not found on system' }
    }

    // 1. Resolve image source to an on-disk file
    let inputPath = ''
    if (imageSrc.startsWith('data:image/')) {
      const match = imageSrc.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/)
      if (!match) {
        return { success: false, error: 'Invalid base64 data URL format' }
      }
      const rawExt = match[1].toLowerCase()
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
      const buf = Buffer.from(match[2], 'base64')
      const tempIn = path.join(os.tmpdir(), `kaila-bgrem-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
      fs.writeFileSync(tempIn, buf)
      tempFilesToClean.push(tempIn)
      inputPath = tempIn
    } else if (imageSrc.startsWith('file://')) {
      inputPath = decodeURIComponent(new URL(imageSrc).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    } else {
      inputPath = imageSrc
    }

    if (!fs.existsSync(inputPath)) {
      return { success: false, error: `Image source file does not exist: ${inputPath}` }
    }

    // 2. Measure source dimensions
    const { width: srcW, height: srcH } = await getImageDimensions(inputPath)
    if (!srcW || !srcH) {
      return { success: false, error: `Unable to determine image dimensions for ${inputPath}` }
    }

    // 3. Compute inference resolution
    // High: up to 1280px (balances optimal edge/hair fidelity with sub-second execution)
    // Standard: up to 960px
    const maxDim = quality === 'high' ? 1280 : 960
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

    logger.info(`[image-matte] Processing still image: src=${srcW}x${srcH}, infer=${inferW}x${inferH}, quality=${quality}`)

    // 4. Extract planar RGB frame via ffmpeg
    const extractRes = await runFfmpegCaptureBinary(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-vf', `scale=${inferW}:${inferH}`,
        '-pix_fmt', 'rgb24',
        '-f', 'rawvideo',
        '-',
      ],
      { maxStdoutBytes: 100 * 1024 * 1024, timeoutMs: 20000 },
    )

    if (extractRes.status !== 0 || extractRes.stdout.length === 0) {
      const err = extractRes.stderr.trim() || 'Failed to extract RGB buffer'
      return { success: false, error: `ffmpeg decode error: ${err}` }
    }

    const rawRgb = extractRes.stdout
    const totalPixels = inferW * inferH
    if (rawRgb.length !== totalPixels * 3) {
      return {
        success: false,
        error: `Unexpected RGB buffer size: got ${rawRgb.length}, expected ${totalPixels * 3}`,
      }
    }

    // 5–8. Inference runs on a worker thread. Done here, loading the model (DirectML
    // especially) and the warmup passes blocked the main process — window and preview
    // with it — for over a second per image.
    const rgb = rawRgb.buffer.slice(rawRgb.byteOffset, rawRgb.byteOffset + rawRgb.byteLength) as ArrayBuffer
    const { alpha: grayBuf, provider } = await matteSingleFrame({
      modelPath: resolveModelPath('rvm_mobilenetv3'),
      modelName: 'rvm_mobilenetv3',
      device: 'auto',
      providerChain: getProviderChain('auto'),
      inferW,
      inferH,
      downsampleRatio: downsampleRatioForInferenceSize(Math.max(inferW, inferH)),
      // Eight passes let the ConvGRU recurrent state settle on a single picture.
      warmupFrames: 8,
      intraOpNumThreads: Math.max(1, Math.floor((os.cpus()?.length || 4) / 2)),
    }, rgb)
    onnxSessionManager.setActiveProvider(provider)

    const tempMaskRaw = path.join(os.tmpdir(), `kaila-bgrem-mask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.raw`)
    const tempOutPng = path.join(os.tmpdir(), `kaila-bgrem-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    tempFilesToClean.push(tempMaskRaw, tempOutPng)
    fs.writeFileSync(tempMaskRaw, grayBuf)

    // 9. Composite alpha mask with original input at full original resolution using ffmpeg alphamerge
    const compRes = await runFfmpegCapture(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-f', 'rawvideo',
        '-pix_fmt', 'gray',
        '-s', `${inferW}x${inferH}`,
        '-i', tempMaskRaw,
        '-filter_complex', `[1:v]scale=${srcW}:${srcH}:flags=bicubic[m];[0:v][m]alphamerge`,
        '-c:v', 'png',
        tempOutPng,
      ],
      30000,
    )

    if (compRes.status !== 0 || !fs.existsSync(tempOutPng)) {
      const err = compRes.stderr.trim() || 'Failed to composite transparent PNG'
      return { success: false, error: `ffmpeg composite error: ${err}` }
    }

    // 10. Read composite result as base64 PNG data URL
    const pngBuf = fs.readFileSync(tempOutPng)
    const cutoutDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`

    logger.info(`[image-matte] Background removal succeeded, output size=${pngBuf.length} bytes`)
    return {
      success: true,
      cutoutDataUrl,
    }
  } catch (err) {
    logger.error(`[image-matte] Failed to remove still image background: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    // Clean up temporary files quietly
    for (const f of tempFilesToClean) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      } catch {}
    }
  }
}
