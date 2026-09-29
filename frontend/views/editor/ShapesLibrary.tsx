import { useState, useMemo } from 'react'
import { Search, X, Shapes, Plus } from 'lucide-react'
import { COVER_SHAPES, type CoverShapeDef } from './cover/cover-shapes'
import { useTranslation } from '../../i18n/I18nContext'
import { useEditorActions } from './editor-store'

export type ShapeCategory = 'all' | 'line' | 'basic'

export function ShapesLibrary() {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const [selectedCategory, setSelectedCategory] = useState<ShapeCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const categories: { id: ShapeCategory; label: string }[] = useMemo(() => [
    { id: 'all', label: t('library.shapes.categories.all' as any) || 'Tất cả' },
    { id: 'line', label: t('library.shapes.categories.line' as any) || 'Đường kẻ & Mũi tên' },
    { id: 'basic', label: t('library.shapes.categories.basic' as any) || 'Hình cơ bản' },
  ], [t])

  const filteredShapes = useMemo(() => {
    return COVER_SHAPES.filter(shape => {
      if (selectedCategory !== 'all' && shape.category !== selectedCategory) {
        return false
      }
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      return shape.name.toLowerCase().includes(q) || shape.id.toLowerCase().includes(q)
    })
  }, [selectedCategory, searchQuery])

  const handleAddShape = (shape: CoverShapeDef) => {
    actions.addStickerClip({
      stickerId: `shape-${shape.id}`,
      imagePath: `stickers/shape-${shape.id}.png`,
      shapeProperties: {
        fillColor: shape.defaultFill,
        strokeColor: shape.defaultStroke,
        strokeWidth: shape.defaultStrokeWidth,
        strokeDasharray: shape.defaultStrokeDasharray,
        sides: shape.defaultSides,
        cornerRounding: shape.defaultCornerRounding,
      },
    })
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Search Header */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
        <input
          type="text"
          placeholder={t('library.shapes.searchPlaceholder' as any) || 'Tìm hình khối...'}
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

      {/* Category Pills */}
      <div className="flex flex-wrap gap-1.5 pb-1 border-b border-zinc-800/60">
        {categories.map(cat => {
          const isSelected = selectedCategory === cat.id
          const count = cat.id === 'all'
            ? COVER_SHAPES.length
            : COVER_SHAPES.filter(s => s.category === cat.id).length

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
              {cat.label} <span className="text-[10px] opacity-75">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Shapes Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredShapes.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-zinc-500">
            <Shapes className="h-8 w-8 text-zinc-600" />
            <p className="text-[12px] font-medium text-zinc-400">
              {t('library.shapes.notFound' as any) || 'Không tìm thấy hình khối'}
            </p>
            <p className="text-[11px] text-zinc-600 max-w-[200px]">
              {t('library.shapes.emptySearchHint' as any) || 'Thử tìm kiếm với từ khóa khác.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filteredShapes.map(shape => {
              return (
                <div
                  key={shape.id}
                  onClick={() => handleAddShape(shape)}
                  title={`${shape.name} - ${t('library.shapes.clickToAdd' as any) || 'Bấm để thêm vào timeline'}`}
                  className="group relative flex flex-col items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5 hover:border-accent/60 hover:bg-zinc-800/90 transition-all cursor-pointer shadow-sm"
                >
                  <div className="flex h-14 w-14 items-center justify-center">
                    <div className="flex h-11 w-11 items-center justify-center transition-transform duration-150 group-hover:scale-110">
                      <svg
                        viewBox={shape.viewBox}
                        className="w-full h-full overflow-visible"
                        preserveAspectRatio={shape.category === 'line' ? 'none' : 'xMidYMid meet'}
                      >
                        {shape.renderSvg(
                          shape.defaultFill === 'transparent' ? 'transparent' : '#e4e4e7',
                          '#e4e4e7',
                          shape.defaultStrokeWidth || (shape.category === 'line' ? 5 : 3),
                          shape.defaultSides,
                          shape.defaultCornerRounding
                        )}
                      </svg>
                    </div>
                  </div>
                  <span className="mt-1 w-full truncate text-center text-[10px] text-zinc-400 group-hover:text-zinc-200">
                    {shape.name}
                  </span>
                  <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-zinc-950 opacity-0 shadow transition-opacity group-hover:opacity-100">
                    <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
