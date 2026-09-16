export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
  upToDate?: boolean
}

export type UpdateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_UNSUPPORTED' }
  | { type: 'UPDATE_AVAILABLE'; version: string }
  | { type: 'UPDATE_NOT_AVAILABLE' }
  | { type: 'START_DOWNLOAD' }
  | {
      type: 'DOWNLOAD_PROGRESS'
      percent: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
    }
  | { type: 'UPDATE_DOWNLOADED'; version?: string }
  | { type: 'UPDATE_ERROR'; error: string }
  | { type: 'RESET' }

export function getInitialUpdateState(isSupported = true): UpdateState {
  return {
    status: isSupported ? 'idle' : 'unsupported',
  }
}

/**
 * Pure reducer for updater state transitions.
 * Guarantees that known versions are preserved when an error occurs mid-download.
 */
export function reduceUpdateState(current: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case 'START_CHECK':
      if (current.status === 'unsupported') {
        return { status: 'unsupported' }
      }
      return {
        status: 'checking',
        version: current.version,
        error: undefined,
        upToDate: false,
      }

    case 'CHECK_UNSUPPORTED':
      return {
        status: 'unsupported',
      }

    case 'UPDATE_AVAILABLE':
      return {
        status: 'available',
        version: action.version,
        error: undefined,
        upToDate: false,
      }

    case 'UPDATE_NOT_AVAILABLE':
      return {
        status: 'idle',
        version: undefined,
        error: undefined,
        upToDate: true,
      }

    case 'START_DOWNLOAD':
      return {
        ...current,
        status: 'downloading',
        percent: 0,
        error: undefined,
      }

    case 'DOWNLOAD_PROGRESS':
      return {
        ...current,
        status: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(action.percent * 10) / 10)),
        bytesPerSecond: action.bytesPerSecond ?? current.bytesPerSecond,
        transferred: action.transferred ?? current.transferred,
        total: action.total ?? current.total,
        error: undefined,
      }

    case 'UPDATE_DOWNLOADED':
      return {
        ...current,
        status: 'downloaded',
        version: action.version ?? current.version,
        percent: 100,
        error: undefined,
      }

    case 'UPDATE_ERROR':
      return {
        ...current,
        status: 'error',
        error: action.error,
      }

    case 'RESET':
      return {
        status: current.status === 'unsupported' ? 'unsupported' : 'idle',
      }

    default:
      return current
  }
}

/**
 * Format bytes per second into human-readable rate (e.g. "12.4 MB/s" or "850 KB/s").
 */
export function formatDownloadSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0 || !Number.isFinite(bytesPerSecond)) {
    return '0 B/s'
  }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let val = bytesPerSecond
  let unitIndex = 0
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024
    unitIndex++
  }
  if (unitIndex === 0) {
    return `${Math.round(val)} B/s`
  }
  const formatted = val % 1 === 0 ? String(val) : val.toFixed(1)
  return `${formatted} ${units[unitIndex]}`
}
