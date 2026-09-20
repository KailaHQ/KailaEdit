import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { RenderCacheManager } from '../render-cache-manager'
import * as eventEmitter from '../../ipc/event-emitter'
import { resolveUserDataDir } from '../../../core/src/app-paths'

describe('RenderCacheManager', () => {
  let tempDir: string
  let manager: RenderCacheManager
  const emittedEvents: Array<{ channel: string; payload: any }> = []

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `komfy-test-rcache-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    manager = new RenderCacheManager(tempDir)
    // The app brings the cache directory up to the current format at startup, before
    // anything reads or writes a segment. These tests write segments by hand, so they
    // have to sit on the same side of that migration.
    manager.init()
    emittedEvents.length = 0

    vi.spyOn(eventEmitter, 'emitToRenderer').mockImplementation((channel, payload) => {
      emittedEvents.push({ channel, payload })
    })
  })

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch {}
    vi.restoreAllMocks()
  })

  it('cleans up interrupted .part files and 0-byte files on startup', () => {
    const partFile = path.join(tempDir, 'segment_abc.mp4.part')
    const corruptFile = path.join(tempDir, 'segment_empty.mp4')
    const validFile = path.join(tempDir, 'segment_valid.mp4')

    fs.writeFileSync(partFile, 'incomplete partial render')
    fs.writeFileSync(corruptFile, '') // 0 bytes
    fs.writeFileSync(validFile, 'valid rendered video bytes')

    expect(fs.existsSync(partFile)).toBe(true)
    expect(fs.existsSync(corruptFile)).toBe(true)
    expect(fs.existsSync(validFile)).toBe(true)

    manager.cleanupInterruptedFiles()

    expect(fs.existsSync(partFile)).toBe(false)
    expect(fs.existsSync(corruptFile)).toBe(false)
    expect(fs.existsSync(validFile)).toBe(true)
  })

  it('reports hasCache and getCachePath accurately', () => {
    const hash = 'f00ba41234567890'
    expect(manager.hasCache(hash)).toBe(false)
    expect(manager.getCachePath(hash)).toBeNull()

    const targetFile = manager.getSegmentPath(hash)
    fs.writeFileSync(targetFile, 'pre-rendered video data')

    expect(manager.hasCache(hash)).toBe(true)
    expect(manager.getCachePath(hash)).toBe(targetFile)
  })

  it('checks multiple hashes at once with checkHashes', () => {
    const hash1 = '1111222233334444'
    const hash2 = '5555666677778888'

    fs.writeFileSync(manager.getSegmentPath(hash1), 'rendered clip')

    const statusMap = manager.checkHashes([hash1, hash2])
    expect(statusMap[hash1]).toEqual({
      ready: true,
      path: manager.getSegmentPath(hash1),
    })
    expect(statusMap[hash2]).toEqual({
      ready: false,
    })
  })

  it('returns existing cache without spawning job if segment already cached', async () => {
    const hash = 'cached123'
    fs.writeFileSync(manager.getSegmentPath(hash), 'already done')

    const result = await manager.renderSegment({
      hash,
      startTime: 0,
      duration: 5,
      clips: [],
    })

    expect(result.success).toBe(true)
    expect(result.cachePath).toBe(manager.getSegmentPath(hash))
  })

  it('clears all cache files and returns freed bytes', () => {
    const file1 = path.join(tempDir, 'segment_1.mp4')
    const file2 = path.join(tempDir, 'segment_2.mp4')
    fs.writeFileSync(file1, '12345')
    fs.writeFileSync(file2, '67890')

    const freed = manager.clearCache()
    expect(freed).toBe(10)
    expect(fs.existsSync(file1)).toBe(false)
    expect(fs.existsSync(file2)).toBe(false)
  })

  it('resolves default cache dir under resolveUserDataDir() when Electron app is not available', () => {
    const defaultManager = new RenderCacheManager()
    const resolvedDir = defaultManager.getCacheDir()
    const expectedDir = path.join(resolveUserDataDir(), 'render-cache')
    expect(resolvedDir).toBe(expectedDir)
    expect(fs.existsSync(resolvedDir)).toBe(true)
  })
})

/**
 * Added 18/09/2026, after twelve segment renders in one session produced no cache at all.
 *
 * The part file was named `segment_<hash>.mp4.part` and handed to ffmpeg as its output.
 * ffmpeg chooses its muxer from the extension, does not know `.part`, and refused the
 * file before writing a byte — "Error opening output file". The failure was silent on
 * both sides, so the only visible symptom was the render cache never filling and the same
 * segment being rendered over and over.
 */
describe('RenderCacheManager: paths ffmpeg can actually write', () => {
  let tempDir: string
  let manager: RenderCacheManager

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `komfy-test-rcache-ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    manager = new RenderCacheManager(tempDir)
  })

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  })

  it('gives the part file a container extension, not a trailing .part', () => {
    const partPath = manager.getPartPath('deadbeef')
    expect(path.extname(partPath)).toBe('.mp4')
    expect(partPath.endsWith('.part')).toBe(false)
    expect(partPath).toContain('.part.')
  })

  it('keeps the part file distinguishable from the finished segment', () => {
    expect(manager.getPartPath('deadbeef')).not.toBe(manager.getSegmentPath('deadbeef'))
  })

  it('still recognises a part file as incomplete and clears it on startup', () => {
    const partPath = manager.getPartPath('deadbeef')
    fs.writeFileSync(partPath, 'half a render')
    manager.cleanupInterruptedFiles()
    expect(fs.existsSync(partPath)).toBe(false)
  })

  it('clears part files left by the previous naming too', () => {
    const legacyPart = path.join(tempDir, 'segment_old.mp4.part')
    fs.writeFileSync(legacyPart, 'half a render')
    manager.cleanupInterruptedFiles()
    expect(fs.existsSync(legacyPart)).toBe(false)
  })
})

/**
 * Segments written before the `.part` fix cannot have come from the renderer as it stands
 * now, so what they contain is unknown — and a wrong segment is played back as if it were
 * the picture. They go once, and the marker keeps it to once.
 */
describe('RenderCacheManager: one-time migration of an older cache', () => {
  let tempDir: string
  let manager: RenderCacheManager

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `komfy-test-rcache-mig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    manager = new RenderCacheManager(tempDir)
  })

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  })

  it('drops every segment and matte it cannot vouch for, and leaves the rest alone', () => {
    // v3 also drops mattes that look current: until the probe accounted for a rotated
    // source, a portrait clip was baked squashed into landscape, and a matte's name says
    // nothing about which reading of the media produced it.
    const staleSegment = path.join(tempDir, 'segment_03aff5f2f702a96b.mp4')
    const legacyMatte = path.join(tempDir, 'matte_0123456789abcdef.mp4')
    const rangedMatte = path.join(tempDir, 'matte_0123456789abcdef_0_30000.mp4')
    const customMatte = path.join(tempDir, 'custom_matte_clip-1_abcdef.mp4')
    const unrelated = path.join(tempDir, 'something-else.txt')
    for (const f of [staleSegment, legacyMatte, rangedMatte, customMatte, unrelated]) {
      fs.writeFileSync(f, 'x'.repeat(2000))
    }

    manager.init()

    expect(fs.existsSync(staleSegment)).toBe(false)
    expect(fs.existsSync(legacyMatte)).toBe(false)
    expect(fs.existsSync(rangedMatte)).toBe(false)
    expect(fs.existsSync(customMatte)).toBe(false)
    expect(fs.existsSync(unrelated)).toBe(true)
  })

  it('does not run a second time', () => {
    manager.init()

    const freshSegment = path.join(tempDir, 'segment_new.mp4')
    fs.writeFileSync(freshSegment, 'x'.repeat(2000))

    const second = new RenderCacheManager(tempDir)
    second.init()

    expect(fs.existsSync(freshSegment)).toBe(true)
  })
})
