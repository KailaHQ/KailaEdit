import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'
import {
  timelineSummary,
  qcCheck,
  FILTER_DEFINITIONS,
  FILTER_CATEGORIES,
  STICKER_DEFINITIONS,
  STICKER_CATEGORIES,
  SFX_DEFINITIONS,
  SFX_CATEGORIES,
  getEffectiveTimelineDimensions,
  detectBrollOpportunities,
  formatTranscriptForHighlights,
  isAutoMatteBakeValid,
  clipAsPlayed,
  describeClipStabilization,
  stabilizedClipPath,
} from '@komfyedit/core'
import { listProjects, readProject } from '../project-reader.ts'
import {
  observeSilence,
  observeScenes,
  observeLoudness,
  observeFilmstrip,
} from '../../../../electron/media-analyzer.ts'
import { findFfmpegPath, probeAudioStream } from '../../../../electron/export/ffmpeg-utils.ts'
import { whisperService } from '../../../../electron/whisper/whisper-service.ts'
import type { McpServerContext, McpToolResponse } from './types.ts'

export async function handleReadTool(
  name: string,
  toolArgs: Record<string, any>,
  ctx: McpServerContext,
): Promise<McpToolResponse | null> {
  switch (name) {
    case 'project_list': {
      const projects = listProjects(toolArgs.projectsDir)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      }
    }

    case 'project_open': {
      const res = readProject(toolArgs.projectId, toolArgs.projectsDir)
      ctx.setActiveProject(res.project, res.filePath)
      const project = res.project
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: project.id,
                name: project.name,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                assetCount: project.assets?.length || 0,
                timelineCount: project.timelines?.length || 0,
                activeTimelineId: project.activeTimelineId,
                timelines: (project.timelines || []).map(t => ({
                  id: t.id,
                  name: t.name,
                  tracks: t.tracks.map(tr => `${tr.name} (${tr.kind || tr.type || 'video'})`),
                  clipCount: t.clips.length,
                  subtitleCount: t.subtitles?.length || 0,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'timeline_describe': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const timeline = ctx.resolveTimeline(project, toolArgs.timelineId)

      const assetMap = new Map((project.assets || []).map(a => [a.id, a]))
      const tracksDesc = timeline.tracks.map((tr, tIdx) => {
        const clips = timeline.clips
          .filter(c => c.trackIndex === tIdx)
          .sort((a, b) => a.startTime - b.startTime)
          .map(c => {
            const asset = c.assetId ? assetMap.get(c.assetId) : c.asset
            // A stabilized clip plays its baked file; its matte is judged against that.
            const played = clipAsPlayed(c, project.assets || [])
            const stabilizedPath = stabilizedClipPath(played)
            const stabilization = describeClipStabilization(c, project.assets || [], p => fs.existsSync(p))
            const assetPath = asset?.path || ''
            const isTextClip = c.type === 'text'
            const defaultName = isTextClip
              ? (c.textStyle?.text ? `Text: "${c.textStyle.text}"` : 'Text Clip')
              : (path.basename(assetPath) || `clip_${c.id}`)

            return {
              id: c.id,
              type: c.type || (isTextClip ? 'text' : 'video'),
              name: c.importedName || defaultName,
              start: c.startTime,
              duration: c.duration,
              end: c.startTime + c.duration,
              speed: c.speed,
              volume: c.volume,
              muted: c.muted,
              ...(c.linkedClipIds?.length ? { linkedClipIds: c.linkedClipIds } : {}),
              assetPath,
              ...(isTextClip && c.textStyle ? { text: c.textStyle.text, textStyle: c.textStyle } : {}),
              ...(c.filter ? { filter: c.filter } : {}),
              ...(c.stickerId ? { stickerId: c.stickerId, isSticker: true } : {}),
              ...(c.shapeProperties ? { shapeProperties: c.shapeProperties } : {}),
              ...(c.keyframes?.length ? { keyframes: c.keyframes } : {}),
              ...(c.transform ? { transform: c.transform } : {}),
              ...(c.mask ? { mask: c.mask } : {}),
              ...(c.chromaKey ? { chromaKey: c.chromaKey } : {}),
              ...(c.autoMatte ? {
                autoMatte: {
                  ...c.autoMatte,
                  ...(() => {
                    const bake = c.autoMatte.bake
                    if (!bake?.path) {
                      return { bakeReady: false, bakeStatus: 'missing' }
                    }
                    const exists = fs.existsSync(bake.path)
                    const isComplete = bake.status !== 'partial' && bake.status !== 'error'
                    const valid = exists && isComplete && isAutoMatteBakeValid(bake, {
                      trimStart: played.trimStart,
                      duration: played.duration,
                      speed: played.speed,
                      reversed: played.reversed,
                      model: c.autoMatte.model || 'rvm-mobilenetv3',
                      quality: c.autoMatte.quality || 'standard',
                      ...(stabilizedPath ? { assetKey: stabilizedPath } : {}),
                    })
                    return {
                      bakeReady: valid,
                      bakeStatus: !exists ? 'missing' : (bake.status ?? (valid ? 'complete' : 'invalid')),
                      bakePath: bake.path,
                      bakeFrameCount: bake.frameCount,
                      bakeSpeed: bake.speed ?? 1,
                      bakeNeedsSourceRateMigration: Number(bake.speed ?? 1) !== 1,
                      mattePlaybackRate: (c.speed ?? 1) / (bake.speed ?? 1),
                      ...(bake.coverageActual ? { coverageActual: bake.coverageActual } : {}),
                    }
                  })(),
                },
              } : {}),
              ...(stabilization ? { stabilization } : {}),
              ...(c.customMatte ? { customMatte: c.customMatte } : {}),
              ...(c.stroke ? { stroke: c.stroke } : {}),
              ...(c.blendMode && c.blendMode !== 'normal' ? { blendMode: c.blendMode } : {}),
            }
          })

        return {
          id: tr.id,
          name: tr.name,
          kind: tr.kind || tr.type || 'video',
          muted: tr.muted,
          locked: tr.locked,
          clips,
        }
      })

      const subtitleDescs = (timeline.subtitles || []).map((sub, idx) => ({
        index: idx + 1,
        id: sub.id,
        text: sub.text,
        startTime: sub.startTime,
        endTime: sub.endTime,
        duration: sub.endTime - sub.startTime,
        trackIndex: sub.trackIndex,
        style: sub.style,
      }))

      const effDims = getEffectiveTimelineDimensions(timeline, project.assets)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                timelineId: timeline.id,
                name: timeline.name,
                variantTag: timeline.variantTag,
                description: timeline.description,
                fps: effDims.fps,
                width: effDims.width,
                height: effDims.height,
                aspectRatio: effDims.aspectRatioLabel,
                background: timeline.background ?? { type: 'color', color: '#000000' },
                cover: timeline.cover,
                canvas: {
                  width: effDims.width,
                  height: effDims.height,
                  fps: effDims.fps,
                  aspectRatio: effDims.aspectRatioLabel,
                  background: timeline.background ?? { type: 'color', color: '#000000' },
                },
                variants: (project.timelines || []).map(tl => ({
                  id: tl.id,
                  name: tl.name,
                  variantTag: tl.variantTag,
                  description: tl.description,
                  clipCount: tl.clips.length,
                  isActive: tl.id === timeline.id,
                })),
                tracks: tracksDesc,
                subtitles: subtitleDescs,
                // Without this the agent cannot see a transition it just
                // placed, so it cannot verify the edit and will place it
                // again. The clips overlap by `duration`, which is also
                // why the two clip entries appear to run into each other.
                transitions: (timeline.transitions || []).map(transition => ({
                  leftClipId: transition.leftClipId,
                  rightClipId: transition.rightClipId,
                  trackIndex: transition.trackIndex,
                  type: transition.type,
                  duration: transition.duration,
                })),
                markers: (timeline.markers || []).map(marker => ({
                  id: marker.id,
                  time: marker.time,
                  label: marker.label,
                  color: marker.color,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'subtitle_list': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const timeline = ctx.resolveTimeline(project, toolArgs.timelineId)
      const subtitles = (timeline.subtitles || []).map((sub, idx) => ({
        index: idx + 1,
        id: sub.id,
        text: sub.text,
        startTime: sub.startTime,
        endTime: sub.endTime,
        duration: sub.endTime - sub.startTime,
        trackIndex: sub.trackIndex,
        style: sub.style,
      }))

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                timelineId: timeline.id,
                name: timeline.name,
                count: subtitles.length,
                subtitles,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'timeline_summary': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const timeline = ctx.resolveTimeline(project, toolArgs.timelineId)
      const summary = timelineSummary(
        { model: project as any } as any,
        { maxBytes: toolArgs.maxBytes },
      )
      return {
        content: [
          {
            type: 'text',
            text: summary.text,
          },
        ],
      }
    }

    case 'media_list': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const assets = (project.assets || []).map(a => ({
        id: a.id,
        type: a.type,
        path: a.path,
        duration: a.duration,
        resolution: a.resolution,
        exists: fs.existsSync(a.path),
        proxyPath: a.proxyPath,
        proxyStatus: a.proxyStatus,
        proxyExists: Boolean(a.proxyPath && fs.existsSync(a.proxyPath)),
      }))
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(assets, null, 2),
          },
        ],
      }
    }

    case 'media_probe': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      if (!fs.existsSync(filePath)) {
        throw new Error(`Media file not found: ${filePath}`)
      }

      const ffmpeg = findFfmpegPath()
      if (!ffmpeg) throw new Error('ffmpeg binary not found')

      const res = spawnSync(ffmpeg, ['-hide_banner', '-i', filePath], { encoding: 'utf8' })
      const output = (res.stdout || '') + (res.stderr || '')

      const durationMatch = output.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
      const duration = durationMatch
        ? parseFloat(durationMatch[1]) * 3600 + parseFloat(durationMatch[2]) * 60 + parseFloat(durationMatch[3])
        : null

      const videoMatch = output.match(/Stream #\d+:\d+.*Video: ([^,\n]+),.*?(\d+x\d+)/)
      const audioMatch = output.match(/Stream #\d+:\d+.*Audio: ([^,\n]+),.*?(\d+) Hz/)
      const audioInfo = probeAudioStream(ffmpeg, filePath)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                filePath,
                duration,
                video: videoMatch ? { codec: videoMatch[1], resolution: videoMatch[2] } : null,
                audio: audioMatch
                  ? {
                      codec: audioMatch[1],
                      sampleRate: parseInt(audioMatch[2], 10),
                      channels: audioInfo.channels,
                      hasAudio: audioInfo.hasAudio,
                    }
                  : null,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'qc_check': {
      const project = ctx.resolveProject(toolArgs.projectId)
      ctx.resolveTimeline(project, toolArgs.timelineId)
      const issues = qcCheck({ model: project as any } as any, {
        fileExists: (p: string) => fs.existsSync(p),
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(issues, null, 2),
          },
        ],
      }
    }

    case 'filter_list': {
      const category = toolArgs.category as string | undefined
      const filters = category
        ? FILTER_DEFINITIONS.filter(f => f.category === category)
        : FILTER_DEFINITIONS
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                categories: FILTER_CATEGORIES,
                total: filters.length,
                filters: filters.map(f => ({
                  id: f.id,
                  name: f.name,
                  category: f.category,
                  description: f.description,
                  defaultIntensity: f.defaultIntensity,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'sticker_list': {
      const category = (toolArgs.category as string | undefined)?.toLowerCase()
      const stickers = category === 'animated'
        ? STICKER_DEFINITIONS.filter(s => s.isAnimated)
        : category
          ? STICKER_DEFINITIONS.filter(s => s.category === category)
          : STICKER_DEFINITIONS
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                categories: STICKER_CATEGORIES,
                total: stickers.length,
                stickers: stickers.map(s => ({
                  id: s.id,
                  name: s.name,
                  category: s.category,
                  filename: s.filename,
                  keywords: s.keywords,
                  isAnimated: s.isAnimated ?? false,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'sfx_list': {
      const category = (toolArgs.category as string | undefined)?.toLowerCase()
      const sfxItems = category
        ? SFX_DEFINITIONS.filter(s => s.category === category)
        : SFX_DEFINITIONS
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                categories: SFX_CATEGORIES,
                total: sfxItems.length,
                sfx: sfxItems.map(s => ({
                  id: s.id,
                  name: s.name,
                  category: s.category,
                  filename: s.filename,
                  duration: s.duration,
                  description: s.description,
                  keywords: s.keywords,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'suggest_broll': {
      const project = ctx.resolveProject(toolArgs.projectId)
      const timeline = ctx.resolveTimeline(project, toolArgs.timelineId)

      const minDuration = typeof toolArgs.minDuration === 'number' ? toolArgs.minDuration : 5.0
      const maxDuration = typeof toolArgs.maxDuration === 'number' ? toolArgs.maxDuration : 8.0

      const opportunities = detectBrollOpportunities({
        subtitles: timeline.subtitles || [],
        existingClips: timeline.clips || [],
        minDuration,
        maxDuration,
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: opportunities.length,
                opportunities: opportunities.map(o => ({
                  id: o.id,
                  startTime: o.startTime,
                  endTime: o.endTime,
                  duration: o.duration,
                  contextText: o.contextText,
                  keywords: o.keywords,
                  suggestedPrompt: o.suggestedPrompt,
                })),
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'observe_silence': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      const intervals = await observeSilence(filePath, {
        noiseDb: toolArgs.noiseDb,
        minDurationSec: toolArgs.minDurationSec,
      })

      let isEntirelySilent = false
      try {
        const ffmpeg = findFfmpegPath()
        if (ffmpeg) {
          const probeRes = spawnSync(ffmpeg, ['-hide_banner', '-i', filePath], { encoding: 'utf8' })
          const durMatch = ((probeRes.stdout || '') + (probeRes.stderr || '')).match(/Duration:\s*(\d+):(\d+):([0-9.]+)/)
          const totalDur = durMatch
            ? parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3])
            : 0
          if (totalDur > 0 && intervals.length === 1 && intervals[0].start <= 0.5 && intervals[0].duration >= totalDur - 1.0) {
            isEntirelySilent = true
          }
        }
      } catch {}

      const resultIntervals = intervals.map(item => ({
        ...item,
        ...(isEntirelySilent ? { isEntireFile: true, warning: 'Toàn bộ file media đều là khoảng lặng (không có âm thanh).' } : {}),
      }))

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultIntervals, null, 2),
          },
        ],
      }
    }

    case 'observe_scenes': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      const cuts = await observeScenes(filePath, {
        threshold: toolArgs.threshold,
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(cuts, null, 2),
          },
        ],
      }
    }

    case 'observe_loudness': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      const loudness = await observeLoudness(filePath)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(loudness, null, 2),
          },
        ],
      }
    }

    case 'observe_filmstrip': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      const result = await observeFilmstrip({
        mediaPath: filePath,
        startTime: toolArgs.startTime,
        endTime: toolArgs.endTime,
        columns: toolArgs.columns,
        maxWidth: toolArgs.maxWidth,
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }

    case 'transcribe': {
      const filePath = ctx.resolveMediaPath(toolArgs)
      if (!fs.existsSync(filePath)) {
        throw new Error(`Media file not found: ${filePath}`)
      }

      const res = await whisperService.transcribe({
        jobId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        filePath,
        startTime: toolArgs.startTime,
        duration: toolArgs.duration,
        endpoint: toolArgs.endpoint,
        apiKey: toolArgs.apiKey,
        model: toolArgs.model,
        language: toolArgs.language,
        prompt: toolArgs.prompt,
      })

      if (!res.success || !res.result) {
        throw new Error(res.error || 'Transcription failed')
      }

      const includeWords = toolArgs.wordTimestamps !== false
      const formattedSegments = res.result.segments.map(s => ({
        id: s.id,
        start: s.start,
        end: s.end,
        duration: Number((s.end - s.start).toFixed(3)),
        text: s.text,
        ...(includeWords && s.words ? { words: s.words } : {}),
      }))

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                text: res.result.text,
                language: res.result.language,
                duration: res.result.duration,
                segmentCount: formattedSegments.length,
                segments: formattedSegments,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'extract_highlights': {
      let text = toolArgs.transcriptText
      if (!text && toolArgs.filePath) {
        const filePath = path.resolve(toolArgs.filePath)
        if (fs.existsSync(filePath)) {
          const transRes = await whisperService.transcribe({
            jobId: `hl-${Date.now()}`,
            filePath,
            apiKey: toolArgs.apiKey,
            endpoint: toolArgs.endpoint,
          })
          if (transRes.success && transRes.result) {
            text = formatTranscriptForHighlights(transRes.result.segments.map(s => ({
              startTime: s.start,
              endTime: s.end,
              text: s.text,
            })))
          }
        }
      }

      if (!text) {
        // Fallback to subtitles in active project if any
        try {
          const proj = ctx.resolveProject()
          const tl = ctx.resolveTimeline(proj)
          if (tl.subtitles && tl.subtitles.length > 0) {
            text = formatTranscriptForHighlights(tl.subtitles)
          }
        } catch {}
      }

      if (!text) {
        throw new Error('No transcript provided and unable to derive from project or file.')
      }

      const hlRes = await whisperService.analyzeHighlightsWithLlm({
        transcriptText: text,
        apiKey: toolArgs.apiKey,
        endpoint: toolArgs.endpoint,
        model: toolArgs.model,
        maxItems: toolArgs.maxItems,
      })

      if (!hlRes.success || !hlRes.highlights) {
        throw new Error(hlRes.error || 'Highlight extraction failed')
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: hlRes.highlights.length,
                highlights: hlRes.highlights,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    default:
      return null
  }
}
