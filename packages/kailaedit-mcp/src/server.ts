import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'

// In MCP stdio servers, stdout is exclusively for JSON-RPC messages.
// Redirect console.log and info to console.error to avoid stream corruption.
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
console.debug = (...args: unknown[]) => console.error(...args)
import {
  timelineSummary,
  qcCheck,
  validateEditPatch,
  describePatch,
  applyPatch,
  createInitialEditorState,
  saveProjectAtomic,
  restoreProjectRawAtomic,
  FILTER_DEFINITIONS,
  FILTER_CATEGORIES,
  STICKER_DEFINITIONS,
  STICKER_CATEGORIES,
  SFX_DEFINITIONS,
  SFX_CATEGORIES,
  getEffectiveTimelineDimensions,
  type Project,
  type Timeline,
  type EditorModel,
  type EditPatch,
  computeSegmentContentHash,
  detectBrollOpportunities,
  formatTranscriptForHighlights,
} from '@komfyedit/core'
import { listProjects, readProject } from './project-reader.ts'
import {
  observeSilence,
  observeScenes,
  observeLoudness,
  observeFilmstrip,
} from '../../../electron/media-analyzer.ts'
import { findFfmpegPath, probeAudioStream } from '../../../electron/export/ffmpeg-utils.ts'
import { renderQueue } from '../../../electron/export/render-queue.ts'
import { renderCacheManager } from '../../../electron/export/render-cache-manager.ts'
import { whisperService } from '../../../electron/whisper/whisper-service.ts'
import {
  askConfirmViaLiveBridge,
  tryApplyViaLiveBridge,
  tryUndoViaLiveBridge,
} from './live-bridge-client.ts'

export const READ_ONLY_TOOLS: Tool[] = [
  {
    name: 'project_list',
    description: 'List all available KomfyEdit projects stored on disk with summary metadata (ID, name, clip count, duration, file path).',
    inputSchema: {
      type: 'object',
      properties: {
        projectsDir: {
          type: 'string',
          description: 'Optional custom directory path where project JSON files are stored.',
        },
      },
    },
  },
  {
    name: 'project_open',
    description: 'Load a KomfyEdit project into memory by ID or file path and inspect its tracks, assets, and active timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID or file path of the project to open.',
        },
        projectsDir: {
          type: 'string',
          description: 'Optional custom directory path where project JSON files are stored.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'timeline_describe',
    description: 'Provide a comprehensive breakdown of the timeline including canvas dimensions (width, height, fps, aspectRatio, background), clips with transforms, tracks, transitions, and subtitles.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID. Defaults to active timeline.',
        },
      },
    },
  },
  {
    name: 'subtitle_list',
    description: 'List all subtitle cues on the timeline with index, text, start, end, duration, and track info.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID. Defaults to active timeline.',
        },
      },
    },
  },
  {
    name: 'timeline_summary',
    description: 'Generate a compact, token-efficient timeline representation (<= 16KB) suitable for LLM context, including tracks, clips, and gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
        maxBytes: {
          type: 'number',
          description: 'Maximum size ceiling in bytes (default 16384).',
        },
      },
    },
  },
  {
    name: 'media_list',
    description: 'List all media assets referenced in the project or timeline, verifying file existence on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
      },
    },
  },
  {
    name: 'media_probe',
    description: 'Probe a media file using ffmpeg/ffprobe to extract technical details (duration, resolution, fps, audio channels, codec).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the media file on disk. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to probe instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
      },
    },
  },
  {
    name: 'observe_silence',
    description: 'Analyze an audio/video file for silence intervals (start, end, duration). Cached by path and mtime.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the media file. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to analyze instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
        noiseDb: {
          type: 'number',
          description: 'Noise tolerance threshold in dB (default -30).',
        },
        minDurationSec: {
          type: 'number',
          description: 'Minimum duration in seconds to qualify as silence (default 2.0).',
        },
      },
    },
  },
  {
    name: 'observe_scenes',
    description: 'Analyze a video file to detect scene cuts and transition points using visual scene difference thresholds.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the video file. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to analyze instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
        threshold: {
          type: 'number',
          description: 'Scene detection threshold between 0.0 and 1.0 (default 0.3).',
        },
      },
    },
  },
  {
    name: 'observe_loudness',
    description: 'Measure integrated loudness (LUFS), True Peak (dBFS), and Loudness Range (LRA) according to EBU R128.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the audio or video file. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to analyze instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
      },
    },
  },
  {
    name: 'observe_filmstrip',
    description: 'Generate a composite filmstrip PNG image showing extracted frame strips, audio waveforms, and readable time labels.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the media file or project file. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to analyze instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds (default 0).',
        },
        endTime: {
          type: 'number',
          description: 'End time in seconds (defaults to duration).',
        },
        columns: {
          type: 'number',
          description: 'Number of columns/frames to extract across the interval (default 12).',
        },
        maxWidth: {
          type: 'number',
          description: 'Maximum width in pixels for the generated PNG (default 1600).',
        },
      },
    },
  },
  {
    name: 'transcribe',
    description: 'Transcribe spoken dialogue in an audio or video file using the configured Whisper service (self-hosted or OpenAI Audio API). Returns text segments with start/end timestamps, and word-level timestamps when wordTimestamps is enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the audio or video media file. If omitted, inferred from clipId or active timeline.',
        },
        clipId: {
          type: 'string',
          description: 'Optional clip ID on the active timeline to transcribe instead of filePath.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID. Defaults to active project.',
        },
        startTime: {
          type: 'number',
          description: 'Optional start time offset in seconds.',
        },
        duration: {
          type: 'number',
          description: 'Optional duration in seconds to transcribe.',
        },
        language: {
          type: 'string',
          description: 'Optional ISO-639-1 language code (e.g. "en", "vi").',
        },
        prompt: {
          type: 'string',
          description: 'Optional prompt / style hint to guide Whisper terminology.',
        },
        wordTimestamps: {
          type: 'boolean',
          description: 'Whether to include word-level timestamps in the response (default true).',
        },
        endpoint: {
          type: 'string',
          description: 'Optional custom endpoint URL. Defaults to configured Whisper endpoint or http://localhost:8000/v1.',
        },
        apiKey: {
          type: 'string',
          description: 'Optional API key for OpenAI / cloud endpoint.',
        },
        model: {
          type: 'string',
          description: 'Optional Whisper model name (e.g. "whisper-1", "small").',
        },
      },
    },
  },
  {
    name: 'extract_highlights',
    description: 'Analyze transcript text or auto-transcribe spoken dialogue to extract 3 to 5 viral highlight moments (25s-60s) with hook text candidates and viral scores.',
    inputSchema: {
      type: 'object',
      properties: {
        transcriptText: {
          type: 'string',
          description: 'Optional full transcript text with timestamps. If omitted, will be gathered from timeline subtitles or auto-transcribed from the media file.',
        },
        filePath: {
          type: 'string',
          description: 'Optional path to the media file to transcribe if transcriptText is not provided.',
        },
        maxItems: {
          type: 'number',
          description: 'Maximum number of highlight candidates to extract (default 4).',
        },
        apiKey: {
          type: 'string',
          description: 'Optional OpenAI API Key. Defaults to stored API key in app settings.',
        },
        endpoint: {
          type: 'string',
          description: 'Optional OpenAI-compatible Chat API endpoint (defaults to https://api.openai.com/v1).',
        },
        model: {
          type: 'string',
          description: 'Optional Chat model (defaults to gpt-4o-mini).',
        },
      },
    },
  },
  {
    name: 'qc_check',
    description: 'Run an automated Quality Control (QC) health check on the project/timeline to detect orphan clips, missing media, short clips (<0.5s), overlay gaps, and subtitle overlaps.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
      },
    },
  },
  {
    name: 'filter_list',
    description: 'List available built-in 3D LUT video filters with ID, name, category, description, and default intensity.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by (e.g. "cinematic", "film", "vintage", "bw", "creative", "moody").',
        },
      },
    },
  },
  {
    name: 'sticker_list',
    description: 'List available built-in stickers with ID, name, category, and keywords for use with add_sticker.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by ("emoji", "badge", "arrow", "icon", "animated").',
        },
      },
    },
  },
  {
    name: 'sfx_list',
    description: 'List available built-in sound effects (16-bit WAV) with ID, name, category, duration, description, and keywords for use with add_sfx.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to filter by ("transition", "accent", "notification", "impact", "comedy", "foley").',
        },
      },
    },
  },
  {
    name: 'suggest_broll',
    description: 'Analyze the timeline transcript/subtitles to identify continuous talking intervals (> 5s) lacking visual variety, and suggest B-roll insertion points with timestamps and extracted keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project ID to analyze. Defaults to the active project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID to analyze (defaults to active timeline).',
        },
        minDuration: {
          type: 'number',
          description: 'Minimum duration of continuous talking head speech to consider for B-roll (default 5.0 seconds).',
        },
        maxDuration: {
          type: 'number',
          description: 'Maximum recommended duration for a B-roll clip (default 8.0 seconds).',
        },
      },
    },
  },
]

export const EDIT_TOOLS: Tool[] = [
  {
    name: 'ask_confirm',
    description: 'Ask the user to confirm before an irreversible or ambiguous edit, and BLOCK until they answer in the KomfyEdit panel. Returns the id of the button they pressed, plus the item numbers still ticked when the list was selectable. Use it in place of asking in chat: a chat question is only read after the run has already finished.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short heading for the card, e.g. "Filler words detected".',
        },
        message: {
          type: 'string',
          description: 'Optional sentence explaining what will happen if they confirm.',
        },
        items: {
          type: 'array',
          description: 'What the action would touch, one entry per clip/word/range. Pass every match; the panel shows the first 40 and reports the rest as a count.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short primary text.' },
              detail: { type: 'string', description: 'Secondary text, e.g. a duration or timecode.' },
              highlight: { type: 'boolean', description: 'True for entries the action will actually change.' },
              startSec: { type: 'number', description: 'Where this entry sits on the timeline, in seconds. Pass it and the row becomes clickable: the playhead jumps there, so the user can watch the spot before deciding.' },
              endSec: { type: 'number', description: 'Where the entry ends, in seconds.' },
            },
            required: ['label'],
          },
        },
        actions: {
          type: 'array',
          description: 'Buttons to offer. Defaults to Xác nhận / Huỷ. The chosen id comes back to you.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              style: { type: 'string', enum: ['primary', 'danger', 'secondary'] },
            },
            required: ['id', 'label'],
          },
        },
        taskIndex: {
          type: 'number',
          description: '1-based index of the plan item this question belongs to, so the checklist can point at it.',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID; defaults to the active project.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_propose',
    description: 'Propose an EditPatch for validation and preview semantic diff against the timeline without modifying disk.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses the currently active opened project.',
        },
        patch: {
          type: 'object',
          description: 'The EditPatch object to propose (containing version, description, operations: split_clip, cut_range, delete_clip, move_clip, import_srt, add_subtitle, chunk_subtitles, punch_in_cut, punch_in_sequence, set_mask, set_chroma_key, set_blend_mode, set_canvas, set_timeline_dimensions, set_timeline_background, normalize_audio, duck_audio, etc.).',
        },
      },
      required: ['patch'],
    },
  },
  {
    name: 'edit_apply',
    description: 'Apply a previously proposed EditPatch atomically in a transaction and save changes to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        patchId: {
          type: 'string',
          description: 'The unique patchId returned by edit.propose.',
        },
      },
      required: ['patchId'],
    },
  },
  {
    name: 'edit_undo',
    description: 'Revert the most recent edit applied in this session and restore the project file on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project ID or path.',
        },
      },
    },
  },
  {
    name: 'render_preview',
    description: 'Render a fast, low-resolution (480p) short preview snippet for a specified time interval to visually verify edits without touching the official export.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID or path. If omitted, uses active opened project.',
        },
        timelineId: {
          type: 'string',
          description: 'Optional timeline ID.',
        },
        startTime: {
          type: 'number',
          description: 'Start time in seconds (default 0).',
        },
        endTime: {
          type: 'number',
          description: 'End time in seconds (defaults to startTime + 10).',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (default 10s).',
        },
        resolution: {
          type: 'string',
          enum: ['480p', '360p', '720p'],
          description: 'Resolution of preview (default 480p).',
        },
        wait: {
          type: 'boolean',
          description: 'Whether to wait for render completion before returning (default true).',
        },
      },
    },
  },
  {
    name: 'render_cancel',
    description: 'Cancel an active rendering job (export or preview) by jobId.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID to cancel.',
        },
      },
      required: ['jobId'],
    },
  },
]

export interface KailaEditMcpServerOptions {
  profile?: 'read' | 'edit'
}
export type KomfyEditMcpServerOptions = KailaEditMcpServerOptions

export class KailaEditMcpServer {
  private server: Server
  private profile: 'read' | 'edit'
  private activeProject: Project | null = null
  private activeProjectPath: string | null = null

  private proposedPatches = new Map<
    string,
    {
      patch: EditPatch
      projectPath: string
      rawContentBefore: string
      baseProject: Project
    }
  >()

  private undoStack: Array<{
    projectPath: string
    rawContentBefore: string
    previousProject: Project
    description: string
  }> = []

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

        switch (name) {
          case 'ask_confirm': {
            const projectId = toolArgs.projectId || this.activeProject?.id
            const result = await askConfirmViaLiveBridge(projectId, {
              title: toolArgs.title,
              message: toolArgs.message,
              items: toolArgs.items,
              actions: toolArgs.actions,
              taskIndex: toolArgs.taskIndex,
              selectable: toolArgs.selectable,
            })

            // No app on the other end (offline run, or the panel is closed):
            // say so plainly instead of hanging, so the agent can fall back to
            // asking in its reply rather than assuming a yes.
            if (!result) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    answered: false,
                    reason: 'no_live_editor',
                    hint: 'KomfyEdit is not listening. Do not assume approval — state what you would do and stop.',
                  }, null, 2),
                }],
              }
            }

            if (!result.success || result.timedOut) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    answered: false,
                    reason: result.timedOut ? 'timed_out' : 'failed',
                    error: result.error,
                    hint: 'Treat this as a no. Do not apply the change.',
                  }, null, 2),
                }],
              }
            }

            if (result.dismissed || !result.actionId) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ answered: false, reason: 'dismissed', hint: 'Treat this as a no.' }, null, 2),
                }],
              }
            }

            // A card with checkboxes answers a narrower question than "yes":
            // it says which entries survived. Report the numbers the user left
            // ticked so the agent acts on those and leaves the rest alone.
            const selected = result.selectedItemNumbers
            const itemCount = Array.isArray(toolArgs.items) ? toolArgs.items.length : 0

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  answered: true,
                  action: result.actionId,
                  ...(selected
                    ? {
                        selectedItemNumbers: selected,
                        deselectedItemNumbers: Array.from({ length: itemCount }, (_, index) => index + 1)
                          .filter(number => !selected.includes(number)),
                        hint: selected.length === 0
                          ? 'The user unticked everything. Change nothing.'
                          : 'Act only on selectedItemNumbers; the user removed the rest from the list.',
                      }
                    : {}),
                }, null, 2),
              }],
            }
          }

          case 'project_list': {
            const projects = listProjects(toolArgs.projectsDir)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(projects, null, 2),
                },
              ],
            }
          }

          case 'project_open': {
            const res = readProject(toolArgs.projectId, toolArgs.projectsDir)
            this.activeProject = res.project
            this.activeProjectPath = res.filePath
            const project = res.project
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      id: project.id,
                      name: project.name,
                      createdAt: project.createdAt,
                      updatedAt: project.updatedAt,
                      assetCount: project.assets?.length || 0,
                      timelineCount: project.timelines?.length || 0,
                      activeTimelineId: project.activeTimelineId,
                      timelines: (project.timelines || []).map(t => ({
                        id: t.id,
                        name: t.name,
                        tracks: t.tracks.map(tr => `${tr.name} (${tr.kind || tr.type || 'video'})`),
                        clipCount: t.clips.length,
                        subtitleCount: t.subtitles?.length || 0,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'timeline_describe': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)

            const assetMap = new Map((project.assets || []).map(a => [a.id, a]))
            const tracksDesc = timeline.tracks.map((tr, tIdx) => {
              const clips = timeline.clips
                .filter(c => c.trackIndex === tIdx)
                .sort((a, b) => a.startTime - b.startTime)
                .map(c => {
                  const asset = c.assetId ? assetMap.get(c.assetId) : c.asset
                  const assetPath = asset?.path || ''
                  const isTextClip = c.type === 'text'
                  const defaultName = isTextClip
                    ? (c.textStyle?.text ? `Text: "${c.textStyle.text}"` : 'Text Clip')
                    : (path.basename(assetPath) || `clip_${c.id}`)

                  return {
                    id: c.id,
                    type: c.type || (isTextClip ? 'text' : 'video'),
                    name: c.importedName || defaultName,
                    start: c.startTime,
                    duration: c.duration,
                    end: c.startTime + c.duration,
                    speed: c.speed,
                    volume: c.volume,
                    muted: c.muted,
                    ...(c.linkedClipIds?.length ? { linkedClipIds: c.linkedClipIds } : {}),
                    assetPath,
                    ...(isTextClip && c.textStyle ? { text: c.textStyle.text, textStyle: c.textStyle } : {}),
                    ...(c.filter ? { filter: c.filter } : {}),
                    ...(c.stickerId ? { stickerId: c.stickerId, isSticker: true } : {}),
                    ...(c.keyframes?.length ? { keyframes: c.keyframes } : {}),
                    ...(c.transform ? { transform: c.transform } : {}),
                    ...(c.mask ? { mask: c.mask } : {}),
                    ...(c.chromaKey ? { chromaKey: c.chromaKey } : {}),
                    ...(c.blendMode && c.blendMode !== 'normal' ? { blendMode: c.blendMode } : {}),
                  }
                })

              return {
                id: tr.id,
                name: tr.name,
                kind: tr.kind || tr.type || 'video',
                muted: tr.muted,
                locked: tr.locked,
                clips,
              }
            })

            const subtitleDescs = (timeline.subtitles || []).map((sub, idx) => ({
              index: idx + 1,
              id: sub.id,
              text: sub.text,
              startTime: sub.startTime,
              endTime: sub.endTime,
              duration: sub.endTime - sub.startTime,
              trackIndex: sub.trackIndex,
              style: sub.style,
            }))

            const effDims = getEffectiveTimelineDimensions(timeline, project.assets)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      timelineId: timeline.id,
                      name: timeline.name,
                      variantTag: timeline.variantTag,
                      description: timeline.description,
                      fps: effDims.fps,
                      width: effDims.width,
                      height: effDims.height,
                      aspectRatio: effDims.aspectRatioLabel,
                      background: timeline.background ?? { type: 'color', color: '#000000' },
                      canvas: {
                        width: effDims.width,
                        height: effDims.height,
                        fps: effDims.fps,
                        aspectRatio: effDims.aspectRatioLabel,
                        background: timeline.background ?? { type: 'color', color: '#000000' },
                      },
                      variants: (project.timelines || []).map(tl => ({
                        id: tl.id,
                        name: tl.name,
                        variantTag: tl.variantTag,
                        description: tl.description,
                        clipCount: tl.clips.length,
                        isActive: tl.id === timeline.id,
                      })),
                      tracks: tracksDesc,
                      subtitles: subtitleDescs,
                      // Without this the agent cannot see a transition it just
                      // placed, so it cannot verify the edit and will place it
                      // again. The clips overlap by `duration`, which is also
                      // why the two clip entries appear to run into each other.
                      transitions: (timeline.transitions || []).map(transition => ({
                        leftClipId: transition.leftClipId,
                        rightClipId: transition.rightClipId,
                        trackIndex: transition.trackIndex,
                        type: transition.type,
                        duration: transition.duration,
                      })),
                      markers: (timeline.markers || []).map(marker => ({
                        id: marker.id,
                        time: marker.time,
                        label: marker.label,
                        color: marker.color,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'subtitle_list': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)
            const subtitles = (timeline.subtitles || []).map((sub, idx) => ({
              index: idx + 1,
              id: sub.id,
              text: sub.text,
              startTime: sub.startTime,
              endTime: sub.endTime,
              duration: sub.endTime - sub.startTime,
              trackIndex: sub.trackIndex,
              style: sub.style,
            }))

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      timelineId: timeline.id,
                      name: timeline.name,
                      count: subtitles.length,
                      subtitles,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'timeline_summary': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)
            const summary = timelineSummary(
              { model: project as any } as any,
              { maxBytes: toolArgs.maxBytes },
            )
            return {
              content: [
                {
                  type: 'text',
                  text: summary.text,
                },
              ],
            }
          }

          case 'media_list': {
            const project = this.resolveProject(toolArgs.projectId)
            const assets = (project.assets || []).map(a => ({
              id: a.id,
              type: a.type,
              path: a.path,
              duration: a.duration,
              resolution: a.resolution,
              exists: fs.existsSync(a.path),
              proxyPath: a.proxyPath,
              proxyStatus: a.proxyStatus,
              proxyExists: Boolean(a.proxyPath && fs.existsSync(a.proxyPath)),
            }))
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(assets, null, 2),
                },
              ],
            }
          }

          case 'media_probe': {
            const filePath = this.resolveMediaPath(toolArgs)
            if (!fs.existsSync(filePath)) {
              throw new Error(`Media file not found: ${filePath}`)
            }

            const ffmpeg = findFfmpegPath()
            if (!ffmpeg) throw new Error('ffmpeg binary not found')

            const res = spawnSync(ffmpeg, ['-hide_banner', '-i', filePath], { encoding: 'utf8' })
            const output = (res.stdout || '') + (res.stderr || '')

            const durationMatch = output.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
            const duration = durationMatch
              ? parseFloat(durationMatch[1]) * 3600 + parseFloat(durationMatch[2]) * 60 + parseFloat(durationMatch[3])
              : null

            const videoMatch = output.match(/Stream #\d+:\d+.*Video: ([^,\n]+),.*?(\d+x\d+)/)
            const audioMatch = output.match(/Stream #\d+:\d+.*Audio: ([^,\n]+),.*?(\d+) Hz/)
            const audioInfo = probeAudioStream(ffmpeg, filePath)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      filePath,
                      duration,
                      video: videoMatch ? { codec: videoMatch[1], resolution: videoMatch[2] } : null,
                      audio: audioMatch
                        ? {
                            codec: audioMatch[1],
                            sampleRate: parseInt(audioMatch[2], 10),
                            channels: audioInfo.channels,
                            hasAudio: audioInfo.hasAudio,
                          }
                        : null,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'filter_list': {
            const category = toolArgs.category as string | undefined
            const filters = category
              ? FILTER_DEFINITIONS.filter(f => f.category === category)
              : FILTER_DEFINITIONS
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      categories: FILTER_CATEGORIES,
                      total: filters.length,
                      filters: filters.map(f => ({
                        id: f.id,
                        name: f.name,
                        category: f.category,
                        description: f.description,
                        defaultIntensity: f.defaultIntensity,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'sticker_list': {
            const category = (toolArgs.category as string | undefined)?.toLowerCase()
            const stickers = category === 'animated'
              ? STICKER_DEFINITIONS.filter(s => s.isAnimated)
              : category
                ? STICKER_DEFINITIONS.filter(s => s.category === category)
                : STICKER_DEFINITIONS
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      categories: STICKER_CATEGORIES,
                      total: stickers.length,
                      stickers: stickers.map(s => ({
                        id: s.id,
                        name: s.name,
                        category: s.category,
                        filename: s.filename,
                        keywords: s.keywords,
                        isAnimated: s.isAnimated ?? false,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'sfx_list': {
            const category = (toolArgs.category as string | undefined)?.toLowerCase()
            const sfxItems = category
              ? SFX_DEFINITIONS.filter(s => s.category === category)
              : SFX_DEFINITIONS
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      categories: SFX_CATEGORIES,
                      total: sfxItems.length,
                      sfx: sfxItems.map(s => ({
                        id: s.id,
                        name: s.name,
                        category: s.category,
                        filename: s.filename,
                        duration: s.duration,
                        description: s.description,
                        keywords: s.keywords,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'suggest_broll': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)

            const minDuration = typeof toolArgs.minDuration === 'number' ? toolArgs.minDuration : 5.0
            const maxDuration = typeof toolArgs.maxDuration === 'number' ? toolArgs.maxDuration : 8.0

            const opportunities = detectBrollOpportunities({
              subtitles: timeline.subtitles || [],
              existingClips: timeline.clips || [],
              minDuration,
              maxDuration,
            })

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      total: opportunities.length,
                      opportunities: opportunities.map(o => ({
                        id: o.id,
                        startTime: o.startTime,
                        endTime: o.endTime,
                        duration: o.duration,
                        contextText: o.contextText,
                        keywords: o.keywords,
                        suggestedPrompt: o.suggestedPrompt,
                      })),
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'observe_silence': {
            const filePath = this.resolveMediaPath(toolArgs)
            const intervals = await observeSilence(filePath, {
              noiseDb: toolArgs.noiseDb,
              minDurationSec: toolArgs.minDurationSec,
            })

            let isEntirelySilent = false
            try {
              const ffmpeg = findFfmpegPath()
              if (ffmpeg) {
                const probeRes = spawnSync(ffmpeg, ['-hide_banner', '-i', filePath], { encoding: 'utf8' })
                const durMatch = ((probeRes.stdout || '') + (probeRes.stderr || '')).match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
                const totalDur = durMatch
                  ? parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3])
                  : 0
                if (totalDur > 0 && intervals.length === 1 && intervals[0].start <= 0.5 && intervals[0].duration >= totalDur - 1.0) {
                  isEntirelySilent = true
                }
              }
            } catch {}

            const resultIntervals = intervals.map(item => ({
              ...item,
              ...(isEntirelySilent ? { isEntireFile: true, warning: 'Toàn bộ file media đều là khoảng lặng (không có âm thanh).' } : {}),
            }))

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(resultIntervals, null, 2),
                },
              ],
            }
          }

          case 'observe_scenes': {
            const filePath = this.resolveMediaPath(toolArgs)
            const cuts = await observeScenes(filePath, {
              threshold: toolArgs.threshold,
            })
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(cuts, null, 2),
                },
              ],
            }
          }

          case 'observe_loudness': {
            const filePath = this.resolveMediaPath(toolArgs)
            const loudness = await observeLoudness(filePath)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(loudness, null, 2),
                },
              ],
            }
          }

          case 'observe_filmstrip': {
            const filePath = this.resolveMediaPath(toolArgs)
            const result = await observeFilmstrip({
              mediaPath: filePath,
              startTime: toolArgs.startTime,
              endTime: toolArgs.endTime,
              columns: toolArgs.columns,
              maxWidth: toolArgs.maxWidth,
            })
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            }
          }

          case 'transcribe': {
            const filePath = this.resolveMediaPath(toolArgs)
            if (!fs.existsSync(filePath)) {
              throw new Error(`Media file not found: ${filePath}`)
            }

            const res = await whisperService.transcribe({
              jobId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              filePath,
              startTime: toolArgs.startTime,
              duration: toolArgs.duration,
              endpoint: toolArgs.endpoint,
              apiKey: toolArgs.apiKey,
              model: toolArgs.model,
              language: toolArgs.language,
              prompt: toolArgs.prompt,
            })

            if (!res.success || !res.result) {
              throw new Error(res.error || 'Transcription failed')
            }

            const includeWords = toolArgs.wordTimestamps !== false
            const formattedSegments = res.result.segments.map(s => ({
              id: s.id,
              start: s.start,
              end: s.end,
              duration: Number((s.end - s.start).toFixed(3)),
              text: s.text,
              ...(includeWords && s.words ? { words: s.words } : {}),
            }))

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      text: res.result.text,
                      language: res.result.language,
                      duration: res.result.duration,
                      segmentCount: formattedSegments.length,
                      segments: formattedSegments,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'extract_highlights': {
            let text = toolArgs.transcriptText
            if (!text && toolArgs.filePath) {
              const filePath = path.resolve(toolArgs.filePath)
              if (fs.existsSync(filePath)) {
                const transRes = await whisperService.transcribe({
                  jobId: `hl-${Date.now()}`,
                  filePath,
                  apiKey: toolArgs.apiKey,
                  endpoint: toolArgs.endpoint,
                })
                if (transRes.success && transRes.result) {
                  text = formatTranscriptForHighlights(transRes.result.segments.map(s => ({
                    startTime: s.start,
                    endTime: s.end,
                    text: s.text,
                  })))
                }
              }
            }

            if (!text) {
              // Fallback to subtitles in active project if any
              try {
                const proj = this.resolveProject()
                const tl = this.resolveTimeline(proj)
                if (tl.subtitles && tl.subtitles.length > 0) {
                  text = formatTranscriptForHighlights(tl.subtitles)
                }
              } catch {}
            }

            if (!text) {
              throw new Error('No transcript provided and unable to derive from project or file.')
            }

            const hlRes = await whisperService.analyzeHighlightsWithLlm({
              transcriptText: text,
              apiKey: toolArgs.apiKey,
              endpoint: toolArgs.endpoint,
              model: toolArgs.model,
              maxItems: toolArgs.maxItems,
            })

            if (!hlRes.success || !hlRes.highlights) {
              throw new Error(hlRes.error || 'Highlight extraction failed')
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      count: hlRes.highlights.length,
                      highlights: hlRes.highlights,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'qc_check': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)
            const issues = qcCheck({ model: project as any } as any, {
              fileExists: (p: string) => fs.existsSync(p),
            })
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(issues, null, 2),
                },
              ],
            }
          }

          case 'edit_propose': {
            const project = this.resolveProject(toolArgs.projectId)
            const model: EditorModel = {
              assets: project.assets || [],
              bins: project.bins || { root: [] },
              timelines: project.timelines || [],
              activeTimelineId: project.activeTimelineId || (project.timelines?.[0]?.id ?? null),
            }
            const state = createInitialEditorState(model)
            const validation = validateEditPatch(state, toolArgs.patch)

            if (!validation.valid) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        valid: false,
                        error: validation.error,
                        issues: validation.issues,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }
            }

            const patch = validation.data
            const diff = describePatch(state, patch)
            const patchId = `patch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

            const rawContentBefore = this.activeProjectPath && fs.existsSync(this.activeProjectPath)
              ? fs.readFileSync(this.activeProjectPath, 'utf8')
              : ''

            this.proposedPatches.set(patchId, {
              patch,
              projectPath: this.activeProjectPath || '',
              rawContentBefore,
              baseProject: JSON.parse(JSON.stringify(project)),
            })

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      patchId,
                      valid: true,
                      diff,
                      issues: [],
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'edit_apply': {
            const patchId = toolArgs.patchId
            if (!patchId || !this.proposedPatches.has(patchId)) {
              throw new Error(`Proposed patch "${patchId}" not found or session mismatch. Call edit.propose first.`)
            }

            const entry = this.proposedPatches.get(patchId)!
            const project = entry.baseProject
            const projectId = project.id || this.activeProjectId || ''

            // S5-6: If live app instance is listening for this project, apply via live bridge
            const liveResult = await tryApplyViaLiveBridge(projectId, entry.patch)
            // Which branch handled the write is the single most useful fact when
            // a change is reported as applied but never reaches the timeline.
            process.stderr.write(
              `[komfyedit-mcp] edit_apply project=${projectId} live=${liveResult ? JSON.stringify(liveResult.success) : 'unreachable'} path=${entry.projectPath || '(none)'}
`,
            )
            if (liveResult) {
              if (!liveResult.success) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Commit rejected by live editor: ${liveResult.error}`,
                    },
                  ],
                }
              }

              this.proposedPatches.delete(patchId)
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        description: liveResult.description || 'Applied live to editor store',
                        appliedCount: liveResult.appliedCount ?? entry.patch.operations.length,
                        newRevision: liveResult.newRevision ?? Date.now(),
                        liveApplied: true,
                        undoAvailable: true,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }
            }

            const model: EditorModel = {
              assets: project.assets || [],
              bins: project.bins || { root: [] },
              timelines: project.timelines || [],
              activeTimelineId: project.activeTimelineId || (project.timelines?.[0]?.id ?? null),
            }
            const state = createInitialEditorState(model)
            const applyResult = applyPatch(state, entry.patch)

            if (!applyResult.success) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: `Commit rejected: ${applyResult.error}`,
                  },
                ],
              }
            }

            // Save undo entry
            this.undoStack.push({
              projectPath: entry.projectPath,
              rawContentBefore: entry.rawContentBefore,
              previousProject: entry.baseProject,
              description: applyResult.description,
            })

            const updatedProject: Project = {
              ...entry.baseProject,
              updatedAt: Date.now(),
              assets: applyResult.state.editorModel.assets,
              bins: applyResult.state.editorModel.bins,
              timelines: applyResult.state.editorModel.timelines,
              activeTimelineId: applyResult.state.editorModel.activeTimelineId || entry.baseProject.activeTimelineId,
            }

            if (entry.projectPath) {
              saveProjectAtomic(entry.projectPath, updatedProject)
            } else {
              // Silently returning success here is how an apply could report
              // done while nothing on disk changed.
              throw new Error('Không biết ghi project vào đâu: chưa mở project từ file. Gọi project_open trước.')
            }

            this.activeProject = updatedProject
            this.proposedPatches.delete(patchId)

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      description: applyResult.description,
                      appliedCount: applyResult.appliedCount,
                      newRevision: updatedProject.updatedAt,
                      undoAvailable: true,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'edit_undo': {
            const projectId = this.activeProjectId || this.activeProject?.id || ''
            const liveUndoResult = await tryUndoViaLiveBridge(projectId)
            if (liveUndoResult) {
              if (!liveUndoResult.success) {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Undo failed in live editor: ${liveUndoResult.error}`,
                    },
                  ],
                }
              }
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        description: liveUndoResult.description || 'Reverted last edit in live editor',
                        liveApplied: true,
                        undoAvailable: true,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }
            }

            if (this.undoStack.length === 0) {
              throw new Error('Nothing to undo in this session.')
            }

            const last = this.undoStack.pop()!

            if (last.projectPath && last.rawContentBefore) {
              restoreProjectRawAtomic(last.projectPath, last.rawContentBefore)
            }

            this.activeProject = last.previousProject
            this.activeProjectPath = last.projectPath

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      description: `Reverted: ${last.description}`,
                      currentRevision: last.previousProject.updatedAt,
                      undoAvailable: this.undoStack.length > 0,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'render_preview': {
            const project = this.resolveProject(toolArgs.projectId)
            const timeline = this.resolveTimeline(project, toolArgs.timelineId)

            const startTime = Math.max(0, toolArgs.startTime ?? 0)
            const duration = toolArgs.duration ?? (toolArgs.endTime !== undefined ? Math.max(0.1, toolArgs.endTime - startTime) : 10)
            const endTime = startTime + duration
            const resolution = toolArgs.resolution || '480p'

            // Check if render cache already has this exact segment and settings
            const hash = computeSegmentContentHash({ startTime, endTime }, timeline, resolution)
            const cachedPath = renderCacheManager.getCachePath(hash)
            if (cachedPath && fs.existsSync(cachedPath)) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        jobId: `cached_${hash}`,
                        outputPath: cachedPath,
                        duration,
                        percent: 100,
                        cached: true,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }
            }

            const previewResult = renderQueue.startPreviewJob({
              clips: timeline.clips,
              startTime,
              endTime,
              duration,
              resolution,
              transitions: timeline.transitions,
              background: timeline.background,
              letterbox: timeline.letterbox,
              subtitles: timeline.subtitles,
            })

            if (!previewResult.success) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: `Failed to start preview render: ${previewResult.error}`,
                  },
                ],
              }
            }

            if (toolArgs.wait !== false) {
              const finished = await renderQueue.waitForJob(previewResult.jobId)
              if (finished.status === 'failed') {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: `Preview render failed: ${finished.error}\n${finished.stderr || ''}`,
                    },
                  ],
                }
              }
              if (finished.status === 'cancelled') {
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: 'Preview render was cancelled.',
                    },
                  ],
                }
              }

              // Cache this rendered segment for future preview & playback
              if (previewResult.outputPath && fs.existsSync(previewResult.outputPath)) {
                try {
                  const targetCache = renderCacheManager.getSegmentPath(hash)
                  fs.copyFileSync(previewResult.outputPath, targetCache)
                } catch {}
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        jobId: finished.id,
                        outputPath: previewResult.outputPath,
                        duration: previewResult.duration,
                        percent: 100,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              }
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      jobId: previewResult.jobId,
                      outputPath: previewResult.outputPath,
                      duration: previewResult.duration,
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }

          case 'render_cancel': {
            const success = renderQueue.cancelJob(toolArgs.jobId)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success, jobId: toolArgs.jobId }, null, 2),
                },
              ],
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
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
