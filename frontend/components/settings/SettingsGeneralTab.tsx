import React from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'
import type { AppSettings } from '../../../shared/app-settings-schema'

export interface SettingsGeneralTabProps {
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
  setLanguage: (lang: 'en' | 'vi') => void
}

export const SettingsGeneralTab: React.FC<SettingsGeneralTabProps> = ({
  draft,
  setDraft,
  setLanguage,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Language list */}
      <div>
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2.5">
          {t('settings.general.language')}
        </span>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-900">
          <button
            onClick={() => {
              setDraft(p => ({ ...p, language: 'en' }))
              setLanguage('en')
            }}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors ${
              draft.language === 'en'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <span>English (Default)</span>
            {draft.language === 'en' && <Check className="h-4 w-4 text-teal-400" />}
          </button>
          <button
            onClick={() => {
              setDraft(p => ({ ...p, language: 'vi' }))
              setLanguage('vi')
            }}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors ${
              draft.language === 'vi'
                ? 'bg-zinc-800/80 text-white font-medium'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <span>Tiếng Việt</span>
            {draft.language === 'vi' && <Check className="h-4 w-4 text-teal-400" />}
          </button>
        </div>
      </div>

      {/* Auto Save Settings */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-300">{t('settings.general.autoSave')}</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={draft.autoSave}
              onChange={(e) => setDraft(p => ({ ...p, autoSave: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
          </label>
        </div>
        {draft.autoSave && (
          <div className="flex items-center justify-between gap-4 pl-2">
            <span className="text-zinc-400 text-xs">{t('settings.general.autoSaveInterval')}</span>
            <select
              value={draft.autoSaveIntervalMinutes}
              onChange={(e) => setDraft(p => ({ ...p, autoSaveIntervalMinutes: parseInt(e.target.value, 10) }))}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value={0}>{t('settings.general.onMajorChangesOnly')}</option>
              <option value={1}>{t('settings.general.everyMinute', { min: 1 })}</option>
              <option value={3}>{t('settings.general.everyMinute', { min: 3 })}</option>
              <option value={5}>{t('settings.general.everyMinute', { min: 5 })}</option>
            </select>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="pt-3 border-t border-zinc-800/80">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
          {t('settings.general.notifications')}
        </span>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.exportNotifications}
            onChange={(e) => setDraft(p => ({ ...p, exportNotifications: e.target.checked }))}
            className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
          />
          <span className="text-zinc-300 text-xs">{t('settings.general.allowNotifications')}</span>
        </label>
      </div>

      {/* Software Info */}
      <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
        <span>{t('settings.general.appEdition')}</span>
        <span>v1.0.0</span>
      </div>
    </div>
  )
}
