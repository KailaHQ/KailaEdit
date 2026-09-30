import { spawn } from 'child_process'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { quietChildStdio } from '../process/quiet-child-stdio'
import { probeVideo } from '../media/probe'
import { logger } from '../logger'
import { MotionTracker } from '../../core/src/global-motion'
import type { MatteMotion } from '../../core/src/matte-motion'

/** Frames per second the shot's motion is sampled at; the matte interpolates between them. */
const TRACK_FPS = 10
/** Width the frames are tracked at. Camera motion is a large-scale thing; more pixels only cost time. */
const TRACK_WIDTH = 144
/** A stretch this long is tracked at most; anything past it holds the last motion. */
const MAX_SECONDS = 900

export interface MotionTrackParams {
  filePath: string
  /** Source seconds the track starts at (the reference picture is the frame here). */
  startTime: number
  /** Source seconds to follow. */
  duration: number
}

/**
 * Follows the camera's pan and zoom through a stretch of a video, so a matte painted on one
 * frame can be carried along with it. The frames are decoded small and gray; the estimate is
 * core/global-motion.
 */
export async function trackMatteMotion(params: MotionTrackParams): Promise<MatteMotion | null> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')

  const startTime = Math.max(0, params.startTime)
  const duration = Math.min(MAX_SECONDS, Math.max(0.2, params.duration))

  const probe = await probeVideo(ffmpegPath, params.filePath)
  if (!(probe.width > 0 && probe.height > 0)) return null
  const width = TRACK_WIDTH
  const height = Math.max(16, Math.round((TRACK_WIDTH * probe.height) / probe.width))
  const frameSize = width * height

  const decode: any = spawn(
    ffmpegPath,
    [
      '-v', 'error',
      '-ss', startTime.toFixed(6),
      '-t', duration.toFixed(6),
      '-i', params.filePath,
      '-an',
      '-vf', `fps=${TRACK_FPS},scale=${width}:${height},format=gray`,
      '-f', 'rawvideo',
      'pipe:1',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  quietChildStdio(decode, 'matte-motion decode')

  return new Promise((resolve, reject) => {
    let tracker: MotionTracker | null = null
    const samples: number[] = []
    let pending: Buffer = Buffer.alloc(0)

    decode.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
      let offset = 0
      while (offset + frameSize <= pending.length) {
        const frame = pending.subarray(offset, offset + frameSize)
        offset += frameSize
        if (!tracker) {
          tracker = new MotionTracker(width, height, frame)
          samples.push(1, 0, 0, 0, 1, 0)
        } else {
          for (const v of tracker.push(frame)) samples.push(Math.round(v * 1e5) / 1e5)
        }
      }
      pending = Buffer.from(pending.subarray(offset))
    })
    decode.on('error', reject)
    decode.on('close', () => {
      if (samples.length < 12) {
        resolve(null)
        return
      }
      logger.info(`[matte-motion] Tracked ${samples.length / 6} frames of ${params.filePath} from ${startTime}s`)
      resolve({ t0: startTime, step: 1 / TRACK_FPS, m: samples })
    })
  })
}
