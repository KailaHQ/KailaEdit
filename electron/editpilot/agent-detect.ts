import { spawn } from 'child_process'
import {
  EDIT_PILOT_AGENTS,
  listAgentDefinitions,
  parseEditPilotConfig,
  type EditPilotAgentId,
  type EditPilotAgentStatus,
  type EditPilotConfig,
} from '../../core/src/editpilot-agents'
import { readAppState, writeAppState } from '../app-state'
import { logger } from '../logger'

const PROBE_TIMEOUT_MS = 6000

/**
 * Ask one executable for its version.
 *
 * On Windows these CLIs install as `.cmd` shims that `spawn` cannot launch by
 * bare name, so the call goes through `cmd.exe /c`. Note the args stay an
 * array — no `shell: true`, no string concatenation — because the command can
 * come from a user-supplied override and must never be parsed as a shell line.
 */
function probeCommand(command: string, versionArgs: string[]): Promise<{ version: string } | { error: string }> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: { version: string } | { error: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const [file, args] = process.platform === 'win32'
      ? ['cmd.exe', ['/c', command, ...versionArgs]]
      : [command, versionArgs]

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      finish({ error: String(err) })
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })

    const timer = setTimeout(() => {
      child.kill()
      finish({ error: `No response after ${PROBE_TIMEOUT_MS / 1000}s` })
    }, PROBE_TIMEOUT_MS)

    child.on('error', err => {
      clearTimeout(timer)
      finish({ error: err.message })
    })

    child.on('close', code => {
      clearTimeout(timer)
      const output = (stdout || stderr).trim().split(/\r?\n/)[0]?.trim() ?? ''
      // Some CLIs report their version on a non-zero exit; trust output first.
      if (output) finish({ version: output })
      else finish({ error: `Exited with code ${code}, no output` })
    })
  })
}

/**
 * Probe every known agent. Overrides from config are tried before the built-in
 * command names, so an install outside PATH still resolves.
 */
export async function detectAgents(config: EditPilotConfig): Promise<EditPilotAgentStatus[]> {
  const definitions = listAgentDefinitions()

  const results = await Promise.all(definitions.map(async definition => {
    const override = config.commandOverrides[definition.id]?.trim()
    const candidates = override ? [override, ...definition.commands] : definition.commands

    let lastError = 'Not found'
    for (const command of candidates) {
      const probe = await probeCommand(command, definition.versionArgs)
      if ('version' in probe) {
        return {
          id: definition.id,
          installed: true,
          command,
          version: probe.version,
          error: null,
        } satisfies EditPilotAgentStatus
      }
      lastError = probe.error
    }

    return {
      id: definition.id,
      installed: false,
      command: null,
      version: null,
      error: lastError,
    } satisfies EditPilotAgentStatus
  }))

  logger.info(`[editpilot] Probed agents: ${results.map(r => `${r.id}=${r.installed ? r.version : 'none'}`).join(', ')}`)
  return results
}

const APP_STATE_KEY = 'editPilot'

export function readEditPilotConfig(): EditPilotConfig {
  return parseEditPilotConfig(readAppState()[APP_STATE_KEY])
}

export function writeEditPilotConfig(config: EditPilotConfig): EditPilotConfig {
  const state = readAppState()
  state[APP_STATE_KEY] = config
  writeAppState(state)
  return config
}

/** The definition for an id, or null if the id is not one we know. */
export function agentDefinition(id: EditPilotAgentId | null) {
  return id ? EDIT_PILOT_AGENTS[id] ?? null : null
}
