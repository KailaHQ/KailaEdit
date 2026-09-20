/**
 * Shared helpers and types for the FCP7 and FCPXML parsers.
 *
 * These are internal implementation details of `timeline-import.ts` and should
 * not be imported directly from outside the parsers package.
 */

// ─── Intermediate representation of a parsed timeline ──────────────────────
export interface ParsedMediaRef {
  id: string
  name: string
  path: string           // Effective local file path used for import
  bigThumbnailPath?: string
  smallThumbnailPath?: string
  duration: number       // in seconds
  type: 'video' | 'audio' | 'image'
  width?: number
  height?: number
  fps?: number
}

export interface ParsedClip {
  name: string
  mediaRefId: string     // references a ParsedMediaRef
  trackIndex: number
  trackType: 'video' | 'audio'
  startTime: number      // position on timeline in seconds
  duration: number       // duration on timeline in seconds
  sourceIn: number       // source in point in seconds
  sourceOut: number      // source out point in seconds
  speed?: number         // playback speed multiplier (1 = normal, 2 = 2x, 0.5 = half)
  reversed?: boolean     // true if clip is playing in reverse
  volume?: number        // audio volume 0-1
  muted?: boolean        // true if audio is muted / clip is disabled
  flipH?: boolean        // horizontal flip
  flipV?: boolean        // vertical flip
  opacity?: number       // opacity 0-100 (100 = fully visible)
  linkedVideoClipIndex?: number  // For audio clips: index of the matching video clip in the clips array (for establishing links)
}

export interface ParsedTimeline {
  name: string
  fps: number
  duration: number       // total duration in seconds
  width?: number
  height?: number
  videoTrackCount: number
  audioTrackCount: number
  mediaRefs: ParsedMediaRef[]
  clips: ParsedClip[]
  format: 'fcp7xml' | 'fcpxml' | 'unknown'
}

// ─── Helper: decode pathurl to local file path ─────────────────────────────
export function decodePathUrl(pathUrl: string): string {
  if (!pathUrl) return ''
  
  let decoded = pathUrl.trim()
  
  // Remove file:// or file:/// or file://localhost/ prefix
  decoded = decoded
    .replace(/^file:\/\/localhost\//i, '/')
    .replace(/^file:\/\/\//i, '/')
    .replace(/^file:\/\//i, '/')
  
  // URL decode
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // ignore decode errors
  }
  
  // On Windows, paths start with /C: → remove leading slash
  if (/^\/[A-Za-z]:/.test(decoded)) {
    decoded = decoded.slice(1)
  }
  
  // Normalize slashes to OS-appropriate
  if (typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win')) {
    decoded = decoded.replace(/\//g, '\\')
  }
  
  return decoded
}

// ─── Helper: get text content of a child element ───────────────────────────
export function getChildText(parent: Element, tagName: string): string {
  const el = parent.querySelector(`:scope > ${tagName}`)
  return el?.textContent?.trim() || ''
}

export function getChildNumber(parent: Element, tagName: string): number {
  const text = getChildText(parent, tagName)
  return text ? parseFloat(text) : 0
}

// ─── Helper: get timebase (fps) from a rate element ────────────────────────
export function getTimebase(parent: Element): number | null {
  const rateEl = parent.querySelector(':scope > rate')
  if (!rateEl) return null
  const tb = getChildNumber(rateEl, 'timebase')
  const ntsc = getChildText(rateEl, 'ntsc').toLowerCase() === 'true'
  // NTSC drop-frame: 30 → 29.97, 24 → 23.976, 60 → 59.94
  if (ntsc && tb > 0) {
    return tb * (1000 / 1001)
  }
  return tb || null
}

// ─── Helper: detect media type from file extension ─────────────────────────
export function detectMediaType(filename: string): 'video' | 'audio' | 'image' {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mxf', 'r3d', 'braw', 'ari']
  const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'aiff', 'aif']
  const imageExts = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'gif', 'webp', 'exr', 'dpx', 'psd']
  
  if (audioExts.includes(ext)) return 'audio'
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  return 'video' // default
}

// ─── Shared effect struct ──────────────────────────────────────────────────
export interface ParsedClipEffects {
  speed: number
  reversed: boolean
  flipH: boolean
  flipV: boolean
  opacity: number  // 0-100
  muted: boolean
}
