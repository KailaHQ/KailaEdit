import { z } from 'zod'
import { ipcResult, emptyResult } from './common-schemas'
import { editPilotConfirmAnswerSchema } from '../../core/src/editpilot-confirm'
import {
  EDIT_PILOT_AGENT_IDS,
  editPilotAgentStatusSchema,
  editPilotCommandOverridesSchema,
  editPilotConfigSchema,
} from '../../core/src/editpilot-agents'

export const editPilotApiSchemas = {
  // EditPilot agent configuration
  editPilotDetectAgents: {
    input: z.object({}),
    output: z.object({
      agents: z.array(editPilotAgentStatusSchema),
      config: editPilotConfigSchema,
      activeAgentId: z.enum(EDIT_PILOT_AGENT_IDS).nullable(),
    }),
  },
  editPilotGetConfig: {
    input: z.object({}),
    output: editPilotConfigSchema,
  },
  editPilotSetConfig: {
    input: z.object({
      defaultAgentId: z.enum(EDIT_PILOT_AGENT_IDS).nullable(),
      commandOverrides: editPilotCommandOverridesSchema.optional(),
    }),
    output: editPilotConfigSchema,
  },

  editPilotSend: {
    input: z.object({
      runId: z.string(),
      prompt: z.string(),
      projectsDir: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      projectName: z.string().nullable().optional(),
      references: z.array(z.object({ clipId: z.string(), label: z.string() })).optional(),
      resumeSessionId: z.string().nullable().optional(),
    }),
    output: ipcResult({ agentLabel: z.string() }),
  },
  editPilotRegisterMcp: {
    input: z.object({ agentId: z.enum(EDIT_PILOT_AGENT_IDS) }),
    output: z.object({ ok: z.boolean(), output: z.string() }),
  },
  editPilotCancel: {
    input: z.object({ runId: z.string() }),
    output: emptyResult,
  },

  // S5-6: Live patch responses from renderer
  editPilotRespondLivePatch: {
    input: z.object({
      requestId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      description: z.string().optional(),
      appliedCount: z.number().optional(),
    }),
    output: emptyResult,
  },
  editPilotRespondLiveUndo: {
    input: z.object({
      requestId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      description: z.string().optional(),
    }),
    output: emptyResult,
  },
  /** The user pressed a button on a confirmation card, unblocking the agent. */
  editPilotRespondLiveConfirm: {
    input: editPilotConfirmAnswerSchema,
    output: emptyResult,
  },
} as const
