import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('KE-1301: Fake updater end-to-end simulation flow', () => {
  beforeEach(() => {
    process.env.KOMFYEDIT_FAKE_UPDATE = '1'
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.KOMFYEDIT_FAKE_UPDATE
  })

  it('verifies full available -> download -> downloaded flow with KOMFYEDIT_FAKE_UPDATE=1', async () => {
    // Mock event-emitter and window to capture events
    const emittedEvents: Array<{ channel: string; payload: any }> = []

    vi.doMock('../electron/ipc/event-emitter', () => ({
      emitToRenderer: (channel: string, payload: any) => {
        emittedEvents.push({ channel, payload })
      },
    }))

    vi.doMock('../electron/window', () => ({
      getMainWindow: () => ({
        setProgressBar: vi.fn(),
      }),
    }))

    const {
      isUpdateSupported,
      getUpdateState,
      checkForUpdatesManually,
      downloadUpdate,
      installNow,
    } = await import('../electron/updater')

    expect(isUpdateSupported()).toBe(true)

    // Manual check -> available
    vi.useFakeTimers()
    const checkPromise = checkForUpdatesManually()
    expect(getUpdateState().status).toBe('checking')

    vi.advanceTimersByTime(1500)
    await checkPromise

    const availableState = getUpdateState()
    expect(availableState.status).toBe('available')
    expect(availableState.version).toBe('1.0.5')

    // Start download
    const downloadRes = await downloadUpdate()
    expect(downloadRes.success).toBe(true)
    expect(getUpdateState().status).toBe('downloading')

    // Advance download progress (ticks every 200ms)
    vi.advanceTimersByTime(2000)
    expect(getUpdateState().status).toBe('downloading')
    expect(getUpdateState().percent).toBeGreaterThan(0)

    // Advance until complete (8s total)
    vi.advanceTimersByTime(7000)
    expect(getUpdateState().status).toBe('downloaded')
    expect(getUpdateState().version).toBe('1.0.5')
    expect(getUpdateState().percent).toBe(100)

    // Install now
    const installRes = await installNow()
    expect(installRes.success).toBe(true)

    vi.useRealTimers()
  })

  it('refuses to install if renderQueue has active jobs', async () => {
    vi.doMock('../electron/ipc/event-emitter', () => ({
      emitToRenderer: vi.fn(),
    }))
    vi.doMock('../electron/window', () => ({
      getMainWindow: vi.fn(),
    }))

    const { renderQueue } = await import('../electron/export/render-queue')
    vi.spyOn(renderQueue, 'getActiveJobCount').mockReturnValue(1)

    const { installNow } = await import('../electron/updater')
    const result = await installNow()

    expect(result.success).toBe(false)
    expect(result.error).toBe('Cannot restart while an export is in progress')
  })
})
