import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { MatteService } from '../matte-service'
import { renderCacheManager } from '../../export/render-cache-manager'

describe('MatteService Deduplication & Queueing (KE-1503)', () => {
  let tmpDir: string
  let matteService: MatteService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaila-matte-test-'))
    vi.spyOn(renderCacheManager, 'getCacheDir').mockReturnValue(tmpDir)
    matteService = new MatteService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('reuses newly completed bake for queued jobs without running executeBake twice', async () => {
    const fakeVideo = path.join(tmpDir, 'sample.mp4')
    fs.writeFileSync(fakeVideo, 'fake video content')

    const executeBakeCalls: string[] = []
    let finishJob1: () => void = () => {}

    // Mock executeBake to simulate job 1 taking time and writing a covering bake file to disk
    vi.spyOn(matteService as any, 'executeBake').mockImplementation(
      async (params: any, job: any, _ffmpeg: any, clipW: any, clipH: any, fps: any, _frames: any, bakeRange: any) => {
        executeBakeCalls.push(job.jobId)

        if (job.jobId === 'job-1') {
          // Wait until we explicitly finish job 1
          await new Promise<void>((resolve) => {
            finishJob1 = () => {
              // Simulate creating the completed bake on disk covering the clip
              fs.writeFileSync(job.finalPath, Buffer.alloc(2000)) // > 1000 bytes so findCoveringBake accepts it
              job.status = {
                status: 'done',
                percent: 100,
                phase: 'done',
                mattePath: job.finalPath,
                fingerprint: job.fingerprint,
                frameCount: 900,
              }
              resolve()
            }
          })
        }
      },
    )

    // Job 1 asks for [0, 30s]
    const res1 = await matteService.startBake({
      jobId: 'job-1',
      clipId: 'clip-1',
      filePath: fakeVideo,
      trimStart: 0,
      duration: 30,
      model: 'rvm-mobilenetv3',
    })

    expect(res1.started).toBe(true)
    expect(res1.cached).toBe(false)

    // Job 2 asks for [10, 20s] for the SAME clip while Job 1 is still in progress
    const res2 = await matteService.startBake({
      jobId: 'job-2',
      clipId: 'clip-1',
      filePath: fakeVideo,
      trimStart: 10,
      duration: 10,
      model: 'rvm-mobilenetv3',
    })

    expect(res2.started).toBe(true)
    expect(res2.cached).toBe(false)

    // At this moment, only job-1 has called executeBake because job-2 is queued behind it
    expect(executeBakeCalls).toEqual(['job-1'])

    // Now finish job 1, which creates the bake covering the clip
    finishJob1()

    // Wait for the queue to drain
    await (matteService as any).bakeChain

    // Verify job-2 status transitioned to 'done' by reusing job-1's bake!
    const job2Status = matteService.getJobStatus('job-2')
    expect(job2Status.status).toBe('done')
    expect(job2Status.phase).toBe('done')
    expect(job2Status.percent).toBe(100)
    expect(job2Status.mattePath).toBeTruthy()

    // executeBake was NEVER called for job-2!
    expect(executeBakeCalls).toEqual(['job-1'])
  })

  it('does not execute a queued job if it was cancelled before starting', async () => {
    const fakeVideo = path.join(tmpDir, 'sample.mp4')
    fs.writeFileSync(fakeVideo, 'fake video content')

    const executeBakeCalls: string[] = []
    let finishJob1: () => void = () => {}

    vi.spyOn(matteService as any, 'executeBake').mockImplementation(async (_params: any, job: any) => {
      executeBakeCalls.push(job.jobId)
      if (job.jobId === 'job-1') {
        await new Promise<void>((resolve) => {
          finishJob1 = resolve
        })
      }
    })

    await matteService.startBake({
      jobId: 'job-1',
      clipId: 'clip-1',
      filePath: fakeVideo,
      trimStart: 0,
      duration: 10,
    })

    await matteService.startBake({
      jobId: 'job-2',
      clipId: 'clip-2',
      filePath: fakeVideo,
      trimStart: 0,
      duration: 10,
    })

    expect(executeBakeCalls).toEqual(['job-1'])

    // Cancel job-2 while it is still waiting in queue
    const cancelled = matteService.cancelJob('job-2')
    expect(cancelled).toBe(true)
    expect(matteService.getJobStatus('job-2').status).toBe('cancelled')

    // Finish job-1
    finishJob1()
    await (matteService as any).bakeChain

    // Job-2 never ran executeBake
    expect(executeBakeCalls).toEqual(['job-1'])
    expect(matteService.getJobStatus('job-2').status).toBe('cancelled')
  })

  it('continues queue even if a previous job throws an error', async () => {
    const fakeVideo = path.join(tmpDir, 'sample.mp4')
    fs.writeFileSync(fakeVideo, 'fake video content')

    const executed: string[] = []

    vi.spyOn(matteService as any, 'executeBake').mockImplementation(async (_params: any, job: any) => {
      executed.push(job.jobId)
      if (job.jobId === 'job-fail') {
        throw new Error('Simulated bake failure')
      }
    })

    await matteService.startBake({
      jobId: 'job-fail',
      clipId: 'clip-1',
      filePath: fakeVideo,
      trimStart: 0,
      duration: 10,
    })

    await matteService.startBake({
      jobId: 'job-success',
      clipId: 'clip-2',
      filePath: fakeVideo,
      trimStart: 0,
      duration: 10,
    })

    await (matteService as any).bakeChain

    expect(executed).toEqual(['job-fail', 'job-success'])
    expect(matteService.getJobStatus('job-fail').status).toBe('error')
  })
})
