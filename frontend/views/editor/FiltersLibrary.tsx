import React, { useCallback, useMemo, useState } from 'react'
import { Check, GripVertical, Plus, Search, Star, X } from 'lucide-react'
import {
  FILTER_REGISTRY,
  FILTER_CATEGORIES,
  type FilterCategory,
  type FilterDefinition,
} from '@core/filters'
import { selectClips, selectSelectedClipIds } from './editor-selectors'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { useTranslation } from '../../i18n/I18nContext'

const FAVORITES_STORAGE_KEY = 'komfyedit-filter-favorites'

const FILTER_SWATCHES: Record<string, string> = {
  'cine-teal-orange': 'linear-gradient(135deg, #0d3b66 0%, #16262e 40%, #f4a261 100%)',
  'film-classic': 'linear-gradient(135deg, #2b2d42 0%, #d4a373 50%, #fefae0 100%)',
  'vintage-kodachrome': 'linear-gradient(135deg, #d90429 0%, #ffb703 50%, #023047 100%)',
  'noir-bw': 'linear-gradient(135deg, #050505 0%, #52525b 50%, #f4f4f5 100%)',
  'cyber-neon': 'linear-gradient(135deg, #7209b7 0%, #f72585 50%, #4cc9f0 100%)',
  'golden-hour': 'linear-gradient(135deg, #b04112 0%, #e76f51 40%, #e9c46a 100%)',
  'moody-forest': 'linear-gradient(135deg, #132a13 0%, #31572c 50%, #90a955 100%)',
  'retro-90s': 'linear-gradient(135deg, #3d348b 0%, #7678ed 40%, #f7b801 100%)',
  'bleach-bypass': 'linear-gradient(135deg, #18181b 0%, #71717a 50%, #e4e4e7 100%)',
  'warm-sunset': 'linear-gradient(135deg, #581845 0%, #c70039 45%, #ffc300 100%)',
  'cold-winter': 'linear-gradient(135deg, #03045e 0%, #0077b6 50%, #caf0f8 100%)',
  'pastel-dream': 'linear-gradient(135deg, #ffb5a7 0%, #fcd5ce 40%, #b8bedd 100%)',
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // ignore
  }
  return new Set()
}

function saveFavorites(favs: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favs)))
  } catch {
    // ignore
  }
}

export function FiltersLibrary() {
  const { t, language } = useTranslation()
  const actions = useEditorActions()
  const getState = useEditorGetState()
  const selectedClipIds = useEditorStore(selectSelectedClipIds)

  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())
  const [notice, setNotice] = useState<string | null>(null)

  const toggleFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveFavorites(next)
      return next
    })
  }, [])

  // Add as an adjustment filter layer on top, or switch filter on currently selected adjustment clip
  const applyFilter = useCallback((filter: FilterDefinition, forceNewTrack = false) => {
    const state = getState()
    const currentSelectedIds = Array.from(selectSelectedClipIds(state))
    const clips = selectClips(state)

    // If an adjustment/filter clip is explicitly selected and not forcing new track: update its filter
    if (!forceNewTrack && currentSelectedIds.length === 1) {
      const selectedClip = clips.find(c => c.id === currentSelectedIds[0])
      if (selectedClip && selectedClip.type === 'adjustment') {
        actions.updateClip(selectedClip.id, {
          filter: {
            id: filter.id,
            intensity: filter.defaultIntensity,
          },
          importedName: `Filter: ${filter.name}`,
        })
        setNotice(null)
        return
      }
    }

    // Default: add a filter clip on the topmost overlay layer
    actions.addFilterClip({
      filterId: filter.id,
      intensity: filter.defaultIntensity,
      name: filter.name,
      startTime: 0,
    })
    setNotice(null)
  }, [actions, getState])

  // Get currently active filter from selected clip
  const currentSelectedFilterId = useMemo(() => {
    const state = getState()
    const firstSelectedId = Array.from(selectedClipIds)[0]
    if (!firstSelectedId) return null
    const clip = selectClips(state).find(c => c.id === firstSelectedId)
    return clip?.filter?.id ?? null
  }, [getState, selectedClipIds])

  // Filtered items
  const displayedFilters = useMemo(() => {
    return FILTER_REGISTRY.filter(filter => {
      if (showOnlyFavorites && !favorites.has(filter.id)) return false
      if (activeCategory !== 'all' && filter.category !== activeCategory) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const nameMatch = filter.name.toLowerCase().includes(q)
        const descMatch = filter.description.toLowerCase().includes(q)
        const categoryMatch = filter.category.toLowerCase().includes(q)
        if (!nameMatch && !descMatch && !categoryMatch) return false
      }
      return true
    })
  }, [activeCategory, favorites, searchQuery, showOnlyFavorites])

  return (
    <div className="flex h-full flex-col select-none">
      {/* Search Bar */}
      <div className="relative mb-2.5 flex-shrink-0">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('filters.searchPlaceholder')}
          className="w-full rounded-[6px] bg-zinc-900/90 pl-8 pr-7 py-1.5 text-[11.5px] text-zinc-200 placeholder-zinc-500 border border-zinc-800/80 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
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

      {/* Categories & Favorites toggle */}
      <div className="mb-3 flex flex-wrap items-center gap-1 flex-shrink-0">
        <button
          onClick={() => setShowOnlyFavorites(prev => !prev)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium transition-colors ${
            showOnlyFavorites
              ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
              : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
          title={t('filters.favorites')}
        >
          <Star className={`h-3 w-3 ${showOnlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`} />
          <span>{t('filters.favorites')}</span>
        </button>

        <div className="h-3 w-[1px] bg-zinc-800 mx-0.5" />

        {FILTER_CATEGORIES.map(cat => {
          const isActive = !showOnlyFavorites && activeCategory === cat.id
          const label = language === 'vi' ? cat.nameVi : cat.nameEn
          return (
            <button
              key={cat.id}
              onClick={() => {
                setShowOnlyFavorites(false)
                setActiveCategory(cat.id)
              }}
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium transition-colors ${
                isActive
                  ? 'bg-zinc-200 text-zinc-900 font-semibold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Notice bar */}
      {notice && (
        <p className="mb-2 flex-shrink-0 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200 animate-fadeIn">
          {notice}
        </p>
      )}

      {/* Grid of Filters */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {displayedFilters.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <p className="text-zinc-500 text-[11.5px]">{t('filters.noResults')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {displayedFilters.map(filter => {
              const isCurrent = currentSelectedFilterId === filter.id
              const isFav = favorites.has(filter.id)
              const swatch = FILTER_SWATCHES[filter.id] ?? 'linear-gradient(135deg, #27272a, #3f3f46)'

              return (
                <div
                  key={filter.id}
                  draggable={true}
                  onDragStart={e => {
                    e.dataTransfer.setData('filterId', filter.id)
                    e.dataTransfer.setData('application/x-komfyedit-filter', filter.id)
                    e.dataTransfer.setData('text/plain', filter.id)
                    e.dataTransfer.effectAllowed = 'copy'
                    window.dispatchEvent(new CustomEvent('komfyedit:filter-drag-start', { detail: { id: filter.id } }))
                  }}
                  onDragEnd={() => {
                    window.dispatchEvent(new CustomEvent('komfyedit:filter-drag-end'))
                  }}
                  onClick={() => applyFilter(filter)}
                  className={`group relative flex flex-col gap-1 rounded-[6px] p-1 text-left transition-all cursor-grab active:cursor-grabbing ${
                    isCurrent
                      ? 'bg-teal-500/15 ring-1 ring-teal-500/70'
                      : 'hover:bg-zinc-900/90 ring-1 ring-white/5 hover:ring-zinc-700'
                  }`}
                  title={`${filter.name} — ${filter.description}`}
                >
                  {/* Thumbnail Card */}
                  <div className="relative h-[66px] w-full overflow-hidden rounded-[5px] shadow-sm border border-black/30">
                    {/* Visual tone gradient */}
                    <div
                      className="absolute inset-0 transition-transform duration-300 group-hover:scale-105"
                      style={{ background: swatch }}
                    />

                    {/* Subtle decorative split to represent before/after grade */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

                    {/* Drag grip icon on hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 left-1 p-0.5 rounded bg-black/60 text-zinc-300 pointer-events-none">
                      <GripVertical className="h-2.5 w-2.5" />
                    </div>

                    {/* Favorite star */}
                    <button
                      onClick={e => toggleFavorite(filter.id, e)}
                      className={`absolute top-1 right-1 p-1 rounded-full transition-colors ${
                        isFav
                          ? 'bg-black/70 text-amber-400'
                          : 'bg-black/40 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-amber-300'
                      }`}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star className={`h-2.5 w-2.5 ${isFav ? 'fill-amber-400' : ''}`} />
                    </button>

                    {/* Quick Apply Button on Hover */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        applyFilter(filter, true)
                      }}
                      className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-zinc-950 opacity-0 shadow-md transition-all group-hover:opacity-100 hover:scale-110 hover:bg-white"
                      title={t('filters.applied')}
                    >
                      <Plus className="h-3 w-3 stroke-[2.5]" />
                    </button>

                    {/* Active check indicator */}
                    {isCurrent && (
                      <span className="absolute left-1 bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-teal-400 text-zinc-950 shadow">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Filter Name */}
                  <span className="truncate text-[10.5px] font-medium text-zinc-300 group-hover:text-white px-0.5">
                    {filter.name}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
