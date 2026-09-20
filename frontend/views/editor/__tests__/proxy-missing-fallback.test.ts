import { describe, it, expect } from 'vitest'
import { resolveClipPathFromAssets } from '../preview/preview-frame-engine'
import type { Asset, TimelineClip } from '../../../types/project-model'

/**
 * What the preview plays when a proxy has gone missing.
 *
 * A project stores `proxyStatus: 'ready'` and a `proxyPath` alongside each video asset,
 * and `resolveClipPathFromAssets` hands that path straight to the <video> element. The
 * path points into a cache that can be cleared from Settings, evicted, or left behind
 * when the app's data directory moves — and when it is gone the element fails with
 * ERR_FILE_NOT_FOUND, never reaches readyState 2, and the monitor goes black with no
 * error surfaced anywhere in the app.
 *
 * The audit in useProxyManager used to `continue` past any asset that claimed to be
 * ready, so a stale claim was never checked against disk. It now verifies once per
 * session and clears the claim when the file is gone; these are the two states that
 * resolution has to get right for that recovery to work.
 */
function asset(over: Partial<Asset>): Asset {
  return {
    id: 'asset-1',
    type: 'video',
    path: 'C:\\media\\original.mov',
    ...over,
  } as Asset
}

const clip = { id: 'c1', assetId: 'asset-1' } as TimelineClip

describe('clip path resolution when a proxy is missing', () => {
  it('uses the proxy while the asset legitimately claims one', () => {
    const assets = [asset({ proxyPath: 'C:\\cache\\a_540p.mp4', proxyStatus: 'ready' })]
    expect(resolveClipPathFromAssets(assets, clip, true)).toBe('C:\\cache\\a_540p.mp4')
  })

  it('falls back to the original once the stale claim is cleared', () => {
    // What the audit leaves behind after it finds the file gone.
    const assets = [asset({ proxyPath: undefined, proxyStatus: 'none' })]
    expect(resolveClipPathFromAssets(assets, clip, true)).toBe('C:\\media\\original.mov')
  })

  it('ignores the proxy entirely when the setting is off', () => {
    const assets = [asset({ proxyPath: 'C:\\cache\\a_540p.mp4', proxyStatus: 'ready' })]
    expect(resolveClipPathFromAssets(assets, clip, false)).toBe('C:\\media\\original.mov')
  })

  it('never resolves to an empty path for an asset that has media', () => {
    for (const proxyEnabled of [true, false]) {
      for (const proxyPath of ['C:\\cache\\a_540p.mp4', undefined]) {
        const assets = [asset({ proxyPath, proxyStatus: proxyPath ? 'ready' : 'none' })]
        expect(resolveClipPathFromAssets(assets, clip, proxyEnabled)).not.toBe('')
      }
    }
  })
})
