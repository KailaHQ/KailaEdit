import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { findFfmpegPath, probeAudioStream } from './export/ffmpeg-utils'
import { logger } from './logger'
export { observeFilmstrip, type FilmstripOptions, type FilmstripResult } from './observe-filmstrip'

export interface SilenceOptions {
  noiseDb?: number // default -30
  minDurationSec?: number // default 2
  startTime?: number
  duration?: number
}

export interface SilenceInterval {
  start: number
  end: number
  duration: number
}

export interface SceneOptions {
  threshold?: number // default 0.3
}

export interface SceneCut {
  timestamp: number
  score?: number
}

export interface LoudnessResult {
  integratedLufs: number
  truePeakDb: number
  lra: number
  thresholdLufs?: number
}

interface CacheEntry<T> {
  mtimeMs: number
  value: T
}

const silenceCache = new Map<string, CacheEntry<SilenceInterval[]>>()
const sceneCache = new Map<string, CacheEntry<SceneCut[]>>()
const loudnessCache = new Map<string, CacheEntry<LoudnessResult | null>>()

export const _analyzerStats = {
  spawnCount: 0,
}

/** Clear all analyzer caches and reset stats (useful for testing) */
export function clearMediaAnalyzerCache(): void {
  silenceCache.clear()
  sceneCache.clear()
  loudnessCache.clear()
  _analyzerStats.spawnCount = 0
}

function runFfmpegCommand(ffmpegPath: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    _analyzerStats.spawnCount++
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', err => {
      reject(err)
    })

    proc.on('close', code => {
      resolve({ stdout, stderr, code })
    })
  })
}

/**
 * Detect silence intervals in a media file.
 * Returns empty array if file has no audio stream or no silence matches.
 */
export async function observeSilence(
  filePath: string,
  options?: SilenceOptions,
): Promise<SilenceInterval[]> {
  const noiseDb = options?.noiseDb ?? -30
  const minDurationSec = options?.minDurationSec ?? 2

  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Media file not found: ${resolved}`)
  }

  const stat = fs.statSync(resolved)
  const startTime = options?.startTime ?? 0
  const duration = options?.duration ?? 0
  const cacheKey = `${resolved}::${noiseDb}::${minDurationSec}::${startTime}::${duration}`
  const cached = silenceCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value
  }

  const ffmpeg = findFfmpegPath()
  if (!ffmpeg) {
    throw new Error('ffmpeg binary not found')
  }

  const audioInfo = await probeAudioStream(ffmpeg, resolved)
  if (!audioInfo.hasAudio) {
    silenceCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: [] })
    return []
  }

  const args = [
    '-nostats',
    ...(options?.startTime !== undefined ? ['-ss', String(options.startTime)] : []),
    '-i',
    resolved,
    ...(options?.duration !== undefined ? ['-t', String(options.duration)] : []),
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    '-f',
    'null',
    '-',
  ]

  const { stderr } = await runFfmpegCommand(ffmpeg, args)

  const intervals: SilenceInterval[] = []
  let currentStart: number | null = null
  const offset = options?.startTime ?? 0

  const lines = stderr.split(/\r?\n/)
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/)
    if (startMatch) {
      currentStart = parseFloat(startMatch[1])
      continue
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/)
    if (endMatch) {
      const parsedEnd = parseFloat(endMatch[1])
      const durationSec = parseFloat(endMatch[2])
      const parsedStart = currentStart !== null ? currentStart : Math.max(0, parsedEnd - durationSec)
      intervals.push({
        start: parsedStart + offset,
        end: parsedEnd + offset,
        duration: durationSec,
      })
      currentStart = null
    }
  }

  silenceCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: intervals })
  return intervals
}

/**
 * Detect scene changes/cuts in a video file.
 * Returns cut timestamps and optional scene change scores.
 */
export async function observeScenes(
  filePath: string,
  options?: SceneOptions,
): Promise<SceneCut[]> {
  const threshold = options?.threshold ?? 0.3

  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Media file not found: ${resolved}`)
  }

  const stat = fs.statSync(resolved)
  const cacheKey = `${resolved}::${threshold}`
  const cached = sceneCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value
  }

  const ffmpeg = findFfmpegPath()
  if (!ffmpeg) {
    throw new Error('ffmpeg binary not found')
  }

  const args = [
    '-nostats',
    '-i',
    resolved,
    '-filter:v',
    `select=gt(scene\\,${threshold}),metadata=print:key=lavfi.scene_score`,
    '-f',
    'null',
    '-',
  ]

  const { stderr } = await runFfmpegCommand(ffmpeg, args)

  const cuts: SceneCut[] = []
  const lines = stderr.split(/\r?\n/)
  let lastPtsTime: number | null = null

  for (const line of lines) {
    const ptsMatch = line.match(/pts_time:\s*([0-9.]+)/)
    if (ptsMatch) {
      lastPtsTime = parseFloat(ptsMatch[1])
    }

    const scoreMatch = line.match(/lavfi\.scene_score=\s*([0-9.]+)/)
    if (scoreMatch) {
      const score = parseFloat(scoreMatch[1])
      if (lastPtsTime !== null) {
        cuts.push({ timestamp: lastPtsTime, score })
        lastPtsTime = null
      }
    }
  }

  // If there are pts_time matches without score lines
  if (lastPtsTime !== null && !cuts.some(c => c.timestamp === lastPtsTime)) {
    cuts.push({ timestamp: lastPtsTime })
  }

  sceneCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: cuts })
  return cuts
}

function parseLoudnessNumber(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '-inf') return Number.NEGATIVE_INFINITY
  if (trimmed === 'inf' || trimmed === '+inf') return Number.POSITIVE_INFINITY
  const val = parseFloat(trimmed)
  return isNaN(val) ? 0 : val
}

export interface LoudnessOptions {
  startTime?: number
  duration?: number
}

/**
 * Measure integrated loudness, True Peak, and Loudness Range (LRA) according to EBU R128.
 * Returns null if file has no audio stream.
 */
export async function observeLoudness(
  filePath: string,
  options?: LoudnessOptions,
): Promise<LoudnessResult | null> {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Media file not found: ${resolved}`)
  }

  const stat = fs.statSync(resolved)
  const cacheKey = `${resolved}::${options?.startTime ?? 0}::${options?.duration ?? 0}`
  const cached = loudnessCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value
  }

  const ffmpeg = findFfmpegPath()
  if (!ffmpeg) {
    throw new Error('ffmpeg binary not found')
  }

  const audioInfo = await probeAudioStream(ffmpeg, resolved)
  if (!audioInfo.hasAudio) {
    loudnessCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: null })
    return null
  }

  const args = [
    '-nostats',
    ...(options?.startTime !== undefined ? ['-ss', String(options.startTime)] : []),
    '-i',
    resolved,
    ...(options?.duration !== undefined ? ['-t', String(options.duration)] : []),
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]

  const { stderr } = await runFfmpegCommand(ffmpeg, args)

  let integratedLufs: number | null = null
  let truePeakDb: number | null = null
  let lra: number | null = null
  let thresholdLufs: number | undefined

  const summaryIndex = stderr.lastIndexOf('Summary:')
  const summaryPart = summaryIndex !== -1 ? stderr.slice(summaryIndex) : stderr

  const iMatch = summaryPart.match(/I:\s*(-?inf|-?[0-9.]+)\s*LUFS/)
  if (iMatch) integratedLufs = parseLoudnessNumber(iMatch[1])

  const threshMatch = summaryPart.match(/Threshold:\s*(-?inf|-?[0-9.]+)\s*LUFS/)
  if (threshMatch) thresholdLufs = parseLoudnessNumber(threshMatch[1])

  const lraMatch = summaryPart.match(/LRA:\s*(-?inf|-?[0-9.]+)\s*LU/)
  if (lraMatch) lra = parseLoudnessNumber(lraMatch[1])

  const peakMatch = summaryPart.match(/Peak:\s*(-?inf|-?[0-9.]+)\s*dBFS/)
  if (peakMatch) truePeakDb = parseLoudnessNumber(peakMatch[1])

  if (integratedLufs === null) {
    logger.warn(`[media-analyzer] Could not parse integrated loudness from ebur128 output: ${resolved}`)
    return null
  }

  const result: LoudnessResult = {
    integratedLufs,
    truePeakDb: truePeakDb ?? -Infinity,
    lra: lra ?? 0,
    thresholdLufs,
  }

  loudnessCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value: result })
  return result
}
