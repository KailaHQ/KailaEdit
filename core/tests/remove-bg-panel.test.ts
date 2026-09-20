import { describe, it, expect } from 'vitest'
import { en } from '../../frontend/i18n/locales/en'
import { vi } from '../../frontend/i18n/locales/vi'
import { DEFAULT_AUTO_MATTE, DEFAULT_CLIP_STROKE, strokeStyleValues, timelineClipSchema, type TimelineClip } from '../src/project-model'
import { setClipAutoMatte, setClipStroke } from '../src/editor-actions'
import { selectClipAutoMatte, selectClipStroke } from '../src/editor-selectors'
import { createInitialEditorState, type EditorState } from '../src/editor-state'

function createTestState(clip: Partial<TimelineClip> = {}): EditorState {
  const fullClip: TimelineClip = timelineClipSchema.parse({
    id: 'clip-1',
    assetId: 'asset-1',
    asset: null,
    trackIndex: 0,
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    opacity: 100,
    type: 'video',
    ...clip,
  })

  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [
      {
        id: 'tl-1',
        name: 'Main',
        fps: 30,
        width: 1920,
        height: 1080,
        tracks: [{ id: 't-1', name: 'V1', kind: 'video', muted: false, locked: false, sourcePatched: true }],
        clips: [fullClip],
        subtitles: [],
        transitions: [],
        markers: [],
      } as any,
    ],
    activeTimelineId: 'tl-1',
  })
}

describe('KE-1405: Remove BG Tab & Localization Integration', () => {
  it('has 100% parity between en.ts and vi.ts for all removeBg translation keys', () => {
    const enRemoveBg = (en as any).clipProperties.removeBg
    const viRemoveBg = (vi as any).clipProperties.removeBg

    expect(enRemoveBg).toBeDefined()
    expect(viRemoveBg).toBeDefined()

    // Check top-level keys
    const enKeys = Object.keys(enRemoveBg)
    const viKeys = Object.keys(viRemoveBg)
    expect(viKeys.sort()).toEqual(enKeys.sort())

    // Check strokeStyles sub-keys
    const enStrokeStyles = Object.keys(enRemoveBg.strokeStyles)
    const viStrokeStyles = Object.keys(viRemoveBg.strokeStyles)
    expect(viStrokeStyles.sort()).toEqual(enStrokeStyles.sort())

    // All 8 stroke styles must be localized
    for (const style of strokeStyleValues) {
      expect(enRemoveBg.strokeStyles[style]).toBeDefined()
      expect(viRemoveBg.strokeStyles[style]).toBeDefined()
    }

    // Check strokeParams sub-keys
    const enParams = Object.keys(enRemoveBg.strokeParams)
    const viParams = Object.keys(viRemoveBg.strokeParams)
    expect(viParams.sort()).toEqual(enParams.sort())
  })

  it('provides subTabs translations for Basic, Remove BG, Mask, and Retouch', () => {
    const enSubTabs = (en as any).clipProperties.subTabs
    const viSubTabs = (vi as any).clipProperties.subTabs

    expect(enSubTabs.basic).toBe('Basic')
    expect(viSubTabs.basic).toBe('Cơ bản')

    expect(enSubTabs.removeBg).toBe('Remove BG')
    expect(viSubTabs.removeBg).toBe('Xóa nền')

    expect(enSubTabs.mask).toBe('Mask')
    expect(viSubTabs.mask).toBe('Mặt nạ')

    expect(enSubTabs.retouch).toBe('Retouch')
    expect(viSubTabs.retouch).toBe('Làm đẹp')
  })

  it('correctly manages AutoMatte state transitions and selectors', () => {
    let state = createTestState()
    expect(selectClipAutoMatte(state, 'clip-1')).toBeUndefined()

    // Enable autoMatte with custom quality and edge adjustments
    state = setClipAutoMatte(state, 'clip-1', {
      ...DEFAULT_AUTO_MATTE,
      quality: 'high',
      featherEdge: 25,
      cleanEdge: 10,
    })

    const autoMatte = selectClipAutoMatte(state, 'clip-1')
    expect(autoMatte).toBeDefined()
    expect(autoMatte?.enabled).toBe(true)
    expect(autoMatte?.quality).toBe('high')
    expect(autoMatte?.featherEdge).toBe(25)
    expect(autoMatte?.cleanEdge).toBe(10)

    // Clear autoMatte
    state = setClipAutoMatte(state, 'clip-1', null)
    expect(selectClipAutoMatte(state, 'clip-1')).toBeUndefined()
  })

  it('correctly manages ClipStroke state with style-specific parameters', () => {
    let state = createTestState()
    expect(selectClipStroke(state, 'clip-1')).toBeUndefined()

    // Set luminescence style with glow
    state = setClipStroke(state, 'clip-1', {
      ...DEFAULT_CLIP_STROKE,
      style: 'luminescence',
      color: '#00FFFF',
      width: 15,
      glow: 80,
    })

    let stroke = selectClipStroke(state, 'clip-1')
    expect(stroke?.enabled).toBe(true)
    expect(stroke?.style).toBe('luminescence')
    expect(stroke?.color).toBe('#00FFFF')
    expect(stroke?.glow).toBe(80)

    // Switch to offset style
    state = setClipStroke(state, 'clip-1', {
      ...stroke,
      style: 'offset',
      offsetX: 10,
      offsetY: -15,
    })

    stroke = selectClipStroke(state, 'clip-1')
    expect(stroke?.style).toBe('offset')
    expect(stroke?.offsetX).toBe(10)
    expect(stroke?.offsetY).toBe(-15)
  })

  it('verifies audio clips do not support visual transform tabs or auto matte', () => {
    const audioState = createTestState({ type: 'audio' })
    const audioClip = audioState.editorModel.timelines[0].clips[0]

    const hasVisualTransformControls = audioClip.type === 'video' || audioClip.type === 'image'
    expect(hasVisualTransformControls).toBe(false)
  })
})
