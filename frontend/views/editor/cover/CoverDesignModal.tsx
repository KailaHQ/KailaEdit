import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { TimelineCover } from '@core/project-model'
import { useTranslation } from '../../../i18n/I18nContext'
import type {
  CoverElement,
  CoverDrawerTab,
  ImageCoverElement,
  UploadedCoverImage,
} from './types'
import {
  getStoredCoverImages,
  saveCoverImage,
  deleteStoredCoverImage,
} from './cover-image-storage'
import { CoverContextualToolbar } from './CoverContextualToolbar'
import { CoverLeftDrawer } from './CoverLeftDrawer'
import { CoverModalHeader } from './CoverModalHeader'
import { CoverNavigationSidebar } from './CoverNavigationSidebar'
import { CoverCanvasStage } from './CoverCanvasStage'
import { CoverBottomBar } from './CoverBottomBar'
import { CoverSaveTemplateModal } from './CoverSaveTemplateModal'
import { useCoverHistory } from './useCoverHistory'
import { useCoverMarquee } from './useCoverMarquee'
import { useCoverCustomTemplates } from './useCoverCustomTemplates'
import { useCoverElementActions } from './useCoverElementActions'
import { initializeCoverElements, buildTimelineCover } from './cover-element-converter'
import { generateCompositeCoverThumbnail } from './cover-thumbnail-generator'
import { isCoverBackground } from './cover-to-overlay'

export interface CoverDesignModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (cover: TimelineCover) => void
  onDeleteCover?: () => void
  initialFrameDataUrl: string
  selectedTime: number
  isLocalImage: boolean
  currentCover?: TimelineCover
  projectName?: string
  /**
   * Ctrl+C on the canvas: puts these elements on the editor's clipboard, for a Ctrl+V on
   * the timeline. Resolves to how many could be copied.
   */
  onCopyElements?: (elements: CoverElement[]) => Promise<number>
}

export const CoverDesignModal: React.FC<CoverDesignModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDeleteCover: _onDeleteCover,
  initialFrameDataUrl,
  selectedTime,
  isLocalImage,
  currentCover,
  projectName: _projectName = 'Project',
  onCopyElements,
}) => {
  const { t } = useTranslation()

  // Zoom scale for canvas preview
  const [zoom, setZoom] = useState<number>(0.65)

  // Drawer state
  const [activeDrawerTab, setActiveDrawerTab] = useState<CoverDrawerTab | null>('templates')

  // Selected template ID
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    currentCover?.templateId || 'bookish-weekend'
  )

  // Cover History hook
  const {
    elements,
    setElements,
    elementsRef,
    pushHistory,
    handleStartTransform,
    handleCommitTransform,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useCoverHistory(initializeCoverElements(initialFrameDataUrl, currentCover, selectedTemplateId))

  // Selected element ID
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const selectedElementIdRef = useRef(selectedElementId)
  selectedElementIdRef.current = selectedElementId

  // Inline text editing ID (when double-clicking a text item)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null)

  // Drag selection marquee
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const frameMouseDownTargetRef = useRef<EventTarget | null>(null)

  const {
    multiSelectedIds,
    setMultiSelectedIds,
    marquee,
    handleStartMarquee,
  } = useCoverMarquee(containerRef, elementsRef, setSelectedElementId, setInlineEditingId)

  const multiSelectedIdsRef = useRef(multiSelectedIds)
  multiSelectedIdsRef.current = multiSelectedIds

  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const copyNoticeTimerRef = useRef<number | null>(null)

  // Rendered canvas pixel dimensions
  const renderedCanvasWidth = 340 * (zoom / 0.65)
  const renderedCanvasHeight = 604 * (zoom / 0.65)

  // Element actions and mutations hook
  const {
    isProcessingBgRemoval,
    handleUpdateElement,
    handleRunBgRemoval,
    handleRestoreBg,
    handleDuplicateElement,
    handleDeleteElement,
    handleLockToggle,
    handleBringForward,
    handleSendBackward,
    handleBringToFront,
    handleSendToBack,
    handleStartMoveElement,
    handleAddText,
    handleAddShape,
    handleAddImage,
    handleApplyTemplate,
  } = useCoverElementActions(
    elements,
    setElements,
    elementsRef,
    pushHistory,
    handleStartTransform,
    handleCommitTransform,
    selectedElementId,
    setSelectedElementId,
    renderedCanvasWidth,
    renderedCanvasHeight,
    setSelectedTemplateId
  )

  // Helper for generating composite thumbnail
  const generateCompositeThumbnail = useCallback(async (): Promise<string> => {
    const effectiveBgSrc =
      initialFrameDataUrl ||
      currentCover?.customImagePath ||
      currentCover?.thumbnailDataUrl ||
      ''
    return generateCompositeCoverThumbnail(elements, effectiveBgSrc)
  }, [elements, initialFrameDataUrl, currentCover])

  // Custom templates management hook
  const {
    customTemplates,
    activeCustomTemplate,
    showSaveTemplateModal,
    setShowSaveTemplateModal,
    templateNameInput,
    setTemplateNameInput,
    templatePreviewThumb,
    isSavingTemplate,
    isUpdatingTemplate,
    isJustUpdated,
    handleDeleteCustomTemplate,
    handleUpdateCurrentTemplate,
    handleOpenSaveTemplateModal,
    handleConfirmSaveTemplate,
  } = useCoverCustomTemplates(
    selectedTemplateId,
    setSelectedTemplateId,
    elements,
    generateCompositeThumbnail,
    setActiveDrawerTab
  )

  // Picking one element on its own ends a box selection.
  useEffect(() => {
    if (selectedElementId) setMultiSelectedIds([])
  }, [selectedElementId, setMultiSelectedIds])

  useEffect(() => () => {
    if (copyNoticeTimerRef.current) window.clearTimeout(copyNoticeTimerRef.current)
  }, [])

  // Uploaded images library
  const [uploadedImages, setUploadedImages] = useState<UploadedCoverImage[]>([])

  useEffect(() => {
    let isMounted = true
    getStoredCoverImages().then(imgs => {
      if (isMounted) setUploadedImages(imgs)
    })
    return () => {
      isMounted = false
    }
  }, [])

  // Update background source if initialFrameDataUrl or currentCover changes
  useEffect(() => {
    const effectiveBgSrc =
      initialFrameDataUrl ||
      currentCover?.customImagePath ||
      currentCover?.thumbnailDataUrl ||
      ''
    if (effectiveBgSrc) {
      setElements(prev => {
        const hasBg = prev.some(el => el.id === 'background-layer' || el.type === 'background')
        if (hasBg) {
          return prev.map(el =>
            el.id === 'background-layer' || el.type === 'background'
              ? { ...el, src: (el as ImageCoverElement).src || effectiveBgSrc }
              : el
          )
        }
        return prev
      })
    }
  }, [initialFrameDataUrl, currentCover, setElements])

  const showCopyNotice = useCallback((message: string) => {
    setCopyNotice(message)
    if (copyNoticeTimerRef.current) window.clearTimeout(copyNoticeTimerRef.current)
    copyNoticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 3500)
  }, [])

  const handleCopySelection = useCallback(async () => {
    if (!onCopyElements) return
    const ids = multiSelectedIdsRef.current.length > 0
      ? multiSelectedIdsRef.current
      : selectedElementIdRef.current ? [selectedElementIdRef.current] : []
    const picked = elementsRef.current.filter(el => ids.includes(el.id) && !isCoverBackground(el))
    if (picked.length === 0) return
    try {
      const count = await onCopyElements(picked)
      showCopyNotice(count > 0 ? t('cover.copied', { count }) : t('cover.copyFailed'))
    } catch {
      showCopyNotice(t('cover.copyFailed'))
    }
  }, [onCopyElements, showCopyNotice, t, elementsRef])

  // Global Undo / Redo keyboard shortcuts inside Cover Studio
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void handleCopySelection()
      } else if (e.key === 'Escape' && multiSelectedIdsRef.current.length > 0) {
        setMultiSelectedIds([])
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault()
          handleRedo()
        } else {
          e.preventDefault()
          handleUndo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo, handleCopySelection, setMultiSelectedIds])

  const selectedElement = elements.find(el => el.id === selectedElementId) || null

  // Process uploaded image file
  const processImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const res = reader.result as string
      const newImgItem: UploadedCoverImage = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        src: res,
        name: file.name,
        addedAt: Date.now(),
      }
      await saveCoverImage(newImgItem)
      setUploadedImages(prev => [newImgItem, ...prev.filter(i => i.id !== newImgItem.id)])
      handleAddImage(res, file.name)
    }
    reader.readAsDataURL(file)
  }, [handleAddImage])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processImageFile(file)
    e.target.value = ''
  }

  const handleDropFiles = useCallback((files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      processImageFile(files[i])
    }
  }, [processImageFile])

  const handleDeleteUploadedImage = useCallback(async (id: string) => {
    await deleteStoredCoverImage(id)
    setUploadedImages(prev => prev.filter(img => img.id !== id))
  }, [])

  // Save Cover changes and close
  const handleSave = async () => {
    try {
      const thumbUrl = await generateCompositeThumbnail()
      const newCover = buildTimelineCover(
        elements,
        selectedTemplateId,
        selectedTime,
        isLocalImage,
        thumbUrl,
        initialFrameDataUrl,
        currentCover
      )
      onSave(newCover)
      onClose()
    } catch (err) {
      console.error('Error saving cover:', err)
      onClose()
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-[#111113] text-zinc-100 select-none overflow-hidden"
      data-editor-shortcuts="off"
    >
      {/* ─── Top Studio Bar ─────────────────────────────────────────── */}
      <CoverModalHeader
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onClose={onClose}
      />

      {/* ─── Main Studio Body ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* 1. Left Vertical Icon Sidebar */}
        <CoverNavigationSidebar
          activeDrawerTab={activeDrawerTab}
          onToggleTab={tab => setActiveDrawerTab(activeDrawerTab === tab ? null : tab)}
          fileInputRef={fileInputRef}
          onFileInputChange={handleFileChange}
        />

        {/* 2. Left Slide-out Content Drawer */}
        <CoverLeftDrawer
          isOpen={activeDrawerTab !== null}
          activeTab={activeDrawerTab}
          onClose={() => setActiveDrawerTab(null)}
          selectedElement={selectedElement}
          elements={elements}
          canvasWidth={720}
          canvasHeight={1280}
          onSelectElement={setSelectedElementId}
          onUpdateElement={handleUpdateElement}
          onReorderElements={reordered => pushHistory(reordered)}
          onApplyTemplate={handleApplyTemplate}
          customTemplates={customTemplates}
          onDeleteCustomTemplate={handleDeleteCustomTemplate}
          onRunBgRemoval={handleRunBgRemoval}
          onRestoreBg={handleRestoreBg}
          isProcessingBgRemoval={isProcessingBgRemoval}
          uploadedImages={uploadedImages}
          onAddImageToCanvas={handleAddImage}
          onUploadNewImage={() => fileInputRef.current?.click()}
          onDeleteUploadedImage={handleDeleteUploadedImage}
          onDropFiles={handleDropFiles}
          onAddText={handleAddText}
          onAddShape={handleAddShape}
        />

        {/* 3. Center Canvas & Contextual Toolbar */}
        <div
          className="flex-1 flex flex-col bg-[#111113] relative overflow-hidden"
          onClick={() => {
            setSelectedElementId(null)
            setInlineEditingId(null)
            setMultiSelectedIds([])
          }}
        >
          {/* Top Floating Contextual Toolbar */}
          <CoverContextualToolbar
            selectedElement={selectedElement}
            activeDrawerTab={activeDrawerTab}
            onOpenDrawerTab={tab => setActiveDrawerTab(tab)}
            onUpdateText={updates => selectedElement && handleUpdateElement(selectedElement.id, updates)}
            onUpdateImage={updates => selectedElement && handleUpdateElement(selectedElement.id, updates)}
            onUpdateShape={updates => selectedElement && handleUpdateElement(selectedElement.id, updates)}
            onReplaceImage={() => fileInputRef.current?.click()}
            onDuplicate={id => handleDuplicateElement(id)}
            onRunBgRemoval={handleRunBgRemoval}
            onRestoreBg={handleRestoreBg}
            isProcessingBgRemoval={isProcessingBgRemoval}
          />

          {/* Interactive Canvas Stage */}
          <CoverCanvasStage
            containerRef={containerRef}
            renderedCanvasWidth={renderedCanvasWidth}
            renderedCanvasHeight={renderedCanvasHeight}
            zoom={zoom}
            elements={elements}
            selectedElement={selectedElement}
            selectedElementId={selectedElementId}
            inlineEditingId={inlineEditingId}
            marquee={marquee}
            copyNotice={copyNotice}
            multiSelectedIds={multiSelectedIds}
            frameMouseDownTargetRef={frameMouseDownTargetRef}
            onSelectElementId={setSelectedElementId}
            onSetInlineEditingId={setInlineEditingId}
            onSetMultiSelectedIds={setMultiSelectedIds}
            onStartMarquee={handleStartMarquee}
            onStartMoveElement={handleStartMoveElement}
            onUpdateElement={handleUpdateElement}
            onStartTransform={handleStartTransform}
            onCommitTransform={handleCommitTransform}
            onDuplicateElement={() => selectedElementId && handleDuplicateElement(selectedElementId)}
            onDeleteElement={() => selectedElementId && handleDeleteElement(selectedElementId)}
            onLockToggle={() => selectedElementId && handleLockToggle(selectedElementId)}
            onBringForward={() => selectedElementId && handleBringForward(selectedElementId)}
            onSendBackward={() => selectedElementId && handleSendBackward(selectedElementId)}
            onBringToFront={() => selectedElementId && handleBringToFront(selectedElementId)}
            onSendToBack={() => selectedElementId && handleSendToBack(selectedElementId)}
          />

          {/* Bottom Controls Bar (Zoom, Save Template, Exit, Save Cover) */}
          <CoverBottomBar
            zoom={zoom}
            onZoomIn={() => setZoom(prev => Math.min(prev + 0.1, 1.5))}
            onZoomOut={() => setZoom(prev => Math.max(prev - 0.1, 0.3))}
            activeCustomTemplate={activeCustomTemplate}
            isUpdatingTemplate={isUpdatingTemplate}
            isJustUpdated={isJustUpdated}
            onUpdateCurrentTemplate={handleUpdateCurrentTemplate}
            onOpenSaveTemplateModal={handleOpenSaveTemplateModal}
            onClose={onClose}
            onSave={handleSave}
          />
        </div>

        {/* ─── SAVE TEMPLATE MODAL DIALOG ───────────────────────────── */}
        <CoverSaveTemplateModal
          isOpen={showSaveTemplateModal}
          onClose={() => setShowSaveTemplateModal(false)}
          templateNameInput={templateNameInput}
          onChangeTemplateName={setTemplateNameInput}
          templatePreviewThumb={templatePreviewThumb}
          isSavingTemplate={isSavingTemplate}
          onConfirmSave={handleConfirmSaveTemplate}
        />
      </div>
    </div>,
    document.body
  )
}
