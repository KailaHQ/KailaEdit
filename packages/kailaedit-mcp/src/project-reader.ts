import fs from 'fs'
import path from 'path'
import { projectSchema, projectsDirCandidates, type Project } from '@komfyedit/core'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
  createdAt: number
  clipCount: number
  duration: number
  trackCount: number
  filePath: string
}

export function resolveProjectsDir(customDir?: string): string {
  if (customDir && fs.existsSync(customDir)) {
    return path.resolve(customDir)
  }

  const envProjectsDir = process.env.KAILAEDIT_PROJECTS_DIR || process.env.KOMFYEDIT_PROJECTS_DIR
  if (envProjectsDir && fs.existsSync(envProjectsDir)) {
    return path.resolve(envProjectsDir)
  }

  // Single shared definition — see core/src/app-paths.ts. Computing this
  // separately is what made the server blind to the app's real projects.
  const candidateDirs = projectsDirCandidates()

  for (const candidate of candidateDirs) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  // Default to candidateDirs[0]
  return candidateDirs[0]
}

export function listProjects(customDir?: string): ProjectSummary[] {
  const dir = resolveProjectsDir(customDir)
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir)
  const summaries: ProjectSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.startsWith('.')) continue
    const fullPath = path.join(dir, entry)
    try {
      const raw = fs.readFileSync(fullPath, 'utf8')
      const parsed = JSON.parse(raw)
      const id = parsed.id || path.basename(entry, '.json')
      const name = parsed.name || id
      const updatedAt = parsed.updatedAt || parsed.createdAt || 0
      const createdAt = parsed.createdAt || updatedAt

      let clipCount = 0
      let duration = 0
      let trackCount = 0

      if (Array.isArray(parsed.timelines) && parsed.timelines.length > 0) {
        const active = parsed.timelines.find((t: any) => t.id === parsed.activeTimelineId) || parsed.timelines[0]
        if (active) {
          trackCount = active.tracks?.length || 0
          clipCount = active.clips?.length || 0
          for (const c of (active.clips || [])) {
            const end = (c.startTime || 0) + (c.duration || 0)
            if (end > duration) duration = end
          }
        }
      }

      summaries.push({
        id,
        name,
        updatedAt,
        createdAt,
        clipCount,
        duration,
        trackCount,
        filePath: fullPath,
      })
    } catch {
      // Ignore unparseable files
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readProject(idOrPath: string, customDir?: string): { project: Project; filePath: string } {
  let resolvedPath = idOrPath
  if (!fs.existsSync(resolvedPath)) {
    const dir = resolveProjectsDir(customDir)
    resolvedPath = path.join(dir, `${idOrPath}.json`)
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Project file not found: ${idOrPath} (resolved to ${resolvedPath})`)
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8')
  const json = JSON.parse(raw)
  return { project: projectSchema.parse(json), filePath: resolvedPath }
}
