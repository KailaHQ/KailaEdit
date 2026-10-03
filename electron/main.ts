import './app-paths'
import { app } from 'electron'
import { APP_USER_MODEL_ID } from './app-identity'
import { setupCSP } from './csp'
import { registerExportHandlers } from './export/export-handler'
import { findFfmpegPath, stopExportProcess } from './export/ffmpeg-utils'
import { detectHardwareEncoders } from './export/hardware-encoder'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerLogHandlers } from './ipc/log-handlers'
import { registerProjectHandlers } from './ipc/project-handlers'
import { registerVideoProcessingHandlers } from './ipc/video-processing-handlers'
import { registerEventTestHandlers } from './ipc/event-emitter'
import { registerEditPilotHandlers } from './ipc/editpilot-handlers'
import { registerWhisperHandlers } from './ipc/whisper-handlers'
import { registerTemplateHandlers } from './ipc/template-handlers'
import { logger } from './logger'
import { initSessionLog } from './logging-management'
import { renderCacheManager } from './export/render-cache-manager'
import { checkForUpdatesOnStartup } from './updater'
import { createWindow, getMainWindow } from './window'

function logAppVersion(): void {
  if (!app.isPackaged) {
    logger.info('[KailaEdit] Running in development mode')
  } else {
    logger.info(`[KailaEdit] Version ${app.getVersion()}`)
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.setName('KailaEdit')

  // Windows groups taskbar buttons by AppUserModelID. Claiming the app's ID
  // binds the taskbar button directly to the registered app identity and its icon.
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  }

  initSessionLog()
  logAppVersion()

  // Bring the render cache up to the current format before anything can ask it for a
  // segment or write one. It is lazy otherwise, and a directory migration that runs
  // halfway through a session could drop a file the session itself had just produced.
  renderCacheManager.init()

  registerAppHandlers()
  registerFileHandlers()
  registerProjectHandlers()
  registerLogHandlers()
  registerExportHandlers()
  registerVideoProcessingHandlers()
  registerEventTestHandlers()
  registerEditPilotHandlers()
  registerWhisperHandlers()
  registerTemplateHandlers()

  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      return
    }
    if (app.isReady()) {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    setupCSP()
    createWindow()

    checkForUpdatesOnStartup()

    // Probe hardware encoder capabilities on startup
    setTimeout(() => {
      try {
        const p = findFfmpegPath()
        if (p) {
          detectHardwareEncoders(p).catch((err) => {
            logger.warn(`[main] Failed to probe hardware encoders on startup: ${String(err)}`)
          })
        }
      } catch (err) {
        logger.warn(`[main] Failed to probe hardware encoders on startup: ${String(err)}`)
      }
    }, 100)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (getMainWindow() === null) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    stopExportProcess()
  })
}
