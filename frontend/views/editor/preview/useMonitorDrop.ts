import React from 'react'
import type { Asset } from '../../../types/project-model'
import { isExternalFileDrag, hasMediaFiles } from '../external-file-drop'

export interface UseMonitorDropOptions {
  importFiles?: (files: FileList | File[]) => Promise<Asset[]>
  currentTime: number
  setPreviewAssetId: (id: string | null) => void
  insertAssetsToTimeline: (params: { assets: Asset[]; startTime: number }) => void
  assets: Asset[]
}

export function useMonitorDrop({
  importFiles,
  currentTime,
  setPreviewAssetId,
  insertAssetsToTimeline,
  assets,
}: UseMonitorDropOptions) {
  const [isDragOver, setIsDragOver] = React.useState(false)

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase())
    if (isExternalFileDrag(e) || types.includes('assetid') || types.includes('assetids') || types.includes('asset')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    setIsDragOver(false)
    const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase())
    if (!isExternalFileDrag(e) && !types.includes('assetid') && !types.includes('assetids') && !types.includes('asset')) {
      return
    }
    e.preventDefault()

    if (isExternalFileDrag(e)) {
      const files = e.dataTransfer.files
      if (!hasMediaFiles(files) || !importFiles) return
      void importFiles(files).then(imported => {
        if (imported.length > 0) {
          setPreviewAssetId(null)
          insertAssetsToTimeline({
            assets: imported,
            startTime: currentTime,
          })
        }
      })
      return
    }

    const assetJson = e.dataTransfer.getData('asset')
    let droppedAsset: Asset | null = null
    if (assetJson) {
      try {
        droppedAsset = JSON.parse(assetJson) as Asset
      } catch {}
    }
    if (!droppedAsset) {
      const assetId = e.dataTransfer.getData('assetId')
      if (assetId) {
        droppedAsset = assets.find(a => a.id === assetId) ?? null
      }
    }
    if (droppedAsset) {
      setPreviewAssetId(null)
      insertAssetsToTimeline({
        assets: [droppedAsset],
        startTime: currentTime,
      })
      return
    }

    // Internal asset drag from Media Library
    const rawIds = e.dataTransfer.getData('assetids') || e.dataTransfer.getData('assetid')
    let droppedIds: string[] = []
    if (rawIds) {
      try {
        droppedIds = JSON.parse(rawIds)
      } catch {
        droppedIds = [rawIds]
      }
    }
    if (!Array.isArray(droppedIds)) droppedIds = [droppedIds]

    const matchedAssets = assets.filter(a => droppedIds.includes(a.id))
    if (matchedAssets.length > 0) {
      setPreviewAssetId(null)
      insertAssetsToTimeline({
        assets: matchedAssets,
        startTime: currentTime,
      })
    }
  }, [assets, currentTime, importFiles, insertAssetsToTimeline, setPreviewAssetId])

  return {
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
