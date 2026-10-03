import { describe, it, expect } from 'vitest'
import path from 'path'
import { spawnSync } from 'child_process'
import { findFfmpegPath, runFfmpegCapture, runFfmpegCaptureBinary, runFfmpegWithProgress } from '../ffmpeg-utils'

const ffmpegPath = findFfmpegPath()
const fixture = path.resolve(__dirname, '../../../tests/fixtures/synthetic_media.mp4')
const rawRgbArgs = ['-hide_banner', '-loglevel', 'error', '-i', fixture, '-vf', 'scale=64:36', '-frames:v', '3', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']

describe.skipIf(!ffmpegPath)('async ffmpeg capture', () => {
  it('hands back raw pixels byte for byte, as spawnSync did', async () => {
    const expected = spawnSync(ffmpegPath!, rawRgbArgs, { maxBuffer: 10 * 1024 * 1024 }).stdout as Buffer
    const { status, stdout } = await runFfmpegCaptureBinary(ffmpegPath!, rawRgbArgs)
    expect(status).toBe(0)
    expect(stdout.length).toBe(64 * 36 * 3 * 3)
    expect(stdout.equals(expected)).toBe(true)
  })

  it('kills ffmpeg and rejects past the output limit', async () => {
    await expect(runFfmpegCaptureBinary(ffmpegPath!, rawRgbArgs, { maxStdoutBytes: 1000 }))
      .rejects.toThrow(/exceeded 1000 bytes/)
  })

  it('reports a non-zero exit instead of rejecting, so a probe can read the stream info', async () => {
    const { status, stderr } = await runFfmpegCapture(ffmpegPath!, ['-hide_banner', '-i', fixture])
    expect(status).not.toBe(0)
    expect(stderr).toMatch(/Video:/)
  })

  it('reports progress in real microseconds, never past the media length', async () => {
    const seen: number[] = []
    const { promise } = runFfmpegWithProgress(ffmpegPath!, ['-f', 'lavfi', '-i', 'color=black:s=64x64:d=2', '-f', 'null', '-'], info => {
      if (info.outTimeUs !== undefined) seen.push(info.outTimeUs)
    })
    expect((await promise).success).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeGreaterThan(1_500_000)
    expect(Math.max(...seen)).toBeLessThanOrEqual(2_100_000)
  })

  it('rejects when ffmpeg cannot be started', async () => {
    await expect(runFfmpegCapture(path.join(__dirname, 'no-such-ffmpeg'), ['-version']))
      .rejects.toThrow(/Failed to start ffmpeg/)
  })
})
