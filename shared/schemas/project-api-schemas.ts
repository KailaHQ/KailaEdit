import { z } from 'zod'
import { ipcResult, emptyResult } from './common-schemas'
import { komfyTemplateSchema } from '../../core/src/template-model'

export const projectApiSchemas = {
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
} as const
