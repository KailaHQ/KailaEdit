export type TimecodeDisplayFormat = 'timecode' | 'frames'

/**
 * Format seconds for the timeline ruler labels: MM:SS, rolling over to H:MM:SS
 * past the hour. `withTenths` adds a decimal when the tick spacing is sub-second,
 * otherwise consecutive labels would render identically.
 * When format is 'frames', formats as the integer frame index.
 */
export function formatRulerTime(
  seconds: number,
  withTenths = false,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): string {
  if (format === 'frames') {
    return Math.round(seconds * fps).toString()
  }
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const base = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  const stamp = hrs > 0 ? `${hrs}:${base}` : base
  if (!withTenths) return stamp
  return `${stamp}.${Math.round((seconds % 1) * 10)}`
}

/** Format seconds into HH:MM:SS:FF timecode or integer frame count */
export function formatTime(
  seconds: number,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): string {
  if (format === 'frames') {
    return Math.round(seconds * fps).toString()
  }
  const validFps = fps > 0 ? fps : 24
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const frames = Math.floor((seconds % 1) * validFps)
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

/** Parse HH:MM:SS:FF timecode string or frame number back to seconds */
export function parseTime(
  tc: string,
  fps = 24,
  format: TimecodeDisplayFormat = 'timecode',
): number | null {
  const trimmed = tc.trim()
  const validFps = fps > 0 ? fps : 24

  // Check if string is a pure frame count (e.g. "120" or "120f" or format === 'frames')
  if (/^\d+f?$/i.test(trimmed)) {
    const rawVal = parseInt(trimmed.replace(/f/i, ''), 10)
    if (!isNaN(rawVal)) {
      return format === 'frames' || trimmed.toLowerCase().endsWith('f')
        ? rawVal / validFps
        : rawVal
    }
  }

  const cleaned = trimmed.replace(/[^0-9:;]/g, '').replace(/;/g, ':')
  const parts = cleaned.split(':')
  if (parts.length === 4) {
    const hrs = parseInt(parts[0], 10)
    const mins = parseInt(parts[1], 10)
    const secs = parseInt(parts[2], 10)
    const frames = parseInt(parts[3], 10)
    if (isNaN(hrs) || isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return hrs * 3600 + mins * 60 + secs + frames / validFps
  }
  if (parts.length === 3) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    const frames = parseInt(parts[2], 10)
    if (isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return mins * 60 + secs + frames / validFps
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    if (isNaN(mins) || isNaN(secs)) return null
    return mins * 60 + secs
  }
  if (parts.length === 1) {
    const secs = parseInt(parts[0], 10)
    if (isNaN(secs)) return null
    return format === 'frames' ? secs / validFps : secs
  }
  return null
}
