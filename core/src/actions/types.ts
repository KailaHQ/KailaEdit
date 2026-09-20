import type {
  Asset,
  SubtitleStyle,
  TextOverlayStyle,
} from '../project-model'
import type { TimelineGapSelection } from '../editor-state'

export interface InsertAssetsToTimelineParams {
  assets: Asset[]
  trackIndex?: number
  startTime?: number
  /**
   * Where to drop the assets when no `startTime` is given.
   *
   * 'end' (the default) appends after whatever is already on the track, and
   * is what the MCP `insert_clip` operation relies on. 'start' puts them in
   * front of the existing edit and is what the Add button in the asset panel
   * asks for; it only applies to the magnetic main video track, because on
   * any other track resolveOverlaps would trim what it lands on rather than
   * push it aside.
   */
  position?: 'start' | 'end'
}

export interface AddTextClipParams {
  style?: Partial<TextOverlayStyle>
  startTime?: number
  trackIndex?: number
  duration?: number
  preset?: string
  animation?: string
}

export interface AddAdjustmentLayerParams {
  duration?: number
  trackIndex?: number
  startTime?: number
}

export interface MoveClipsParams {
  clipIds: string[]
  deltaTime?: number
  targetTrackIndex?: number
}

export interface ResizeClipParams {
  clipId: string
  edge: 'start' | 'end'
  deltaTime: number
}

export interface SlipClipParams {
  clipId: string
  deltaTime: number
}

export interface SlideClipParams {
  clipId: string
  deltaTime: number
}

export interface AddSubtitleParams {
  trackIndex: number
  text?: string
  startTime?: number
  endTime?: number
  style?: Partial<SubtitleStyle>
}

export interface InsertGeneratedGapAssetParams {
  gap: TimelineGapSelection
  asset: Asset
  createAudio: boolean
}

export interface SourceEditParams {
  asset: Asset
  sourceIn: number | null
  sourceOut: number | null
  sourceTime: number
}

export interface SelectClipMode {
  mode?: 'replace' | 'toggle' | 'add'
}

export interface InsertBrollParams {
  assetId?: string
  assetPath?: string
  startTime: number
  duration: number
  trackIndex?: number
  fadeIn?: number
  fadeOut?: number
  muteAudio?: boolean
}

export interface AddMarkerParams {
  time?: number
  label?: string
  color?: string
  id?: string
}

export interface FreezeFrameParams {
  clipId: string
  time?: number
  duration?: number
  imageAsset?: Asset
}
