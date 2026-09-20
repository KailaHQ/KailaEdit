import { Captions, FileUp } from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'
import { useEditorActions } from './editor-store'
import { AutoCaptionsPanel } from './captions/AutoCaptionsPanel'
import { AutoHighlightsPanel } from './captions/AutoHighlightsPanel'
import { BrollCopilotPanel } from './captions/BrollCopilotPanel'

export interface CaptionsLibraryProps {
  section: string
  onImportSrt: () => void
  importFiles: (files: FileList | File[]) => Promise<unknown>
}

export function CaptionsLibrary({ section, onImportSrt, importFiles }: CaptionsLibraryProps) {
  const actions = useEditorActions()
  const { t } = useTranslation()

  if (section === 'auto-captions') {
    return <AutoCaptionsPanel />
  }

  if (section === 'auto-highlights') {
    return <AutoHighlightsPanel />
  }

  if (section === 'broll-copilot') {
    return <BrollCopilotPanel importFiles={importFiles} />
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => actions.addSubtitleTrack()}
        className="flex w-full items-center gap-2.5 rounded-[6px] bg-zinc-900 px-3 py-2.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        <Captions className="h-4 w-4 text-accent" />
        {t('captions.addTrack')}
      </button>
      <button
        onClick={onImportSrt}
        className="flex w-full items-center gap-2.5 rounded-[6px] bg-zinc-900 px-3 py-2.5 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        <FileUp className="h-4 w-4 text-accent" />
        {t('captions.localCaptions')}
      </button>
    </div>
  )
}
