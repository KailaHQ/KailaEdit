import type { EditorModel, EditorState } from './editor-state'
import type { Timeline, TimelineClip, SubtitleClip } from './project-model'
import { getFilterDefinition } from './filters'
import { isAutoMatteBakeValid } from './auto-matte'
import { computeStrokesHash } from './custom-matte'
import { clipAsPlayed, describeClipStabilization, stabilizedClipPath } from './stabilization'

export type QcIssueType =
  | 'ORPHAN_CLIP'
  | 'MISSING_MEDIA'
  | 'UNUSUALLY_SHORT_CLIP'
  | 'OVERLAY_GAP'
  | 'SUBTITLE_OVERLAP'
  | 'INVALID_FILTER'
  | 'INVALID_KEYFRAME'
  | 'INVALID_CHROMA_KEY'
  | 'AUTO_MATTE_NOT_BAKED'
  | 'CUSTOM_MATTE_UNAPPLIED'
  | 'STABILIZATION_NOT_BAKED'
  | 'STABILIZATION_OCCLUSION'
  | 'INVALID_STROKE'

export interface QcIssue {
  type: QcIssueType
  severity: 'warning' | 'error'
  message: string
  trackIndex?: number
  trackId?: string
  clipId?: string
  clipIds?: string[]
  details?: Record<string, any>
}

export interface QcCheckOptions {
  fileExists?: (path: string) => boolean
  minClipDurationSec?: number // default 0.5
  checkOverlayGaps?: boolean // default true
}

function resolveTimelineAndModel(input: EditorState | EditorModel | Timeline): {
  timeline: Timeline | null
  model?: EditorModel
} {
  if ('tracks' in input && Array.isArray(input.tracks) && 'clips' in input) {
    return { timeline: input as Timeline }
  }
  const anyInput = input as any
  const model: EditorModel | undefined = anyInput.model ? anyInput.model : (anyInput.timelines ? anyInput : undefined)
  if (model && Array.isArray(model.timelines)) {
    const activeId = model.activeTimelineId
    const timeline = model.timelines.find(t => t.id === activeId) || model.timelines[0] || null
    return { timeline, model }
  }
  return { timeline: null }
}

function getClipStart(c: TimelineClip): number {
  return (c as any).timelineStart ?? c.startTime ?? 0
}

function getClipDuration(c: TimelineClip): number {
  if ((c as any).timelineEnd !== undefined) {
    return (c as any).timelineEnd - getClipStart(c)
  }
  return c.duration ?? 0
}

function getClipEnd(c: TimelineClip): number {
  return (c as any).timelineEnd ?? (getClipStart(c) + getClipDuration(c))
}

/**
 * Perform a comprehensive Quality Control (QC) health check on the timeline.
 * Detects:
 * - Orphan clips (invalid trackIndex or missing asset reference)
 * - Missing media files (empty mediaPath or missing on disk)
 * - Unusually short clips (< 0.5s duration)
 * - Gaps on overlay video tracks (V2+)
 * - Overlapping subtitle clips
 *
 * Returns an empty array if timeline is completely clean.
 */
export function qcCheck(
  input: EditorState | EditorModel | Timeline,
  options?: QcCheckOptions,
): QcIssue[] {
  const { timeline, model } = resolveTimelineAndModel(input)
  if (!timeline) return []

  const issues: QcIssue[] = []
  const minClipDuration = options?.minClipDurationSec ?? 0.5
  const tracks = timeline.tracks || []
  const clips = timeline.clips || []
  const subtitles: SubtitleClip[] = (timeline as any).subtitles || []

  const assetIds = new Set((model?.assets || []).map(a => a.id))
  const assetMap = new Map((model?.assets || []).map(a => [a.id, a]))

  // 1. Check clips for orphan, missing media, and unusually short duration
  for (const clip of clips) {
    const duration = getClipDuration(clip)
    const assetId = clip.assetId ?? (clip as any).mediaId

    // Check orphan track index
    if (clip.trackIndex < 0 || clip.trackIndex >= tracks.length) {
      issues.push({
        type: 'ORPHAN_CLIP',
        severity: 'error',
        message: `Clip "${clip.id}" references non-existent track index ${clip.trackIndex} (total tracks: ${tracks.length})`,
        trackIndex: clip.trackIndex,
        clipId: clip.id,
      })
    } else if (model && model.assets && model.assets.length > 0 && assetId && !assetIds.has(assetId)) {
      // Check orphan asset reference
      issues.push({
        type: 'ORPHAN_CLIP',
        severity: 'error',
        message: `Clip "${clip.id}" references non-existent asset ID "${assetId}"`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
      })
    }

    // Text overlays and adjustment layers are generated, not sourced: they have
    // no asset and no path by design. Reporting MISSING_MEDIA for them made every
    // project containing a title fail QC forever, which in turn blocked every
    // agent edit, since the workflow stops on a QC error.
    const isGeneratedClip = clip.type === 'text' || clip.type === 'adjustment'

    // Resolve media path from clip or referenced asset
    const mediaPath = (clip as any).mediaPath || (clip as any).asset?.path || (assetId ? assetMap.get(assetId)?.path : undefined)

    // Check missing media path
    if (!isGeneratedClip && (!mediaPath || mediaPath.trim() === '')) {
      issues.push({
        type: 'MISSING_MEDIA',
        severity: 'error',
        message: `Clip "${clip.id}" has no mediaPath specified`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
      })
    } else if (!isGeneratedClip && options?.fileExists && mediaPath && !mediaPath.startsWith('stickers/') && !mediaPath.startsWith('sfx/') && !options.fileExists(mediaPath)) {
      issues.push({
        type: 'MISSING_MEDIA',
        severity: 'error',
        message: `Media file does not exist on disk: ${mediaPath}`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
        details: { path: mediaPath },
      })
    }

    // Check unusually short clip
    if (duration > 0 && duration < minClipDuration) {
      issues.push({
        type: 'UNUSUALLY_SHORT_CLIP',
        severity: 'warning',
        message: `Clip "${clip.id}" has unusually short duration (${duration.toFixed(2)}s < ${minClipDuration}s)`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
        details: { duration },
      })
    }

    // Check filter validity
    if (clip.filter) {
      if (!getFilterDefinition(clip.filter.id)) {
        issues.push({
          type: 'INVALID_FILTER',
          severity: 'error',
          message: `Clip "${clip.id}" references unknown filter ID "${clip.filter.id}"`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { filterId: clip.filter.id },
        })
      } else if (clip.filter.intensity === 0) {
        issues.push({
          type: 'INVALID_FILTER',
          severity: 'warning',
          message: `Clip "${clip.id}" has filter "${clip.filter.id}" with 0% intensity (ineffective filter)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { filterId: clip.filter.id, intensity: 0 },
        })
      }
    }

    // Check chroma key validity
    if (clip.chromaKey && clip.chromaKey.enabled) {
      const hex = clip.chromaKey.color.replace(/^#/, '')
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        issues.push({
          type: 'INVALID_CHROMA_KEY',
          severity: 'error',
          message: `Clip "${clip.id}" has invalid chroma key color "${clip.chromaKey.color}" (expected 6-digit hex format #RRGGBB)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { color: clip.chromaKey.color },
        })
      } else if (clip.chromaKey.similarity <= 0) {
        issues.push({
          type: 'INVALID_CHROMA_KEY',
          severity: 'warning',
          message: `Clip "${clip.id}" has chroma key similarity at 0% (ineffective chroma key)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { similarity: clip.chromaKey.similarity },
        })
      }

      if (clip.type === 'audio') {
        issues.push({
          type: 'INVALID_CHROMA_KEY',
          severity: 'error',
          message: `Clip "${clip.id}" is an audio clip but has chroma key enabled`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { clipType: clip.type },
        })
      }
    }

    // Check stabilization: an export takes the original footage until the bake lands
    const stabilization = describeClipStabilization(clip, model?.assets || [], options?.fileExists)
    if (stabilization && stabilization.enabled && !stabilization.bakeReady) {
      issues.push({
        type: 'STABILIZATION_NOT_BAKED',
        severity: 'warning',
        message: `Clip "${clip.id}" has stabilization on but no usable stabilized file (${stabilization.status}); an export now uses the unstabilized footage. The editor bakes it in the background while the project is open.`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
        details: { status: stabilization.status, bakePath: stabilization.bakePath },
      })
    }
    if (stabilization?.occlusionTimes?.length) {
      issues.push({
        type: 'STABILIZATION_OCCLUSION',
        severity: 'warning',
        message: `Clip "${clip.id}": something passed close to the lens at ${stabilization.occlusionTimes.map(t => `${t.toFixed(1)}s`).join(', ')} and may have been stabilized as camera shake. Consider mode "tripod", or cutting that moment out.`,
        trackIndex: clip.trackIndex,
        trackId: tracks[clip.trackIndex]?.id,
        clipId: clip.id,
        details: { occlusionTimes: stabilization.occlusionTimes, mode: stabilization.mode },
      })
    }

    // Check auto matte validity — against the clip as it plays, so a stabilized clip's
    // matte has to be of its stabilized file
    if (clip.autoMatte && clip.autoMatte.enabled) {
      const played = clipAsPlayed(clip, model?.assets || [])
      const stabilizedPath = stabilizedClipPath(played)
      const isValid = isAutoMatteBakeValid(clip.autoMatte.bake, {
        trimStart: played.trimStart || 0,
        duration: played.duration,
        speed: played.speed ?? 1,
        reversed: Boolean(played.reversed),
        model: clip.autoMatte.model || 'rvm-mobilenetv3',
        quality: clip.autoMatte.quality || 'standard',
        ...(stabilizedPath ? { assetKey: stabilizedPath } : {}),
      })
      const fileExists = !options?.fileExists || (clip.autoMatte.bake?.path ? options.fileExists(clip.autoMatte.bake.path) : false)

      if (!isValid || !fileExists) {
        issues.push({
          type: 'AUTO_MATTE_NOT_BAKED',
          severity: 'warning',
          message: `Clip "${clip.id}" has auto matte enabled but matte is not baked or fingerprint is mismatched (export will retain background)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: {
            hasBake: Boolean(clip.autoMatte.bake),
            fingerprintMatch: isValid,
            bakePath: clip.autoMatte.bake?.path,
          },
        })
      }
    }

    // Check custom matte validity
    if (clip.customMatte && clip.customMatte.enabled && clip.customMatte.strokes && clip.customMatte.strokes.length > 0) {
      const currentHash = computeStrokesHash(clip.customMatte.strokes)
      if (clip.customMatte.appliedHash !== currentHash) {
        issues.push({
          type: 'CUSTOM_MATTE_UNAPPLIED',
          severity: 'warning',
          message: `Clip "${clip.id}" has custom matte strokes that have not been applied/rebaked`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: {
            strokeCount: clip.customMatte.strokes.length,
            appliedHash: clip.customMatte.appliedHash,
            currentHash,
          },
        })
      }
    }

    // Check stroke validity
    if (clip.stroke && clip.stroke.enabled && clip.stroke.style !== 'none') {
      const hex = clip.stroke.color ? clip.stroke.color.replace(/^#/, '') : ''
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        issues.push({
          type: 'INVALID_STROKE',
          severity: 'error',
          message: `Clip "${clip.id}" has invalid stroke color "${clip.stroke.color}" (expected 6-digit hex format #RRGGBB)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { color: clip.stroke.color },
        })
      } else if (clip.stroke.width <= 0) {
        issues.push({
          type: 'INVALID_STROKE',
          severity: 'warning',
          message: `Clip "${clip.id}" has stroke width at ${clip.stroke.width}% (invisible stroke)`,
          trackIndex: clip.trackIndex,
          trackId: tracks[clip.trackIndex]?.id,
          clipId: clip.id,
          details: { width: clip.stroke.width },
        })
      }
    }

    // Check keyframes validity
    if (clip.keyframes && clip.keyframes.length > 0) {
      for (const track of clip.keyframes) {
        if (!track.points || track.points.length === 0) continue

        // Single keyframe point warning: static value, no animation curve
        if (track.points.length === 1) {
          issues.push({
            type: 'INVALID_KEYFRAME',
            severity: 'warning',
            message: `Clip "${clip.id}" has only 1 keyframe point on track "${track.property}" (static value; animation requires at least 2 points)`,
            trackIndex: clip.trackIndex,
            trackId: tracks[clip.trackIndex]?.id,
            clipId: clip.id,
            details: { property: track.property, pointsCount: 1 },
          })
        }

        // Check each point bounds
        for (const p of track.points) {
          // Point outside clip duration
          if (p.t < 0 || p.t > duration + 0.001) {
            issues.push({
              type: 'INVALID_KEYFRAME',
              severity: 'error',
              message: `Clip "${clip.id}" keyframe point at ${p.t.toFixed(2)}s on "${track.property}" is outside clip duration (0s - ${duration.toFixed(2)}s)`,
              trackIndex: clip.trackIndex,
              trackId: tracks[clip.trackIndex]?.id,
              clipId: clip.id,
              details: { property: track.property, t: p.t, clipDuration: duration },
            })
          }

          // Value out of bounds
          if (track.property === 'opacity' && (p.value < 0 || p.value > 100)) {
            issues.push({
              type: 'INVALID_KEYFRAME',
              severity: 'error',
              message: `Clip "${clip.id}" opacity keyframe value ${p.value} is outside valid range [0, 100]`,
              trackIndex: clip.trackIndex,
              trackId: tracks[clip.trackIndex]?.id,
              clipId: clip.id,
              details: { property: track.property, t: p.t, value: p.value },
            })
          } else if (track.property === 'filter.intensity' && (p.value < 0 || p.value > 100)) {
            issues.push({
              type: 'INVALID_KEYFRAME',
              severity: 'error',
              message: `Clip "${clip.id}" filter intensity keyframe value ${p.value} is outside valid range [0, 100]`,
              trackIndex: clip.trackIndex,
              trackId: tracks[clip.trackIndex]?.id,
              clipId: clip.id,
              details: { property: track.property, t: p.t, value: p.value },
            })
          } else if (track.property === 'volume' && p.value < 0) {
            issues.push({
              type: 'INVALID_KEYFRAME',
              severity: 'error',
              message: `Clip "${clip.id}" volume keyframe value ${p.value} is negative`,
              trackIndex: clip.trackIndex,
              trackId: tracks[clip.trackIndex]?.id,
              clipId: clip.id,
              details: { property: track.property, t: p.t, value: p.value },
            })
          } else if (track.property === 'transform.scale' && p.value < 0) {
            issues.push({
              type: 'INVALID_KEYFRAME',
              severity: 'error',
              message: `Clip "${clip.id}" scale keyframe value ${p.value} is negative`,
              trackIndex: clip.trackIndex,
              trackId: tracks[clip.trackIndex]?.id,
              clipId: clip.id,
              details: { property: track.property, t: p.t, value: p.value },
            })
          }
        }
      }
    }
  }

  // 2. Check overlay tracks for gaps
  if (options?.checkOverlayGaps !== false) {
    for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
      const track = tracks[tIdx]
      const isVideo = (track.kind || track.type || (track.name.startsWith('V') ? 'video' : '')) === 'video'
      // Overlay track is any video track above the base V1 (tIdx > 0 or not track-v1)
      const isOverlay = isVideo && (tIdx > 0 || (track.id !== 'track-v1' && track.name !== 'V1'))

      if (isOverlay) {
        const trackClips = clips
          .filter(c => c.trackIndex === tIdx)
          .sort((a, b) => getClipStart(a) - getClipStart(b))

        if (trackClips.length > 0) {
          let cursor = 0
          for (let i = 0; i < trackClips.length; i++) {
            const c = trackClips[i]
            const start = getClipStart(c)
            const end = getClipEnd(c)
            if (start > cursor + 0.001) {
              issues.push({
                type: 'OVERLAY_GAP',
                severity: 'warning',
                message: `Gap of ${(start - cursor).toFixed(1)}s detected on overlay track "${track.name}" between ${cursor.toFixed(1)}s and ${start.toFixed(1)}s`,
                trackIndex: tIdx,
                trackId: track.id,
                details: { start: cursor, end: start, duration: start - cursor },
              })
            }
            cursor = end
          }
        }
      }
    }
  }

  // 3. Check for overlapping subtitles
  if (subtitles.length > 1) {
    const sortedSubs = [...subtitles].sort((a, b) => a.startTime - b.startTime)
    for (let i = 0; i < sortedSubs.length; i++) {
      for (let j = i + 1; j < sortedSubs.length; j++) {
        const s1 = sortedSubs[i]
        const s2 = sortedSubs[j]
        // If s2 starts after s1 ends, no overlap with subsequent subtitles
        if (s2.startTime >= s1.endTime - 0.001) break

        // Only check overlap if on the same trackIndex (or if trackIndex undefined)
        if (s1.trackIndex === s2.trackIndex || s1.trackIndex === undefined || s2.trackIndex === undefined) {
          issues.push({
            type: 'SUBTITLE_OVERLAP',
            severity: 'error',
            message: `Overlapping subtitles detected: "${s1.text}" (${s1.startTime.toFixed(1)}s-${s1.endTime.toFixed(1)}s) overlaps with "${s2.text}" (${s2.startTime.toFixed(1)}s-${s2.endTime.toFixed(1)}s)`,
            clipIds: [s1.id, s2.id],
            details: {
              sub1: { id: s1.id, start: s1.startTime, end: s1.endTime },
              sub2: { id: s2.id, start: s2.startTime, end: s2.endTime },
            },
          })
        }
      }
    }
  }

  return issues
}
