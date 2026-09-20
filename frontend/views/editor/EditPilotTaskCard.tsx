import { useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleSlash,
  Clock,
  Loader2,
} from 'lucide-react'
import { countCompletedTasks, type EditPilotTask } from '@core/editpilot-plan'
import { useTranslation } from '../../i18n/I18nContext'

/* ────────────────────────────────────────────────────────────────
   Task checklist

   A CLI run is a long silence with one wall of text at the end. This
   card is the running commentary: the plan the agent declared, with
   each line ticking over as it lands, and a k/n counter in the header
   docked above the composer.

   When the agent stops to ask something, the header says so and the
   blocked line grows a link back to the question, so a card scrolled
   out of the thread is still one click away.
   ──────────────────────────────────────────────────────────────── */

export interface EditPilotTaskCardAwaiting {
  /** 1-based plan item the question belongs to, when the agent named one. */
  taskIndex?: number
  /** Brings the confirmation card back into view. */
  onView: () => void
}

export interface EditPilotTaskCardProps {
  tasks: EditPilotTask[]
  /** True while the run is still going, which changes the header wording. */
  running: boolean
  /** Set while a confirmation card is waiting for an answer. */
  awaiting?: EditPilotTaskCardAwaiting | null
}

export function EditPilotTaskCard({ tasks, running, awaiting }: EditPilotTaskCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  if (tasks.length === 0) return null

  const completed = countCompletedTasks(tasks)
  const finished = !running && completed === tasks.length
  // Stopped or failed part-way: saying "processing" next to a frozen spinner
  // would be a lie, so the card admits the run ended short.
  const halted = !running && !finished
  const Chevron = expanded ? ChevronUp : ChevronDown

  // The agent names the blocked item when it can; otherwise the one in flight
  // is the one waiting, since only one ever is.
  const blockedIndex = awaiting
    ? awaiting.taskIndex ?? tasks.find(task => task.status === 'running')?.index
    : undefined

  return (
    <div
      className={`rounded-lg border ${
        awaiting
          ? 'border-amber-500/40 bg-amber-500/10'
          : halted
            ? 'border-zinc-700 bg-zinc-900'
            : 'border-accent/30 bg-accent/10'
      }`}
    >
      <button
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {awaiting ? (
          <Clock className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
        ) : finished ? (
          <CircleCheck className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
        ) : halted ? (
          <CircleSlash className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-accent" />
        )}
        <span className="flex-1 text-[12px] font-medium text-zinc-100">
          {awaiting
            ? t('editpilot.tasksAwaiting')
            : finished
              ? t('editpilot.tasksDone')
              : halted
                ? t('editpilot.tasksHalted')
                : t('editpilot.tasksProcessing')}
        </span>
        <span className="text-[11px] text-zinc-400">{completed}/{tasks.length}</span>
        <Chevron className="h-3.5 w-3.5 text-zinc-400" />
      </button>

      {expanded && (
        <ul className="space-y-1.5 px-3 pb-2.5">
          {tasks.map(task => {
            const blocked = task.index === blockedIndex
            return (
              <li key={task.index} className="flex items-start gap-2 text-[12px] leading-snug">
                <span className="mt-[3px] flex h-3 w-3 flex-shrink-0 items-center justify-center">
                  {task.status === 'done' ? (
                    <Check className="h-3 w-3 text-accent" />
                  ) : blocked ? (
                    <Clock className="h-3 w-3 text-amber-400" />
                  ) : task.status === 'running' ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                  )}
                </span>
                <span className={task.status === 'pending' && !blocked ? 'text-zinc-500' : 'text-zinc-200'}>
                  {task.label}
                </span>
                {blocked && awaiting && (
                  <button
                    onClick={awaiting.onView}
                    className="ml-auto flex flex-shrink-0 items-center gap-0.5 text-[11.5px] text-accent hover:underline"
                  >
                    {t('editpilot.view')}
                    <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
