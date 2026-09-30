import type { TimelineCoverTextItem } from '@core/project-model'
import type { CoverElement } from './types'

export type CoverCategory = 'all' | 'custom' | 'recommended' | 'vlog' | 'travel' | 'fashion' | 'daily' | 'cinema'

export interface CoverTemplate {
  id: string
  name: string
  category: CoverCategory
  previewGradient?: string
  previewThumbnail?: string
  overlayBadge?: string
  hasLetterbox?: boolean
  texts: TimelineCoverTextItem[]
  elements?: CoverElement[]
  isCustom?: boolean
  createdAt?: number
}

export const COVER_CATEGORIES: { id: CoverCategory; labelKey: string; fallbackLabel: string }[] = [
  { id: 'all', labelKey: 'cover.catAll', fallbackLabel: 'All' },
  { id: 'custom', labelKey: 'cover.catCustom', fallbackLabel: '⭐ My Templates' },
  { id: 'recommended', labelKey: 'cover.catRecommended', fallbackLabel: 'Recommended' },
  { id: 'vlog', labelKey: 'cover.catVlog', fallbackLabel: 'Vlog' },
  { id: 'travel', labelKey: 'cover.catTravel', fallbackLabel: 'Travel' },
  { id: 'fashion', labelKey: 'cover.catFashion', fallbackLabel: 'Fashion' },
  { id: 'daily', labelKey: 'cover.catDaily', fallbackLabel: 'Daily' },
  { id: 'cinema', labelKey: 'cover.catCinema', fallbackLabel: 'Cinema' },
]

const CUSTOM_TEMPLATES_STORAGE_KEY = 'kailaedit_cover_custom_templates'

export function getCustomTemplates(): CoverTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as CoverTemplate[]
  } catch (e) {
    console.error('[getCustomTemplates] Failed to parse custom templates:', e)
    return []
  }
}

export function saveCustomTemplate(template: CoverTemplate): CoverTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const current = getCustomTemplates()
    const updated = [template, ...current.filter(t => t.id !== template.id)]
    localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated))
    return updated
  } catch (e) {
    console.error('[saveCustomTemplate] Failed to save custom template:', e)
    return getCustomTemplates()
  }
}

export function deleteCustomTemplate(templateId: string): CoverTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const current = getCustomTemplates()
    const updated = current.filter(t => t.id !== templateId)
    localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated))
    return updated
  } catch (e) {
    console.error('[deleteCustomTemplate] Failed to delete custom template:', e)
    return getCustomTemplates()
  }
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  {
    id: 'bookish-weekend',
    name: 'Bookish Weekend',
    category: 'recommended',
    previewGradient: 'from-amber-950/80 via-yellow-950/40 to-black/80',
    overlayBadge: 'WEEKEND VIBE',
    texts: [
      {
        id: 'txt-1',
        text: 'BOOKISH',
        x: 50,
        y: 22,
        fontFamily: 'serif',
        fontSize: 38,
        fontWeight: '900',
        color: '#facc15',
        textAlign: 'center',
        letterSpacing: 2,
        textTransform: 'uppercase',
        shadow: '0 4px 12px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-2',
        text: 'WEEKEND',
        x: 50,
        y: 31,
        fontFamily: 'serif',
        fontSize: 34,
        fontWeight: '900',
        color: '#fef08a',
        textAlign: 'center',
        letterSpacing: 4,
        textTransform: 'uppercase',
        shadow: '0 4px 12px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-3',
        text: '✧ reading coffee & cozy moments ✧',
        x: 50,
        y: 84,
        fontFamily: 'sans-serif',
        fontSize: 13,
        fontWeight: '500',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.5)',
        textAlign: 'center',
        letterSpacing: 1,
      },
    ],
  },
  {
    id: 'another-vlog',
    name: 'Another Vlog',
    category: 'recommended',
    previewGradient: 'from-zinc-900/60 via-transparent to-black/90',
    texts: [
      {
        id: 'txt-1',
        text: 'another',
        x: 50,
        y: 68,
        fontFamily: 'cursive',
        fontSize: 38,
        fontWeight: '400',
        fontStyle: 'italic',
        color: '#ffffff',
        textAlign: 'center',
        shadow: '0 2px 10px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-2',
        text: 'vlog...',
        x: 50,
        y: 76,
        fontFamily: 'cursive',
        fontSize: 44,
        fontWeight: '400',
        fontStyle: 'italic',
        color: '#f4f4f5',
        textAlign: 'center',
        shadow: '0 2px 10px rgba(0,0,0,0.9)',
      },
    ],
  },
  {
    id: 'studio-days',
    name: 'Studio Days',
    category: 'recommended',
    previewGradient: 'from-amber-900/40 via-transparent to-zinc-950/80',
    texts: [
      {
        id: 'txt-1',
        text: 'HOLLY',
        x: 50,
        y: 18,
        fontFamily: 'serif',
        fontSize: 28,
        fontWeight: '800',
        color: '#fdba74',
        textAlign: 'center',
        letterSpacing: 3,
        shadow: '0 2px 8px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-2',
        text: 'STUDIO',
        x: 50,
        y: 26,
        fontFamily: 'serif',
        fontSize: 36,
        fontWeight: '900',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 2,
        shadow: '0 4px 12px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-3',
        text: 'DAYS',
        x: 50,
        y: 35,
        fontFamily: 'serif',
        fontSize: 40,
        fontWeight: '900',
        color: '#fed7aa',
        textAlign: 'center',
        letterSpacing: 4,
        shadow: '0 4px 14px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-4',
        text: 'my simple moments',
        x: 50,
        y: 86,
        fontFamily: 'cursive',
        fontSize: 16,
        color: '#ffffff',
        textAlign: 'center',
        shadow: '0 2px 8px rgba(0,0,0,0.9)',
      },
    ],
  },
  {
    id: 'ootd-vlog',
    name: 'OOTD Vlog',
    category: 'fashion',
    previewGradient: 'from-rose-950/40 via-transparent to-black/80',
    texts: [
      {
        id: 'txt-1',
        text: 'Ootd',
        x: 50,
        y: 22,
        fontFamily: 'serif',
        fontSize: 36,
        fontWeight: '800',
        color: '#fb7185',
        textAlign: 'center',
        shadow: '0 2px 10px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-2',
        text: 'Vlog',
        x: 50,
        y: 31,
        fontFamily: 'cursive',
        fontSize: 32,
        fontWeight: '600',
        color: '#fecdd3',
        textAlign: 'center',
        shadow: '0 2px 8px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-3',
        text: '✧ my new lookbook ✧',
        x: 50,
        y: 84,
        fontFamily: 'sans-serif',
        fontSize: 12,
        fontWeight: '600',
        color: '#ffffff',
        textAlign: 'center',
        backgroundColor: 'rgba(244,63,94,0.3)',
        letterSpacing: 2,
      },
    ],
  },
  {
    id: 'amazing-sound-4k',
    name: 'Cyber 4K UHD',
    category: 'cinema',
    previewGradient: 'from-cyan-950/60 via-transparent to-black/90',
    texts: [
      {
        id: 'txt-1',
        text: 'AMAZING',
        x: 50,
        y: 18,
        fontFamily: 'sans-serif',
        fontSize: 32,
        fontWeight: '900',
        color: '#38bdf8',
        textAlign: 'center',
        letterSpacing: 3,
        stroke: '#0369a1',
        strokeWidth: 2,
        shadow: '0 0 15px rgba(56,189,248,0.7)',
      },
      {
        id: 'txt-2',
        text: 'SOUND SCENES',
        x: 50,
        y: 26,
        fontFamily: 'sans-serif',
        fontSize: 22,
        fontWeight: '800',
        color: '#facc15',
        textAlign: 'center',
        letterSpacing: 2,
        shadow: '0 0 12px rgba(250,204,21,0.6)',
      },
      {
        id: 'txt-3',
        text: '4K UHD • 60 FPS',
        x: 50,
        y: 88,
        fontFamily: 'sans-serif',
        fontSize: 12,
        fontWeight: '700',
        color: '#000000',
        backgroundColor: '#38bdf8',
        textAlign: 'center',
        letterSpacing: 1,
      },
    ],
  },
  {
    id: 'just-normal-day',
    name: 'Normal Day',
    category: 'daily',
    previewGradient: 'from-zinc-900/30 via-transparent to-black/70',
    texts: [
      {
        id: 'txt-1',
        text: 'Just a normal day',
        x: 50,
        y: 78,
        fontFamily: 'sans-serif',
        fontSize: 18,
        fontWeight: '700',
        color: '#0f172a',
        backgroundColor: '#ffffff',
        textAlign: 'center',
        letterSpacing: 0.5,
      },
      {
        id: 'txt-2',
        text: 'in the city center',
        x: 50,
        y: 85,
        fontFamily: 'sans-serif',
        fontSize: 13,
        fontWeight: '500',
        color: '#ffffff',
        textAlign: 'center',
        shadow: '0 2px 8px rgba(0,0,0,0.8)',
      },
    ],
  },
  {
    id: 'travel-diary',
    name: 'Travel Diary',
    category: 'travel',
    previewGradient: 'from-emerald-950/40 via-transparent to-black/80',
    texts: [
      {
        id: 'txt-1',
        text: 'TRAVEL',
        x: 50,
        y: 20,
        fontFamily: 'sans-serif',
        fontSize: 34,
        fontWeight: '900',
        color: '#34d399',
        textAlign: 'center',
        letterSpacing: 4,
        textTransform: 'uppercase',
        shadow: '0 4px 12px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-2',
        text: 'DIARY',
        x: 50,
        y: 29,
        fontFamily: 'sans-serif',
        fontSize: 30,
        fontWeight: '800',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 6,
        textTransform: 'uppercase',
        shadow: '0 4px 12px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-3',
        text: 'EXPLORE THE UNKNOWN',
        x: 50,
        y: 86,
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: '700',
        color: '#000000',
        backgroundColor: '#34d399',
        textAlign: 'center',
        letterSpacing: 2,
      },
    ],
  },
  {
    id: 'summer-vibe',
    name: 'Summer Vibe',
    category: 'travel',
    previewGradient: 'from-orange-950/50 via-transparent to-black/80',
    texts: [
      {
        id: 'txt-1',
        text: 'SUMMER',
        x: 50,
        y: 22,
        fontFamily: 'sans-serif',
        fontSize: 36,
        fontWeight: '900',
        color: '#fb923c',
        textAlign: 'center',
        letterSpacing: 3,
        shadow: '0 4px 14px rgba(251,146,60,0.4), 0 2px 8px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-2',
        text: 'VIBE',
        x: 50,
        y: 31,
        fontFamily: 'sans-serif',
        fontSize: 32,
        fontWeight: '900',
        color: '#fef08a',
        textAlign: 'center',
        letterSpacing: 4,
        shadow: '0 4px 14px rgba(0,0,0,0.9)',
      },
      {
        id: 'txt-3',
        text: 'SUNSET BEACH • 16:45 PM',
        x: 50,
        y: 85,
        fontFamily: 'sans-serif',
        fontSize: 12,
        fontWeight: '600',
        color: '#ffffff',
        textAlign: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
        letterSpacing: 1.5,
      },
    ],
  },
  {
    id: 'minimalist-editorial',
    name: 'Minimalist Daily',
    category: 'fashion',
    previewGradient: 'from-zinc-900/50 via-transparent to-black/80',
    texts: [
      {
        id: 'txt-1',
        text: 'EDITORIAL',
        x: 50,
        y: 24,
        fontFamily: 'serif',
        fontSize: 20,
        fontWeight: '400',
        color: '#e4e4e7',
        textAlign: 'center',
        letterSpacing: 8,
        textTransform: 'uppercase',
      },
      {
        id: 'txt-2',
        text: 'MINIMAL',
        x: 50,
        y: 32,
        fontFamily: 'serif',
        fontSize: 40,
        fontWeight: '700',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 3,
        shadow: '0 4px 16px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-3',
        text: 'VOL. 04 — AUTUMN ISSUE',
        x: 50,
        y: 86,
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: '600',
        color: '#d4d4d8',
        textAlign: 'center',
        letterSpacing: 3,
      },
    ],
  },
  {
    id: 'cafe-moments',
    name: 'Cafe Moments',
    category: 'vlog',
    previewGradient: 'from-stone-900/40 via-transparent to-black/80',
    texts: [
      {
        id: 'txt-1',
        text: 'coffee & calm',
        x: 50,
        y: 25,
        fontFamily: 'cursive',
        fontSize: 34,
        fontWeight: '400',
        fontStyle: 'italic',
        color: '#fed7aa',
        textAlign: 'center',
        shadow: '0 2px 10px rgba(0,0,0,0.8)',
      },
      {
        id: 'txt-2',
        text: 'DAILY BITES',
        x: 50,
        y: 34,
        fontFamily: 'sans-serif',
        fontSize: 22,
        fontWeight: '800',
        color: '#ffffff',
        textAlign: 'center',
        letterSpacing: 4,
        shadow: '0 2px 10px rgba(0,0,0,0.9)',
      },
    ],
  },
  {
    id: 'cinematic-story',
    name: 'Cinematic Story',
    category: 'cinema',
    previewGradient: 'from-black/70 via-transparent to-black/80',
    hasLetterbox: true,
    texts: [
      {
        id: 'txt-1',
        text: 'THE JOURNEY',
        x: 50,
        y: 48,
        fontFamily: 'serif',
        fontSize: 36,
        fontWeight: '700',
        color: '#f4f4f5',
        textAlign: 'center',
        letterSpacing: 6,
        shadow: '0 4px 20px rgba(0,0,0,0.95)',
      },
      {
        id: 'txt-2',
        text: 'A FILM BY KAILA EDIT',
        x: 50,
        y: 56,
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: '600',
        color: '#a1a1aa',
        textAlign: 'center',
        letterSpacing: 4,
      },
    ],
  },
]
