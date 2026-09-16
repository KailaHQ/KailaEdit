import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import {
  KomfyEditMcpServer,
} from '../packages/kailaedit-mcp/src/server'
import {
  projectSchema,
  saveProjectAtomic,
  type Project,
  type EditPatch,
} from '@komfyedit/core'

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures')
const SYNTHETIC_MEDIA = path.join(FIXTURES_DIR, 'synthetic_media.mp4')
const ROOT_DIR = path.resolve(__dirname, '..')

describe('KE-1201 · Skill auto-edit', () => {
  let tmpDir: string
  let projectFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-auto-edit-test-'))
    projectFile = path.join(tmpDir, 'project.json')
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('all host stubs (.claude, .cursor, .codex) exist and resolve correctly via relative paths', () => {
    const stubs = [
      path.join(ROOT_DIR, '.claude/skills/auto-edit/SKILL.md'),
      path.join(ROOT_DIR, '.claude/skills/auto-edit.md'),
      path.join(ROOT_DIR, '.cursor/rules/auto-edit.mdc'),
      path.join(ROOT_DIR, '.cursor/skills/auto-edit/SKILL.md'),
      path.join(ROOT_DIR, '.codex/skills/auto-edit/SKILL.md'),
      path.join(ROOT_DIR, '.codex/skills/auto-edit.md'),
    ]

    const targetSkillFile = path.join(ROOT_DIR, 'docs/skills/auto-edit.md')
    expect(fs.existsSync(targetSkillFile)).toBe(true)

    for (const stubPath of stubs) {
      expect(fs.existsSync(stubPath)).toBe(true)
      const content = fs.readFileSync(stubPath, 'utf-8')
      const match = content.match(/@([^\r\n]+)/)
      expect(match).not.toBeNull()
      const relativeRef = match![1].trim()

      const resolved = path.resolve(path.dirname(stubPath), relativeRef)
      expect(fs.existsSync(resolved)).toBe(true)
      expect(path.normalize(resolved)).toBe(path.normalize(targetSkillFile))
    }
  })

  it('docs/skills/auto-edit.md defines mandatory sequence, density limits, safety rules, and step skipping', () => {
    const skillPath = path.join(ROOT_DIR, 'docs/skills/auto-edit.md')
    const content = fs.readFileSync(skillPath, 'utf-8')

    // Frontmatter
    expect(content).toMatch(/name:\s*auto-edit/)
    expect(content).toMatch(/description:/)

    // Hard stops
    expect(content).toMatch(/Safety Rules & Constraints \(HARD STOPS\)/i)
    expect(content).toMatch(/NO DIRECT FFMPEG CALLS/i)
    expect(content).toMatch(/REUSE STORED TRANSCRIPT/i)
    expect(content).toMatch(/NEVER SELF-BROLL/i)
    expect(content).toMatch(/DO NOT ASSUME TRACK 0 IS BASE FOOTAGE/i)
    expect(content).toMatch(/ENFORCE EXPLICIT DENSITY LIMITS/i)
    expect(content).toMatch(/BLOCKING HUMAN INSPECTION GATE/i)

    // Sequence tools
    expect(content).toMatch(/timeline_describe/)
    expect(content).toMatch(/observe_silence/)
    expect(content).toMatch(/chunk_subtitles/)
    expect(content).toMatch(/suggest_broll/)
    expect(content).toMatch(/punch_in_sequence/)
    expect(content).toMatch(/qc_check/)
    expect(content).toMatch(/render_preview/)
    expect(content).toMatch(/ask_confirm/)
    expect(content).toMatch(/edit_apply/)

    // Density limits with explicit numbers
    expect(content).toMatch(/1 overlay every 4\.0s/i)
    expect(content).toMatch(/1 punch-in cut every 8\.0s/i)
    expect(content).toMatch(/3 – 5 words per chunk/i)

    // Interactive confirmation with startSec
    expect(content).toMatch(/startSec/)
  })

  it('executes full end-to-end auto-edit orchestration sequence via KomfyEdit MCP tools', async () => {
    const primaryAsset = {
      id: 'asset_primary',
      type: 'video' as const,
      path: SYNTHETIC_MEDIA,
      prompt: '',
      resolution: '1920x1080',
      duration: 30,
      createdAt: Date.now(),
    }

    const secondaryBrollAsset = {
      id: 'asset_broll_1',
      type: 'video' as const,
      path: SYNTHETIC_MEDIA,
      prompt: 'B-roll footage',
      resolution: '1920x1080',
      duration: 10,
      createdAt: Date.now(),
    }

    const initialProject: Project = projectSchema.parse({
      version: 2,
      id: 'proj_auto_edit',
      name: 'Auto Edit Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [primaryAsset, secondaryBrollAsset],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl_main',
          name: 'Main Timeline',
          createdAt: Date.now(),
          tracks: [
            {
              id: 't_v1',
              name: 'V1',
              muted: false,
              locked: false,
              kind: 'video',
            },
            {
              id: 't_v2',
              name: 'V2',
              muted: false,
              locked: false,
              kind: 'video',
            },
          ],
          clips: [
            {
              id: 'clip_main_1',
              trackIndex: 0,
              startTime: 0,
              duration: 20,
              trimStart: 0,
              trimEnd: 20,
              type: 'video',
              assetId: 'asset_primary',
              asset: primaryAsset,
            },
          ],
          subtitles: [],
        },
      ],
      activeTimelineId: 'tl_main',
    })

    saveProjectAtomic(projectFile, initialProject)
    const server = new KomfyEditMcpServer({ profile: 'edit' })
    const callTool = async (name: string, args: any) => {
      const res = await (server as any).server._requestHandlers.get('tools/call')({
        method: 'tools/call',
        params: { name, arguments: args },
      })
      if (res.isError) {
        throw new Error(`Tool ${name} failed: ${res.content[0].text}`)
      }
      return JSON.parse(res.content[0].text)
    }

    // Step 1: timeline_describe
    const descResult = await callTool('timeline_describe', { projectId: projectFile })
    expect(descResult.timelineId).toBe('tl_main')
    expect(descResult.tracks.length).toBe(2)
    expect(descResult.tracks[0].clips.length).toBe(1)

    // Step 2 & 3: observe_silence
    const silenceResult = await callTool('observe_silence', {
      filePath: SYNTHETIC_MEDIA,
      noiseDb: -30,
      minDurationSec: 0.5,
    })
    expect(Array.isArray(silenceResult)).toBe(true)

    // Step 4, 5, 6: Propose comprehensive Auto-Edit patch
    // Includes:
    // 1. Cut silence (split_clip)
    // 2. Add subtitles + chunking
    // 3. Insert B-roll overlay on V2
    // 4. Punch-in sequence
    const autoEditPatch: EditPatch = {
      version: 1,
      description: 'Auto-edit: cut silence, smart captions, B-roll, dynamic zoom',
      operations: [
        {
          op: 'split_clip',
          clipId: 'clip_main_1',
          splitTime: 5.0,
        },
        {
          op: 'add_subtitle',
          text: 'Chào mừng các bạn đến với video hướng dẫn hôm nay',
          startTime: 0.5,
          endTime: 4.5,
          preset: 'tiktok-classic',
        },
        {
          op: 'add_subtitle',
          text: 'Chúng ta sẽ cùng tìm hiểu quy trình tự động hoá',
          startTime: 6.0,
          endTime: 10.0,
          preset: 'tiktok-classic',
        },
        {
          op: 'chunk_subtitles',
          minWords: 3,
          maxWords: 5,
        },
        {
          op: 'insert_broll',
          assetId: 'asset_broll_1',
          startTime: 6.0,
          duration: 3.5,
          trackIndex: 1,
          fadeIn: 0.25,
          fadeOut: 0.25,
          muteAudio: true,
        },
        {
          op: 'punch_in_sequence',
          trackIndex: 0,
          scale: 115,
          startWithZoom: false,
        },
      ],
    }

    const proposeResult = await callTool('edit_propose', {
      projectId: projectFile,
      patch: autoEditPatch,
    })
    expect(proposeResult.valid).toBe(true)
    expect(proposeResult.patchId).toBeDefined()
    expect(typeof proposeResult.diff).toBe('string')

    // Step 7A: qc_check
    const qcResult = await callTool('qc_check', {
      projectId: projectFile,
    })
    expect(Array.isArray(qcResult)).toBe(true)
    expect(qcResult.length).toBe(0)

    // Step 7B: render_preview
    const previewResult = await callTool('render_preview', {
      projectId: projectFile,
      startTime: 0,
      duration: 3,
      resolution: '480p',
      wait: true,
    })
    expect(previewResult.success).toBe(true)
    expect(fs.existsSync(previewResult.outputPath)).toBe(true)

    // Step 7C: edit_apply
    const applyResult = await callTool('edit_apply', {
      projectId: projectFile,
      patchId: proposeResult.patchId,
    })
    expect(applyResult.success).toBe(true)

    // Verify persisted project state on disk
    const updatedRaw = JSON.parse(fs.readFileSync(projectFile, 'utf-8'))
    const activeTimeline = updatedRaw.timelines.find((t: any) => t.id === 'tl_main')

    // 1. Primary track clips split (should have 2 clips now)
    const track0Clips = activeTimeline.clips.filter((c: any) => c.trackIndex === 0)
    expect(track0Clips.length).toBe(2)

    // 2. B-roll inserted on track 1
    const track1Clips = activeTimeline.clips.filter((c: any) => c.trackIndex === 1)
    expect(track1Clips.length).toBe(1)
    expect(track1Clips[0].assetId).toBe('asset_broll_1')
    expect(track1Clips[0].muted).toBe(true)

    // 3. Punch-in sequence applied transform scale 115% on second clip
    expect(track0Clips[1].transform).toBeDefined()
    expect(track0Clips[1].transform.scale).toBe(115)

    // 4. Subtitles present and chunked
    expect(activeTimeline.subtitles.length).toBeGreaterThan(0)
  }, 30000)
})
