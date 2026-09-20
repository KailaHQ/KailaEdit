import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
import { renderQueue, PREVIEW_MAX_SECONDS } from './render-queue'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { removeEntry } from '../storage/remove-entry'
import { safeRename } from '../storage/safe-rename'
import { resolveUserDataDir } from '../../core/src/app-paths'

/** Both spellings of an in-progress file: `<name>.mp4.part` and `<name>.part.mp4`. */
const PART_FILE_RE = /\.part(\.[A-Za-z0-9]+)?$/

/** Written once the directory has been brought up to the current format. */
const CACHE_FORMAT_MARKER = '.cache-format-v4'

/** Written once the pre-sharing stroke bakes have been cleared out. */
const STROKE_SHARING_MARKER = '.stroke-sharing-v1'

/**
 * Bookkeeping files, never cache.
 *
 * These have to be excluded from eviction as well as from clearing. They are the oldest
 * and smallest things in the directory, so LRU eviction would take them first — and
 * losing a marker means its one-time migration runs again on the next start, throwing
 * away the very files it just rebuilt.
 */
const MARKER_FILES = new Set([CACHE_FORMAT_MARKER, STROKE_SHARING_MARKER])

/**
 * How large the render cache may get before least-recently-used files are dropped.
 * Segments and mattes share the directory and both are re-creatable.
 */
const CACHE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024

/** How long one segment render may take before it is considered stuck and cancelled. */
const SEGMENT_RENDER_TIMEOUT_MS = 15 * 60 * 1000

export interface RenderCacheRequestParams {
  hash: string
  startTime: number
  duration: number
  clips: any[]
  transitions?: any[]
  background?: any
  letterbox?: any
  resolution?: '360p' | '480p' | '720p'
  fps?: number
}

export class RenderCacheManager {
  private customDir?: string
  private inFlight = new Map<string, Promise<{ success: boolean; cachePath?: string; error?: string }>>()
  private initialized = false
  /**
   * Segment renders run one at a time.
   *
   * There is no concurrency limit under `startJob` — it spawns ffmpeg the moment it is
   * called — and the caller asks for every segment that is not ready in one pass. A long
   * overlap is several segments now that they are split, so without this a single edit
   * could put three or four full renders on the machine at once, next to whatever matte
   * bake is already running. They are background work for a preview; they can wait.
   */
  private renderChain: Promise<unknown> = Promise.resolve()
  /** Render job id per segment hash, for the renders that are running right now. */
  private activeJobs = new Map<string, string>()

  constructor(customDir?: string) {
    this.customDir = customDir
  }

  getCacheDir(): string {
    if (this.customDir) {
      if (!fs.existsSync(this.customDir)) {
        fs.mkdirSync(this.customDir, { recursive: true })
      }
      return this.customDir
    }

    let baseDir: string
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app } = require('electron')
      if (app && typeof app.getPath === 'function') {
        baseDir = path.join(app.getPath('userData'), 'render-cache')
      } else {
        baseDir = path.join(resolveUserDataDir(), 'render-cache')
      }
    } catch {
      baseDir = path.join(resolveUserDataDir(), 'render-cache')
    }

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }
    return baseDir
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.discardUntrustedCache()
    this.discardOrphanedStrokeBakes()
    this.cleanupInterruptedFiles()
    this.enforceSizeLimit()
  }

  /**
   * Drops stroke bakes made under the old, per-window naming, once.
   *
   * A stroke bake used to be keyed on the exact window of the matte it covered, so the
   * render cache produced one per segment — 72 files and 3.6 GB on one machine, for a
   * project with a single clip. They are keyed on the matte alone now, which means every
   * file written under the old scheme is unreachable: nothing will ever compute its name
   * again. Left alone they would sit there until the size cap evicted them, taking real
   * cache with them on the way out.
   *
   * Segments are deliberately NOT touched. The change is in how a stroke bake is named
   * and reused, not in what it draws, so a segment rendered from an old bake is
   * pixel-identical to one rendered from the new shared bake and stays valid.
   */
  private discardOrphanedStrokeBakes(): void {
    const dir = this.getCacheDir()
    const marker = path.join(dir, STROKE_SHARING_MARKER)
    const strokeDir = path.join(dir, 'stroke')
    try {
      if (fs.existsSync(marker)) return
      if (fs.existsSync(strokeDir)) {
        let dropped = 0
        let freed = 0
        for (const name of fs.readdirSync(strokeDir)) {
          const full = path.join(strokeDir, name)
          try {
            const size = fs.statSync(full).size
            fs.unlinkSync(full)
            dropped++
            freed += size
          } catch {}
        }
        if (dropped > 0) {
          logger.info(
            `[render-cache] dropped ${dropped} stroke bake(s), ${(freed / 1e9).toFixed(2)} GB, ` +
              'left unreachable by per-clip stroke sharing',
          )
        }
      }
      fs.writeFileSync(marker, new Date().toISOString(), 'utf-8')
    } catch (err) {
      logger.warn(`[render-cache] could not clear the old stroke bakes: ${String(err)}`)
    }
  }

  /**
   * Drops everything this version of the cache cannot vouch for, once.
   *
   * Two things on disk predate this format. Mattes named `matte_<hash>.mp4` carry no
   * source range, so nothing can look them up any more. Segments are worse: until the
   * `.part` extension was fixed, no segment render could write its output at all, so any
   * `segment_*.mp4` sitting here arrived by some earlier route and there is no way to
   * tell what timeline it was rendered from. One project had three of them, under three
   * different hashes, that were byte-for-byte identical — which cannot be right for three
   * different stretches of a timeline, and which the preview would have played back as if
   * it were the picture.
   *
   * The marker file keeps this to one pass; everything dropped here is re-creatable.
   */
  private discardUntrustedCache(): void {
    const dir = this.getCacheDir()
    const marker = path.join(dir, CACHE_FORMAT_MARKER)
    try {
      if (fs.existsSync(marker)) return

      let dropped = 0
      for (const name of fs.readdirSync(dir)) {
        // v4 drops every matte again: everything baked before this was encoded lossless,
        // which put it in a H.264 profile the preview's <video> element cannot decode.
        // (v3 dropped them because a rotated source had been baked squashed.)
        const isMatte = name.startsWith('matte_') || name.startsWith('custom_matte_')
        if (!isMatte && !name.startsWith('segment_')) continue
        try {
          fs.unlinkSync(path.join(dir, name))
          dropped++
        } catch {}
      }

      fs.writeFileSync(marker, new Date().toISOString(), 'utf-8')
      if (dropped > 0) {
        logger.info(`[render-cache] dropped ${dropped} file(s) from an older cache format`)
      }
    } catch (err) {
      logger.warn(`[render-cache] could not migrate the cache directory: ${String(err)}`)
    }
  }

  /**
   * Keeps the cache under `CACHE_SIZE_LIMIT_BYTES`, dropping least-recently-used files.
   *
   * Nothing evicted anything before this: the directory only ever grew, and cleared by
   * hand from Settings. One small project had reached 1.6 GB, most of it mattes for trims
   * that no longer existed.
   *
   * Eviction is by mtime, and every cache hit touches the file it served, so whatever the
   * open project is actually using stays newest and is evicted last. A matte that does go
   * is re-baked on the next export; the preview falls back to un-matted until then.
   */
  enforceSizeLimit(maxBytes: number = CACHE_SIZE_LIMIT_BYTES): number {
    const dir = this.getCacheDir()
    let freed = 0
    try {
      if (!fs.existsSync(dir)) return 0
      const entries: Array<{ path: string; size: number; mtime: number }> = []
      let total = 0
      for (const name of fs.readdirSync(dir)) {
        if (PART_FILE_RE.test(name) || MARKER_FILES.has(name)) continue
        const full = path.join(dir, name)
        try {
          const stat = fs.statSync(full)
          if (!stat.isFile()) continue
          entries.push({ path: full, size: stat.size, mtime: stat.mtimeMs })
          total += stat.size
        } catch {}
      }

      if (total <= maxBytes) return 0

      entries.sort((a, b) => a.mtime - b.mtime)
      for (const entry of entries) {
        if (total <= maxBytes) break
        try {
          fs.unlinkSync(entry.path)
          total -= entry.size
          freed += entry.size
        } catch {}
      }

      if (freed > 0) {
        logger.info(`[render-cache] evicted ${(freed / 1e6).toFixed(0)} MB to stay under ${(maxBytes / 1e9).toFixed(1)} GB`)
      }
    } catch (err) {
      logger.error(`[render-cache] error enforcing size limit: ${String(err)}`)
    }
    return freed
  }

  /** Marks a cache file as just-used, so size eviction drops it last. */
  touch(filePath: string): void {
    try {
      const now = new Date()
      fs.utimesSync(filePath, now, now)
    } catch {}
  }

  cleanupInterruptedFiles(): void {
    const dir = this.getCacheDir()
    try {
      if (!fs.existsSync(dir)) return
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        // Segment parts are named `<name>.mp4.part`, but a matte's is `<name>.part.mp4`
        // (matte-service) and a custom matte's likewise — so matching only `.part` left
        // every interrupted bake on disk for good. There were two, 55 MB, from bakes that
        // had been cancelled weeks earlier.
        if (PART_FILE_RE.test(file)) {
          try {
            fs.unlinkSync(fullPath)
            logger.info(`[render-cache] cleaned up incomplete file: ${file}`)
          } catch (err) {
            logger.warn(`[render-cache] failed to remove partial file ${file}: ${String(err)}`)
          }
        } else if (file.endsWith('.mp4')) {
          try {
            const stat = fs.statSync(fullPath)
            if (stat.size === 0) {
              fs.unlinkSync(fullPath)
              logger.info(`[render-cache] cleaned up 0-byte file: ${file}`)
            }
          } catch {}
        }
      }
    } catch (err) {
      logger.error(`[render-cache] error scanning cache dir for cleanup: ${String(err)}`)
    }
  }

  getSegmentPath(hash: string): string {
    return path.join(this.getCacheDir(), `segment_${hash}.mp4`)
  }

  getPartPath(hash: string): string {
    // `.part.mp4`, NOT `.mp4.part`.
    //
    // This path is handed straight to ffmpeg as the output file, and ffmpeg picks its
    // muxer from the extension: `.part` is not a container, so it refused the file with
    // "Error opening output file" before writing a byte. Every segment render died there,
    // silently, so the cache never filled and the same segment was rendered again on the
    // next edit — one hash was re-rendered five times in a six-minute session, burning
    // CPU next to whatever matte bake was running.
    return path.join(this.getCacheDir(), `segment_${hash}.part.mp4`)
  }

  hasCache(hash: string): boolean {
    this.init()
    const p = this.getSegmentPath(hash)
    if (!fs.existsSync(p)) return false
    try {
      return fs.statSync(p).size > 0
    } catch {
      return false
    }
  }

  getCachePath(hash: string): string | null {
    if (this.hasCache(hash)) {
      const p = this.getSegmentPath(hash)
      this.touch(p)
      return p
    }
    return null
  }

  /**
   * Stops renders for segments nobody is asking for any more.
   *
   * The caller re-checks the whole set of hashes every time the timeline changes, so a
   * hash that has dropped out of that set belongs to a segment that no longer exists —
   * its clips have moved, been trimmed or been restyled. Letting that render run to
   * completion costs the main process tens of seconds of work for a file that will never
   * be used, and the user feels every second of it as lag.
   */
  cancelSupersededSegments(wantedHashes: string[]): void {
    if (this.activeJobs.size === 0) return
    const wanted = new Set(wantedHashes)
    for (const [hash, jobId] of this.activeJobs) {
      if (wanted.has(hash)) continue
      logger.info(`[render-cache] segment ${hash} is no longer on the timeline, cancelling its render`)
      renderQueue.cancelJob(jobId)
      this.activeJobs.delete(hash)
      try {
        const partPath = this.getPartPath(hash)
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {}
    }
  }

  checkHashes(hashes: string[]): Record<string, { ready: boolean; path?: string }> {
    this.init()
    this.cancelSupersededSegments(hashes)
    const result: Record<string, { ready: boolean; path?: string }> = {}
    for (const h of hashes) {
      const cached = this.getCachePath(h)
      if (cached) {
        result[h] = { ready: true, path: cached }
      } else {
        result[h] = { ready: false }
      }
    }
    return result
  }

  renderSegment(params: RenderCacheRequestParams): Promise<{ success: boolean; cachePath?: string; error?: string }> {
    this.init()
    const { hash, startTime, duration, clips, transitions, background, letterbox, resolution, fps } = params

    // A segment longer than one preview render can produce would come back truncated and
    // then be published as ready for its whole span. findComplexSegments splits segments
    // so this cannot happen; refusing here keeps any future caller honest too.
    if (duration > PREVIEW_MAX_SECONDS) {
      const err = `Segment of ${duration.toFixed(2)}s exceeds the ${PREVIEW_MAX_SECONDS}s render-cache limit`
      logger.warn(`[render-cache] ${err}`)
      emitToRenderer('render-cache:status', { hash, ready: false, error: err })
      return Promise.resolve({ success: false, error: err })
    }

    // If cache already exists, return immediately
    const existing = this.getCachePath(hash)
    if (existing) {
      return Promise.resolve({ success: true, cachePath: existing })
    }

    // If already in flight, reuse existing promise
    const inFlightPromise = this.inFlight.get(hash)
    if (inFlightPromise) {
      return inFlightPromise
    }

    const partPath = this.getPartPath(hash)
    const finalPath = this.getSegmentPath(hash)

    // Remove any stale .part file before starting
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
    } catch {}

    const runRender = async () => {
      try {
        const previewJob = renderQueue.startPreviewJob({
          clips,
          startTime,
          duration,
          resolution: resolution || '480p',
          outputPath: partPath,
          fps: fps || 30,
          background,
          letterbox,
          transitions,
        })

        if (!previewJob.success) {
          const err = previewJob.error || 'Failed to start segment preview render'
          emitToRenderer('render-cache:status', { hash, ready: false, error: err })
          return { success: false, error: err }
        }

        this.activeJobs.set(hash, previewJob.jobId)

        // Long enough for the preparation a segment can legitimately need.
        //
        // The default is a minute, and Step 0 alone — baking a matte, then drawing a
        // stroke over it at ~80 ms a frame — routinely runs longer than that on a
        // full-length clip. The wait timed out, the part file was deleted, and the very
        // next edit started the identical render again: a treadmill that burned a core
        // continuously and never cached a single segment. A segment that really is stuck
        // is now cancelled rather than left running unseen.
        let finished
        try {
          finished = await renderQueue.waitForJob(previewJob.jobId, SEGMENT_RENDER_TIMEOUT_MS)
        } catch (waitErr) {
          renderQueue.cancelJob(previewJob.jobId)
          throw waitErr
        }
        if (finished.status === 'completed' && fs.existsSync(partPath)) {
          try {
            await safeRename(partPath, finalPath)
          } catch (err: any) {
            logger.error(`[render-cache] Failed to rename ${partPath} to ${finalPath}: ${err}`)
            return { success: false, error: err.message }
          }

          logger.info(`[render-cache] Segment cached successfully: ${finalPath}`)
          this.enforceSizeLimit()
          emitToRenderer('render-cache:status', { hash, ready: true, cachePath: finalPath })
          return { success: true, cachePath: finalPath }
        } else {
          try {
            if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
          } catch {}

          const err = finished.error || 'Render job failed'
          logger.warn(`[render-cache] Segment ${hash} did not produce a file: ${err}`)
          emitToRenderer('render-cache:status', { hash, ready: false, error: err })
          return { success: false, error: err }
        }
      } catch (err: any) {
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
        } catch {}

        const errMsg = String(err?.message || err)
        logger.warn(`[render-cache] Segment ${hash} failed: ${errMsg}`)
        emitToRenderer('render-cache:status', { hash, ready: false, error: errMsg })
        return { success: false, error: errMsg }
      } finally {
        this.inFlight.delete(hash)
        this.activeJobs.delete(hash)
      }
    }

    // Queue behind whatever is already rendering, but hand the caller a promise for its
    // own result, not for the queue.
    const promise = this.renderChain.then(runRender, runRender)
    this.renderChain = promise.catch(() => undefined)

    this.inFlight.set(hash, promise)
    return promise
  }

  clearCache(): number {
    const dir = this.getCacheDir()
    let freedBytes = 0

    if (fs.existsSync(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          // The format marker is bookkeeping, not cache. Clearing it would put the
          // directory back to "never migrated" and run the one-time purge again.
          if (MARKER_FILES.has(entry.name)) continue
          const fullPath = path.join(dir, entry.name)
          try {
            if (entry.isFile()) {
              freedBytes += fs.statSync(fullPath).size
              fs.unlinkSync(fullPath)
            } else if (entry.isDirectory()) {
              removeEntry(fullPath)
            }
          } catch {}
        }
      } catch (err) {
        logger.error(`[render-cache] error clearing render cache: ${String(err)}`)
      }
    }

    this.inFlight.clear()
    return freedBytes
  }
}

export const renderCacheManager = new RenderCacheManager()
