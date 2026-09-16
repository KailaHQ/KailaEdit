import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Returns the directory where project JSON files are stored.
 * Defaults to userData/projects or cwd/projects in headless/test runs.
 */
export function getProjectsDir(customBaseDir?: string): string {
  if (customBaseDir) {
    return path.isAbsolute(customBaseDir)
      ? customBaseDir
      : path.join(process.cwd(), customBaseDir)
  }

  let userDataPath: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      userDataPath = app.getPath('userData')
    }
  } catch {
    // Running in standalone Node or test runner
  }

  const defaultHeadlessDir = fs.existsSync(path.join(process.cwd(), '.kailaedit-data'))
    ? path.join(process.cwd(), '.kailaedit-data')
    : (fs.existsSync(path.join(process.cwd(), '.komfyedit-data'))
        ? path.join(process.cwd(), '.komfyedit-data')
        : path.join(process.cwd(), '.kailaedit-data'))
  const base = userDataPath || defaultHeadlessDir
  return path.join(base, 'projects')
}

/**
 * Sanitizes project ID to prevent path traversal.
 */
export function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function getProjectFilePath(projectsDir: string, projectId: string): string {
  const safeId = sanitizeProjectId(projectId)
  return path.join(projectsDir, `${safeId}.json`)
}

/**
 * Atomically writes project content to disk:
 * 1. Writes to a temporary file (.projectId.tmp.<timestamp>.<rand>)
 * 2. Renames the temp file to target file.
 * If any error occurs or write is interrupted, original target file is completely untouched.
 */
export function writeProjectFileAtomic(
  projectsDir: string,
  projectId: string,
  content: string,
): { success: true; path: string } | { success: false; error: string } {
  let tempPath: string | null = null
  try {
    fs.mkdirSync(projectsDir, { recursive: true })
    const targetPath = getProjectFilePath(projectsDir, projectId)
    tempPath = path.join(
      projectsDir,
      `.${sanitizeProjectId(projectId)}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    )

    // Write to temporary file
    fs.writeFileSync(tempPath, content, 'utf-8')

    // Atomically replace target
    fs.renameSync(tempPath, targetPath)

    return { success: true, path: targetPath }
  } catch (error) {
    // Clean up temporary file if it was created
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        // Ignore unlink error during failure recovery
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Reads project JSON content from disk.
 */
export function readProjectFromFile(
  projectsDir: string,
  projectId: string,
): { success: true; content: string } | { success: false; error: string } {
  try {
    const filePath = getProjectFilePath(projectsDir, projectId)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Project file not found: ${projectId}` }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Deletes a project file from disk.
 */
export function deleteProjectFile(
  projectsDir: string,
  projectId: string,
): { success: true } | { success: false; error: string } {
  try {
    const filePath = getProjectFilePath(projectsDir, projectId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Lists all project IDs stored in the projects directory.
 */
export function listProjectFiles(projectsDir: string): string[] {
  try {
    if (!fs.existsSync(projectsDir)) return []
    const entries = fs.readdirSync(projectsDir)
    return entries
      .filter(file => file.endsWith('.json') && !file.startsWith('.'))
      .map(file => file.slice(0, -5))
  } catch {
    return []
  }
}
