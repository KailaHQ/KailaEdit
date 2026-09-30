import { z } from 'zod'

/** What a finished matte bake produced: the file, and which stretch of source it covers. */
export const matteBakeDescriptorSchema = z.object({
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

export type MatteBakeDescriptor = z.infer<typeof matteBakeDescriptorSchema>
