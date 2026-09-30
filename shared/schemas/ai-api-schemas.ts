import { z } from 'zod'
import { whisperTranscriptionResultSchema } from './whisper-schemas'
import { matteBakeDescriptorSchema } from './matte-schemas'
import {
  autoMatteModelValues,
  autoMatteQualityValues,
  autoMatteDeviceSchema,
  stabilizationBakeSchema,
  stabilizationModeValues,
  STABILIZATION_SMOOTHING_MIN,
  STABILIZATION_SMOOTHING_MAX,
} from '../../core/src/project-model'

export const aiApiSchemas = {
  // ── Speech Recognition (Whisper / OpenAI Audio API) ────────────────────
  whisperTestConnection: {
    input: z.object({
      endpoint: z.string(),
      apiKey: z.string().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      error: z.string().optional(),
      models: z.array(z.string()).optional(),
    }),
  },
  whisperSaveSecureKey: {
    input: z.object({
      apiKey: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
      isEncrypted: z.boolean(),
      error: z.string().optional(),
    }),
  },
  whisperGetSecureKey: {
    input: z.object({}).optional().default({}),
    output: z.object({
      hasKey: z.boolean(),
      maskedKey: z.string().optional(),
      isEncrypted: z.boolean(),
    }),
  },

  // ── AI Analysis (LLM / OpenAI Chat Completions API) ────────────────────
  llmTestConnection: {
    input: z.object({
      endpoint: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  llmSaveSecureKey: {
    input: z.object({
      apiKey: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
      isEncrypted: z.boolean(),
      error: z.string().optional(),
    }),
  },
  llmGetSecureKey: {
    input: z.object({}).optional().default({}),
    output: z.object({
      hasKey: z.boolean(),
      maskedKey: z.string().optional(),
      isEncrypted: z.boolean(),
    }),
  },
  whisperTranscribe: {
    input: z.object({
      jobId: z.string(),
      filePath: z.string(),
      startTime: z.number().optional(),
      duration: z.number().optional(),
      endpoint: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      language: z.string().optional(),
      prompt: z.string().optional(),
      temperature: z.number().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      result: whisperTranscriptionResultSchema.optional(),
      error: z.string().optional(),
    }),
  },
  whisperCancel: {
    input: z.object({
      jobId: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
    }),
  },
  whisperExtractHighlights: {
    input: z.object({
      transcriptText: z.string(),
      apiKey: z.string().optional(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
      maxItems: z.number().optional(),
    }),
    output: z.object({
      success: z.boolean(),
      highlights: z.array(z.object({
        id: z.string(),
        title: z.string(),
        startTime: z.number(),
        endTime: z.number(),
        duration: z.number(),
        hookText: z.string(),
        hookPreset: z.string().optional(),
        viralScore: z.number(),
        reason: z.string(),
        quoteSnippet: z.string(),
        coldOpenRange: z.object({
          startTime: z.number(),
          endTime: z.number(),
        }).optional(),
      })).optional(),
      error: z.string().optional(),
    }),
  },
  /**
   * What to show over each stretch of talking. The spots and their timings are
   * worked out in the renderer; only the judgement about content is asked of
   * the CLI, so nothing here decides where a cutaway goes.
   */
  brollSuggest: {
    input: z.object({
      spots: z.array(z.object({
        startTime: z.number(),
        endTime: z.number(),
        contextText: z.string(),
      })).min(1),
    }),
    output: z.object({
      success: z.boolean(),
      agentLabel: z.string().optional(),
      suggestions: z.array(z.object({
        index: z.number(),
        suggestedPrompt: z.string(),
        keywords: z.array(z.string()),
      })).optional(),
      error: z.string().optional(),
    }),
  },
  matteBakeStart: {
    input: z.object({
      jobId: z.string(),
      clipId: z.string(),
      filePath: z.string(),
      trimStart: z.number().min(0),
      duration: z.number().positive(),
      speed: z.number().default(1),
      reversed: z.boolean().default(false),
      model: z.enum(autoMatteModelValues).default('rvm-mobilenetv3'),
      quality: z.enum(autoMatteQualityValues).default('standard'),
      device: autoMatteDeviceSchema.default('auto'),
      /** The media is a still: one frame to matte, and it never goes out of date. */
      still: z.boolean().default(false),
    }),
    output: z.object({
      started: z.boolean(),
      cached: z.boolean().optional(),
      provider: z.string().optional(),
      path: z.string().optional(),
      fingerprint: z.string().optional(),
      frameCount: z.number().optional(),
      error: z.string().optional(),
      bake: matteBakeDescriptorSchema.optional(),
    }),
  },
  matteGetDeviceInfo: {
    input: z.object({}).optional(),
    output: z.object({
      /** Execution providers this build can actually create a session with. */
      available: z.array(z.string()),
      /** What 'auto' would pick right now. */
      preferred: z.string(),
      gpuAvailable: z.boolean(),
      /** Provider of the session currently loaded, if any. */
      active: z.string().nullable(),
    }),
  },
  matteBakeMissing: {
    input: z.object({
      paths: z.array(z.string()).max(500),
    }),
    output: z.object({
      /** The subset of `paths` that is no longer on disk. */
      missing: z.array(z.string()),
    }),
  },
  matteScrubProxy: {
    input: z.object({ sourcePath: z.string(), mattePath: z.string() }),
    output: z.object({ sourcePath: z.string().optional(), mattePath: z.string().optional(), error: z.string().optional() }),
  },
  matteBakeCancel: {
    input: z.object({
      jobId: z.string(),
    }),
    output: z.object({
      success: z.boolean(),
    }),
  },
  matteBakeStatus: {
    input: z.object({
      jobId: z.string(),
    }),
    output: z.object({
      status: z.enum(['idle', 'running', 'done', 'error', 'cancelled']),
      percent: z.number().min(0).max(100),
      phase: z.string().optional(),
      mattePath: z.string().optional(),
      fingerprint: z.string().optional(),
      frameCount: z.number().optional(),
      error: z.string().optional(),
      bake: matteBakeDescriptorSchema.optional(),
    }),
  },
  stabilizeStart: {
    input: z.object({
      /** Chosen by the renderer so it can match progress events to the clip that asked. */
      jobId: z.string(),
      /** Recorded on the bake, so a bake is never served to another asset. */
      assetId: z.string(),
      filePath: z.string(),
      sourceStart: z.number().min(0),
      sourceSpan: z.number().positive(),
      smoothing: z.number().min(STABILIZATION_SMOOTHING_MIN).max(STABILIZATION_SMOOTHING_MAX),
      mode: z.enum(stabilizationModeValues),
      /**
       * What to make of an HDR source. 'hevc' keeps it HDR as 10-bit HEVC, which needs a
       * machine that can decode HEVC; 'sdr' tone-maps it to 8-bit H.264. An SDR source is
       * H.264 either way. The renderer decides, because it is the one that has to play it.
       */
      hdrOutput: z.enum(['hevc', 'sdr']).default('sdr'),
    }),
    output: z.object({
      started: z.boolean(),
      /** The bake was already on disk; `bake` is set and no job runs. */
      cached: z.boolean().optional(),
      bake: stabilizationBakeSchema.optional(),
      error: z.string().optional(),
    }),
  },
  stabilizeCancel: {
    input: z.object({ jobId: z.string() }),
    output: z.object({ success: z.boolean() }),
  },
  stabilizeStatus: {
    input: z.object({ jobId: z.string() }),
    output: z.object({
      status: z.enum(['idle', 'queued', 'running', 'done', 'error', 'cancelled']),
      percent: z.number().min(0).max(100),
      bake: stabilizationBakeSchema.optional(),
      error: z.string().optional(),
    }),
  },
  stabilizeMissing: {
    input: z.object({ paths: z.array(z.string()).max(500) }),
    output: z.object({
      /** The subset of `paths` that is no longer on disk. */
      missing: z.array(z.string()),
    }),
  },
  imageRemoveBackground: {
    input: z.object({
      imageSrc: z.string(),
      quality: z.enum(['standard', 'high']).default('high'),
    }),
    output: z.object({
      success: z.boolean(),
      cutoutDataUrl: z.string().optional(),
      error: z.string().optional(),
    }),
  },
} as const
