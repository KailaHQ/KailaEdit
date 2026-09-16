import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import {
  createInitialEditorState,
  projectSchema,
  saveProjectAtomic,
  undo,
  applyEditPatchToState,
  describePatch,
  type Project,
  type EditPatch,
} from '@komfyedit/core'
import { createEditorStore } from '../frontend/views/editor/editor-store'
import { LiveBridgeServer } from '../electron/editpilot/live-bridge'
import { KomfyEditMcpServer } from '../packages/kailaedit-mcp/src/server'

describe('S5-6 · Ghi qua app đang chạy thay vì qua file (Live Store Bridge)', () => {
  let tmpDir: string
  let projectFile: string
  let liveBridge: LiveBridgeServer | null = null

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'komfyedit-live-test-'))
    projectFile = path.join(tmpDir, 'project.json')
  })

  afterEach(() => {
    if (liveBridge) {
      liveBridge.close()
      liveBridge = null
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    delete process.env.KOMFYEDIT_LIVE_PORT
  })

  it('app is open -> edit_apply updates active store in-memory without reload and syncs disk', async () => {
    const asset = {
      id: 'asset_live_1',
      type: 'video' as const,
      path: '/path/to/media.mp4',
      prompt: 'Primary video',
      resolution: '1920x1080',
      duration: 30,
      createdAt: Date.now(),
    }

    const initialProject: Project = projectSchema.parse({
      version: 2,
      id: 'proj_live_test',
      name: 'Live Bridge Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [asset],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl_live',
          name: 'Main Timeline',
          createdAt: Date.now(),
          tracks: [{ id: 't_v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
          clips: [
            {
              id: 'c1',
              trackIndex: 0,
              startTime: 0,
              duration: 20,
              trimStart: 0,
              trimEnd: 20,
              type: 'video',
              assetId: 'asset_live_1',
              asset,
            },
          ],
        },
      ],
      activeTimelineId: 'tl_live',
    })

    saveProjectAtomic(projectFile, initialProject)

    // Simulate active in-memory Zustand store in the app
    const store = createEditorStore(createInitialEditorState({
      assets: initialProject.assets || [],
      bins: initialProject.bins || { root: 'Default' },
      timelines: initialProject.timelines || [],
      activeTimelineId: 'tl_live',
    }))

    expect(store.getState().state.editorModel.timelines[0].clips.length).toBe(1)
    expect(store.getState().state.history.undoStack.length).toBe(0)

    // Start Live Bridge Server for this project
    liveBridge = new LiveBridgeServer('proj_live_test')
    const port = await liveBridge.start()
    process.env.KOMFYEDIT_LIVE_PORT = String(port)

    // Wire simulated renderer listener to the live bridge
    const onLiveBridgeApply = async (patch: EditPatch) => {
      let diff = ''
      store.getState().setStateWithHistory(prev => {
        diff = describePatch(prev, patch)
        return applyEditPatchToState(prev, patch)
      })

      // Sync to disk
      const updatedModel = store.getState().state.editorModel
      const updatedProj: Project = {
        ...initialProject,
        updatedAt: Date.now(),
        assets: updatedModel.assets,
        bins: updatedModel.bins,
        timelines: updatedModel.timelines,
        activeTimelineId: updatedModel.activeTimelineId || initialProject.activeTimelineId,
      }
      saveProjectAtomic(projectFile, updatedProj)

      return {
        success: true,
        description: diff,
        appliedCount: patch.operations.length,
        newRevision: updatedProj.updatedAt,
      }
    }

    // Connect bridge request handler
    ;(liveBridge as any).handleMessage = async (socket: any, msg: any) => {
      if (msg.action === 'apply_patch') {
        try {
          const result = await onLiveBridgeApply(msg.patch)
          socket.write(JSON.stringify(result) + '\n')
        } catch (err: any) {
          socket.write(JSON.stringify({ success: false, error: err.message }) + '\n')
        }
        return
      }
      if (msg.action === 'undo') {
        store.getState().setStateWithoutHistory(prev => undo(prev))
        socket.write(JSON.stringify({ success: true, description: 'Reverted edit' }) + '\n')
        return
      }
      socket.write(JSON.stringify({ success: false, error: 'Unknown' }) + '\n')
    }

    // Now call edit_propose and edit_apply via MCP server
    const server = new KomfyEditMcpServer({ profile: 'edit' })
    const callTool = async (name: string, args: any) => {
      const res = await (server as any).server._requestHandlers.get('tools/call')({
        method: 'tools/call',
        params: { name, arguments: args },
      })
      if (res.isError) throw new Error(res.content?.[0]?.text || 'Tool call error')
      return JSON.parse(res.content[0].text)
    }

    const splitPatch: EditPatch = {
      version: 1,
      description: 'Tách clip c1 tại giây 5.0',
      operations: [
        {
          op: 'split_clip',
          clipId: 'c1',
          splitTime: 5.0,
        },
      ],
    }

    const proposeRes = await callTool('edit_propose', { projectId: projectFile, patch: splitPatch })
    expect(proposeRes.valid).toBe(true)
    expect(proposeRes.patchId).toBeDefined()

    const applyRes = await callTool('edit_apply', { projectId: projectFile, patchId: proposeRes.patchId })
    expect(applyRes.success).toBe(true)
    expect(applyRes.liveApplied).toBe(true)

    // 1. Assert store in memory was updated DIRECTLY without full reload
    const currentClips = store.getState().state.editorModel.timelines[0].clips
    expect(currentClips.length).toBe(2)
    expect(currentClips[0].duration).toBe(5)
    expect(currentClips[1].duration).toBe(15)

    // 2. Assert disk is also synced
    const diskProject = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Project
    expect(diskProject.timelines[0].clips.length).toBe(2)

    // 3. Assert exactly 1 undo step was created in the store
    expect(store.getState().state.history.undoStack.length).toBe(1)

    // 4. Undo once -> restores state before edit in exactly 1 step
    const undoRes = await callTool('edit_undo', { projectId: projectFile })
    expect(undoRes.success).toBe(true)
    expect(undoRes.liveApplied).toBe(true)

    const clipsAfterUndo = store.getState().state.editorModel.timelines[0].clips
    expect(clipsAfterUndo.length).toBe(1)
    expect(clipsAfterUndo[0].duration).toBe(20)
  })

  it('app is not open -> falls back to atomic file write on disk', async () => {
    // Delete live port to ensure app appears closed
    delete process.env.KOMFYEDIT_LIVE_PORT

    const asset = {
      id: 'asset_offline',
      type: 'video' as const,
      path: '/path/to/media.mp4',
      prompt: 'Video',
      resolution: '1920x1080',
      duration: 10,
      createdAt: Date.now(),
    }

    const initialProject: Project = projectSchema.parse({
      version: 2,
      id: 'proj_offline',
      name: 'Offline Fallback Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [asset],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl_offline',
          name: 'Main Timeline',
          createdAt: Date.now(),
          tracks: [{ id: 't_v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
          clips: [
            {
              id: 'c_off',
              trackIndex: 0,
              startTime: 0,
              duration: 10,
              trimStart: 0,
              trimEnd: 10,
              type: 'video',
              assetId: 'asset_offline',
              asset,
            },
          ],
        },
      ],
      activeTimelineId: 'tl_offline',
    })

    saveProjectAtomic(projectFile, initialProject)

    const server = new KomfyEditMcpServer({ profile: 'edit' })
    const callTool = async (name: string, args: any) => {
      const res = await (server as any).server._requestHandlers.get('tools/call')({
        method: 'tools/call',
        params: { name, arguments: args },
      })
      if (res.isError) throw new Error(res.content?.[0]?.text || 'Tool call error')
      return JSON.parse(res.content[0].text)
    }

    const cutPatch: EditPatch = {
      version: 1,
      description: 'Cut pause',
      operations: [
        {
          op: 'cut_range',
          startTime: 3.0,
          endTime: 6.0,
        },
      ],
    }

    const proposeRes = await callTool('edit_propose', { projectId: projectFile, patch: cutPatch })
    const applyRes = await callTool('edit_apply', { projectId: projectFile, patchId: proposeRes.patchId })

    expect(applyRes.success).toBe(true)
    // Offline mode does not have liveApplied: true
    expect(applyRes.liveApplied).toBeUndefined()

    // Assert disk project was updated directly
    const updatedDisk = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Project
    expect(updatedDisk.timelines[0].clips.length).toBe(2)
  })

  it('patch violating invariants is rejected -> neither store nor disk is mutated', async () => {
    const asset = {
      id: 'asset_locked',
      type: 'video' as const,
      path: '/path/to/media.mp4',
      prompt: 'Video',
      resolution: '1920x1080',
      duration: 10,
      createdAt: Date.now(),
    }

    const initialProject: Project = projectSchema.parse({
      version: 2,
      id: 'proj_locked_test',
      name: 'Locked Track Guard',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [asset],
      bins: { root: 'Default' },
      timelines: [
        {
          id: 'tl_locked',
          name: 'Main Timeline',
          createdAt: Date.now(),
          tracks: [
            { id: 't_v1', name: 'V1', muted: false, locked: false, kind: 'video' },
            { id: 't_v2_locked', name: 'V2 Locked', muted: false, locked: true, kind: 'video' },
          ],
          clips: [
            {
              id: 'c_locked',
              trackIndex: 1,
              startTime: 0,
              duration: 10,
              trimStart: 0,
              trimEnd: 10,
              type: 'video',
              assetId: 'asset_locked',
              asset,
            },
          ],
        },
      ],
      activeTimelineId: 'tl_locked',
    })

    saveProjectAtomic(projectFile, initialProject)

    const store = createEditorStore(createInitialEditorState({
      assets: initialProject.assets || [],
      bins: initialProject.bins || { root: 'Default' },
      timelines: initialProject.timelines || [],
      activeTimelineId: 'tl_locked',
    }))

    // Start Live Bridge
    liveBridge = new LiveBridgeServer('proj_locked_test')
    const port = await liveBridge.start()
    process.env.KOMFYEDIT_LIVE_PORT = String(port)

    ;(liveBridge as any).handleMessage = async (socket: any, msg: any) => {
      if (msg.action === 'apply_patch') {
        try {
          store.getState().setStateWithHistory(prev => applyEditPatchToState(prev, msg.patch))
          socket.write(JSON.stringify({ success: true }) + '\n')
        } catch (err: any) {
          socket.write(JSON.stringify({ success: false, error: err.message }) + '\n')
        }
      }
    }

    // Invalid patch modifying locked track
    const invalidPatch: EditPatch = {
      version: 1,
      description: 'Delete clip on locked track',
      operations: [
        {
          op: 'delete_clip',
          clipId: 'c_locked',
        },
      ],
    }

    const server = new KomfyEditMcpServer({ profile: 'edit' })
    const res = await (server as any).server._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'edit_propose',
        arguments: { projectId: projectFile, patch: invalidPatch },
      },
    })

    // propose rejects locked track
    const proposeParsed = JSON.parse(res.content[0].text)
    expect(proposeParsed.valid).toBe(false)
    expect(proposeParsed.error).toMatch(/locked track/i)

    // Assert memory and disk remain 100% intact
    expect(store.getState().state.editorModel.timelines[0].clips.length).toBe(1)
    const diskContent = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as Project
    expect(diskContent.timelines[0].clips.length).toBe(1)
  })
})
