import React, { useState } from 'react'
import { BookmarkPlus, Bookmark, Check, Trash2 } from 'lucide-react'
import {
  COVER_TEMPLATES,
  COVER_CATEGORIES,
  type CoverTemplate,
  type CoverCategory,
} from '../cover-templates'

export interface CoverTemplatesTabProps {
  customTemplates?: CoverTemplate[]
  onApplyTemplate: (tpl: CoverTemplate) => void
  onSaveCurrentAsTemplate?: () => void
  onDeleteCustomTemplate?: (templateId: string) => void
  selectedTemplateId?: string
  onSelectTemplateId?: (id: string) => void
}

export const CoverTemplatesTab: React.FC<CoverTemplatesTabProps> = ({
  customTemplates = [],
  onApplyTemplate,
  onSaveCurrentAsTemplate,
  onDeleteCustomTemplate,
  selectedTemplateId = 'bookish-weekend',
  onSelectTemplateId,
}) => {
  const [activeCategory, setActiveCategory] = useState<CoverCategory>('all')

  const allTemplates = [...(customTemplates || []), ...COVER_TEMPLATES]
  const filteredTemplates =
    activeCategory === 'all'
      ? allTemplates
      : activeCategory === 'custom'
      ? customTemplates || []
      : COVER_TEMPLATES.filter(tpl => tpl.category === activeCategory)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-zinc-800 flex-shrink-0 space-y-2">
        {/* Quick Action: Save Current Design as Template */}
        {onSaveCurrentAsTemplate && (
          <button
            onClick={onSaveCurrentAsTemplate}
            className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 hover:border-amber-500/50 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>Save current design as template</span>
          </button>
        )}

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {COVER_CATEGORIES.map(cat => {
            const count =
              cat.id === 'custom'
                ? (customTemplates || []).length
                : cat.id === 'all'
                ? allTemplates.length
                : COVER_TEMPLATES.filter(t => t.category === cat.id).length
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                  activeCategory === cat.id
                    ? 'bg-zinc-700 text-white font-semibold'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{cat.fallbackLabel}</span>
                {count > 0 && (
                  <span className="text-[9px] px-1 py-0.2 rounded-full bg-zinc-600/80 text-zinc-300 font-mono">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Preset / Custom Templates Grid (2 Columns) */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {activeCategory === 'custom' && (!customTemplates || customTemplates.length === 0) ? (
          <div className="py-12 px-4 text-center flex flex-col items-center justify-center text-zinc-400">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
              <Bookmark className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-200 mb-1">No custom templates yet</h4>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4 max-w-[220px]">
              Create a cover design and click <strong>Save Template</strong> below to reuse anytime!
            </p>
            {onSaveCurrentAsTemplate && (
              <button
                onClick={onSaveCurrentAsTemplate}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Create template now</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filteredTemplates.map(tpl => {
              const isSelected = selectedTemplateId === tpl.id
              return (
                <div
                  key={tpl.id}
                  onClick={() => {
                    onSelectTemplateId?.(tpl.id)
                    onApplyTemplate(tpl)
                  }}
                  className={`relative rounded-lg overflow-hidden cursor-pointer border transition-all aspect-[9/16] group ${
                    tpl.previewGradient ? `bg-gradient-to-b ${tpl.previewGradient}` : 'bg-zinc-900'
                  } ${
                    isSelected
                      ? 'border-sky-400 ring-2 ring-sky-400/40'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  {/* If template has preview thumbnail image */}
                  {tpl.previewThumbnail && (
                    <img
                      src={tpl.previewThumbnail}
                      alt={tpl.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}

                  {/* Template Texts Preview (when no thumbnail) */}
                  {!tpl.previewThumbnail && (
                    <div className="absolute inset-0 p-2 flex flex-col justify-between pointer-events-none">
                      <div className="flex flex-col items-center justify-center mt-6 text-center">
                        {tpl.texts.slice(0, 2).map((item, i) => (
                          <span
                            key={i}
                            className="font-bold leading-tight drop-shadow truncate w-full"
                            style={{
                              color: item.color || '#fff',
                              fontSize: Math.max(9, Math.min(13, (item.fontSize || 20) * 0.35)),
                              fontFamily:
                                item.fontFamily === 'serif'
                                  ? 'serif'
                                  : item.fontFamily === 'cursive'
                                  ? 'cursive'
                                  : 'sans-serif',
                              textTransform: item.textTransform || 'none',
                            }}
                          >
                            {item.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Template Name Overlay badge at bottom */}
                  <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                    <p className="text-[10px] font-medium text-white truncate text-center">
                      {tpl.name}
                    </p>
                  </div>

                  {/* Custom badge */}
                  {tpl.isCustom && (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/90 text-black shadow">
                      Mine
                    </span>
                  )}

                  {/* Delete button for custom template */}
                  {tpl.isCustom && onDeleteCustomTemplate && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        onDeleteCustomTemplate(tpl.id)
                      }}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/80 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow cursor-pointer z-10"
                      title="Delete this template"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}

                  {/* Checkmark */}
                  {isSelected && (!tpl.isCustom || !onDeleteCustomTemplate) && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center shadow">
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
