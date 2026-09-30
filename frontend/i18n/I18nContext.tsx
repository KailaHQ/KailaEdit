import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { en } from './locales/en'
import { vi } from './locales/vi'
import type { AppLanguage } from '../../shared/app-settings-schema'

interface I18nContextType {
  language: AppLanguage
  setLanguage: (lang: AppLanguage) => void
  t: (path: string, params?: Record<string, string | number>) => string
}

const STORAGE_KEY = 'kailaedit_language'
const LEGACY_STORAGE_KEY = 'komfyedit_language'

const dictionaries: Record<AppLanguage, Record<string, any>> = {
  en,
  vi,
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({
  children,
  initialLanguage = 'en',
}: {
  children: React.ReactNode
  initialLanguage?: AppLanguage
}) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
      if (stored === 'en' || stored === 'vi') return stored
      const appSettingsStr = localStorage.getItem('kailaedit_app_settings') || localStorage.getItem('komfyedit_app_settings')
      if (appSettingsStr) {
        const parsed = JSON.parse(appSettingsStr)
        if (parsed.language === 'en' || parsed.language === 'vi') return parsed.language
      }
    } catch {}
    return initialLanguage
  })

  const setLanguage = useCallback((lang: AppLanguage) => {
    setLanguageState(lang)
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {}
  }, [])

  const t = useCallback((path: string, params?: Record<string, string | number>): string => {
    const keys = path.split('.')
    
    // 1. Try current language
    let current: any = dictionaries[language]
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        current = undefined
        break
      }
    }

    // 2. Fallback to English if not found
    if (typeof current !== 'string') {
      let fallback: any = dictionaries.en
      for (const key of keys) {
        if (fallback && typeof fallback === 'object' && key in fallback) {
          fallback = fallback[key]
        } else {
          fallback = undefined
          break
        }
      }
      current = typeof fallback === 'string' ? fallback : path
    }

    // 3. Interpolate params {name} -> value
    if (typeof current === 'string' && params) {
      return current.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
    }

    return typeof current === 'string' ? current : path
  }, [language])

  const value = useMemo(() => ({
    language,
    setLanguage,
    t,
  }), [language, setLanguage, t])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return {
      language: 'en' as AppLanguage,
      setLanguage: () => {},
      t: (path: string, params?: Record<string, string | number>): string => {
        let current: any = dictionaries.en
        const keys = path.split('.')
        for (const key of keys) {
          if (current && typeof current === 'object' && key in current) {
            current = current[key]
          } else {
            current = undefined
            break
          }
        }
        if (typeof current === 'string' && params) {
          return current.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
        }
        return typeof current === 'string' ? current : path
      },
    }
  }
  return ctx
}

export const useI18n = useTranslation
