import { app, Notification, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { handle } from './typed-handle'
import { getMainWindow } from '../window'
import {
  checkForUpdatesManually,
  getUpdateState,
  downloadUpdate,
  installNow,
} from '../updater'

import { proxyManager } from '../export/proxy-manager'
import { renderCacheManager } from '../export/render-cache-manager'
import { removeEntry } from '../storage/remove-entry'

export function registerAppHandlers(): void {
  handle('getAppInfo', () => {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      userDataPath: app.getPath('userData'),
    }
  })

  handle('getDownloadsPath', () => {
    return app.getPath('downloads')
  })

  handle('checkForUpdates', async () => {
    return checkForUpdatesManually()
  })

  handle('updateGetState', async () => {
    return getUpdateState()
  })

  handle('updateDownload', async () => {
    return downloadUpdate()
  })

  handle('updateInstallNow', async () => {
    return installNow()
  })

  handle('getNoticesText', async () => {
    const noticesPath = path.join(app.getAppPath(), 'NOTICES.md')
    return fs.readFileSync(noticesPath, 'utf-8')
  })

  handle('showNotification', async ({ title, body, filePath }) => {
    if (!Notification.isSupported()) return false
    const notification = new Notification({
      title,
      body,
    })
    if (filePath) {
      notification.on('click', () => {
        shell.showItemInFolder(filePath)
      })
    }
    notification.show()
    return true
  })

  // Window controls — the window is frameless, so the renderer's title bar
  // owns minimise / maximise / close.
  handle('windowMinimize', () => {
    getMainWindow()?.minimize()
  })

  handle('windowToggleMaximize', () => {
    const win = getMainWindow()
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return win.isMaximized()
  })

  handle('windowClose', () => {
    getMainWindow()?.close()
  })

  handle('windowIsMaximized', () => getMainWindow()?.isMaximized() ?? false)

  handle('getResourcePath', () => {
    if (!app.isPackaged) {
      return null
    }
    return process.resourcesPath
  })

  handle('getCacheInfo', async () => {
    const previewDir = path.join(app.getPath('temp'), 'komfyedit-previews')
    const appCacheDir = path.join(app.getPath('userData'), 'Cache')
    const proxyDir = proxyManager.getProxyDir()
    const renderCacheDir = renderCacheManager.getCacheDir()

    let totalBytes = 0
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanDir(fullPath)
          } else if (entry.isFile()) {
            totalBytes += fs.statSync(fullPath).size
          }
        }
      } catch {}
    }

    scanDir(previewDir)
    scanDir(appCacheDir)
    scanDir(proxyDir)
    scanDir(renderCacheDir)

    const formatBytes = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    }

    return {
      cachePath: previewDir,
      sizeBytes: totalBytes,
      formattedSize: formatBytes(totalBytes),
    }
  })

  handle('clearCache', async () => {
    const previewDir = path.join(app.getPath('temp'), 'komfyedit-previews')
    let freedBytes = 0

    // Clear proxy cache files & cancel any running proxy tasks
    freedBytes += proxyManager.clearProxies()
    // Clear render cache files
    freedBytes += renderCacheManager.clearCache()

    if (fs.existsSync(previewDir)) {
      try {
        const entries = fs.readdirSync(previewDir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(previewDir, entry.name)
          try {
            if (entry.isFile()) {
              freedBytes += fs.statSync(fullPath).size
              fs.unlinkSync(fullPath)
            } else if (entry.isDirectory()) {
              removeEntry(fullPath)
            }
          } catch {}
        }
      } catch (err) {
        return { success: false, freedBytes, error: String(err) }
      }
    }

    return { success: true, freedBytes }
  })
}
