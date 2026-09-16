import { describe, it, expect } from 'vitest'
import {
  getInitialUpdateState,
  reduceUpdateState,
  formatDownloadSpeed,
  type UpdateState,
} from '../src/update-state'

describe('KE-1301: Updater pure state machine', () => {
  it('initializes to idle when supported, unsupported when not', () => {
    expect(getInitialUpdateState(true)).toEqual({ status: 'idle' })
    expect(getInitialUpdateState(false)).toEqual({ status: 'unsupported' })
  })

  it('handles standard check -> available -> download -> downloaded flow', () => {
    let state: UpdateState = getInitialUpdateState(true)

    // Checking
    state = reduceUpdateState(state, { type: 'START_CHECK' })
    expect(state.status).toBe('checking')

    // Available
    state = reduceUpdateState(state, { type: 'UPDATE_AVAILABLE', version: '1.0.5' })
    expect(state.status).toBe('available')
    expect(state.version).toBe('1.0.5')

    // Start download
    state = reduceUpdateState(state, { type: 'START_DOWNLOAD' })
    expect(state.status).toBe('downloading')
    expect(state.version).toBe('1.0.5')
    expect(state.percent).toBe(0)

    // Progress updates
    state = reduceUpdateState(state, {
      type: 'DOWNLOAD_PROGRESS',
      percent: 42.3,
      bytesPerSecond: 12_400_000,
      transferred: 42_000_000,
      total: 100_000_000,
    })
    expect(state.status).toBe('downloading')
    expect(state.percent).toBe(42.3)
    expect(state.bytesPerSecond).toBe(12_400_000)

    // Downloaded
    state = reduceUpdateState(state, { type: 'UPDATE_DOWNLOADED' })
    expect(state.status).toBe('downloaded')
    expect(state.version).toBe('1.0.5')
    expect(state.percent).toBe(100)
  })

  it('preserves known version when error occurs mid-download', () => {
    let state: UpdateState = {
      status: 'downloading',
      version: '1.0.5',
      percent: 65,
      bytesPerSecond: 5_000_000,
    }

    state = reduceUpdateState(state, {
      type: 'UPDATE_ERROR',
      error: 'Network connection lost',
    })

    expect(state.status).toBe('error')
    expect(state.error).toBe('Network connection lost')
    expect(state.version).toBe('1.0.5') // Critical requirement: known version is not wiped!

    // If we restart check from error state, it should keep the known version
    state = reduceUpdateState(state, { type: 'START_CHECK' })
    expect(state.status).toBe('checking')
    expect(state.version).toBe('1.0.5')
    expect(state.error).toBeUndefined()
  })

  it('handles update-not-available returning to idle', () => {
    let state: UpdateState = { status: 'checking' }
    state = reduceUpdateState(state, { type: 'UPDATE_NOT_AVAILABLE' })
    expect(state.status).toBe('idle')
    expect(state.version).toBeUndefined()
  })

  it('stays unsupported on check if originally unsupported', () => {
    let state: UpdateState = { status: 'unsupported' }
    state = reduceUpdateState(state, { type: 'START_CHECK' })
    expect(state.status).toBe('unsupported')
  })

  it('clamps download percent between 0 and 100', () => {
    let state: UpdateState = { status: 'downloading', percent: 0 }
    state = reduceUpdateState(state, { type: 'DOWNLOAD_PROGRESS', percent: -5 })
    expect(state.percent).toBe(0)

    state = reduceUpdateState(state, { type: 'DOWNLOAD_PROGRESS', percent: 105 })
    expect(state.percent).toBe(100)
  })

  it('formats download speeds correctly', () => {
    expect(formatDownloadSpeed(0)).toBe('0 B/s')
    expect(formatDownloadSpeed(undefined)).toBe('0 B/s')
    expect(formatDownloadSpeed(800)).toBe('800 B/s')
    expect(formatDownloadSpeed(1024 * 50)).toBe('50 KB/s')
    expect(formatDownloadSpeed(12_400_000)).toBe('11.8 MB/s')
  })
})
