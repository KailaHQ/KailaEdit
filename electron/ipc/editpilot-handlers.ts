import { handle } from './typed-handle'
import {
  detectAgents,
  readEditPilotConfig,
  writeEditPilotConfig,
} from '../editpilot/agent-detect'
import { resolveActiveAgent, type EditPilotConfig } from '../../core/src/editpilot-agents'
import { cancelRun, registerMcpServer, startRun } from '../editpilot/agent-runner'
import { getProjectsDir } from '../storage/project-file-storage'
import { handleLivePatchResponse, handleLiveConfirmResponse, handleLiveUndoResponse } from '../editpilot/live-bridge'

export function registerEditPilotHandlers(): void {
  handle('editPilotDetectAgents', async () => {
    const config = readEditPilotConfig()
    const agents = await detectAgents(config)
    return {
      agents,
      config,
      activeAgentId: resolveActiveAgent(config, agents),
    }
  })

  handle('editPilotGetConfig', () => readEditPilotConfig())

  handle('editPilotSetConfig', ({ defaultAgentId, commandOverrides }) => {
    const current = readEditPilotConfig()
    const next: EditPilotConfig = {
      defaultAgentId,
      // Omitting overrides means "leave them alone", not "clear them".
      commandOverrides: commandOverrides ?? current.commandOverrides,
    }
    return writeEditPilotConfig(next)
  })

  handle('editPilotSend', async ({ runId, prompt, projectsDir, projectId, projectName, references, resumeSessionId }) => {
    if (!projectId || !projectId.trim()) {
      return {
        success: false as const,
        error: 'No project is currently open. Please open a project before using EditPilot.',
      }
    }
    const resolvedProjectsDir = projectsDir?.trim() || getProjectsDir()
    try {
      const { agentLabel } = await startRun({
        runId,
        prompt,
        projectsDir: resolvedProjectsDir,
        projectId: projectId.trim(),
        projectName,
        references,
        resumeSessionId,
      })
      return { success: true as const, agentLabel }
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('editPilotRegisterMcp', ({ agentId }) => registerMcpServer(agentId))

  handle('editPilotCancel', ({ runId }) => {
    cancelRun(runId)
    return { success: true as const }
  })

  handle('editPilotRespondLivePatch', input => {
    handleLivePatchResponse(input)
    return { success: true as const }
  })

  handle('editPilotRespondLiveConfirm', input => {
    handleLiveConfirmResponse(input)
    return { success: true as const }
  })

  handle('editPilotRespondLiveUndo', input => {
    handleLiveUndoResponse(input)
    return { success: true as const }
  })
}
