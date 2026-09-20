import type {
  ClipTransform,
  ColorCorrection,
  SubtitleStyle,
  Timeline,
  TimelineClip,
  Track,
} from '../project-model'
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_SUBTITLE_STYLE,
} from '../project-model'
import type { EditorState } from '../editor-state'
import {
  selectActiveTimeline,
  selectClips,
  selectTracks,
  selectSubtitles,
  selectClipPath,
} from '../editor-selectors'

export interface ExportLetterbox {
  ratio: number
  color: string
  opacity: number
}

export interface ExportClipData {
  path: string
  type: string
  startTime: number
  duration: number
  trimStart: number
  speed: number
  reversed: boolean
  flipH: boolean
  flipV: boolean
  opacity: number
  trackIndex: number
  muted: boolean
  volume: number
  id: string
  linkedClipIds?: string[]
  transform?: ClipTransform
  colorCorrection?: ColorCorrection
  transitionIn?: { type: string; duration: number }
  transitionOut?: { type: string; duration: number }
  effects?: Array<{ type: string; enabled: boolean; params: Record<string, number> }>
  textStyle?: {
    text: string
    fontSize: number
    color: string
    backgroundColor: string
    positionX: number
    positionY: number
    strokeColor: string
    strokeWidth: number
    padding: number
    opacity: number
  }
}

export interface ExportSubtitleData {
  text: string
  startTime: number
  endTime: number
  style: SubtitleStyle
}

export interface ExportModalModel {
  timeline: Timeline | null
  clips: TimelineClip[]
  tracks: Track[]
  exportClips: ExportClipData[]
  subtitleData: ExportSubtitleData[]
  letterbox: ExportLetterbox | null
}

export const LETTERBOX_RATIO_MAP: Record<string, number> = {
  '2.35:1': 2.35,
  '2.39:1': 2.39,
  '2.76:1': 2.76,
  '1.85:1': 1.85,
  '4:3': 4 / 3,
}

export function selectExportLetterbox(state: EditorState): ExportLetterbox | null {
  const clips = selectClips(state)
  const tracks = selectTracks(state)
  const adjustmentClips = clips.filter(
    clip =>
      clip.type === 'adjustment'
      && clip.letterbox?.enabled
      && tracks[clip.trackIndex]?.enabled !== false,
  )
  if (adjustmentClips.length === 0) return null

  const best = adjustmentClips.reduce((currentBest, candidate) => (
    candidate.duration > currentBest.duration ? candidate : currentBest
  ))
  const letterbox = best.letterbox!
  return {
    ratio: letterbox.aspectRatio === 'custom'
      ? (letterbox.customRatio || 2.35)
      : (LETTERBOX_RATIO_MAP[letterbox.aspectRatio] || 2.35),
    color: letterbox.color || '#000000',
    opacity: (letterbox.opacity ?? 100) / 100,
  }
}

export function selectExportClipData(state: EditorState): ExportClipData[] {
  const tracks = selectTracks(state)
  return selectClips(state)
    .filter(clip => clip.type === 'video' || clip.type === 'image' || clip.type === 'audio' || clip.type === 'text')
    .filter(clip => tracks[clip.trackIndex]?.enabled !== false)
    .map(clip => ({
      path: selectClipPath(state, clip),
      type: clip.type,
      startTime: clip.startTime,
      duration: clip.duration,
      trimStart: clip.trimStart,
      speed: clip.speed || 1,
      reversed: clip.reversed || false,
      flipH: clip.flipH || false,
      flipV: clip.flipV || false,
      opacity: clip.opacity ?? 100,
      trackIndex: clip.trackIndex,
      muted: clip.muted || false,
      volume: clip.volume ?? 1,
      id: clip.id,
      linkedClipIds: clip.linkedClipIds,
      transform: clip.transform ?? DEFAULT_CLIP_TRANSFORM,
      colorCorrection: clip.colorCorrection ?? DEFAULT_COLOR_CORRECTION,
      transitionIn: clip.transitionIn,
      transitionOut: clip.transitionOut,
      effects: clip.effects?.map(effect => ({
        type: effect.type,
        enabled: effect.enabled,
        params: effect.params,
      })),
      textStyle: clip.textStyle && {
        text: clip.textStyle.text,
        fontSize: clip.textStyle.fontSize,
        color: clip.textStyle.color,
        backgroundColor: clip.textStyle.backgroundColor,
        positionX: clip.textStyle.positionX,
        positionY: clip.textStyle.positionY,
        strokeColor: clip.textStyle.strokeColor,
        strokeWidth: clip.textStyle.strokeWidth,
        padding: clip.textStyle.padding,
        opacity: clip.textStyle.opacity,
      },
    }))
}

export function selectExportSubtitleData(state: EditorState): ExportSubtitleData[] {
  const subtitles = selectSubtitles(state)
  const tracks = selectTracks(state)
  return subtitles.map(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return {
      text: subtitle.text,
      startTime: subtitle.startTime,
      endTime: subtitle.endTime,
      style: {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(track?.subtitleStyle || {}),
        ...(subtitle.style || {}),
      },
    }
  })
}

export function selectExportModalModel(state: EditorState): ExportModalModel {
  return {
    timeline: selectActiveTimeline(state),
    clips: selectClips(state),
    tracks: selectTracks(state),
    exportClips: selectExportClipData(state),
    subtitleData: selectExportSubtitleData(state),
    letterbox: selectExportLetterbox(state),
  }
}
