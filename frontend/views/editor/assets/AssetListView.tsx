import React from 'react'
import {
  ChevronDown, ChevronUp, ArrowUpDown,
  Music, Layers, Plus, X, Volume2,
} from 'lucide-react'
import type { Asset } from '../../../types/project-model'
import { getColorLabel } from '../video-editor-utils'
import { Tooltip } from '../../../components/ui/tooltip'
import { pathToFileUrl } from '../../../lib/file-url'
import { useTranslation } from '../../../i18n/I18nContext'
import { AssetProxyBadge } from './AssetProxyBadge'

export type AssetSortCol = 'name' | 'type' | 'duration' | 'resolution' | 'date' | 'color'
export type AssetSortDir = 'asc' | 'desc'

export interface AssetListViewProps {
  visibleAssets: Asset[]
  selectedAssetIds: Set<string>
  previewAssetId: string | null
  isAudioPlaying: boolean
  listSortCol: AssetSortCol
  listSortDir: AssetSortDir
  toggleSort: (col: AssetSortCol) => void
  handleAssetClick: (e: React.MouseEvent, asset: Asset) => void
  addClipToTimeline: (asset: Asset) => void
  deleteAsset: (id: string) => void
  onAssetContextMenu: (e: React.MouseEvent, asset: Asset) => void
}

export function AssetListView({
  visibleAssets,
  selectedAssetIds,
  previewAssetId,
  isAudioPlaying,
  listSortCol,
  listSortDir,
  toggleSort,
  handleAssetClick,
  addClipToTimeline,
  deleteAsset,
  onAssetContextMenu,
}: AssetListViewProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10">
        <div className="w-2 flex-shrink-0" />
        <div className="w-8 flex-shrink-0" />
        {([
          { col: 'name' as const, label: 'Name', flex: 'flex-1 min-w-0' },
          { col: 'type' as const, label: 'Type', flex: 'w-14 flex-shrink-0 text-center' },
          { col: 'duration' as const, label: 'Duration', flex: 'w-16 flex-shrink-0 text-right' },
          { col: 'resolution' as const, label: 'Res', flex: 'w-14 flex-shrink-0 text-right' },
          { col: 'date' as const, label: 'Date', flex: 'w-16 flex-shrink-0 text-right' },
          { col: 'color' as const, label: 'Color', flex: 'w-10 flex-shrink-0 text-center' },
        ]).map(({ col, label, flex }) => (
          <button
            key={col}
            onClick={() => toggleSort(col)}
            className={`${flex} flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors cursor-pointer select-none ${
              listSortCol === col ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className="truncate">{label}</span>
            {listSortCol === col ? (
              listSortDir === 'asc' ? <ChevronUp className="h-2.5 w-2.5 flex-shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 flex-shrink-0" />
            ) : (
              <ArrowUpDown className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover:opacity-50" />
            )}
          </button>
        ))}
        <div className="w-12 flex-shrink-0" />
      </div>

      {visibleAssets.map(asset => {
        const cl = getColorLabel(asset.colorLabel)
        const name = asset.path
          ? asset.path.split(/[/\\]/).pop() || asset.path
          : asset.type === 'adjustment'
          ? 'Adjustment Layer'
          : asset.type.charAt(0).toUpperCase() + asset.type.slice(1)
        const dateStr = new Date(asset.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

        return (
          <div
            key={asset.id}
            data-asset-card
            data-asset-id={asset.id}
            className={`group flex items-center gap-1 px-2 py-1 cursor-pointer transition-all ${
              previewAssetId === asset.id
                ? asset.type === 'audio'
                  ? 'bg-emerald-950/50 ring-1 ring-emerald-500/60 shadow-sm'
                  : 'bg-blue-950/50 ring-1 ring-blue-500/60 shadow-sm'
                : selectedAssetIds.has(asset.id)
                  ? 'bg-blue-600/20 ring-1 ring-blue-500/50'
                  : 'hover:bg-zinc-800/60'
            }`}
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
            {cl ? (
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cl.color }} />
            ) : (
              <div className="w-2 flex-shrink-0" />
            )}
            <div className="w-8 h-6 flex-shrink-0 rounded overflow-hidden bg-zinc-800">
              {asset.type === 'video' ? (
                asset.smallThumbnailPath ? (
                  <img draggable={false} src={pathToFileUrl(asset.smallThumbnailPath)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-800" />
                )
              ) : asset.type === 'audio' ? (
                <div className={`w-full h-full flex items-center justify-center ${
                  previewAssetId === asset.id ? 'bg-emerald-800/60' : 'bg-emerald-900/40'
                }`}>
                  {previewAssetId === asset.id && isAudioPlaying ? (
                    <Volume2 className="h-3 w-3 text-emerald-300 animate-bounce" />
                  ) : (
                    <Music className="h-2.5 w-2.5 text-emerald-400" />
                  )}
                </div>
              ) : asset.type === 'adjustment' ? (
                <div className="w-full h-full flex items-center justify-center bg-blue-900/30">
                  <Layers className="h-2.5 w-2.5 text-blue-400" />
                </div>
              ) : (
                asset.smallThumbnailPath ? (
                  <img draggable={false} src={pathToFileUrl(asset.smallThumbnailPath)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-800" />
                )
              )}
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <p className="text-[10px] text-zinc-200 truncate leading-tight">{name}</p>
              {previewAssetId === asset.id && (
                <span className={`text-[9px] px-1 py-0.2 rounded font-medium border ${
                  asset.type === 'audio'
                    ? 'bg-emerald-900/60 text-emerald-300 border-emerald-500/40'
                    : 'bg-blue-900/60 text-blue-300 border-blue-500/40'
                }`}>
                  {asset.type === 'audio' ? t('common.playing') : t('common.preview')}
                </span>
              )}
              {asset.type === 'video' && <AssetProxyBadge assetId={asset.id} status={asset.proxyStatus} />}
            </div>
            <span className="w-14 flex-shrink-0 text-center text-[9px] text-zinc-500 uppercase font-medium">{asset.type}</span>
            <span className="w-16 flex-shrink-0 text-right text-[9px] text-zinc-500 tabular-nums">
              {asset.duration != null ? `${asset.duration.toFixed(1)}s` : '—'}
            </span>
            <span className="w-14 flex-shrink-0 text-right text-[9px] text-zinc-500">
              {asset.resolution || '—'}
            </span>
            <span className="w-16 flex-shrink-0 text-right text-[9px] text-zinc-500">{dateStr}</span>
            <div className="w-10 flex-shrink-0 flex items-center justify-center">
              {cl ? (
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cl.color }} title={cl.label} />
              ) : (
                <span className="text-[9px] text-zinc-600">—</span>
              )}
            </div>
            <div
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-12 flex-shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-all"
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
                  className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-accent hover:bg-zinc-700/50 transition-all active:scale-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
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
                  className="w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-700/50 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          </div>
        )
      })}
    </div>
  )
}
