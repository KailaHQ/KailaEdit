import type { App } from 'electron'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { removeEntry } from './storage/remove-entry'

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

export interface AppState {
  analyticsEnabled?: boolean
  installationId?: string
  projectAssetsPath?: string
  [key: string]: unknown
}

import { resolveUserDataDir } from '../core/src/app-paths'

export function getAppStatePath(): string {
  const userData = appInstance?.getPath ? appInstance.getPath('userData') : resolveUserDataDir()
  return path.join(userData, 'app_state.json')
}

export function readAppState(): AppState {
  const statePath = getAppStatePath()
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as AppState
    }
  } catch (err) {
    console.warn('[app-state] failed to read app state:', err)
  }
  return {}
}

export function writeAppState(state: AppState): void {
  fs.writeFileSync(getAppStatePath(), JSON.stringify(state, null, 2))
}

let cachedProjectAssetsPath: string | null = null

export function getProjectAssetsPath(): string {
  if (cachedProjectAssetsPath) return cachedProjectAssetsPath
  const state = readAppState()
  const downloads = appInstance?.getPath ? appInstance.getPath('downloads') : os.tmpdir()
  const defaultPath = path.resolve(path.join(downloads, 'KomfyEdit Assets'))
  const legacyDefault = path.resolve(path.join(downloads, 'Ltx Desktop Assets'))

  // Migrate legacy directory if it exists and new directory doesn't
  if (fs.existsSync(legacyDefault) && !fs.existsSync(defaultPath)) {
    try {
      fs.renameSync(legacyDefault, defaultPath)
    } catch {
      try {
        fs.cpSync(legacyDefault, defaultPath, { recursive: true })
        removeEntry(legacyDefault)
      } catch (err) {
        console.warn('[app-state] could not migrate legacy assets directory:', err)
      }
    }
  }

  if (state.projectAssetsPath) {
    if (state.projectAssetsPath.endsWith('Ltx Desktop Assets')) {
      const legacyPath = path.resolve(state.projectAssetsPath)
      const newPath = path.resolve(state.projectAssetsPath.replace(/Ltx Desktop Assets$/, 'KomfyEdit Assets'))
      if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
        try {
          fs.renameSync(legacyPath, newPath)
        } catch {
          // ignore
        }
      }
      state.projectAssetsPath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : newPath)
      writeAppState(state)
    }
    cachedProjectAssetsPath = path.resolve(state.projectAssetsPath)
    return cachedProjectAssetsPath
  }

  cachedProjectAssetsPath = defaultPath
  return defaultPath
}

export function setProjectAssetsPath(p: string): void {
  const resolvedPath = path.resolve(p)
  cachedProjectAssetsPath = resolvedPath
  const state = readAppState()
  state.projectAssetsPath = resolvedPath
  writeAppState(state)
}
