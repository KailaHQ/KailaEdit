import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, Bot, Loader2, Settings, Square, X } from 'lucide-react'
import type { EditPilotConfirmAction, EditPilotConfirmRequest } from '@core/editpilot-confirm'
import { parseEditPilotStream, type EditPilotPhase } from '@core/editpilot-plan'
import {
  selectActiveTimeline,
  selectSelectedClipIds,
  selectShowEditPilot,
  selectTotalDuration,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { useTranslation } from '../../i18n/I18nContext'
import { EditPilotConfirmCard } from './EditPilotConfirmCard'
import { EditPilotSettings } from './EditPilotSettings'
import { EditPilotTaskCard } from './EditPilotTaskCard'
import {
  createIpcBackend,
  type EditPilotBackend,
  type EditPilotMessage,
  type EditPilotReference,
} from './editpilot-backend'

let messageSeq = 0
const nextId = () => `epm-${++messageSeq}`

/**
 * Re-reads an assistant message from its raw buffer, so the bubble shows text
 * without the progress markers and the checklist reflects everything said so
 * far. Whole-buffer rather than incremental: a marker can straddle two chunks.
 */
function withParsedStream(message: EditPilotMessage, phase: EditPilotPhase): EditPilotMessage {
  const view = parseEditPilotStream(message.raw ?? '', phase)
  return { ...message, text: view.text, tasks: view.tasks }
}

/**
 * The floating pill that opens EditPilot, bottom-right over the timeline.
 * Hidden while the panel is open so the two never fight for the same corner.
 */
export function EditPilotLauncher() {
  const actions = useEditorActions()
  const open = useEditorStore(selectShowEditPilot)
  if (open) return null

  return (
    <button
      onClick={() => actions.setShowEditPilot(true)}
      title="CoEdit"
      className="group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-accent/40 bg-zinc-900/95 py-1.5 pl-2 pr-3.5 shadow-[0_0_18px_rgba(34,211,238,0.18)] backdrop-blur transition-all hover:border-accent/70 hover:shadow-[0_0_24px_rgba(34,211,238,0.3)]"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-accent transition-colors group-hover:bg-zinc-700 group-hover:text-cyan-300">
        <Bot className="h-4 w-4" />
      </span>
      <span className="text-[13px] font-medium text-zinc-100">CoEdit</span>
    </button>
  )
}

export const CoEditLauncher = EditPilotLauncher

export interface EditPilotPanelProps {
  /** Swapped for the CLI-backed implementation once the main-process adapter lands. */
  backend?: EditPilotBackend
  /** Project this panel belongs to, so another project's questions are ignored. */
  projectId?: string | null
  /**
   * The transport time the timeline actually draws from while it is rolling.
   * Required, not optional: a seek that moves only the store is undone the
   * moment playback stops, and forgetting to pass this brings that bug back.
   */
  playbackTimeRef: React.MutableRefObject<number>
}

const defaultBackend = createIpcBackend()

export function EditPilotPanel({
  backend = defaultBackend,
  projectId = null,
  playbackTimeRef,
}: EditPilotPanelProps) {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const open = useEditorStore(selectShowEditPilot)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const totalDuration = useEditorStore(selectTotalDuration)

  const [messages, setMessages] = useState<EditPilotMessage[]>([])
  const [input, setInput] = useState('')
  const [agentLabel, setAgentLabel] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  /** CLI conversation to continue, so follow-up messages keep their context. */
  const sessionIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = useMemo(() => [
    t('editpilot.suggestions.cutSilences'),
    t('editpilot.suggestions.roughCutScenes'),
    t('editpilot.suggestions.normalizeLufs'),
    t('editpilot.suggestions.subtitlesAll'),
  ], [t])

  const refreshAgent = useCallback(() => {
    void backend.describeAgent().then(setAgentLabel)
  }, [backend])

  useEffect(() => {
    if (!open) return
    let alive = true
    void backend.describeAgent().then(label => { if (alive) setAgentLabel(label) })
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => { alive = false }
  }, [open, backend])

  // Follow the tail of the conversation as replies stream in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Abort any in-flight run when the panel unmounts.
  useEffect(() => () => abortRef.current?.(), [])

  /**
   * Clips currently selected on the timeline, offered as context chips;
   * pointing at clips is what keeps the agent from having to guess which
   * one the user meant.
   */
  const references: EditPilotReference[] = useMemo(() => {
    const clips = activeTimeline?.clips ?? []
    return clips
      .filter(clip => selectedClipIds.has(clip.id))
      .slice(0, 6)
      .map(clip => ({
        clipId: clip.id,
        label: clip.asset?.prompt?.slice(0, 24) || clip.importedName?.slice(0, 24) || clip.type,
      }))
  }, [activeTimeline, selectedClipIds])

  /**
   * Questions the agent parked here. The tool call on the other end is still
   * open, so an unanswered card is a suspended agent — every path that ends a
   * run has to settle them.
   */
  const settlePendingConfirms = useCallback(() => {
    setMessages(prev => prev.map(m => (
      m.role === 'confirm' && !m.answeredActionId && !m.expired ? { ...m, expired: true } : m
    )))
  }, [])

  // The agent stopped to ask something. It stays stopped until answerConfirm
  // replies or the bridge's own timeout fires.
  useEffect(() => {
    if (!window.electronAPI?.on) return
    return window.electronAPI.on('editpilot:live-confirm', payload => {
      if (projectId && payload.projectId !== projectId) return
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'confirm', text: '', confirm: payload.request },
      ])
    })
  }, [projectId])

  const answerConfirm = useCallback((
    request: EditPilotConfirmRequest,
    action: EditPilotConfirmAction,
    selectedItemNumbers?: number[],
  ) => {
    setMessages(prev => prev.map(m => (
      m.confirm?.requestId === request.requestId
        ? { ...m, answeredActionId: action.id, answeredItemNumbers: selectedItemNumbers }
        : m
    )))
    void window.electronAPI?.editPilotRespondLiveConfirm?.({
      requestId: request.requestId,
      actionId: action.id,
      ...(selectedItemNumbers ? { selectedItemNumbers } : {}),
    })
  }, [])

  /**
   * Jump to a spot a confirmation item points at. The playhead is the whole
   * point of the card being clickable: a pause is easier to judge by watching
   * it than by reading its timecode.
   *
   * The ref moves before the pause, and that order is the whole fix. While the
   * timeline rolls, `playbackTimeRef` is the authoritative time — the playhead
   * is drawn from it, and the store's `currentTime` only mirrors it. Pausing
   * flushes the ref back into the store, so a seek that wrote the store alone
   * was overwritten a frame later and the red line snapped back to wherever
   * playback had reached. Clicking an anchor mid-playback did nothing at all.
   */
  const seekToConfirmItem = useCallback((timeSec: number) => {
    // An agent-supplied position is not guaranteed to be on the timeline.
    const target = Math.max(0, Math.min(timeSec, totalDuration))
    playbackTimeRef.current = target
    actions.pause()
    actions.setCurrentTime(target)
  }, [actions, playbackTimeRef, totalDuration])

  /** The one question still blocking the run, if any. */
  const pendingConfirm = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'confirm' || !message.confirm) continue
      if (message.answeredActionId || message.expired) continue
      return message.confirm
    }
    return null
  }, [messages])

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setRunning(false)
    // A cancelled run left its plan unfinished; 'error' keeps the open items
    // pending instead of ticking them off.
    setMessages(prev => prev.map(m => (
      m.streaming ? { ...withParsedStream(m, 'error'), streaming: false } : m
    )))
    settlePendingConfirms()
  }, [settlePendingConfirms])

  const submit = useCallback((text: string) => {
    const prompt = text.trim()
    if (!prompt || running) return

    const replyId = nextId()
    setMessages(prev => [
      ...prev,
      { id: nextId(), role: 'user', text: prompt },
      { id: replyId, role: 'assistant', text: '', raw: '', streaming: true },
    ])
    setInput('')
    setRunning(true)

    abortRef.current = backend.send({
      prompt,
      references,
      projectName: activeTimeline?.name ?? null,
      resumeSessionId: sessionIdRef.current,
    }, chunk => {
      if (chunk.sessionId) sessionIdRef.current = chunk.sessionId
      if (chunk.delta) {
        setMessages(prev => prev.map(m => (
          m.id === replyId
            ? withParsedStream({ ...m, raw: (m.raw ?? '') + chunk.delta }, 'streaming')
            : m
        )))
      }
      if (chunk.error) {
        setMessages(prev => prev.map(m => {
          if (m.id !== replyId) return m
          const parsed = withParsedStream(m, 'error')
          return { ...parsed, text: parsed.text || chunk.error!, streaming: false }
        }))
        settlePendingConfirms()
        setRunning(false)
        abortRef.current = null
      }
      if (chunk.done) {
        setMessages(prev => prev.map(m => (
          m.id === replyId ? { ...withParsedStream(m, 'finished'), streaming: false } : m
        )))
        settlePendingConfirms()
        setRunning(false)
        abortRef.current = null
      }
    })
  }, [activeTimeline, backend, references, running, settlePendingConfirms])

  // The checklist tracks the plan of the CURRENT user request turn.
  // It only reflects the assistant's reply for the most recent prompt,
  // preventing completed checklists from previous tasks from showing up
  // when a new task is thinking or executing.
  const activeTasks = useMemo(() => {
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx === -1) return []

    // Search only within the latest turn (messages following the latest user prompt)
    for (let i = messages.length - 1; i > lastUserIdx; i -= 1) {
      const tasks = messages[i].tasks
      if (tasks && tasks.length > 0) return tasks
    }
    return []
  }, [messages])

  if (!open) return null

  return (
    <aside className="cc-panel relative w-[360px] flex-shrink-0">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 border border-accent/20 text-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-medium text-zinc-100">{t('editpilot.title')}</span>
        {agentLabel && (
          <span className="truncate text-[10.5px] text-zinc-500" title={agentLabel}>· {agentLabel}</span>
        )}
        <div className="flex-1" />
        {/* Both header buttons go dark while the settings sheet is up. The
            sheet has a close button of its own directly above this one, and
            hitting the wrong ✕ would shut the whole panel instead of the
            dialog — so this one stops being a target at all. */}
        <button
          onClick={() => setShowSettings(true)}
          disabled={showSettings}
          className={`rounded p-1 transition-colors hover:bg-zinc-800 ${showSettings ? 'text-accent' : 'text-zinc-500 hover:text-zinc-200'}`}
          title={t('editpilot.selectCli')}
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={() => { stop(); actions.setShowEditPilot(false) }}
          disabled={showSettings}
          tabIndex={showSettings ? -1 : undefined}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
          title={t('editpilot.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Settings live in their own dialog: the chat is a conversation with
          history, and swapping it out for a form loses your place in it. */}
      {showSettings && (
        <EditPilotSettings onClose={() => setShowSettings(false)} onChanged={refreshAgent} />
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map(message => (
          message.role === 'confirm' && message.confirm ? (
            <div key={message.id} id={`epc-${message.confirm.requestId}`}>
              <EditPilotConfirmCard
                request={message.confirm}
                answeredActionId={message.answeredActionId}
                answeredItemNumbers={message.answeredItemNumbers}
                expired={message.expired}
                onSeek={seekToConfirmItem}
                onAnswer={(action, selectedItemNumbers) => answerConfirm(message.confirm!, action, selectedItemNumbers)}
              />
            </div>
          ) : message.role === 'user' ? (

            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-accent/25 px-3 py-2 text-[12.5px] leading-relaxed text-zinc-100">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id}>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-[12.5px] leading-relaxed text-zinc-200">
                {message.text ? (
                  <span className="whitespace-pre-wrap">{message.text}</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                    <span>{t('editpilot.thinking')}</span>
                  </span>
                )}
                {message.streaming && message.text ? <span className="ml-0.5 animate-pulse text-accent">▍</span> : null}
              </div>
            </div>
          )
        ))}

        {messages.length === 0 && (
          <div className="pt-5 pb-2 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 border border-accent/25 text-accent shadow-[0_0_15px_rgba(34,211,238,0.15)]">
              <Bot className="h-5 w-5" />
            </div>
            <p className="pb-3 text-center text-[12px] font-medium text-zinc-400">{t('editpilot.assistantRole')}</p>
            <div className="space-y-1.5 text-left">
              {suggestions.map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => submit(suggestion)}
                  className="flex w-full items-start gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-left text-[12px] text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  <span className="flex-1">{suggestion}</span>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-zinc-800 p-2">
        {activeTasks.length > 0 && (
          <div className="mb-2">
            <EditPilotTaskCard
              tasks={activeTasks}
              running={running}
              awaiting={pendingConfirm ? {
                taskIndex: pendingConfirm.taskIndex,
                onView: () => document
                  .getElementById(`epc-${pendingConfirm.requestId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
              } : null}
            />
          </div>
        )}

        {references.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {references.map(reference => (
              <span
                key={reference.clipId}
                className="flex max-w-[140px] items-center gap-1 rounded bg-zinc-800 px-1.5 py-1 text-[10.5px] text-zinc-300"
                title={reference.label}
              >
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm bg-zinc-600" />
                <span className="truncate">{reference.label}</span>
              </span>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 focus-within:border-accent/50">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              // The editor listens for single-key shortcuts on window; typing
              // here must never reach them.
              event.stopPropagation()
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit(input)
              }
            }}
            placeholder={t('editpilot.placeholder')}
            className="w-full resize-none bg-transparent px-2.5 pt-2 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <span className="text-[10.5px] text-zinc-600">
              {references.length > 0 ? t('editpilot.clipsReferenced', { count: references.length }) : t('editpilot.selectClipsToRef')}
            </span>
            <div className="flex-1" />
            {running ? (
              <button
                onClick={stop}
                title={t('editpilot.stop')}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 transition-colors hover:bg-zinc-600"
              >
                <Square className="h-3 w-3" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => submit(input)}
                disabled={!input.trim()}
                title={t('editpilot.send')}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-zinc-950 transition-opacity disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

export const CoEditPanel = EditPilotPanel
export type CoEditPanelProps = EditPilotPanelProps
