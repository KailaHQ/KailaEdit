import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import * as eventEmitter from '../../ipc/event-emitter'
import { findFfmpegPath } from '../../export/ffmpeg-utils'
import {
  StabilizeService,
  buildStabilizeArgs,
  outputColorFor,
  parseSourceInfo,
  type StabilizeStartParams,
} from '../stabilize-service'
import type { ElectronEventPayload } from '../../../shared/electron-api-schema'

const IPHONE_SDR = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_4692.MOV':
  Duration: 00:02:32.47, start: 0.000000, bitrate: 15538 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 15337 kb/s, 30 fps, 30 tbr, 600 tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 153 kb/s (default)`

const IPHONE_HLG = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_5000.MOV':
  Duration: 00:00:12.00, start: 0.000000, bitrate: 20000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 19800 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)`

describe('parseSourceInfo', () => {
  it('reads display size, fps and no HDR from an iPhone SDR clip', () => {
    expect(parseSourceInfo(IPHONE_SDR)).toEqual({ width: 1080, height: 1920, fps: 30, duration: 152.47, hdrTransfer: null })
  })

  it('recognises HLG by its transfer curve', () => {
    const info = parseSourceInfo(IPHONE_HLG)
    expect(info.hdrTransfer).toBe('arib-std-b67')
    expect(info.fps).toBeCloseTo(29.97)
  })

  it('does not call a 10-bit SDR file HDR', () => {
    const tenBitSdr = IPHONE_HLG.replace('bt2020nc/bt2020/arib-std-b67', 'bt709')
    expect(parseSourceInfo(tenBitSdr).hdrTransfer).toBeNull()
  })

  it('picks the output colour from the source and the renderer\'s choice', () => {
    expect(outputColorFor({ hdrTransfer: null }, 'hevc')).toBe('sdr')
    expect(outputColorFor({ hdrTransfer: 'arib-std-b67' }, 'hevc')).toBe('hdr-hevc')
    expect(outputColorFor({ hdrTransfer: 'smpte2084' }, 'sdr')).toBe('hdr-tonemap')
  })
})

describe('buildStabilizeArgs', () => {
  const base = {
    filePath: 'C:/media/in.mov',
    sourceStart: 19,
    sourceSpan: 12,
    smoothing: 20,
    mode: 'auto' as const,
    outputPath: 'C:/cache/out.part.mp4',
  }

  it('cuts the same range in both passes', () => {
    const { detect, transform } = buildStabilizeArgs({ ...base, color: 'sdr' })
    const cut = ['-ss', '19.000', '-i', 'C:/media/in.mov', '-t', '12.000']
    expect(detect.slice(2, 8)).toEqual(cut)
    expect(transform.slice(2, 8)).toEqual(cut)
  })

  it('analyses into a relative motion file and discards the output', () => {
    const { detect } = buildStabilizeArgs({ ...base, color: 'sdr' })
    expect(detect).toContain('vidstabdetect=shakiness=8:accuracy=15:result=motion.trf')
    expect(detect.slice(-3)).toEqual(['-f', 'null', '-'])
  })

  it('encodes SDR as H.264 with the audio cut alongside', () => {
    const { transform } = buildStabilizeArgs({ ...base, color: 'sdr' })
    const vf = transform[transform.indexOf('-vf') + 1]
    expect(vf).toContain('vidstabtransform=input=motion.trf:smoothing=20:optzoom=1:interpol=bilinear:debug=1')
    expect(vf.endsWith(',format=yuv420p')).toBe(true)
    expect(transform).toContain('libx264')
    expect(transform.join(' ')).toContain('-map 0:a:0? ')
    expect(transform.join(' ')).toContain('-c:a aac')
    expect(transform[transform.length - 1]).toBe('C:/cache/out.part.mp4')
  })

  it('keeps HDR as 10-bit HEVC tagged with the source transfer', () => {
    const { transform } = buildStabilizeArgs({ ...base, color: 'hdr-hevc', hdrTransfer: 'smpte2084' })
    const joined = transform.join(' ')
    expect(joined).toContain('libx265')
    expect(joined).toContain('format=yuv420p10le')
    expect(joined).toContain('-color_trc smpte2084')
    expect(joined).toContain('-tag:v hvc1')
  })

  it('tone-maps HDR to BT.709 when asked for SDR', () => {
    const { transform } = buildStabilizeArgs({ ...base, color: 'hdr-tonemap', hdrTransfer: 'arib-std-b67' })
    const vf = transform[transform.indexOf('-vf') + 1]
    expect(vf).toContain('tonemap=tonemap=hable')
    expect(transform).toContain('libx264')
  })

  it('pins the camera in both passes in tripod mode', () => {
    const { detect, transform } = buildStabilizeArgs({ ...base, mode: 'tripod', color: 'sdr' })
    expect(detect.join(' ')).toContain('tripod=1')
    expect(transform[transform.indexOf('-vf') + 1]).toContain('tripod=1')
  })
})

// ---------------------------------------------------------------------------
// Against the real ffmpeg, on a small synthetic shaky clip.
// ---------------------------------------------------------------------------

const ffmpegPath = findFfmpegPath()
const hasVidstab = !!ffmpegPath && (spawnSync(ffmpegPath, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout ?? '').includes('vidstabtransform')

type Progress = ElectronEventPayload<'stabilize:progress'>

describe.skipIf(!hasVidstab)('StabilizeService with ffmpeg', () => {
  let fixtureDir: string
  let shakyClip: string
  let hlgClip: string
  let cacheDir: string
  let service: StabilizeService
  const events: Progress[] = []

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaila-stab-fixture-'))
    shakyClip = path.join(fixtureDir, 'shaky.mp4')
    hlgClip = path.join(fixtureDir, 'hlg.mp4')
    // A test pattern viewed through a window that jitters, with a tone for audio.
    const shake = 'testsrc2=s=400x300:r=30:d=3,crop=320:240:40+30*sin(t*23):30+20*cos(t*19)'
    const make = (out: string, extra: string[], vf = shake) => {
      const res = spawnSync(ffmpegPath!, ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', vf, '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest', ...extra, out])
      if (res.status !== 0) throw new Error(String(res.stderr))
    }
    make(shakyClip, ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
    make(hlgClip, ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error',
      '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-c:a', 'aac'])
  }, 60_000)

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaila-stab-cache-'))
    service = new StabilizeService(cacheDir)
    events.length = 0
    vi.spyOn(eventEmitter, 'emitToRenderer').mockImplementation((channel, payload) => {
      if (channel === 'stabilize:progress') events.push(payload as Progress)
    })
  })

  afterEach(() => {
    service.cancelAll()
    vi.restoreAllMocks()
    try { fs.rmSync(cacheDir, { recursive: true, force: true }) } catch {}
  })

  const params = (overrides: Partial<StabilizeStartParams> = {}): StabilizeStartParams => ({
    jobId: 'job-1',
    assetId: 'asset-1',
    filePath: shakyClip,
    sourceStart: 0.5,
    sourceSpan: 2,
    smoothing: 20,
    mode: 'auto',
    ...overrides,
  })

  const finished = (jobId: string) => new Promise<Progress>((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      const end = events.find(e => e.jobId === jobId && (e.phase === 'done' || e.phase === 'error' || e.phase === 'cancelled'))
      if (end) { clearInterval(poll); resolve(end) }
      if (Date.now() - started > 55_000) { clearInterval(poll); reject(new Error('timed out')) }
    }, 50)
  })

  it('bakes a stabilized copy of the range, then serves it from cache', async () => {
    expect(await service.start(params())).toEqual({ started: true })
    const done = await finished('job-1')
    expect(done.phase).toBe('done')

    const bake = done.bake!
    expect(bake.sourceStart).toBe(0.5)
    expect(bake.sourceSpan).toBe(2)
    expect(bake.assetKey).toBe('asset-1')
    expect(bake.fingerprint).toMatch(/^stab_[0-9a-f]{16}_500_2000$/)
    expect(bake.zoomPercent).toBeGreaterThan(0)
    expect(fs.statSync(bake.path).size).toBeGreaterThan(0)
    expect(fs.existsSync(bake.path.replace(/\.mp4$/, '.json'))).toBe(true)

    // Progress ran through both passes, ending at 100.
    const phases = events.filter(e => e.jobId === 'job-1').map(e => e.phase)
    expect(phases).toContain('analyzing')
    expect(phases).toContain('stabilizing')
    expect(done.percent).toBe(100)

    // Covers the requested range, with picture and sound.
    const probe = spawnSync(ffmpegPath!, ['-hide_banner', '-i', bake.path], { encoding: 'utf8' }).stderr
    const info = parseSourceInfo(probe)
    expect(info.duration).toBeGreaterThan(1.9)
    expect(info.duration).toBeLessThan(2.2)
    expect(info.width).toBe(320)
    expect(probe).toContain('Audio: aac')

    // Nothing left behind but the bake and its sidecar.
    expect(fs.readdirSync(cacheDir).filter(n => n !== 'work').sort()).toEqual(
      [path.basename(bake.path), path.basename(bake.path).replace(/\.mp4$/, '.json')].sort(),
    )

    // The same request is answered from disk without running ffmpeg again.
    const again = await service.start(params({ jobId: 'job-2', assetId: 'asset-9' }))
    expect(again.cached).toBe(true)
    expect(again.bake?.path).toBe(bake.path)
    expect(again.bake?.assetKey).toBe('asset-9')
  }, 60_000)

  it('shares one run between identical requests', async () => {
    service.start(params({ jobId: 'a' }))
    service.start(params({ jobId: 'b' }))
    const [a, b] = await Promise.all([finished('a'), finished('b')])
    expect(a.phase).toBe('done')
    expect(b.phase).toBe('done')
    expect(a.bake?.path).toBe(b.bake?.path)
  }, 60_000)

  it('cancels a running job and leaves no partial file', async () => {
    await service.start(params({ jobId: 'c' }))
    expect(service.cancel('c')).toBe(true)
    const end = await finished('c')
    expect(end.phase).toBe('cancelled')
    // Let the killed process exit and the cleanup run.
    await new Promise(r => setTimeout(r, 500))
    expect(fs.readdirSync(cacheDir).filter(n => n.endsWith('.mp4'))).toEqual([])
  }, 30_000)

  it('cancels a job whose source is still being probed, before it ever runs', async () => {
    const starting = service.start(params({ jobId: 'early' }))
    expect(service.cancel('early')).toBe(true)
    expect(await starting).toEqual({ started: false, error: 'Cancelled' })
    expect(events.filter(e => e.jobId === 'early').map(e => e.phase)).toEqual(['cancelled'])
    expect(service.status('early').status).not.toBe('running')
  })

  it('refuses a range with nothing in it, or a missing file', async () => {
    expect((await service.start(params({ sourceSpan: 0 }))).started).toBe(false)
    expect((await service.start(params({ filePath: path.join(fixtureDir, 'nope.mp4') }))).error).toMatch(/not found/)
  })

  it.each(['sdr', 'hevc'] as const)('bakes an HLG source with hdrOutput=%s', async hdrOutput => {
    service.start(params({ jobId: `hdr-${hdrOutput}`, filePath: hlgClip, hdrOutput }))
    const done = await finished(`hdr-${hdrOutput}`)
    expect(done.phase, done.error).toBe('done')
    const probe = spawnSync(ffmpegPath!, ['-hide_banner', '-i', done.bake!.path], { encoding: 'utf8' }).stderr
    if (hdrOutput === 'hevc') {
      expect(probe).toMatch(/Video: hevc/)
      expect(parseSourceInfo(probe).hdrTransfer).toBe('arib-std-b67')
    } else {
      expect(probe).toMatch(/Video: h264/)
      expect(parseSourceInfo(probe).hdrTransfer).toBeNull()
    }
  }, 60_000)
})
