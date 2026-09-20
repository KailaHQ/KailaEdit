import { FileVideo, FileImage, FileAudio, Type } from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import { namedResolutionTier } from '../../../lib/video-resolution'
import { formatTime } from '../video-editor-utils'
import { useSettings } from '../../../contexts/SettingsContext'
import { selectActiveTimeline, selectAssets, selectTracks } from '../editor-selectors'
import { useEditorStore } from '../editor-store'

export interface MetadataTabProps {
  selectedClip: TimelineClip
}

export function MetadataTab({ selectedClip }: MetadataTabProps) {
  const assets = useEditorStore(selectAssets)
  const tracks = useEditorStore(selectTracks)
  const { settings } = useSettings()
  const activeTimelineFps = useEditorStore(state => selectActiveTimeline(state)?.fps)
  const fps = activeTimelineFps ?? settings.defaultFps ?? 30
  const timecodeFormat = settings.timecodeFormat ?? 'timecode'

  const liveAsset = selectedClip.assetId ? assets.find(a => a.id === selectedClip.assetId) || selectedClip.asset : selectedClip.asset
  const dims = selectedClip.type !== 'audio' && liveAsset?.width && liveAsset?.height
    ? { width: liveAsset.width, height: liveAsset.height }
    : null

  const filePath = liveAsset?.path || ''
  const qualityTier = dims ? namedResolutionTier(Math.min(dims.width, dims.height)) : 0

  return (
    <div className="space-y-3">
      {/* Currently Displayed */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          Currently Displayed
        </h4>
        <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
          {dims ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Quality</span>
                <span className="text-xs text-white">
                  {qualityTier >= 2160
                    ? 'Ultra HD'
                    : qualityTier >= 1080
                      ? 'Full HD'
                      : qualityTier >= 720
                        ? 'HD'
                        : 'SD'}
                </span>
              </div>
              {dims.width > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Dimensions</span>
                  <span className="text-xs text-white font-mono">
                    {dims.width} × {dims.height}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-zinc-500 italic">Dimension metadata unavailable.</div>
          )}
        </div>
      </div>

      {/* Clip Info */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
          Clip Info
        </h4>
        <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Type</span>
            <div className="flex items-center gap-1">
              {selectedClip.type === 'video' && <FileVideo className="h-3 w-3 text-zinc-400" />}
              {selectedClip.type === 'image' && <FileImage className="h-3 w-3 text-zinc-400" />}
              {selectedClip.type === 'audio' && <FileAudio className="h-3 w-3 text-zinc-400" />}
              {selectedClip.type === 'text' && <Type className="h-3 w-3 text-zinc-400" />}
              <span className="text-xs text-white capitalize">{selectedClip.type}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Duration</span>
            <span className="text-xs text-white">{selectedClip.duration.toFixed(2)}s</span>
          </div>
          {liveAsset?.duration && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Source Duration</span>
              <span className="text-xs text-white">{liveAsset.duration.toFixed(2)}s</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Speed</span>
            <span className="text-xs text-white">{selectedClip.speed}x</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Track</span>
            <span className="text-xs text-white">
              {tracks[selectedClip.trackIndex]?.name || `Track ${selectedClip.trackIndex + 1}`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Start</span>
            <span className="text-xs text-white">
              {formatTime(selectedClip.startTime, fps, timecodeFormat)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">End</span>
            <span className="text-xs text-white">
              {formatTime(selectedClip.startTime + selectedClip.duration, fps, timecodeFormat)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Trim In</span>
            <span className="text-xs text-white">{selectedClip.trimStart.toFixed(2)}s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Trim Out</span>
            <span className="text-xs text-white">{selectedClip.trimEnd.toFixed(2)}s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Opacity</span>
            <span className="text-xs text-white">{selectedClip.opacity}%</span>
          </div>
        </div>
      </div>

      {/* File Path */}
      {filePath && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">File</h4>
          <div className="bg-zinc-800/60 rounded-lg p-3">
            <p className="text-[10px] text-zinc-400 break-all font-mono leading-relaxed">
              {filePath}
            </p>
          </div>
        </div>
      )}

      {/* Asset Created At */}
      {liveAsset?.createdAt && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
            Created
          </h4>
          <div className="bg-zinc-800/60 rounded-lg p-3">
            <span className="text-xs text-zinc-300">
              {new Date(liveAsset.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
