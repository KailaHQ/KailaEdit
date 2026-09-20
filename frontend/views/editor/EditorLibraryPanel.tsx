import { Music2 } from 'lucide-react'
import type { Asset } from '../../types/project-model'
import { useTranslation } from '../../i18n/I18nContext'
import type { LibraryTab } from './editor-state'
import { selectClips, selectSelectedClipIds } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { TransitionsLibrary } from './TransitionsLibrary'
import { TemplatesLibrary } from './TemplatesLibrary'
import { FiltersLibrary } from './FiltersLibrary'
import { SoundEffectsLibrary } from './SoundEffectsLibrary'
import { TextLibrary } from './TextLibrary'
import { EffectLibrary } from './EffectLibrary'
import { CaptionsLibrary } from './CaptionsLibrary'
import { StickersLibrary } from './StickersLibrary'
import {
  VideoEditorAssetsPanel,
  type VideoEditorAssetsPanelHandle,
} from './VideoEditorAssetsPanel'

export interface EditorLibraryPanelProps {
  tab: LibraryTab
  section: string
  assetsPanelRef: React.Ref<VideoEditorAssetsPanelHandle>
  openSourceAsset: (asset: Asset) => void
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  importFiles: (files: FileList | File[]) => Promise<unknown>
  onImportSrt: () => void
}

/**
 * The panel to the right of the sub-nav. Media and Audio browse project
 * assets with appropriate filters; the rest render their own pickers.
 */
export function EditorLibraryPanel(props: EditorLibraryPanelProps) {
  const { tab, section } = props

  if (tab === 'media') {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <VideoEditorAssetsPanel
          ref={props.assetsPanelRef}
          openSourceAsset={props.openSourceAsset}
          handleImportFile={props.handleImportFile}
          importFiles={props.importFiles}
          mediaTypeFilter="all"
        />
      </div>
    )
  }

  if (tab === 'audio') {
    if (section === 'sound-effects') {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SoundEffectsLibrary importFiles={props.importFiles} />
          </div>
        </div>
      )
    }

    if (section === 'extract') {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ExtractAudioExplanation />
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <VideoEditorAssetsPanel
          ref={props.assetsPanelRef}
          openSourceAsset={props.openSourceAsset}
          handleImportFile={props.handleImportFile}
          importFiles={props.importFiles}
          mediaTypeFilter="audio"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'text' && <TextLibrary section={section} />}
        {tab === 'filters' && <FiltersLibrary />}
        {(tab === 'effects' || tab === 'adjust') && (
          <EffectLibrary tab={tab} />
        )}
        {tab === 'captions' && (
          <CaptionsLibrary
            section={section}
            onImportSrt={props.onImportSrt}
            importFiles={props.importFiles}
          />
        )}
        {tab === 'transitions' && <TransitionsLibrary />}
        {tab === 'templates' && <TemplatesLibrary section={section} />}
        {tab === 'stickers' && (
          <StickersLibrary importFiles={props.importFiles} />
        )}
      </div>
    </div>
  )
}

function ExtractAudioExplanation() {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const clips = useEditorStore(selectClips)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)

  const selectedVideoClips = clips.filter(
    c => selectedClipIds.has(c.id) && c.type === 'video' && !c.linkedClipIds?.some(id => clips.find(x => x.id === id)?.type === 'audio'),
  )

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <Music2 className="h-7 w-7 text-zinc-600" />
      <p className="text-[12px] font-medium text-zinc-300">{t('library.audio.extractTitle')}</p>
      {selectedVideoClips.length > 0 ? (
        <button
          onClick={() => {
            for (const clip of selectedVideoClips) {
              actions.detachAudio(clip.id)
            }
          }}
          className="flex items-center gap-2 rounded-[6px] bg-accent px-3 py-2 text-[12px] font-medium text-zinc-950 transition-colors hover:bg-accent/90"
        >
          <Music2 className="h-4 w-4" />
          {selectedVideoClips.length === 1
            ? t('library.audio.extractBtnSingle')
            : t('library.audio.extractBtnMultiple', { count: selectedVideoClips.length })}
        </button>
      ) : (
        <p className="max-w-[260px] text-[11px] leading-relaxed text-zinc-500">
          {t('library.audio.extractHint')}
        </p>
      )}
    </div>
  )
}
