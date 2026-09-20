import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { getImageDimensions } from '../ipc/image-utils'
import { onnxSessionManager, getOrt } from './onnx-session'
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
    const { width: srcW, height: srcH } = getImageDimensions(inputPath)
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
    const extractRes = spawnSync(
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
      { maxBuffer: 100 * 1024 * 1024, timeout: 20000 },
    )

    if (extractRes.status !== 0 || !extractRes.stdout) {
      const err = extractRes.stderr?.toString().trim() || 'Failed to extract RGB buffer'
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

    const planarData = new Float32Array(3 * totalPixels)
    const offsetG = totalPixels
    const offsetB = 2 * totalPixels
    for (let i = 0; i < totalPixels; i++) {
      planarData[i] = rawRgb[i * 3] / 255.0
      planarData[offsetG + i] = rawRgb[i * 3 + 1] / 255.0
      planarData[offsetB + i] = rawRgb[i * 3 + 2] / 255.0
    }

    // 5. Build ONNX tensors
    const ort = getOrt()
    const srcTensor = new ort.Tensor('float32', planarData, [1, 3, inferH, inferW])
    const dsRatioVal = downsampleRatioForInferenceSize(Math.max(inferW, inferH))
    const dsTensor = new ort.Tensor('float32', new Float32Array([dsRatioVal]), [1])

    let r1: any = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    let r2: any = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    let r3: any = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
    let r4: any = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])

    const session = await onnxSessionManager.getSession('rvm_mobilenetv3', 'auto')

    // 6. Warmup passes (8 passes to let ConvGRU recurrent states settle completely on still image)
    const warmupCount = 8
    for (let w = 0; w < warmupCount; w++) {
      const warmupFeeds: Record<string, any> = {
        src: srcTensor,
        r1i: r1,
        r2i: r2,
        r3i: r3,
        r4i: r4,
        downsample_ratio: dsTensor,
      }
      const warmRes = await session.run(warmupFeeds, ['r1o', 'r2o', 'r3o', 'r4o'])
      r1 = warmRes.r1o
      r2 = warmRes.r2o
      r3 = warmRes.r3o
      r4 = warmRes.r4o
    }

    // 7. Final inference pass to fetch alpha mask ('pha')
    const finalFeeds: Record<string, any> = {
      src: srcTensor,
      r1i: r1,
      r2i: r2,
      r3i: r3,
      r4i: r4,
      downsample_ratio: dsTensor,
    }
    const finalRes = await session.run(finalFeeds, ['pha', 'r1o', 'r2o', 'r3o', 'r4o'])
    const pha = finalRes.pha.data as Float32Array

    // 8. Convert alpha mask to 8-bit grayscale raw buffer
    const grayBuf = Buffer.alloc(totalPixels)
    for (let i = 0; i < totalPixels; i++) {
      grayBuf[i] = Math.round(Math.max(0, Math.min(1, pha[i])) * 255)
    }

    const tempMaskRaw = path.join(os.tmpdir(), `kaila-bgrem-mask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.raw`)
    const tempOutPng = path.join(os.tmpdir(), `kaila-bgrem-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    tempFilesToClean.push(tempMaskRaw, tempOutPng)
    fs.writeFileSync(tempMaskRaw, grayBuf)

    // 9. Composite alpha mask with original input at full original resolution using ffmpeg alphamerge
    const compRes = spawnSync(
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
      { timeout: 30000 },
    )

    if (compRes.status !== 0 || !fs.existsSync(tempOutPng)) {
      const err = compRes.stderr?.toString().trim() || 'Failed to composite transparent PNG'
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
