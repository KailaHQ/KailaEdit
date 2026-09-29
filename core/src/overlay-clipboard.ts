import type { Asset, ShapeProperties, TextOverlayStyle, TimelineClip, Track } from './project-model'
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_COLOR_CORRECTION, DEFAULT_TEXT_STYLE } from './project-model'
import { fitMediaInFrame } from './video-editor-utils'

/**
 * Objects copied out of the cover designer, waiting to be pasted onto the timeline.
 *
 * They are stored already in timeline terms — a text style, a shape's look, an image file
 * on disk — plus where they sat on the cover, as percentages of the frame. What they turn
 * into on paste depends on the timeline's frame size, so that is worked out then.
 */

/** How long a pasted cover object stays on screen. */
export const OVERLAY_PASTE_DURATION = 3

/** A box on the frame: centre and size, each a percentage of the frame's width or height. */
export interface OverlayBox {
  x: number
  y: number
  width: number
  height: number
}

export type OverlayClipboardItem =
  | {
    kind: 'text'
    textStyle: Partial<TextOverlayStyle> & { text: string }
    rotation: number
  }
  | {
    kind: 'shape'
    /** A shape id from the shape library (`cover-shapes`), e.g. 'circle'. */
    shapeType: string
    shapeProperties: ShapeProperties
    box: OverlayBox
    rotation: number
    /** 0–100. */
    opacity: number
  }
  | {
    kind: 'image'
    /** The picture as a file, already sized to what the cover showed (crop, filters baked in). */
    asset: Asset
    box: OverlayBox
    rotation: number
    /** 0–100. */
    opacity: number
  }

/** The square image every shape clip is drawn into (see `addStickerClip`). */
const SHAPE_IMAGE_SIZE = 512

function trackPrefix(kind: Track['kind']): string {
  return kind === 'audio' ? 'A' : kind === 'sticker' ? 'S' : 'V'
}

/**
 * The transform that puts a picture of `media` size exactly over `box`.
 *
 * The inverse of `clipScreenBox`: a picture is fitted into the frame, stretched by
 * scaleX / scaleY, and moved by positionX / positionY — percentages of the frame, from its
 * centre.
 */
export function transformForBox(
  frame: { width: number; height: number },
  media: { width?: number; height?: number },
  box: OverlayBox,
  rotation: number,
): TimelineClip['transform'] {
  const fitted = fitMediaInFrame(frame, media)
  const round = (value: number) => Math.round(value * 10) / 10
  const scaleX = round(((box.width / 100) * frame.width / fitted.width) * 100)
  const scaleY = round(((box.height / 100) * frame.height / fitted.height) * 100)
  return {
    ...DEFAULT_CLIP_TRANSFORM,
    scale: Math.round(Math.max(scaleX, scaleY)),
    scaleX,
    scaleY,
    positionX: round(box.x - 50),
    positionY: round(box.y - 50),
    rotation: rotation || 0,
  }
}

function baseClip(id: string, startTime: number, duration: number, trackIndex: number): TimelineClip {
  return {
    id,
    assetId: null,
    type: 'text',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
  }
}

/**
 * Lays copied cover objects onto the timeline at `atTime`: one new track each, above
 * every existing one, in the cover's stacking order — so what was on top of the cover is
 * on the top track. Each lasts `duration` seconds.
 *
 * Returns the tracks and clips to add, and the assets the clips need.
 */
export function buildOverlayPaste(params: {
  tracks: Track[]
  items: ReadonlyArray<OverlayClipboardItem>
  atTime: number
  frame: { width: number; height: number }
  makeId: (prefix: string) => string
  duration?: number
  now?: number
}): { tracks: Track[]; clips: TimelineClip[]; assets: Asset[] } {
  const { items, frame, makeId } = params
  const duration = params.duration ?? OVERLAY_PASTE_DURATION
  const startTime = Math.max(0, params.atTime)
  const now = params.now ?? Date.now()
  const tracks = [...params.tracks]
  const clips: TimelineClip[] = []
  const assets: Asset[] = []

  const addTrack = (kind: 'video' | 'sticker'): number => {
    const sameKind = tracks.filter(track => (track.kind ?? 'video') === kind && track.type !== 'subtitle').length
    tracks.push({
      id: makeId('track'),
      name: `${trackPrefix(kind)}${sameKind + 1}`,
      muted: false,
      locked: false,
      kind,
    })
    return tracks.length - 1
  }

  for (const item of items) {
    if (item.kind === 'text') {
      // Text is an overlay row like any title; shapes are stickers, which live on
      // sticker rows (see `addStickerClip`).
      const trackIndex = addTrack('video')
      clips.push({
        ...baseClip(makeId('clip-text'), startTime, duration, trackIndex),
        type: 'text',
        transform: { ...DEFAULT_CLIP_TRANSFORM, rotation: item.rotation || 0 },
        textStyle: { ...DEFAULT_TEXT_STYLE, ...item.textStyle, text: item.textStyle.text },
      })
      continue
    }

    if (item.kind === 'shape') {
      const trackIndex = addTrack('sticker')
      const stickerId = `shape-${item.shapeType}`
      const asset: Asset = {
        id: makeId('asset-sticker'),
        type: 'image',
        path: `stickers/${stickerId}.png`,
        prompt: `Sticker: ${stickerId}`,
        resolution: `${SHAPE_IMAGE_SIZE}x${SHAPE_IMAGE_SIZE}`,
        width: SHAPE_IMAGE_SIZE,
        height: SHAPE_IMAGE_SIZE,
        duration,
        createdAt: now,
        source: 'sticker',
      }
      assets.push(asset)
      clips.push({
        ...baseClip(makeId('clip-sticker'), startTime, duration, trackIndex),
        type: 'image',
        assetId: asset.id,
        asset,
        importedName: `Sticker: ${stickerId}`,
        stickerId,
        transform: transformForBox(frame, asset, item.box, item.rotation),
        opacity: item.opacity,
        shapeProperties: { ...item.shapeProperties },
      })
      continue
    }

    const trackIndex = addTrack('video')
    assets.push(item.asset)
    clips.push({
      ...baseClip(makeId('clip-image'), startTime, duration, trackIndex),
      type: 'image',
      assetId: item.asset.id,
      asset: item.asset,
      transform: transformForBox(frame, item.asset, item.box, item.rotation),
      opacity: item.opacity,
    })
  }

  return { tracks, clips, assets }
}
