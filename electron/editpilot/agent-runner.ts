import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import {
  EDIT_PILOT_AGENTS,
  resolveActiveAgent,
  type EditPilotAgentDefinition,
  type EditPilotAgentId,
} from '../../core/src/editpilot-agents'
import { buildEditPilotSystemPrompt } from '../../core/src/editpilot-prompt'
import { makeId } from '../../core/src/id-generator'
import { buildInlineMcpConfigArgs, type InlineMcpTarget } from '../../core/src/editpilot-mcp-config'
import { addPermissionRule } from '../../core/src/editpilot-permissions'
import { buildSpawnPlan } from './windows-spawn'
import { removeEntryQuietly } from '../storage/remove-entry'
import { detectAgents, readEditPilotConfig } from './agent-detect'
import { emitToRenderer } from '../ipc/event-emitter'
import { logger } from '../logger'
import { getOrCreateLiveBridge, closeLiveBridge } from './live-bridge'

/** A run that outlives its turn is a runaway agent; kill it. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Tools EditPilot refuses outright.
 *
 * `--allowedTools` was assumed to be a fence and is not — a run carrying it was
 * still observed grepping the disk. This list is the fence: the agent edits a
 * video project, so it has no business reading, writing or searching the
 * machine, or reaching the network.
 *
 * This is a denylist, which is the weaker shape: a tool added by a future CLI
 * release is allowed until it is named here. An allowlist would be better, but
 * `--allowedTools` only decides what is auto-approved, not what exists. Blocking
 * `Read` alone was not enough — the agent simply reached for `PowerShell`.
 */
export const BLOCKED_TOOLS = [
  "Bash",
  "PowerShell",
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "ToolSearch",
  "Skill",
  "Workflow",
  "Artifact",
  "DesignSync",
  "EnterWorktree",
  "ExitWorktree",
  "RemoteTrigger",
  "Monitor",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "PushNotification",
].join(',')
/**
 * Auto-approve list for KomfyEdit's own MCP tools.
 *
 * NOT a capability filter: a run with this flag was still observed using the
 * CLI's file-search tools. Real blocking is S5-7 — until then the system prompt
 * is what keeps the agent on the timeline, and that is guidance, not a fence.
 */
const ALLOWED_TOOLS = 'mcp__kailaedit__*,mcp__komfyedit__*'

interface ActiveRun {
  child: ChildProcess
  timer: NodeJS.Timeout
  mcpConfigPath: string | null
}

const activeRuns = new Map<string, ActiveRun>()

function mcpServerEntryPoint(): string {
  // In development the package sits in the repo; when packaged it ships beside
  // the app under resources/.
  const basePath = typeof app !== 'undefined' && app?.getAppPath ? app.getAppPath() : process.cwd()
  const devCandidates = [
    path.join(basePath, 'packages', 'kailaedit-mcp', 'bin', 'kailaedit-mcp.js'),
    path.join(basePath, 'packages', 'kailaedit-mcp', 'bin', 'komfyedit-mcp.js'),
    path.join(basePath, 'packages', 'komfyedit-mcp', 'bin', 'kailaedit-mcp.js'),
    path.join(basePath, 'packages', 'komfyedit-mcp', 'bin', 'komfyedit-mcp.js'),
  ]
  for (const candidate of devCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  const resBase = process.resourcesPath ?? basePath
  const resCandidates = [
    path.join(resBase, 'kailaedit-mcp', 'bin', 'kailaedit-mcp.js'),
    path.join(resBase, 'kailaedit-mcp', 'bin', 'komfyedit-mcp.js'),
    path.join(resBase, 'komfyedit-mcp', 'bin', 'kailaedit-mcp.js'),
    path.join(resBase, 'komfyedit-mcp', 'bin', 'komfyedit-mcp.js'),
  ]
  for (const candidate of resCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return devCandidates[0]
}

/**
 * Environment the MCP server needs to find this run's project and app.
 *
 * `edit` profile, because a chat that can only read would be a worse product
 * than no chat at all — the propose/apply gate inside the server is what keeps
 * it safe.
 */
export function buildMcpEnv(
  projectsDir: string | null,
  projectId?: string | null,
  livePort?: number | null,
): Record<string, string> {
  return {
    KAILAEDIT_MCP_PROFILE: 'edit',
    KOMFYEDIT_MCP_PROFILE: 'edit',
    ...(projectsDir ? { KAILAEDIT_PROJECTS_DIR: projectsDir, KOMFYEDIT_PROJECTS_DIR: projectsDir } : {}),
    ...(projectId ? { KAILAEDIT_ACTIVE_PROJECT_ID: projectId, KOMFYEDIT_ACTIVE_PROJECT_ID: projectId } : {}),
    ...(livePort ? { KAILAEDIT_LIVE_PORT: String(livePort), KOMFYEDIT_LIVE_PORT: String(livePort) } : {}),
    // Electron's node binary needs this to behave as plain Node.
    ELECTRON_RUN_AS_NODE: '1',
  }
}

/** The same server, described for a CLI that takes it as config overrides. */
export function buildInlineMcpTarget(
  projectsDir: string | null,
  projectId?: string | null,
  livePort?: number | null,
): InlineMcpTarget {
  return {
    serverName: MCP_SERVER_NAME,
    command: process.execPath,
    args: [mcpServerEntryPoint()],
    env: buildMcpEnv(projectsDir, projectId, livePort),
  }
}

export function writeMcpConfig(
  runId: string,
  projectsDir: string | null,
  projectId?: string | null,
  livePort?: number | null,
): string {
  const configPath = path.join(os.tmpdir(), `kailaedit-mcp-${runId}.json`)
  const config = {
    mcpServers: {
      kailaedit: {
        command: process.execPath,
        args: [mcpServerEntryPoint()],
        env: buildMcpEnv(projectsDir, projectId, livePort),
      },
      komfyedit: {
        command: process.execPath,
        args: [mcpServerEntryPoint()],
        env: buildMcpEnv(projectsDir, projectId, livePort),
      },
    },
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configPath
}

export function buildArgs(
  definition: EditPilotAgentDefinition,
  prompt: string,
  systemPrompt: string,
  mcpConfigPath: string | null,
  resumeSessionId: string | null = null,
  inlineMcp: InlineMcpTarget | null = null,
): string[] {
  // Where the framing travels. A flag is best; a project doc the CLI reads
  // from its working directory is second. Folding it into the user's own
  // message is the last resort — the CLI then echoes the whole thing back as
  // if the user had typed it, which is what put the system prompt on screen.
  const carriedSeparately = Boolean(definition.systemPromptFlag || definition.projectDocFile)
  const effectivePrompt = carriedSeparately && !definition.foldFramingIntoPrompt
    ? prompt
    : `${systemPrompt}

---

${prompt}`

  const args = definition.headlessArgs.map(arg => (arg === '{prompt}' ? effectivePrompt : arg))

  if (definition.systemPromptFlag) {
    args.push(definition.systemPromptFlag, systemPrompt)
  }
  if (mcpConfigPath && definition.mcpConfigFlag) {
    args.push(definition.mcpConfigFlag, mcpConfigPath)
  }
  if (inlineMcp && definition.mcpInlineConfigFlag) {
    args.push(...buildInlineMcpConfigArgs(definition.mcpInlineConfigFlag, inlineMcp))
  }
  if (mcpConfigPath && definition.allowedToolsFlag) {
    args.push(definition.allowedToolsFlag, ALLOWED_TOOLS)
  }
  if (resumeSessionId && definition.resumeFlag) {
    args.push(definition.resumeFlag, resumeSessionId)
  }
  if (definition.disallowedToolsFlag) {
    args.push(definition.disallowedToolsFlag, BLOCKED_TOOLS)
  }
  return args
}

export const MCP_SERVER_NAME = 'komfyedit'

/**
 * Register KomfyEdit's MCP server with a CLI that keeps its own persistent
 * server list (Antigravity). This writes to the user's CLI config, outside the
 * app, so it is only ever triggered by an explicit action in settings — never
 * silently before a run. Undo it with `agy mcp remove komfyedit`.
 */
export function registerMcpServer(agentId: EditPilotAgentId): Promise<{ ok: boolean; output: string }> {
  const definition = EDIT_PILOT_AGENTS[agentId]
  if (!definition.mcpRegisterArgs) {
    return Promise.resolve({ ok: false, output: `${definition.label} không dùng cách đăng ký này.` })
  }

  const config = readEditPilotConfig()
  const command = config.commandOverrides[agentId]?.trim() || definition.commands[0]
  const args = definition.mcpRegisterArgs.map(arg => arg
    .replace('{name}', MCP_SERVER_NAME)
    .replace('{command}', process.execPath)
    .replace('{entry}', mcpServerEntryPoint()))

  const plan = buildSpawnPlan(command, args)

  return new Promise(resolve => {
    const child = spawn(plan.file, plan.args, {
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    let output = ''
    child.stdout?.on('data', chunk => { output += String(chunk) })
    child.stderr?.on('data', chunk => { output += String(chunk) })
    child.on('error', err => resolve({ ok: false, output: err.message }))
    child.on('close', code => {
      logger.info(`[editpilot] Đăng ký MCP cho ${definition.label}: mã ${code}`)
      if (code !== 0) {
        resolve({ ok: false, output: output.trim() || `Thoát với mã ${code}` })
        return
      }
      // Registering the server is only half of it: without a standing
      // allow-rule the CLI auto-denies the first tool call in print mode and
      // the run ends having produced nothing.
      const grant = grantMcpPermission(definition)
      resolve({
        ok: true,
        output: [output.trim(), grant].filter(Boolean).join('\n') || `Thoát với mã ${code}`,
      })
    })
  })
}

/**
 * Adds the MCP allow-rule to the CLI's own settings file.
 *
 * This writes outside the app, into a file the user owns, so it happens only
 * on the same explicit action that registers the server — never before a run —
 * and it adds exactly one rule naming KomfyEdit's server, nothing wider.
 * Returns a line describing what happened, for the settings panel.
 */
function grantMcpPermission(definition: EditPilotAgentDefinition): string {
  if (!definition.permissionsFilePath || !definition.mcpPermissionRule) return ''

  const settingsPath = path.join(os.homedir(), ...definition.permissionsFilePath)
  const ruleKaila = definition.mcpPermissionRule.replace('{name}', 'kailaedit')
  const ruleKomfy = definition.mcpPermissionRule.replace('{name}', 'komfyedit')

  try {
    if (!fs.existsSync(path.dirname(settingsPath))) {
      return `Chưa thấy thư mục cấu hình của ${definition.label}; hãy chạy CLI một lần rồi bấm lại.`
    }
    const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : ''
    let currentRaw = raw
    const patchKaila = addPermissionRule(currentRaw, ruleKaila)
    if (patchKaila.added) currentRaw = patchKaila.json
    const patchKomfy = addPermissionRule(currentRaw, ruleKomfy)
    if (patchKomfy.added) currentRaw = patchKomfy.json

    if (!patchKaila.added && !patchKomfy.added) return `Quyền ${ruleKaila} đã có sẵn.`
    fs.writeFileSync(settingsPath, currentRaw, 'utf8')
    return `Đã thêm quyền ${ruleKaila} vào ${settingsPath}.`
  } catch (err) {
    return `Không thêm được quyền: ${String(err)}`
  }
}


/**
 * Turn one line of CLI output into text for the chat.
 *
 * Claude Code with `--output-format stream-json` emits one JSON object per
 * line; everything else prints plain text. Anything unparseable is passed
 * through rather than dropped — silence would look like a hang.
 */
export interface ParsedLine {
  text: string
  /** True for the CLI's closing summary, which usually repeats the last message. */
  isFinal: boolean
}

/**
 * Housekeeping a CLI prints about itself. Codex says this on every run because
 * EditPilot gives it no terminal on stdin; it is not part of the answer, and in
 * the chat bubble it reads like the agent talking about nothing.
 */
const NOISE_LINES = new Set([
  'Reading additional input from stdin...',
])

export function parseLine(agentId: EditPilotAgentId, line: string): ParsedLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (NOISE_LINES.has(trimmed)) return null

  if (agentId !== 'claude') return { text: `${trimmed}
`, isFinal: false }

  if (!trimmed.startsWith('{')) return { text: `${trimmed}
`, isFinal: false }
  try {
    const event = JSON.parse(trimmed) as Record<string, any>
    if (event.type === 'assistant' && event.message?.content) {
      const text = (event.message.content as any[])
        .filter(block => block?.type === 'text')
        .map(block => block.text)
        .join('')
      return text ? { text, isFinal: false } : null
    }
    if (event.type === 'result') {
      // Claude repeats the final answer here. The caller drops it when the
      // assistant already said the same thing, so the panel does not show
      // every reply twice.
      return typeof event.result === 'string' && event.result
        ? { text: `
${event.result}
`, isFinal: true }
        : null
    }
    return null
  } catch {
    return { text: `${trimmed}
`, isFinal: false }
  }
}


/** Transcript scaffolding a CLI prints around an echoed turn. */
const TRANSCRIPT_SCAFFOLDING = /^(user|assistant|system|developer|[-=_]{3,})$/i

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The part of a failed run worth showing the user.
 *
 * A CLI that fails often replays the whole turn on its way out, so the raw
 * tail of stderr was putting EditPilot's own framing on screen as if the agent
 * had said it. Anything that merely repeats what we sent is dropped; what is
 * left is the CLI's actual complaint.
 */
export function summarizeFailureDetail(stderr: string, echoes: string[], maxLines = 6): string {
  const sent = echoes.map(normalizeForMatch).filter(text => text.length > 0)
  // A long prompt comes back as one flattened line, so a prefix is enough to
  // recognise it. A short one has to match outright — dropping every line that
  // merely contains "cắt" would swallow the error we are trying to show.
  const prefixes = sent.map(text => text.slice(0, 60)).filter(prefix => prefix.length >= 20)

  const kept = stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !TRANSCRIPT_SCAFFOLDING.test(line))
    .filter(line => {
      const normalized = normalizeForMatch(line)
      if (sent.includes(normalized)) return false
      return !prefixes.some(prefix => normalized.includes(prefix))
    })

  return kept.slice(-maxLines).join('\n')
}

export interface StartRunParams {
  runId: string
  prompt: string
  projectsDir?: string | null
  projectId?: string | null
  projectName?: string | null
  /** Clips the user pointed at, passed to the agent as context. */
  references?: Array<{ clipId: string; label: string }>
  /** Continue this CLI conversation instead of starting a new one. */
  resumeSessionId?: string | null
}

/** Spawns the configured CLI and streams its answer back over IPC. */
/** How long a one-shot question may take before it is treated as unavailable. */
const ONE_SHOT_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Ask the configured CLI one self-contained question and return what it said.
 *
 * Not a run: no MCP server, no project doc, no conversation, no streaming to
 * the panel. This is the path for work that only needs a model — picking viral
 * highlights out of a transcript, say — so the user's own CLI subscription
 * does it instead of a separate OpenAI key.
 *
 * Returns null rather than throwing when no CLI is usable, so the caller can
 * fall back to its own provider instead of failing the feature outright.
 */
export type OneShotResult =
  | { ok: true; agentLabel: string; text: string }
  /** No CLI is installed or configured — the user has to go and set one up. */
  | { ok: false; reason: 'no-agent' }
  /** A CLI was found but the question did not come back answered. */
  | { ok: false; reason: 'failed'; agentLabel: string; detail: string }

export async function runOneShot(params: {
  prompt: string
  timeoutMs?: number
}): Promise<OneShotResult> {
  const config = readEditPilotConfig()
  const statuses = await detectAgents(config)
  const agentId = resolveActiveAgent(config, statuses)
  // Told apart from a failure on purpose: "install a CLI" and "your CLI errored"
  // need different words, and the caller cannot write either from a bare null.
  if (!agentId) return { ok: false, reason: 'no-agent' }

  const definition = EDIT_PILOT_AGENTS[agentId]
  const status = statuses.find(candidate => candidate.id === agentId)
  const command = config.commandOverrides[agentId]?.trim() || status?.command || definition.commands[0]
  const args = definition.oneShotArgs.map(arg => (arg === '{prompt}' ? params.prompt : arg))

  // Its own empty directory, same as a run: pointed at anything of the user's,
  // a CLI with file tools starts reading it instead of answering.
  const workDir = path.join(os.tmpdir(), `komfyedit-oneshot-${makeId('os')}`)
  fs.mkdirSync(workDir, { recursive: true })

  const plan = buildSpawnPlan(command, args)
  logger.info(`[editpilot] Hỏi nhanh ${definition.label} (${command})`)

  return new Promise(resolve => {
    const child = spawn(plan.file, plan.args, {
      cwd: workDir,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: OneShotResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      removeEntryQuietly(workDir)
      resolve(result)
    }
    const failed = (detail: string): OneShotResult =>
      ({ ok: false, reason: 'failed', agentLabel: definition.label, detail })

    const timer = setTimeout(() => {
      child.kill()
      logger.warn(`[editpilot] Hỏi nhanh ${definition.label} quá hạn`)
      finish(failed(`Quá ${(params.timeoutMs ?? ONE_SHOT_TIMEOUT_MS) / 1000}s không phản hồi`))
    }, params.timeoutMs ?? ONE_SHOT_TIMEOUT_MS)

    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', err => {
      logger.warn(`[editpilot] Hỏi nhanh thất bại: ${err.message}`)
      finish(failed(err.message))
    })
    child.on('close', code => {
      if (code !== 0 || !stdout.trim()) {
        const detail = summarizeFailureDetail(stderr, [])
        logger.warn(`[editpilot] Hỏi nhanh thoát mã ${code}: ${detail}`)
        finish(failed(detail || `Thoát với mã ${code}`))
        return
      }
      finish({ ok: true, agentLabel: definition.label, text: stdout })
    })
  })
}

export async function startRun({ runId, prompt, projectsDir, projectId, projectName, references, resumeSessionId }: StartRunParams): Promise<{ agentLabel: string }> {
  const config = readEditPilotConfig()
  const statuses = await detectAgents(config)
  const agentId = resolveActiveAgent(config, statuses)
  if (!agentId) {
    throw new Error('Chưa có agent CLI nào dùng được. Mở phần cấu hình EditPilot để chọn.')
  }

  const definition = EDIT_PILOT_AGENTS[agentId]
  const status = statuses.find(candidate => candidate.id === agentId)
  const command = config.commandOverrides[agentId]?.trim() || status?.command || definition.commands[0]

  let livePort: number | null = null
  if (projectId) {
    try {
      const bridge = await getOrCreateLiveBridge(projectId)
      livePort = bridge.port
    } catch (err) {
      logger.warn(`[editpilot] Không thể khởi tạo live bridge: ${err}`)
    }
  }

  const mcpConfigPath = definition.mcpConfigFlag
    ? writeMcpConfig(runId, projectsDir ?? null, projectId ?? null, livePort)
    : null
  // Codex has no config-file flag; it takes the whole server as `-c` overrides.
  const inlineMcp = definition.mcpInlineConfigFlag
    ? buildInlineMcpTarget(projectsDir ?? null, projectId ?? null, livePort)
    : null
  const systemPrompt = buildEditPilotSystemPrompt({
    projectId: projectId ?? null,
    projectName,
    references,
  })
  const args = buildArgs(definition, prompt, systemPrompt, mcpConfigPath, resumeSessionId ?? null, inlineMcp)

  // An empty, per-run directory. Pointing the agent at the app's userData
  // folder made it try to grep hundreds of megabytes of cache and time out —
  // and gave it something to search when it should be calling MCP tools.
  const workDir = path.join(os.tmpdir(), `komfyedit-editpilot-${runId}`)
  fs.mkdirSync(workDir, { recursive: true })

  // A CLI with no system-prompt flag reads its framing from a file in that
  // directory instead. Written per run and thrown away with it, so it never
  // touches anything the user owns.
  if (!definition.systemPromptFlag && definition.projectDocFile) {
    try {
      fs.writeFileSync(path.join(workDir, definition.projectDocFile), systemPrompt, 'utf8')
    } catch (err) {
      logger.warn(`[editpilot] Không ghi được ${definition.projectDocFile}: ${err}`)
    }
  }

  // Quoting, newline flattening and the cmd.exe quirks all live in buildSpawnPlan.
  const plan = buildSpawnPlan(command, args)

  logger.info(`[editpilot] Chạy ${definition.label} (${command}), run=${runId}`)

  // A CLI that registers MCP servers persistently cannot be told which project
  // this run is about — the registration was written once, long before. The
  // values ride in the CLI's own environment instead, and the server inherits
  // them when the CLI spawns it. ELECTRON_RUN_AS_NODE stays out: it belongs to
  // the server process, and the registration carries it.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...perRunMcpEnv } = buildMcpEnv(
    projectsDir ?? null,
    projectId ?? null,
    livePort,
  )
  const childEnv = definition.mcpRegisterArgs
    ? { ...process.env, ...perRunMcpEnv }
    : process.env

  const child = spawn(plan.file, plan.args, {
    cwd: workDir,
    windowsHide: true,
    windowsVerbatimArguments: plan.verbatim,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  })

  const cleanup = () => {
    const run = activeRuns.get(runId)
    if (!run) return
    clearTimeout(run.timer)
    if (run.mcpConfigPath) {
      try { fs.unlinkSync(run.mcpConfigPath) } catch { /* best effort */ }
    }
    removeEntryQuietly(workDir)
    activeRuns.delete(runId)
  }

  const timer = setTimeout(() => {
    logger.warn(`[editpilot] run=${runId} quá thời gian, đã dừng`)
    child.kill()
    emitToRenderer('editpilot:chunk', { runId, error: 'Quá thời gian chạy (10 phút), đã dừng.' })
    cleanup()
  }, RUN_TIMEOUT_MS)

  activeRuns.set(runId, { child, timer, mcpConfigPath })

  let stdoutBuffer = ''
  let sessionReported = false
  /** Whether the run ever produced anything the user can read. */
  let emittedAnything = false
  child.stdout?.on('data', chunk => {
    stdoutBuffer += String(chunk)
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      // Claude announces its session id in the init event; the panel needs it
      // to continue the same conversation on the next message.
      if (!sessionReported && agentId === 'claude' && line.includes('"session_id"')) {
        try {
          const event = JSON.parse(line.trim()) as { session_id?: string }
          if (event.session_id) {
            sessionReported = true
            emitToRenderer('editpilot:chunk', { runId, sessionId: event.session_id })
          }
        } catch { /* not the init line */ }
      }
      const parsed = parseLine(agentId, line)
      if (!parsed) continue
      // The closing summary repeats the last assistant message; showing both
      // made every reply appear twice in the panel.
      if (parsed.isFinal && emittedAnything) continue
      emittedAnything = true
      emitToRenderer('editpilot:chunk', { runId, delta: parsed.text })
    }
  })

  let stderrText = ''
  child.stderr?.on('data', chunk => { stderrText += String(chunk) })

  child.on('error', err => {
    emitToRenderer('editpilot:chunk', { runId, error: `Không chạy được ${command}: ${err.message}` })
    cleanup()
  })

  child.on('close', code => {
    const leftover = stdoutBuffer.trim() ? parseLine(agentId, stdoutBuffer) : null
    if (leftover && !(leftover.isFinal && emittedAnything)) {
      emittedAnything = true
      emitToRenderer('editpilot:chunk', { runId, delta: leftover.text })
    }

    const detail = summarizeFailureDetail(stderrText, [systemPrompt, prompt])

    if (code !== 0) {
      emitToRenderer('editpilot:chunk', {
        runId,
        error: `${definition.label} thoát với mã ${code}.${detail ? `\n${detail}` : ''}`,
      })
    } else if (!emittedAnything) {
      // A clean exit with an empty stdout still leaves the user staring at a
      // blank bubble. `agy` reports auto-denied tool permissions exactly this
      // way — message on stderr, exit code 0 — so surface stderr instead of
      // swallowing the run.
      emitToRenderer('editpilot:chunk', {
        runId,
        error: detail || `${definition.label} kết thúc nhưng không trả về nội dung nào.`,
      })
    } else {
      emitToRenderer('editpilot:chunk', { runId, done: true })
    }
    cleanup()
  })

  return { agentLabel: status?.version ? `${definition.label} ${status.version}` : definition.label }
}

export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId)
  if (!run) return false
  run.child.kill()
  clearTimeout(run.timer)
  if (run.mcpConfigPath) {
    try { fs.unlinkSync(run.mcpConfigPath) } catch { /* best effort */ }
  }
  activeRuns.delete(runId)
  emitToRenderer('editpilot:chunk', { runId, done: true })
  return true
}

/** Kill everything still running, e.g. on window close. */
export function cancelAllRuns(): void {
  for (const runId of Array.from(activeRuns.keys())) cancelRun(runId)
}
