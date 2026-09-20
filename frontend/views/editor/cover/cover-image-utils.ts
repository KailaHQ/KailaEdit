import { MatteEngine } from '../preview/MatteEngine'

/**
 * Removes the background of an image using KailaEdit's built-in on-device AI matting.
 * 100% offline, zero external network calls.
 * 
 * Prefers high-fidelity native processing via Electron main process (DirectML/CPU + ffmpeg),
 * with seamless fallback to client-side MatteEngine (WebGPU/WASM).
 * 
 * @param imageSrc A data URL, blob URL, or file path of the source image.
 * @returns A Promise resolving to a PNG data URL with transparent background.
 */
export async function removeImageBackground(imageSrc: string): Promise<string> {
  // 1. Try high-fidelity native background removal via Electron main process
  if (typeof window !== 'undefined' && window.electronAPI?.imageRemoveBackground) {
    try {
      const res = await window.electronAPI.imageRemoveBackground({
        imageSrc,
        quality: 'high',
      })
      if (res.success && res.cutoutDataUrl) {
        return res.cutoutDataUrl
      }
      if (res.error) {
        console.warn('[removeImageBackground] Main process background removal reported error, trying fallback:', res.error)
      }
    } catch (err) {
      console.warn('[removeImageBackground] Failed to call main process background removal, falling back:', err)
    }
  }

  // 2. Fallback: In-browser MatteEngine (WebGPU/WASM)
  const img = new Image()
  if (!imageSrc.startsWith('data:') && !imageSrc.startsWith('blob:')) {
    img.crossOrigin = 'anonymous'
  }

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = (e) => {
      console.error('[removeImageBackground] Failed to load image:', e)
      reject(new Error('Failed to load image for background removal'))
    }
    img.src = imageSrc
    if (img.complete && img.naturalWidth > 0) {
      resolve()
    }
  })

  const srcW = img.naturalWidth || img.width || 640
  const srcH = img.naturalHeight || img.height || 480

  const matte = MatteEngine.getInstance()
  const frameResult = await matte.processFrame(img, {
    clipId: `cover-matte-${Date.now()}`,
    timestamp: 0,
    force: true,
    quality: 'high',
  })

  if (!frameResult || !frameResult.alphaData) {
    throw new Error('MatteEngine could not generate alpha mask for image')
  }

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = frameResult.width
  maskCanvas.height = frameResult.height
  const maskCtx = maskCanvas.getContext('2d')
  if (!maskCtx) {
    throw new Error('Failed to get 2D context for mask canvas')
  }

  const maskImgData = maskCtx.createImageData(frameResult.width, frameResult.height)
  const maskPixels = maskImgData.data
  const total = frameResult.width * frameResult.height

  for (let i = 0; i < total; i++) {
    const idx = i * 4
    maskPixels[idx] = 255
    maskPixels[idx + 1] = 255
    maskPixels[idx + 2] = 255
    maskPixels[idx + 3] = frameResult.alphaData[i]
  }
  maskCtx.putImageData(maskImgData, 0, 0)

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = srcW
  outputCanvas.height = srcH
  const outCtx = outputCanvas.getContext('2d')
  if (!outCtx) {
    throw new Error('Failed to get 2D context for output canvas')
  }

  outCtx.drawImage(img, 0, 0, srcW, srcH)
  outCtx.globalCompositeOperation = 'destination-in'
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(maskCanvas, 0, 0, srcW, srcH)

  return outputCanvas.toDataURL('image/png')
}
