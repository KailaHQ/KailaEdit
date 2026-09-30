import React from 'react'
import { Folder, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'
import type { AppSettings } from '../../../shared/app-settings-schema'

export interface SettingsDraftTabProps {
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
  handleBrowseProjectsDir: () => void
  handleBrowseExportDir: () => void
  cacheSizeStr: string
  handleClearCache: () => void
  clearingCache: boolean
  cacheFeedback: string | null
}

export const SettingsDraftTab: React.FC<SettingsDraftTabProps> = ({
  draft,
  setDraft,
  handleBrowseProjectsDir,
  handleBrowseExportDir,
  cacheSizeStr,
  handleClearCache,
  clearingCache,
  cacheFeedback,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Project Save Location */}
      <div className="flex items-center justify-between gap-4">
        <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.saveLocation')}</span>
        <div className="flex-1 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
          <span className="flex-1 truncate text-xs text-zinc-400 font-mono" title={draft.projectsDir}>
            {draft.projectsDir || 'Default AppData/Projects'}
          </span>
          <button
            onClick={handleBrowseProjectsDir}
            className="p-1 text-zinc-400 hover:text-white transition-colors"
            title={t('common.browse')}
          >
            <Folder className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Screen recording / Export Path */}
      <div className="flex items-center justify-between gap-4">
        <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.downloadLocation')}</span>
        <div className="flex-1 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
          <span className="flex-1 truncate text-xs text-zinc-400 font-mono" title={draft.defaultExportDir}>
            {draft.defaultExportDir || 'Default User Downloads'}
          </span>
          <button
            onClick={handleBrowseExportDir}
            className="p-1 text-zinc-400 hover:text-white transition-colors"
            title={t('common.browse')}
          >
            <Folder className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Cache policy radio */}
      <div className="pt-2 border-t border-zinc-800/80">
        <div className="flex items-start gap-4 mb-3">
          <span className="w-28 text-zinc-300 font-medium pt-1">{t('settings.draft.cachePolicy')}</span>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="cachePolicy"
                checked={draft.cachePolicy === 'keep'}
                onChange={() => setDraft(p => ({ ...p, cachePolicy: 'keep' }))}
                className="accent-teal-500 w-4 h-4 cursor-pointer"
              />
              <span className="text-zinc-300 text-xs">{t('settings.draft.cachePolicyKeep')}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="cachePolicy"
                checked={draft.cachePolicy === 'auto-30-days'}
                onChange={() => setDraft(p => ({ ...p, cachePolicy: 'auto-30-days' }))}
                className="accent-teal-500 w-4 h-4 cursor-pointer"
              />
              <span className="text-zinc-300 text-xs">{t('settings.draft.cachePolicyAuto30')}</span>
            </label>
          </div>
        </div>

        {/* Cache size & clear */}
        <div className="flex items-center justify-between gap-4 pt-2">
          <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.cacheSize')}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 font-mono">{cacheSizeStr}</span>
            <button
              onClick={handleClearCache}
              disabled={clearingCache}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors disabled:opacity-50"
              title={t('settings.draft.clearCache')}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
              {t('settings.draft.clearCache')}
            </button>
          </div>
        </div>
        {cacheFeedback && (
          <p className="text-[11px] text-teal-400 mt-2 pl-32">{cacheFeedback}</p>
        )}
      </div>
    </div>
  )
}
