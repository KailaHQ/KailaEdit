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

describe('S4-3 · Skill cut-silence', () => {
  let tmpDir: string
  let projectFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-skill-test-'))
    projectFile = path.join(tmpDir, 'project.json')
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('all three host stubs (.claude, .cursor, .codex) exist and resolve correctly via relative paths', () => {
    const stubs = [
      path.join(ROOT_DIR, '.claude/skills/cut-silence/SKILL.md'),
      path.join(ROOT_DIR, '.claude/skills/cut-silence.md'),
      path.join(ROOT_DIR, '.cursor/rules/cut-silence.mdc'),
      path.join(ROOT_DIR, '.cursor/skills/cut-silence/SKILL.md'),
      path.join(ROOT_DIR, '.codex/skills/cut-silence/SKILL.md'),
      path.join(ROOT_DIR, '.codex/skills/cut-silence.md'),
    ]

    const targetSkillFile = path.join(ROOT_DIR, 'docs/skills/cut-silence.md')
    expect(fs.existsSync(targetSkillFile)).toBe(true)
    const targetContent = fs.readFileSync(targetSkillFile, 'utf-8')

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

  it('docs/skills/cut-silence.md defines the mandatory sequence, thresholds, and prohibits raw ffmpeg calls', () => {
    const skillPath = path.join(ROOT_DIR, 'docs/skills/cut-silence.md')
    const content = fs.readFileSync(skillPath, 'utf-8')

    // Mandatory sequence
    expect(content).toMatch(/observe_silence/)
    expect(content).toMatch(/edit_propose/)
    expect(content).toMatch(/render_preview/)
    expect(content).toMatch(/qc_check/)
    expect(content).toMatch(/edit_apply/)

    // Thresholds
    expect(content).toMatch(/-30dB/)
    expect(content).toMatch(/2\.0s/)
    expect(content).toMatch(/0\.5s/)

    // Prohibits raw ffmpeg
    expect(content).toMatch(/NO DIRECT FFMPEG CALLS|Never run raw `ffmpeg`/i)
  })

  it('executes full end-to-end cut-silence sequence via KomfyEdit MCP tools without direct ffmpeg', async () => {
    const asset = {
      id: 'asset_1',
      type: 'video' as const,
      path: SYNTHETIC_MEDIA,
      prompt: '',
      resolution: '1920x1080',
      duration: 30,
      createdAt: Date.now(),
    }

    const initialProject: Project = projectSchema.parse({
      version: 2,
      id: 'proj_cut_silence',
      name: 'Cut Silence Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [asset],
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
          ],
          clips: [
            {
              id: 'c1',
              trackIndex: 0,
              startTime: 0,
              duration: 20,
              trimStart: 0,
              trimEnd: 20,
              type: 'video',
              assetId: 'asset_1',
              asset,
            },
          ],
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
      expect(res.isError).toBeFalsy()
      return JSON.parse(res.content[0].text)
    }

    // Step 1: observe_silence
    const silenceResult = await callTool('observe_silence', {
      filePath: SYNTHETIC_MEDIA,
      noiseDb: -30,
      minDurationSec: 0.5,
    })
    expect(Array.isArray(silenceResult)).toBe(true)
    expect(silenceResult.length).toBeGreaterThan(0)
    expect(silenceResult[0]).toHaveProperty('start')
    expect(silenceResult[0]).toHaveProperty('end')

    // Step 2: edit_propose
    const cutPatch: EditPatch = {
      version: 1,
      description: 'Cut silence interval on V1',
      operations: [
        {
          op: 'split_clip',
          clipId: 'c1',
          splitTime: 5,
        },
      ],
    }

    const proposeResult = await callTool('edit_propose', {
      projectId: projectFile,
      patch: cutPatch,
    })
    expect(proposeResult.valid).toBe(true)
    expect(proposeResult.patchId).toBeDefined()
    const patchId = proposeResult.patchId

    // Step 3: Human inspects diff (verify human-readable diff summary exists)
    expect(typeof proposeResult.diff).toBe('string')
    expect(proposeResult.diff.length).toBeGreaterThan(0)

    // Step 4: render.preview (render snippet)
    const previewResult = await callTool('render_preview', {
      projectId: projectFile,
      startTime: 0,
      duration: 3,
      resolution: '480p',
      wait: true,
    })
    expect(previewResult.success).toBe(true)
    expect(fs.existsSync(previewResult.outputPath)).toBe(true)

    // Step 5: qc.check
    const qcResult = await callTool('qc_check', {
      projectId: projectFile,
    })
    expect(Array.isArray(qcResult)).toBe(true)
    expect(qcResult.length).toBe(0)

    // Step 6: edit.apply
    const applyResult = await callTool('edit_apply', {
      projectId: projectFile,
      patchId,
    })
    expect(applyResult.success).toBe(true)

    // Verify project has 2 clips now
    const updatedRaw = JSON.parse(fs.readFileSync(projectFile, 'utf-8'))
    expect(updatedRaw.timelines[0].clips.length).toBe(2)
  }, 30000)
})
