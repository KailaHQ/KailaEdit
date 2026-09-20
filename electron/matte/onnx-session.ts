import os from 'os'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { logger } from '../logger'
import type { AutoMatteDevice } from '../../core/src/project-model'

const require = createRequire(import.meta.url)

let ortModule: typeof import('onnxruntime-node') | null = null

export function getOrt(): typeof import('onnxruntime-node') {
  if (!ortModule) {
    ortModule = require('onnxruntime-node')
  }
  return ortModule!
}

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

export class OnnxSessionManager {
  private static instance: OnnxSessionManager | null = null
  private session: import('onnxruntime-node').InferenceSession | null = null
  private currentModelName: string | null = null
  private currentDevice: AutoMatteDevice | null = null
  private activeProvider: string | null = null
  private probeCache: { available: string[]; preferred: string; gpuAvailable: boolean } | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  static getInstance(): OnnxSessionManager {
    if (!OnnxSessionManager.instance) {
      OnnxSessionManager.instance = new OnnxSessionManager()
    }
    return OnnxSessionManager.instance
  }

  /**
   * Execution providers to try, in order, for a device preference.
   *
   * Windows ships DirectML.dll with onnxruntime-node, so 'dml' is real there. macOS gets
   * CoreML. 'cuda' only exists in a separately installed build, so it is tried and allowed
   * to fail rather than assumed.
   */
  private providerChain(device: AutoMatteDevice): string[] {
    return getProviderChain(device)
  }

  /** Set the active provider recorded from worker execution or session initialization. */
  setActiveProvider(provider: string | null): void {
    this.activeProvider = provider
  }

  /** The provider backing the session that is loaded right now, if any. */
  getActiveProvider(): string | null {
    return this.activeProvider
  }

  /**
   * Which providers this machine can actually create a session with. The answer is cached
   * after the first check: probing means loading the model on each provider, which is slow.
   */
  async probeProviders(): Promise<{ available: string[]; preferred: string; gpuAvailable: boolean }> {
    if (this.probeCache) return this.probeCache

    const candidates = [...this.providerChain('auto')]
    const available: string[] = []
    const modelPath = resolveModelPath()

    for (const ep of candidates) {
      if (!fs.existsSync(modelPath)) break
      try {
        const probe = await getOrt().InferenceSession.create(modelPath, {
          executionProviders: [ep] as never,
          intraOpNumThreads: 1,
        })
        available.push(ep)
        try {
          if (typeof (probe as any).release === 'function') (probe as any).release()
        } catch {}
      } catch (err) {
        logger.info(`[onnx-session] Provider '${ep}' unavailable: ${String(err).slice(0, 160)}`)
      }
    }

    if (!available.includes('cpu')) available.push('cpu')
    const preferred = available[0] ?? 'cpu'
    this.probeCache = { available, preferred, gpuAvailable: preferred !== 'cpu' }
    logger.info(`[onnx-session] Providers available: ${available.join(', ')} (preferred: ${preferred})`)
    return this.probeCache
  }

  /**
   * Acquire an ONNX inference session. Lazily initializes the session on first request.
   * Resets the 5-minute idle disposal timer.
   */
  async getSession(
    modelName: string = 'rvm_mobilenetv3',
    device: AutoMatteDevice = 'auto',
  ): Promise<import('onnxruntime-node').InferenceSession> {
    this.resetIdleTimer()

    if (this.session && this.currentModelName === modelName && this.currentDevice === device) {
      return this.session
    }

    if (this.session) {
      logger.info(`[onnx-session] Disposing existing session (model ${this.currentModelName}, device ${this.currentDevice}) to load ${modelName} on ${device}`)
      this.disposeSession()
    }

    const modelPath = resolveModelPath(modelName)
    if (!fs.existsSync(modelPath)) {
      throw new Error(`[onnx-session] Model file not found at path: ${modelPath}`)
    }

    const ort = getOrt()
    const numCpus = os.cpus()?.length || 4
    // Cap intraOpNumThreads at roughly half of the cores so the UI / timeline does not freeze during bake
    const intraOpNumThreads = Math.max(1, Math.floor(numCpus / 2))

    const chain = this.providerChain(device)
    let session: import('onnxruntime-node').InferenceSession | null = null
    let used: string | null = null
    const failures: string[] = []

    for (const ep of chain) {
      try {
        session = await ort.InferenceSession.create(modelPath, {
          executionProviders: [ep] as never,
          intraOpNumThreads,
        })
        used = ep
        logger.info(`[onnx-session] Created session for ${modelName} on '${ep}' (threads: ${intraOpNumThreads})`)
        break
      } catch (err) {
        const msg = `${ep}: ${String(err).slice(0, 200)}`
        failures.push(msg)
        logger.warn(`[onnx-session] Could not create session on ${msg}`)
      }
    }

    if (!session || !used) {
      throw new Error(
        device === 'gpu'
          ? `GPU not usable for background removal (${failures.join(' | ')}). Switch the setting to Auto or CPU.`
          : `Could not create an inference session (${failures.join(' | ')})`,
      )
    }

    this.session = session
    this.currentModelName = modelName
    this.currentDevice = device
    this.activeProvider = used
    this.resetIdleTimer()

    return this.session
  }

  touch(): void {
    this.resetIdleTimer()
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    this.idleTimer = setTimeout(() => {
      logger.info('[onnx-session] Idle timeout reached (5 minutes) - disposing ONNX session to free memory')
      this.disposeSession()
    }, this.IDLE_TIMEOUT_MS)
  }

  disposeSession(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.session) {
      try {
        // ort InferenceSession may have release / dispose method or just unreference
        if (typeof (this.session as any).release === 'function') {
          ;(this.session as any).release()
        }
      } catch (err) {
        logger.warn(`[onnx-session] Error releasing session: ${String(err)}`)
      }
      this.session = null
      this.currentModelName = null
      this.currentDevice = null
      this.activeProvider = null
    }
  }
}

export const onnxSessionManager = OnnxSessionManager.getInstance()
