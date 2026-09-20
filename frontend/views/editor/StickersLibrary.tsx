import { useState, useMemo, useRef } from 'react'
import {
  Search,
  Upload,
  X,
  Sparkles,
  Plus,
} from 'lucide-react'
import type { Asset } from '../../types/project-model'
import { STICKER_DEFINITIONS, STICKER_CATEGORIES, type StickerCategory } from '@core/stickers'
import { pathToFileUrl } from '../../lib/file-url'
import { useTranslation } from '../../i18n/I18nContext'
import { useEditorActions, useEditorStore } from './editor-store'

export interface StickersLibraryProps {
  importFiles?: (files: FileList | File[]) => Promise<unknown>
}

export function StickersLibrary({
  importFiles,
}: StickersLibraryProps) {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const assets = useEditorStore(s => s.editorModel.assets)
  const [selectedCategory, setSelectedCategory] = useState<StickerCategory | 'all' | 'custom' | 'animated'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Custom user-imported images
  const customStickers = useMemo(() => {
    return assets.filter(a => a.type === 'image')
  }, [assets])

  const filteredBuiltInStickers = useMemo(() => {
    if (selectedCategory === 'custom') return []
    return STICKER_DEFINITIONS.filter(sticker => {
      if (selectedCategory === 'animated') {
        if (!sticker.isAnimated) return false
      } else if (selectedCategory !== 'all' && sticker.category !== selectedCategory) {
        return false
      }
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      const localizedName = t(`library.stickers.items.${sticker.id}` as any)
      return (
        sticker.name.toLowerCase().includes(q) ||
        (localizedName && localizedName.toLowerCase().includes(q)) ||
        sticker.id.toLowerCase().includes(q) ||
        sticker.keywords.some(k => k.toLowerCase().includes(q))
      )
    })
  }, [selectedCategory, searchQuery, t])

  const filteredCustomStickers = useMemo(() => {
    if (selectedCategory === 'animated') {
      return customStickers.filter(a => {
        const isAnim = a.path.toLowerCase().endsWith('.gif') || a.path.toLowerCase().endsWith('.webp')
        if (!isAnim) return false
        if (!searchQuery.trim()) return true
        const q = searchQuery.toLowerCase().trim()
        const name = a.path.split(/[/\\]/).pop() || a.id
        return name.toLowerCase().includes(q) || (a.prompt && a.prompt.toLowerCase().includes(q))
      })
    }
    if (selectedCategory !== 'all' && selectedCategory !== 'custom') return []
    return customStickers.filter(a => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      const name = a.path.split(/[/\\]/).pop() || a.id
      return name.toLowerCase().includes(q) || (a.prompt && a.prompt.toLowerCase().includes(q))
    })
  }, [customStickers, selectedCategory, searchQuery])

  const handleAddBuiltIn = (stickerId: string) => {
    actions.addStickerClip({ stickerId })
  }

  const handleAddCustom = (asset: Asset) => {
    actions.addStickerClip({
      stickerId: asset.id,
      imagePath: asset.path,
    })
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && importFiles) {
      await importFiles(files)
      setSelectedCategory('custom')
    }
    e.target.value = ''
  }

  const totalResults = filteredBuiltInStickers.length + filteredCustomStickers.length

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header controls: Search & Import */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder={t('library.stickers.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[6px] bg-zinc-900 border border-zinc-800 py-1.5 pl-8 pr-7 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/webp,image/svg+xml,image/jpeg"
          className="hidden"
          onChange={handleFileInput}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title={t('library.stickers.importHint')}
          className="flex items-center gap-1.5 rounded-[6px] bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 border border-zinc-700/60 hover:bg-zinc-700 transition-colors shrink-0"
        >
          <Upload className="h-3.5 w-3.5 text-accent" />
          <span>{t('library.stickers.importBtn')}</span>
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-1.5 pb-1 border-b border-zinc-800/60">
        {STICKER_CATEGORIES.map(cat => {
          const isSelected = selectedCategory === cat.id
          const count = cat.id === 'all'
            ? STICKER_DEFINITIONS.length + customStickers.length
            : cat.id === 'custom'
              ? customStickers.length
              : cat.id === 'animated'
                ? STICKER_DEFINITIONS.filter(s => s.isAnimated).length + customStickers.filter(a => a.path.toLowerCase().endsWith('.gif') || a.path.toLowerCase().endsWith('.webp')).length
                : STICKER_DEFINITIONS.filter(s => s.category === cat.id).length

          const categoryLabel = t(`library.stickers.categories.${cat.id}` as any) || cat.label

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isSelected
                  ? 'bg-accent text-zinc-950 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              {categoryLabel} {count > 0 && <span className="text-[10px] opacity-75">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Stickers Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {totalResults === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-zinc-500">
            <Sparkles className="h-8 w-8 text-zinc-600" />
            <p className="text-[12px] font-medium text-zinc-400">{t('library.stickers.notFound')}</p>
            <p className="text-[11px] text-zinc-600 max-w-[200px]">
              {selectedCategory === 'custom'
                ? t('library.stickers.emptyCustomHint')
                : t('library.stickers.emptySearchHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Built-in Stickers */}
            {filteredBuiltInStickers.length > 0 && (
              <div>
                {selectedCategory === 'all' && customStickers.length > 0 && (
                  <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('library.stickers.builtIn')}
                  </h4>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {filteredBuiltInStickers.map(sticker => {
                    const stickerName = t(`library.stickers.items.${sticker.id}` as any) || sticker.name
                    return (
                      <div
                        key={sticker.id}
                        onClick={() => handleAddBuiltIn(sticker.id)}
                        title={`${stickerName} - ${t('library.stickers.clickToAdd')}`}
                        className="group relative flex flex-col items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5 hover:border-accent/60 hover:bg-zinc-800/90 transition-all cursor-pointer shadow-sm"
                      >
                        {sticker.isAnimated && (
                          <div className="absolute left-1.5 top-1.5 rounded bg-accent/20 border border-accent/40 px-1 py-0.5 text-[8px] font-bold text-accent uppercase tracking-wider leading-none select-none">
                            GIF
                          </div>
                        )}
                        <div className="flex h-14 w-14 items-center justify-center">
                          <img
                            src={`/stickers/${sticker.filename}`}
                            alt={stickerName}
                            className="max-h-12 max-w-12 object-contain filter drop-shadow-md group-hover:scale-110 transition-transform duration-150"
                            loading="lazy"
                          />
                        </div>
                        <span className="mt-1 w-full truncate text-center text-[10px] text-zinc-400 group-hover:text-zinc-200">
                          {stickerName}
                        </span>
                        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-zinc-950 opacity-0 shadow transition-opacity group-hover:opacity-100">
                          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Custom Imported Stickers */}
            {filteredCustomStickers.length > 0 && (
              <div>
                {selectedCategory === 'all' && (
                  <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    {t('library.stickers.imported', { count: filteredCustomStickers.length })}
                  </h4>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {filteredCustomStickers.map(asset => {
                    const name = asset.path.split(/[/\\]/).pop() || asset.id
                    const isAnim = asset.path.toLowerCase().endsWith('.gif') || asset.path.toLowerCase().endsWith('.webp')
                    return (
                      <div
                        key={asset.id}
                        onClick={() => handleAddCustom(asset)}
                        title={`${name} - ${t('library.stickers.clickToAdd')}`}
                        className="group relative flex flex-col items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5 hover:border-accent/60 hover:bg-zinc-800/90 transition-all cursor-pointer shadow-sm"
                      >
                        {isAnim && (
                          <div className="absolute left-1.5 top-1.5 rounded bg-accent/20 border border-accent/40 px-1 py-0.5 text-[8px] font-bold text-accent uppercase tracking-wider leading-none select-none">
                            GIF
                          </div>
                        )}
                        <div className="flex h-14 w-14 items-center justify-center">
                          <img
                            src={pathToFileUrl(asset.smallThumbnailPath || asset.path)}
                            alt={name}
                            className="max-h-12 max-w-12 object-contain filter drop-shadow-md group-hover:scale-110 transition-transform duration-150"
                            loading="lazy"
                          />
                        </div>
                        <span className="mt-1 w-full truncate text-center text-[10px] text-zinc-400 group-hover:text-zinc-200">
                          {name}
                        </span>
                        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-zinc-950 opacity-0 shadow transition-opacity group-hover:opacity-100">
                          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
