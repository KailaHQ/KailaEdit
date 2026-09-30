import React from 'react'
import { Edit2, X } from 'lucide-react'
import type { TimelineCover } from '@core/project-model'
import { Tooltip } from '../../../components/ui/tooltip'
import { useTranslation } from '../../../i18n/I18nContext'

export interface TimelineCoverButtonProps {
  cover?: TimelineCover
  onClick: () => void
  onRemoveCover?: () => void
}

export const TimelineCoverButton: React.FC<TimelineCoverButtonProps> = ({
  cover,
  onClick,
  onRemoveCover,
}) => {
  const { t } = useTranslation()
  const thumbnailSrc = cover?.thumbnailDataUrl || cover?.customImagePath
  const hasThumbnail = Boolean(thumbnailSrc)

  return (
    <div className="relative group/cover-btn inline-flex items-center justify-center">
      <Tooltip content={t('cover.tooltip') || 'Edit video cover'} side="right">
        <button
          onClick={onClick}
          type="button"
          className={`relative flex flex-col items-center justify-center rounded-lg transition-all select-none overflow-hidden w-[52px] h-[38px] max-h-[calc(100%-6px)] ${
            hasThumbnail
              ? 'border border-zinc-700 hover:border-sky-400 shadow-md bg-zinc-950'
              : 'border border-dashed border-zinc-600/70 hover:border-sky-400 bg-zinc-800/40 hover:bg-zinc-800/80 shadow-sm'
          }`}
          title={t('cover.title') || 'Cover'}
        >
          {hasThumbnail && thumbnailSrc ? (
            <>
              <img
                src={thumbnailSrc}
                alt="Cover preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/cover-btn:opacity-100 flex items-center justify-center transition-opacity">
                <Edit2 className="h-3.5 w-3.5 text-white drop-shadow" />
              </div>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent py-0.5 text-center pointer-events-none">
                <span className="text-[8px] font-semibold text-sky-300 leading-none tracking-tight">
                  {t('cover.label') || 'Cover'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-0.5 pointer-events-none">
              <Edit2 className="h-3.5 w-3.5 text-zinc-300 group-hover/cover-btn:text-white transition-colors" />
              <span className="text-[10px] font-medium text-zinc-300 group-hover/cover-btn:text-white tracking-tight leading-none">
                {t('cover.label') || 'Cover'}
              </span>
            </div>
          )}
        </button>
      </Tooltip>

      {/* Delete Cover Button [x] */}
      {hasThumbnail && onRemoveCover && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onRemoveCover()
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 hover:bg-red-600 border border-zinc-600 hover:border-red-500 text-zinc-300 hover:text-white flex items-center justify-center shadow-lg transition-all opacity-0 group-hover/cover-btn:opacity-100 z-20 cursor-pointer"
          title={t('cover.remove') || 'Remove cover image'}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  )
}

