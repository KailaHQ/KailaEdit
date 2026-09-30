import React from 'react'
import { X } from 'lucide-react'
import type {
  CoverElement,
  CoverDrawerTab,
  TextCoverElement,
  UploadedCoverImage,
} from './types'
import type { CoverTemplate } from './cover-templates'
import type { CoverShapeDef } from './cover-shapes'
import { CoverPositionTab } from './drawer/CoverPositionTab'
import { CoverEffectsTab } from './drawer/CoverEffectsTab'
import { CoverEditTab } from './drawer/CoverEditTab'
import { CoverBgRemoverTab } from './drawer/CoverBgRemoverTab'
import { CoverTemplatesTab } from './drawer/CoverTemplatesTab'
import { CoverImagesTab } from './drawer/CoverImagesTab'
import { CoverTextTab } from './drawer/CoverTextTab'
import { CoverShapesTab } from './drawer/CoverShapesTab'

export interface CoverLeftDrawerProps {
  isOpen: boolean
  activeTab: CoverDrawerTab | null
  onClose: () => void
  selectedElement: CoverElement | null
  elements: CoverElement[]
  canvasWidth: number
  canvasHeight: number
  onSelectElement: (id: string) => void
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
  onReorderElements: (reordered: CoverElement[]) => void
  onApplyTemplate: (tpl: CoverTemplate) => void
  customTemplates?: CoverTemplate[]
  onDeleteCustomTemplate?: (templateId: string) => void
  onSaveCurrentAsTemplate?: () => void
  onRunBgRemoval?: (id: string) => Promise<void>
  onRestoreBg?: (id: string) => void
  isProcessingBgRemoval?: boolean
  uploadedImages?: UploadedCoverImage[]
  onAddImageToCanvas?: (src: string, name: string) => void
  onUploadNewImage?: () => void
  onDeleteUploadedImage?: (id: string) => void
  onDropFiles?: (files: FileList) => void
  onAddText?: (type?: 'heading' | 'subheading' | 'body', customProps?: Partial<TextCoverElement>) => void
  onAddShape?: (shapeDef: CoverShapeDef) => void
}

export const CoverLeftDrawer: React.FC<CoverLeftDrawerProps> = ({
  isOpen,
  activeTab,
  onClose,
  selectedElement,
  elements,
  canvasWidth,
  canvasHeight,
  onSelectElement,
  onUpdateElement,
  onReorderElements,
  onApplyTemplate,
  customTemplates = [],
  onDeleteCustomTemplate,
  onSaveCurrentAsTemplate,
  onRunBgRemoval,
  onRestoreBg,
  isProcessingBgRemoval = false,
  uploadedImages = [],
  onAddImageToCanvas,
  onUploadNewImage,
  onDeleteUploadedImage,
  onDropFiles,
  onAddText,
  onAddShape,
}) => {
  if (!isOpen || !activeTab) return null

  const getDrawerTitle = () => {
    switch (activeTab) {
      case 'position':
        return 'Position'
      case 'effects':
        return 'Effects'
      case 'edit':
        return 'Edit Photo'
      case 'bg-remover':
        return 'Remove Background'
      case 'templates':
        return 'Templates'
      case 'images':
        return 'Images'
      case 'text':
        return 'Text'
      case 'shapes':
        return 'Shapes'
      case 'layers':
        return 'Layers'
      default:
        return 'Properties'
    }
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      className="w-80 border-r border-zinc-800 bg-zinc-900/95 flex flex-col flex-shrink-0 z-40 select-none shadow-2xl animate-in slide-in-from-left-2 duration-150"
    >
      {/* Drawer Title Header */}
      <div className="h-12 px-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
          <span>{getDrawerTitle()}</span>
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'position' && (
        <CoverPositionTab
          selectedElement={selectedElement}
          elements={elements}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onSelectElement={onSelectElement}
          onUpdateElement={onUpdateElement}
          onReorderElements={onReorderElements}
        />
      )}

      {activeTab === 'effects' && (
        <CoverEffectsTab
          selectedElement={selectedElement}
          onUpdateElement={onUpdateElement}
        />
      )}

      {activeTab === 'edit' && (
        <CoverEditTab
          selectedElement={selectedElement}
          onUpdateElement={onUpdateElement}
        />
      )}

      {activeTab === 'bg-remover' && (
        <CoverBgRemoverTab
          selectedElement={selectedElement}
          onRunBgRemoval={onRunBgRemoval}
          onRestoreBg={onRestoreBg}
          onUpdateElement={onUpdateElement}
          isProcessingBgRemoval={isProcessingBgRemoval}
        />
      )}

      {activeTab === 'templates' && (
        <CoverTemplatesTab
          customTemplates={customTemplates}
          onApplyTemplate={onApplyTemplate}
          onSaveCurrentAsTemplate={onSaveCurrentAsTemplate}
          onDeleteCustomTemplate={onDeleteCustomTemplate}
        />
      )}

      {activeTab === 'images' && (
        <CoverImagesTab
          uploadedImages={uploadedImages}
          onAddImageToCanvas={onAddImageToCanvas}
          onUploadNewImage={onUploadNewImage}
          onDeleteUploadedImage={onDeleteUploadedImage}
          onDropFiles={onDropFiles}
        />
      )}

      {activeTab === 'text' && (
        <CoverTextTab onAddText={onAddText} />
      )}

      {activeTab === 'shapes' && (
        <CoverShapesTab onAddShape={onAddShape} />
      )}
    </div>
  )
}
