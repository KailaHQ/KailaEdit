import { spawn } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'

export interface VideoProbeInfo {
  width: number
  height: number
  fps: number
  duration: number
  rotation: number
}

/**
 * Parses stderr output from `ffmpeg -i <file>` to extract video stream dimensions,
 * frame rate, duration, and rotation.
 *
 * Width and height are automatically swapped if rotation is 90 or 270 degrees.
 * Stream-level rotation metadata/side-data is strictly parsed within the selected video stream
 * so multiple streams cannot bleed rotation into each other.
 */
export function parseFfmpegProbeOutput(stderr: string): VideoProbeInfo {
  let width = 1920
  let height = 1080
  let fps = 30
  let duration = 0
  let rotation = 0

  // 1. Container-level duration
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (durMatch) {
    const hours = parseInt(durMatch[1], 10)
    const mins = parseInt(durMatch[2], 10)
    const secs = parseFloat(durMatch[3])
    duration = hours * 3600 + mins * 60 + secs
  }

  // 2. Identify individual streams by 'Stream #X:Y' boundaries
  const streamHeaderRegex = /Stream #\d+:\d+/g
  const streamIndices: number[] = []
  let headerMatch: RegExpExecArray | null
  while ((headerMatch = streamHeaderRegex.exec(stderr)) !== null) {
    streamIndices.push(headerMatch.index)
  }

  let selectedStreamSection = ''
  for (let i = 0; i < streamIndices.length; i++) {
    const start = streamIndices[i]
    const end = streamIndices[i + 1] ?? stderr.length
    const section = stderr.slice(start, end)

    if (/Stream #\d+:\d+.*Video:/i.test(section)) {
      // If multiple video streams exist, skip attached cover images if a real video stream follows
      if (/\(attached pic\)/i.test(section)) {
        const hasOtherVideo = streamIndices.slice(i + 1).some((idx, idxOffset) => {
          const nextStart = idx
          const nextEnd = streamIndices[i + 1 + idxOffset + 1] ?? stderr.length
          return /Stream #\d+:\d+.*Video:/i.test(stderr.slice(nextStart, nextEnd))
        })
        if (hasOtherVideo) continue
      }
      selectedStreamSection = section
      break
    }
  }

  // Fallback: look at stderr directly if no delimited stream block was found
  if (!selectedStreamSection) {
    selectedStreamSection = stderr
  }

  // 3. Dimensions from the video stream
  const dimMatch = selectedStreamSection.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  if (dimMatch) {
    width = parseInt(dimMatch[1], 10)
    height = parseInt(dimMatch[2], 10)
  }

  // 4. Rotation strictly from the selected stream's section
  const displayMatch = selectedStreamSection.match(/displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/i)
  if (displayMatch) {
    rotation = Math.round(Number(displayMatch[1]))
  } else {
    const rotateMeta = selectedStreamSection.match(/^\s*rotate\s*:\s*(-?\d+(?:\.\d+)?)/im)
    if (rotateMeta) {
      rotation = Math.round(Number(rotateMeta[1]))
    }
  }

  // Normalize rotation into [0, 360)
  const normalizedRotation = ((rotation % 360) + 360) % 360
  if (normalizedRotation === 90 || normalizedRotation === 270) {
    const tmp = width
    width = height
    height = tmp
  }

  // 5. FPS from the video stream
  const fpsMatch = selectedStreamSection.match(/(\d+(?:\.\d+)?)\s*fps/)
  if (fpsMatch) {
    fps = parseFloat(fpsMatch[1])
  }

  return {
    width,
    height,
    fps,
    duration,
    rotation: normalizedRotation,
  }
}

/**
 * Probes a video or image file using ffmpeg.
 *
 * Supports both signatures:
 * - `probeVideo(filePath)`
 * - `probeVideo(ffmpegPath, filePath)`
 */
export async function probeVideo(filePath: string): Promise<VideoProbeInfo>
export async function probeVideo(ffmpegPath: string, filePath: string): Promise<VideoProbeInfo>
export async function probeVideo(arg1: string, arg2?: string): Promise<VideoProbeInfo> {
  const ffmpegPath = arg2 ? arg1 : (findFfmpegPath() || 'ffmpeg')
  const filePath = arg2 ? arg2 : arg1

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
      windowsHide: true,
    })

    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('close', () => {
      resolve(parseFfmpegProbeOutput(stderr))
    })

    proc.on('error', () => {
      resolve({ width: 1920, height: 1080, fps: 30, duration: 0, rotation: 0 })
    })
  })
}
