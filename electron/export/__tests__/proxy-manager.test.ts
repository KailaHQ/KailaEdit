import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ProxyManager } from '../proxy-manager'
import * as eventEmitter from '../../ipc/event-emitter'
import { selectClipPathFromAssets } from '../../../core/src/editor-selectors'
import type { Asset, TimelineClip } from '../../../core/src/project-model'
import { resolveUserDataDir } from '../../../core/src/app-paths'

describe('ProxyManager', () => {
  let tempDir: string
  let manager: ProxyManager
  const emittedEvents: Array<{ channel: string; payload: any }> = []

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `komfy-test-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    fs.mkdirSync(tempDir, { recursive: true })
    manager = new ProxyManager(tempDir)
    emittedEvents.length = 0

    vi.spyOn(eventEmitter, 'emitToRenderer').mockImplementation((channel, payload) => {
      emittedEvents.push({ channel, payload })
    })
  })

  afterEach(() => {
    manager.cancelAll()
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch {}
    vi.restoreAllMocks()
  })

  it('cleans up interrupted .part files and 0-byte files on startup', () => {
    const partFile = path.join(tempDir, 'asset-1_540p.mp4.part')
    const corruptFile = path.join(tempDir, 'asset-2_540p.mp4')
    const validFile = path.join(tempDir, 'asset-3_540p.mp4')

    fs.writeFileSync(partFile, 'incomplete data')
    fs.writeFileSync(corruptFile, '') // 0 bytes
    fs.writeFileSync(validFile, 'valid video data')

    expect(fs.existsSync(partFile)).toBe(true)
    expect(fs.existsSync(corruptFile)).toBe(true)
    expect(fs.existsSync(validFile)).toBe(true)

    manager.cleanupInterruptedFiles()

    expect(fs.existsSync(partFile)).toBe(false)
    expect(fs.existsSync(corruptFile)).toBe(false)
    expect(fs.existsSync(validFile)).toBe(true)
  })

  it('reports status correctly before and after proxy generation', () => {
    const initial = manager.getProxyStatus('asset-x')
    expect(initial.status).toBe('none')
    expect(initial.progress).toBe(0)

    const proxyPath = manager.getProxyPath('asset-x')
    fs.writeFileSync(proxyPath, 'video content')

    const ready = manager.getProxyStatus('asset-x')
    expect(ready.status).toBe('ready')
    expect(ready.progress).toBe(100)
    expect(ready.proxyPath).toBe(proxyPath)
  })

  it('cancels queued and in-flight proxy jobs cleanly', async () => {
    const fakeVideo = path.join(tempDir, 'source.mp4')
    fs.writeFileSync(fakeVideo, 'source content')

    // Start a proxy generation
    const promise = manager.enqueueProxy('asset-cancel-test', fakeVideo)
    manager.cancelProxy('asset-cancel-test')

    const res = await promise
    expect(res.success).toBe(false)

    // Part file should not linger
    const partPath = manager.getPartPath('asset-cancel-test')
    expect(fs.existsSync(partPath)).toBe(false)
  })

  it('clearProxies deletes all proxy files and returns freed bytes', () => {
    const f1 = path.join(tempDir, 'a1_540p.mp4')
    const f2 = path.join(tempDir, 'a2_540p.mp4')
    fs.writeFileSync(f1, '12345')
    fs.writeFileSync(f2, '67890')

    const freed = manager.clearProxies()
    expect(freed).toBe(10)
    expect(fs.existsSync(f1)).toBe(false)
    expect(fs.existsSync(f2)).toBe(false)
  })

  it('invariant: export clip path selector ALWAYS returns original asset.path, never proxyPath', () => {
    const testAsset: Asset = {
      id: 'asset-video-1',
      type: 'video',
      path: '/path/to/original/4k_video.mp4',
      proxyPath: '/path/to/cache/asset-video-1_540p.mp4',
      proxyStatus: 'ready',
      prompt: '',
      resolution: '3840x2160',
      createdAt: Date.now(),
    }

    const testClip = {
      id: 'clip-1',
      type: 'video',
      assetId: 'asset-video-1',
      asset: testAsset,
      startTime: 0,
      duration: 10,
      trimStart: 0,
      trimEnd: 0,
      trackIndex: 0,
      speed: 1,
      volume: 1,
      muted: false,
    } as any as TimelineClip

    // Exporter uses selectClipPathFromAssets:
    const exportPath = selectClipPathFromAssets([testAsset], testClip)
    expect(exportPath).toBe('/path/to/original/4k_video.mp4')
    expect(exportPath).not.toBe(testAsset.proxyPath)
  })

  it('resolves default proxy dir under resolveUserDataDir() when Electron app is not available', () => {
    const defaultManager = new ProxyManager()
    const resolvedDir = defaultManager.getProxyDir()
    const expectedDir = path.join(resolveUserDataDir(), 'proxy-cache')
    expect(resolvedDir).toBe(expectedDir)
    expect(fs.existsSync(resolvedDir)).toBe(true)
  })
})
