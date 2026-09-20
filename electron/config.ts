import type { App } from 'electron'
import { createRequire } from 'module'
import path from 'path'
import os from 'os'
import { getProjectAssetsPath } from './app-state'
import { resolveUserDataDir } from '../core/src/app-paths'

const require = createRequire(import.meta.url)
let appInstance: App | null = null
try {
  const electron = require('electron')
  if (typeof electron !== 'string' && electron) {
    appInstance = (electron.app || electron.default?.app) as App
  }
} catch {
  // Outside electron runtime
}

export const isDev = appInstance ? !appInstance.isPackaged : process.env.NODE_ENV !== 'production'

// Get directory - works in both CJS and ESM contexts
export function getCurrentDir(): string {
  // In bundled output, use app.getAppPath()
  if (!isDev && appInstance?.getPath) {
    return path.dirname(appInstance.getPath('exe'))
  }
  // In development, use process.cwd() which is the project root
  return process.cwd()
}

export function getAllowedRoots(): string[] {
  const roots = [
    getCurrentDir(),
    appInstance?.getPath ? appInstance.getPath('userData') : resolveUserDataDir(),
    appInstance?.getPath ? appInstance.getPath('downloads') : os.tmpdir(),
    os.tmpdir(),
  ]
  if (!isDev && process.resourcesPath) {
    roots.push(process.resourcesPath)
  }
  roots.push(getProjectAssetsPath())
  return roots
}
