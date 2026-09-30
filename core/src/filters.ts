/**
 * 3D LUT Filter definitions and catalogue.
 * Pure TypeScript: zero dependencies on DOM, React, or Electron.
 */

export type FilterCategory = 'all' | 'cinematic' | 'film' | 'vintage' | 'bw' | 'creative' | 'retro'

export interface FilterDefinition {
  id: string
  name: string
  category: Exclude<FilterCategory, 'all'>
  lutFile: string
  description: string
  defaultIntensity: number
  author?: string
}

export interface FilterCategoryInfo {
  id: FilterCategory
  nameEn: string
  nameVi: string
}

export const FILTER_CATEGORIES: readonly FilterCategoryInfo[] = [
  { id: 'all', nameEn: 'All', nameVi: 'Tất cả' },
  { id: 'cinematic', nameEn: 'Cinematic', nameVi: 'Điện ảnh' },
  { id: 'film', nameEn: 'Film', nameVi: 'Màu phim' },
  { id: 'vintage', nameEn: 'Vintage', nameVi: 'Cổ điển' },
  { id: 'bw', nameEn: 'Black & White', nameVi: 'Trắng đen' },
  { id: 'creative', nameEn: 'Creative', nameVi: 'Sáng tạo' },
  { id: 'retro', nameEn: 'Retro', nameVi: 'Hoài niệm' },
] as const

export const FILTER_REGISTRY: readonly FilterDefinition[] = [
  {
    id: 'cine-teal-orange',
    name: 'Cine Teal & Orange',
    category: 'cinematic',
    lutFile: 'cine-teal-orange.cube',
    description: 'Classic Hollywood look with warm skin tones against cool teal shadows',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'film-classic',
    name: 'Film Classic',
    category: 'film',
    lutFile: 'film-classic.cube',
    description: 'Timeless Kodak film look with warm highlights and subtle greenish shadows',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'vintage-kodachrome',
    name: 'Vintage Kodachrome',
    category: 'vintage',
    lutFile: 'vintage-kodachrome.cube',
    description: 'Vibrant 1970s nostalgia with rich contrast and deep reds',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'noir-bw',
    name: 'Noir B&W',
    category: 'bw',
    lutFile: 'noir-bw.cube',
    description: 'High contrast black and white with deep dark tones in classic Film Noir style',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    category: 'creative',
    lutFile: 'cyber-neon.cube',
    description: 'Futuristic cyberpunk neon tones featuring violet, pink, and cyan highlights',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    category: 'film',
    lutFile: 'golden-hour.cube',
    description: 'Soft golden sunset warmth with rich amber highlights',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'moody-forest',
    name: 'Moody Forest',
    category: 'creative',
    lutFile: 'moody-forest.cube',
    description: 'Deep moss green tones with muted saturation and mysterious shadows for nature scenes',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'retro-90s',
    name: 'Retro 90s',
    category: 'retro',
    lutFile: 'retro-90s.cube',
    description: '1990s VHS and CRT TV color palette with soft highlights and nostalgic nostalgia',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    category: 'cinematic',
    lutFile: 'bleach-bypass.cube',
    description: 'High-contrast silver-retention look with desaturated colors and dramatic impact',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'warm-sunset',
    name: 'Warm Sunset',
    category: 'film',
    lutFile: 'warm-sunset.cube',
    description: 'Romantic warm glow with diffused orange-pink highlights and shadows',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'cold-winter',
    name: 'Cold Winter',
    category: 'creative',
    lutFile: 'cold-winter.cube',
    description: 'Crisp winter atmosphere with clean, cool ice-blue tones',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
  {
    id: 'pastel-dream',
    name: 'Pastel Dream',
    category: 'vintage',
    lutFile: 'pastel-dream.cube',
    description: 'Dreamy pastel tones with soft highlights in anime and aesthetic style',
    defaultIntensity: 100,
    author: 'KomfyEdit',
  },
]

export const FILTER_DEFINITIONS = FILTER_REGISTRY

export function getFilterDefinition(id: string): FilterDefinition | undefined {
  return FILTER_REGISTRY.find(f => f.id === id)
}

export function getAllFilters(): readonly FilterDefinition[] {
  return FILTER_REGISTRY
}

export function getFiltersByCategory(category: FilterCategory): readonly FilterDefinition[] {
  if (category === 'all') return FILTER_REGISTRY
  return FILTER_REGISTRY.filter(f => f.category === category)
}
