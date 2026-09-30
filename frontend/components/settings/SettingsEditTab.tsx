import React from 'react'
import { useTranslation } from '../../i18n/I18nContext'
import type { AppSettings } from '../../../shared/app-settings-schema'

export interface SettingsEditTabProps {
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
}

export const SettingsEditTab: React.FC<SettingsEditTabProps> = ({
  draft,
  setDraft,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Default Image Duration */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.imageDuration')}</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={draft.defaultImageDuration}
            onChange={(e) => setDraft(p => ({ ...p, defaultImageDuration: parseFloat(e.target.value) }))}
            className="w-32 accent-teal-500 cursor-pointer"
          />
          <span className="text-xs text-zinc-300 font-mono w-14 text-right">
            {draft.defaultImageDuration.toFixed(1)} {t('settings.edit.seconds')}
          </span>
        </div>
      </div>

      {/* Default Transition Duration */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.transitionDuration')}</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={draft.defaultTransitionDuration}
            onChange={(e) => setDraft(p => ({ ...p, defaultTransitionDuration: parseFloat(e.target.value) }))}
            className="w-32 accent-teal-500 cursor-pointer"
          />
          <span className="text-xs text-zinc-300 font-mono w-14 text-right">
            {draft.defaultTransitionDuration.toFixed(1)} {t('settings.edit.seconds')}
          </span>
        </div>
      </div>

      {/* Default Frame Rate */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-800/80">
        <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.frameRate')}</span>
        <select
          value={draft.defaultFps}
          onChange={(e) => setDraft(p => ({ ...p, defaultFps: parseInt(e.target.value, 10) }))}
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
        >
          <option value={24}>24 fps</option>
          <option value={25}>25 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </div>

      {/* Timecode format */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.timecode')}</span>
        <select
          value={draft.timecodeFormat}
          onChange={(e) => setDraft(p => ({ ...p, timecodeFormat: e.target.value as any }))}
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
        >
          <option value="timecode">{t('settings.edit.timecodeFormat')}</option>
          <option value="frames">{t('settings.edit.framesFormat')}</option>
        </select>
      </div>
    </div>
  )
}
