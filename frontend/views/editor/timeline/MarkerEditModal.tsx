import React, { useState, useEffect, useRef } from 'react'
import { Trash2, X, Check, Bookmark } from 'lucide-react'
import { formatTime, COLOR_LABELS } from '../video-editor-utils'
import { useTranslation } from '../../../i18n/I18nContext'
import type { TimelineMarker } from '../../../types/project-model'

export interface MarkerEditModalProps {
  marker: TimelineMarker | null
  isOpen: boolean
  onClose: () => void
  onSave: (markerId: string, patch: Partial<TimelineMarker>) => void
  onDelete: (markerId: string) => void
  fps: number
  timecodeFormat: 'timecode' | 'frames'
}

export const MarkerEditModal: React.FC<MarkerEditModalProps> = ({
  marker,
  isOpen,
  onClose,
  onSave,
  onDelete,
  fps,
  timecodeFormat,
}) => {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (marker) {
      setLabel(marker.label || '')
      setColor(marker.color || '#3b82f6')
      setTimeout(() => inputRef.current?.select(), 50)
    }
  }, [marker])

  if (!isOpen || !marker) return null

  const handleSave = () => {
    onSave(marker.id, { label: label.trim(), color })
    onClose()
  }

  const handleDelete = () => {
    onDelete(marker.id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[360px] rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            handleSave()
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold text-sm">
            <Bookmark className="w-4 h-4 text-amber-400" />
            <span>{t('timeline.markers.editModal.title')}</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timecode */}
        <div className="my-3 flex items-center justify-between text-xs text-zinc-400 bg-zinc-950 px-3 py-1.5 rounded border border-zinc-800">
          <span>{t('timeline.markers.editModal.time')}:</span>
          <span className="font-mono font-medium text-amber-400 tabular-nums">
            {formatTime(marker.time, fps, timecodeFormat)} ({marker.time.toFixed(2)}s)
          </span>
        </div>

        {/* Label input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            {t('timeline.markers.editModal.labelField')}
          </label>
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
            placeholder={t('timeline.markers.editModal.placeholder')}
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>

        {/* Color picker palette */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-zinc-300 mb-2">
            {t('timeline.markers.editModal.colorField')}
          </label>
          <div className="grid grid-cols-5 gap-2">
            {COLOR_LABELS.map(cl => {
              const isSelected = color.toLowerCase() === cl.color.toLowerCase()
              return (
                <button
                  key={cl.id}
                  type="button"
                  onClick={() => setColor(cl.color)}
                  className="flex items-center justify-center h-8 rounded border transition-all relative"
                  style={{
                    backgroundColor: cl.color,
                    borderColor: isSelected ? '#ffffff' : 'transparent',
                    boxShadow: isSelected ? '0 0 0 2px rgba(255,255,255,0.4)' : undefined,
                  }}
                  title={cl.label}
                >
                  {isSelected && <Check className="w-4 h-4 text-white drop-shadow" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-red-400 hover:bg-red-950/50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('timeline.markers.editModal.deleteMarker')}</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-medium transition-colors shadow"
            >
              {t('timeline.markers.editModal.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
