import path from 'path'
import os from 'os'

/**
 * Where KomfyEdit keeps its data, and where projects live inside that.
 *
 * This is the single definition shared by everything that needs to find a
 * project on disk: the Electron main process (which feeds it to
 * `app.setPath('userData', …)`) and the MCP server (which has no Electron to
 * ask). They used to compute it separately and disagreed — the app wrote to
 * `%LOCALAPPDATA%` on Windows while the MCP server only ever looked under
 * `%APPDATA%`, so an agent saw an empty project list on a machine full of
 * projects. Keep both callers on this function.
 */
export const APP_FOLDER_NAME = 'KailaEdit'
export const LEGACY_APP_FOLDER_NAME = 'KomfyEdit'

/** The app's userData directory, matching Electron's `app.getPath('userData')` after we override it. */
export function resolveUserDataDir(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(localAppData, APP_FOLDER_NAME)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_FOLDER_NAME)
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(xdgData, APP_FOLDER_NAME)
}

/** The projects directory under a given base, or under the default userData dir. */
export function resolveProjectsDirFor(baseDir?: string): string {
  return path.join(baseDir ?? resolveUserDataDir(), 'projects')
}

/**
 * Every place a project directory might plausibly be, best first.
 *
 * The first entry is where the app actually writes. The rest cover a project
 * folder carried over from an older build, and running against a checkout
 * (`.kailaedit-data/` or `.komfyedit-data/`) rather than an installed app.
 */
export function projectsDirCandidates(cwd: string = process.cwd()): string[] {
  const candidates: string[] = [resolveProjectsDirFor()]

  const home = os.homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    candidates.push(path.join(appData, APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(appData, 'kailaedit', 'projects'))
    candidates.push(path.join(localAppData, LEGACY_APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(appData, LEGACY_APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(appData, 'komfyedit', 'projects'))
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'kailaedit', 'projects'))
    candidates.push(path.join(home, 'Library', 'Application Support', LEGACY_APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(home, 'Library', 'Application Support', 'komfyedit', 'projects'))
  } else {
    candidates.push(path.join(home, '.config', APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(home, '.config', 'kailaedit', 'projects'))
    candidates.push(path.join(home, '.config', LEGACY_APP_FOLDER_NAME, 'projects'))
    candidates.push(path.join(home, '.config', 'komfyedit', 'projects'))
  }

  candidates.push(path.join(cwd, '.kailaedit-data', 'projects'))
  candidates.push(path.join(cwd, '.komfyedit-data', 'projects'))
  candidates.push(path.join(cwd, 'projects'))

  return candidates
}
