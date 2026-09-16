import { describe, it, expect } from 'vitest'
import path from 'path'
import os from 'os'
import { APP_FOLDER_NAME, resolveUserDataDir, projectsDirCandidates } from '@komfyedit/core'
import { getProjectsDir } from '../electron/storage/project-file-storage'
import { resolveProjectsDir } from '../packages/kailaedit-mcp/src/project-reader'

/**
 * Regression guard for the split-brain path bug.
 *
 * The app resolved its projects directory from Electron's userData (which we
 * override to %LOCALAPPDATA% on Windows) while the MCP server searched only
 * %APPDATA%. Both sides "worked" in their own unit tests because each injected
 * its own directory, so nothing caught that an agent saw an empty project list
 * on a machine full of projects. These tests compare the two resolvers instead
 * of testing each in isolation.
 */
describe('projects directory resolution is shared between the app and the MCP server', () => {
  it('puts the app\'s real userData projects dir first in the MCP candidate list', () => {
    const candidates = projectsDirCandidates()
    const appDir = path.join(resolveUserDataDir(), 'projects')
    expect(candidates[0]).toBe(appDir)
  })

  it('resolves userData the same way Electron main does per platform', () => {
    const dir = resolveUserDataDir()
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      expect(dir).toBe(path.join(localAppData, APP_FOLDER_NAME))
      // The bug was reaching for Roaming; make sure we never go back.
      expect(dir.toLowerCase()).not.toContain(`${path.sep}roaming${path.sep}`.toLowerCase())
    } else if (process.platform === 'darwin') {
      expect(dir).toBe(path.join(os.homedir(), 'Library', 'Application Support', APP_FOLDER_NAME))
    } else {
      const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
      expect(dir).toBe(path.join(xdg, APP_FOLDER_NAME))
    }
  })

  it('finds the directory the app storage layer would write to, outside Electron', () => {
    // Without Electron available, storage falls back to <cwd>/.komfyedit-data/projects.
    // That exact path must be one the MCP server also knows how to look in.
    const storageDir = getProjectsDir()
    const candidates = projectsDirCandidates()
    expect(candidates).toContain(storageDir)
  })

  it('honours an explicit directory over any platform guess', () => {
    // Note: despite the `customBaseDir` name, an absolute value is used as the
    // projects directory itself, not as a base to append `projects` to.
    const custom = path.join(os.tmpdir(), `komfy-dir-test-${Date.now()}`)
    // A non-existent custom dir must not silently fall through to a platform guess.
    expect(getProjectsDir(custom)).toBe(custom)
    expect(getProjectsDir(custom)).not.toBe(path.join(resolveUserDataDir(), 'projects'))
  })

  it('prefers KOMFYEDIT_PROJECTS_DIR when it exists', () => {
    const previous = process.env.KOMFYEDIT_PROJECTS_DIR
    process.env.KOMFYEDIT_PROJECTS_DIR = os.tmpdir()
    try {
      expect(resolveProjectsDir()).toBe(path.resolve(os.tmpdir()))
    } finally {
      if (previous === undefined) delete process.env.KOMFYEDIT_PROJECTS_DIR
      else process.env.KOMFYEDIT_PROJECTS_DIR = previous
    }
  })

  it('prefers KAILAEDIT_PROJECTS_DIR when it exists', () => {
    const previous = process.env.KAILAEDIT_PROJECTS_DIR
    process.env.KAILAEDIT_PROJECTS_DIR = os.tmpdir()
    try {
      expect(resolveProjectsDir()).toBe(path.resolve(os.tmpdir()))
    } finally {
      if (previous === undefined) delete process.env.KAILAEDIT_PROJECTS_DIR
      else process.env.KAILAEDIT_PROJECTS_DIR = previous
    }
  })
})
