import { z } from 'zod'

export const appLanguageSchema = z.enum(['en', 'vi'])
export type AppLanguage = z.infer<typeof appLanguageSchema>

export const cachePolicySchema = z.enum(['keep', 'auto-30-days'])
export type CachePolicy = z.infer<typeof cachePolicySchema>

export const timecodeFormatSchema = z.enum(['timecode', 'frames'])
export type TimecodeFormat = z.infer<typeof timecodeFormatSchema>

export const whisperProviderSchema = z.enum(['cloud', 'self-hosted'])
export type WhisperProvider = z.infer<typeof whisperProviderSchema>

export const appSettingsSchema = z.object({
  // General & i18n
  language: appLanguageSchema.default('en'),
  autoSave: z.boolean().default(true),
  autoSaveIntervalMinutes: z.number().int().min(0).max(30).default(1),
  exportNotifications: z.boolean().default(true),

  // Drafts & Storage
  projectsDir: z.string().default(''),
  defaultExportDir: z.string().default(''),
  cachePolicy: cachePolicySchema.default('keep'),
  presetsDir: z.string().default(''),

  // Edit Defaults
  defaultImageDuration: z.number().min(0.5).max(60).default(3.0),
  defaultTransitionDuration: z.number().min(0.1).max(5).default(0.5),
  defaultFps: z.number().int().default(30),
  timecodeFormat: timecodeFormatSchema.default('timecode'),

  // Performance
  hardwareAcceleration: z.boolean().default(true),
  /** Which processor runs background removal. See autoMatteDeviceSchema in project-model. */
  autoMatteDevice: z.enum(['auto', 'gpu', 'cpu']).default('auto'),
  hardwareDecode: z.boolean().default(true),
  gpuUiRendering: z.boolean().default(true),
  proxyEnabled: z.boolean().default(false),
  audioOutputDeviceId: z.string().default('default'),

  // Speech Recognition (Whisper / OpenAI Audio API)
  whisperProvider: whisperProviderSchema.default('self-hosted'),
  whisperEndpoint: z.string().default('http://localhost:8000/v1'),
  whisperApiKey: z.string().default(''),
  whisperModel: z.string().default('whisper-1'),
  whisperLanguage: z.string().default(''),
  whisperPrompt: z.string().default(''),

  // AI Analysis (LLM / OpenAI Chat Completions API)
  llmEndpoint: z.string().default('https://api.openai.com/v1'),
  llmApiKey: z.string().default(''),
  llmModel: z.string().default('gpt-4o-mini'),
})

export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({})

/**
 * Strictly resolves the LLM endpoint URL.
 * Defaults to 'https://api.openai.com/v1' and NEVER inherits or falls back to whisperEndpoint.
 */
export function resolveLlmEndpoint(settings?: { llmEndpoint?: string | null; whisperEndpoint?: string | null }): string {
  if (settings?.llmEndpoint && typeof settings.llmEndpoint === 'string' && settings.llmEndpoint.trim()) {
    return settings.llmEndpoint.trim()
  }
  return 'https://api.openai.com/v1'
}

/**
 * Migrates existing/persisted settings object, preserving all existing Whisper configurations
 * while guaranteeing safe default values for LLM settings without inheriting Whisper endpoints.
 */
export function migrateAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_APP_SETTINGS
  }
  const obj = raw as Record<string, unknown>

  // Guarantee LLM defaults are strictly separated and not inherited from whisperEndpoint
  const migrated: Record<string, unknown> = {
    ...DEFAULT_APP_SETTINGS,
    ...obj,
    llmEndpoint: typeof obj.llmEndpoint === 'string' && obj.llmEndpoint.trim()
      ? obj.llmEndpoint.trim()
      : 'https://api.openai.com/v1',
    llmApiKey: typeof obj.llmApiKey === 'string' ? obj.llmApiKey : '',
    llmModel: typeof obj.llmModel === 'string' && obj.llmModel.trim()
      ? obj.llmModel.trim()
      : 'gpt-4o-mini',
  }

  return appSettingsSchema.parse(migrated)
}
