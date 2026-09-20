import React from 'react'
import {
  Folder, X, Music, Layers, Video, Image,
  Plus, Volume2, Play,
} from 'lucide-react'
import type { Asset } from '../../../types/project-model'
import { VideoThumbnailCard } from '../VideoThumbnailCard'
import { getColorLabel } from '../video-editor-utils'
import { Tooltip } from '../../../components/ui/tooltip'
import { pathToFileUrl } from '../../../lib/file-url'
import { useTranslation } from '../../../i18n/I18nContext'
import { AssetProxyBadge, AssetProxyProgressBar } from './AssetProxyBadge'

/**
 * Truncate filename if too long, placing '...' before the last 3 characters before the extension.
 * E.g.: "ten-file-rat-dai.mp3" -> "ten-file-...dai.mp3"
 */
export function formatMediaName(rawName: string, maxLength: number = 18): string {
  if (!rawName) return ''

  const filename = rawName.split(/[/\\]/).pop() || rawName
  if (filename.length <= maxLength) {
    return filename
  }

  const lastDot = filename.lastIndexOf('.')
  if (lastDot > 0 && lastDot < filename.length - 1) {
    const ext = filename.slice(lastDot) // e.g. ".mp3"
    const base = filename.slice(0, lastDot) // e.g. "ten-file-rat-dai"
    const suffixLen = Math.min(3, base.length)
    const suffix = base.slice(-suffixLen) // e.g. "dai"
    const targetPrefixLen = Math.max(3, maxLength - 3 - suffixLen - ext.length)
    const prefix = base.slice(0, targetPrefixLen)
    return `${prefix}...${suffix}${ext}`
  }

  // No extension
  const suffixLen = Math.min(3, filename.length)
  const suffix = filename.slice(-suffixLen)
  const targetPrefixLen = Math.max(3, maxLength - 3 - suffixLen)
  const prefix = filename.slice(0, targetPrefixLen)
  return `${prefix}...${suffix}`
}

export interface AssetGridViewProps {
  filteredAssets: Asset[]
  selectedAssetIds: Set<string>
  previewAssetId: string | null
  isAudioPlaying: boolean
  binIdToName: Map<string, string>
  handleAssetClick: (e: React.MouseEvent, asset: Asset) => void
  addClipToTimeline: (asset: Asset) => void
  deleteAsset: (id: string) => void
  onAssetContextMenu: (e: React.MouseEvent, asset: Asset) => void
}

export function AssetGridView({
  filteredAssets,
  selectedAssetIds,
  previewAssetId,
  isAudioPlaying,
  binIdToName,
  handleAssetClick,
  addClipToTimeline,
  deleteAsset,
  onAssetContextMenu,
}: AssetGridViewProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-3">
      {filteredAssets.map(asset => {
        const cl = getColorLabel(asset.colorLabel)
        const rawFileName = asset.path
          ? (asset.path.split(/[/\\]/).pop() || asset.path)
          : asset.type === 'adjustment'
          ? 'Adjustment Layer'
          : asset.type.charAt(0).toUpperCase() + asset.type.slice(1)
        const displayName = formatMediaName(rawFileName, 18)

        return (
          <div
            key={asset.id}
            data-asset-card
            data-asset-id={asset.id}
            className="group cursor-pointer flex flex-col min-w-0 select-none"
            draggable
            onDragStart={(e) => {
              if (selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id)) {
                e.dataTransfer.setData('assetIds', JSON.stringify([...selectedAssetIds]))
              } else {
                e.dataTransfer.setData('assetId', asset.id)
              }
              e.dataTransfer.setData('asset', JSON.stringify(asset))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={(e) => handleAssetClick(e, asset)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              addClipToTimeline(asset)
            }}
            onContextMenu={(e) => onAssetContextMenu(e, asset)}
          >
            {/* Thumbnail Box */}
            <div
              className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-video ${
                previewAssetId === asset.id
                  ? asset.type === 'audio'
                    ? 'border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-500/20'
                    : 'border-blue-500 ring-2 ring-blue-500/50 shadow-lg shadow-blue-500/20'
                  : selectedAssetIds.has(asset.id)
                    ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/20'
                    : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              {cl && (
                <>
                  <div className="absolute top-0 left-0 right-0 h-[3px] z-10" style={{ backgroundColor: cl.color }} />
                  <div className="absolute top-0 left-0 bottom-0 w-[3px] z-10" style={{ backgroundColor: cl.color }} />
                </>
              )}
              {previewAssetId === asset.id && (
                <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm border border-white/20 text-[10px] font-medium shadow pointer-events-none">
                  {asset.type === 'audio' ? (
                    <>
                      <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
                      <span className="text-emerald-300">{t('common.playing')}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-2.5 h-2.5 fill-blue-400 text-blue-400" />
                      <span className="text-blue-300">{t('common.preview')}</span>
                    </>
                  )}
                </div>
              )}
              {asset.type === 'video' ? (
                <VideoThumbnailCard
                  videoUrl={pathToFileUrl(asset.path)}
                  thumbnailUrl={asset.smallThumbnailPath ? pathToFileUrl(asset.smallThumbnailPath) : undefined}
                />
              ) : asset.type === 'audio' ? (
                <div className={`w-full h-full flex flex-col items-center justify-center gap-1.5 transition-colors ${
                  previewAssetId === asset.id
                    ? 'bg-gradient-to-br from-emerald-800/80 via-emerald-950/90 to-zinc-900'
                    : 'bg-gradient-to-br from-emerald-900/60 to-zinc-900'
                }`}>
                  {previewAssetId === asset.id && isAudioPlaying ? (
                    <Volume2 className="h-6 w-6 text-emerald-300 animate-bounce" />
                  ) : (
                    <Music className="h-6 w-6 text-emerald-400" />
                  )}
                  <div className="flex items-center gap-0.5">
                    {[3, 5, 8, 6, 9, 4, 7, 5, 3, 6, 8, 4].map((h, i) => (
                      <div
                        key={i}
                        className={`w-0.5 rounded-full transition-all duration-150 ${
                          previewAssetId === asset.id && isAudioPlaying
                            ? 'bg-emerald-400 animate-pulse'
                            : 'bg-emerald-500/60'
                        }`}
                        style={{
                          height: previewAssetId === asset.id && isAudioPlaying
                            ? `${Math.max(4, h * (1 + (i % 3) * 0.4)) * 1.5}px`
                            : `${h * 1.5}px`
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : asset.type === 'adjustment' ? (
                <div className="w-full h-full bg-gradient-to-br from-blue-900/40 to-zinc-900 flex flex-col items-center justify-center gap-1.5 border border-dashed border-blue-500/30">
                  <Layers className="h-6 w-6 text-blue-400" />
                </div>
              ) : (
                asset.smallThumbnailPath ? (
                  <img draggable={false} src={pathToFileUrl(asset.smallThumbnailPath)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-800" />
                )
              )}
              {selectedAssetIds.has(asset.id) && <div className="absolute inset-0 bg-blue-600/25 pointer-events-none z-[1]" />}
              {!selectedAssetIds.has(asset.id) && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none" />
              )}
              <div
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all z-10"
              >
                <Tooltip content="Delete asset" side="right">
                  <button
                    type="button"
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteAsset(asset.id)
                    }}
                    className="p-1 rounded bg-black/70 text-zinc-500 hover:text-red-400 hover:bg-red-900/50 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Tooltip>
              </div>
              {asset.binId && binIdToName.get(asset.binId) && (
                <div className="absolute top-1.5 left-8 flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/70 text-[9px] text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Folder className="h-2.5 w-2.5" />
                  {binIdToName.get(asset.binId)}
                </div>
              )}
              <div
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute bottom-1 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Tooltip content="Add to timeline" side="left">
                  <button
                    type="button"
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      addClipToTimeline(asset)
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-lg shadow-black/50 transition-all hover:bg-accent-dark active:scale-90"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
              <div className="absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">
                {asset.type === 'video' ? <Video className="h-3 w-3" /> : asset.type === 'audio' ? <Music className="h-3 w-3" /> : asset.type === 'adjustment' ? <Layers className="h-3 w-3" /> : <Image className="h-3 w-3" />}
                {asset.type === 'adjustment' ? 'Adj' : asset.duration ? `${asset.duration.toFixed(1)}s` : ''}
              </div>
              {asset.type === 'video' && (
                <>
                  <div className="absolute top-1 left-1 z-10">
                    <AssetProxyBadge assetId={asset.id} status={asset.proxyStatus} />
                  </div>
                  <AssetProxyProgressBar assetId={asset.id} status={asset.proxyStatus} />
                </>
              )}
            </div>

            {/* Media Name below Thumbnail (Single Line with Middle Truncation) */}
            <div className="mt-1 px-0.5 min-w-0">
              <span
                className={`block text-[11px] leading-tight font-medium truncate select-none transition-colors ${
                  selectedAssetIds.has(asset.id)
                    ? 'text-blue-400 font-semibold'
                    : 'text-zinc-300 group-hover:text-zinc-100'
                }`}
                title={rawFileName}
              >
                {displayName}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
