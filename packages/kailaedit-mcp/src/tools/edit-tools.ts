import fs from 'fs'
import {
  validateEditPatch,
  describePatch,
  applyPatch,
  createInitialEditorState,
  saveProjectAtomic,
  restoreProjectRawAtomic,
  computeSegmentContentHash,
  type EditorModel,
  type Project,
} from '@komfyedit/core'
import { renderQueue } from '../../../../electron/export/render-queue.ts'
import { renderCacheManager } from '../../../../electron/export/render-cache-manager.ts'
import {
  askConfirmViaLiveBridge,
  tryApplyViaLiveBridge,
  tryUndoViaLiveBridge,
} from '../live-bridge-client.ts'
import type { McpServerContext, McpToolResponse } from './types.ts'

export async function handleEditTool(
  name: string,
  toolArgs: Record<string, any>,
  ctx: McpServerContext,
): Promise<McpToolResponse | null> {
  switch (name) {
    case 'ask_confirm': {
      const projectId = toolArgs.projectId || ctx.activeProject?.id
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

    case 'edit_propose': {
      const project = ctx.resolveProject(toolArgs.projectId)
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

      const rawContentBefore = ctx.activeProjectPath && fs.existsSync(ctx.activeProjectPath)
        ? fs.readFileSync(ctx.activeProjectPath, 'utf8')
        : ''

      ctx.proposedPatches.set(patchId, {
        patch,
        projectPath: ctx.activeProjectPath || '',
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
      if (!patchId || !ctx.proposedPatches.has(patchId)) {
        throw new Error(`Proposed patch "${patchId}" not found or session mismatch. Call edit.propose first.`)
      }

      const entry = ctx.proposedPatches.get(patchId)!
      const project = entry.baseProject
      const projectId = project.id || (ctx as any).activeProjectId || ''

      // S5-6: If live app instance is listening for this project, apply via live bridge
      const liveResult = await tryApplyViaLiveBridge(projectId, entry.patch)
      // Which branch handled the write is the single most useful fact when
      // a change is reported as applied but never reaches the timeline.
      process.stderr.write(
        `[komfyedit-mcp] edit_apply project=${projectId} live=${liveResult ? JSON.stringify(liveResult.success) : 'unreachable'} path=${entry.projectPath || '(none)'}\n`,
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

        ctx.proposedPatches.delete(patchId)
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
      ctx.undoStack.push({
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

      ctx.setActiveProject(updatedProject, entry.projectPath)
      ctx.proposedPatches.delete(patchId)

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
      const projectId = (ctx as any).activeProjectId || ctx.activeProject?.id || ''
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

      if (ctx.undoStack.length === 0) {
        throw new Error('Nothing to undo in this session.')
      }

      const last = ctx.undoStack.pop()!

      if (last.projectPath && last.rawContentBefore) {
        restoreProjectRawAtomic(last.projectPath, last.rawContentBefore)
      }

      ctx.setActiveProject(last.previousProject, last.projectPath)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                description: `Reverted: ${last.description}`,
                currentRevision: last.previousProject.updatedAt,
                undoAvailable: ctx.undoStack.length > 0,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'render_preview': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const timeline = ctx.resolveTimeline(project, toolArgs.timelineId)

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
      return null
  }
}
