import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react'
import {
  FolderPlus, Upload, LayoutGrid, List, ArrowUpDown, CirclePlus,
} from 'lucide-react'
import { shallow } from 'zustand/vanilla/shallow'
import type { Asset } from '../../types/project-model'
import { Tooltip } from '../../components/ui/tooltip'
import { AssetContextMenu } from './AssetContextMenu'
import { pathToFileUrl } from '../../lib/file-url'
import { hasMediaFiles, isExternalFileDrag } from './external-file-drop'
import type { AssetListFilters } from './editor-state'
import {
  equalAssetBins,
  selectAssetBins,
  selectAssets,
  selectVisibleAssets,
  selectPreviewAssetId,
  selectPreviewAsset,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

import { useAssetLasso } from './assets/useAssetLasso'
import { AssetBinsBar } from './assets/AssetBinsBar'
import { AssetGridView } from './assets/AssetGridView'
import { AssetListView, type AssetSortCol, type AssetSortDir } from './assets/AssetListView'

export interface VideoEditorAssetsPanelHandle {
  revealAsset: (assetId: string) => void
  deleteAsset: (target?: string | string[]) => void
}

export interface VideoEditorAssetsPanelProps {
  openSourceAsset?: (asset: Asset) => void
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Import media files dragged in from the OS file manager. */
  importFiles: (files: FileList | File[]) => Promise<unknown>
  mediaTypeFilter?: 'all' | 'video' | 'image' | 'audio'
}

export const VideoEditorAssetsPanel = forwardRef<VideoEditorAssetsPanelHandle, VideoEditorAssetsPanelProps>(
  function VideoEditorAssetsPanel(props, ref) {
    const { handleImportFile, importFiles, mediaTypeFilter } = props
    const actions = useEditorActions()

    const assets = useEditorStore(selectAssets)
    const bins = useEditorStore(selectAssetBins, equalAssetBins)

    const previewAssetId = useEditorStore(selectPreviewAssetId)
    const previewAsset = useEditorStore(selectPreviewAsset)
    const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
    const [isAudioPlaying, setIsAudioPlaying] = useState(false)

    const [creatingBin, setCreatingBin] = useState(false)
    const [selectedBinId, setSelectedBinId] = useState<string | null>(null)
    const [assetFilter, setAssetFilter] = useState<'all' | 'video' | 'image' | 'audio'>(mediaTypeFilter ?? 'all')

    useEffect(() => {
      if (mediaTypeFilter) {
        setAssetFilter(mediaTypeFilter)
      }
    }, [mediaTypeFilter])

    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
    const [assetContextMenu, setAssetContextMenu] = useState<{ assetId: string; x: number; y: number } | null>(null)
    const [assetViewMode, setAssetViewMode] = useState<'grid' | 'list'>('grid')
    const [listSortCol, setListSortCol] = useState<AssetSortCol>('name')
    const [listSortDir, setListSortDir] = useState<AssetSortDir>('asc')

    const fileInputRef = useRef<HTMLInputElement>(null)
    const assetGridRef = useRef<HTMLDivElement>(null)
    const assetContextMenuRef = useRef<HTMLDivElement>(null)

    const { assetLasso, handleMouseDown } = useAssetLasso(assetGridRef, selectedAssetIds, setSelectedAssetIds)

    const binIdToName = useMemo(
      () => new Map(bins.map(bin => [bin.id, bin.name])),
      [bins],
    )

    const assetFilters: AssetListFilters = {
      assetFilter,
      selectedBinId,
      assetViewMode,
      listSortCol,
      listSortDir,
    }
    const visibleAssets = useEditorStore(state => selectVisibleAssets(state, assetFilters), shallow)
    const filteredAssets = assetViewMode === 'list'
      ? assets.filter(asset => visibleAssets.some(visible => visible.id === asset.id))
      : visibleAssets

    const deleteAsset = useCallback((target?: string | string[]) => {
      const rawIds = target === undefined
        ? [...selectedAssetIds]
        : typeof target === 'string'
        ? [target]
        : target
      const ids = Array.from(new Set(rawIds.filter(Boolean)))
      if (ids.length === 0) return

      actions.deleteAssets(ids)
      setSelectedAssetIds(prev => {
        if (prev.size === 0) return prev
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    }, [actions, selectedAssetIds])

    const revealAsset = useCallback((assetId: string) => {
      const asset = assets.find(a => a.id === assetId)
      if (!asset) return
      setAssetFilter('all')
      setSelectedBinId(asset.binId ?? null)
      setSelectedAssetIds(new Set([asset.id]))
      setTimeout(() => {
        const card = assetGridRef.current?.querySelector(`[data-asset-id="${asset.id}"]`)
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }, [assets])

    useImperativeHandle(ref, () => ({
      revealAsset,
      deleteAsset,
    }), [deleteAsset, revealAsset])

    const addClipToTimeline = useCallback((asset: Asset, trackIndex?: number, startTime?: number) => {
      actions.insertAssetsToTimeline({ assets: [asset], trackIndex, startTime, position: 'start' })
    }, [actions])

    // Auto-play audio when an audio asset is previewed
    useEffect(() => {
      if (previewAsset && previewAsset.type === 'audio' && previewAsset.path) {
        if (audioPreviewRef.current) {
          audioPreviewRef.current.pause()
          audioPreviewRef.current.src = ''
        }
        const audio = new Audio(pathToFileUrl(previewAsset.path))
        audioPreviewRef.current = audio
        audio.play().then(() => {
          setIsAudioPlaying(true)
        }).catch(err => {
          console.warn('[AssetsPanel] Audio preview play failed:', err)
          setIsAudioPlaying(false)
        })
        audio.onended = () => {
          setIsAudioPlaying(false)
        }
        return () => {
          audio.pause()
          audio.src = ''
          audioPreviewRef.current = null
          setIsAudioPlaying(false)
        }
      } else {
        if (audioPreviewRef.current) {
          audioPreviewRef.current.pause()
          audioPreviewRef.current.src = ''
          audioPreviewRef.current = null
        }
        setIsAudioPlaying(false)
      }
    }, [previewAsset?.id, previewAsset?.type, previewAsset?.path])

    // Support toggling audio preview playback via Spacebar
    useEffect(() => {
      const handleToggle = () => {
        if (audioPreviewRef.current) {
          if (audioPreviewRef.current.paused) {
            audioPreviewRef.current.play().then(() => setIsAudioPlaying(true)).catch(() => {})
          } else {
            audioPreviewRef.current.pause()
            setIsAudioPlaying(false)
          }
        }
      }
      window.addEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
      return () => window.removeEventListener('komfyedit:toggle-asset-preview-playback', handleToggle)
    }, [])

    // Dismiss preview on outside click or Escape key
    useEffect(() => {
      if (!previewAssetId) return

      const handlePointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null
        if (!target) return

        if (target.closest('[data-asset-card]') || target.closest('[data-asset-context-menu]')) {
          return
        }
        if (target.closest('[data-source-video-preview]')) {
          return
        }

        actions.setPreviewAssetId(null)
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          actions.setPreviewAssetId(null)
        }
      }

      window.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [previewAssetId, actions])

    const handleAssetClick = useCallback((e: React.MouseEvent, asset: Asset) => {
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey) {
        setSelectedAssetIds(prev => {
          const next = new Set(prev)
          if (next.has(asset.id)) next.delete(asset.id)
          else next.add(asset.id)
          return next
        })
        return
      }
      if (e.shiftKey && selectedAssetIds.size > 0) {
        const lastId = [...selectedAssetIds].pop()
        const lastIdx = filteredAssets.findIndex(a => a.id === lastId)
        const thisIdx = filteredAssets.findIndex(a => a.id === asset.id)
        if (lastIdx >= 0 && thisIdx >= 0) {
          const start = Math.min(lastIdx, thisIdx)
          const end = Math.max(lastIdx, thisIdx)
          const next = new Set(selectedAssetIds)
          for (let i = start; i <= end; i++) next.add(filteredAssets[i].id)
          setSelectedAssetIds(next)
        }
        return
      }

      setSelectedAssetIds(new Set([asset.id]))

      if (asset.type === 'video' || asset.type === 'audio') {
        if (previewAssetId === asset.id) {
          actions.setPreviewAssetId(null)
        } else {
          actions.setPreviewAssetId(asset.id)
        }
      } else {
        if (previewAssetId) {
          actions.setPreviewAssetId(null)
        }
      }
    }, [actions, filteredAssets, previewAssetId, selectedAssetIds])

    const openCreateBinEditor = useCallback((assetIds?: string[]) => {
      if (assetIds) {
        setSelectedAssetIds(new Set(assetIds))
      }
      setCreatingBin(true)
    }, [])

    useEffect(() => {
      if (!assetContextMenu) return
      const handler = () => setAssetContextMenu(null)
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }, [assetContextMenu])

    useEffect(() => {
      if (!assetContextMenu || !assetContextMenuRef.current) return
      const el = assetContextMenuRef.current
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let { x, y } = assetContextMenu
      let adjusted = false
      if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
      if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
      if (x < 8) { x = 8; adjusted = true }
      if (y < 8) { y = 8; adjusted = true }
      if (adjusted) {
        el.style.left = `${x}px`
        el.style.top = `${y}px`
      }
    }, [assetContextMenu])

    const toggleSort = (col: AssetSortCol) => {
      if (listSortCol === col) {
        setListSortDir(d => d === 'asc' ? 'desc' : 'asc')
      } else {
        setListSortCol(col)
        setListSortDir('asc')
      }
    }

    const [isFileDragOver, setIsFileDragOver] = useState(false)
    const fileDragDepthRef = useRef(0)

    const handleExternalDragEnter = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return
      e.preventDefault()
      fileDragDepthRef.current += 1
      setIsFileDragOver(true)
    }, [])

    const handleExternalDragOver = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }, [])

    const handleExternalDragLeave = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)
      if (fileDragDepthRef.current === 0) setIsFileDragOver(false)
    }, [])

    const handleExternalDrop = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      fileDragDepthRef.current = 0
      setIsFileDragOver(false)
      const files = e.dataTransfer.files
      if (!hasMediaFiles(files)) return
      void importFiles(files)
    }, [importFiles])

    const handleAssetContextMenu = useCallback((e: React.MouseEvent, asset: Asset) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selectedAssetIds.has(asset.id)) {
        setSelectedAssetIds(new Set([asset.id]))
      }
      setAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
    }, [selectedAssetIds])

    return (
      <div
        className="relative flex flex-col min-h-0 h-full border-r border-zinc-800"
        onDragEnter={handleExternalDragEnter}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
      >
        {isFileDragOver && (
          <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/70 backdrop-blur-sm">
            <Upload className="h-6 w-6 text-blue-300" />
            <span className="text-xs font-medium text-blue-200">Drop media to import</span>
          </div>
        )}

        <div className="flex-shrink-0 space-y-2 p-3 pb-1">
          {/* Action row */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex h-[26px] items-center gap-1.5 rounded-[4px] bg-zinc-800 px-2.5 text-[12px] text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              <CirclePlus className="h-3.5 w-3.5 text-accent" />
              Import
            </button>
            <div className="flex-1" />
            <Tooltip content="Create bin" side="bottom">
              <button onClick={() => openCreateBinEditor()} className="cc-icon-btn">
                <FolderPlus className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip content={assetViewMode === 'grid' ? 'List view' : 'Grid view'} side="bottom">
              <button
                onClick={() => setAssetViewMode(assetViewMode === 'grid' ? 'list' : 'grid')}
                className="cc-icon-btn"
              >
                {assetViewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </button>
            </Tooltip>
            <Tooltip content="Sort" side="bottom">
              <button
                onClick={() => setListSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="cc-icon-btn"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-3 pt-0.5">
            {(['all', 'video', 'image', 'audio'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setAssetFilter(filter)}
                className={`text-[12px] transition-colors ${
                  assetFilter === filter ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          {/* Asset bins bar */}
          <AssetBinsBar
            selectedBinId={selectedBinId}
            setSelectedBinId={setSelectedBinId}
            selectedAssetIds={selectedAssetIds}
            setSelectedAssetIds={setSelectedAssetIds}
            creatingBin={creatingBin}
            setCreatingBin={setCreatingBin}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            onChange={handleImportFile}
            className="hidden"
          />
        </div>

        <div
          className="flex-1 overflow-auto p-3 pt-0 relative select-none"
          ref={assetGridRef}
          onMouseDown={handleMouseDown}
        >
          {assetLasso && (() => {
            const left = Math.min(assetLasso.startX, assetLasso.currentX)
            const top = Math.min(assetLasso.startY, assetLasso.currentY)
            const width = Math.abs(assetLasso.currentX - assetLasso.startX)
            const height = Math.abs(assetLasso.currentY - assetLasso.startY)
            if (width < 3 && height < 3) return null
            return (
              <div
                className="absolute border border-blue-400 bg-blue-500/15 rounded-sm pointer-events-none z-30"
                style={{ left, top, width, height }}
              />
            )
          })()}

          {filteredAssets.length === 0 ? (
            <div className="flex flex-col gap-4 py-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[340px] w-full flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed border-zinc-700 bg-zinc-900/40 transition-colors hover:border-accent hover:bg-zinc-900"
              >
                <span className="flex items-center gap-2 text-[14px] text-zinc-100">
                  <CirclePlus className="h-5 w-5 text-accent" />
                  Import
                </span>
                <span className="px-6 text-center text-[11px] text-zinc-500">
                  Drag and drop videos, photos, and audio files here
                </span>
              </button>
            </div>
          ) : assetViewMode === 'grid' ? (
            <AssetGridView
              filteredAssets={filteredAssets}
              selectedAssetIds={selectedAssetIds}
              previewAssetId={previewAssetId}
              isAudioPlaying={isAudioPlaying}
              binIdToName={binIdToName}
              handleAssetClick={handleAssetClick}
              addClipToTimeline={addClipToTimeline}
              deleteAsset={deleteAsset}
              onAssetContextMenu={handleAssetContextMenu}
            />
          ) : (
            <AssetListView
              visibleAssets={visibleAssets}
              selectedAssetIds={selectedAssetIds}
              previewAssetId={previewAssetId}
              isAudioPlaying={isAudioPlaying}
              listSortCol={listSortCol}
              listSortDir={listSortDir}
              toggleSort={toggleSort}
              handleAssetClick={handleAssetClick}
              addClipToTimeline={addClipToTimeline}
              deleteAsset={deleteAsset}
              onAssetContextMenu={handleAssetContextMenu}
            />
          )}
        </div>

        {assetContextMenu && (() => {
          const asset = assets.find(a => a.id === assetContextMenu.assetId)
          if (!asset) return null
          const targetIds = selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id)
            ? [...selectedAssetIds]
            : [asset.id]
          return (
            <AssetContextMenu
              asset={asset}
              targetIds={targetIds}
              assetContextMenu={assetContextMenu}
              assetContextMenuRef={assetContextMenuRef}
              addClipToTimeline={addClipToTimeline}
              setSelectedAssetIds={setSelectedAssetIds}
              setAssetContextMenu={setAssetContextMenu}
              openCreateBinEditor={openCreateBinEditor}
            />
          )
        })()}
      </div>
    )
  }
)
