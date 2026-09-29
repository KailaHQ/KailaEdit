import type { ExportClipEffect } from './effects-filter'
import type { KeyframeTrack, ClipMask, ChromaKey, AutoMatte, ClipStroke } from '../../core/src/project-model'
import type { ClipBlendMode } from '../../core/src/blend-modes'

export interface ExportClipTransform {
  /** Per-axis scale; absent means the uniform `scale`. */
  scaleX?: number; scaleY?: number;
  scale: number; positionX: number; positionY: number; rotation: number;
  cropTop: number; cropRight: number; cropBottom: number; cropLeft: number;
}

export interface ExportColorCorrection {
  brightness: number; contrast: number; saturation: number; temperature: number;
  tint: number; exposure: number; highlights: number; shadows: number;
}

export interface ExportClipTransition {
  type: string; duration: number;
}

export interface ExportTextStyle {
  text: string; fontSize: number; color: string; backgroundColor: string;
  positionX: number; positionY: number; strokeColor: string; strokeWidth: number;
  padding: number; opacity: number;
}

export interface ExportClip {
  path: string; type: string; startTime: number; duration: number; trimStart: number;
  speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number;
  muted: boolean; volume: number;
  /** Ids of clips this one is A/V-linked to. */
  linkedClipIds?: string[];
  id?: string;
  assetId?: string | null;
  transform?: ExportClipTransform;
  colorCorrection?: ExportColorCorrection;
  transitionIn?: ExportClipTransition;
  transitionOut?: ExportClipTransition;
  filter?: { id: string; intensity?: number };
  effects?: ExportClipEffect[];
  textStyle?: ExportTextStyle;
  keyframes?: KeyframeTrack[];
  mask?: ClipMask;
  chromaKey?: ChromaKey;
  blendMode?: ClipBlendMode;
  autoMatte?: AutoMatte;
  stroke?: ClipStroke;
  strokeBakePath?: string;
}

/**
 * Total timeline length, used to size the base canvas the clips composite onto.
 */
export function getTimelineDuration(clips: ExportClip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
}
