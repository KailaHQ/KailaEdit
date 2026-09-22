import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { renderCacheManager } from '../export/render-cache-manager'
import { scrubProxyArgs } from '../../core/src/scrub-proxy'

const pending = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

/** Lossy spatial preview only: keep every timestamp/frame, all-intra for random access.
 * Callers validate allowed roots before entering this service. */
export async function ensureScrubProxy(input: string, cacheDir = renderCacheManager.getCacheDir()): Promise<string> {
  const stat = await fs.promises.stat(input)
  const key = createHash('sha256').update(JSON.stringify(['scrub-v2', path.resolve(input), stat.size, stat.mtimeMs])).digest('hex').slice(0, 24)
  const output = path.join(cacheDir, `scrub_${key}.mp4`)
  if (fs.existsSync(output) && fs.statSync(output).size > 0) return output
  const running = pending.get(key)
  if (running) return running
  const run = async () => {
    const ffmpeg = findFfmpegPath()
    if (!ffmpeg) throw new Error('FFmpeg unavailable')
    await fs.promises.mkdir(cacheDir, { recursive: true })
    const part = output.replace(/\.mp4$/, '.part.mp4')
    try {
      await new Promise<void>((resolve, reject) => {
        const process = spawn(ffmpeg, scrubProxyArgs(input, part), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
        let error = ''
        process.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-4000) })
        const timer = setTimeout(() => { process.kill(); reject(new Error('Scrub proxy timed out')) }, 180000)
        process.once('error', err => { clearTimeout(timer); reject(err) })
        process.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(error || 'Scrub proxy failed')) })
      })
      await fs.promises.rename(part, output)
      return output
    } finally {
      await fs.promises.rm(part, { force: true }).catch(() => {})
    }
  }
  const task = queue.then(run, run)
  pending.set(key, task)
  queue = task.catch(() => {})
  try { return await task } finally { pending.delete(key) }
}
