import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { spawn } from 'child_process'
import {
  KomfyEditMcpServer,
  READ_ONLY_TOOLS,
  EDIT_TOOLS,
} from '../packages/kailaedit-mcp/src/server'
import { projectSchema, type Project, type EditPatch } from '@komfyedit/core'

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures')
const SYNTHETIC_MEDIA = path.join(FIXTURES_DIR, 'synthetic_media.mp4')

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function createSampleProject(filePath: string): Project {
  const asset = {
    id: 'asset_1',
    type: 'video' as const,
    path: SYNTHETIC_MEDIA,
    prompt: '',
    resolution: '1920x1080',
    duration: 30,
    createdAt: 1700000000000,
  }

  const project: Project = projectSchema.parse({
    version: 2,
    id: 'proj_test_edit',
    name: 'Test Edit Project',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    assets: [asset],
    bins: {
      root: 'Default',
    },
    timelines: [
      {
        id: 'tl_1',
        name: 'Main Timeline',
        createdAt: 1700000000000,
        tracks: [
          {
            id: 't_v1',
            name: 'V1',
            muted: false,
            locked: false,
            kind: 'video',
          },
          {
            id: 't_v2_locked',
            name: 'V2 (Locked)',
            muted: false,
            locked: true,
            kind: 'video',
          },
        ],
        clips: [
          {
            id: 'c_v1_1',
            trackIndex: 0,
            startTime: 0,
            duration: 10,
            trimStart: 0,
            trimEnd: 10,
            type: 'video',
            assetId: 'asset_1',
            asset,
          },
          {
            id: 'c_v1_2',
            trackIndex: 0,
            startTime: 10,
            duration: 10,
            trimStart: 0,
            trimEnd: 10,
            type: 'video',
            assetId: 'asset_1',
            asset,
          },
          {
            id: 'c_locked_1',
            trackIndex: 1,
            startTime: 25,
            duration: 5,
            trimStart: 0,
            trimEnd: 5,
            type: 'video',
            assetId: 'asset_1',
            asset,
          },
        ],
        subtitles: [],
      },
    ],
    activeTimelineId: 'tl_1',
  })

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8')
  return project
}

describe('S4-1 · MCP Profile edit (propose / apply / undo)', () => {
  let tmpDir: string
  let projectFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-mcp-edit-test-'))
    projectFile = path.join(tmpDir, 'test_project.json')
    createSampleProject(projectFile)
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('default profile is read and does not expose edit.* tools', async () => {
    const server = new KomfyEditMcpServer()
    expect(server.getProfile()).toBe('read')

    // Using stdio or internal handler verification
    // Calling an edit tool directly in read profile must throw / error
    const result = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_propose',
        arguments: {
          projectId: projectFile,
          patch: { version: 1, operations: [{ op: 'delete_clip', clipId: 'c_v1_2' }] },
        },
      },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not available in "read" profile')

    const toolsList = await (server as any).server._requestHandlers.get('tools/list')({
      method: 'tools/list',
      params: {},
    })
    const toolNames = toolsList.tools.map((t: any) => t.name)
    expect(toolNames.some((n: string) => n.startsWith('edit.'))).toBe(false)
  })

  it('edit.propose does not alter SHA-256 of project file on disk', async () => {
    const server = new KomfyEditMcpServer({ profile: 'edit' })
    expect(server.getProfile()).toBe('edit')

    const shaBefore = hashFile(projectFile)

    const patch: EditPatch = {
      version: 1,
      description: 'Cut 2s silence from 4 to 6',
      operations: [
        {
          op: 'cut_range',
          startTime: 4,
          endTime: 6,
        },
      ],
    }

    const callResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_propose',
        arguments: {
          projectId: projectFile,
          patch,
        },
      },
    })

    if (callResult.isError) {
      console.error('PROPOSE ERROR:', callResult.content[0].text)
    }
    expect(callResult.isError).toBeFalsy()
    const response = JSON.parse(callResult.content[0].text)
    expect(response.valid).toBe(true)
    expect(response.patchId).toBeDefined()
    expect(response.diff).toContain('cut 1 ranges')

    // Check disk hash
    const shaAfter = hashFile(projectFile)
    expect(shaAfter).toBe(shaBefore)
  })

  it('edit.apply with unproposed patchId is rejected clearly', async () => {
    const server = new KomfyEditMcpServer({ profile: 'edit' })

    const callResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_apply',
        arguments: {
          patchId: 'non_existent_patch_id_123',
        },
      },
    })

    expect(callResult.isError).toBe(true)
    expect(callResult.content[0].text).toContain('Proposed patch "non_existent_patch_id_123" not found')
  })

  it('edit.apply followed by edit.undo restores project file byte-for-byte to original', async () => {
    const server = new KomfyEditMcpServer({ profile: 'edit' })

    const originalContent = fs.readFileSync(projectFile, 'utf8')
    const originalHash = hashFile(projectFile)

    // 1. Propose
    const patch: EditPatch = {
      version: 1,
      description: 'Delete clip c_v1_2',
      operations: [
        {
          op: 'delete_clip',
          clipId: 'c_v1_2',
        },
      ],
    }

    const proposeResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_propose',
        arguments: {
          projectId: projectFile,
          patch,
        },
      },
    })

    const proposeData = JSON.parse(proposeResult.content[0].text)
    expect(proposeData.valid).toBe(true)
    const patchId = proposeData.patchId

    // 2. Apply
    const applyResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_apply',
        arguments: {
          patchId,
        },
      },
    })

    expect(applyResult.isError).toBeFalsy()
    const applyData = JSON.parse(applyResult.content[0].text)
    expect(applyData.success).toBe(true)
    expect(applyData.undoAvailable).toBe(true)

    // Project on disk has been updated
    const updatedContent = fs.readFileSync(projectFile, 'utf8')
    expect(updatedContent).not.toBe(originalContent)
    const updatedProject: Project = JSON.parse(updatedContent)
    expect(updatedProject.timelines[0].clips.some(c => c.id === 'c_v1_2')).toBe(false)

    // 3. Undo
    const undoResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_undo',
        arguments: {},
      },
    })

    expect(undoResult.isError).toBeFalsy()
    const undoData = JSON.parse(undoResult.content[0].text)
    expect(undoData.success).toBe(true)

    // Byte-for-byte comparison
    const restoredContent = fs.readFileSync(projectFile, 'utf8')
    const restoredHash = hashFile(projectFile)
    expect(restoredHash).toBe(originalHash)
    expect(restoredContent).toBe(originalContent)
  })

  it('patch violating invariants (deleting clip on locked track) is rejected at validator, disk unchanged', async () => {
    const server = new KomfyEditMcpServer({ profile: 'edit' })
    const shaBefore = hashFile(projectFile)

    const invalidPatch: EditPatch = {
      version: 1,
      description: 'Attempt to delete clip on locked track',
      operations: [
        {
          op: 'delete_clip',
          clipId: 'c_locked_1',
        },
      ],
    }

    // Propose invalid patch
    const proposeResult = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_propose',
        arguments: {
          projectId: projectFile,
          patch: invalidPatch,
        },
      },
    })

    const data = JSON.parse(proposeResult.content[0].text)
    expect(data.valid).toBe(false)
    expect(data.error).toMatch(/locked track/i)

    // Verify disk remains completely untouched
    const shaAfter = hashFile(projectFile)
    expect(shaAfter).toBe(shaBefore)
  })

  it('render.preview runs via MCP tool handler and returns completed preview metadata', async () => {
    const server = new KomfyEditMcpServer({ profile: 'edit' })

    const result = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'render_preview',
        arguments: {
          projectId: projectFile,
          startTime: 0,
          duration: 2,
          resolution: '480p',
          wait: true,
        },
      },
    })

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data.success).toBe(true)
    expect(data.jobId).toBeDefined()
    expect(data.outputPath).toBeDefined()
    expect(fs.existsSync(data.outputPath)).toBe(true)
  }, 15000)
})
