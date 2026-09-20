import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { resolveUserDataDir } from '../../core/src/app-paths'
import { logger } from '../logger'
import { extractAudioForWhisper, type ExtractAudioResult } from './audio-extractor'
import type {
  WhisperTranscriptionResult,
  WhisperSegment,
  WhisperProgressStep,
} from '../../core/src/whisper-types'
import {
  HIGHLIGHT_SYSTEM_INSTRUCTION,
  buildHighlightExtractionPrompt,
  parseHighlightResponse,
  type HighlightCandidate,
} from '../../core/src/auto-highlight'

const require = createRequire(import.meta.url)
let safeStorageModule: typeof import('electron').safeStorage | null = null
try {
  const electron = require('electron')
  if (typeof electron !== 'string' && electron) {
    safeStorageModule = electron.safeStorage || electron.default?.safeStorage
  }
} catch {}

export interface WhisperConnectionTestResult {
  success: boolean
  message?: string
  error?: string
  models?: string[]
}

export interface TranscribeOptions {
  jobId: string
  filePath: string
  startTime?: number
  duration?: number
  endpoint?: string
  apiKey?: string
  model?: string
  language?: string
  prompt?: string
  temperature?: number
  onProgress?: (
    phase: 'extracting' | 'transcribing' | 'done' | 'error',
    percent?: number,
    /** Stable key the renderer translates — never a user-facing string. */
    step?: WhisperProgressStep,
    /** Untranslatable detail (an upstream error message), appended by the UI. */
    detail?: string,
  ) => void
}

interface ActiveJob {
  abortController: AbortController
  killFfmpeg?: () => void
  cleanupTempAudio?: () => void
}

class WhisperService {
  private activeJobs = new Map<string, ActiveJob>()
  private secretFilePath: string | null = null
  private llmSecretFilePath: string | null = null

  private getSecretFilePath(): string {
    if (!this.secretFilePath) {
      this.secretFilePath = path.join(resolveUserDataDir(), 'whisper-secret.bin')
    }
    return this.secretFilePath
  }

  private getLlmSecretFilePath(): string {
    if (!this.llmSecretFilePath) {
      this.llmSecretFilePath = path.join(resolveUserDataDir(), 'llm-secret.bin')
    }
    return this.llmSecretFilePath
  }

  private saveSecureKeyToFile(filePath: string, apiKey: string): { success: boolean; isEncrypted: boolean; error?: string } {
    try {
      const trimmed = apiKey.trim()
      if (!trimmed) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        return { success: true, isEncrypted: true }
      }

      if (safeStorageModule && safeStorageModule.isEncryptionAvailable()) {
        const encrypted = safeStorageModule.encryptString(trimmed)
        fs.writeFileSync(filePath, encrypted)
        return { success: true, isEncrypted: true }
      } else {
        const base64 = Buffer.from(trimmed, 'utf8').toString('base64')
        fs.writeFileSync(filePath, Buffer.from(`RAW:${base64}`, 'utf8'))
        return { success: true, isEncrypted: false }
      }
    } catch (err) {
      logger.error(`[whisper-service] Failed to save secure key to ${filePath}: ${err}`)
      return { success: false, isEncrypted: false, error: String(err) }
    }
  }

  private getStoredKeyFromFile(filePath: string): { apiKey: string; hasKey: boolean; isEncrypted: boolean } {
    try {
      if (!fs.existsSync(filePath)) {
        return { apiKey: '', hasKey: false, isEncrypted: false }
      }
      const buffer = fs.readFileSync(filePath)
      if (buffer.length === 0) {
        return { apiKey: '', hasKey: false, isEncrypted: false }
      }

      const strCheck = buffer.toString('utf8')
      if (strCheck.startsWith('RAW:')) {
        const raw = Buffer.from(strCheck.slice(4), 'base64').toString('utf8')
        return { apiKey: raw, hasKey: true, isEncrypted: false }
      }

      if (safeStorageModule && safeStorageModule.isEncryptionAvailable()) {
        const decrypted = safeStorageModule.decryptString(buffer)
        return { apiKey: decrypted, hasKey: true, isEncrypted: true }
      }

      return { apiKey: '', hasKey: true, isEncrypted: false }
    } catch (err) {
      logger.warn(`[whisper-service] Failed to read stored key from ${filePath}: ${err}`)
      return { apiKey: '', hasKey: false, isEncrypted: false }
    }
  }

  /**
   * Save Whisper API Key encrypted using Electron safeStorage if available.
   */
  saveSecureApiKey(apiKey: string): { success: boolean; isEncrypted: boolean; error?: string } {
    return this.saveSecureKeyToFile(this.getSecretFilePath(), apiKey)
  }

  /**
   * Retrieve the stored Whisper API Key.
   */
  getStoredApiKey(): { apiKey: string; hasKey: boolean; isEncrypted: boolean } {
    return this.getStoredKeyFromFile(this.getSecretFilePath())
  }

  /**
   * Save LLM API Key encrypted using Electron safeStorage if available.
   */
  saveSecureLlmApiKey(apiKey: string): { success: boolean; isEncrypted: boolean; error?: string } {
    return this.saveSecureKeyToFile(this.getLlmSecretFilePath(), apiKey)
  }

  /**
   * Retrieve the stored LLM API Key.
   */
  getStoredLlmApiKey(): { apiKey: string; hasKey: boolean; isEncrypted: boolean } {
    return this.getStoredKeyFromFile(this.getLlmSecretFilePath())
  }

  /**
   * Normalize an endpoint URL to ensure proper base URL.
   */
  normalizeEndpoint(endpoint: string): string {
    let url = endpoint.trim().replace(/\/+$/, '')
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`
    }
    return url
  }

  /**
   * Test connection to the OpenAI/faster-whisper-server endpoint.
   */
  async testConnection(endpoint: string, explicitApiKey?: string): Promise<WhisperConnectionTestResult> {
    const norm = this.normalizeEndpoint(endpoint)
    const effectiveKey = explicitApiKey?.trim() || this.getStoredApiKey().apiKey

    const headers: Record<string, string> = {}
    if (effectiveKey) {
      headers['Authorization'] = `Bearer ${effectiveKey}`
    }

    // Attempt /models check (OpenAI standard)
    const modelsUrl = norm.endsWith('/v1') ? `${norm}/models` : `${norm}/v1/models`
    logger.info(`[whisper-service] Testing connection to ${modelsUrl}`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.ok) {
        try {
          const data = (await res.json()) as { data?: Array<{ id: string }> }
          const modelList = Array.isArray(data.data) ? data.data.map(m => m.id) : []
          return {
            success: true,
            message: `Connected successfully (${res.status} OK)`,
            models: modelList.slice(0, 10),
          }
        } catch {
          return {
            success: true,
            message: `Connected successfully (${res.status} OK)`,
          }
        }
      }

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          error: `Authentication failed (${res.status}): Please check your API Key.`,
        }
      }

      // Try root or direct ping if /models wasn't found (some local servers don't expose /models)
      if (res.status === 404) {
        return {
          success: true,
          message: `Endpoint reachable (${norm})`,
        }
      }

      return {
        success: false,
        error: `Server responded with HTTP ${res.status}: ${res.statusText}`,
      }
    } catch (err: any) {
      logger.warn(`[whisper-service] Connection test failed: ${err.message}`)
      if (err.name === 'AbortError') {
        return { success: false, error: 'Connection timed out (8s)' }
      }
      return { success: false, error: `Could not connect to ${norm}: ${err.message}` }
    }
  }

  /**
   * Test connection to the LLM Chat Completions endpoint with a minimal 1-token query.
   */
  async testLlmConnection(
    endpoint?: string,
    explicitApiKey?: string,
    model?: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const rawEndpoint = endpoint?.trim() || 'https://api.openai.com/v1'
    const norm = this.normalizeEndpoint(rawEndpoint)
    const effectiveKey = explicitApiKey?.trim() || this.getStoredLlmApiKey().apiKey
    const effectiveModel = model?.trim() || 'gpt-4o-mini'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (effectiveKey) {
      headers['Authorization'] = `Bearer ${effectiveKey}`
    }

    const chatUrl = `${norm}/chat/completions`
    logger.info(`[whisper-service] Testing LLM connection to ${chatUrl} (model=${effectiveModel})`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: effectiveModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      })
      clearTimeout(timeout)

      if (res.ok) {
        return {
          success: true,
          message: `Connected successfully (${res.status} OK, model: ${effectiveModel})`,
        }
      }

      let errDetail = ''
      try {
        const errJson = await res.json()
        errDetail = errJson.error?.message || JSON.stringify(errJson)
      } catch {
        errDetail = await res.text()
      }

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          error: `Authentication failed (${res.status}): Please check your API Key.`,
        }
      }

      if (res.status === 404) {
        return {
          success: false,
          error: `Chat completions endpoint not found (404) at ${chatUrl}. Please verify the URL.`,
        }
      }

      return {
        success: false,
        error: `Server responded with HTTP ${res.status}: ${errDetail.slice(0, 200)}`,
      }
    } catch (err: any) {
      logger.warn(`[whisper-service] LLM connection test failed: ${err.message}`)
      if (err.name === 'AbortError') {
        return { success: false, error: 'Connection timed out (10s)' }
      }
      return { success: false, error: `Could not connect to ${chatUrl}: ${err.message}` }
    }
  }

  /**
   * Cancel an ongoing transcription job.
   */
  cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId)
    if (!job) return false

    logger.info(`[whisper-service] Cancelling job ${jobId}`)
    job.abortController.abort()
    if (job.killFfmpeg) {
      job.killFfmpeg()
    }
    if (job.cleanupTempAudio) {
      job.cleanupTempAudio()
    }
    this.activeJobs.delete(jobId)
    return true
  }

  /**
   * Perform end-to-end transcription:
   * 1. Extract audio via ffmpeg to 16kHz mono mp3
   * 2. Post multipart form to OpenAI-compatible endpoint
   * 3. Return WhisperTranscriptionResult with segments and words
   */
  async transcribe(options: TranscribeOptions): Promise<{
    success: boolean
    result?: WhisperTranscriptionResult
    error?: string
  }> {
    const {
      jobId,
      filePath,
      startTime,
      duration,
      endpoint = 'http://localhost:8000/v1',
      apiKey,
      model = 'whisper-1',
      language,
      prompt,
      temperature,
      onProgress,
    } = options

    const abortController = new AbortController()
    const activeJob: ActiveJob = { abortController }
    this.activeJobs.set(jobId, activeJob)

    let extracted: ExtractAudioResult | null = null

    try {
      // Step 1: Extract audio to lightweight MP3 Mono
      onProgress?.('extracting', 15, 'extractingAudio')

      const audioExtraction = extractAudioForWhisper({
        inputPath: filePath,
        startTime,
        duration,
      })
      activeJob.killFfmpeg = audioExtraction.kill

      extracted = await audioExtraction.promise
      activeJob.cleanupTempAudio = extracted.cleanup

      if (abortController.signal.aborted) {
        throw new Error('Transcription cancelled by user')
      }

      onProgress?.('transcribing', 40, 'uploadingAudio')

      // Step 2: Read MP3 into FormData
      const audioBuffer = fs.readFileSync(extracted.outputPath)
      const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' })

      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.mp3')
      formData.append('model', model || 'whisper-1')
      formData.append('response_format', 'verbose_json')
      formData.append('timestamp_granularities[]', 'word')
      formData.append('timestamp_granularities[]', 'segment')

      if (language && language.trim() && language !== 'auto') {
        formData.append('language', language.trim())
      }
      if (prompt && prompt.trim()) {
        formData.append('prompt', prompt.trim())
      }
      if (temperature !== undefined) {
        formData.append('temperature', String(temperature))
      }

      // Step 3: Send POST request
      const normEndpoint = this.normalizeEndpoint(endpoint)
      const transcriptionsUrl = normEndpoint.endsWith('/v1')
        ? `${normEndpoint}/audio/transcriptions`
        : `${normEndpoint}/v1/audio/transcriptions`

      const effectiveKey = apiKey?.trim() || this.getStoredApiKey().apiKey
      const headers: Record<string, string> = {}
      if (effectiveKey) {
        headers['Authorization'] = `Bearer ${effectiveKey}`
      }

      logger.info(`[whisper-service] Sending audio to ${transcriptionsUrl} (model=${model})`)

      onProgress?.('transcribing', 60, 'transcribing')

      const response = await fetch(transcriptionsUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal: abortController.signal,
      })

      if (!response.ok) {
        let errDetails = ''
        try {
          const errJson = await response.json()
          errDetails = errJson.error?.message || JSON.stringify(errJson)
        } catch {
          errDetails = await response.text()
        }
        throw new Error(`Whisper API error (${response.status}): ${errDetails.slice(0, 300)}`)
      }

      onProgress?.('transcribing', 90, 'processingSubtitles')

      const data = (await response.json()) as any

      // Step 4: Normalize result into WhisperTranscriptionResult
      const segments: WhisperSegment[] = []

      if (Array.isArray(data.segments)) {
        for (const seg of data.segments) {
          segments.push({
            id: Number(seg.id ?? segments.length),
            start: Number(seg.start ?? 0),
            end: Number(seg.end ?? 0),
            text: String(seg.text ?? ''),
            words: Array.isArray(seg.words)
              ? seg.words.map((w: any) => ({
                  word: String(w.word ?? ''),
                  start: Number(w.start ?? 0),
                  end: Number(w.end ?? 0),
                  probability: w.probability !== undefined ? Number(w.probability) : undefined,
                }))
              : undefined,
          })
        }
      } else if (typeof data.text === 'string' && data.text.trim()) {
        // Fallback for simple json response
        segments.push({
          id: 0,
          start: 0,
          end: duration ?? 1,
          text: data.text.trim(),
        })
      }

      const transcriptionResult: WhisperTranscriptionResult = {
        text: typeof data.text === 'string' ? data.text : segments.map(s => s.text).join(' '),
        language: data.language,
        duration: data.duration,
        segments,
      }

      onProgress?.('done', 100, 'done')
      return { success: true, result: transcriptionResult }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        onProgress?.('error', 0, 'cancelled')
        return { success: false, error: 'Transcription cancelled by user' }
      }
      logger.error(`[whisper-service] Transcription failed: ${err.message}`)
      onProgress?.('error', 0, 'failed', err.message)
      return { success: false, error: err.message || String(err) }
    } finally {
      if (extracted) {
        extracted.cleanup()
      }
      this.activeJobs.delete(jobId)
    }
  }

  /**
   * Analyze transcript using OpenAI Chat Completion API (or compatible endpoint)
   * to automatically extract viral highlights and 3-second hook candidates.
   *
   * The Auto Highlights panel no longer comes through here — it asks the CLI
   * configured in EditPilot and says so when there is none, rather than
   * reaching for a second provider the user never chose. This remains for the
   * `extract_highlights` MCP tool, whose caller is an agent on the other side
   * of the bridge and has no CLI of its own to borrow.
   */
  async analyzeHighlightsWithLlm(params: {
    transcriptText: string
    apiKey?: string
    endpoint?: string
    model?: string
    maxItems?: number
  }): Promise<{ success: boolean; highlights?: HighlightCandidate[]; error?: string }> {
    try {
      // An empty transcript is not an empty answer: the model still returns
      // four confident highlights, invented whole, with round timestamps that
      // point nowhere in the recording. The panel used to send '' on every
      // run, so every suggestion it showed was fiction. Refuse instead.
      if (!params.transcriptText.trim()) {
        return { success: false, error: 'EMPTY_TRANSCRIPT' }
      }

      const storedLlmKey = this.getStoredLlmApiKey().apiKey || this.getStoredApiKey().apiKey
      const effectiveKey = params.apiKey?.trim() || storedLlmKey

      // Strictly resolve LLM endpoint — defaults to OpenAI and NEVER falls back to whisperEndpoint
      const rawEndpoint = params.endpoint?.trim() || 'https://api.openai.com/v1'
      const baseUrl = this.normalizeEndpoint(rawEndpoint)
      const isCustomLocal = baseUrl !== 'https://api.openai.com/v1' && !baseUrl.includes('api.openai.com')

      if (!effectiveKey && !isCustomLocal) {
        return {
          success: false,
          error: 'MISSING_API_KEY',
        }
      }

      const chatUrl = `${baseUrl}/chat/completions`
      const prompt = buildHighlightExtractionPrompt(params.transcriptText, params.maxItems ?? 4)
      const model = params.model?.trim() || 'gpt-4o-mini'

      logger.info(`[whisper-service] Analyzing highlights via ${chatUrl} (model=${model})`)

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: HIGHLIGHT_SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        let errDetails = ''
        try {
          const errJson = await response.json()
          errDetails = errJson.error?.message || JSON.stringify(errJson)
        } catch {
          errDetails = await response.text()
        }
        throw new Error(`OpenAI Chat API error (${response.status}): ${errDetails.slice(0, 300)}`)
      }

      const data = (await response.json()) as any
      const content = data?.choices?.[0]?.message?.content || ''
      const candidates = parseHighlightResponse(content)

      return {
        success: true,
        highlights: candidates,
      }
    } catch (err: any) {
      logger.error(`[whisper-service] Highlight analysis failed: ${err.message}`)
      return {
        success: false,
        error: err.message || String(err),
      }
    }
  }
}

export const whisperService = new WhisperService()
