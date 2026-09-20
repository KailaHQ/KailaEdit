import React, { useState } from 'react'
import {
  ZoomIn, ChevronLeft, ChevronRight, Pause, Play,
  Expand, Shrink,
} from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import { formatTime, getShortcutLabel, tooltipLabel } from '../video-editor-utils'
import type { KeyboardLayout } from '../../../lib/keyboard-shortcuts'

export interface MonitorTransportBarProps {
  playbackTimecodeRef: React.RefObject<HTMLSpanElement>
  isPreviewingVideo: boolean
  previewVideoPlaying: boolean
  previewVideoCurrentTime: number
  previewVideoDuration: number
  currentTime: number
  contentDuration: number
  totalDuration: number
  fps: number
  timecodeFormat?: 'timecode' | 'frames'
  isPlaying: boolean
  kbLayout: KeyboardLayout
  playbackResolution: 1 | 0.5 | 0.25
  setPlaybackResolution: (val: 1 | 0.5 | 0.25) => void
  previewZoom: 'fit' | number
  setPreviewZoom: (val: 'fit' | number) => void
  isFullscreen: boolean
  toggleFullscreen: () => void
  onStepBackward: () => void
  onTogglePlayPause: () => void
  onStepForward: () => void
}

export function MonitorTransportBar({
  playbackTimecodeRef,
  isPreviewingVideo,
  previewVideoPlaying,
  previewVideoCurrentTime,
  previewVideoDuration,
  currentTime,
  contentDuration,
  totalDuration,
  fps,
  timecodeFormat,
  isPlaying,
  kbLayout,
  playbackResolution,
  setPlaybackResolution,
  previewZoom,
  setPreviewZoom,
  isFullscreen,
  toggleFullscreen,
  onStepBackward,
  onTogglePlayPause,
  onStepForward,
}: MonitorTransportBarProps) {
  const [playbackResOpen, setPlaybackResOpen] = useState(false)
  const [previewZoomOpen, setPreviewZoomOpen] = useState(false)

  const isPlayState = isPreviewingVideo ? previewVideoPlaying : isPlaying

  return (
    <div data-source-video-preview className="flex h-[36px] flex-shrink-0 items-center gap-2 border-t border-zinc-800 px-4">
      {/* Left: current / total timecode */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <span
          ref={playbackTimecodeRef}
          className="select-none font-mono text-[12px] tabular-nums text-accent"
        >
          {isPreviewingVideo
            ? formatTime(previewVideoCurrentTime, fps, timecodeFormat)
            : formatTime(currentTime, fps, timecodeFormat)}
        </span>
        <span className="text-[12px] text-zinc-600">/</span>
        <span className="select-none font-mono text-[12px] tabular-nums text-zinc-400">
          {isPreviewingVideo
            ? formatTime(previewVideoDuration, fps, timecodeFormat)
            : formatTime(contentDuration > 0 ? contentDuration : totalDuration, fps, timecodeFormat)}
        </span>
      </div>

      {/* Centre: play / pause with frame stepping either side */}
      <div className="flex flex-1 items-center justify-center gap-1">
        <Tooltip content={tooltipLabel('Step Back', getShortcutLabel(kbLayout, 'transport.stepBackward'))} side="top">
          <button
            className="cc-icon-btn"
            onClick={onStepBackward}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={tooltipLabel(isPlayState ? 'Pause' : 'Play', getShortcutLabel(kbLayout, 'transport.playPause'))} side="top">
          <button
            onClick={onTogglePlayPause}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-100 transition-colors hover:bg-zinc-800"
          >
            {isPlayState ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
        </Tooltip>
        <Tooltip content={tooltipLabel('Step Forward', getShortcutLabel(kbLayout, 'transport.stepForward'))} side="top">
          <button
            className="cc-icon-btn"
            onClick={onStepForward}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {/* Right: playback resolution, preview zoom, fullscreen */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setPlaybackResOpen(prev => !prev) }}
            className={`h-6 rounded-[4px] px-2 text-[11px] transition-colors ${
              playbackResOpen ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
            title="Playback resolution"
          >
            {playbackResolution === 1 ? 'Full' : playbackResolution === 0.5 ? '1/2' : '1/4'}
          </button>
          {playbackResOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[130px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
              {([
                { label: 'Full (1:1)', value: 1 as const },
                { label: 'Half (1/2)', value: 0.5 as const },
                { label: 'Quarter (1/4)', value: 0.25 as const },
              ] as const).map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { setPlaybackResolution(opt.value); setPlaybackResOpen(false) }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors ${
                    playbackResolution === opt.value ? 'text-accent' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewZoomOpen(prev => !prev) }}
            className={`flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] tabular-nums transition-colors ${
              previewZoomOpen ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
            title="Preview zoom"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            {previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`}
          </button>
          {previewZoomOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[100px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
              {[
                { label: 'Fit', value: 'fit' as const },
                { label: '25%', value: 25 },
                { label: '50%', value: 50 },
                { label: '100%', value: 100 },
                { label: '200%', value: 200 },
                { label: '400%', value: 400 },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { setPreviewZoom(opt.value); setPreviewZoomOpen(false) }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors ${
                    previewZoom === opt.value ? 'text-accent' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Tooltip content={tooltipLabel(isFullscreen ? 'Exit fullscreen' : 'Fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen'))} side="top">
          <button onClick={toggleFullscreen} className="cc-icon-btn">
            {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
