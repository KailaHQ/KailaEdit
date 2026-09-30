import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Resvg } from '@resvg/resvg-js'
import { findFfmpegPath, probeAudioStream } from './export/ffmpeg-utils'
import { extractAudioPeaks } from './export/audio-peaks'
import { logger } from './logger'

export interface FilmstripOptions {
  startTime?: number // seconds, default 0
  endTime?: number // seconds, default duration
  columns?: number // default 12
  maxWidth?: number // default 1600
  outputPath?: string // destination png path
  mediaPath?: string // file to analyze directly
  clipName?: string // optional label for the clip
  timeline?: {
    tracks: Array<{
      id: string
      name: string
      type: 'video' | 'audio'
      clips: Array<{
        id: string
        name?: string
        mediaPath?: string
        timelineStart: number
        timelineEnd: number
        sourceStart?: number
        speed?: number
      }>
    }>
  }
}

export interface FilmstripResult {
  outputPath: string
  columns: number
  startTime: number
  endTime: number
  duration: number
  width: number
  height: number
  fileSizeBytes: number
}

function probeDuration(ffmpegPath: string, mediaPath: string): number {
  try {
    const res = spawnSync(ffmpegPath, ['-i', mediaPath], { encoding: 'utf8' })
    const output = (res.stdout || '') + (res.stderr || '')
    const match = output.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
    if (match) {
      return parseFloat(match[1]) * 3600 + parseFloat(match[2]) * 60 + parseFloat(match[3])
    }
  } catch (err) {
    logger.warn(`[filmstrip] Failed to probe duration for ${mediaPath}: ${err}`)
  }
  return 0
}

function extractFrameBase64Async(ffmpegPath: string, mediaPath: string, seekSec: number, width: number): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const proc = spawn(ffmpegPath, [
        '-ss', String(Math.max(0, seekSec)),
        '-i', mediaPath,
        '-frames:v', '1',
        '-vf', `scale=${width}:-2`,
        '-q:v', '3',
        '-f', 'image2',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] })

      const chunks: Buffer[] = []
      proc.stdout.on('data', chunk => chunks.push(chunk))
      proc.on('close', code => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks).toString('base64'))
        } else {
          resolve(null)
        }
      })
      proc.on('error', err => {
        logger.warn(`[filmstrip] Failed to extract frame at ${seekSec}s from ${mediaPath}: ${err}`)
        resolve(null)
      })
    } catch (err) {
      logger.warn(`[filmstrip] Failed to spawn ffmpeg for frame at ${seekSec}s: ${err}`)
      resolve(null)
    }
  })
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const mStr = String(m).padStart(2, '0')
  const sStr = s.toFixed(1).padStart(4, '0')
  return `${mStr}:${sStr}`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generate a composite filmstrip PNG image showing:
 * - A strip of extracted video frames
 * - An audio waveform underneath
 * - Readable time labels and clip names
 *
 * Automatically clamps out-of-bound start/end times.
 */
export async function observeFilmstrip(options: FilmstripOptions): Promise<FilmstripResult> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found')
  }

  const columns = Math.max(1, options.columns ?? 12)
  const maxWidth = Math.min(1600, Math.max(320, options.maxWidth ?? 1600))

  let mediaPath = options.mediaPath
  let clipName = options.clipName
  let totalDuration = 0

  // Resolve duration and media from either direct mediaPath or timeline state
  if (options.timeline) {
    for (const track of options.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.timelineEnd > totalDuration) {
          totalDuration = clip.timelineEnd
        }
        if (!mediaPath && clip.mediaPath) {
          mediaPath = clip.mediaPath
          clipName = clip.name || path.basename(clip.mediaPath)
        }
      }
    }
  }

  if (mediaPath) {
    const fileDuration = probeDuration(ffmpegPath, mediaPath)
    if (totalDuration === 0) {
      totalDuration = fileDuration
    }
    if (!clipName) {
      clipName = path.basename(mediaPath)
    }
  }

  if (totalDuration <= 0) {
    totalDuration = 10.0 // Default fallback duration
  }

  // Clamping requirement: "Time range exceeding timeline is clamped without error"
  let startTime = options.startTime ?? 0
  let endTime = options.endTime ?? totalDuration

  startTime = Math.max(0, Math.min(startTime, totalDuration))
  endTime = Math.max(0, Math.min(endTime, totalDuration))

  if (startTime >= endTime) {
    if (totalDuration > 0) {
      startTime = Math.max(0, totalDuration - 1)
      endTime = totalDuration
    } else {
      startTime = 0
      endTime = 1
    }
  }

  const durationRange = endTime - startTime
  const colWidth = Math.floor(maxWidth / columns)
  const totalWidth = colWidth * columns
  const frameWidth = Math.max(32, colWidth - 4)
  const frameHeight = Math.round(frameWidth * 9 / 16)

  const headerHeight = 28
  const waveformHeight = 44
  const footerHeight = 22
  const totalHeight = headerHeight + frameHeight + waveformHeight + footerHeight

  // Extract audio peaks in background if media exists
  let audioPeaks: number[] = []
  const peaksPromise = (async () => {
    if (mediaPath && fs.existsSync(mediaPath)) {
      const hasAudio = probeAudioStream(ffmpegPath, mediaPath).hasAudio
      if (hasAudio) {
        try {
          const fullPeaks = await extractAudioPeaks(mediaPath, 600)
          if (fullPeaks.length > 0) {
            const startIndex = Math.floor((startTime / totalDuration) * fullPeaks.length)
            const endIndex = Math.min(fullPeaks.length, Math.ceil((endTime / totalDuration) * fullPeaks.length))
            return fullPeaks.slice(startIndex, Math.max(startIndex + 1, endIndex))
          }
        } catch (err) {
          logger.warn(`[filmstrip] Failed to extract audio peaks: ${err}`)
        }
      }
    }
    return []
  })()

  // Calculate timestamps for all columns
  const timestamps = Array.from({ length: columns }, (_, i) => {
    return columns === 1
      ? startTime + durationRange / 2
      : startTime + (i / (columns - 1)) * durationRange
  })

  // Concurrently extract frames in parallel
  const framePromises = timestamps.map(t => {
    if (mediaPath && fs.existsSync(mediaPath)) {
      return extractFrameBase64Async(ffmpegPath, mediaPath, t, frameWidth)
    }
    return Promise.resolve(null)
  })

  const [frames, extractedPeaks] = await Promise.all([
    Promise.all(framePromises),
    peaksPromise,
  ])
  audioPeaks = extractedPeaks

  // Build SVG elements
  const svgElements: string[] = []

  // Background
  svgElements.push(`<rect width="${totalWidth}" height="${totalHeight}" fill="#111827"/>`)

  // Global header: title and time range
  const rangeLabel = `${formatTimestamp(startTime)} - ${formatTimestamp(endTime)} (${durationRange.toFixed(1)}s)`
  svgElements.push(`
    <text x="12" y="19" fill="#f3f4f6" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600">
      ${escapeXml(clipName || 'Timeline Filmstrip')}
    </text>
    <text x="${totalWidth - 12}" y="19" fill="#9ca3af" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="11">
      ${escapeXml(rangeLabel)}
    </text>
    <line x1="0" y1="${headerHeight - 2}" x2="${totalWidth}" y2="${headerHeight - 2}" stroke="#374151" stroke-width="1"/>
  `)

  // Columns: frame + waveform slice + time label
  const barsPerColumn = 8
  const totalWaveformBars = columns * barsPerColumn

  for (let i = 0; i < columns; i++) {
    const colX = i * colWidth
    const frameX = colX + 2
    const frameY = headerHeight + 2
    const t = timestamps[i]

    // Frame column separator
    if (i > 0) {
      svgElements.push(`<line x1="${colX}" y1="${headerHeight}" x2="${colX}" y2="${totalHeight}" stroke="#1f2937" stroke-width="1"/>`)
    }

    const frameBase64 = frames[i]
    if (frameBase64) {
      svgElements.push(`
        <image href="data:image/jpeg;base64,${frameBase64}" x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" preserveAspectRatio="xMidYMid slice"/>
      `)
    } else {
      svgElements.push(`
        <rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" fill="#1f2937" rx="2"/>
        <text x="${frameX + frameWidth / 2}" y="${frameY + frameHeight / 2 + 4}" fill="#6b7280" font-family="system-ui, sans-serif" font-size="10" text-anchor="middle">
          No Frame
        </text>
      `)
    }

    // Frame border
    svgElements.push(`
      <rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" fill="none" stroke="#374151" stroke-width="1" rx="2"/>
    `)

    // Waveform bars for this column
    const waveformY = headerHeight + frameHeight + 4
    const waveCenterY = waveformY + (waveformHeight - 8) / 2

    for (let b = 0; b < barsPerColumn; b++) {
      const globalBarIdx = i * barsPerColumn + b
      const peakIdx = audioPeaks.length > 0
        ? Math.floor((globalBarIdx / totalWaveformBars) * audioPeaks.length)
        : -1
      const magnitude = peakIdx >= 0 && peakIdx < audioPeaks.length ? audioPeaks[peakIdx] : 0.05
      const barHeight = Math.max(2, Math.min(waveformHeight - 12, Math.round(magnitude * (waveformHeight - 12))))
      const barX = colX + 4 + b * ((colWidth - 8) / barsPerColumn)
      const barWidth = Math.max(1, (colWidth - 8) / barsPerColumn - 1)

      svgElements.push(`
        <rect x="${barX.toFixed(1)}" y="${(waveCenterY - barHeight / 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight}" fill="#38bdf8" rx="1"/>
      `)
    }

    // Time label at bottom
    const timeY = totalHeight - 7
    svgElements.push(`
      <text x="${colX + colWidth / 2}" y="${timeY}" fill="#e5e7eb" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="500" text-anchor="middle">
        ${formatTimestamp(t)}
      </text>
    `)
  }

  const svg = `
<svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
  ${svgElements.join('\n')}
</svg>
  `.trim()

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: totalWidth },
  })
  const pngData = resvg.render()
  const pngBuffer = pngData.asPng()

  const outputPath = options.outputPath || path.join(
    os.tmpdir(),
    `komfy_filmstrip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`,
  )

  fs.writeFileSync(outputPath, pngBuffer)
  const stat = fs.statSync(outputPath)

  return {
    outputPath,
    columns,
    startTime,
    endTime,
    duration: durationRange,
    width: totalWidth,
    height: totalHeight,
    fileSizeBytes: stat.size,
  }
}
