import { extractVideoFrameToFile } from '../export/ffmpeg-utils'
import { extractAudioPeaks } from '../export/audio-peaks'
import { observeLoudness, observeSilence } from '../media-analyzer'
import { proxyManager } from '../export/proxy-manager'
import { renderCacheManager } from '../export/render-cache-manager'
import { matteService } from '../matte/matte-service'
import { trackMatteMotion } from '../matte/motion-track'
import { stabilizeService } from '../stabilize/stabilize-service'
import { getAllowedRoots } from '../config'
import { validatePath } from '../path-validation'
import { handle } from './typed-handle'

export function registerVideoProcessingHandlers(): void {
  proxyManager.init()
  renderCacheManager.init()
  stabilizeService.init()

  handle('getAudioPeaks', async ({ filePath, buckets }) => {
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    return extractAudioPeaks(normalizedPath, buckets)
  })

  handle('measureLoudness', async ({ filePath, startTime, duration }) => {
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    return observeLoudness(normalizedPath, { startTime, duration })
  })

  handle('trackMatteMotion', async ({ filePath, startTime, duration }) => {
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    return trackMatteMotion({ filePath: normalizedPath, startTime, duration })
  })

  handle('detectSilence', async ({ filePath, noiseDb, minDurationSec, startTime, duration }) => {
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    return observeSilence(normalizedPath, { noiseDb, minDurationSec, startTime, duration })
  })

  handle('extractVideoFrame', async ({ videoPath, seekTime, width, quality }) => {
    return {
      path: extractVideoFrameToFile({
        videoPath,
        seekTime,
        width,
        quality: quality ?? 2,
        timeoutMs: 10000,
      }),
    }
  })

  handle('generateProxy', async ({ assetId, filePath }) => {
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    const result = await proxyManager.enqueueProxy(assetId, normalizedPath)
    if (result.success) {
      return { success: true, proxyPath: result.proxyPath }
    }
    return { success: false, error: result.error || 'Failed to generate proxy' }
  })

  handle('cancelProxy', async ({ assetId }) => {
    proxyManager.cancelProxy(assetId)
    return { success: true }
  })

  handle('getProxyStatus', async ({ assetId }) => {
    const status = proxyManager.getProxyStatus(assetId)
    return status
  })

  handle('renderCacheCheck', async ({ hashes }) => {
    return renderCacheManager.checkHashes(hashes)
  })

  handle('renderCacheRequest', async (params) => {
    const result = await renderCacheManager.renderSegment(params)
    if (result.success) {
      return { success: true, cachePath: result.cachePath }
    }
    return { success: false, error: result.error || 'Failed to render cache segment' }
  })

  handle('renderCacheClear', async () => {
    const freedBytes = renderCacheManager.clearCache()
    return { success: true, freedBytes }
  })

  handle('matteBakeStart', async (params) => {
    const normalizedPath = validatePath(params.filePath, getAllowedRoots())
    return matteService.startBake({
      ...params,
      filePath: normalizedPath,
    })
  })

  handle('matteScrubProxy', async ({ sourcePath, mattePath }) => {
    const source = validatePath(sourcePath, getAllowedRoots())
    const matte = validatePath(mattePath, getAllowedRoots())
    const { ensureScrubProxy } = await import('../matte/scrub-proxy')
    try {
      const [sourceProxy, matteProxy] = await Promise.all([ensureScrubProxy(source), ensureScrubProxy(matte)])
      return { sourcePath: sourceProxy, mattePath: matteProxy }
    } catch (error) { return { error: String(error) } }
  })

  handle('matteGetDeviceInfo', async () => {
    const { onnxSessionManager } = await import('../matte/onnx-session')
    const probe = await onnxSessionManager.probeProviders()
    return {
      available: probe.available,
      preferred: probe.preferred,
      gpuAvailable: probe.gpuAvailable,
      active: onnxSessionManager.getActiveProvider(),
    }
  })

  handle('matteBakeMissing', async ({ paths }) => {
    // The render cache is a cache: it evicts under a size cap, Settings can clear it, and
    // a format migration can drop it. A project holds absolute paths into it, so those
    // paths go stale on their own. Nothing else notices — bake validity compares recorded
    // fields, not the filesystem — so a clip kept reporting "matte ready" while its matte
    // had been gone for hours and the preview quietly showed the background.
    const fs = await import('fs')
    const missing = paths.filter(p => {
      try {
        return !fs.existsSync(p) || fs.statSync(p).size <= 0
      } catch {
        return true
      }
    })
    return { missing }
  })

  handle('matteBakeCancel', async ({ jobId }) => {
    const success = matteService.cancelJob(jobId)
    return { success }
  })

  handle('matteBakeStatus', async ({ jobId }) => {
    return matteService.getJobStatus(jobId)
  })

  handle('stabilizeStart', async (params) => {
    const normalizedPath = validatePath(params.filePath, getAllowedRoots())
    return stabilizeService.start({ ...params, filePath: normalizedPath })
  })

  handle('stabilizeCancel', async ({ jobId }) => {
    return { success: stabilizeService.cancel(jobId) }
  })

  handle('stabilizeStatus', async ({ jobId }) => {
    return stabilizeService.status(jobId)
  })

  handle('stabilizeMissing', async ({ paths }) => {
    // Same reason as matteBakeMissing: bake validity compares recorded fields, not the
    // filesystem, and a cleared cache would otherwise leave clips claiming a bake.
    const fs = await import('fs')
    const missing = paths.filter(p => {
      try {
        return !fs.existsSync(p) || fs.statSync(p).size <= 0
      } catch {
        return true
      }
    })
    return { missing }
  })

  handle('imageRemoveBackground', async ({ imageSrc, quality }) => {
    const { removeStillImageBackground } = await import('../matte/image-matte')
    return removeStillImageBackground({ imageSrc, quality })
  })
}
