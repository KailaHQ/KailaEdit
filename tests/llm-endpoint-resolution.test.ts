import { describe, it, expect } from 'vitest'
import {
  appSettingsSchema,
  DEFAULT_APP_SETTINGS,
  resolveLlmEndpoint,
  migrateAppSettings,
} from '../shared/app-settings-schema'

describe('KE-1001: LLM and Whisper Endpoint Separation', () => {
  describe('resolveLlmEndpoint', () => {
    it('defaults to https://api.openai.com/v1 when settings are empty or undefined', () => {
      expect(resolveLlmEndpoint()).toBe('https://api.openai.com/v1')
      expect(resolveLlmEndpoint({})).toBe('https://api.openai.com/v1')
    })

    it('returns default OpenAI endpoint even when whisperEndpoint is self-hosted', () => {
      const settings = {
        whisperEndpoint: 'http://localhost:8000/v1',
      }
      expect(resolveLlmEndpoint(settings)).toBe('https://api.openai.com/v1')
    })

    it('returns custom llmEndpoint when explicitly configured', () => {
      const settings = {
        whisperEndpoint: 'http://localhost:8000/v1',
        llmEndpoint: 'http://localhost:11434/v1',
      }
      expect(resolveLlmEndpoint(settings)).toBe('http://localhost:11434/v1')
    })

    it('trims whitespace and ignores empty string llmEndpoint', () => {
      expect(resolveLlmEndpoint({ llmEndpoint: '   ' })).toBe('https://api.openai.com/v1')
      expect(resolveLlmEndpoint({ llmEndpoint: '  https://api.groq.com/openai/v1  ' })).toBe(
        'https://api.groq.com/openai/v1',
      )
    })
  })

  describe('migrateAppSettings', () => {
    it('preserves existing Whisper configuration from legacy settings while adding LLM defaults', () => {
      // Legacy settings object before KE-1001 (no llmEndpoint, llmApiKey, llmModel)
      const legacySavedSettings = {
        language: 'vi',
        whisperProvider: 'self-hosted',
        whisperEndpoint: 'http://192.168.1.100:8000/v1',
        whisperApiKey: 'custom-whisper-token',
        whisperModel: 'large-v3',
        defaultFps: 60,
      }

      const migrated = migrateAppSettings(legacySavedSettings)

      // Existing whisper configuration must remain intact
      expect(migrated.whisperProvider).toBe('self-hosted')
      expect(migrated.whisperEndpoint).toBe('http://192.168.1.100:8000/v1')
      expect(migrated.whisperApiKey).toBe('custom-whisper-token')
      expect(migrated.whisperModel).toBe('large-v3')
      expect(migrated.language).toBe('vi')
      expect(migrated.defaultFps).toBe(60)

      // LLM settings must default to OpenAI and NOT inherit whisperEndpoint
      expect(migrated.llmEndpoint).toBe('https://api.openai.com/v1')
      expect(migrated.llmApiKey).toBe('')
      expect(migrated.llmModel).toBe('gpt-4o-mini')
    })

    it('respects explicitly configured LLM settings when present', () => {
      const userConfiguredSettings = {
        whisperProvider: 'self-hosted',
        whisperEndpoint: 'http://localhost:8000/v1',
        llmEndpoint: 'http://localhost:11434/v1',
        llmApiKey: 'ollama',
        llmModel: 'llama3.2',
      }

      const migrated = migrateAppSettings(userConfiguredSettings)

      expect(migrated.whisperEndpoint).toBe('http://localhost:8000/v1')
      expect(migrated.llmEndpoint).toBe('http://localhost:11434/v1')
      expect(migrated.llmApiKey).toBe('ollama')
      expect(migrated.llmModel).toBe('llama3.2')
    })

    it('handles null, undefined or non-object gracefully by returning DEFAULT_APP_SETTINGS', () => {
      expect(migrateAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
      expect(migrateAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
      expect(migrateAppSettings('invalid-json')).toEqual(DEFAULT_APP_SETTINGS)
    })
  })

  describe('AppSettings Schema validation', () => {
    it('validates default LLM fields in DEFAULT_APP_SETTINGS', () => {
      const parsed = appSettingsSchema.parse(DEFAULT_APP_SETTINGS)
      expect(parsed.llmEndpoint).toBe('https://api.openai.com/v1')
      expect(parsed.llmApiKey).toBe('')
      expect(parsed.llmModel).toBe('gpt-4o-mini')
    })
  })
})
