import { AlertCircle, Bot } from 'lucide-react'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions } from '../editor-store'

/**
 * Why an AI panel could not run, and what to do about it.
 *
 * Highlights and B-roll both think through the CLI configured in EditPilot and
 * nothing else, so both fail the same two ways: no CLI set up, or a CLI that
 * did not answer. Neither is something the user can guess from a blank result,
 * and the first has a fix one click away.
 */
export function CliRequiredNotice({ failure }: {
  failure: { kind: 'missing' } | { kind: 'failed'; detail: string }
}) {
  const { t } = useTranslation()
  const actions = useEditorActions()

  return (
    <div className="space-y-2 rounded-lg border border-amber-800/80 bg-amber-950/40 p-2.5">
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          {failure.kind === 'missing'
            ? t('library.aiCli.notConfigured')
            : t('library.aiCli.failed', { detail: failure.detail })}
        </span>
      </p>
      <button
        onClick={() => actions.setShowEditPilot(true)}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-amber-900/60 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-900"
      >
        <Bot className="h-3.5 w-3.5" />
        <span>{t('library.aiCli.openEditPilot')}</span>
      </button>
    </div>
  )
}

/** Turns the handler's error code into what the notice should say, or null. */
export function readCliFailure(error: string | undefined):
  | { kind: 'missing' }
  | { kind: 'failed'; detail: string }
  | null {
  if (!error) return null
  if (error === 'NO_CLI') return { kind: 'missing' }
  if (error.startsWith('CLI_FAILED')) {
    return { kind: 'failed', detail: error.replace(/^CLI_FAILED:?\s*/, '') }
  }
  return null
}
