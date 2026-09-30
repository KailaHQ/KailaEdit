import React, { useCallback, useState } from 'react'
import { CoverPickerModal } from '../cover/CoverPickerModal'
import { CoverDesignModal } from '../cover/CoverDesignModal'
import { coverElementsToOverlays } from '../cover/cover-to-overlay'
import type { CoverElement } from '../cover/types'
import { addVisualAssetToProject } from '../../../lib/asset-copy'
import type { Asset } from '../../../types/project-model'
import type { TimelineCover } from '@core/project-model'

export interface TimelineCoverModalsProps {
  isPickerOpen: boolean
  onClosePicker: () => void
  activeTimeline: any
  assets: Asset[]
  currentProjectId: string | null
  setTimelineCover: (cover: TimelineCover | undefined) => void
  copyOverlays: (items: any[]) => void
}

export const TimelineCoverModals: React.FC<TimelineCoverModalsProps> = ({
  isPickerOpen,
  onClosePicker,
  activeTimeline,
  assets,
  currentProjectId,
  setTimelineCover,
  copyOverlays,
}) => {
  const [isDesignOpen, setIsDesignOpen] = useState(false)
  const [coverFrameUrl, setCoverFrameUrl] = useState('')
  const [coverSelectedTime, setCoverSelectedTime] = useState(0)
  const [coverIsLocal, setCoverIsLocal] = useState(false)

  const handleOpenCoverDesign = useCallback((initialFrameDataUrl: string, selectedTime: number, isLocalImage: boolean) => {
    const finalUrl =
      initialFrameDataUrl ||
      activeTimeline?.cover?.customImagePath ||
      activeTimeline?.cover?.thumbnailDataUrl ||
      ''
    setCoverFrameUrl(finalUrl)
    setCoverSelectedTime(selectedTime)
    setCoverIsLocal(isLocalImage)
    onClosePicker()
    setIsDesignOpen(true)
  }, [activeTimeline?.cover, onClosePicker])

  const handleSaveCover = useCallback((cover: TimelineCover) => {
    setTimelineCover(cover)
  }, [setTimelineCover])

  const handleRemoveCover = useCallback(() => {
    setTimelineCover(undefined)
  }, [setTimelineCover])

  const handleCopyCoverElements = useCallback(async (elements: CoverElement[]): Promise<number> => {
    const items = await coverElementsToOverlays(elements, async ({ dataUrl, width, height, name }) => {
      const asset: Asset = {
        id: `asset-cover-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'image',
        path: dataUrl,
        prompt: name,
        resolution: `${width}x${height}`,
        width,
        height,
        createdAt: Date.now(),
      }
      const api = window.electronAPI
      if (!api?.saveTempShapeImage) return asset
      const saved = await api.saveTempShapeImage({ clipId: 'cover', data: dataUrl.slice(dataUrl.indexOf(',') + 1) })
      if (!saved.success) throw new Error(saved.error)
      if (!currentProjectId) return { ...asset, path: saved.path }
      const copied = await addVisualAssetToProject(saved.path, currentProjectId, 'image')
      return copied
        ? {
          ...asset,
          path: copied.path,
          bigThumbnailPath: copied.bigThumbnailPath,
          smallThumbnailPath: copied.smallThumbnailPath,
          width: copied.width || width,
          height: copied.height || height,
        }
        : { ...asset, path: saved.path }
    })
    if (items.length > 0) copyOverlays(items)
    return items.length
  }, [copyOverlays, currentProjectId])

  return (
    <>
      {isPickerOpen && (
        <CoverPickerModal
          isOpen={isPickerOpen}
          onClose={onClosePicker}
          onOpenDesign={handleOpenCoverDesign}
          onRemoveCover={handleRemoveCover}
          activeTimeline={activeTimeline}
          assets={assets}
        />
      )}

      {isDesignOpen && (
        <CoverDesignModal
          isOpen={isDesignOpen}
          onClose={() => setIsDesignOpen(false)}
          onSave={handleSaveCover}
          onDeleteCover={handleRemoveCover}
          initialFrameDataUrl={coverFrameUrl}
          selectedTime={coverSelectedTime}
          isLocalImage={coverIsLocal}
          currentCover={activeTimeline?.cover}
          projectName={activeTimeline?.name || 'Project'}
          onCopyElements={handleCopyCoverElements}
        />
      )}
    </>
  )
}
