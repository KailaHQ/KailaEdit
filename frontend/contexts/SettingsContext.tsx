import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  migrateAppSettings,
} from '../../shared/app-settings-schema'
import { useTranslation } from '../i18n/I18nContext'

export type SettingsTab = 'draft' | 'edit' | 'performance' | 'general' | 'speech'

interface SettingsContextType {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
  resetSettings: () => void
  isSettingsOpen: boolean
  activeTab: SettingsTab
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setActiveTab: (tab: SettingsTab) => void
}

const SETTINGS_STORAGE_KEY = 'komfyedit_app_settings'

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { setLanguage } = useTranslation()

  const [settings, setSettingsState] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
      const langStored = localStorage.getItem('komfyedit_language')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (langStored === 'en' || langStored === 'vi') {
          parsed.language = langStored
        }
        return migrateAppSettings(parsed)
      } else if (langStored === 'en' || langStored === 'vi') {
        return migrateAppSettings({ language: langStored })
      }
    } catch {}
    return DEFAULT_APP_SETTINGS
  })

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('draft')

  // Keep i18n language in sync with settings
  useEffect(() => {
    if (settings.language) {
      setLanguage(settings.language)
    }
  }, [settings.language, setLanguage])

  // Query default system project path if not set
  useEffect(() => {
    if (!settings.projectsDir && window.electronAPI?.getProjectsDir) {
      window.electronAPI.getProjectsDir().then(res => {
        if (res?.path) {
          setSettingsState(prev => {
            if (prev.projectsDir) return prev
            const next = { ...prev, projectsDir: res.path }
            try {
              localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
            } catch {}
            return next
          })
        }
      }).catch(() => {})
    }
  }, [settings.projectsDir])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch }
      if (patch.language) {
        setLanguage(patch.language)
      }
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [setLanguage])

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_APP_SETTINGS)
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY)
    } catch {}
  }, [])

  const openSettings = useCallback((tab?: SettingsTab) => {
    if (tab) setActiveTab(tab)
    setIsSettingsOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  const value = useMemo(() => ({
    settings,
    updateSettings,
    resetSettings,
    isSettingsOpen,
    activeTab,
    openSettings,
    closeSettings,
    setActiveTab,
  }), [
    settings,
    updateSettings,
    resetSettings,
    isSettingsOpen,
    activeTab,
    openSettings,
    closeSettings,
  ])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return ctx
}
