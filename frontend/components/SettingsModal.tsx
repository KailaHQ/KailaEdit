import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useSettings, type SettingsTab } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n/I18nContext'
import type { AppSettings } from '../../shared/app-settings-schema'
import { useProxyStore } from '../views/editor/proxy-store'
import { SettingsDraftTab } from './settings/SettingsDraftTab'
import { SettingsEditTab } from './settings/SettingsEditTab'
import { SettingsPerformanceTab } from './settings/SettingsPerformanceTab'
import { SettingsGeneralTab } from './settings/SettingsGeneralTab'
import { SettingsSpeechTab } from './settings/SettingsSpeechTab'

export function SettingsModal() {
  const {
    isSettingsOpen,
    closeSettings,
    settings,
    updateSettings,
    activeTab,
    setActiveTab,
  } = useSettings()

  const { t, setLanguage } = useTranslation()

  // Local state for draft settings (only applied when clicking "Save")
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [cacheSizeStr, setCacheSizeStr] = useState<string>('0 B')
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheFeedback, setCacheFeedback] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  const [hwEncoderInfo, setHwEncoderInfo] = useState<string | null>(null)
  const [matteDeviceInfo, setMatteDeviceInfo] = useState<{
    available: string[]
    preferred: string
    gpuAvailable: boolean
  } | null>(null)

  // Speech (Whisper) states
  const [testingWhisper, setTestingWhisper] = useState(false)
  const [whisperTestFeedback, setWhisperTestFeedback] = useState<{
    success: boolean
    message: string
    models?: string[]
  } | null>(null)
  const [secureKeyInfo, setSecureKeyInfo] = useState<{
    hasKey: boolean
    maskedKey?: string
    isEncrypted: boolean
  } | null>(null)
  // AI Analysis (LLM) states
  const [testingLlm, setTestingLlm] = useState(false)
  const [llmTestFeedback, setLlmTestFeedback] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [secureLlmKeyInfo, setSecureLlmKeyInfo] = useState<{
    hasKey: boolean
    maskedKey?: string
    isEncrypted: boolean
  } | null>(null)

  // Re-sync draft whenever modal opens or settings change externally
  useEffect(() => {
    if (isSettingsOpen) {
      setDraft(settings)
      setCacheFeedback(null)

      // Query hardware encoder capabilities
      if (window.electronAPI?.getHardwareEncoderCapabilities) {
        window.electronAPI.getHardwareEncoderCapabilities({}).then(res => {
          if (res?.preferredEncoderDisplayName) {
            setHwEncoderInfo(res.preferredEncoderDisplayName)
          }
        }).catch(() => {})
      }

      // Ask which processors can actually run background removal on this machine. This
      // loads the model once per provider, so it is only done when the dialog opens.
      if (window.electronAPI?.matteGetDeviceInfo) {
        window.electronAPI.matteGetDeviceInfo({}).then(res => {
          if (res) setMatteDeviceInfo({ available: res.available, preferred: res.preferred, gpuAvailable: res.gpuAvailable })
        }).catch(() => {})
      }

      // Query cache size
      if (window.electronAPI?.getCacheInfo) {
        window.electronAPI.getCacheInfo().then(res => {
          if (res?.formattedSize) setCacheSizeStr(res.formattedSize)
        }).catch(() => {})
      }

      // Enumerate audio output devices if supported
      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          const outputs = devices
            .filter(d => d.kind === 'audiooutput')
            .map((d, index) => ({
              deviceId: d.deviceId,
              label: d.label || `Speaker / Output ${index + 1}`,
            }))
          if (outputs.length > 0) {
            setAudioDevices(outputs)
          }
        }).catch(() => {})
      }

      // Query secure key status
      if (window.electronAPI?.whisperGetSecureKey) {
        window.electronAPI.whisperGetSecureKey().then(res => {
          setSecureKeyInfo(res)
        }).catch(() => {})
      }

      // Query LLM secure key status
      if (window.electronAPI?.llmGetSecureKey) {
        window.electronAPI.llmGetSecureKey().then(res => {
          setSecureLlmKeyInfo(res)
        }).catch(() => {})
      }
    }
  }, [isSettingsOpen, settings])

  const handleTestWhisper = useCallback(async () => {
    if (!window.electronAPI?.whisperTestConnection) return
    setTestingWhisper(true)
    setWhisperTestFeedback(null)
    try {
      const res = await window.electronAPI.whisperTestConnection({
        endpoint: draft.whisperEndpoint,
        apiKey: draft.whisperApiKey,
      })
      if (res.success) {
        setWhisperTestFeedback({
          success: true,
          message: res.message || t('settings.speech.connectedSuccess'),
          models: res.models,
        })
      } else {
        setWhisperTestFeedback({
          success: false,
          message: res.error || 'Connection failed',
        })
      }
    } catch (err) {
      setWhisperTestFeedback({
        success: false,
        message: String(err),
      })
    } finally {
      setTestingWhisper(false)
    }
  }, [draft.whisperEndpoint, draft.whisperApiKey, t])

  const handleTestLlm = useCallback(async () => {
    if (!window.electronAPI?.llmTestConnection) return
    setTestingLlm(true)
    setLlmTestFeedback(null)
    try {
      const res = await window.electronAPI.llmTestConnection({
        endpoint: draft.llmEndpoint,
        apiKey: draft.llmApiKey,
        model: draft.llmModel,
      })
      if (res.success) {
        setLlmTestFeedback({
          success: true,
          message: res.message || t('settings.llm.connectedSuccess'),
        })
      } else {
        setLlmTestFeedback({
          success: false,
          message: res.error || 'Connection failed',
        })
      }
    } catch (err) {
      setLlmTestFeedback({
        success: false,
        message: String(err),
      })
    } finally {
      setTestingLlm(false)
    }
  }, [draft.llmEndpoint, draft.llmApiKey, draft.llmModel, t])

  const handleBrowseProjectsDir = useCallback(async () => {
    if (!window.electronAPI?.showOpenDirectoryDialog) return
    try {
      const dir = await window.electronAPI.showOpenDirectoryDialog({
        title: t('settings.draft.saveLocation'),
      })
      if (dir) {
        setDraft(prev => ({ ...prev, projectsDir: dir }))
      }
    } catch (err) {
      console.error('[SettingsModal] Folder dialog failed:', err)
    }
  }, [t])

  const handleBrowseExportDir = useCallback(async () => {
    if (!window.electronAPI?.showOpenDirectoryDialog) return
    try {
      const dir = await window.electronAPI.showOpenDirectoryDialog({
        title: t('settings.draft.downloadLocation'),
      })
      if (dir) {
        setDraft(prev => ({ ...prev, defaultExportDir: dir }))
      }
    } catch (err) {
      console.error('[SettingsModal] Folder dialog failed:', err)
    }
  }, [t])

  const handleClearCache = useCallback(async () => {
    if (!window.electronAPI?.clearCache) return
    setClearingCache(true)
    setCacheFeedback(null)
    try {
      const res = await window.electronAPI.clearCache()
      if (res.success) {
        useProxyStore.getState().clearAll()
        const freed = res.freedBytes < 1024 * 1024
          ? `${(res.freedBytes / 1024).toFixed(1)} KB`
          : `${(res.freedBytes / (1024 * 1024)).toFixed(2)} MB`
        setCacheSizeStr('0 B')
        setCacheFeedback(t('settings.draft.cacheCleared', { freed }))
      } else {
        setCacheFeedback(t('settings.draft.cacheClearFailed', { error: res.error || '' }))
      }
    } catch (err) {
      setCacheFeedback(t('settings.draft.cacheClearFailed', { error: String(err) }))
    } finally {
      setClearingCache(false)
    }
  }, [t])

  const handleSave = () => {
    if (window.electronAPI?.whisperSaveSecureKey && draft.whisperApiKey !== undefined) {
      window.electronAPI.whisperSaveSecureKey({ apiKey: draft.whisperApiKey }).catch(() => {})
    }
    if (window.electronAPI?.llmSaveSecureKey && draft.llmApiKey !== undefined) {
      window.electronAPI.llmSaveSecureKey({ apiKey: draft.llmApiKey }).catch(() => {})
    }
    updateSettings(draft)
    if (draft.language) {
      setLanguage(draft.language)
    }
    closeSettings()
  }

  const handleCancel = () => {
    if (settings.language) {
      setLanguage(settings.language)
    }
    closeSettings()
  }

  if (!isSettingsOpen) return null

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'draft', label: t('settings.tabs.draft') },
    { id: 'edit', label: t('settings.tabs.edit') },
    { id: 'performance', label: t('settings.tabs.performance') },
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'speech', label: t('settings.tabs.speech') },
  ]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none"
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel() }}
    >
      <div className="w-[560px] max-h-[85vh] bg-zinc-900 rounded-2xl border border-zinc-700/80 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white tracking-wide">
            {t('settings.title')}
          </h2>
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab pill navigation */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-2 border-b border-zinc-800/80 bg-zinc-950/40">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-1.5 px-3 rounded-lg text-[13px] font-medium transition-colors text-center ${
                activeTab === tab.id
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-[13px] text-zinc-200 space-y-6 min-h-[340px] max-h-[500px]">
          {activeTab === 'draft' && (
            <SettingsDraftTab
              draft={draft}
              setDraft={setDraft}
              handleBrowseProjectsDir={handleBrowseProjectsDir}
              handleBrowseExportDir={handleBrowseExportDir}
              cacheSizeStr={cacheSizeStr}
              handleClearCache={handleClearCache}
              clearingCache={clearingCache}
              cacheFeedback={cacheFeedback}
            />
          )}

          {activeTab === 'edit' && (
            <SettingsEditTab
              draft={draft}
              setDraft={setDraft}
            />
          )}

          {activeTab === 'performance' && (
            <SettingsPerformanceTab
              draft={draft}
              setDraft={setDraft}
              hwEncoderInfo={hwEncoderInfo}
              matteDeviceInfo={matteDeviceInfo}
              audioDevices={audioDevices}
            />
          )}

          {activeTab === 'general' && (
            <SettingsGeneralTab
              draft={draft}
              setDraft={setDraft}
              setLanguage={setLanguage}
            />
          )}

          {activeTab === 'speech' && (
            <SettingsSpeechTab
              draft={draft}
              setDraft={setDraft}
              testingWhisper={testingWhisper}
              whisperTestFeedback={whisperTestFeedback}
              handleTestWhisper={handleTestWhisper}
              secureKeyInfo={secureKeyInfo}
              testingLlm={testingLlm}
              llmTestFeedback={llmTestFeedback}
              handleTestLlm={handleTestLlm}
              secureLlmKeyInfo={secureLlmKeyInfo}
            />
          )}
        </div>

        {/* Footer actions: Save & Cancel */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-950/70">
          <button
            onClick={handleCancel}
            className="px-6 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-8 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 text-xs font-semibold transition-colors shadow-lg shadow-teal-500/20"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
