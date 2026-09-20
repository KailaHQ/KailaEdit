import React from 'react'
import { Video, X } from 'lucide-react'
import { pathToFileUrl } from '../../../lib/file-url'
import type { Asset } from '../../../types/project-model'

export interface SourceVideoPreviewProps {
  previewAsset: Asset
  sourceVideoDimensions: { width: number; height: number } | null
  sourceVideoFrameSize: { width: number; height: number }
  videoRef: React.Ref<HTMLVideoElement>
  onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onPlay: () => void
  onPause: () => void
  onTogglePlay: (e: React.MouseEvent) => void
  onClose: () => void
  closeTooltip?: string
}

export function SourceVideoPreview({
  previewAsset,
  sourceVideoDimensions,
  sourceVideoFrameSize,
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
  onPlay,
  onPause,
  onTogglePlay,
  onClose,
  closeTooltip = 'Close preview',
}: SourceVideoPreviewProps) {
  return (
    <div
      data-source-video-preview
      className="relative bg-black overflow-hidden shadow-2xl flex items-center justify-center z-30"
      style={{
        ...(sourceVideoFrameSize.width > 0
          ? { width: sourceVideoFrameSize.width, height: sourceVideoFrameSize.height }
          : {
              width: '100%',
              aspectRatio: sourceVideoDimensions
                ? `${sourceVideoDimensions.width} / ${sourceVideoDimensions.height}`
                : `${previewAsset.width || 16} / ${previewAsset.height || 9}`,
            }),
      }}
    >
      <video
        ref={videoRef}
        src={pathToFileUrl(previewAsset.path)}
        autoPlay
        playsInline
        loop
        className="w-full h-full object-contain cursor-pointer"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onClick={onTogglePlay}
      />
      {/* Source Video Tag Badge with close button */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-30">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/85 border border-blue-500/50 text-blue-300 text-xs font-medium shadow-lg backdrop-blur-sm pointer-events-auto">
          <Video className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[220px]">{previewAsset.path.split(/[/\\]/).pop() || previewAsset.path}</span>
          {sourceVideoDimensions && (
            <span className="text-[10px] text-zinc-400 border-l border-zinc-700 pl-1.5 ml-0.5 font-mono">
              {sourceVideoDimensions.width}×{sourceVideoDimensions.height}
            </span>
          )}
        </div>
        <button
          type="button"
          title={closeTooltip}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-1.5 rounded-md bg-black/80 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors pointer-events-auto shadow-lg cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
