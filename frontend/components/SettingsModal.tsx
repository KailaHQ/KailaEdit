import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Folder,
  Trash2,
  Check,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useSettings, type SettingsTab } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n/I18nContext'
import type { AppSettings } from '../../shared/app-settings-schema'
import { useProxyStore } from '../views/editor/proxy-store'

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
  const [showApiKey, setShowApiKey] = useState(false)
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
  const [showLlmApiKey, setShowLlmApiKey] = useState(false)
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
    } catch {}
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
    } catch {}
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
          {/* TAB 1: DRAFT */}
          {activeTab === 'draft' && (
            <div className="space-y-5">
              {/* Project Save Location */}
              <div className="flex items-center justify-between gap-4">
                <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.saveLocation')}</span>
                <div className="flex-1 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="flex-1 truncate text-xs text-zinc-400 font-mono" title={draft.projectsDir}>
                    {draft.projectsDir || 'Default AppData/Projects'}
                  </span>
                  <button
                    onClick={handleBrowseProjectsDir}
                    className="p-1 text-zinc-400 hover:text-white transition-colors"
                    title={t('common.browse')}
                  >
                    <Folder className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Screen recording / Export Path */}
              <div className="flex items-center justify-between gap-4">
                <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.downloadLocation')}</span>
                <div className="flex-1 flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="flex-1 truncate text-xs text-zinc-400 font-mono" title={draft.defaultExportDir}>
                    {draft.defaultExportDir || 'Default User Downloads'}
                  </span>
                  <button
                    onClick={handleBrowseExportDir}
                    className="p-1 text-zinc-400 hover:text-white transition-colors"
                    title={t('common.browse')}
                  >
                    <Folder className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Cache policy radio */}
              <div className="pt-2 border-t border-zinc-800/80">
                <div className="flex items-start gap-4 mb-3">
                  <span className="w-28 text-zinc-300 font-medium pt-1">{t('settings.draft.cachePolicy')}</span>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="cachePolicy"
                        checked={draft.cachePolicy === 'keep'}
                        onChange={() => setDraft(p => ({ ...p, cachePolicy: 'keep' }))}
                        className="accent-teal-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-zinc-300 text-xs">{t('settings.draft.cachePolicyKeep')}</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="cachePolicy"
                        checked={draft.cachePolicy === 'auto-30-days'}
                        onChange={() => setDraft(p => ({ ...p, cachePolicy: 'auto-30-days' }))}
                        className="accent-teal-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-zinc-300 text-xs">{t('settings.draft.cachePolicyAuto30')}</span>
                    </label>
                  </div>
                </div>

                {/* Cache size & clear */}
                <div className="flex items-center justify-between gap-4 pt-2">
                  <span className="w-28 text-zinc-300 font-medium">{t('settings.draft.cacheSize')}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 font-mono">{cacheSizeStr}</span>
                    <button
                      onClick={handleClearCache}
                      disabled={clearingCache}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors disabled:opacity-50"
                      title={t('settings.draft.clearCache')}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      {t('settings.draft.clearCache')}
                    </button>
                  </div>
                </div>
                {cacheFeedback && (
                  <p className="text-[11px] text-teal-400 mt-2 pl-32">{cacheFeedback}</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: EDIT */}
          {activeTab === 'edit' && (
            <div className="space-y-5">
              {/* Default Image Duration */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.imageDuration')}</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={draft.defaultImageDuration}
                    onChange={(e) => setDraft(p => ({ ...p, defaultImageDuration: parseFloat(e.target.value) }))}
                    className="w-32 accent-teal-500 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-300 font-mono w-14 text-right">
                    {draft.defaultImageDuration.toFixed(1)} {t('settings.edit.seconds')}
                  </span>
                </div>
              </div>

              {/* Default Transition Duration */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.transitionDuration')}</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={draft.defaultTransitionDuration}
                    onChange={(e) => setDraft(p => ({ ...p, defaultTransitionDuration: parseFloat(e.target.value) }))}
                    className="w-32 accent-teal-500 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-300 font-mono w-14 text-right">
                    {draft.defaultTransitionDuration.toFixed(1)} {t('settings.edit.seconds')}
                  </span>
                </div>
              </div>

              {/* Default Frame Rate */}
              <div className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-800/80">
                <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.frameRate')}</span>
                <select
                  value={draft.defaultFps}
                  onChange={(e) => setDraft(p => ({ ...p, defaultFps: parseInt(e.target.value, 10) }))}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
                >
                  <option value={24}>24 fps</option>
                  <option value={25}>25 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>

              {/* Timecode format */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-300 font-medium flex-1">{t('settings.edit.timecode')}</span>
                <select
                  value={draft.timecodeFormat}
                  onChange={(e) => setDraft(p => ({ ...p, timecodeFormat: e.target.value as any }))}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
                >
                  <option value="timecode">{t('settings.edit.timecodeFormat')}</option>
                  <option value="frames">{t('settings.edit.framesFormat')}</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 3: PERFORMANCE */}
          {activeTab === 'performance' && (
            <div className="space-y-5">
              {/* Hardware encoding & decoding */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                  {t('settings.performance.hardwareAccel')}
                </span>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.hardwareAcceleration}
                      onChange={(e) => setDraft(p => ({ ...p, hardwareAcceleration: e.target.checked }))}
                      className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
                    />
                    <span className="text-zinc-300 text-xs">{t('settings.performance.hardwareEncode')}</span>
                  </label>
                  {hwEncoderInfo && (
                    <span className="text-[11px] text-zinc-500 ml-6 pl-0.5">
                      {draft.hardwareAcceleration ? t('settings.performance.device', { info: hwEncoderInfo }) : t('settings.performance.hardwareAccelerationDisabled')}
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.hardwareDecode}
                    onChange={(e) => setDraft(p => ({ ...p, hardwareDecode: e.target.checked }))}
                    className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-zinc-300 text-xs">{t('settings.performance.hardwareDecode')}</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.gpuUiRendering}
                    onChange={(e) => setDraft(p => ({ ...p, gpuUiRendering: e.target.checked }))}
                    className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-zinc-300 text-xs">{t('settings.performance.gpuRendering')}</span>
                </label>
              </div>

              {/* Background removal device */}
              <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                  {t('settings.performance.matteDevice')}
                </span>
                <div className="flex gap-1.5">
                  {(['auto', 'gpu', 'cpu'] as const).map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, autoMatteDevice: opt }))}
                      disabled={opt === 'gpu' && matteDeviceInfo != null && !matteDeviceInfo.gpuAvailable}
                      className={`flex-1 px-2 py-1.5 text-xs rounded border transition-colors ${
                        draft.autoMatteDevice === opt
                          ? 'bg-teal-500/15 border-teal-500 text-teal-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 disabled:opacity-40 disabled:hover:border-zinc-800 disabled:cursor-not-allowed'
                      }`}
                    >
                      {t(`settings.performance.matteDevice${opt === 'auto' ? 'Auto' : opt === 'gpu' ? 'Gpu' : 'Cpu'}`)}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {matteDeviceInfo == null
                    ? t('settings.performance.matteDeviceChecking')
                    : matteDeviceInfo.gpuAvailable
                      ? t('settings.performance.matteDeviceFound', { provider: matteDeviceInfo.preferred.toUpperCase() })
                      : t('settings.performance.matteDeviceNone')}
                </p>
              </div>

              {/* Proxy mode */}
              <div className="pt-3 border-t border-zinc-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-zinc-300">{t('settings.performance.proxy')}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.proxyEnabled}
                      onChange={(e) => setDraft(p => ({ ...p, proxyEnabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                  </label>
                </div>
                <p className="text-[11px] text-zinc-500">{t('settings.performance.proxyDesc')}</p>
              </div>

              {/* Audio output device */}
              <div className="pt-3 border-t border-zinc-800/80">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-300 font-medium flex-1">{t('settings.performance.audioOutput')}</span>
                  <select
                    value={draft.audioOutputDeviceId}
                    onChange={(e) => setDraft(p => ({ ...p, audioOutputDeviceId: e.target.value }))}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-500 max-w-[240px] truncate cursor-pointer"
                  >
                    <option value="default">{t('common.default')}</option>
                    {audioDevices.map(dev => (
                      <option key={dev.deviceId} value={dev.deviceId}>
                        {dev.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: GENERAL (CHUNG) */}
          {activeTab === 'general' && (
            <div className="space-y-5">
              {/* Language list */}
              <div>
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2.5">
                  {t('settings.general.language')}
                </span>
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-900">
                  <button
                    onClick={() => {
                      setDraft(p => ({ ...p, language: 'en' }))
                      setLanguage('en')
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors ${
                      draft.language === 'en'
                        ? 'bg-zinc-800/80 text-white font-medium'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <span>English (Default)</span>
                    {draft.language === 'en' && <Check className="h-4 w-4 text-teal-400" />}
                  </button>
                  <button
                    onClick={() => {
                      setDraft(p => ({ ...p, language: 'vi' }))
                      setLanguage('vi')
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors ${
                      draft.language === 'vi'
                        ? 'bg-zinc-800/80 text-white font-medium'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <span>Tiếng Việt</span>
                    {draft.language === 'vi' && <Check className="h-4 w-4 text-teal-400" />}
                  </button>
                </div>
              </div>

              {/* Auto Save Settings */}
              <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">{t('settings.general.autoSave')}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.autoSave}
                      onChange={(e) => setDraft(p => ({ ...p, autoSave: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                  </label>
                </div>
                {draft.autoSave && (
                  <div className="flex items-center justify-between gap-4 pl-2">
                    <span className="text-zinc-400 text-xs">{t('settings.general.autoSaveInterval')}</span>
                    <select
                      value={draft.autoSaveIntervalMinutes}
                      onChange={(e) => setDraft(p => ({ ...p, autoSaveIntervalMinutes: parseInt(e.target.value, 10) }))}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
                    >
                      <option value={0}>{t('settings.general.onMajorChangesOnly')}</option>
                      <option value={1}>{t('settings.general.everyMinute', { min: 1 })}</option>
                      <option value={3}>{t('settings.general.everyMinute', { min: 3 })}</option>
                      <option value={5}>{t('settings.general.everyMinute', { min: 5 })}</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Notifications */}
              <div className="pt-3 border-t border-zinc-800/80">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                  {t('settings.general.notifications')}
                </span>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.exportNotifications}
                    onChange={(e) => setDraft(p => ({ ...p, exportNotifications: e.target.checked }))}
                    className="accent-teal-500 w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-zinc-300 text-xs">{t('settings.general.allowNotifications')}</span>
                </label>
              </div>

              {/* Software Info */}
              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
                <span>{t('settings.general.appEdition')}</span>
                <span>v1.0.0</span>
              </div>
            </div>
          )}

          {/* TAB 5: SPEECH */}
          {activeTab === 'speech' && (
            <div className="space-y-8">
              {/* BLOCK 1: SPEECH RECOGNITION (WHISPER) */}
              <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
                <div className="border-b border-zinc-800/60 pb-2">
                  <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    {t('settings.speech.title')}
                  </h3>
                </div>

                {/* Provider selection */}
                <div>
                  <span className="text-xs font-medium text-zinc-400 block mb-2">
                    {t('settings.speech.provider')}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(p => ({
                        ...p,
                        whisperProvider: 'self-hosted',
                        whisperEndpoint: p.whisperEndpoint && p.whisperEndpoint !== 'https://api.openai.com/v1' ? p.whisperEndpoint : 'http://localhost:8000/v1',
                        whisperModel: p.whisperModel === 'whisper-1' ? 'small' : p.whisperModel,
                      }))}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        draft.whisperProvider === 'self-hosted'
                          ? 'border-teal-500 bg-teal-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span className="text-xs font-semibold text-zinc-200">
                        {t('settings.speech.providerSelfHosted')}
                      </span>
                      <span className="text-[11px] text-zinc-400 mt-1">
                        faster-whisper (Docker / Mac Metal)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDraft(p => ({
                        ...p,
                        whisperProvider: 'cloud',
                        whisperEndpoint: p.whisperEndpoint === 'http://localhost:8000/v1' ? 'https://api.openai.com/v1' : p.whisperEndpoint,
                        whisperModel: p.whisperModel === 'small' ? 'whisper-1' : p.whisperModel,
                      }))}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        draft.whisperProvider === 'cloud'
                          ? 'border-teal-500 bg-teal-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span className="text-xs font-semibold text-zinc-200">
                        {t('settings.speech.providerCloud')}
                      </span>
                      <span className="text-[11px] text-zinc-400 mt-1">
                        OpenAI Audio API / Groq
                      </span>
                    </button>
                  </div>
                </div>

                {/* Whisper Endpoint URL */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300 font-medium">{t('settings.speech.endpoint')}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const def = draft.whisperProvider === 'cloud'
                          ? 'https://api.openai.com/v1'
                          : 'http://localhost:8000/v1'
                        setDraft(p => ({ ...p, whisperEndpoint: def }))
                      }}
                      className="text-[11px] text-teal-400 hover:underline cursor-pointer"
                    >
                      {t('common.default')}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={draft.whisperEndpoint}
                    onChange={(e) => setDraft(p => ({ ...p, whisperEndpoint: e.target.value }))}
                    placeholder={draft.whisperProvider === 'cloud' ? 'https://api.openai.com/v1' : 'http://localhost:8000/v1'}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                  />
                </div>

                {/* Whisper API Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-300 font-medium">{t('settings.speech.apiKey')}</span>
                      {secureKeyInfo?.isEncrypted && (
                        <span className="flex items-center gap-1 text-[10px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded" title={t('settings.speech.secureStorageActive')}>
                          <Lock className="h-2.5 w-2.5" />
                          safeStorage
                        </span>
                      )}
                    </div>
                    {draft.whisperProvider === 'self-hosted' && (
                      <span className="text-[11px] text-zinc-500">{t('settings.speech.optionalForLocal')}</span>
                    )}
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={draft.whisperApiKey}
                      onChange={(e) => setDraft(p => ({ ...p, whisperApiKey: e.target.value }))}
                      placeholder={secureKeyInfo?.hasKey && !draft.whisperApiKey ? t('settings.speech.savedKey', { maskedKey: secureKeyInfo.maskedKey ?? '' }) : t('settings.speech.apiKeyPlaceholder')}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 pr-10 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(v => !v)}
                      className="absolute right-2.5 p-1 text-zinc-400 hover:text-zinc-200"
                      title={showApiKey ? 'Hide' : 'Show'}
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model & Language row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-300 font-medium">{t('settings.speech.model')}</span>
                    <input
                      type="text"
                      value={draft.whisperModel}
                      onChange={(e) => setDraft(p => ({ ...p, whisperModel: e.target.value }))}
                      placeholder={draft.whisperProvider === 'cloud' ? 'whisper-1' : 'small'}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-300 font-medium">{t('settings.speech.language')}</span>
                    <select
                      value={draft.whisperLanguage || ''}
                      onChange={(e) => setDraft(p => ({ ...p, whisperLanguage: e.target.value }))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-500 cursor-pointer"
                    >
                      <option value="">{t('settings.speech.languageAuto')}</option>
                      <option value="vi">Tiếng Việt (vi)</option>
                      <option value="en">English (en)</option>
                      <option value="zh">Chinese (zh)</option>
                      <option value="ja">Japanese (ja)</option>
                      <option value="ko">Korean (ko)</option>
                      <option value="fr">French (fr)</option>
                      <option value="de">German (de)</option>
                      <option value="es">Spanish (es)</option>
                    </select>
                  </div>
                </div>

                {/* Vocabulary / Prompt Hint */}
                <div className="space-y-1.5">
                  <span className="text-xs text-zinc-300 font-medium">{t('settings.speech.prompt')}</span>
                  <input
                    type="text"
                    value={draft.whisperPrompt}
                    onChange={(e) => setDraft(p => ({ ...p, whisperPrompt: e.target.value }))}
                    placeholder={t('settings.speech.promptPlaceholder')}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-500"
                  />
                </div>

                {/* Whisper Test Connection */}
                <div className="pt-2 border-t border-zinc-800/80 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTestWhisper}
                      disabled={testingWhisper}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${testingWhisper ? 'animate-spin text-teal-400' : ''}`} />
                      {testingWhisper ? t('settings.speech.testingConnection') : t('settings.speech.testConnection')}
                    </button>
                    {whisperTestFeedback && (
                      <div className="flex items-center gap-1.5 text-xs">
                        {whisperTestFeedback.success ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">{whisperTestFeedback.message}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-rose-400" />
                            <span className="text-rose-400 font-medium">{whisperTestFeedback.message}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {whisperTestFeedback?.models && whisperTestFeedback.models.length > 0 && (
                    <div className="text-[11px] text-zinc-400">
                      <span className="text-zinc-500">Models: </span>
                      {whisperTestFeedback.models.slice(0, 5).join(', ')}
                    </div>
                  )}
                </div>
              </div>

              {/* BLOCK 2: AI ANALYSIS & HIGHLIGHTS (LLM) */}
              <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
                <div className="border-b border-zinc-800/60 pb-2">
                  <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    {t('settings.llm.title')}
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {t('settings.llm.notice')}
                  </p>
                </div>

                {/* LLM Endpoint */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300 font-medium">{t('settings.llm.endpoint')}</span>
                    <button
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, llmEndpoint: 'https://api.openai.com/v1' }))}
                      className="text-[11px] text-teal-400 hover:underline cursor-pointer"
                    >
                      {t('common.default')}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={draft.llmEndpoint}
                    onChange={(e) => setDraft(p => ({ ...p, llmEndpoint: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                  />
                </div>

                {/* LLM API Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-300 font-medium">{t('settings.llm.apiKey')}</span>
                      {secureLlmKeyInfo?.isEncrypted && (
                        <span className="flex items-center gap-1 text-[10px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded" title={t('settings.llm.secureStorageActive')}>
                          <Lock className="h-2.5 w-2.5" />
                          safeStorage
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type={showLlmApiKey ? 'text' : 'password'}
                      value={draft.llmApiKey}
                      onChange={(e) => setDraft(p => ({ ...p, llmApiKey: e.target.value }))}
                      placeholder={secureLlmKeyInfo?.hasKey && !draft.llmApiKey ? t('settings.speech.savedKey', { maskedKey: secureLlmKeyInfo.maskedKey ?? '' }) : t('settings.llm.apiKeyPlaceholder')}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 pr-10 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLlmApiKey(v => !v)}
                      className="absolute right-2.5 p-1 text-zinc-400 hover:text-zinc-200"
                      title={showLlmApiKey ? 'Hide' : 'Show'}
                    >
                      {showLlmApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* LLM Model */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300 font-medium">{t('settings.llm.model')}</span>
                    <button
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, llmModel: 'gpt-4o-mini' }))}
                      className="text-[11px] text-teal-400 hover:underline cursor-pointer"
                    >
                      {t('common.default')}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={draft.llmModel}
                    onChange={(e) => setDraft(p => ({ ...p, llmModel: e.target.value }))}
                    placeholder="gpt-4o-mini"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-teal-500"
                  />
                </div>

                {/* LLM Test Connection */}
                <div className="pt-2 border-t border-zinc-800/80 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTestLlm}
                      disabled={testingLlm}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${testingLlm ? 'animate-spin text-teal-400' : ''}`} />
                      {testingLlm ? t('settings.llm.testingConnection') : t('settings.llm.testConnection')}
                    </button>
                    {llmTestFeedback && (
                      <div className="flex items-center gap-1.5 text-xs">
                        {llmTestFeedback.success ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">{llmTestFeedback.message}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-rose-400" />
                            <span className="text-rose-400 font-medium">{llmTestFeedback.message}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
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
