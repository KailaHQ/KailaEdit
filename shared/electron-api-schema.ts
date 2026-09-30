import { z } from 'zod'
import {
  editPilotConfirmRequestSchema,
} from '../core/src/editpilot-confirm'
import {
  stabilizationBakeSchema,
} from '../core/src/project-model'
import { WHISPER_PROGRESS_STEPS } from '../core/src/whisper-types'

// Re-export common schemas & types
export * from './schemas/common-schemas'
// Re-export export timeline schemas & types
export * from './schemas/export-schemas'
// Re-export whisper schemas & types
export * from './schemas/whisper-schemas'
// Re-export matte schemas & types
export * from './schemas/matte-schemas'

import { updateStateSchema } from './schemas/common-schemas'
import { mediaApiSchemas } from './schemas/media-api-schemas'
import { exportApiSchemas } from './schemas/export-api-schemas'
import { projectApiSchemas } from './schemas/project-api-schemas'
import { aiApiSchemas } from './schemas/ai-api-schemas'
import { editPilotApiSchemas } from './schemas/editpilot-api-schemas'

export const electronAPISchemas = {
  ...mediaApiSchemas,
  ...exportApiSchemas,
  ...projectApiSchemas,
  ...aiApiSchemas,
  ...editPilotApiSchemas,
} as const

// ── Event Schemas (Main Process -> Renderer) ──────────────────────────────

export const electronEventSchemas = {
  'update:state': updateStateSchema,
  'window:maximize-changed': z.object({
    isMaximized: z.boolean(),
  }),
  'render:progress': z.object({
    jobId: z.string(),
    percent: z.number().min(0).max(100),
    fps: z.number().optional(),
    timeSeconds: z.number().optional(),
    speed: z.number().optional(),
  }),
  'render:complete': z.object({
    jobId: z.string(),
    outputPath: z.string(),
  }),
  'render:error': z.object({
    jobId: z.string(),
    error: z.string(),
    stderr: z.string().optional(),
  }),
  'editpilot:chunk': z.object({
    runId: z.string(),
    /** Reported once per run so the panel can resume the same conversation. */
    sessionId: z.string().optional(),
    delta: z.string().optional(),
    done: z.boolean().optional(),
    error: z.string().optional(),
  }),
  'editpilot:live-apply-patch': z.object({
    requestId: z.string(),
    projectId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  /** The agent has stopped and is waiting for an answer from the panel. */
  'editpilot:live-confirm': z.object({
    projectId: z.string(),
    request: editPilotConfirmRequestSchema,
  }),
  'editpilot:live-undo': z.object({
    requestId: z.string(),
    projectId: z.string(),
  }),
  'editpilot:patch-applied': z.object({
    projectId: z.string(),
    description: z.string(),
    appliedCount: z.number(),
    timestamp: z.number(),
  }),
  'test:ping': z.object({
    message: z.string(),
    timestamp: z.number(),
  }),
  'proxy:progress': z.object({
    assetId: z.string(),
    progress: z.number(),
    status: z.enum(['none', 'generating', 'ready', 'error']),
    proxyPath: z.string().optional(),
    error: z.string().optional(),
  }),
  'render-cache:status': z.object({
    hash: z.string(),
    ready: z.boolean(),
    cachePath: z.string().optional(),
    error: z.string().optional(),
  }),
  'whisper:progress': z.object({
    jobId: z.string(),
    phase: z.enum(['extracting', 'transcribing', 'done', 'error']),
    percent: z.number().optional(),
    /** Stage key the renderer translates; the main process holds no locale. */
    step: z.enum(WHISPER_PROGRESS_STEPS).optional(),
    /** Untranslatable detail, such as an upstream error message. */
    detail: z.string().optional(),
  }),
  'matte:progress': z.object({
    jobId: z.string(),
    percent: z.number().min(0).max(100),
    phase: z.enum(['extracting', 'inferring', 'encoding', 'done', 'error', 'cancelled']),
    frame: z.number().optional(),
    totalFrames: z.number().optional(),
    error: z.string().optional(),
  }),
  'stabilize:progress': z.object({
    jobId: z.string(),
    percent: z.number().min(0).max(100),
    phase: z.enum(['queued', 'analyzing', 'stabilizing', 'done', 'error', 'cancelled']),
    /** Set on 'done'. */
    bake: stabilizationBakeSchema.optional(),
    error: z.string().optional(),
  }),
} as const

export type ElectronEventSchemas = typeof electronEventSchemas
export type ElectronEventChannel = keyof ElectronEventSchemas
export type ElectronEventPayload<K extends ElectronEventChannel> = z.infer<ElectronEventSchemas[K]>

export type ElectronEventListener<K extends ElectronEventChannel> = (
  payload: ElectronEventPayload<K>,
) => void

type Schemas = typeof electronAPISchemas

type InvokeAPI = {
  [K in keyof Schemas]: z.infer<Schemas[K]['input']> extends Record<string, never>
    ? () => Promise<z.infer<Schemas[K]['output']>>
    : (input: z.infer<Schemas[K]['input']>) => Promise<z.infer<Schemas[K]['output']>>
}

export type ElectronAPI = InvokeAPI & {
  getPathForFile: (file: File) => string
  platform: string
  on: <K extends ElectronEventChannel>(
    channel: K,
    listener: (payload: ElectronEventPayload<K>) => void,
  ) => () => void
}
