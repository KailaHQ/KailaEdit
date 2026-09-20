import { spawn, spawnSync, ChildProcess, execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import ffmpegStatic from 'ffmpeg-static'
import { logger } from '../logger'
import { quietChildStdio } from '../process/quiet-child-stdio'

let activeExportProcess: ChildProcess | null = null
let cachedFfmpegPath: string | null | undefined

/**
 * Resolve the ffmpeg binary. Prefers the copy bundled by `ffmpeg-static`; in a packaged
 * app that lives under `resources/app.asar.unpacked`, so rewrite the asar path. Falls back
 * to an ffmpeg on PATH so a system install still works if the bundle is missing.
 */
function resolveFfmpegPath(): string | null {
  const bundled = ffmpegStatic as string | null
  if (bundled) {
    const unpacked = bundled.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    if (fs.existsSync(unpacked)) return unpacked
    if (fs.existsSync(bundled)) return bundled
  }

  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    return 'ffmpeg'
  } catch {
    return null
  }
}

export function findFfmpegPath(): string | null {
  if (cachedFfmpegPath === undefined) {
    cachedFfmpegPath = resolveFfmpegPath()
    if (!cachedFfmpegPath) {
      logger.error('[ffmpeg] No ffmpeg binary found (bundled or on PATH)')
    }
  }
  return cachedFfmpegPath
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  return probeAudioStream(ffmpegPath, filePath).hasAudio
}

const SPLIT_NL = /\r?\n/

export interface AudioStreamInfo {
  hasAudio: boolean
  /** Channel count of the first audio stream, or 0 when there is none. */
  channels: number
}

/**
 * Probe a file's first audio stream. The channel count matters because ffmpeg's
 * mono-to-stereo conversion is power-preserving and drops the level by 3 dB;
 * the mixer compensates by copying the channel explicitly instead.
 */
export function probeAudioStream(ffmpegPath: string, filePath: string): AudioStreamInfo {
  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const output = (result.stdout || '') + (result.stderr || '')
    const line = output.split(SPLIT_NL).find(candidate => candidate.includes('Audio:'))
    if (!line) return { hasAudio: false, channels: 0 }

    if (/\bmono\b/.test(line)) return { hasAudio: true, channels: 1 }
    if (/\bstereo\b/.test(line)) return { hasAudio: true, channels: 2 }
    const explicit = /(\d+) channels/.exec(line)
    if (explicit) return { hasAudio: true, channels: Number(explicit[1]) }
    // Layouts like 5.1 or 7.1 — treat as multi-channel; the downmix matrix is
    // the right behaviour there.
    return { hasAudio: true, channels: 2 }
  } catch {
    return { hasAudio: false, channels: 0 }
  }
}


export interface FfmpegProgressInfo {
  frame?: number
  fps?: number
  outTimeUs?: number
  speed?: number
}

export interface FfmpegProcessHandle {
  process: ChildProcess
  promise: Promise<{ success: boolean; error?: string; stderr?: string }>
  kill: () => void
}

/**
 * Spawns ffmpeg with -progress pipe:1 to stream key=value progress to stdout.
 * Returns a handle with the ChildProcess, a promise resolving on completion, and a scoped kill() method.
 */
export function runFfmpegWithProgress(
  ffmpegPath: string,
  args: string[],
  onProgress?: (info: FfmpegProgressInfo) => void,
): FfmpegProcessHandle {
  const progressArgs = ['-progress', 'pipe:1', ...args]
  logger.info(`[ffmpeg] spawn with progress: ${progressArgs.join(' ').slice(0, 400)}`)
  const proc = spawn(ffmpegPath, progressArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
  // `kill()` below can close these pipes under a write or a pending read; without a
  // listener that surfaces as an uncaught exception. See quietChildStdio.
  quietChildStdio(proc, 'ffmpeg')
  let stderrLog = ''
  let killed = false

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    const lines = text.split('\n')
    const progress: FfmpegProgressInfo = {}
    for (const line of lines) {
      const [key, val] = line.trim().split('=')
      if (key === 'frame') progress.frame = Number(val)
      if (key === 'fps') progress.fps = Number(val)
      if (key === 'out_time_us') progress.outTimeUs = Number(val)
      if (key === 'out_time_ms') progress.outTimeUs = Number(val) * 1000
      if (key === 'speed') {
        const speedNum = parseFloat(val?.replace('x', '') || '')
        if (!isNaN(speedNum)) progress.speed = speedNum
      }
    }
    if (onProgress && (progress.outTimeUs !== undefined || progress.fps !== undefined)) {
      onProgress(progress)
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrLog += text
  })

  const promise = new Promise<{ success: boolean; error?: string; stderr?: string }>((resolve) => {
    proc.on('close', (code) => {
      if (killed) {
        resolve({ success: false, error: 'Process cancelled', stderr: stderrLog })
      } else if (code === 0) {
        resolve({ success: true, stderr: stderrLog })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        resolve({
          success: false,
          error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}`,
          stderr: stderrLog,
        })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}`, stderr: stderrLog })
    })
  })

  return {
    process: proc,
    promise,
    kill: () => {
      killed = true
      try {
        proc.kill('SIGTERM')
      } catch {}
    },
  }
}

function runFfmpegSyncOrThrow(ffmpegPath: string, args: string[], timeoutMs = 30000): void {
  logger.info(`[ffmpeg-sync] spawn: ${args.join(' ').slice(0, 400)}`)
  const result = spawnSync(ffmpegPath, args, { timeout: timeoutMs })
  if (result.status === 0) return
  const stderr = (result.stderr?.toString() || '').split('\n').filter(Boolean).slice(-5).join('\n')
  throw new Error(`FFmpeg failed (code ${result.status}): ${stderr.slice(0, 300)}`)
}

export function extractVideoFrameToFile({
  videoPath,
  seekTime,
  width,
  quality,
  outputPath,
  timeoutMs = 10000,
}: {
  videoPath: string
  seekTime: number
  width?: number
  quality?: number
  outputPath?: string
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const resolvedOutputPath = outputPath
    ?? path.join(
      os.tmpdir(),
      `komfy_frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
    )

  const args: string[] = [
    '-ss', String(Math.max(0, seekTime)),
    '-i', videoPath,
    ...(width ? ['-vf', `scale=${width}:-2`] : []),
    '-frames:v', '1',
    ...(quality !== undefined ? ['-q:v', String(quality)] : []),
    '-y',
    resolvedOutputPath,
  ]

  logger.info(`[extract-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)

  if (!fs.existsSync(resolvedOutputPath)) {
    throw new Error('ffmpeg produced no output file')
  }

  return resolvedOutputPath
}

/**
 * The dimensions a player will actually show, read out of `ffmpeg -i` output.
 *
 * A phone films in landscape and tags the file with a display matrix telling
 * the player to turn it: the stream stays 1920x1080 while every player — this
 * app's preview included — draws it 1080x1920. Taking the stream size at face
 * value made a vertical clip set up a landscape project, and left the transform
 * handles boxing a landscape rectangle over a portrait picture.
 *
 * Exported for the tests; `getVideoDimensions` is the real entry point.
 */
export function parseDisplayDimensions(ffmpegOutput: string): { width: number; height: number } | null {
  const lines = ffmpegOutput.split(/\r?\n/)
  const streamIndex = lines.findIndex(line => line.includes('Video:'))
  if (streamIndex < 0) return null

  const match = lines[streamIndex].match(/(\d{2,5})x(\d{2,5})(?:[,\s[]|$)/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  // The rotation belongs to this stream, so stop at the next one. ffmpeg prints
  // it as side data ("displaymatrix: rotation of -90.00 degrees"), and older
  // builds as stream metadata ("rotate: 90") — accept both.
  let rotation = 0
  for (let index = streamIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.includes('Stream #')) break
    const rotated = line.match(/rotation of\s*(-?[\d.]+)\s*degrees/)
      || line.match(/^\s*rotate\s*:\s*(-?[\d.]+)/)
    if (rotated) {
      rotation = Number(rotated[1])
      break
    }
  }

  // A quarter turn either way swaps the axes; half a turn leaves them alone.
  const swapped = Math.abs(Math.round(rotation / 90)) % 2 === 1
  return swapped ? { width: height, height: width } : { width, height }
}

export function getVideoDimensions(videoPath: string): { width: number; height: number } {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', videoPath], {
    encoding: 'utf8',
    timeout: 10000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const dimensions = parseDisplayDimensions(output)

  if (!dimensions) {
    throw new Error(`Could not determine video dimensions for ${videoPath}`)
  }

  return dimensions
}

/**
 * Process termination safety hook.
 * Kept for Electron main process lifecycle cleanup on 'before-quit' in main.ts.
 */
export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info('Stopping active export process...')
    activeExportProcess.kill()
    activeExportProcess = null
  }
}
