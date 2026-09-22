import { WebCodecsPlayer } from './webcodecs/WebCodecsPlayer'
import { pathToFileUrl } from '../../../lib/file-url'

export interface BakedPair {
  source: VideoFrame
  alpha: VideoFrame
  sourceTime: number
  matteTime: number
}

type PairRequest = { source: VideoFrame; sourceTime: number; matteTime: number; playing: boolean;
  sourcePath: string; generation: number; mapTime?: (time: number) => number; scrubbing: boolean }

/** Owns immutable source/alpha snapshots, never two independently advancing videos. */
export class BakedMattePair {
  private player = new WebCodecsPlayer()
  private sourcePlayer = new WebCodecsPlayer()
  private sourcePath = ''
  private sourceReady = false
  private sourceFallback: HTMLVideoElement | null = null
  private generation = 0
  private ready = false
  private disposed = false
  private busy = false
  private pending: PairRequest | null = null
  private latestTarget: Omit<PairRequest, 'source'> | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private proxyAttemptPath = ''
  private proxies: { source: WebCodecsPlayer; alpha: WebCodecsPlayer } | null = null
  proxyState: 'idle' | 'preparing' | 'ready' | 'unavailable' = 'idle'
  private latestKey = ''
  private pair: BakedPair | null = null
  private captureCanvas: OffscreenCanvas | null = null
  private fallback: HTMLVideoElement | null = null
  private cancelFallback: (() => void) | null = null
  error: string | null = null

  constructor(private path: string, private redraw: () => void) {
    void this.player.load(path).then(async ready => {
      if (this.disposed) return
      if (!ready) await this.loadFallback(path)
      if (this.disposed) return
      this.ready = true
      void this.drain()
      this.redraw()
    }).catch(error => {
      if (!this.disposed) { this.error = String(error); this.redraw() }
    })
  }

  private async prepareProxies(sourcePath: string): Promise<void> {
    if (!window.electronAPI?.matteScrubProxy || this.proxyAttemptPath === sourcePath) return
    this.proxyAttemptPath = sourcePath
    this.proxyState = 'preparing'
    const source = new WebCodecsPlayer(), alpha = new WebCodecsPlayer()
    try {
      const paths = await window.electronAPI.matteScrubProxy({ sourcePath, mattePath: this.path })
      if (this.disposed || this.sourcePath !== sourcePath || !paths.sourcePath || !paths.mattePath) return
      const loaded = await Promise.all([source.load(paths.sourcePath), alpha.load(paths.mattePath)])
      // Reject any transcoder output that dropped/duplicated frames or changed PTS.
      const sameFrames = (original: WebCodecsPlayer, proxy: WebCodecsPlayer) => {
        const a = original.getMetadata()?.samples.map(s => s.pts).sort((x, y) => x - y)
        const b = proxy.getMetadata()?.samples.map(s => s.pts).sort((x, y) => x - y)
        const valid = a && b && a.length === b.length && a.every((pts, i) => Math.abs(pts - b[i]) <= 0.000002)
        if (!valid) console.warn('[BakedMattePair] Proxy PTS rejected', a?.length, b?.length, a?.slice(0, 4), b?.slice(0, 4))
        return valid
      }
      if (!this.disposed && this.sourcePath === sourcePath && loaded.every(Boolean) && sameFrames(this.sourcePlayer, source) && sameFrames(this.player, alpha)) {
        this.proxies?.source.destroy(); this.proxies?.alpha.destroy()
        this.proxies = { source, alpha }
        this.proxyState = 'ready'
        this.redraw()
      }
    } catch { /* Optional acceleration: the full-quality pair remains usable. */ }
    finally {
      if (this.proxies?.source !== source) {
        source.destroy(); alpha.destroy()
        if (!this.disposed && this.sourcePath === sourcePath && this.proxyAttemptPath === sourcePath) this.proxyState = 'unavailable'
      }
    }
  }

  private waitForVideo(video: HTMLVideoElement, event: string, action: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        video.removeEventListener(event, done)
        video.removeEventListener('error', failed)
        this.cancelFallback = null
      }
      const done = () => { cleanup(); resolve() }
      const failed = () => { cleanup(); reject(new Error('Matte video unavailable')) }
      const timeout = setTimeout(failed, 10000)
      this.cancelFallback = failed
      video.addEventListener(event, done)
      video.addEventListener('error', failed)
      action()
    })
  }

  private async loadFallback(path: string): Promise<void> {
    const video = document.createElement('video')
    this.fallback = video
    video.muted = true
    video.preload = 'auto'
    await this.waitForVideo(video, 'loadeddata', () => {
      video.src = pathToFileUrl(path)
      video.load()
    })
  }

  private async seekAlpha(time: number): Promise<VideoFrame | null> {
    const video = this.fallback
    if (!video) return (await this.player.seek(time))?.clone() ?? null
    // Seek inside the selected frame interval. Rounded PTS at the boundary can
    // otherwise make HTMLVideoElement select an adjacent frame (not the decoded RGB).
    const sample = this.player.getSampleForTime(time)
    const target = Math.max(0, Math.min(sample ? sample.pts + sample.duration / 2 : time, video.duration - 0.000001))
    if (Math.abs(video.currentTime - target) > 0.000001) {
      await this.waitForVideo(video, 'seeked', () => { video.currentTime = target })
    }
    if (this.disposed) return null
    const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    return new VideoFrame(canvas, { timestamp: Math.round((sample?.pts ?? time) * 1e6) })
  }

  request(source: VideoFrame | HTMLVideoElement | HTMLImageElement, sourceTime: number, matteTime: number, playing: boolean,
    mapTime?: (time: number) => number, scrubbing = false): BakedPair | null {
    if (this.disposed || this.error) return null
    // currentTime changes before the pixels when seeking. Never capture that pair.
    if (source instanceof HTMLVideoElement && ((!scrubbing && !playing && source.seeking) || source.readyState < 2)) return this.pair
    if (source instanceof HTMLVideoElement && this.sourceReady && this.sourcePath === (source.currentSrc || source.src)) {
      sourceTime = this.sourcePlayer.getSampleForTime(sourceTime)?.pts ?? sourceTime
      matteTime = mapTime?.(sourceTime) ?? matteTime
    }
    const sourcePath = source instanceof HTMLVideoElement ? source.currentSrc || source.src : ''
    const key = `${sourcePath}:${Math.round(sourceTime * 1e6)}:${Math.round(matteTime * 1e6)}:${playing}:${scrubbing}`
    if (key !== this.latestKey) {
      let frame: VideoFrame
      if (source instanceof VideoFrame) {
        frame = source.clone()
      } else if (source instanceof HTMLVideoElement && this.pair) {
        // Placeholder ownership only: drain replaces this with a decoded source or
        // rVFC snapshot. Avoid copying the moving DOM video on every animation tick.
        frame = this.pair.source.clone()
      } else {
        const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
        const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
        if (!width || !height) return this.pair
        if (!this.captureCanvas || this.captureCanvas.width !== width || this.captureCanvas.height !== height) {
          this.captureCanvas = new OffscreenCanvas(width, height)
        }
        this.captureCanvas.getContext('2d')!.drawImage(source, 0, 0, width, height)
        frame = new VideoFrame(this.captureCanvas, { timestamp: Math.round(sourceTime * 1e6) })
      }
      this.latestKey = key
      this.pending?.source.close()
      this.pending = { source: frame, sourceTime, matteTime, playing, mapTime, scrubbing, generation: this.generation,
        sourcePath }
      this.latestTarget = { sourceTime, matteTime, playing, mapTime, scrubbing, generation: this.generation, sourcePath }
      if (this.settleTimer) clearTimeout(this.settleTimer)
      if (scrubbing) this.settleTimer = setTimeout(() => {
        this.settleTimer = null
        if (this.disposed || !this.latestTarget || !this.pair || !this.proxies) return
        this.pending?.source.close()
        this.pending = { ...this.latestTarget, scrubbing: false, source: this.pair.source.clone() }
        void this.drain()
      }, 120)
      void this.drain()
    }
    return this.pair
  }

  getCurrentPair(): BakedPair | null {
    return this.disposed ? null : this.pair
  }

  /** A transport discontinuity invalidates completions even if playback is running. */
  invalidate(): void {
    this.generation++
    this.latestKey = ''
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.latestTarget = null
    this.pending?.source.close()
    this.pending = null
  }

  private async drain(): Promise<void> {
    if (this.busy || !this.ready || this.disposed) return
    this.busy = true
    try {
      while (this.pending && !this.disposed) {
        const request = this.pending
        this.pending = null
        let alpha: VideoFrame | null | undefined
        try {
          if (request.sourcePath) {
            if (this.sourcePath !== request.sourcePath) {
              this.proxies?.source.destroy(); this.proxies?.alpha.destroy()
              this.proxies = null
              this.sourcePath = request.sourcePath
              this.sourceReady = await this.sourcePlayer.load(request.sourcePath)
              if (this.sourceReady && !this.disposed) void this.prepareProxies(request.sourcePath)
              if (!this.sourceReady && !this.disposed) {
                if (this.sourceFallback) {
                  this.sourceFallback.removeAttribute('src')
                  this.sourceFallback.load()
                }
                const video = document.createElement('video')
                video.muted = true
                video.preload = 'auto'
                this.sourceFallback = video
                await this.waitForVideo(video, 'loadeddata', () => {
                  video.src = request.sourcePath
                  video.load()
                })
              }
            }
            if (!this.disposed && this.sourceReady) {
              const sourceSample = this.sourcePlayer.getSampleForTime(request.sourceTime)
              if (!sourceSample) throw new Error('Source frame index unavailable')
              request.matteTime = request.mapTime?.(sourceSample.pts) ?? request.matteTime
              // The source index establishes the PTS before either decoder runs.
              // Decode the two independent streams concurrently, then publish atomically.
              const accelerated = (request.scrubbing || request.playing) && this.proxies
              const [rgbResult, alphaResult] = await Promise.allSettled([
                (accelerated ? accelerated.source : this.sourcePlayer).seek(sourceSample.pts, accelerated && request.playing ? 6 : 0),
                accelerated ? accelerated.alpha.seek(request.matteTime, request.playing ? 6 : 0).then(frame => frame?.clone() ?? null) : this.seekAlpha(request.matteTime),
              ])
              if (alphaResult.status === 'fulfilled') alpha = alphaResult.value
              if (rgbResult.status === 'rejected' || alphaResult.status === 'rejected') {
                throw rgbResult.status === 'rejected' ? rgbResult.reason : (alphaResult as PromiseRejectedResult).reason
              }
              const decoded = rgbResult.value
              if (!decoded) throw new Error('Source frame could not be decoded')
              request.source.close()
              request.source = decoded.clone()
              request.sourceTime = decoded.timestamp / 1e6
              // The target time is a seek request, not proof of the sampled RGB PTS.
              request.matteTime = request.mapTime?.(request.sourceTime) ?? request.matteTime
            } else if (!this.disposed) {
              // Use an owned PAUSED decoder. A playing DOM texture can advance
              // between its rVFC metadata and drawImage, even inside the callback.
              const video = this.sourceFallback!
              const sample = this.sourcePlayer.getSampleForTime(request.sourceTime)
              const target = Math.max(0, Math.min(sample ? sample.pts + sample.duration / 2 : request.sourceTime, video.duration - 0.000001))
              if (Math.abs(video.currentTime - target) > 0.000001) {
                await this.waitForVideo(video, 'seeked', () => { video.currentTime = target })
              }
              if (this.disposed) { request.source.close(); continue }
              const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
              canvas.getContext('2d')!.drawImage(video, 0, 0)
              request.source.close()
              request.sourceTime = sample?.pts ?? request.sourceTime
              request.source = new VideoFrame(canvas, { timestamp: Math.round(request.sourceTime * 1e6) })
              request.matteTime = request.mapTime?.(request.sourceTime) ?? request.matteTime
            }
          }
          if (this.disposed || request.generation !== this.generation) {
            request.source.close()
            alpha?.close()
            continue
          }
          if (alpha === undefined) alpha = await this.seekAlpha(request.matteTime)
        } catch (error) {
          request.source.close()
          alpha?.close()
          if (this.disposed || request.generation !== this.generation) continue
          throw error
        }
        if (this.disposed || request.generation !== this.generation || (!request.playing && !request.scrubbing && this.pending)) {
          request.source.close()
          alpha?.close()
          continue
        }
        if (!alpha || alpha.format === null) {
          request.source.close()
          this.error = 'Matte frame could not be decoded'
          this.redraw()
          break
        }
        const previous = this.pair
        this.pair = { ...request, alpha }
        previous?.source.close()
        previous?.alpha.close()
        this.redraw()
        // Warm a short source-time window while the current pair is already on
        // screen. Do not wait until playback exhausts the lookahead cache.
        if (request.playing && !this.pending && this.proxies && !this.disposed) {
          const sample = this.sourcePlayer.getSampleForTime(request.sourceTime)
          if (sample) {
            const ahead = request.sourceTime + sample.duration * 3
            const matteAhead = request.mapTime?.(ahead) ?? request.matteTime + sample.duration * 3
            await Promise.allSettled([this.proxies.source.seek(ahead, 6), this.proxies.alpha.seek(matteAhead, 6)])
          }
        }
      }
    } catch (error) {
      if (!this.disposed) { this.error = String(error); this.redraw() }
    } finally {
      this.busy = false
    }
  }

  destroy(): void {
    this.disposed = true
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.proxies?.source.destroy()
    this.proxies?.alpha.destroy()
    this.cancelFallback?.()
    if (this.fallback) {
      this.fallback.pause()
      this.fallback.removeAttribute('src')
      this.fallback.load()
      this.fallback = null
    }
    this.pending?.source.close()
    this.pending = null
    this.pair?.source.close()
    this.pair?.alpha.close()
    this.pair = null
    this.player.destroy()
    this.sourcePlayer.destroy()
    if (this.sourceFallback) {
      this.sourceFallback.removeAttribute('src')
      this.sourceFallback.load()
    }
    this.sourceFallback = null
  }
}
