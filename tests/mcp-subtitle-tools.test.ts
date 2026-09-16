import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  KomfyEditMcpServer,
  READ_ONLY_TOOLS,
  EDIT_TOOLS,
} from '../packages/kailaedit-mcp/src/server'
import { projectSchema, saveProjectAtomic, type Project } from '@komfyedit/core'

describe('S5-4 · Tool MCP cho subtitle & mô tả timeline', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfy-mcp-sub-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  })

  it('all MCP tool names match ^[a-zA-Z0-9_-]{1,64}$ (Trap 2.5)', () => {
    const regex = /^[a-zA-Z0-9_-]{1,64}$/
    const allTools = [...READ_ONLY_TOOLS, ...EDIT_TOOLS]

    for (const tool of allTools) {
      expect(tool.name).toMatch(regex)
      expect(tool.name).not.toContain('.')
    }
  })

  it('subtitle_list is in READ_ONLY_TOOLS and not in EDIT_TOOLS (Trap 2.6)', async () => {
    const readOnlyNames = READ_ONLY_TOOLS.map(t => t.name)
    const editNames = EDIT_TOOLS.map(t => t.name)

    expect(readOnlyNames).toContain('subtitle_list')
    expect(editNames).not.toContain('subtitle_list')

    // Read profile must never contain edit tools
    const serverRead = new KomfyEditMcpServer({ profile: 'read' })
    const listRes = await (serverRead as any).server._requestHandlers.get('tools/list')({
      method: 'tools/list',
      params: {},
    })
    const toolsInRead = listRes.tools as any[]
    for (const tool of toolsInRead) {
      expect(editNames).not.toContain(tool.name)
    }
  })

  it('timeline_describe returns empty subtitles array without throwing when timeline has no subtitles', async () => {
    const projectId = 'no-subs-proj'
    const project: Project = projectSchema.parse({
      version: 2,
      id: projectId,
      name: 'No Subs Project',
      createdAt: 1000,
      updatedAt: 1000,
      assets: [],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl-1',
          name: 'Main',
          createdAt: 1000,
          tracks: [{ id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false }],
          clips: [],
          subtitles: [],
        },
      ],
      activeTimelineId: 'tl-1',
    })

    const filePath = path.join(tempDir, `${projectId}.json`)
    saveProjectAtomic(filePath, project)

    const server = new KomfyEditMcpServer({ profile: 'read' })
    const res = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'timeline_describe',
        arguments: { projectId: filePath },
      },
    })

    expect(res.isError).toBeFalsy()
    const data = JSON.parse(res.content[0].text)
    expect(data.subtitles).toEqual([])
  })

  it('subtitle_list and timeline_describe return structured subtitle info when subtitles exist', async () => {
    const projectId = 'with-subs-proj'
    const project: Project = projectSchema.parse({
      version: 2,
      id: projectId,
      name: 'Subs Project',
      createdAt: 1000,
      updatedAt: 1000,
      assets: [],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl-1',
          name: 'Main',
          createdAt: 1000,
          tracks: [
            { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
            { id: 'sub-1', name: 'Subtitles', kind: 'video', type: 'subtitle', muted: false, locked: false },
          ],
          clips: [],
          subtitles: [
            {
              id: 'sub-clip-1',
              text: 'Xin chào thế giới',
              startTime: 1.5,
              endTime: 4.5,
              trackIndex: 1,
            },
            {
              id: 'sub-clip-2',
              text: 'KomfyEdit Desktop',
              startTime: 5.0,
              endTime: 8.0,
              trackIndex: 1,
            },
          ],
        },
      ],
      activeTimelineId: 'tl-1',
    })

    const filePath = path.join(tempDir, `${projectId}.json`)
    saveProjectAtomic(filePath, project)

    const server = new KomfyEditMcpServer({ profile: 'read' })

    // 1. Check subtitle_list
    const subListRes = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'subtitle_list',
        arguments: { projectId: filePath },
      },
    })

    expect(subListRes.isError).toBeFalsy()
    const subListData = JSON.parse(subListRes.content[0].text)
    expect(subListData.count).toBe(2)
    expect(subListData.subtitles[0].text).toBe('Xin chào thế giới')
    expect(subListData.subtitles[0].duration).toBe(3)
    expect(subListData.subtitles[1].text).toBe('KomfyEdit Desktop')

    // 2. Check timeline_describe
    const descRes = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'timeline_describe',
        arguments: { projectId: filePath },
      },
    })

    expect(descRes.isError).toBeFalsy()
    const descData = JSON.parse(descRes.content[0].text)
    expect(descData.subtitles).toHaveLength(2)
    expect(descData.subtitles[0].text).toBe('Xin chào thế giới')
    expect(descData.subtitles[1].text).toBe('KomfyEdit Desktop')
  })
})
