import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check, Star } from 'lucide-react'
import { useSystemFonts, type FontOption } from '@/hooks/useSystemFonts'
import { useTranslation } from '../../i18n/I18nContext'

export interface FontPickerProps {
  value: string
  onChange: (value: string, fontName: string) => void
  variant?: 'compact' | 'pill'
  className?: string
  buttonClassName?: string
  dropdownAlign?: 'left' | 'right'
}

const STARRED_FONTS_STORAGE_KEY = 'kailaedit_starred_fonts'

function getStoredStarredFonts(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STARRED_FONTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredStarredFonts(fonts: string[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STARRED_FONTS_STORAGE_KEY, JSON.stringify(fonts))
  } catch (err) {
    console.warn('[FontPicker] Failed to save starred fonts:', err)
  }
}

const POPULAR_FONT_KEYWORDS = [
  'inter',
  'roboto',
  'arial',
  'segoe ui',
  'montserrat',
  'times new roman',
  'open sans',
  'tahoma',
  'verdana',
  'calibri',
  'helvetica',
  'georgia',
  'playfair display',
  'oswald',
  'impact',
  'courier new',
  'fira code',
  'comic sans ms',
]

export const FontPicker: React.FC<FontPickerProps> = ({
  value,
  onChange,
  variant = 'compact',
  className = '',
  buttonClassName = '',
  dropdownAlign = 'left',
}) => {
  const { t } = useTranslation()
  const { fonts } = useSystemFonts()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [starredKeys, setStarredKeys] = useState<string[]>(() => getStoredStarredFonts())
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const toggleStar = (fontName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const key = fontName.toLowerCase()
    setStarredKeys(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [key, ...prev]
      saveStoredStarredFonts(next)
      return next
    })
  }

  // Find the exact single selected font option from the available fonts list
  const selectedFont = useMemo(() => {
    if (!value) return null
    const valTrimmed = value.trim()
    const valLower = valTrimmed.toLowerCase()

    // 1. Direct match on f.value (case-insensitive)
    const exactValueMatch = fonts.find(f => f.value.toLowerCase() === valLower)
    if (exactValueMatch) return exactValueMatch

    // 2. Direct match on f.name
    const exactNameMatch = fonts.find(f => f.name.toLowerCase() === valLower)
    if (exactNameMatch) return exactNameMatch

    // 3. Primary token match: e.g. '"Segoe UI", sans-serif' -> 'segoe ui'
    const firstPart = valTrimmed.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    const cleanFirstPart = firstPart
      .replace(/\s*\((sans|serif|script|mono|cursive|monospace)\)/i, '')
      .trim()
      .toLowerCase()

    if (cleanFirstPart) {
      const tokenMatch = fonts.find(f => {
        const cleanName = f.name
          .replace(/\s*\((sans|serif|script|mono|cursive|monospace)\)/i, '')
          .trim()
          .toLowerCase()
        return cleanName === cleanFirstPart || f.value.toLowerCase() === cleanFirstPart
      })
      if (tokenMatch) return tokenMatch
    }

    return null
  }, [value, fonts])

  // Clean font name for display on the trigger button
  const currentFontName = useMemo(() => {
    if (selectedFont) return selectedFont.name
    if (!value) return 'Font'
    const firstPart = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    return firstPart || value
  }, [selectedFont, value])

  // Filtered fonts when searching (starred matches prioritized to top)
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.trim().toLowerCase()
    const starredSet = new Set(starredKeys.map(k => k.toLowerCase()))
    const matches = fonts.filter(f => f.name.toLowerCase().includes(q))
    return matches.sort((a, b) => {
      const aStarred = starredSet.has(a.name.toLowerCase())
      const bStarred = starredSet.has(b.name.toLowerCase())
      if (aStarred && !bStarred) return -1
      if (!aStarred && bStarred) return 1
      return 0
    })
  }, [fonts, search, starredKeys])

  // Separated Starred vs Popular vs Other system fonts when not searching
  const { starredFonts, popularFonts, otherFonts } = useMemo(() => {
    const starred: FontOption[] = []
    const popular: FontOption[] = []
    const others: FontOption[] = []

    const starredSet = new Set(starredKeys.map(k => k.toLowerCase()))
    const popularSet = new Set<string>()

    // 1. Starred fonts at the top (in the user's starring order)
    for (const key of starredKeys) {
      const match = fonts.find(f => f.name.toLowerCase() === key)
      if (match && !starred.some(s => s.name.toLowerCase() === key)) {
        starred.push(match)
      }
    }

    // 2. Popular & system fonts (excluding any that are starred to avoid duplicate items)
    for (const f of fonts) {
      const lower = f.name.toLowerCase()
      if (starredSet.has(lower)) {
        continue
      }

      const isPopular = POPULAR_FONT_KEYWORDS.includes(lower)
      if (isPopular && !popularSet.has(lower)) {
        popular.push(f)
        popularSet.add(lower)
      } else {
        others.push(f)
      }
    }

    return { starredFonts: starred, popularFonts: popular, otherFonts: others }
  }, [fonts, starredKeys])

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [isOpen])

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }, [isOpen])

  const handleSelect = (font: FontOption) => {
    onChange(font.value, font.name)
    setIsOpen(false)
    setSearch('')
  }

  const renderFontItem = (f: FontOption, activeColorClass: string) => {
    // Strictly only ONE font can ever be selected
    const isSelected = selectedFont
      ? f === selectedFont ||
        (f.name.toLowerCase() === selectedFont.name.toLowerCase() &&
          f.value.toLowerCase() === selectedFont.value.toLowerCase())
      : f.name.toLowerCase() === currentFontName.toLowerCase()

    const isStarred = starredKeys.includes(f.name.toLowerCase())

    return (
      <button
        key={f.value + f.name}
        type="button"
        onClick={() => handleSelect(f)}
        className={`w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-800 flex items-center justify-between transition-colors group ${
          isSelected ? `${activeColorClass} font-bold bg-zinc-800/80` : 'text-zinc-300'
        }`}
      >
        <span className="truncate text-xs flex-1 mr-2" style={{ fontFamily: f.value }}>
          {f.name}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Star Toggle Button */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => toggleStar(f.name, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleStar(f.name, e as any)
              }
            }}
            className={`p-0.5 rounded hover:bg-zinc-700/60 transition-colors cursor-pointer ${
              isStarred
                ? 'text-amber-400'
                : 'text-zinc-600 hover:text-amber-300 opacity-40 group-hover:opacity-100'
            }`}
            title={isStarred ? (t('font.unfavorite') || 'Unfavorite') : (t('font.favorite') || 'Favorite (Star)')}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                isStarred ? 'fill-amber-400 text-amber-400' : ''
              }`}
            />
          </span>

          {/* Checkmark for active single selection */}
          {isSelected ? (
            <Check className={`h-3.5 w-3.5 ${activeColorClass} flex-shrink-0`} />
          ) : (
            <div className="w-3.5 h-3.5 flex-shrink-0" />
          )}
        </div>
      </button>
    )
  }

  if (variant === 'pill') {
    return (
      <div ref={containerRef} className={`relative inline-block ${className}`}>
        <button
          type="button"
          onClick={() => {
            setIsOpen(prev => !prev)
            setSearch('')
          }}
          className={`h-8 px-2.5 rounded-full hover:bg-zinc-800 flex items-center gap-2 max-w-[140px] transition-colors text-zinc-200 select-none ${buttonClassName}`}
          title={`Font: ${currentFontName}`}
        >
          <span className="truncate font-medium text-xs" style={{ fontFamily: value }}>
            {currentFontName}
          </span>
          <ChevronDown className="h-3 w-3 text-zinc-400 flex-shrink-0" />
        </button>

        {isOpen && (
          <div
            className={`absolute top-10 ${
              dropdownAlign === 'right' ? 'right-0' : 'left-0'
            } w-64 max-h-80 flex flex-col bg-[#18181b] border border-zinc-700/80 rounded-2xl shadow-2xl shadow-black/80 z-50 text-zinc-200 backdrop-blur-md overflow-hidden`}
          >
            {/* Search header */}
            <div className="p-2 border-b border-zinc-800 bg-[#18181b] flex-shrink-0 flex items-center gap-1.5 px-3">
              <Search className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search fonts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-transparent text-xs text-white placeholder-zinc-500 outline-none"
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1 max-h-64">
              {searchResults ? (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Search Results ({searchResults.length})
                  </div>
                  {searchResults.slice(0, 300).map(f => renderFontItem(f, 'text-sky-400'))}
                  {searchResults.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-zinc-500">
                      No font matching &quot;{search}&quot;
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Starred Group */}
                  {starredFonts.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wider bg-zinc-900/80 sticky top-0 flex items-center gap-1.5 z-10">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span>Starred ({starredFonts.length})</span>
                      </div>
                      {starredFonts.map(f => renderFontItem(f, 'text-sky-400'))}
                    </>
                  )}

                  {/* Popular Group */}
                  {popularFonts.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold text-sky-400 uppercase tracking-wider bg-zinc-900/60 sticky top-0 border-t border-zinc-800/60">
                        Popular & Recommended
                      </div>
                      {popularFonts.map(f => renderFontItem(f, 'text-sky-400'))}
                    </>
                  )}

                  {/* All System Fonts Group */}
                  <div className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-900/60 sticky top-0 border-t border-zinc-800 mt-1">
                    System Fonts ({otherFonts.length})
                  </div>
                  {otherFonts.slice(0, 300).map(f => renderFontItem(f, 'text-sky-400'))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Compact variant for Inspector/Properties panel
  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev)
          setSearch('')
        }}
        className={`bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-cyan-500/50 flex items-center justify-between gap-1.5 max-w-[150px] min-w-[110px] transition-colors ${buttonClassName}`}
        title={`Font: ${currentFontName}`}
      >
        <span className="truncate text-left flex-1" style={{ fontFamily: value }}>
          {currentFontName}
        </span>
        <ChevronDown className="h-3 w-3 text-zinc-400 flex-shrink-0" />
      </button>

      {isOpen && (
        <div
          className={`absolute top-full mt-1 ${
            dropdownAlign === 'right' ? 'right-0' : 'left-0'
          } w-60 max-h-72 flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl shadow-black/80 z-50 text-zinc-200 overflow-hidden`}
        >
          {/* Search box */}
          <div className="p-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0 flex items-center gap-1.5 px-2.5">
            <Search className="h-3 w-3 text-zinc-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search fonts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent text-[11px] text-white placeholder-zinc-500 outline-none"
            />
          </div>

          {/* Font options */}
          <div className="flex-1 overflow-y-auto py-1 max-h-56">
            {searchResults ? (
              <>
                <div className="px-2.5 py-1 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Search Results ({searchResults.length})
                </div>
                {searchResults.slice(0, 300).map(f => renderFontItem(f, 'text-cyan-400'))}
                {searchResults.length === 0 && (
                  <div className="px-3 py-3 text-center text-[10px] text-zinc-500">
                    No fonts found
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Starred Group */}
                {starredFonts.length > 0 && (
                  <>
                    <div className="px-2.5 py-1 text-[9px] font-semibold text-amber-400 uppercase tracking-wider bg-zinc-950/90 sticky top-0 flex items-center gap-1 z-10">
                      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                      <span>Starred ({starredFonts.length})</span>
                    </div>
                    {starredFonts.map(f => renderFontItem(f, 'text-cyan-400'))}
                  </>
                )}

                {/* Popular Group */}
                {popularFonts.length > 0 && (
                  <>
                    <div className="px-2.5 py-1 text-[9px] font-semibold text-cyan-400 uppercase tracking-wider bg-zinc-950/80 sticky top-0 border-t border-zinc-800/60">
                      Popular Fonts
                    </div>
                    {popularFonts.map(f => renderFontItem(f, 'text-cyan-400'))}
                  </>
                )}

                {/* All System Fonts */}
                <div className="px-2.5 py-1 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-950/80 sticky top-0 border-t border-zinc-800 mt-1">
                  System Fonts ({otherFonts.length})
                </div>
                {otherFonts.slice(0, 300).map(f => renderFontItem(f, 'text-cyan-400'))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
