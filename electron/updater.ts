import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import {
  getInitialUpdateState,
  reduceUpdateState,
  type UpdateAction,
  type UpdateState,
} from '../core/src/update-state'
import { emitToRenderer } from './ipc/event-emitter'
import { logger } from './logger'
import { getMainWindow } from './window'
import { renderQueue } from './export/render-queue'

/**
 * Auto-update against GitHub Releases.
 *
 * The publish target lives in electron-builder.yml; electron-builder writes it
 * into `app-update.yml` inside the packaged app, which is the only place
 * electron-updater reads it from. That file does not exist in a dev run, so
 * electron-updater is disabled unless the app is packaged, or simulated via
 * KOMFYEDIT_FAKE_UPDATE=1.
 */

let updaterInstance: AppUpdater | null = null
let checkInFlight = false
let periodicTimer: NodeJS.Timeout | null = null
let fakeDownloadTimer: NodeJS.Timeout | null = null

const isFakeMode = process.env.KOMFYEDIT_FAKE_UPDATE === '1'

export function isUpdateSupported(): boolean {
  return Boolean(app?.isPackaged || isFakeMode)
}

let currentUpdateState: UpdateState = getInitialUpdateState(isUpdateSupported())

function transition(action: UpdateAction): UpdateState {
  currentUpdateState = reduceUpdateState(currentUpdateState, action)
  emitToRenderer('update:state', currentUpdateState)
  return currentUpdateState
}

export function getUpdateState(): UpdateState {
  return currentUpdateState
}

async function getUpdater(): Promise<AppUpdater | null> {
  if (!app.isPackaged) return null
  if (updaterInstance) return updaterInstance

  // electron-updater is CommonJS and the main bundle is ESM, so the named
  // export only survives if Node's CJS interop finds it. Fall back to the
  // default namespace rather than crash the whole check on an interop miss.
  const updaterModule = await import('electron-updater')
  const autoUpdater = (updaterModule.autoUpdater
    ?? (updaterModule as unknown as { default?: { autoUpdater?: AppUpdater } }).default?.autoUpdater) as AppUpdater | undefined
  if (!autoUpdater) {
    logger.error('[updater] electron-updater did not expose autoUpdater; skipping update checks')
    return null
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => logger.info(`[updater] ${String(m)}`),
    warn: (m: unknown) => logger.warn(`[updater] ${String(m)}`),
    error: (m: unknown) => logger.error(`[updater] ${String(m)}`),
    debug: (m: unknown) => logger.info(`[updater] ${String(m)}`),
  }

  autoUpdater.on('checking-for-update', () => {
    logger.info('[updater] Checking for update...')
    transition({ type: 'START_CHECK' })
  })

  autoUpdater.on('update-available', info => {
    logger.info(`[updater] Update available: ${info.version} (current ${app?.getVersion?.() ?? '1.0.4'})`)
    checkInFlight = false
    transition({ type: 'UPDATE_AVAILABLE', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info(`[updater] No update available (current ${app?.getVersion?.() ?? '1.0.4'})`)
    checkInFlight = false
    transition({ type: 'UPDATE_NOT_AVAILABLE' })
  })

  autoUpdater.on('download-progress', progress => {
    getMainWindow()?.setProgressBar(progress.percent / 100)
    transition({
      type: 'DOWNLOAD_PROGRESS',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', info => {
    logger.info(`[updater] Update ${info.version} downloaded`)
    getMainWindow()?.setProgressBar(-1)
    checkInFlight = false
    transition({ type: 'UPDATE_DOWNLOADED', version: info.version })
  })

  autoUpdater.on('error', err => {
    logger.warn(`[updater] Update check or download failed: ${String(err)}`)
    getMainWindow()?.setProgressBar(-1)
    checkInFlight = false
    transition({ type: 'UPDATE_ERROR', error: String(err) })
  })

  updaterInstance = autoUpdater
  return autoUpdater
}

export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  if (isFakeMode) {
    if (fakeDownloadTimer) clearInterval(fakeDownloadTimer)
    transition({ type: 'START_DOWNLOAD' })

    const totalBytes = 99_200_000
    const bytesPerSecond = 12_400_000
    let percent = 0
    // Total duration: 8 seconds (40 steps of 200ms, 2.5% each)
    fakeDownloadTimer = setInterval(() => {
      percent += 2.5
      if (percent >= 100) {
        if (fakeDownloadTimer) clearInterval(fakeDownloadTimer)
        fakeDownloadTimer = null
        getMainWindow()?.setProgressBar(-1)
        transition({ type: 'UPDATE_DOWNLOADED', version: currentUpdateState.version || '1.0.5' })
      } else {
        getMainWindow()?.setProgressBar(percent / 100)
        transition({
          type: 'DOWNLOAD_PROGRESS',
          percent,
          bytesPerSecond,
          transferred: Math.round((percent / 100) * totalBytes),
          total: totalBytes,
        })
      }
    }, 200)

    return { success: true }
  }

  if (!isUpdateSupported()) {
    return { success: false, error: 'Updates not supported in this environment' }
  }

  const updater = await getUpdater()
  if (!updater) {
    return { success: false, error: 'Updater not available' }
  }

  try {
    transition({ type: 'START_DOWNLOAD' })
    await updater.downloadUpdate()
    return { success: true }
  } catch (err) {
    logger.warn(`[updater] Download failed: ${String(err)}`)
    transition({ type: 'UPDATE_ERROR', error: String(err) })
    return { success: false, error: String(err) }
  }
}

export async function installNow(): Promise<{ success: boolean; error?: string }> {
  // Safeguard: never restart or interrupt while an export/render is running
  if (renderQueue.getActiveJobCount() > 0) {
    logger.warn('[updater] Refusing to restart for update: active export jobs running')
    return {
      success: false,
      error: 'Cannot restart while an export is in progress',
    }
  }

  if (isFakeMode) {
    logger.info('[updater] [fake-mode] installNow triggered (simulating silent quitAndInstall)')
    return { success: true }
  }

  if (!isUpdateSupported()) {
    return { success: false, error: 'Updates not supported in this environment' }
  }

  const updater = await getUpdater()
  if (!updater) {
    return { success: false, error: 'Updater not available' }
  }

  try {
    logger.info('[updater] Calling quitAndInstall(true, true) for silent update restart')
    // isSilent = true (skips UI), isForceRunAfter = true (restarts the app)
    updater.quitAndInstall(true, true)
    return { success: true }
  } catch (err) {
    logger.error(`[updater] Failed to execute quitAndInstall: ${String(err)}`)
    return { success: false, error: String(err) }
  }
}

/** Check for updates (invoked manually e.g. from Help menu). */
export async function checkForUpdatesManually(): Promise<UpdateState> {
  return runCheck(true)
}

async function runCheck(manual: boolean): Promise<UpdateState> {
  if (isFakeMode) {
    transition({ type: 'START_CHECK' })
    setTimeout(() => {
      transition({ type: 'UPDATE_AVAILABLE', version: '1.0.5' })
    }, manual ? 1200 : 300)
    return currentUpdateState
  }

  if (!isUpdateSupported()) {
    return transition({ type: 'CHECK_UNSUPPORTED' })
  }

  if (checkInFlight) {
    return currentUpdateState
  }

  const updater = await getUpdater()
  if (!updater) {
    return transition({ type: 'CHECK_UNSUPPORTED' })
  }

  checkInFlight = true
  transition({ type: 'START_CHECK' })

  try {
    await updater.checkForUpdates()
    return currentUpdateState
  } catch (err) {
    checkInFlight = false
    logger.warn(`[updater] Check failed: ${String(err)}`)
    return transition({ type: 'UPDATE_ERROR', error: String(err) })
  }
}

/**
 * Check for updates on startup (after 8 seconds), and periodically every 4 hours while running.
 */
export function checkForUpdatesOnStartup(): void {
  if (!isUpdateSupported()) {
    logger.info('[updater] Skipping update check: not supported (not packaged and fake mode disabled)')
    return
  }

  // Initial check after 8s delay
  setTimeout(() => {
    void runCheck(false)
  }, 8000)

  // Periodic check every 4 hours
  if (!periodicTimer) {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    periodicTimer = setInterval(() => {
      void runCheck(false)
    }, FOUR_HOURS_MS)
  }
}
