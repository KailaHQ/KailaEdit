import path from 'path'
import fs from 'fs'
import { logger } from '../logger'
import { probeProvidersInWorker } from './matte-worker-host'
import type { AutoMatteDevice } from '../../core/src/project-model'

export function resolveModelPath(modelName: string = 'rvm_mobilenetv3'): string {
  const filename = modelName.endsWith('.onnx') ? modelName : `${modelName}.onnx`

  // 1. Packaged electron resources under app.asar.unpacked
  if (process.resourcesPath) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'models', filename)
    if (fs.existsSync(unpackedPath)) return unpackedPath

    const directResourcesPath = path.join(process.resourcesPath, 'models', filename)
    if (fs.existsSync(directResourcesPath)) return directResourcesPath
  }

  // 2. Relative to process.cwd() (dev mode)
  const devPath = path.resolve(process.cwd(), 'resources', 'models', filename)
  if (fs.existsSync(devPath)) return devPath

  // 3. Fallback relative to __dirname
  try {
    const dirnameFallback = path.resolve(__dirname, '..', '..', 'resources', 'models', filename)
    if (fs.existsSync(dirnameFallback)) return dirnameFallback
  } catch {
    // Ignore __dirname resolution in ESM contexts where __dirname might not exist
  }

  return devPath
}

export function getProviderChain(device: AutoMatteDevice): string[] {
  const gpu: string[] =
    process.platform === 'win32' ? ['dml']
    : process.platform === 'darwin' ? ['coreml']
    : ['cuda']

  switch (device) {
    case 'cpu':
      return ['cpu']
    case 'gpu':
      // No 'cpu' at the end: asking for the GPU explicitly should fail loudly rather
      // than run ten times slower without saying so.
      return gpu
    case 'auto':
    default:
      return [...gpu, 'cpu']
  }
}

/**
 * What the app knows about ONNX execution providers.
 *
 * No inference session lives here any more: every model load and run happens on a matte
 * worker thread (see matte-worker-host). On the main process they froze the window, and the
 * preview with it, for as long as DirectML took to start.
 */
export class OnnxSessionManager {
  private static instance: OnnxSessionManager | null = null
  private activeProvider: string | null = null
  private probeCache: { available: string[]; preferred: string; gpuAvailable: boolean } | null = null
  private probeInFlight: Promise<{ available: string[]; preferred: string; gpuAvailable: boolean }> | null = null

  static getInstance(): OnnxSessionManager {
    if (!OnnxSessionManager.instance) {
      OnnxSessionManager.instance = new OnnxSessionManager()
    }
    return OnnxSessionManager.instance
  }

  /** Set the active provider recorded from worker execution. */
  setActiveProvider(provider: string | null): void {
    this.activeProvider = provider
  }

  /** The provider the last matte worker ran on, if any. */
  getActiveProvider(): string | null {
    return this.activeProvider
  }

  /**
   * Which providers this machine can actually create a session with. The answer is cached
   * after the first check: probing means loading the model on each provider, which is slow.
   */
  probeProviders(): Promise<{ available: string[]; preferred: string; gpuAvailable: boolean }> {
    if (this.probeCache) return Promise.resolve(this.probeCache)
    if (!this.probeInFlight) {
      this.probeInFlight = this.runProbe().finally(() => { this.probeInFlight = null })
    }
    return this.probeInFlight
  }

  private async runProbe(): Promise<{ available: string[]; preferred: string; gpuAvailable: boolean }> {
    const modelPath = resolveModelPath()
    let available: string[] = []
    if (fs.existsSync(modelPath)) {
      try {
        const result = await probeProvidersInWorker(modelPath, getProviderChain('auto'))
        available = result.available
        for (const failure of result.failures) {
          logger.info(`[onnx-session] Provider unavailable: ${failure}`)
        }
      } catch (err) {
        logger.warn(`[onnx-session] Provider probe failed: ${String(err)}`)
      }
    }

    if (!available.includes('cpu')) available.push('cpu')
    const preferred = available[0] ?? 'cpu'
    this.probeCache = { available, preferred, gpuAvailable: preferred !== 'cpu' }
    logger.info(`[onnx-session] Providers available: ${available.join(', ')} (preferred: ${preferred})`)
    return this.probeCache
  }
}

export const onnxSessionManager = OnnxSessionManager.getInstance()
