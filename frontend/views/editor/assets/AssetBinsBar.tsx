import { useState, useRef, useEffect, useCallback } from 'react'
import { Folder, Pencil, Trash2 } from 'lucide-react'
import { createAssetBinId } from '../../../types/project-model'
import { equalAssetBins, selectAssetBins } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'

export interface AssetBinsBarProps {
  selectedBinId: string | null
  setSelectedBinId: (id: string | null) => void
  selectedAssetIds: Set<string>
  setSelectedAssetIds: (ids: Set<string>) => void
  creatingBin: boolean
  setCreatingBin: (creating: boolean) => void
}

export function AssetBinsBar({
  selectedBinId,
  setSelectedBinId,
  selectedAssetIds,
  setSelectedAssetIds,
  creatingBin,
  setCreatingBin,
}: AssetBinsBarProps) {
  const actions = useEditorActions()
  const bins = useEditorStore(selectAssetBins, equalAssetBins)

  const [renamingBinId, setRenamingBinId] = useState<string | null>(null)
  const [newBinName, setNewBinName] = useState('')
  const [binContextMenu, setBinContextMenu] = useState<{ binId: string; x: number; y: number } | null>(null)

  const newBinInputRef = useRef<HTMLInputElement>(null)
  const binContextMenuRef = useRef<HTMLDivElement>(null)

  const binIdToName = new Map(bins.map(bin => [bin.id, bin.name]))

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
  }, [actions, binIdToName, bins, newBinName, renamingBinId, selectedAssetIds, setCreatingBin, setSelectedAssetIds, setSelectedBinId])

  useEffect(() => {
    if (!creatingBin && !renamingBinId) return
    setTimeout(() => newBinInputRef.current?.focus(), 0)
  }, [creatingBin, renamingBinId])

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

  if (bins.length === 0 && !creatingBin) return null

  return (
    <>
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
            <span className="text-zinc-600 text-[9px]">{bin.count}</span>
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
    </>
  )
}
