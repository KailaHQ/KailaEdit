import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const ffmpegPath: string = require('ffmpeg-static')

/**
 * Added 18/09/2026, after background removal never showed in the preview.
 *
 * The bake encoded its matte with `-crf 0`. x264 in lossless mode emits High 4:4:4
 * Predictive whatever pixel format it is given, and Chromium's H.264 decoder does not
 * support that profile — so the `<video>` element the preview loads the matte into could
 * not decode a frame. Nothing failed loudly: the panel reported "matte ready", the export
 * was correct, and the preview quietly showed the background.
 *
 * This holds the encoder to a profile a browser can actually play.
 */
describe('matte encoding stays decodable by the preview', () => {
  const tmpDir = path.join(os.tmpdir(), `kaila-matte-profile-${Date.now()}`)

  function encodeGray(args: string[]): string {
    fs.mkdirSync(tmpDir, { recursive: true })
    const out = path.join(tmpDir, `out-${Math.random().toString(36).slice(2)}.mp4`)
    const r = spawnSync(ffmpegPath, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30',
      '-frames:v', '3', '-vf', 'format=gray',
      ...args, out,
    ], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    return out
  }

  function profileOf(file: string): string {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' })
    return (r.stderr || '').match(/Video: h264 \(([^)]+)\)/)?.[1] ?? 'unknown'
  }

  it('the settings the bake uses produce a profile browsers can decode', () => {
    // Exactly what matte-service passes to the encoder.
    const file = encodeGray([
      '-c:v', 'libx264', '-crf', '1', '-profile:v', 'high', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ])
    const profile = profileOf(file)
    expect(profile).toBe('High')
    expect(profile).not.toMatch(/4:4:4/)
  })

  it('shows why lossless cannot be used, so nobody puts it back', () => {
    // `-crf 0` asks for lossless and silently lands on a profile no browser will play,
    // even though the pixel format says yuv420p.
    const file = encodeGray(['-c:v', 'libx264', '-crf', '0', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'])
    expect(profileOf(file)).toMatch(/4:4:4/)
  })

  it('keeps the matte close enough to lossless to be worth trusting', () => {
    const lossless = encodeGray(['-c:v', 'libx264', '-crf', '0', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'])
    const shipped = encodeGray([
      '-c:v', 'libx264', '-crf', '1', '-profile:v', 'high', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ])

    const decode = (f: string) => spawnSync(ffmpegPath, ['-hide_banner', '-i', f,
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 1 << 28 }).stdout

    const a = decode(lossless)
    const b = decode(shipped)
    expect(a.length).toBe(b.length)

    let worst = 0
    let total = 0
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i])
      if (d > worst) worst = d
      total += d
    }
    // Measured on a real 1080x1920 matte: worst 9/255, mean 0.013/255.
    expect(worst).toBeLessThanOrEqual(16)
    expect(total / a.length).toBeLessThan(0.5)
  })
})
