import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { renderQueue } from '../render-queue'
import * as eventEmitter from '../../ipc/event-emitter'
import { matteService } from '../../matte/matte-service'
import { strokeBakeService } from '../../matte/stroke-bake'
import { customMatteBakeService } from '../../matte/custom-matte-bake'

/**
 * Regression cover for the two gaps found when auditing Sprint 16:
 *
 * 1. `strokeBakeService` had no caller at all, so `strokeBakePath` was never set and the
 *    stroke silently vanished from every exported file. The parity test assigned the field
 *    by hand, which is why it stayed green.
 * 2. Export never baked a missing matte, so exporting before the editor finished baking
 *    produced a file with the background still in it, with no warning.
 *
 * These tests drive `prepareMattes` — the step that closes both — so neither can regress
 * back into a hand-assigned field.
 */

vi.mock('../ffmpeg-utils', () => ({
  findFfmpegPath: () => '/mock/bin/ffmpeg',
  runFfmpegWithProgress: vi.fn(() => ({
    process: { kill: () => {} },
    kill: () => {},
    promise: Promise.resolve({ success: true, stderr: '' }),
  })),
}))

vi.mock('../audio-mix', () => ({
  mixAudioToPcm: vi.fn(async () => ({ pcmBuffer: Buffer.alloc(100), sampleRate: 48000, channels: 2 })),
}))

vi.mock('../../path-validation', () => ({ validatePath: vi.fn() }))
vi.mock('../../config', () => ({ getAllowedRoots: vi.fn(() => ['/']) }))

vi.mock('../../matte/matte-service', () => ({
  matteService: {
    ensureBake: vi.fn(async () => ({
      success: true,
      mattePath: '/cache/matte-abc.mp4',
      fingerprint: 'fp-abc',
      frameCount: 300,
    })),
    cancelJob: vi.fn(),
  },
}))

vi.mock('../../matte/stroke-bake', () => ({
  strokeBakeService: {
    ensureBake: vi.fn(async () => ({
      success: true,
      strokePath: '/cache/stroke-abc.mov',
    })),
  },
}))

vi.mock('../../matte/custom-matte-bake', () => ({
  customMatteBakeService: {
    ensureBake: vi.fn(async () => ({
      success: true,
      mattePath: '/cache/custom-matte-xyz.mp4',
      fingerprint: 'custom-fp-xyz',
      frameCount: 300,
    })),
  },
}))

const makeJob = () => ({
  id: 'job-test',
  status: 'running' as const,
  percent: 0,
  createdAt: Date.now(),
})

const makeClip = (overrides: any = {}) => ({
  id: 'clip-1',
  type: 'video',
  path: '/mock/video.mp4',
  startTime: 0,
  duration: 10,
  trimStart: 2,
  speed: 1,
  reversed: false,
  trackIndex: 0,
  ...overrides,
})

const prepare = (job: any, clips: any[]) => (renderQueue as any).prepareMattes(job, clips)

describe('render-queue: auto matte and stroke preparation before export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(eventEmitter, 'emitToRenderer').mockImplementation(() => {})
  })

  it('bakes the matte and points the clip at it, so export cannot ship a background', async () => {
    const clip = makeClip({ autoMatte: { enabled: true, quality: 'standard', model: 'rvm-mobilenetv3' } })
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(true)
    expect(matteService.ensureBake).toHaveBeenCalledTimes(1)
    expect(vi.mocked(matteService.ensureBake).mock.calls[0][0]).toMatchObject({
      clipId: 'clip-1',
      filePath: '/mock/video.mp4',
      trimStart: 2,
      duration: 10,
    })
    expect(clip.autoMatte.bake).toMatchObject({
      path: '/cache/matte-abc.mp4',
      fingerprint: 'fp-abc',
      frameCount: 300,
    })
  })

  it('bakes the stroke and sets strokeBakePath — the field the filtergraph needs', async () => {
    const clip: any = makeClip({
      autoMatte: { enabled: true },
      stroke: { enabled: true, style: 'solid', width: 12, color: '#FFFFFF' },
    })
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(true)
    expect(strokeBakeService.ensureBake).toHaveBeenCalledTimes(1)
    expect(vi.mocked(strokeBakeService.ensureBake).mock.calls[0][0]).toMatchObject({
      clipId: 'clip-1',
      mattePath: '/cache/matte-abc.mp4',
      matteFingerprint: 'fp-abc',
    })
    expect(clip.strokeBakePath).toBe('/cache/stroke-abc.mov')
  })

  it('skips the stroke bake when the style is none or the width is zero', async () => {
    const none: any = makeClip({ autoMatte: { enabled: true }, stroke: { enabled: true, style: 'none', width: 12 } })
    const zero: any = makeClip({ id: 'clip-2', autoMatte: { enabled: true }, stroke: { enabled: true, style: 'solid', width: 0 } })

    await prepare(makeJob(), [none, zero])

    expect(strokeBakeService.ensureBake).not.toHaveBeenCalled()
    expect(none.strokeBakePath).toBeUndefined()
    expect(zero.strokeBakePath).toBeUndefined()
  })

  it('bakes custom matte on top of auto matte when custom strokes exist', async () => {
    const clip: any = makeClip({
      autoMatte: { enabled: true },
      customMatte: {
        enabled: true,
        strokes: [
          { id: 's1', mode: 'brush', size: 10, points: [{ x: 0.5, y: 0.5 }], paintedAt: 1 },
        ],
      },
    })
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(true)
    expect(matteService.ensureBake).toHaveBeenCalledTimes(1)
    expect(customMatteBakeService.ensureBake).toHaveBeenCalledTimes(1)
    expect(vi.mocked(customMatteBakeService.ensureBake).mock.calls[0][0]).toMatchObject({
      clipId: 'clip-1',
      baseMattePath: '/cache/matte-abc.mp4',
      baseMatteFingerprint: 'fp-abc',
    })
    expect(clip.autoMatte.bake).toMatchObject({
      path: '/cache/custom-matte-xyz.mp4',
      fingerprint: 'custom-fp-xyz',
    })
  })

  it('touches nothing when no clip asks for background removal', async () => {
    const clip = makeClip()
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(true)
    expect(matteService.ensureBake).not.toHaveBeenCalled()
  })

  it('fails the render with a named clip instead of exporting a wrong frame', async () => {
    vi.mocked(matteService.ensureBake).mockResolvedValueOnce({
      success: false,
      error: 'Model file not found',
    })

    const clip = makeClip({ autoMatte: { enabled: true } })
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(false)
    expect(res.error).toContain('clip-1')
    expect(res.error).toContain('Model file not found')
  })

  it('fails the render when the stroke bake fails rather than dropping the stroke', async () => {
    vi.mocked(strokeBakeService.ensureBake).mockResolvedValueOnce({
      success: false,
      error: 'Stroke encoder exited with code 1',
    })

    const clip: any = makeClip({
      autoMatte: { enabled: true },
      stroke: { enabled: true, style: 'luminescence', width: 10 },
    })
    const res = await prepare(makeJob(), [clip])

    expect(res.ok).toBe(false)
    expect(res.error).toContain('Stroke')
    expect(clip.strokeBakePath).toBeUndefined()
  })

  it('is actually wired into the export run, not just defined', async () => {
    // Guards the call site: deleting the prepareMattes() call in executeJob would make the
    // stroke and the matte disappear from exports again while every other test stays green.
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any)

    const result = renderQueue.startJob({
      clips: [
        makeClip({
          autoMatte: { enabled: true },
          stroke: { enabled: true, style: 'solid', width: 12, color: '#FFFFFF' },
        }),
      ],
      outputPath: '/mock/output.mp4',
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 30,
      quality: 18,
    } as any)

    expect(result.success).toBe(true)

    await vi.waitFor(() => {
      expect(matteService.ensureBake).toHaveBeenCalled()
      expect(strokeBakeService.ensureBake).toHaveBeenCalled()
    }, { timeout: 3000 })
  })

  it('stops and cancels the matte job when the render is cancelled mid-preparation', async () => {
    const job: any = makeJob()
    vi.mocked(matteService.ensureBake).mockImplementationOnce(async () => {
      job.status = 'cancelled'
      return { success: true, mattePath: '/cache/matte-abc.mp4', fingerprint: 'fp-abc', frameCount: 1 }
    })

    const first: any = makeClip({ autoMatte: { enabled: true } })
    const second: any = makeClip({ id: 'clip-2', autoMatte: { enabled: true } })
    const res = await prepare(job, [first, second])

    expect(res.ok).toBe(false)
    expect(matteService.ensureBake).toHaveBeenCalledTimes(1)
    expect(second.autoMatte.bake).toBeUndefined()
  })
})
