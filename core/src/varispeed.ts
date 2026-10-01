/**
 * Plays audio through a speed curve, the way tape does: faster is higher,
 * slower is lower, and every moment lines up with the picture.
 *
 * ffmpeg's `atempo` keeps pitch but takes one rate per filter; chaining dozens
 * of them for a ramp clicks at every seam. Resampling by hand avoids both: each
 * output sample reads the source at the position the clip shows at that
 * instant, through the same time map the video uses.
 */

import type { SpeedCurve } from './project-model'
import { clipSourceSpan, clipSpeedAtTime, sourceOffsetAtClipTime } from './speed-curve'

export interface VarispeedClip {
  duration: number
  speed: number
  speedCurve?: SpeedCurve
  reversed?: boolean
}

/** Catmull–Rom between s1 and s2 at fraction f. */
function cubic(s0: number, s1: number, s2: number, s3: number, f: number): number {
  return s1 + 0.5 * f * (s2 - s0 + f * (2 * s0 - 5 * s1 + 4 * s2 - s3 + f * (3 * (s1 - s2) + s3 - s0)))
}

/**
 * Resamples interleaved PCM of the clip's source window (read at 1x, in file
 * order) into the clip's timeline duration.
 *
 * Returns interleaved samples in the input's units. Where the clip speeds up
 * past 1x, each output sample averages the stretch of source it skips over, so
 * the high end folds down as a gentle low-pass instead of aliasing into hiss.
 */
export function renderVarispeed(
  source: ArrayLike<number>,
  channels: number,
  sampleRate: number,
  clip: VarispeedClip,
): Float32Array {
  const inFrames = Math.floor(source.length / channels)
  const outFrames = Math.max(0, Math.round(clip.duration * sampleRate))
  const out = new Float32Array(outFrames * channels)
  if (inFrames === 0 || outFrames === 0) return out

  const spanFrames = Math.min(inFrames, clipSourceSpan(clip) * sampleRate)
  const at = (frame: number, ch: number) => {
    const i = frame < 0 ? 0 : frame >= inFrames ? inFrames - 1 : frame
    return source[i * channels + ch]
  }
  const read = (pos: number, ch: number) => {
    const i = Math.floor(pos)
    const f = pos - i
    return cubic(at(i - 1, ch), at(i, ch), at(i + 1, ch), at(i + 2, ch), f)
  }

  for (let n = 0; n < outFrames; n++) {
    const t = n / sampleRate
    const consumed = sourceOffsetAtClipTime(clip, t) * sampleRate
    const pos = clip.reversed ? spanFrames - 1 - consumed : consumed
    const step = clipSpeedAtTime(clip, t)
    const taps = step > 1.05 ? Math.ceil(step) + 1 : 1

    for (let ch = 0; ch < channels; ch++) {
      let value: number
      if (taps === 1) {
        value = read(pos, ch)
      } else {
        let sum = 0
        for (let k = 0; k < taps; k++) sum += read(pos + (k / (taps - 1) - 0.5) * step, ch)
        value = sum / taps
      }
      out[n * channels + ch] = value
    }
  }
  return out
}
