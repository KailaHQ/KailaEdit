import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { handleReadTool } from '../packages/kailaedit-mcp/src/tools/read-tools'
import type { McpServerContext } from '../packages/kailaedit-mcp/src/tools/types'
import { computeStabilizationFingerprint, DEFAULT_CLIP_STABILIZATION, type Project } from '@komfyedit/core'
import { createMockClip, createMockTimeline } from '../core/tests/edit-patch-test-helpers'

let dir: string
let bakePath: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaila-mcp-stab-'))
  bakePath = path.join(dir, 'stab.mp4')
  fs.writeFileSync(bakePath, 'not really a video')
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function projectWith(clips: ReturnType<typeof createMockClip>[]): Project {
  const asset = { id: 'asset-1', type: 'video' as const, path: 'C:/media/IMG_4692.MOV', prompt: '', resolution: '', duration: 152.5, createdAt: 0 }
  const timeline = createMockTimeline(clips.map(c => ({ ...c, asset })))
  return {
    version: 2, id: 'p', name: 'p', createdAt: 0, updatedAt: 0, bins: {},
    assets: [asset], timelines: [timeline], activeTimelineId: timeline.id,
  } as Project
}

async function describeTimeline(project: Project) {
  const ctx = {
    resolveProject: () => project,
    resolveTimeline: (p: Project) => p.timelines[0],
  } as unknown as McpServerContext
  const res = await handleReadTool('timeline_describe', {}, ctx)
  const parsed = JSON.parse(res!.content[0].text)
  return parsed.tracks.flatMap((t: { clips: unknown[] }) => t.clips) as Array<Record<string, any>>
}

describe('timeline_describe: stabilization', () => {
  const range = { sourceStart: 73, sourceSpan: 10 }
  const readyStab = () => ({
    ...DEFAULT_CLIP_STABILIZATION,
    bake: {
      path: bakePath,
      fingerprint: computeStabilizationFingerprint({ smoothing: 20, mode: 'auto', ...range }),
      createdAt: 0, ...range, assetKey: 'asset-1', zoomPercent: 6.03,
      warnings: ['occlusion' as const], warningTimes: [79.067],
    },
  })

  it('reports the state of a stabilized clip, and nothing for a plain one', async () => {
    const clips = await describeTimeline(projectWith([
      createMockClip({ id: 'plain', startTime: 0, duration: 10 }),
      createMockClip({ id: 'stab', startTime: 10, trimStart: 74, duration: 8, trimEnd: 70.5, stabilization: readyStab() }),
    ]))
    expect(clips.find(c => c.id === 'plain')?.stabilization).toBeUndefined()
    expect(clips.find(c => c.id === 'stab')?.stabilization).toEqual({
      enabled: true, smoothing: 20, mode: 'auto', status: 'ready', bakeReady: true,
      zoomPercent: 6.03, warnings: ['occlusion'], occlusionTimes: [15.067], bakePath,
    })
  })

  it('tells the agent a bake is on its way, or that its file is gone', async () => {
    const [pending] = await describeTimeline(projectWith([
      createMockClip({ id: 'c', stabilization: { ...DEFAULT_CLIP_STABILIZATION } }),
    ]))
    expect(pending.stabilization).toMatchObject({ status: 'pending', bakeReady: false })

    const gone = readyStab()
    gone.bake.path = path.join(dir, 'gone.mp4')
    const [missing] = await describeTimeline(projectWith([
      createMockClip({ id: 'c', startTime: 10, trimStart: 74, duration: 8, trimEnd: 70.5, stabilization: gone }),
    ]))
    expect(missing.stabilization).toMatchObject({ status: 'missing', bakeReady: false })
  })

  // The matte covers the whole original, so it also covers the seconds the stabilized clip
  // plays (1..9 of its bake): only the media key can say it is of the wrong file.
  it('reports a matte of the original as not ready on a stabilized clip', async () => {
    const matteBakePath = path.join(dir, 'alpha.mp4')
    fs.writeFileSync(matteBakePath, 'alpha')
    const autoMatte = {
      enabled: true, model: 'rvm-mobilenetv3' as const, quality: 'standard' as const, featherEdge: 0, cleanEdge: 0,
      bake: { path: matteBakePath, fingerprint: 'm', frameCount: 4575, createdAt: 0, sourceStart: 0, sourceSpan: 152.5, speed: 1,
        assetKey: 'c:\\media\\img_4692.mov' },
    }
    const [unstabilized] = await describeTimeline(projectWith([
      createMockClip({ id: 'c', startTime: 10, trimStart: 74, duration: 8, trimEnd: 70.5, autoMatte }),
    ]))
    expect(unstabilized.autoMatte.bakeReady).toBe(true)

    const [stabilized] = await describeTimeline(projectWith([
      createMockClip({ id: 'c', startTime: 10, trimStart: 74, duration: 8, trimEnd: 70.5, autoMatte, stabilization: readyStab() }),
    ]))
    expect(stabilized.autoMatte.bakeReady).toBe(false)
  })
})
