import {
  HIGHLIGHT_SYSTEM_INSTRUCTION,
  buildHighlightExtractionPrompt,
  parseHighlightResponse,
} from '../../core/src/auto-highlight'
import {
  BROLL_SYSTEM_INSTRUCTION,
  buildBrollSuggestionPrompt,
  parseBrollSuggestions,
} from '../../core/src/broll-copilot'
import { getAllowedRoots } from '../config'
import { runOneShot } from '../editpilot/agent-runner'
import { logger } from '../logger'
import { validatePath } from '../path-validation'
import { whisperService } from '../whisper/whisper-service'
import { emitToRenderer } from './event-emitter'
import { handle } from './typed-handle'

export function registerWhisperHandlers(): void {
  handle('whisperTestConnection', async ({ endpoint, apiKey }) => {
    return whisperService.testConnection(endpoint, apiKey)
  })

  handle('whisperSaveSecureKey', async ({ apiKey }) => {
    return whisperService.saveSecureApiKey(apiKey)
  })

  handle('whisperGetSecureKey', async () => {
    const res = whisperService.getStoredApiKey()
    const masked = res.apiKey
      ? res.apiKey.length > 8
        ? `${res.apiKey.slice(0, 3)}...${res.apiKey.slice(-4)}`
        : '••••••••'
      : ''
    return {
      hasKey: res.hasKey,
      maskedKey: masked,
      isEncrypted: res.isEncrypted,
    }
  })

  handle('llmTestConnection', async ({ endpoint, apiKey, model }) => {
    return whisperService.testLlmConnection(endpoint, apiKey, model)
  })

  handle('llmSaveSecureKey', async ({ apiKey }) => {
    return whisperService.saveSecureLlmApiKey(apiKey)
  })

  handle('llmGetSecureKey', async () => {
    const res = whisperService.getStoredLlmApiKey()
    const masked = res.apiKey
      ? res.apiKey.length > 8
        ? `${res.apiKey.slice(0, 3)}...${res.apiKey.slice(-4)}`
        : '••••••••'
      : ''
    return {
      hasKey: res.hasKey,
      maskedKey: masked,
      isEncrypted: res.isEncrypted,
    }
  })

  handle('whisperTranscribe', async (params) => {
    const normalizedPath = validatePath(params.filePath, getAllowedRoots())

    return whisperService.transcribe({
      jobId: params.jobId,
      filePath: normalizedPath,
      startTime: params.startTime,
      duration: params.duration,
      endpoint: params.endpoint,
      apiKey: params.apiKey,
      model: params.model,
      language: params.language,
      prompt: params.prompt,
      temperature: params.temperature,
      onProgress: (phase, percent, step, detail) => {
        emitToRenderer('whisper:progress', {
          jobId: params.jobId,
          phase,
          percent,
          step,
          detail,
        })
      },
    })
  })

  handle('whisperCancel', async ({ jobId }) => {
    const cancelled = whisperService.cancelJob(jobId)
    return { success: cancelled }
  })

  /**
   * Picking highlights needs a model. If the user configured an EditPilot CLI,
   * it runs first; otherwise (or if the CLI is absent/fails), it uses the LLM endpoint
   * configured under Settings > AI Analysis.
   */
  handle('whisperExtractHighlights', async (params) => {
    if (!params.transcriptText.trim()) {
      return { success: false, error: 'EMPTY_TRANSCRIPT' }
    }

    const prompt = `${HIGHLIGHT_SYSTEM_INSTRUCTION}\n\n${buildHighlightExtractionPrompt(
      params.transcriptText,
      params.maxItems ?? 4,
    )}`

    try {
      const cli = await runOneShot({ prompt })
      if (cli.ok) {
        const highlights = parseHighlightResponse(cli.text)
        if (highlights.length > 0) {
          logger.info(`[whisper] Highlight qua ${cli.agentLabel}: ${highlights.length} đoạn`)
          return { success: true, highlights }
        }
        logger.warn(`[whisper] ${cli.agentLabel} không trả về JSON đọc được; chuyển sang LLM endpoint`)
      }
    } catch (err: any) {
      logger.warn(`[whisper] Hỏi CLI thất bại (${err?.message}); chuyển sang LLM endpoint`)
    }

    return whisperService.analyzeHighlightsWithLlm(params)
  })

  /**
   * The content half of B-roll Copilot. The renderer has already decided where
   * the cutaways go; this asks the configured CLI what each one should show.
   * Same contract as highlights: the CLI or nothing, and a reason the panel can
   * turn into an instruction the user can act on.
   */
  handle('brollSuggest', async ({ spots }) => {
    const prompt = `${BROLL_SYSTEM_INSTRUCTION}\n\n${buildBrollSuggestionPrompt(spots)}`

    const cli = await runOneShot({ prompt })
    if (!cli.ok) {
      return cli.reason === 'no-agent'
        ? { success: false, error: 'NO_CLI' }
        : { success: false, error: `CLI_FAILED: ${cli.agentLabel} — ${cli.detail}` }
    }

    const suggestions = parseBrollSuggestions(cli.text)
    if (suggestions.length === 0) {
      logger.warn(`[broll] ${cli.agentLabel} không trả về JSON đọc được`)
      return { success: false, error: `CLI_FAILED: ${cli.agentLabel}` }
    }

    logger.info(`[broll] Gợi ý qua ${cli.agentLabel}: ${suggestions.length}/${spots.length} đoạn`)
    return { success: true, agentLabel: cli.agentLabel, suggestions }
  })
}

