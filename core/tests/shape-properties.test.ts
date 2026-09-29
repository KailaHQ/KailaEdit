import { describe, it, expect } from 'vitest'
import {
  addStickerClip,
  updateClip,
} from '../src/editor-actions'
import { createInitialEditorState } from '../src/editor-state'
import { timelineClipSchema, type Timeline, type TimelineClip } from '../src/project-model'
import { executePatchOperations } from '../src/patch/patch-executor'
import { describePatch } from '../src/patch/patch-describer'
import { selectClips } from '../src/editor-selectors'
import {
  isTimelineShapeClip,
  timelineShapeToSvgString,
  timelineShapeToDataUrl,
} from '../../frontend/views/editor/timeline-shape-utils'

function baseState() {
  const timeline = {
    id: 'timeline-1',
    name: 'Timeline 1',
    createdAt: 0,
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
    ],
    clips: [],
    subtitles: [],
    width: 720,
    height: 1280,
  } as unknown as Timeline

  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

const createBaseClip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip-1',
  assetId: 'asset-1',
  type: 'image',
  startTime: 0,
  duration: 5,
  trimStart: 0,
  trimEnd: 0,
  speed: 1,
  reversed: false,
  muted: false,
  volume: 1,
  trackIndex: 0,
  asset: {
    id: 'asset-1',
    type: 'image',
    path: 'stickers/shape-circle.png',
    prompt: 'Shape',
    resolution: '512x512',
    createdAt: Date.now(),
  },
  flipH: false,
  flipV: false,
  transitionIn: { type: 'none', duration: 0 },
  transitionOut: { type: 'none', duration: 0 },
  colorCorrection: {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
  },
  ...overrides,
} as TimelineClip)

describe('Timeline Shape Properties', () => {
  it('preserves shapeProperties when adding a shape clip via addStickerClip', () => {
    let state = baseState()
    state = addStickerClip(state, {
      stickerId: 'shape-square',
      shapeProperties: {
        fillColor: '#ef4444',
        strokeColor: '#00ff00',
        strokeWidth: 4,
        strokeDasharray: '8 6',
        cornerRounding: 20,
        sides: 4,
      },
    })

    const clips = selectClips(state)
    const shapeClip = clips.find(c => c.stickerId === 'shape-square')
    expect(shapeClip).toBeDefined()
    expect(shapeClip?.shapeProperties).toEqual({
      fillColor: '#ef4444',
      strokeColor: '#00ff00',
      strokeWidth: 4,
      strokeDasharray: '8 6',
      cornerRounding: 20,
      sides: 4,
    })
  })

  it('validates shapeProperties through timelineClipSchema', () => {
    const raw = createBaseClip({
      stickerId: 'shape-circle',
      shapeProperties: {
        fillColor: '#3b82f6',
        strokeColor: '#ffffff',
        strokeWidth: 2,
      },
    })

    const parsed = timelineClipSchema.parse(raw)
    expect(parsed.shapeProperties?.fillColor).toBe('#3b82f6')
    expect(parsed.shapeProperties?.strokeWidth).toBe(2)
  })

  it('allows updating shape properties via updateClip action', () => {
    let state = baseState()
    state = addStickerClip(state, {
      stickerId: 'shape-star',
    })

    const clipId = selectClips(state)[0].id
    state = updateClip(state, clipId, {
      shapeProperties: {
        fillColor: '#eab308',
        strokeColor: '#000000',
        strokeWidth: 3,
      },
    })

    const updated = selectClips(state).find(c => c.id === clipId)
    expect(updated?.shapeProperties?.fillColor).toBe('#eab308')
    expect(updated?.shapeProperties?.strokeWidth).toBe(3)
  })

  it('supports updating shape properties through update_clip patch in MCP autopilot', () => {
    let state = baseState()
    state = addStickerClip(state, {
      stickerId: 'shape-polygon',
    })

    const clipId = selectClips(state)[0].id
    const result = executePatchOperations(state, [
      {
        op: 'update_clip',
        clipId,
        patch: {
          shapeProperties: {
            sides: 6,
            cornerRounding: 15,
            fillColor: '#8b5cf6',
          },
        },
      },
    ])

    const updated = selectClips(result).find(c => c.id === clipId)
    expect(updated?.shapeProperties?.sides).toBe(6)
    expect(updated?.shapeProperties?.cornerRounding).toBe(15)
    expect(updated?.shapeProperties?.fillColor).toBe('#8b5cf6')

    const description = describePatch(state, {
      version: 1,
      operations: [
        {
          op: 'update_clip',
          clipId,
          patch: {
            shapeProperties: {
              sides: 6,
            },
          },
        },
      ],
    })
    expect(description).toContain('shapeProperties')
  })

  it('generates valid SVG markup and data URL from shape clip properties', () => {
    const clip = createBaseClip({
      stickerId: 'shape-square',
      shapeProperties: {
        fillColor: '#10b981',
        strokeColor: '#ffffff',
        strokeWidth: 5,
        cornerRounding: 25,
      },
    })

    expect(isTimelineShapeClip(clip)).toBe(true)

    const svg = timelineShapeToSvgString(clip, 200, 200)
    expect(svg).toContain('fill="#10b981"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toContain('stroke-width="5"')
    expect(svg).toContain('<svg')

    const dataUrl = timelineShapeToDataUrl(clip)
    expect(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  })
})
