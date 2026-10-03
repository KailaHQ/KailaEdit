import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { renderQueue } from '../render-queue'
import { runFfmpegWithProgress } from '../ffmpeg-utils'
import * as eventEmitter from '../../ipc/event-emitter'

/**
 * Stickers ship inside the app and are stored as `stickers/fire.png`. `startJob` resolved that to
 * a real file for its own checks, but handed the executor the original, unresolved clips, so
 * ffmpeg was given `-i stickers/fire.png` and failed: "Error opening input file". Every render of
 * a project with a sticker failed that way, the render cache's segments and an export alike.
 */

vi.mock('../ffmpeg-utils', () => ({
  findFfmpegPath: () => '/mock/bin/ffmpeg',
  // The hardware-encoder probe runs ffmpeg through this; "not available" keeps the render on the CPU.
  runFfmpegCapture: vi.fn(async () => ({ status: 1, stdout: '', stderr: '' })),
  runFfmpegWithProgress: vi.fn(() => ({
    process: { kill: () => {} },
    promise: Promise.resolve({ success: true, stderr: '' }),
    kill: () => {},
  })),
}))

vi.mock('../audio-mix', () => ({
  mixAudioToPcm: vi.fn(async () => ({ pcmBuffer: Buffer.alloc(100), sampleRate: 48000, channels: 2 })),
}))

vi.mock('../../path-validation', () => ({ validatePath: vi.fn() }))
vi.mock('../../config', () => ({ getAllowedRoots: vi.fn(() => ['/']) }))

const clip = (overrides: Record<string, unknown>) => ({
  id: 'c',
  type: 'video',
  path: '/mock/video.mp4',
  startTime: 0,
  duration: 5,
  trimStart: 0,
  speed: 1,
  reversed: false,
  flipH: false,
  flipV: false,
  opacity: 1,
  trackIndex: 0,
  muted: false,
  volume: 1,
  ...overrides,
})

describe('a render whose clips include a bundled sticker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(eventEmitter, 'emitToRenderer').mockImplementation(() => {})
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    // The sticker's relative path names nothing from where the app runs; absolute paths exist.
    vi.spyOn(fs, 'existsSync').mockImplementation(p => path.isAbsolute(String(p)))
  })

  const ffmpegArgs = () => (runFfmpegWithProgress as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .flatMap(call => (Array.isArray(call[1]) ? (call[1] as string[]) : []))

  it('gives ffmpeg the sticker\'s real file, not the relative path it is stored under', async () => {
    const result = renderQueue.startJob({
      clips: [
        clip({ id: 'main' }),
        clip({ id: 'sticker', type: 'image', path: 'stickers/shape-square.png', trackIndex: 1, duration: 3 }),
      ],
      outputPath: '/mock/output.mp4',
      codec: 'h264',
      width: 1080,
      height: 1920,
      fps: 30,
      quality: 18,
    } as never)
    expect(result.success).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 150))

    const args = ffmpegArgs()
    expect(args).not.toContain('stickers/shape-square.png')
    const sticker = args.find(arg => arg.replace(/\\/g, '/').endsWith('stickers/shape-square.png'))
    expect(sticker).toBeDefined()
    expect(path.isAbsolute(sticker!)).toBe(true)
  })

  it('leaves the paths of ordinary media alone', async () => {
    renderQueue.startJob({
      clips: [clip({ id: 'main', path: '/mock/video.mp4' })],
      outputPath: '/mock/output.mp4',
      codec: 'h264',
      width: 1080,
      height: 1920,
      fps: 30,
      quality: 18,
    } as never)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(ffmpegArgs()).toContain('/mock/video.mp4')
  })
})
