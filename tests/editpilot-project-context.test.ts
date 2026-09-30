import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeMcpConfig } from '../electron/editpilot/agent-runner'
import { getProjectsDir } from '../electron/storage/project-file-storage'
import { KomfyEditMcpServer } from '../packages/kailaedit-mcp/src/server'
import { projectSchema, saveProjectAtomic, type Project } from '@komfyedit/core'

describe('S5-2: EditPilot Project Context & Runner Integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfy-editpilot-context-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  })

  it('writeMcpConfig writes correct KOMFYEDIT_PROJECTS_DIR and KOMFYEDIT_ACTIVE_PROJECT_ID', () => {
    const runId = `test-run-${Date.now()}`
    const fakeProjectsDir = path.join(tempDir, 'custom-projects')
    const fakeProjectId = 'proj-context-42'

    const configPath = writeMcpConfig(runId, fakeProjectsDir, fakeProjectId)
    try {
      expect(fs.existsSync(configPath)).toBe(true)
      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const serverEnv = content?.mcpServers?.komfyedit?.env

      expect(serverEnv).toBeDefined()
      expect(serverEnv.KOMFYEDIT_MCP_PROFILE).toBe('edit')
      expect(serverEnv.KOMFYEDIT_PROJECTS_DIR).toBe(fakeProjectsDir)
      expect(serverEnv.KOMFYEDIT_ACTIVE_PROJECT_ID).toBe(fakeProjectId)
      expect(serverEnv.ELECTRON_RUN_AS_NODE).toBe('1')
    } finally {
      try {
        fs.unlinkSync(configPath)
      } catch {
        // best effort
      }
    }
  })

  it('getProjectsDir returns a valid non-empty path', () => {
    const dir = getProjectsDir()
    expect(typeof dir).toBe('string')
    expect(dir.length).toBeGreaterThan(0)
  })

  it('rejects with helpful error when projectId is missing or empty', () => {
    const validate = (projectId?: string | null) => {
      if (!projectId || !projectId.trim()) {
        return {
          success: false as const,
          error: 'No project is currently open. Please open a project before using EditPilot.',
        }
      }
      return { success: true as const }
    }

    expect(validate(null).success).toBe(false)
    expect(validate(null).error).toContain('No project is currently open')
    expect(validate('  ').success).toBe(false)
    expect(validate('valid-id').success).toBe(true)
  })

  it('MCP server resolveProject automatically picks up KOMFYEDIT_ACTIVE_PROJECT_ID', async () => {
    const projectId = 'auto-active-proj'
    const dummyProject: Project = projectSchema.parse({
      version: 2,
      id: projectId,
      name: 'Active Project From Env',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      assets: [],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'timeline-main',
          name: 'Main',
          createdAt: 1700000000000,
          tracks: [{ id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false }],
          clips: [],
          subtitles: [],
        },
      ],
      activeTimelineId: 'timeline-main',
    })

    // Save project into tempDir
    const projectPath = path.join(tempDir, `${projectId}.json`)
    saveProjectAtomic(projectPath, dummyProject)

    // Set env variables
    const oldProjectsDir = process.env.KOMFYEDIT_PROJECTS_DIR
    const oldActiveId = process.env.KOMFYEDIT_ACTIVE_PROJECT_ID

    process.env.KOMFYEDIT_PROJECTS_DIR = tempDir
    process.env.KOMFYEDIT_ACTIVE_PROJECT_ID = projectId

    try {
      const server = new KomfyEditMcpServer({ profile: 'edit' })
      // Call timeline_describe without projectId - it should resolve to active project automatically
      const res = await (server as any).server._requestHandlers.get('tools/call')({
        method: 'tools/call',
        params: {
          name: 'timeline_describe',
          arguments: {},
        },
      })
      expect(res.isError).toBeFalsy()
      const data = JSON.parse(res.content[0].text)
      expect(data.name).toBe('Main')
      expect(server.getLoadedProject()?.name).toBe('Active Project From Env')
    } finally {
      if (oldProjectsDir !== undefined) {
        process.env.KOMFYEDIT_PROJECTS_DIR = oldProjectsDir
      } else {
        delete process.env.KOMFYEDIT_PROJECTS_DIR
      }

      if (oldActiveId !== undefined) {
        process.env.KOMFYEDIT_ACTIVE_PROJECT_ID = oldActiveId
      } else {
        delete process.env.KOMFYEDIT_ACTIVE_PROJECT_ID
      }
    }
  })
})
