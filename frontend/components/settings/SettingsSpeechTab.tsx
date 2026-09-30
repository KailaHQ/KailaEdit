import React, { useState } from 'react'
import {
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'
import type { AppSettings } from '../../../shared/app-settings-schema'

export interface SettingsSpeechTabProps {
  draft: AppSettings
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>
  testingWhisper: boolean
  whisperTestFeedback: {
    success: boolean
    message: string
    models?: string[]
  } | null
  handleTestWhisper: () => void
  secureKeyInfo: {
    hasKey: boolean
    maskedKey?: string
    isEncrypted: boolean
  } | null
  testingLlm: boolean
  llmTestFeedback: {
    success: boolean
    message: string
  } | null
  handleTestLlm: () => void
  secureLlmKeyInfo: {
    hasKey: boolean
    maskedKey?: string
    isEncrypted: boolean
  } | null
}

export const SettingsSpeechTab: React.FC<SettingsSpeechTabProps> = ({
  draft,
  setDraft,
  testingWhisper,
  whisperTestFeedback,
  handleTestWhisper,
  secureKeyInfo,
  testingLlm,
  llmTestFeedback,
  handleTestLlm,
  secureLlmKeyInfo,
}) => {
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState(false)
  const [showLlmApiKey, setShowLlmApiKey] = useState(false)

  return (
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
  )
}
