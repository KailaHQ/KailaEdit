import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import path from 'path'
import fs from 'fs'

// In MCP stdio servers, stdout is exclusively for JSON-RPC messages.
// Redirect console.log and info to console.error to avoid stream corruption.
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
console.debug = (...args: unknown[]) => console.error(...args)

import type { Project, Timeline } from '@komfyedit/core'
import { listProjects, readProject } from './project-reader.ts'
import { READ_ONLY_TOOLS, EDIT_TOOLS } from './tools/tool-definitions.ts'
import { handleReadTool } from './tools/read-tools.ts'
import { handleEditTool } from './tools/edit-tools.ts'
import type {
  McpServerContext,
  ProposedPatchEntry,
  UndoStackEntry,
} from './tools/types.ts'

export { READ_ONLY_TOOLS, EDIT_TOOLS }

export interface KailaEditMcpServerOptions {
  profile?: 'read' | 'edit'
}
export type KomfyEditMcpServerOptions = KailaEditMcpServerOptions

export class KailaEditMcpServer {
  private server: Server
  private profile: 'read' | 'edit'
  private activeProject: Project | null = null
  private activeProjectPath: string | null = null

  private proposedPatches = new Map<string, ProposedPatchEntry>()
  private undoStack: UndoStackEntry[] = []

  constructor(options: KailaEditMcpServerOptions = {}) {
    const envProfile = process.env.KAILAEDIT_MCP_PROFILE || process.env.KOMFYEDIT_MCP_PROFILE
    this.profile = options.profile || (envProfile === 'edit' ? 'edit' : 'read')
    this.server = new Server(
      {
        name: 'kailaedit-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.registerHandlers()
  }

  public getProfile(): 'read' | 'edit' {
    return this.profile
  }

  public getLoadedProject(): Project | null {
    return this.activeProject
  }

  public setLoadedProject(project: Project, filePath?: string): void {
    this.activeProject = project
    this.activeProjectPath = filePath || null
  }

  private resolveProject(projectId?: string): Project {
    const targetId = projectId || process.env.KAILAEDIT_ACTIVE_PROJECT_ID || process.env.KOMFYEDIT_ACTIVE_PROJECT_ID
    if (targetId) {
      const res = readProject(targetId)
      this.activeProject = res.project
      this.activeProjectPath = res.filePath
      return res.project
    }

    if (this.activeProject) {
      return this.activeProject
    }

    // Try auto-loading the most recent project from default dir
    const projects = listProjects()
    if (projects.length > 0) {
      const recent = readProject(projects[0].filePath)
      this.activeProject = recent.project
      this.activeProjectPath = recent.filePath
      return recent.project
    }

    throw new Error('No project opened. Call project.open first or provide projectId.')
  }

  private resolveTimeline(project: Project, timelineId?: string): Timeline {
    const timelines = project.timelines || []
    if (timelines.length === 0) {
      throw new Error(`Project "${project.name}" has no timelines.`)
    }

    if (timelineId) {
      const found = timelines.find(t => t.id === timelineId)
      if (!found) throw new Error(`Timeline ID "${timelineId}" not found in project.`)
      return found
    }

    if (project.activeTimelineId) {
      const found = timelines.find(t => t.id === project.activeTimelineId)
      if (found) return found
    }

    return timelines[0]
  }

  private resolveMediaPath(toolArgs: Record<string, any>): string {
    // 1. Direct filePath
    if (typeof toolArgs.filePath === 'string' && toolArgs.filePath.trim()) {
      const resolved = path.resolve(toolArgs.filePath.trim())
      // If it's a project JSON file, resolve the primary media clip from it
      if (resolved.endsWith('.json') && fs.existsSync(resolved)) {
        try {
          const res = readProject(resolved)
          const tl = this.resolveTimeline(res.project, toolArgs.timelineId)
          const assetMap = new Map((res.project.assets || []).map(a => [a.id, a]))
          for (const clip of tl.clips) {
            const asset = clip.assetId ? assetMap.get(clip.assetId) : (clip as any).asset
            const p = asset?.path || (clip as any).mediaPath || (clip as any).assetPath
            if (p && fs.existsSync(p)) return path.resolve(p)
          }
        } catch {
          // fallback to resolved path
        }
      }
      return resolved
    }

    // 2. From clipId or active project
    const project = this.resolveProject(toolArgs.projectId)
    const timeline = this.resolveTimeline(project, toolArgs.timelineId)
    const assetMap = new Map((project.assets || []).map(a => [a.id, a]))

    if (typeof toolArgs.clipId === 'string' && toolArgs.clipId.trim()) {
      const clip = timeline.clips.find(c => c.id === toolArgs.clipId.trim())
      if (clip) {
        const asset = clip.assetId ? assetMap.get(clip.assetId) : (clip as any).asset
        const p = asset?.path || (clip as any).mediaPath || (clip as any).assetPath
        if (p && fs.existsSync(p)) return path.resolve(p)
      }
      throw new Error(`Clip ID "${toolArgs.clipId}" has no valid media file.`)
    }

    // 3. Fallback to first video or audio clip in the active timeline
    for (const clip of timeline.clips) {
      if (clip.type === 'text' || clip.type === 'adjustment') continue
      const asset = clip.assetId ? assetMap.get(clip.assetId) : (clip as any).asset
      const p = asset?.path || (clip as any).mediaPath || (clip as any).assetPath
      if (p && fs.existsSync(p)) return path.resolve(p)
    }

    // 4. Fallback to first asset in project.assets
    if (project.assets && project.assets.length > 0) {
      for (const asset of project.assets) {
        if (asset.path && fs.existsSync(asset.path)) return path.resolve(asset.path)
      }
    }

    throw new Error('No media file found. Please provide a valid filePath or clipId.')
  }

  private buildContext(): McpServerContext {
    const self = this
    return {
      profile: self.profile,
      get activeProject() {
        return self.activeProject
      },
      get activeProjectPath() {
        return self.activeProjectPath
      },
      proposedPatches: self.proposedPatches,
      undoStack: self.undoStack,
      resolveProject: (id?: string) => self.resolveProject(id),
      resolveTimeline: (p: Project, id?: string) => self.resolveTimeline(p, id),
      resolveMediaPath: (args: Record<string, any>) => self.resolveMediaPath(args),
      setActiveProject: (p: Project | null, path?: string | null) => {
        self.activeProject = p
        self.activeProjectPath = path ?? null
      },
    }
  }

  private registerHandlers(): void {
    // List available tools according to profile
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.profile === 'edit'
        ? [...READ_ONLY_TOOLS, ...EDIT_TOOLS]
        : [...READ_ONLY_TOOLS]
      return { tools }
    })

    // Dispatch tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const toolArgs = (args || {}) as Record<string, any>

      try {
        // Derived from the tool list itself rather than a name prefix: a
        // prefix check silently stopped guarding anything when tool names were
        // renamed, which would have exposed the write tools in read profile.
        const isEditProfileTool = EDIT_TOOLS.some(tool => tool.name === name)
        if (isEditProfileTool && this.profile !== 'edit') {
          throw new Error(
            `Tool "${name}" is not available in "read" profile. Start server with --profile edit or KOMFYEDIT_MCP_PROFILE=edit.`,
          )
        }

        const ctx = this.buildContext()

        // Try read/measure tools first
        const readResult = await handleReadTool(name, toolArgs, ctx)
        if (readResult) return readResult

        // Try edit/mutation tools
        const editResult = await handleEditTool(name, toolArgs, ctx)
        if (editResult) return editResult

        throw new Error(`Unknown tool: ${name}`)
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error executing tool "${name}": ${err.message || String(err)}`,
            },
          ],
        }
      }
    })
  }

  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    // Log to stderr only so stdout remains pure JSON-RPC for MCP protocol
    process.stderr.write(`[kailaedit-mcp] MCP Server running on stdio transport (profile: ${this.profile})\n`)
  }

  public async close(): Promise<void> {
    await this.server.close()
  }
}

export const KomfyEditMcpServer = KailaEditMcpServer
export type KomfyEditMcpServer = KailaEditMcpServer
