import { useState } from 'react'
import type { TimelineCoverTextItem } from '@core/project-model'
import {
  type CoverTemplate,
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
} from './cover-templates'
import type { CoverElement, TextCoverElement } from './types'

export function useCoverCustomTemplates(
  selectedTemplateId: string,
  setSelectedTemplateId: (id: string) => void,
  elements: CoverElement[],
  generateCompositeThumbnail: () => Promise<string>,
  setActiveDrawerTab: (tab: any) => void
) {
  const [customTemplates, setCustomTemplates] = useState<CoverTemplate[]>(() => getCustomTemplates())
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templatePreviewThumb, setTemplatePreviewThumb] = useState<string | null>(null)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isUpdatingTemplate, setIsUpdatingTemplate] = useState(false)
  const [isJustUpdated, setIsJustUpdated] = useState(false)

  const activeCustomTemplate = customTemplates.find(t => t.id === selectedTemplateId) || null

  const handleDeleteCustomTemplate = (id: string) => {
    const updated = deleteCustomTemplate(id)
    setCustomTemplates(updated)
  }

  const handleUpdateCurrentTemplate = async () => {
    if (!activeCustomTemplate) return
    setIsUpdatingTemplate(true)
    try {
      const thumb = await generateCompositeThumbnail()
      const texts: TimelineCoverTextItem[] = elements
        .filter(el => el.type === 'text')
        .map(el => {
          const tEl = el as TextCoverElement
          return {
            id: tEl.id,
            text: tEl.text,
            fontFamily: tEl.fontFamily,
            fontSize: tEl.fontSize,
            fontWeight: String(tEl.fontWeight),
            fontStyle: tEl.fontStyle,
            color: tEl.color,
            backgroundColor: tEl.backgroundBadge?.enabled ? tEl.backgroundBadge.color : tEl.backgroundColor,
            textAlign: tEl.textAlign,
            x: tEl.x,
            y: tEl.y,
            rotation: tEl.rotation,
            letterSpacing: tEl.letterSpacing,
            lineHeight: tEl.lineHeight,
            textTransform: tEl.textTransform,
            shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
            stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
            strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
          }
        })

      const foregroundElements = elements.filter(
        el => el.id !== 'background-layer' && el.type !== 'background'
      )

      const updatedTemplate: CoverTemplate = {
        ...activeCustomTemplate,
        previewThumbnail: thumb || activeCustomTemplate.previewThumbnail,
        texts,
        elements: foregroundElements,
      }

      const updated = saveCustomTemplate(updatedTemplate)
      setCustomTemplates(updated)
      setIsJustUpdated(true)
      setTimeout(() => setIsJustUpdated(false), 2500)
    } catch (err) {
      console.error('[CoverDesignModal] Failed to update template:', err)
    } finally {
      setIsUpdatingTemplate(false)
    }
  }

  const handleOpenSaveTemplateModal = async () => {
    try {
      const thumb = await generateCompositeThumbnail()
      setTemplatePreviewThumb(thumb)
    } catch (e) {
      console.error('[CoverDesignModal] Failed to generate thumbnail for template:', e)
    }

    if (activeCustomTemplate) {
      setTemplateNameInput(`${activeCustomTemplate.name} (Copy)`)
    } else {
      setTemplateNameInput(`Template ${customTemplates.length + 1}`)
    }
    setShowSaveTemplateModal(true)
  }

  const handleConfirmSaveTemplate = () => {
    if (!templateNameInput.trim()) return
    setIsSavingTemplate(true)
    try {
      const texts: TimelineCoverTextItem[] = elements
        .filter(el => el.type === 'text')
        .map(el => {
          const tEl = el as TextCoverElement
          return {
            id: tEl.id,
            text: tEl.text,
            fontFamily: tEl.fontFamily,
            fontSize: tEl.fontSize,
            fontWeight: String(tEl.fontWeight),
            fontStyle: tEl.fontStyle,
            color: tEl.color,
            backgroundColor: tEl.backgroundBadge?.enabled ? tEl.backgroundBadge.color : tEl.backgroundColor,
            textAlign: tEl.textAlign,
            x: tEl.x,
            y: tEl.y,
            rotation: tEl.rotation,
            letterSpacing: tEl.letterSpacing,
            lineHeight: tEl.lineHeight,
            textTransform: tEl.textTransform,
            shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
            stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
            strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
          }
        })

      const foregroundElements = elements.filter(
        el => el.id !== 'background-layer' && el.type !== 'background'
      )

      const targetId = `custom-tpl-${Date.now()}`

      const newTemplate: CoverTemplate = {
        id: targetId,
        name: templateNameInput.trim(),
        category: 'custom',
        isCustom: true,
        createdAt: Date.now(),
        previewThumbnail: templatePreviewThumb || undefined,
        texts,
        elements: foregroundElements,
      }

      const updated = saveCustomTemplate(newTemplate)
      setCustomTemplates(updated)
      setSelectedTemplateId(targetId)
      setShowSaveTemplateModal(false)
      setActiveDrawerTab('templates')
    } catch (err) {
      console.error('[CoverDesignModal] Failed to save template:', err)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  return {
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
  }
}
