import React from 'react'
import { Menu, Shield } from 'lucide-react'

export interface MonitorHeaderProps {
  activeTimelineName?: string
  isPreviewingVideo: boolean
  sourceVideoDimensions: { width: number; height: number } | null
  effectiveDimensions: { aspectRatioLabel: string }
  showSafeZoneGuide: boolean
  onToggleSafeZoneGuide: () => void
  onOpenProjectSettings: () => void
}

export const MonitorHeader: React.FC<MonitorHeaderProps> = ({
  activeTimelineName,
  isPreviewingVideo,
  sourceVideoDimensions,
  effectiveDimensions,
  showSafeZoneGuide,
  onToggleSafeZoneGuide,
  onOpenProjectSettings,
}) => {
  return (
    <div className="flex h-[34px] flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="truncate text-[13px] text-zinc-100 font-medium">
          Player{activeTimelineName ? ` - ${activeTimelineName}` : ''}
        </span>
        {isPreviewingVideo && sourceVideoDimensions ? (
          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-950/80 text-blue-300 border border-blue-500/40">
            Original: {sourceVideoDimensions.width}×{sourceVideoDimensions.height}
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenProjectSettings}
            className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-teal-400 transition-colors border border-zinc-700/60"
            title="Change project / timeline dimensions"
          >
            {effectiveDimensions.aspectRatioLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleSafeZoneGuide}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors border ${
            showSafeZoneGuide
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
          }`}
          title="Toggle TikTok / Reels 9:16 Safe Zone Guide"
        >
          <Shield className="h-3 w-3" />
          Safe Zone
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenProjectSettings}
        className="cc-icon-btn"
        title="Project / timeline settings"
      >
        <Menu className="h-4 w-4" />
      </button>
    </div>
  )
}
