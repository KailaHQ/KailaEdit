import { EDIT_PILOT_AGENTS } from '@core/editpilot-agents'
import type { EditPilotConfirmRequest } from '@core/editpilot-confirm'
import type { EditPilotTask } from '@core/editpilot-plan'

/**
 * The seam between the EditPilot chat UI and whatever actually answers it.
 *
 * KomfyEdit's plan is "bring your own agent": the user runs their own Claude
 * Code / Codex / Antigravity CLI under their own credentials, and this panel is
 * a front-end onto that session. Nothing here holds a token or an API key, and
 * no request is ever billed to KomfyEdit — see docs/ai-agent-integration-plan.md.
 *
 * The UI talks only to this interface, so the panel does not care whether the
 * answer comes from a spawned CLI or from a stub.
 */

export type EditPilotRole = 'user' | 'assistant' | 'system' | 'confirm'

export interface EditPilotMessage {
  id: string
  role: EditPilotRole
  /** Display text: the reply with the progress markers already stripped. */
  text: string
  /**
   * Everything the agent actually sent, markers included. The checklist is
   * re-derived from the whole buffer on every chunk, so a marker split across
   * two deltas still parses once the rest arrives.
   */
  raw?: string
  /** The plan the agent declared for this reply, if it declared one. */
  tasks?: EditPilotTask[]
  /** Set while an assistant reply is still streaming in. */
  streaming?: boolean
  /**
   * For `confirm` messages: the question the agent parked here. Its tool call
   * stays open until `answeredActionId` is set or the run ends.
   */
  confirm?: EditPilotConfirmRequest
  answeredActionId?: string
  /** Item numbers still ticked when it was answered, for a selectable list. */
  answeredItemNumbers?: number[]
  /** The run ended before this question was answered. */
  expired?: boolean
}

/** A clip the user pointed at with the @-mention picker, passed to the agent as context. */
export interface EditPilotReference {
  clipId: string
  label: string
}

export interface EditPilotRequest {
  prompt: string
  references: EditPilotReference[]
  /** Shown to the agent so it can name the project it is working on. */
  projectName?: string | null
  /**
   * Continue an existing CLI conversation. Without it every message starts
   * from nothing, so a reply like "yes" has no proposal to refer back to.
   */
  resumeSessionId?: string | null
}

export interface EditPilotChunk {
  /** The CLI conversation this run belongs to; replayed on the next message. */
  sessionId?: string
  /** Text to append to the in-flight assistant message. */
  delta?: string
  /** Terminal states. `error` carries a human-readable reason. */
  done?: boolean
  error?: string
}

export interface EditPilotBackend {
  /** Which agent will answer, for display. Null when nothing is configured yet. */
  describeAgent(): Promise<string | null>
  /** Streams an answer. Returns a function that aborts the run. */
  send(request: EditPilotRequest, onChunk: (chunk: EditPilotChunk) => void): () => void
}

export interface CreateIpcBackendOptions {
  getProjectId?: () => string | null
  getProjectsDir?: () => Promise<string | null> | string | null
  onRunStart?: () => Promise<void> | void
  onRunEnd?: () => Promise<void> | void
}

/**
 * The real backend: the main process spawns the user's configured CLI, and its
 * output streams back over the `editpilot:chunk` IPC channel.
 */
export function createIpcBackend(options: CreateIpcBackendOptions = {}): EditPilotBackend {
  return {
    async describeAgent() {
      const api = window.electronAPI
      if (!api?.editPilotDetectAgents) return null
      try {
        const result = await api.editPilotDetectAgents()
        if (!result.activeAgentId) return null
        const definition = EDIT_PILOT_AGENTS[result.activeAgentId]
        const status = result.agents.find(agent => agent.id === result.activeAgentId)
        return status?.version ? `${definition.label} ${status.version}` : definition.label
      } catch {
        return null
      }
    },
    send(request, onChunk) {
      const api = window.electronAPI
      if (!api?.editPilotSend) {
        onChunk({ delta: NOT_CONFIGURED_MESSAGE })
        onChunk({ done: true })
        return () => {}
      }

      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let finished = false

      const finalize = () => {
        if (finished) return
        finished = true
        unsubscribe?.()
        try {
          const endRes = options.onRunEnd?.()
          if (endRes && typeof (endRes as any).then === 'function') {
            void (endRes as Promise<void>).catch(() => {})
          }
        } catch {
          // best effort
        }
      }

      // Subscribe before starting so no early output is missed.
      const unsubscribe = api.on?.('editpilot:chunk', (payload: any) => {
        if (payload?.runId !== runId) return
        if (payload.sessionId) onChunk({ sessionId: payload.sessionId })
        if (payload.delta) onChunk({ delta: payload.delta })
        if (payload.error) {
          onChunk({ error: payload.error })
          finalize()
        }
        if (payload.done) {
          onChunk({ done: true })
          finalize()
        }
      })

      void (async () => {
        try {
          await options.onRunStart?.()
        } catch {
          // continue
        }

        let projectsDir: string | null = null
        if (options.getProjectsDir) {
          projectsDir = await options.getProjectsDir()
        } else if (api.getProjectsDir) {
          try {
            const res = await api.getProjectsDir()
            projectsDir = res.path
          } catch {
            // fallback handled by main process
          }
        }

        const projectId = options.getProjectId?.() ?? null

        const promptWithContext = request.references.length > 0
          ? `${request.prompt}\n\nReferenced clips: ${request.references.map(r => `${r.label} (id: ${r.clipId})`).join(', ')}`
          : request.prompt

        try {
          const result = await api.editPilotSend({
            runId,
            prompt: promptWithContext,
            projectsDir,
            projectName: request.projectName ?? null,
            references: request.references,
            resumeSessionId: request.resumeSessionId ?? null,
            projectId,
          })
          if (!result.success) {
            onChunk({ error: result.error })
            finalize()
          }
        } catch (err: unknown) {
          onChunk({ error: String(err) })
          finalize()
        }
      })()

      return () => {
        if (finished) return
        void api.editPilotCancel?.({ runId })
        finalize()
      }
    },
  }
}

const NOT_CONFIGURED_MESSAGE = [
  'No agent CLI is currently configured.',
  '',
  'EditPilot runs with your own CLI (Claude Code, Codex, or Antigravity) and',
  'your own credentials — KailaEdit retains no tokens and charges no credits.',
  'The CLI bridge is not connected yet; this interface is ready for it.',
].join('\n')

/**
 * Fallback for contexts with no Electron bridge — the browser-only dev server,
 * and tests. It says so rather than inventing a plausible reply.
 */
export const notConfiguredBackend: EditPilotBackend = {
  async describeAgent() {
    return null
  },
  send(_request, onChunk) {
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      onChunk({ delta: NOT_CONFIGURED_MESSAGE })
      onChunk({ done: true })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  },
}

/** Suggestion chips for quick editing plans. */
export const EDIT_PILOT_SUGGESTIONS: string[] = [
  'Cut all silences longer than 2 seconds',
  'Assemble rough cut by scene',
  'Normalize loudness to -14 LUFS',
  'Generate subtitles for the entire timeline',
]
