import {
  IDENTITY_AFFINE,
  invertAffine,
  type Affine,
} from './global-motion'
import { fastHash64 } from './render-cache'

/**
 * How a video's picture moved over a stretch of its source, kept with a custom matte so the
 * matte can follow it. `m` holds one affine (6 numbers, see global-motion) per sample: where a
 * point of the picture at `t0` sits at `t0 + i * step`. Times are seconds of the SOURCE media,
 * so trimming or re-timing the clip does not invalidate it.
 */
export interface MatteMotion {
  t0: number
  step: number
  m: number[]
}

export function motionSampleCount(motion: MatteMotion): number {
  return Math.floor(motion.m.length / 6)
}

/** The motion at a source time, interpolated between samples and held at the ends. */
export function motionAt(motion: MatteMotion | null | undefined, sourceTime: number): Affine {
  if (!motion || motion.m.length < 6 || !(motion.step > 0)) return IDENTITY_AFFINE
  const count = motionSampleCount(motion)
  const pos = (sourceTime - motion.t0) / motion.step
  if (!(pos > 0)) return sampleAt(motion, 0)
  if (pos >= count - 1) return sampleAt(motion, count - 1)
  const i = Math.floor(pos)
  const f = pos - i
  const a = sampleAt(motion, i)
  const b = sampleAt(motion, i + 1)
  return a.map((v, k) => v + (b[k] - v) * f) as Affine
}

function sampleAt(motion: MatteMotion, i: number): Affine {
  const o = i * 6
  return [motion.m[o], motion.m[o + 1], motion.m[o + 2], motion.m[o + 3], motion.m[o + 4], motion.m[o + 5]]
}

/** Source time of a matte time (seconds inside the clip), the inverse of matteTimeForSourceTime. */
export function sourceTimeOfMatteTime(matteTime: number, trimStart: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1
  return (trimStart || 0) + matteTime * safeSpeed
}

/**
 * Maps a point of the picture at the moment a stroke was painted onto the same point of the
 * reference picture the matte is kept in. Null when the picture did not move there.
 */
export function strokeToReference(
  motion: MatteMotion | null | undefined,
  paintedAt: number,
  trimStart: number,
  speed: number,
): Affine | null {
  if (!motion) return null
  const at = motionAt(motion, sourceTimeOfMatteTime(paintedAt, trimStart, speed))
  const inverse = invertAffine(at)
  if (!inverse) return null
  return isIdentityLike(inverse) ? null : inverse
}

/**
 * Maps a point of a frame at `sourceTime` back to the reference picture, which is what the
 * matte is sampled with when that frame is drawn.
 */
export function frameToReference(motion: MatteMotion | null | undefined, sourceTime: number): Affine {
  return invertAffine(motionAt(motion, sourceTime)) ?? IDENTITY_AFFINE
}

function isIdentityLike(m: Affine): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY_AFFINE[i]) < 1e-4)
}

export function motionHash(motion: MatteMotion | null | undefined): string {
  if (!motion) return ''
  return fastHash64(`${motion.t0.toFixed(3)}:${motion.step.toFixed(4)}:${motion.m.map(v => v.toFixed(4)).join(',')}`)
}

/** Whether a stored motion covers the stretch of source a clip plays. */
export function motionCovers(motion: MatteMotion | null | undefined, from: number, to: number): boolean {
  if (!motion || motionSampleCount(motion) < 2) return false
  const end = motion.t0 + (motionSampleCount(motion) - 1) * motion.step
  return from >= motion.t0 - 1e-3 && to <= end + motion.step + 1e-3
}
