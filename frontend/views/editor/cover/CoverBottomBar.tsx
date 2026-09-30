import React from 'react'
import {
  ZoomIn,
  ZoomOut,
  BookmarkCheck,
  BookmarkPlus,
  Loader2,
  LogOut,
  Check,
} from 'lucide-react'
import type { CoverTemplate } from './cover-templates'
import { useTranslation } from '../../../i18n/I18nContext'

export interface CoverBottomBarProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  activeCustomTemplate?: CoverTemplate | null
  isUpdatingTemplate: boolean
  isJustUpdated: boolean
  onUpdateCurrentTemplate: () => void
  onOpenSaveTemplateModal: () => void
  onClose: () => void
  onSave: () => void
}

export const CoverBottomBar: React.FC<CoverBottomBarProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  activeCustomTemplate,
  isUpdatingTemplate,
  isJustUpdated,
  onUpdateCurrentTemplate,
  onOpenSaveTemplateModal,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation()

  return (
    <>
      {/* Bottom Zoom Controller Bar */}
      <div className="absolute bottom-4 left-6 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300 shadow-lg">
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={onZoomIn}
            className="hover:text-white"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onZoomOut}
            className="hover:text-white"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom-Right Action Buttons: Save Template, Exit & Save */}
      <div className="absolute bottom-4 right-6 flex items-center gap-3 z-30">
        {activeCustomTemplate ? (
          <>
            <button
              onClick={e => {
                e.stopPropagation()
                onUpdateCurrentTemplate()
              }}
              disabled={isUpdatingTemplate}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-600/60 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title={`Update changes directly to template "${activeCustomTemplate.name}"`}
            >
              {isJustUpdated ? (
                <BookmarkCheck className="h-3.5 w-3.5 text-emerald-400" />
              ) : isUpdatingTemplate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
              ) : (
                <BookmarkCheck className="h-3.5 w-3.5" />
              )}
              <span>
                {isJustUpdated
                  ? 'Updated!'
                  : isUpdatingTemplate
                  ? 'Updating...'
                  : 'Update Template'}
              </span>
            </button>

            <button
              onClick={e => {
                e.stopPropagation()
                onOpenSaveTemplateModal()
              }}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
              title="Create new template from current design"
            >
              <BookmarkPlus className="h-3.5 w-3.5 text-amber-400" />
              <span>Save as Template</span>
            </button>
          </>
        ) : (
          <button
            onClick={e => {
              e.stopPropagation()
              onOpenSaveTemplateModal()
            }}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
            title="Save current design as custom template"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            <span>Save Template</span>
          </button>
        )}

        <button
          onClick={e => {
            e.stopPropagation()
            onClose()
          }}
          className="px-4 py-2 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 shadow-xl transition-all flex items-center gap-1.5 cursor-pointer"
          title="Exit without saving"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>{t('common.cancel') || 'Exit'}</span>
        </button>

        <button
          onClick={e => {
            e.stopPropagation()
            onSave()
          }}
          className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-sky-500 hover:bg-sky-400 shadow-xl shadow-sky-500/25 transition-all flex items-center gap-1.5 cursor-pointer"
          title="Save cover changes"
        >
          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
          <span>{t('common.save') || 'Save Cover'}</span>
        </button>
      </div>
    </>
  )
}
