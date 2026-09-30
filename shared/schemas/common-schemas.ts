import { z } from 'zod'

export const fileFilter = z.object({ name: z.string(), extensions: z.array(z.string()) })

export function ipcResult<T extends z.ZodRawShape>(valueShape: T) {
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), ...valueShape }),
    z.object({ success: z.literal(false), error: z.string() }),
  ])
}

export type IpcResult<T extends z.ZodRawShape> = z.infer<ReturnType<typeof ipcResult<T>>>

export const emptyResult = ipcResult({})

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

export const logsResponse = z.object({
  logPath: z.string(),
  lines: z.array(z.string()),
  error: z.string().optional(),
})

export const backendHealthStatus = z.object({
  status: z.enum(['alive', 'restarting', 'dead']),
  exitCode: z.number().nullable().optional(),
})

export type BackendHealthStatus = z.infer<typeof backendHealthStatus>
