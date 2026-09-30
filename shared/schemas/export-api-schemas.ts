import { z } from 'zod'
import { ipcResult, emptyResult } from './common-schemas'
import {
  exportClip,
  exportSubtitle,
  exportTransition,
  exportBackground,
  exportMarker,
} from './export-schemas'
import { autoMatteDeviceSchema } from '../../core/src/project-model'

export const exportApiSchemas = {
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
  trackMatteMotion: {
    input: z.object({
      filePath: z.string(),
      /** Source seconds the track starts at. */
      startTime: z.number(),
      /** Source seconds to follow. */
      duration: z.number(),
    }),
    /** How the picture moved, or null when it could not be followed. See core/matte-motion. */
    output: z.object({
      t0: z.number(),
      step: z.number(),
      m: z.array(z.number()),
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
} as const
