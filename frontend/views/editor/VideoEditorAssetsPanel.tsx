import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react'
import {
  FolderPlus, Folder, Upload, ChevronDown, ChevronUp,
  X, Trash2, Music, Layers, Video, Image,
  LayoutGrid, List, ArrowUpDown, Pencil,
  CirclePlus, Plus, Loader2, Check,
  Volume2, Play,
} from 'lucide-react'
import { shallow } from 'zustand/vanilla/shallow'
import { createAssetBinId, type Asset } from '../../types/project-model'
import { VideoThumbnailCard } from './VideoThumbnailCard'
import { getColorLabel } from './video-editor-utils'
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
import { useSettings } from '../../contexts/SettingsContext'
import { useProxyStore } from './proxy-store'

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

function AssetProxyBadge({ assetId, status }: { assetId: string; status?: 'none' | 'generating' | 'ready' | 'error' }) {
  const { settings } = useSettings()
  const progress = useProxyStore((s) => s.progressMap[assetId])

  if (!settings.proxyEnabled) return null

  if (status === 'generating' || progress !== undefined) {
    const pct = progress ?? 0
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded bg-teal-950/80 text-teal-300 border border-teal-500/30 font-mono shadow-sm"
        title={`Generating proxy: ${pct}%`}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin text-teal-400" />
        {pct > 0 ? `${pct}%` : '540p'}
      </span>
    )
  }

  if (status === 'ready') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono shadow-sm"
        title="540p proxy ready"
      >
        <Check className="w-2.5 h-2.5" />
        540p
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center text-[9px] px-1 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-500/30 font-mono shadow-sm"
        title="Proxy generation error"
      >
        err
      </span>
    )
  }

  return null
}

function AssetProxyProgressBar({ assetId, status }: { assetId: string; status?: string }) {
  const { settings } = useSettings()
  const progress = useProxyStore((s) => s.progressMap[assetId])
  if (!settings.proxyEnabled || (status !== 'generating' && progress === undefined)) return null
  const pct = progress ?? 0
  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/80 z-20 overflow-hidden pointer-events-none">
      <div
        className="h-full bg-teal-500 transition-all duration-150"
        style={{ width: `${Math.max(4, pct)}%` }}
      />
    </div>
  )
}

export const VideoEditorAssetsPanel = forwardRef<VideoEditorAssetsPanelHandle, VideoEditorAssetsPanelProps>(function VideoEditorAssetsPanel(props, ref) {
  const { handleImportFile, importFiles, mediaTypeFilter } = props
  const actions = useEditorActions()

  const assets = useEditorStore(selectAssets)

  const previewAssetId = useEditorStore(selectPreviewAssetId)
  const previewAsset = useEditorStore(selectPreviewAsset)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)

  const [creatingBin, setCreatingBin] = useState(false)
  const [renamingBinId, setRenamingBinId] = useState<string | null>(null)
  const [newBinName, setNewBinName] = useState('')
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null)
  const [assetFilter, setAssetFilter] = useState<'all' | 'video' | 'image' | 'audio'>(mediaTypeFilter ?? 'all')

  useEffect(() => {
    if (mediaTypeFilter) {
      setAssetFilter(mediaTypeFilter)
    }
  }, [mediaTypeFilter])
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [assetLasso, setAssetLasso] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const [assetContextMenu, setAssetContextMenu] = useState<{ assetId: string; x: number; y: number } | null>(null)
  const [binContextMenu, setBinContextMenu] = useState<{ binId: string; x: number; y: number } | null>(null)
  const [assetViewMode, setAssetViewMode] = useState<'grid' | 'list'>('grid')
  const [listSortCol, setListSortCol] = useState<'name' | 'type' | 'duration' | 'resolution' | 'date' | 'color'>('name')
  const [listSortDir, setListSortDir] = useState<'asc' | 'desc'>('asc')
  const assetLassoActive = assetLasso !== null

  const fileInputRef = useRef<HTMLInputElement>(null)
  const assetGridRef = useRef<HTMLDivElement>(null)
  const newBinInputRef = useRef<HTMLInputElement>(null)
  const assetContextMenuRef = useRef<HTMLDivElement>(null)
  const binContextMenuRef = useRef<HTMLDivElement>(null)
  const assetLassoRef = useRef(assetLasso)
  assetLassoRef.current = assetLasso
  const assetLassoPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const assetLassoBaseSelectionRef = useRef<Set<string>>(new Set())
  const assetLassoAutoScrollFrameRef = useRef<number | null>(null)
  const bins = useEditorStore(selectAssetBins, equalAssetBins)
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

  const addClipToTimeline = useCallback((asset: Asset, trackIndex = 0, startTime?: number) => {
    // Add puts the asset in front of the existing edit on V1.
    actions.insertAssetsToTimeline({ assets: [asset], trackIndex, startTime, position: 'start' })
  }, [actions])

  // Auto-play audio when an audio asset is previewed; stop when deselected/changed
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

      // Ignore clicks within any asset card, context menu, or monitor video preview
      if (target.closest('[data-asset-card]') || target.closest('[data-asset-context-menu]')) {
        return
      }
      if (target.closest('[data-source-video-preview]')) {
        return
      }

      // Click is outside: clear preview
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
    setRenamingBinId(null)
    setCreatingBin(true)
    setNewBinName('')
  }, [])

  const commitBinEdit = useCallback(() => {
    const trimmedName = newBinName.trim()
    if (renamingBinId) {
      const currentBinName = binIdToName.get(renamingBinId)
      if (trimmedName && trimmedName !== currentBinName) {
        actions.renameBin(renamingBinId, trimmedName)
      }
      setRenamingBinId(null)
      setNewBinName('')
      return
    }

    if (!trimmedName) {
      setCreatingBin(false)
      setNewBinName('')
      return
    }

    const existingBin = bins.find(bin => bin.name === trimmedName)
    const binId = existingBin?.id ?? createAssetBinId()

    if (!existingBin) {
      actions.createBin(binId, trimmedName)
    }
    if (selectedAssetIds.size > 0) {
      actions.assignAssetsToBin([...selectedAssetIds], binId)
      setSelectedAssetIds(new Set())
    }

    setSelectedBinId(binId)
    setCreatingBin(false)
    setNewBinName('')
  }, [actions, binIdToName, bins, newBinName, renamingBinId, selectedAssetIds])

  useEffect(() => {
    if (!creatingBin && !renamingBinId) return
    setTimeout(() => newBinInputRef.current?.focus(), 0)
  }, [creatingBin, renamingBinId])

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

  useEffect(() => {
    if (!binContextMenu) return
    const handler = () => setBinContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [binContextMenu])

  useEffect(() => {
    if (!binContextMenu || !binContextMenuRef.current) return
    const el = binContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = binContextMenu
    let adjusted = false
    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }
    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [binContextMenu])

  const toggleSort = (col: typeof listSortCol) => {
    if (listSortCol === col) {
      setListSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setListSortCol(col)
      setListSortDir('asc')
    }
  }

  const updateAssetLassoSelection = useCallback((clientX: number, clientY: number) => {
    const currentLasso = assetLassoRef.current
    const container = assetGridRef.current
    if (!currentLasso || !container) return

    const rect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop
    const x = clientX - rect.left
    const y = clientY - rect.top + scrollTop

    setAssetLasso({
      ...currentLasso,
      currentX: x,
      currentY: y,
    })

    const lassoLeft = Math.min(currentLasso.startX, x)
    const lassoRight = Math.max(currentLasso.startX, x)
    const lassoTop = Math.min(currentLasso.startY, y)
    const lassoBottom = Math.max(currentLasso.startY, y)
    const nextSelected = new Set(assetLassoBaseSelectionRef.current)
    const cards = container.querySelectorAll<HTMLElement>('[data-asset-card]')

    cards.forEach(card => {
      const cardRect = card.getBoundingClientRect()
      const cardLeft = cardRect.left - rect.left
      const cardRight = cardRect.right - rect.left
      const cardTop = cardRect.top - rect.top + scrollTop
      const cardBottom = cardRect.bottom - rect.top + scrollTop

      if (cardLeft < lassoRight && cardRight > lassoLeft && cardTop < lassoBottom && cardBottom > lassoTop) {
        const id = card.dataset.assetId
        if (id) nextSelected.add(id)
      }
    })

    setSelectedAssetIds(nextSelected)
  }, [])

  const tickAssetLassoAutoScroll = useCallback(() => {
    assetLassoAutoScrollFrameRef.current = null

    const currentLasso = assetLassoRef.current
    const pointer = assetLassoPointerRef.current
    const container = assetGridRef.current
    if (!currentLasso || !pointer || !container) return

    const rect = container.getBoundingClientRect()
    const edgeThreshold = 28
    const maxStep = 18
    let scrollDelta = 0

    if (pointer.clientY < rect.top + edgeThreshold) {
      const distance = rect.top + edgeThreshold - pointer.clientY
      scrollDelta = -Math.min(maxStep, Math.max(4, distance * 0.35))
    } else if (pointer.clientY > rect.bottom - edgeThreshold) {
      const distance = pointer.clientY - (rect.bottom - edgeThreshold)
      scrollDelta = Math.min(maxStep, Math.max(4, distance * 0.35))
    }

    if (scrollDelta !== 0) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop + scrollDelta))
      if (nextScrollTop !== container.scrollTop) {
        container.scrollTop = nextScrollTop
        updateAssetLassoSelection(pointer.clientX, pointer.clientY)
      }
    }

    if (assetLassoRef.current) {
      assetLassoAutoScrollFrameRef.current = requestAnimationFrame(tickAssetLassoAutoScroll)
    }
  }, [updateAssetLassoSelection])

  useEffect(() => {
    if (!assetLassoActive) return

    const handleMouseMove = (event: MouseEvent) => {
      assetLassoPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
      updateAssetLassoSelection(event.clientX, event.clientY)
    }

    const handleMouseUp = () => {
      setAssetLasso(null)
      assetLassoPointerRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    assetLassoAutoScrollFrameRef.current = requestAnimationFrame(tickAssetLassoAutoScroll)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (assetLassoAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(assetLassoAutoScrollFrameRef.current)
        assetLassoAutoScrollFrameRef.current = null
      }
    }
  }, [assetLassoActive, tickAssetLassoAutoScroll, updateAssetLassoSelection])

  const [isFileDragOver, setIsFileDragOver] = useState(false)
  // Nested dragenter/dragleave fire constantly while moving over children;
  // count them so the highlight only clears when the pointer really leaves.
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
        <>
            {/* Action row — fronts Import as a pill and demotes
                everything else to a right-aligned icon cluster. */}
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

            {/* Type filter — rendered as quiet inline labels rather
                than a segmented control. */}
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

            {(bins.length > 0 || creatingBin) && (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setSelectedBinId(null)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                    selectedBinId === null
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent'
                  }`}
                >
                  All
                </button>
                {bins.map(bin => (
                  <button
                    key={bin.id}
                    onClick={() => setSelectedBinId(selectedBinId === bin.id ? null : bin.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setBinContextMenu({ binId: bin.id, x: e.clientX, y: e.clientY })
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.add('ring-2', 'ring-blue-400')
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('ring-2', 'ring-blue-400')
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.remove('ring-2', 'ring-blue-400')
                      const assetIdsJson = e.dataTransfer.getData('assetIds')
                      if (assetIdsJson) {
                        try {
                          const ids: string[] = JSON.parse(assetIdsJson)
                          actions.assignAssetsToBin(ids, bin.id)
                          setSelectedAssetIds(new Set())
                        } catch {
                          // ignore parse errors
                        }
                      } else {
                        const assetId = e.dataTransfer.getData('assetId')
                        if (assetId) actions.assignAssetsToBin([assetId], bin.id)
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 group/bin ${
                      selectedBinId === bin.id
                        ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent'
                    }`}
                  >
                    <Folder className="h-3 w-3" />
                    {bin.name}
                    <span className="text-zinc-600 text-[9px]">
                      {bin.count}
                    </span>
                  </button>
                ))}
                {(creatingBin || renamingBinId) && (
                  <div className="flex items-center gap-1">
                    <input
                      ref={newBinInputRef}
                      type="text"
                      value={newBinName}
                      onChange={(e) => setNewBinName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitBinEdit()
                        if (e.key === 'Escape') {
                          setCreatingBin(false)
                          setRenamingBinId(null)
                          setNewBinName('')
                        }
                      }}
                      onBlur={commitBinEdit}
                      placeholder="Bin name..."
                      className="w-20 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-600 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*,image/*"
              multiple
              onChange={handleImportFile}
              className="hidden"
            />
        </>
      </div>

        <div
          className="flex-1 overflow-auto p-3 pt-0 relative select-none"
          ref={assetGridRef}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-asset-card]')) return
            if (e.button !== 0) return
            const container = assetGridRef.current
            const rect = container?.getBoundingClientRect()
            if (!rect) return
            const additiveSelection = e.ctrlKey || e.metaKey || e.shiftKey
            const scrollTop = container?.scrollTop || 0
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top + scrollTop
            setAssetLasso({ startX: x, startY: y, currentX: x, currentY: y })
            assetLassoPointerRef.current = { clientX: e.clientX, clientY: e.clientY }
            assetLassoBaseSelectionRef.current = additiveSelection ? new Set(selectedAssetIds) : new Set()
            if (!additiveSelection) setSelectedAssetIds(new Set())
          }}
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
              {/* The drop target is the empty state, not a message
                  with a button beside it. */}
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
            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.map(asset => {
                const cl = getColorLabel(asset.colorLabel)
                return (
                  <div
                    key={asset.id}
                    data-asset-card
                    data-asset-id={asset.id}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      previewAssetId === asset.id
                        ? asset.type === 'audio'
                          ? 'border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-500/20'
                          : 'border-blue-500 ring-2 ring-blue-500/50 shadow-lg shadow-blue-500/20'
                        : selectedAssetIds.has(asset.id)
                          ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/20'
                          : 'border-zinc-800 hover:border-zinc-600'
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
                      addClipToTimeline(asset, 0)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!selectedAssetIds.has(asset.id)) {
                        setSelectedAssetIds(new Set([asset.id]))
                      }
                      setAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
                    }}
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
                            <span className="text-emerald-300">Đang phát</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-2.5 h-2.5 fill-blue-400 text-blue-400" />
                            <span className="text-blue-300">Xem trước</span>
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
                      <div className={`w-full aspect-video flex flex-col items-center justify-center gap-1.5 transition-colors ${
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
                        <p className="text-[9px] text-emerald-300/70 truncate max-w-[90%] px-1">
                          {asset.path || 'Audio'}
                        </p>
                      </div>
                    ) : asset.type === 'adjustment' ? (
                      <div className="w-full aspect-video bg-gradient-to-br from-blue-900/40 to-zinc-900 flex flex-col items-center justify-center gap-1.5 border border-dashed border-blue-500/30">
                        <Layers className="h-6 w-6 text-blue-400" />
                        <p className="text-[9px] text-blue-300/70 font-medium">Adjustment Layer</p>
                      </div>
                    ) : (
                      asset.smallThumbnailPath ? (
                        <img draggable={false} src={pathToFileUrl(asset.smallThumbnailPath)} alt="" className="w-full aspect-video object-cover" />
                      ) : (
                        <div className="w-full aspect-video bg-zinc-800" />
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
                    {/* One-click add, so the timeline can be built without
                        dragging. Same entry point as the context menu's
                        "Add to Timeline", which appends to the end of the
                        track (audio is re-routed to an audio track). */}
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
                            addClipToTimeline(asset, 0)
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
                )
              })}
            </div>
          ) : (
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
                const name = asset.path ? asset.path.split(/[/\\]/).pop() || asset.path : asset.type === 'adjustment' ? 'Adjustment Layer' : asset.type.charAt(0).toUpperCase() + asset.type.slice(1)
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
                      addClipToTimeline(asset, 0)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!selectedAssetIds.has(asset.id)) {
                        setSelectedAssetIds(new Set([asset.id]))
                      }
                      setAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY })
                    }}
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
                        <div className="w-full h-full flex items-center justify-center bg-blue-900/30"><Layers className="h-2.5 w-2.5 text-blue-400" /></div>
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
                          {asset.type === 'audio' ? 'Đang phát' : 'Xem trước'}
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
                            addClipToTimeline(asset, 0)
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
          )}
        </div>

      {assetContextMenu && (() => {
        const asset = assets.find(a => a.id === assetContextMenu.assetId)
        if (!asset) return null
        const targetIds = selectedAssetIds.size > 0 && selectedAssetIds.has(asset.id) ? [...selectedAssetIds] : [asset.id]
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

      {binContextMenu && (
        <div
          ref={binContextMenuRef}
          className="fixed bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl py-1.5 z-[60] min-w-[160px] text-xs"
          style={{ left: binContextMenu.x, top: binContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setCreatingBin(false)
              setRenamingBinId(binContextMenu.binId)
              setNewBinName(binIdToName.get(binContextMenu.binId) ?? '')
              setSelectedBinId(binContextMenu.binId)
              setBinContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-700 flex items-center gap-3"
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-500" />
            <span>Rename Bin</span>
          </button>
          <button
            onClick={() => {
              actions.clearBin(binContextMenu.binId)
              if (selectedBinId === binContextMenu.binId) setSelectedBinId(null)
              setBinContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-zinc-700 flex items-center gap-3"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Bin</span>
          </button>
        </div>
      )}
    </div>
  )
})
