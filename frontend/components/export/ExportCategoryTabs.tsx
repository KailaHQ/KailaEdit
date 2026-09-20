import { Film, Sparkles, Sliders, Music } from 'lucide-react'
import {
  SOCIAL_PRESETS,
  EXPORT_FORMATS,
  type ExportCodec,
  type SocialPreset,
} from '@core/export-options'

const CODEC_INFO = EXPORT_FORMATS

export type ExportActiveTab = 'video' | 'social' | 'gif' | 'audio'

export interface ExportCategoryTabsProps {
  activeTab: ExportActiveTab
  setActiveTab: (tab: ExportActiveTab) => void
  selectedPresetId: string | null
  codec: ExportCodec
  onCodecChange: (codec: ExportCodec) => void
  onSelectSocialPreset: (preset: SocialPreset) => void
}

export function ExportCategoryTabs({
  activeTab,
  setActiveTab,
  selectedPresetId,
  codec,
  onCodecChange,
  onSelectSocialPreset,
}: ExportCategoryTabsProps) {
  return (
    <div className="space-y-4">
      {/* Category tabs strip */}
      <div className="grid grid-cols-4 gap-1.5 p-1 bg-zinc-800/60 rounded-xl border border-zinc-700/50">
        <button
          onClick={() => {
            setActiveTab('video')
            onCodecChange('h264')
          }}
          className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'video'
              ? 'bg-zinc-700 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Film className="h-3.5 w-3.5" />
          Video
        </button>
        <button
          onClick={() => {
            setActiveTab('social')
            if (!selectedPresetId) {
              onSelectSocialPreset(SOCIAL_PRESETS[0])
            }
          }}
          className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'social'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Social
        </button>
        <button
          onClick={() => {
            setActiveTab('gif')
            onCodecChange('gif')
          }}
          className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'gif'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          GIF
        </button>
        <button
          onClick={() => {
            setActiveTab('audio')
            onCodecChange('mp3')
          }}
          className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'audio'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Music className="h-3.5 w-3.5" />
          Audio
        </button>
      </div>

      {/* TAB 1: SOCIAL PRESETS */}
      {activeTab === 'social' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block">
              Social Media Presets
            </label>
            <div className="grid grid-cols-1 gap-2">
              {SOCIAL_PRESETS.map(preset => {
                const isSelected = selectedPresetId === preset.id
                return (
                  <button
                    key={preset.id}
                    onClick={() => onSelectSocialPreset(preset)}
                    className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-white flex items-center gap-2">
                        {preset.name}
                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-zinc-700 text-blue-300">
                          {preset.aspectRatio}
                        </span>
                      </p>
                      <p className="text-[10px] text-zinc-400">{preset.description}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <span className="text-xs font-bold text-zinc-200">{preset.bitrateMbps} Mbps</span>
                      <p className="text-[10px] text-zinc-500">{preset.fps} fps</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOM VIDEO */}
      {activeTab === 'video' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">
              Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['h264', 'prores', 'vp9'] as ExportCodec[]).map(c => (
                <button
                  key={c}
                  onClick={() => onCodecChange(c)}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    codec === c
                      ? 'border-blue-500 bg-blue-500/10 text-white'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  <p className="text-xs font-semibold">{CODEC_INFO[c].label.split(' / ')[0]}</p>
                  <p className="text-[9px] text-zinc-500 mt-0.5">.{CODEC_INFO[c].ext}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: GIF ANIMATION */}
      {activeTab === 'gif' && (
        <div className="space-y-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-xs font-medium text-amber-300">High-Quality GIF Export</p>
            <p className="text-[10px] text-zinc-400 mt-1">
              Rendered using 2-pass color palette generation (palettegen / paletteuse) with Bayer dithering for smooth gradients.
            </p>
          </div>
        </div>
      )}

      {/* TAB 4: AUDIO ONLY */}
      {activeTab === 'audio' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">
              Audio Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['wav', 'mp3', 'aac'] as ExportCodec[]).map(c => (
                <button
                  key={c}
                  onClick={() => onCodecChange(c)}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    codec === c
                      ? 'border-purple-500 bg-purple-500/10 text-white'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  <p className="text-xs font-semibold">{CODEC_INFO[c].label.split(' / ')[0]}</p>
                  <p className="text-[9px] text-zinc-500 mt-0.5">.{CODEC_INFO[c].ext}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
