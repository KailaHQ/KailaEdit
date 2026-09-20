import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import { resolveUserDataDir } from '../core/src/app-paths'
import { renderCacheManager, RenderCacheManager } from '../electron/export/render-cache-manager'
import { proxyManager, ProxyManager } from '../electron/export/proxy-manager'

describe('KE-1002: Unified Cache Directory Parity (App & MCP Server)', () => {
  it('ensures RenderCacheManager default cache directory matches resolveUserDataDir()/render-cache', () => {
    const expected = path.join(resolveUserDataDir(), 'render-cache')
    const actual = renderCacheManager.getCacheDir()
    expect(actual).toBe(expected)
    expect(new RenderCacheManager().getCacheDir()).toBe(expected)
  })

  it('ensures ProxyManager default proxy directory matches resolveUserDataDir()/proxy-cache', () => {
    const expected = path.join(resolveUserDataDir(), 'proxy-cache')
    const actual = proxyManager.getProxyDir()
    expect(actual).toBe(expected)
    expect(new ProxyManager().getProxyDir()).toBe(expected)
  })

  it('verifies MCP server and App share identical cache: a segment written by App is readable by MCP', () => {
    // Both App and MCP server import the singleton renderCacheManager
    const testHash = `parity-test-${Date.now()}`
    const segmentPath = renderCacheManager.getSegmentPath(testHash)

    // Verify the segment path is strictly within the resolveUserDataDir() tree
    expect(segmentPath).toBe(path.join(resolveUserDataDir(), 'render-cache', `segment_${testHash}.mp4`))

    try {
      // Simulate app pre-rendering a segment
      fs.writeFileSync(segmentPath, 'pre-rendered-parity-mp4-data')

      // MCP server uses renderCacheManager.getCachePath(hash)
      const mcpFoundPath = renderCacheManager.getCachePath(testHash)
      expect(mcpFoundPath).toBe(segmentPath)
      expect(renderCacheManager.hasCache(testHash)).toBe(true)

      // Content read by MCP matches what was written
      const readContent = fs.readFileSync(mcpFoundPath!, 'utf-8')
      expect(readContent).toBe('pre-rendered-parity-mp4-data')
    } finally {
      if (fs.existsSync(segmentPath)) {
        fs.unlinkSync(segmentPath)
      }
    }
  })
})
