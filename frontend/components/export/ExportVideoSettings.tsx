import React from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import type { Timeline } from '../../types/project-model'
import {
  EXPORT_FORMATS,
  formatFileSize,
  type ExportCodec,
} from '@core/export-options'
import { useTranslation } from '../../i18n/I18nContext'
import type { ExportActiveTab } from './ExportCategoryTabs'

const CODEC_INFO = EXPORT_FORMATS

const PRORES_PROFILES = [
  { value: 0, label: 'Proxy' },
  { value: 1, label: 'LT' },
  { value: 2, label: 'Standard' },
  { value: 3, label: 'HQ' },
]

export interface ExportSettingsState {
  codec: ExportCodec
  width: number
  height: number
  fps: number
  quality: number
  customBitrateMbps?: number
  useCustomBitrate?: boolean
}

export interface ExportVideoSettingsProps {
  activeTab: ExportActiveTab
  settings: ExportSettingsState
  setSettings: React.Dispatch<React.SetStateAction<ExportSettingsState>>
  availableResolutions: Array<{ label: string; width: number; height: number }>
  availableFps: number[]
  estimatedSizeBytes: number
  hasSubtitles: boolean
  burnSubtitles: boolean
  setBurnSubtitles: (burn: boolean) => void
  allTimelines: Timeline[]
  timeline?: Timeline | null
  selectedVariantIds: string[]
  setSelectedVariantIds: React.Dispatch<React.SetStateAction<string[]>>
}

export function ExportVideoSettings({
  activeTab,
  settings,
  setSettings,
  availableResolutions,
  availableFps,
  estimatedSizeBytes,
  hasSubtitles,
  burnSubtitles,
  setBurnSubtitles,
  allTimelines,
  timeline,
  selectedVariantIds,
  setSelectedVariantIds,
}: ExportVideoSettingsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* RESOLUTION & FRAME RATE (Hidden for audio-only) */}
      {activeTab !== 'audio' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">
              {t('export.resolution')}
            </label>
            <div className="relative">
              <select
                value={`${settings.width}x${settings.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number)
                  setSettings(prev => ({ ...prev, width: w, height: h }))
                }}
                className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 pr-8 cursor-pointer"
              >
                {availableResolutions.map(r => (
                  <option key={`${r.width}x${r.height}`} value={`${r.width}x${r.height}`}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5 block">
              {t('export.frameRate')}
            </label>
            <div className="relative">
              <select
                value={settings.fps}
                onChange={(e) => setSettings(prev => ({ ...prev, fps: parseFloat(e.target.value) }))}
                className="w-full appearance-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 pr-8 cursor-pointer"
              >
                {availableFps.map(fps => (
                  <option key={fps} value={fps}>{fps} fps</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            </div>
          </div>
        </div>
      )}

      {/* BITRATE & QUALITY CONTROLS */}
      {activeTab !== 'audio' && activeTab !== 'gif' && (
        <div className="space-y-3 pt-1 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
              {t('export.quality')}
            </label>
            {(settings.codec === 'h264' || settings.codec === 'vp9') && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings.useCustomBitrate)}
                  onChange={(e) => setSettings(prev => ({ ...prev, useCustomBitrate: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500 cursor-pointer"
                />
                <span>{t('export.useCustomBitrate')}</span>
              </label>
            )}
          </div>

          {/* Custom Bitrate input box */}
          {settings.useCustomBitrate && (settings.codec === 'h264' || settings.codec === 'vp9') ? (
            <div className="flex items-center gap-3 bg-zinc-800/70 p-2.5 rounded-lg border border-zinc-700">
              <span className="text-xs text-zinc-300 font-medium whitespace-nowrap">Target Bitrate:</span>
              <input
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={settings.customBitrateMbps || 8}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 1
                  setSettings(prev => ({ ...prev, customBitrateMbps: Math.max(0.5, val) }))
                }}
                className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 text-right"
              />
              <span className="text-xs text-zinc-400">Mbps</span>
              <div className="flex-1 text-right text-xs text-blue-400">
                ~{formatFileSize(estimatedSizeBytes)}
              </div>
            </div>
          ) : (
            <>
              {settings.codec === 'h264' && (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={15}
                    max={28}
                    step={1}
                    value={settings.quality}
                    onChange={(e) => setSettings(prev => ({ ...prev, quality: parseInt(e.target.value) }))}
                    className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-400 w-16 text-right">
                    {settings.quality <= 18 ? 'High' : settings.quality <= 23 ? 'Medium' : 'Low'}
                    <span className="text-zinc-600 ml-1">({settings.quality})</span>
                  </span>
                </div>
              )}
              {settings.codec === 'prores' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {PRORES_PROFILES.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setSettings(prev => ({ ...prev, quality: p.value }))}
                      className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                        settings.quality === p.value
                          ? 'bg-blue-500/20 border border-blue-500 text-blue-300'
                          : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {settings.codec === 'vp9' && (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={2}
                    max={20}
                    step={1}
                    value={settings.quality}
                    onChange={(e) => setSettings(prev => ({ ...prev, quality: parseInt(e.target.value) }))}
                    className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-400 w-20 text-right">
                    {settings.quality} Mbps
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ESTIMATED SIZE BADGE */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/40">
        <div className="space-y-0.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
            {t('export.estimatedSize')}
          </span>
          <p className="text-sm font-bold text-emerald-400">~{formatFileSize(estimatedSizeBytes)}</p>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
            Format
          </span>
          <p className="text-xs text-zinc-300 font-medium">.{CODEC_INFO[settings.codec]?.ext.toUpperCase()}</p>
        </div>
      </div>

      {/* SUBTITLES OPTION (Video only) */}
      {hasSubtitles && activeTab !== 'audio' && activeTab !== 'gif' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={burnSubtitles}
              onChange={(e) => setBurnSubtitles(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 accent-blue-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-300 group-hover:text-white transition-colors">
              {t('export.burnSubtitles')}
            </span>
          </label>
        </div>
      )}

      {/* TIMELINE VARIANTS BATCH EXPORT OPTION */}
      {allTimelines.length > 1 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
              Export Variants ({selectedVariantIds.length}/{allTimelines.length})
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedVariantIds.length === allTimelines.length) {
                  if (timeline?.id) setSelectedVariantIds([timeline.id])
                } else {
                  setSelectedVariantIds(allTimelines.map(t => t.id))
                }
              }}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
            >
              {selectedVariantIds.length === allTimelines.length ? 'Current Only' : 'Select All'}
            </button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto pt-1">
            {allTimelines.map(tl => {
              const isChecked = selectedVariantIds.includes(tl.id)
              const isCurrent = tl.id === timeline?.id
              return (
                <label
                  key={tl.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                    isChecked ? 'bg-indigo-950/40 text-indigo-200' : 'text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedVariantIds(prev => [...prev, tl.id])
                        } else {
                          if (selectedVariantIds.length > 1) {
                            setSelectedVariantIds(prev => prev.filter(id => id !== tl.id))
                          }
                        }
                      }}
                      className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 accent-indigo-600 cursor-pointer"
                    />
                    <span className="truncate font-medium">{tl.name}</span>
                    {tl.variantTag && (
                      <span className="rounded bg-indigo-950 px-1 text-[9px] text-indigo-300 border border-indigo-800/50">
                        {tl.variantTag}
                      </span>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Active</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
