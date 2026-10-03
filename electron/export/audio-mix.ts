import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'
import { probeAudioStream, type AudioStreamInfo } from './ffmpeg-utils'
import { applyLookaheadLimiter } from './audio-limiter'
import type { ExportClip } from './timeline'
import { computePreInputSeek } from './video-filter'
import {
  getKeyframeTrack,
  hasKeyframesForProperty,
  buildKeyframeFfmpegExpression,
  sampleKeyframeTrack,
} from '../../core/src/keyframes'
import type { KeyframeTrack } from '../../core/src/project-model'
import { clipHasSpeedCurve, clipSourceSpan } from '../../core/src/speed-curve'
import { renderVarispeed, type VarispeedClip } from '../../core/src/varispeed'

const SAMPLE_RATE = 48000
const NUM_CHANNELS = 2
const BYTES_PER_SAMPLE = 2 // 16-bit signed LE
const BYTES_PER_FRAME = NUM_CHANNELS * BYTES_PER_SAMPLE // 4 bytes per stereo frame

/** Build ffmpeg arguments for raw PCM extraction with pre-input seek */
export function buildAudioPcmArgs(
  filePath: string,
  trimStart: number,
  trimEnd: number,
  speed: number,
  reversed: boolean,
  sourceChannels: number,
  volumeTrack?: KeyframeTrack,
): { args: string[]; adjustedTrimStart: number; adjustedTrimEnd: number; seekSec: number } {
  const { seekSec, seekArg, adjustedTrimStart } = computePreInputSeek(trimStart)
  const adjustedTrimEnd = trimEnd - seekSec

  const filters: string[] = [
    `atrim=start=${adjustedTrimStart.toFixed(6)}:end=${adjustedTrimEnd.toFixed(6)}`,
    'asetpts=PTS-STARTPTS',
  ]
  if (speed !== 1) {
    let remaining = speed
    while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0 }
    while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5 }
    filters.push(`atempo=${remaining.toFixed(6)}`)
  }
  if (reversed) filters.push('areverse')
  if (sourceChannels === 1) filters.push('pan=stereo|c0=c0|c1=c0')

  if (volumeTrack && volumeTrack.points && volumeTrack.points.length > 0) {
    const volExpr = buildKeyframeFfmpegExpression(volumeTrack, 1, 't')
    filters.push(`volume=eval=frame:volume='if(isnan(t),1.0,(${volExpr}))'`)
  }

  const args = [
    '-ss', seekArg,
    '-i', filePath,
    '-af', filters.join(','),
    '-f', 's16le', '-ac', String(NUM_CHANNELS), '-ar', String(SAMPLE_RATE),
    'pipe:1',
  ]

  return { args, adjustedTrimStart, adjustedTrimEnd, seekSec }
}

/** Extract raw PCM from a file via ffmpeg stdout pipe */
function extractPcmBuffer(
  ffmpegPath: string,
  filePath: string, trimStart: number, trimEnd: number, speed: number, reversed: boolean,
  sourceChannels: number,
  volumeTrack?: KeyframeTrack,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { args } = buildAudioPcmArgs(filePath, trimStart, trimEnd, speed, reversed, sourceChannels, volumeTrack)
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on('data', () => {}) // drain stderr to prevent blocking
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`PCM extraction failed (code ${code}) for ${filePath}`))
    })
    proc.on('error', reject)
  })
}

interface AudioSource {
  filePath: string; trimStart: number; trimEnd: number;
  timelineStart: number; speed: number; reversed: boolean; volume: number;
  channels: number;
  volumeTrack?: KeyframeTrack;
  /** Set when the clip has a speed curve: its audio is resampled through it. */
  varispeed?: VarispeedClip;
}

/**
 * Mixes a clip with a speed curve: its source window read at 1x, resampled
 * through the curve (pitch follows speed), then its gain applied on the
 * timeline clock — volume keyframes are keyed to timeline time, so they must
 * be sampled after the resample, not by ffmpeg before it.
 */
function mixVarispeedSource(src: AudioSource, clip: VarispeedClip, pcm: Buffer, mixBuffer: Float64Array): void {
  // An Int16Array view needs an even byte offset; a pooled Buffer may not have one.
  const aligned = pcm.byteOffset % 2 === 0 ? pcm : Buffer.from(pcm)
  const samples = new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / BYTES_PER_SAMPLE))
  const rendered = renderVarispeed(samples, NUM_CHANNELS, SAMPLE_RATE, clip)
  const startSample = Math.round(src.timelineStart * SAMPLE_RATE) * NUM_CHANNELS
  const frames = rendered.length / NUM_CHANNELS
  for (let f = 0; f < frames; f++) {
    const gain = src.volumeTrack
      ? sampleKeyframeTrack(src.volumeTrack, f / SAMPLE_RATE, 1)
      : src.volume
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      const destIdx = startSample + f * NUM_CHANNELS + ch
      if (destIdx < 0 || destIdx >= mixBuffer.length) continue
      mixBuffer[destIdx] += rendered[f * NUM_CHANNELS + ch] * gain
    }
  }
  logger.info(`[Export] Audio varispeed: ${path.basename(src.filePath)} ${frames} frames through a speed curve`)
}

/**
 * Mix all audio from clips into a single PCM buffer.
 * Returns raw Int16LE PCM data with the sample rate and channel count.
 */
export async function mixAudioToPcm(
  clips: ExportClip[],
  totalDuration: number,
  ffmpegPath: string,
): Promise<{ pcmBuffer: Buffer; sampleRate: number; channels: number }> {
  // Collect audio sources from ORIGINAL clips
  const audioProbeCache = new Map<string, AudioStreamInfo>()
  const audioSources: AudioSource[] = []

  const probe = async (filePath: string) => {
    const cached = audioProbeCache.get(filePath)
    if (cached) return cached
    const info = await probeAudioStream(ffmpegPath, filePath)
    audioProbeCache.set(filePath, info)
    return info
  }

  // Adding a video to the timeline splits it into a video clip plus a linked
  // audio clip pointing at the same file. Mixing both would sum the same audio
  // twice — 6 dB too loud. The linked audio clip owns the sound; the video clip
  // only contributes when it has no linked audio clip.
  const clipIds = new Set(clips.map(c => c.id).filter((id): id is string => Boolean(id)))
  const hasLinkedAudioClip = (c: ExportClip) =>
    (c.linkedClipIds ?? []).some(id => {
      if (!clipIds.has(id)) return false
      return clips.some(candidate => candidate.id === id && candidate.type === 'audio')
    })

  for (const c of clips) {
    if (c.muted || c.volume <= 0) continue
    const fp = c.path
    if (!fp || !fs.existsSync(fp)) continue
    if (c.type !== 'audio' && c.type !== 'video') continue
    if (c.type === 'video' && hasLinkedAudioClip(c)) continue

    const info = await probe(fp)
    if (!info.hasAudio) continue

    const speed = typeof c.speed === 'number' && Number.isFinite(c.speed) && c.speed > 0 ? c.speed : 1
    const volume = typeof c.volume === 'number' && Number.isFinite(c.volume) ? c.volume : 1
    const trimStart = typeof c.trimStart === 'number' && Number.isFinite(c.trimStart) ? c.trimStart : 0
    // The out-point, derived rather than read: `trimEnd` on a timeline clip is
    // the amount trimmed off the tail, not an out-point, and the export schema
    // does not carry it anyway. Reading it here was dead code that would have
    // produced the wrong window had it ever been populated.
    const trimEnd = trimStart + clipSourceSpan(c)

    const volumeTrack = getKeyframeTrack(c as any, 'volume')
    const hasVolKeyframes = hasKeyframesForProperty(c as any, 'volume')

    audioSources.push({
      filePath: fp,
      trimStart,
      trimEnd,
      timelineStart: c.startTime,
      speed,
      reversed: Boolean(c.reversed),
      volume,
      channels: info.channels,
      volumeTrack: hasVolKeyframes ? volumeTrack : undefined,
      varispeed: clipHasSpeedCurve(c)
        ? { duration: c.duration, speed, speedCurve: c.speedCurve, reversed: Boolean(c.reversed) }
        : undefined,
    })
  }

  logger.info( `[Export] Audio: ${audioSources.length} source(s) from ${clips.length} clip(s)`)

  // Create master mix buffer (Float64 to accumulate without clipping)
  const totalFrames = Math.ceil(totalDuration * SAMPLE_RATE)
  const totalSamples = totalFrames * NUM_CHANNELS
  const mixBuffer = new Float64Array(totalSamples) // initialized to 0 (silence)

  // Extract each source and mix into the master buffer
  for (let i = 0; i < audioSources.length; i++) {
    const src = audioSources[i]
    logger.info( `[Export] Audio ${i + 1}/${audioSources.length}: ${path.basename(src.filePath)} trim=${src.trimStart.toFixed(2)}-${src.trimEnd.toFixed(2)} @${src.timelineStart.toFixed(2)}s vol=${src.volume}`)
    try {
      if (src.varispeed) {
        mixVarispeedSource(src, src.varispeed, await extractPcmBuffer(
          ffmpegPath, src.filePath, src.trimStart, src.trimEnd, 1, false, src.channels,
        ), mixBuffer)
        continue
      }
      const pcm = await extractPcmBuffer(ffmpegPath, src.filePath, src.trimStart, src.trimEnd, src.speed, src.reversed, src.channels, src.volumeTrack)
      const startFrame = Math.round(src.timelineStart * SAMPLE_RATE)
      const startSample = startFrame * NUM_CHANNELS
      const numPcmSamples = Math.floor(pcm.length / BYTES_PER_SAMPLE)

      // When volume keyframes exist, the ffmpeg volume filter already scaled the audio dynamically.
      // Otherwise, apply the static linear gain src.volume.
      const sampleMultiplier = src.volumeTrack ? 1 : src.volume

      for (let s = 0; s < numPcmSamples; s++) {
        const destIdx = startSample + s
        if (destIdx < 0 || destIdx >= totalSamples) continue
        const value = pcm.readInt16LE(s * BYTES_PER_SAMPLE)
        mixBuffer[destIdx] += value * sampleMultiplier
      }
      logger.info( `[Export] Audio ${i + 1}: mixed ${numPcmSamples} samples (${(numPcmSamples / SAMPLE_RATE / NUM_CHANNELS).toFixed(2)}s) at offset frame ${startFrame}`)
    } catch (err: any) {
      logger.warn( `[Export] Failed to extract audio from ${src.filePath}: ${err.message}`)
    }
  }

  // Boosted clips and overlapping sources both push the sum past full scale.
  // Clamping there would flat-top the waveform and audibly distort, so ride the
  // level down with a look-ahead limiter instead. It is a no-op when the mix
  // already fits.
  const limiter = applyLookaheadLimiter(mixBuffer, NUM_CHANNELS, SAMPLE_RATE)
  if (limiter.engaged) {
    logger.info(
      `[Export] Audio limiter: input peak ${(20 * Math.log10(Math.max(limiter.inputPeak, 1e-6))).toFixed(1)} dBFS, `
      + `max reduction ${limiter.maxReductionDb.toFixed(1)} dB`,
    )
  }

  // Convert Float64 accumulator -> Int16 PCM buffer. The clamp is now only a
  // guard against rounding at the very edge; the limiter did the real work.
  const outputPcm = Buffer.alloc(totalFrames * BYTES_PER_FRAME)
  for (let s = 0; s < totalSamples; s++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(mixBuffer[s])))
    outputPcm.writeInt16LE(clamped, s * BYTES_PER_SAMPLE)
  }

  return { pcmBuffer: outputPcm, sampleRate: SAMPLE_RATE, channels: NUM_CHANNELS }
}
