import { parseCubeLut, type CubeLut } from '@core/lut'

const lutCache = new Map<string, Promise<CubeLut>>()

/**
 * Loads and parses a 3D LUT by filterId.
 * Automatically tries HTTP fetch first (/luts/<id>.cube),
 * falling back to the Electron IPC getLutContent bridge.
 */
export function loadLut(filterId: string): Promise<CubeLut> {
  const cached = lutCache.get(filterId)
  if (cached) return cached

  const promise = (async () => {
    let cubeContent = ''

    // 1. Try browser fetch from /luts/<id>.cube
    try {
      const url = `/luts/${filterId}.cube`
      const res = await fetch(url)
      if (res.ok) {
        cubeContent = await res.text()
      }
    } catch {
      // ignore and fallback to IPC
    }

    // 2. Fallback to Electron IPC if fetch was unsuccessful or empty
    if (!cubeContent && typeof window !== 'undefined' && (window as any).electronAPI?.getLutContent) {
      try {
        const ipcRes = await (window as any).electronAPI.getLutContent({ filterId })
        if (ipcRes?.success && ipcRes.content) {
          cubeContent = ipcRes.content
        }
      } catch {
        // ignore
      }
    }

    if (!cubeContent) {
      throw new Error(`Failed to load LUT file for filter '${filterId}'`)
    }

    return parseCubeLut(cubeContent)
  })()

  lutCache.set(filterId, promise)
  return promise
}

export function clearLutCache(): void {
  lutCache.clear()
}
