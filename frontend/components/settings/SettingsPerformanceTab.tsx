import React from 'react'
import { useTranslation } from '../../i18n/I18nContext'
import type { AppSettings } from '../../../shared/app-settings-schema'

export interface SettingsPerformanceTabProps {
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
  hwEncoderInfo: string | null
  matteDeviceInfo: {
    available: string[]
    preferred: string
    gpuAvailable: boolean
  } | null
  audioDevices: Array<{ deviceId: string; label: string }>
}

export const SettingsPerformanceTab: React.FC<SettingsPerformanceTabProps> = ({
  draft,
  setDraft,
  hwEncoderInfo,
  matteDeviceInfo,
  audioDevices,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Hardware encoding & decoding */}
      <div className="space-y-3">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
          {t('settings.performance.hardwareAccel')}
        </span>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.hardwareAcceleration}
              onChange={(e) => setDraft(p => ({ ...p, hardwareAcceleration: e.target.checked }))}
              className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
            />
            <span className="text-zinc-300 text-xs">{t('settings.performance.hardwareEncode')}</span>
          </label>
          {hwEncoderInfo && (
            <span className="text-[11px] text-zinc-500 ml-6 pl-0.5">
              {draft.hardwareAcceleration ? t('settings.performance.device', { info: hwEncoderInfo }) : t('settings.performance.hardwareAccelerationDisabled')}
            </span>
          )}
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.hardwareDecode}
            onChange={(e) => setDraft(p => ({ ...p, hardwareDecode: e.target.checked }))}
            className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
          />
          <span className="text-zinc-300 text-xs">{t('settings.performance.hardwareDecode')}</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.gpuUiRendering}
            onChange={(e) => setDraft(p => ({ ...p, gpuUiRendering: e.target.checked }))}
            className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
          />
          <span className="text-zinc-300 text-xs">{t('settings.performance.gpuRendering')}</span>
        </label>
      </div>

      {/* Background removal device */}
      <div className="pt-3 border-t border-zinc-800/80 space-y-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
          {t('settings.performance.matteDevice')}
        </span>
        <div className="flex gap-1.5">
          {(['auto', 'gpu', 'cpu'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setDraft(p => ({ ...p, autoMatteDevice: opt }))}
              disabled={opt === 'gpu' && matteDeviceInfo != null && !matteDeviceInfo.gpuAvailable}
              className={`flex-1 px-2 py-1.5 text-xs rounded border transition-colors ${
                draft.autoMatteDevice === opt
                  ? 'bg-teal-500/15 border-teal-500 text-teal-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 disabled:opacity-40 disabled:hover:border-zinc-800 disabled:cursor-not-allowed'
              }`}
            >
              {t(`settings.performance.matteDevice${opt === 'auto' ? 'Auto' : opt === 'gpu' ? 'Gpu' : 'Cpu'}`)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">
          {matteDeviceInfo == null
            ? t('settings.performance.matteDeviceChecking')
            : matteDeviceInfo.gpuAvailable
              ? t('settings.performance.matteDeviceFound', { provider: matteDeviceInfo.preferred.toUpperCase() })
              : t('settings.performance.matteDeviceNone')}
        </p>
      </div>

      {/* Proxy mode */}
      <div className="pt-3 border-t border-zinc-800/80">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-zinc-300">{t('settings.performance.proxy')}</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={draft.proxyEnabled}
              onChange={(e) => setDraft(p => ({ ...p, proxyEnabled: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
          </label>
        </div>
        <p className="text-[11px] text-zinc-500">{t('settings.performance.proxyDesc')}</p>
      </div>

      {/* Audio output device */}
      <div className="pt-3 border-t border-zinc-800/80">
        <div className="flex items-center justify-between gap-4">
          <span className="text-zinc-300 font-medium flex-1">{t('settings.performance.audioOutput')}</span>
          <select
            value={draft.audioOutputDeviceId}
            onChange={(e) => setDraft(p => ({ ...p, audioOutputDeviceId: e.target.value }))}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 max-w-[240px] truncate cursor-pointer"
          >
            <option value="default">{t('common.default')}</option>
            {audioDevices.map(dev => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
