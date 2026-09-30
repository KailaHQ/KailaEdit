import { z } from 'zod'

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
