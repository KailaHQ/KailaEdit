import React from 'react'
import { BookmarkPlus } from 'lucide-react'
import { useTranslation } from '../../../i18n/I18nContext'

export interface CoverSaveTemplateModalProps {
  isOpen: boolean
  onClose: () => void
  templateNameInput: string
  onChangeTemplateName: (name: string) => void
  templatePreviewThumb: string | null
  isSavingTemplate: boolean
  onConfirmSave: () => void
}

export const CoverSaveTemplateModal: React.FC<CoverSaveTemplateModalProps> = ({
  isOpen,
  onClose,
  templateNameInput,
  onChangeTemplateName,
  templatePreviewThumb,
  isSavingTemplate,
  onConfirmSave,
}) => {
  const { t } = useTranslation()
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="bg-[#18181b] border border-zinc-700/80 rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4 text-zinc-200"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        onKeyUp={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <BookmarkPlus className="w-4 h-4" />
            <span>{t('cover.saveTemplateTitle') || 'Save as Custom Template'}</span>
          </div>
        </div>

        {/* Thumbnail Preview & Description */}
        <div className="flex items-center gap-4 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
          <div className="w-20 h-28 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-700/60 flex-shrink-0 flex items-center justify-center">
            {templatePreviewThumb ? (
              <img
                src={templatePreviewThumb}
                alt="Template Preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                Preview
              </div>
            )}
          </div>
          <div className="flex-1 space-y-1 text-xs">
            <p className="font-semibold text-zinc-200">{t('cover.reusableTitle') || 'Reusable Template'}</p>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              {t('cover.reusableDesc') || 'This template will save all text styles, shapes, and layouts so you can reuse them in other videos.'}
            </p>
          </div>
        </div>

        {/* Input for Template Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-300">{t('cover.templateName') || 'Template Name'}</label>
          <input
            type="text"
            value={templateNameInput}
            onChange={e => onChangeTemplateName(e.target.value)}
            onFocus={e => e.target.select()}
            placeholder={t('cover.templateNamePlaceholder') || 'Enter template name (e.g., Vlog Daily, Review...)'}
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700/80 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
            autoFocus
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                onConfirmSave()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            onKeyUp={e => e.stopPropagation()}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!templateNameInput.trim() || isSavingTemplate}
            onClick={onConfirmSave}
            className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>{isSavingTemplate ? (t('cover.saving') || 'Saving...') : (t('cover.saveTemplateBtn') || 'Save Template')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
