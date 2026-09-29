import { z } from 'zod'
import {
  editPilotConfirmAnswerSchema,
  editPilotConfirmRequestSchema,
} from '../core/src/editpilot-confirm'
import {
  EDIT_PILOT_AGENT_IDS,
  editPilotAgentStatusSchema,
  editPilotCommandOverridesSchema,
  editPilotConfigSchema,
} from '../core/src/editpilot-agents'
import { keyframeTrackSchema, clipMaskSchema, chromaKeySchema, autoMatteSchema, clipStrokeSchema, autoMatteModelValues, autoMatteQualityValues, autoMatteDeviceSchema, stabilizationBakeSchema, stabilizationModeValues, STABILIZATION_SMOOTHING_MIN, STABILIZATION_SMOOTHING_MAX } from '../core/src/project-model'
import { WHISPER_PROGRESS_STEPS } from '../core/src/whisper-types'
import { komfyTemplateSchema } from '../core/src/template-model'

const fileFilter = z.object({ name: z.string(), extensions: z.array(z.string()) })

function ipcResult<T extends z.ZodRawShape>(valueShape: T) {
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), ...valueShape }),
    z.object({ success: z.literal(false), error: z.string() }),
  ])
}

export type IpcResult<T extends z.ZodRawShape> = z.infer<ReturnType<typeof ipcResult<T>>>

const emptyResult = ipcResult({})

export const updateStatusSchema = z.enum([
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'error',
  'unsupported',
])

export const updateStateSchema = z.object({
  status: updateStatusSchema,
  version: z.string().optional(),
  percent: z.number().optional(),
  bytesPerSecond: z.number().optional(),
  transferred: z.number().optional(),
  total: z.number().optional(),
  error: z.string().optional(),
  upToDate: z.boolean().optional(),
})

export type UpdateStateSchema = z.infer<typeof updateStateSchema>

const exportClipTransform = z.object({
  scale: z.number(),
  /** Per-axis scale, set by the side handles of a shape; absent means uniform `scale`. */
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  positionX: z.number(),
  positionY: z.number(),
  rotation: z.number(),
  cropTop: z.number(),
  cropRight: z.number(),
  cropBottom: z.number(),
  cropLeft: z.number(),
})

const exportColorCorrection = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  exposure: z.number(),
  highlights: z.number(),
  shadows: z.number(),
})

const exportClipTransition = z.object({
  type: z.string(),
  duration: z.number(),
})

/** A transition on the cut between two clips; the pair is rendered with xfade. */
const exportTransition = z.object({
  leftClipId: z.string(),
  rightClipId: z.string(),
  type: z.string(),
  duration: z.number(),
})

const exportClipEffect = z.object({
  type: z.string(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
})

const exportTextStyle = z.object({
  text: z.string(),
  fontSize: z.number(),
  color: z.string(),
  backgroundColor: z.string(),
  positionX: z.number(),
  positionY: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  padding: z.number(),
  opacity: z.number(),
})

const exportClipFilter = z.object({
  id: z.string(),
  intensity: z.number().optional(),
})

const exportClip = z.object({
  path: z.string(),
  type: z.string(),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  speed: z.number(),
  reversed: z.boolean(),
  flipH: z.boolean(),
  flipV: z.boolean(),
  opacity: z.number(),
  trackIndex: z.number(),
  muted: z.boolean(),
  volume: z.number(),
  id: z.string().optional(),
  linkedClipIds: z.array(z.string()).optional(),
  transform: exportClipTransform.optional(),
  colorCorrection: exportColorCorrection.optional(),
  transitionIn: exportClipTransition.optional(),
  transitionOut: exportClipTransition.optional(),
  filter: exportClipFilter.optional(),
  effects: z.array(exportClipEffect).optional(),
  textStyle: exportTextStyle.optional(),
  keyframes: z.array(keyframeTrackSchema).optional(),
  mask: clipMaskSchema.optional(),
  chromaKey: chromaKeySchema.optional(),
  autoMatte: autoMatteSchema.optional(),
  stroke: clipStrokeSchema.optional(),
  strokeBakePath: z.string().optional(),
  stickerId: z.string().optional(),
  shapeProperties: z.object({
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    strokeDasharray: z.string().optional(),
    cornerRounding: z.number().optional(),
    sides: z.number().optional(),
  }).optional(),
  assetId: z.string().nullable().optional(),
})

const exportSubtitle = z.object({
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  style: z.object({
    fontSize: z.number(),
    fontFamily: z.string(),
    fontWeight: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    position: z.string(),
    italic: z.boolean(),
  }),
})

export const exportBackground = z.object({
  type: z.enum(['color', 'blur', 'image']).default('color'),
  color: z.string().optional(),
  blur: z.number().optional(),
  imagePath: z.string().optional(),
})

const exportMarker = z.object({
  id: z.string(),
  time: z.number(),
  label: z.string().optional(),
  color: z.string().optional(),
})

const logsResponse = z.object({
  logPath: z.string(),
  lines: z.array(z.string()),
  error: z.string().optional(),
})

const backendHealthStatus = z.object({
  status: z.enum(['alive', 'restarting', 'dead']),
  exitCode: z.number().nullable().optional(),
})

export type BackendHealthStatus = z.infer<typeof backendHealthStatus>

export const whisperWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  probability: z.number().optional(),
})

export const whisperSegmentSchema = z.object({
  id: z.number(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(whisperWordSchema).optional(),
})

export const whisperTranscriptionResultSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(whisperSegmentSchema),
})

export type WhisperTranscriptionResultSchema = z.infer<typeof whisperTranscriptionResultSchema>

/** What a finished matte bake produced: the file, and which stretch of source it covers. */
const matteBakeDescriptorSchema = z.object({
  path: z.string(),
  fingerprint: z.string(),
  frameCount: z.number(),
  sourceStart: z.number(),
  sourceSpan: z.number(),
  speed: z.number(),
  reversed: z.boolean(),
  model: z.string(),
  quality: z.string(),
  assetKey: z.string(),
  manifestPath: z.string().optional(),
  status: z.enum(['complete', 'partial', 'error']).optional(),
  coverageActual: z.object({
    sourceStart: z.number(),
    sourceSpan: z.number(),
  }).optional(),
})

export const electronAPISchemas = {
  readLocalFile: {
    input: z.object({ filePath: z.string() }),
    output: z.object({ data: z.string(), mimeType: z.string() }),
  },
  /**
   * A byte range of a local media file, for the WebCodecs demuxer.
   *
   * It cannot use `fetch('file://…')`: the renderer's CSP allows `file:` for `img-src`
   * and `media-src` but not for `connect-src`, so every demux was blocked and the whole
   * hardware-decode path silently fell back to <video>. Widening `connect-src` would let
   * the renderer read any local file it likes; going through main keeps the fetch off the
   * renderer and puts the read behind `validatePath`.
   *
   * Ranged rather than whole-file so one 4K source cannot put a single multi-hundred-MB
   * message through the IPC channel.
   */
  readMediaChunk: {
    input: z.object({
      filePath: z.string(),
      offset: z.number().int().min(0),
      length: z.number().int().min(1),
    }),
    output: z.object({
      data: z.instanceof(Uint8Array),
      /** Total size of the file, so the caller knows when it is done. */
      totalSize: z.number(),
    }),
  },
  getAppInfo: {
    input: z.object({}),
    output: z.object({ version: z.string(), isPackaged: z.boolean(), userDataPath: z.string() }),
  },
  getSystemFonts: {
    input: z.object({}),
    output: z.object({
      fonts: z.array(z.string()),
    }),
  },

  getNoticesText: {
    input: z.object({}),
    output: z.string(),
  },

  // Auto-update against GitHub Releases. Only meaningful in a packaged build
  // or when KOMFYEDIT_FAKE_UPDATE=1 is set.
  checkForUpdates: {
    input: z.object({}),
    output: updateStateSchema,
  },
  updateGetState: {
    input: z.object({}),
    output: updateStateSchema,
  },
  updateDownload: {
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  updateInstallNow: {
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Window controls — the native frame is off, so the in-app title bar drives
  // minimise / maximise / close over IPC.
  windowMinimize: {
    input: z.object({}),
    output: z.void(),
  },
  windowToggleMaximize: {
    input: z.object({}),
    output: z.boolean(),
  },
  windowClose: {
    input: z.object({}),
    output: z.void(),
  },
  windowIsMaximized: {
    input: z.object({}),
    output: z.boolean(),
  },

  openExternalUrl: {
    input: z.object({ url: z.string() }),
    output: z.boolean(),
  },
  openParentFolderOfFile: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },
  showItemInFolder: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },
  showNotification: {
    input: z.object({
      title: z.string(),
      body: z.string(),
      filePath: z.string().optional(),
    }),
    output: z.boolean(),
  },

  // Logs
  getLogs: {
    input: z.object({ query: z.string().optional() }),
    output: logsResponse,
  },
  getLogPath: {
    input: z.object({}),
    output: z.object({ logPath: z.string(), logDir: z.string() }),
  },
  openLogFolder: {
    input: z.object({}),
    output: z.boolean(),
  },

  // Paths
  getResourcePath: {
    input: z.object({}),
    output: z.string().nullable(),
  },
  getDownloadsPath: {
    input: z.object({}),
    output: z.string(),
  },

  // Project assets
  addVisualAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      path: z.string(),
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  },
  addGenericAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  makeThumbnailsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
    }),
  },
  makeDimensionsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      width: z.number(),
      height: z.number(),
    }),
  },

  getProjectAssetsPath: {
    input: z.object({}),
    output: z.string(),
  },
  openProjectAssetsPathChangeDialog: {
    input: z.object({}),
    output: ipcResult({ path: z.string() }),
  },

  // File dialogs & save
  showSaveDialog: {
    input: z.object({
      title: z.string().optional(),
      defaultPath: z.string().optional(),
      filters: z.array(fileFilter).optional(),
    }),
    output: z.string().nullable(),
  },
  saveFile: {
    input: z.object({ filePath: z.string(), data: z.string(), encoding: z.string().optional() }),
    output: ipcResult({ path: z.string() }),
  },
  saveBinaryFile: {
    input: z.object({ filePath: z.string(), data: z.instanceof(ArrayBuffer) }),
    output: ipcResult({ path: z.string() }),
  },
  saveTempShapeImage: {
    input: z.object({ clipId: z.string(), data: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  showOpenDirectoryDialog: {
    input: z.object({ title: z.string().optional() }),
    output: z.string().nullable(),
  },
  searchDirectoryForFiles: {
    input: z.object({ directory: z.string(), filenames: z.array(z.string()) }),
    output: z.record(z.string(), z.string()),
  },
  checkFilesExist: {
    input: z.object({ filePaths: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
  },
  showOpenFileDialog: {
    input: z.object({
      title: z.string().optional(),
      filters: z.array(fileFilter).optional(),
      properties: z.array(z.string()).optional(),
    }),
    output: z.array(z.string()).nullable(),
  },
  getLutContent: {
    input: z.object({ filterId: z.string() }),
    output: ipcResult({ content: z.string().optional() }),
  },


  // Asynchronous render queue with progress events
  'render.start': {
    input: z.object({
      clips: z.array(exportClip),
      outputPath: z.string(),
      codec: z.string(),
      width: z.number(),
      height: z.number(),
      fps: z.number(),
      quality: z.number(),
      letterbox: z.object({ ratio: z.number(), color: z.string(), opacity: z.number() }).optional(),
      subtitles: z.array(exportSubtitle).optional(),
      transitions: z.array(exportTransition).optional(),
      background: exportBackground.optional(),
      markers: z.array(exportMarker).optional(),
      hardwareAcceleration: z.boolean().optional(),
      autoMatteDevice: autoMatteDeviceSchema.optional(),
      videoBitrate: z.number().positive().optional(),
      audioBitrate: z.number().positive().optional(),
    }),
    output: ipcResult({ jobId: z.string().optional() }),
  },
  'render.status': {
    input: z.object({ jobId: z.string() }),
    output: ipcResult({
      status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
      percent: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  'render.cancel': {
    input: z.object({ jobId: z.string() }),
    output: emptyResult,
  },
  'render.preview': {
    input: z.object({
      clips: z.array(exportClip),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      duration: z.number().optional(),
      resolution: z.enum(['480p', '360p', '720p']).optional(),
      outputPath: z.string().optional(),
      fps: z.number().optional(),
      letterbox: z.object({ ratio: z.number(), color: z.string(), opacity: z.number() }).optional(),
      subtitles: z.array(exportSubtitle).optional(),
      transitions: z.array(exportTransition).optional(),
      background: exportBackground.optional(),
    }),
    output: ipcResult({
      jobId: z.string().optional(),
      outputPath: z.string().optional(),
      duration: z.number().optional(),
    }),
  },

  // Video processing
  getHardwareEncoderCapabilities: {
    input: z.object({ forceRecheck: z.boolean().optional() }),
    output: z.object({
      availableEncoders: z.array(z.string()),
      preferredEncoder: z.string().nullable(),
      preferredEncoderDisplayName: z.string(),
      hardwareAccelerationSupported: z.boolean(),
    }),
  },
  getAudioPeaks: {
    input: z.object({ filePath: z.string(), buckets: z.number() }),
    output: z.array(z.number()),
  },
  extractVideoFrame: {
    input: z.object({ videoPath: z.string(), seekTime: z.number(), width: z.number().optional(), quality: z.number().optional() }),
    output: z.object({ path: z.string() }),
  },
  measureLoudness: {
    input: z.object({
      filePath: z.string(),
      startTime: z.number().optional(),
      duration: z.number().optional(),
    }),
    output: z.object({
      integratedLufs: z.number(),
      truePeakDb: z.number(),
      lra: z.number(),
      thresholdLufs: z.number().optional(),
    }).nullable(),
  },
  detectSilence: {
    input: z.object({
      filePath: z.string(),
      noiseDb: z.number().optional(),
      minDurationSec: z.number().optional(),
      startTime: z.number().optional(),
      duration: z.number().optional(),
    }),
    output: z.array(z.object({
      start: z.number(),
      end: z.number(),
      duration: z.number(),
    })),
  },

  // Proxy Generation
  generateProxy: {
    input: z.object({
      assetId: z.string(),
      filePath: z.string(),
    }),
    output: ipcResult({
      proxyPath: z.string().optional(),
    }),
  },
  cancelProxy: {
    input: z.object({
      assetId: z.string(),
    }),
    output: emptyResult,
  },
  getProxyStatus: {
    input: z.object({
      assetId: z.string(),
      filePath: z.string().optional(),
    }),
    output: z.object({
      status: z.enum(['none', 'generating', 'ready', 'error']),
      progress: z.number(),
      proxyPath: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Render Cache
  renderCacheCheck: {
    input: z.object({
      hashes: z.array(z.string()),
    }),
    output: z.record(
      z.string(),
      z.object({
        ready: z.boolean(),
        path: z.string().optional(),
      }),
    ),
  },
  renderCacheRequest: {
    input: z.object({
      hash: z.string(),
      startTime: z.number(),
      duration: z.number(),
      clips: z.array(z.any()),
      transitions: z.array(z.any()).optional(),
      background: z.any().optional(),
      letterbox: z.any().optional(),
      resolution: z.enum(['360p', '480p', '720p']).optional(),
      aspectRatio: z.number().positive().optional(),
      fps: z.number().optional(),
    }),
    output: ipcResult({
      cachePath: z.string().optional(),
    }),
  },
  renderCacheClear: {
    input: z.object({}),
    output: ipcResult({
      freedBytes: z.number(),
    }),
  },

  // EditPilot agent configuration
  editPilotDetectAgents: {
    input: z.object({}),
    output: z.object({
      agents: z.array(editPilotAgentStatusSchema),
      config: editPilotConfigSchema,
      activeAgentId: z.enum(EDIT_PILOT_AGENT_IDS).nullable(),
    }),
  },
  editPilotGetConfig: {
    input: z.object({}),
    output: editPilotConfigSchema,
  },
  editPilotSetConfig: {
    input: z.object({
      defaultAgentId: z.enum(EDIT_PILOT_AGENT_IDS).nullable(),
      commandOverrides: editPilotCommandOverridesSchema.optional(),
    }),
    output: editPilotConfigSchema,
  },

  editPilotSend: {
    input: z.object({
      runId: z.string(),
      prompt: z.string(),
      projectsDir: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      projectName: z.string().nullable().optional(),
      references: z.array(z.object({ clipId: z.string(), label: z.string() })).optional(),
      resumeSessionId: z.string().nullable().optional(),
    }),
    output: ipcResult({ agentLabel: z.string() }),
  },
  editPilotRegisterMcp: {
    input: z.object({ agentId: z.enum(EDIT_PILOT_AGENT_IDS) }),
    output: z.object({ ok: z.boolean(), output: z.string() }),
  },
  editPilotCancel: {
    input: z.object({ runId: z.string() }),
    output: emptyResult,
  },

  // Logging
  writeLog: {
    input: z.object({ level: z.string(), message: z.string() }),
    output: z.void(),
  },

  // Project file storage
  getProjectsDir: {
    input: z.object({}),
    output: z.object({ path: z.string() }),
  },
  getCacheInfo: {
    input: z.object({}),
    output: z.object({
      cachePath: z.string(),
      sizeBytes: z.number(),
      formattedSize: z.string(),
    }),
  },
  clearCache: {
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      freedBytes: z.number(),
      error: z.string().optional(),
    }),
  },
  listProjectFiles: {
    input: z.object({}),
    output: z.array(z.string()),
  },
  readProjectFile: {
    input: z.object({ projectId: z.string() }),
    output: ipcResult({ content: z.string().optional() }),
  },
  writeProjectFile: {
    input: z.object({ projectId: z.string(), content: z.string() }),
    output: ipcResult({ path: z.string().optional() }),
  },
  deleteProjectFile: {
    input: z.object({ projectId: z.string() }),
    output: ipcResult({}),
  },

  // Event testing helper
  triggerTestEvent: {
    input: z.object({ message: z.string() }),
    output: emptyResult,
  },

  // S5-6: Live patch responses from renderer
  editPilotRespondLivePatch: {
    input: z.object({
      requestId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      description: z.string().optional(),
      appliedCount: z.number().optional(),
    }),
    output: emptyResult,
  },
  editPilotRespondLiveUndo: {
    input: z.object({
      requestId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      description: z.string().optional(),
    }),
    output: emptyResult,
  },
  /** The user pressed a button on a confirmation card, unblocking the agent. */
  editPilotRespondLiveConfirm: {
    input: editPilotConfirmAnswerSchema,
    output: emptyResult,
  },

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
  /*
   * Template library. The presets folder travels with every call because the
   * renderer owns settings; main keeps no copy that could go stale.
   */
  templateList: {
    input: z.object({ presetsDir: z.string().optional() }),
    output: z.object({
      templatesDir: z.string(),
      templates: z.array(z.object({
        fileName: z.string(),
        id: z.string(),
        name: z.string(),
        createdAt: z.number(),
        width: z.number(),
        height: z.number(),
        durationSec: z.number(),
        slotCount: z.number(),
        category: z.string().default(''),
        coverPath: z.string().optional(),
        /** Ships with the app: read-only, and not on disk at all. */
        builtin: z.boolean().default(false),
      })),
    }),
  },
  templateRead: {
    input: z.object({ presetsDir: z.string().optional(), fileName: z.string() }),
    output: z.object({
      success: z.boolean(),
      template: komfyTemplateSchema.optional(),
      error: z.string().optional(),
    }),
  },
  templateSave: {
    input: z.object({
      presetsDir: z.string().optional(),
      template: komfyTemplateSchema,
      /** Files to copy in beside the document — the music bed, an overlay. */
      media: z.array(z.object({
        sourcePath: z.string(),
        fileName: z.string(),
      })).default([]),
      /** A frame to photograph for the card, from the footage being saved. */
      cover: z.object({
        videoPath: z.string(),
        seekTime: z.number(),
      }).optional(),
    }),
    output: z.object({
      success: z.boolean(),
      fileName: z.string().optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  templateDelete: {
    input: z.object({ presetsDir: z.string().optional(), fileName: z.string() }),
    output: z.object({ success: z.boolean(), error: z.string().optional() }),
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

