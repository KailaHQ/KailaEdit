import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, CircleAlert, Info, Loader2, Plug, RefreshCw, X } from 'lucide-react'
import {
  EDIT_PILOT_AGENTS,
  listAgentDefinitions,
  type EditPilotAgentDefinition,
  type EditPilotAgentId,
  type EditPilotAgentStatus,
  type EditPilotConfig,
} from '@core/editpilot-agents'
import { Tooltip } from '../../components/ui/tooltip'
import { useTranslation } from '../../i18n/I18nContext'

interface DetectionResult {
  agents: EditPilotAgentStatus[]
  config: EditPilotConfig
  activeAgentId: EditPilotAgentId | null
}

/**
 * Which CLI EditPilot drives, as a modal over the panel.
 *
 * KomfyEdit does not install these and never sees their credentials: the user
 * picks one they already signed into, and we run the unmodified binary. That is
 * why this screen only detects and selects — there is nothing to authenticate.
 *
 * The choice is held as a draft until Save, so opening the dialog to look at
 * what is installed cannot change which agent answers the next message.
 */
export function EditPilotSettings({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { t } = useTranslation()
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcpNotice, setMcpNotice] = useState<string | null>(null)
  const [draftAgentId, setDraftAgentId] = useState<EditPilotAgentId | null>(null)
  /** Set once detection has seeded the draft, so a re-detect cannot clobber edits. */
  const [seeded, setSeeded] = useState(false)

  const detect = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.editPilotDetectAgents) {
      setError(t('editpilot.commandOnlyInDesktop'))
      return
    }
    setDetecting(true)
    setError(null)
    try {
      const next = await api.editPilotDetectAgents()
      setResult(next)
      setSeeded(prev => {
        if (!prev) setDraftAgentId(next.config.defaultAgentId ?? null)
        return true
      })
    } catch (err) {
      setError(String(err))
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => { void detect() }, [detect])

  // Escape closes without saving, like every other dialog in the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const save = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.editPilotSetConfig) return
    setSaving(true)
    try {
      // Custom command paths are gone from this dialog, so saving clears them:
      // an override nobody can see would keep overriding the detected binary.
      await api.editPilotSetConfig({ defaultAgentId: draftAgentId, commandOverrides: {} })
      onChanged?.()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }, [draftAgentId, onChanged, onClose])

  const registerMcp = useCallback(async (id: EditPilotAgentId) => {
    const api = window.electronAPI
    if (!api?.editPilotRegisterMcp) return
    setMcpNotice(t('editpilot.registeringMcp'))
    const outcome = await api.editPilotRegisterMcp({ agentId: id })
    setMcpNotice(outcome.ok
      ? t('editpilot.registeredMcp', { label: EDIT_PILOT_AGENTS[id].label, command: EDIT_PILOT_AGENTS[id].commands[0] })
      : t('editpilot.registerMcpFailed', { output: outcome.output }))
  }, [t])

  const statusFor = (id: EditPilotAgentId) => result?.agents.find(agent => agent.id === id) ?? null
  const dirty = seeded && draftAgentId !== (result?.config.defaultAgentId ?? null)

  return (
    // Absolute, not fixed: the dialog belongs to the EditPilot column and
    // covers it edge to edge, header included. That is deliberate — the
    // panel's own ✕ sits exactly where this one does, and burying it under
    // the scrim is what stops a mis-click from closing EditPilot itself.
    <div
      className="absolute inset-0 z-[80] flex items-start justify-center bg-black/60 p-2"
      onKeyDown={event => event.stopPropagation()}
    >
      <div className="flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/60">
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 border border-accent/20 text-accent">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="flex-1 text-[13px] font-medium text-zinc-100">{t('editpilot.settingsTitle')}</span>
          <Tooltip content={t('editpilot.redetect')}>
            <button
              onClick={() => void detect()}
              disabled={detecting}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            >
              {detecting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
          <button
            onClick={onClose}
            title={t('common.close')}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          <p className="text-[11.5px] leading-relaxed text-zinc-400">
            {t('editpilot.settingsDesc')}
          </p>

          {error && (
            <p className="flex items-start gap-1.5 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
              <CircleAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
              draftAgentId === null ? 'border-accent/60 bg-accent/5' : 'border-zinc-800 bg-zinc-900'
            }`}
          >
            <input
              type="radio"
              name="editpilot-agent"
              checked={draftAgentId === null}
              onChange={() => setDraftAgentId(null)}
              className="h-3 w-3 accent-cyan-400"
            />
            <span className="text-[12.5px] text-zinc-100">{t('editpilot.auto')}</span>
            <span className="text-[10.5px] text-zinc-500">{t('editpilot.autoDesc')}</span>
          </label>

          {listAgentDefinitions().map(definition => (
            <AgentRow
              key={definition.id}
              definition={definition}
              status={statusFor(definition.id)}
              detecting={detecting}
              chosen={draftAgentId === definition.id}
              active={result?.activeAgentId === definition.id}
              onChoose={() => setDraftAgentId(definition.id)}
              onRegisterMcp={() => void registerMcp(definition.id)}
            />
          ))}

          {mcpNotice && (
            <p className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[10.5px] leading-relaxed text-zinc-300">
              {mcpNotice}
            </p>
          )}

          {result && !result.activeAgentId && (
            <p className="text-[10.5px] leading-relaxed text-zinc-500">
              {t('editpilot.noUsableAgent')}
            </p>
          )}
        </div>

        <footer className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-3 py-2.5">
          <button
            onClick={onClose}
            className="rounded-[4px] px-3 py-1 text-[12px] text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            {t('editpilot.cancel')}
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded-[4px] bg-accent px-3 py-1 text-[12px] font-medium text-zinc-950 transition-opacity hover:bg-accent-dark disabled:opacity-35"
          >
            {saving ? t('editpilot.saving') : t('editpilot.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}

interface AgentRowProps {
  definition: EditPilotAgentDefinition
  status: EditPilotAgentStatus | null
  detecting: boolean
  chosen: boolean
  active: boolean
  onChoose: () => void
  onRegisterMcp: () => void
}

/**
 * One CLI, on one line: name, vendor and version together, with everything
 * else — the sandboxing caveat, the install command, the resolved binary —
 * folded into hover icons so the list fits without scrolling.
 */
function AgentRow({ definition, status, detecting, chosen, active, onChoose, onRegisterMcp }: AgentRowProps) {
  const { t } = useTranslation()
  const unsandboxed = Boolean(status?.installed) && !definition.disallowedToolsFlag

  return (
    <div
      className={`rounded-lg border transition-colors ${
        chosen ? 'border-accent/60 bg-accent/5' : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <label className="flex cursor-pointer items-center gap-2 px-2.5 py-2">
        <input
          type="radio"
          name="editpilot-agent"
          checked={chosen}
          onChange={onChoose}
          className="h-3 w-3 flex-shrink-0 accent-cyan-400"
        />
        <span className="whitespace-nowrap text-[12.5px] font-medium text-zinc-100">{definition.label}</span>
        <span className="whitespace-nowrap text-[10.5px] text-zinc-500">{definition.vendor}</span>

        {/* The version is the only part allowed to shrink: a long one used to
            push the CLI name onto a second line. */}
        {detecting && !status ? (
          <span className="whitespace-nowrap text-[10.5px] text-zinc-500">{t('editpilot.detecting')}</span>
        ) : status?.installed ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[10.5px] text-emerald-400">
            <Check className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{status.version}</span>
          </span>
        ) : (
          <span className="whitespace-nowrap text-[10.5px] text-zinc-500">{t('editpilot.notInstalled')}</span>
        )}

        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {active && !chosen && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9.5px] text-zinc-400">{t('editpilot.inUse')}</span>
          )}

          {unsandboxed && (
            <Tooltip
              side="left"
              contentClassName="max-w-[240px] whitespace-normal leading-relaxed"
              content={t('editpilot.unsandboxedWarning')}
            >
              <span className="p-0.5 text-amber-400"><CircleAlert className="h-3.5 w-3.5" /></span>
            </Tooltip>
          )}

          <Tooltip
            side="left"
            contentClassName="max-w-[260px] whitespace-normal leading-relaxed"
            content={status?.installed
              ? `Command: ${status.command || definition.commands[0]}`
              : `Not installed${status?.error ? ` — ${status.error}` : ''}. Install: ${definition.installHint}`}
          >
            <span className="p-0.5 text-zinc-500"><Info className="h-3.5 w-3.5" /></span>
          </Tooltip>

          {definition.mcpRegisterArgs && status?.installed && (
            <Tooltip
              side="left"
              contentClassName="max-w-[240px] whitespace-normal leading-relaxed"
              content={t('editpilot.registerMcpTooltip', {
                label: definition.label,
                permission: definition.mcpPermissionRule?.replace('{name}', 'kailaedit') ?? '',
              })}
            >
              <button
                onClick={event => { event.preventDefault(); onRegisterMcp() }}
                className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Plug className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </label>
    </div>
  )
}

export function agentLabel(id: EditPilotAgentId): string {
  return EDIT_PILOT_AGENTS[id].label
}

export const CoEditSettings = EditPilotSettings
