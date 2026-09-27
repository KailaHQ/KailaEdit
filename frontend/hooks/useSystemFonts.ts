import { useEffect, useState } from 'react'

export interface FontOption {
  name: string
  value: string
}

export const DEFAULT_EDITOR_FONTS: FontOption[] = [
  { name: 'Inter', value: 'Inter, sans-serif' },
  { name: 'Roboto', value: 'Roboto, sans-serif' },
  { name: 'Montserrat', value: 'Montserrat, sans-serif' },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Playfair Display', value: 'Playfair Display, serif' },
  { name: 'Merriweather', value: 'Merriweather, serif' },
  { name: 'Lora', value: 'Lora, serif' },
  { name: 'Caveat', value: 'Caveat, cursive' },
  { name: 'Dancing Script', value: 'Dancing Script, cursive' },
  { name: 'Pacifico', value: 'Pacifico, cursive' },
  { name: 'Courier Prime', value: 'Courier Prime, monospace' },
  { name: 'Fira Code', value: 'Fira Code, monospace' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Helvetica', value: 'Helvetica, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Times New Roman', value: 'Times New Roman, serif' },
  { name: 'Courier New', value: 'Courier New, monospace' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Comic Sans MS', value: 'Comic Sans MS, cursive' },
  { name: 'Segoe UI', value: 'Segoe UI, sans-serif' },
  { name: 'Tahoma', value: 'Tahoma, sans-serif' },
]

let globalCachedFonts: FontOption[] | null = null
let pendingFontsPromise: Promise<FontOption[]> | null = null

async function fetchSystemFontOptions(): Promise<FontOption[]> {
  if (globalCachedFonts) return globalCachedFonts

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api || typeof api.getSystemFonts !== 'function') {
    return DEFAULT_EDITOR_FONTS
  }

  try {
    const res = await api.getSystemFonts()
    if (res?.fonts && Array.isArray(res.fonts) && res.fonts.length > 0) {
      // Map discovered system fonts into FontOption items
      const map = new Map<string, FontOption>()

      // Prepopulate standard fonts first
      for (const f of DEFAULT_EDITOR_FONTS) {
        map.set(f.name.toLowerCase(), f)
      }

      for (const fontName of res.fonts) {
        const cleanName = fontName.trim()
        if (!cleanName) continue
        const key = cleanName.toLowerCase()
        if (!map.has(key)) {
          // If font name contains spaces, quote it for CSS fontFamily
          const cssValue = cleanName.includes(' ') ? `"${cleanName}", sans-serif` : `${cleanName}, sans-serif`
          map.set(key, {
            name: cleanName,
            value: cssValue,
          })
        }
      }

      // Sort alphanumeric fonts first, push dot-prefixed (.Vnxxx) and symbol-prefixed fonts to the bottom
      const all = Array.from(map.values()).sort((a, b) => {
        const isSpecialA = /^[^a-zA-Z0-9]/.test(a.name)
        const isSpecialB = /^[^a-zA-Z0-9]/.test(b.name)
        if (isSpecialA && !isSpecialB) return 1
        if (!isSpecialA && isSpecialB) return -1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
      globalCachedFonts = all
      return all
    }
  } catch (err) {
    console.warn('[useSystemFonts] Failed to fetch system fonts:', err)
  }

  return DEFAULT_EDITOR_FONTS
}

export function useSystemFonts() {
  const [fonts, setFonts] = useState<FontOption[]>(globalCachedFonts || DEFAULT_EDITOR_FONTS)
  const [loading, setLoading] = useState<boolean>(!globalCachedFonts)

  useEffect(() => {
    if (globalCachedFonts) {
      setFonts(globalCachedFonts)
      setLoading(false)
      return
    }

    if (!pendingFontsPromise) {
      pendingFontsPromise = fetchSystemFontOptions()
    }

    let isMounted = true
    pendingFontsPromise
      .then(result => {
        if (isMounted) {
          setFonts(result)
          setLoading(false)
        }
      })
      .catch(() => {
        if (isMounted) {
          setFonts(DEFAULT_EDITOR_FONTS)
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  return { fonts, loading }
}
