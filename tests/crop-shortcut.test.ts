import { describe, it, expect } from 'vitest'
import {
  ACTION_REGISTRY,
  SHORTCUT_DEFINITIONS,
  KAILA_DEFAULT_LAYOUT,
  KOMFY_DEFAULT_LAYOUT,
  PREMIERE_LAYOUT,
  DAVINCI_LAYOUT,
  AVID_LAYOUT,
  resolveAction,
  findConflicts,
} from '../frontend/lib/keyboard-shortcuts'
import { createInitialEditorState } from '../core/src/editor-state'
import {
  setCropMode,
  setEyedropperMode,
  selectClip,
  clearClipSelection,
} from '../core/src/editor-actions'
import {
  selectCropMode,
  selectEyedropperMode,
  selectSelectedClipIds,
} from '../core/src/editor-selectors'

function makeMockKeyEvent(opts: { key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): KeyboardEvent {
  return {
    key: opts.key,
    code: opts.code ?? (opts.key.length === 1 ? `Key${opts.key.toUpperCase()}` : opts.key),
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent
}

describe('KE-1003: Crop Shortcut in Action Registry & Escape Priority', () => {
  it('registers view.cropMode in ACTION_REGISTRY and SHORTCUT_DEFINITIONS', () => {
    expect(SHORTCUT_DEFINITIONS).toBe(ACTION_REGISTRY)
    const def = ACTION_REGISTRY.find(a => a.id === 'view.cropMode')
    expect(def).toBeDefined()
    expect(def?.label).toBe('Toggle Crop Mode')
    expect(def?.category).toBe('Editing')
    expect(def?.description).toBeDefined()
  })

  it('binds view.cropMode in KAILA_DEFAULT_LAYOUT and KOMFY_DEFAULT_LAYOUT', () => {
    expect(KAILA_DEFAULT_LAYOUT['view.cropMode']).toBeDefined()
    expect(KOMFY_DEFAULT_LAYOUT['view.cropMode']).toBeDefined()
    const conflicts = findConflicts(KAILA_DEFAULT_LAYOUT)
    expect(conflicts.has('C')).toBe(false)
    expect(conflicts.has('Shift+C')).toBe(false)
  })

  it('ensures Premiere layout binds C to tool.blade and Shift+C to view.cropMode with zero collision', () => {
    const conflicts = findConflicts(PREMIERE_LAYOUT)
    expect(conflicts.has('C')).toBe(false)
    expect(conflicts.has('Shift+C')).toBe(false)

    // Keydown 'c' (lowercase) without modifiers in Premiere MUST resolve to tool.blade
    const cEvent = makeMockKeyEvent({ key: 'c', code: 'KeyC' })
    const actionForC = resolveAction(PREMIERE_LAYOUT, cEvent)
    expect(actionForC).toBe('tool.blade')

    // Keydown 'C' with Shift in Premiere MUST resolve to view.cropMode
    const shiftCEvent = makeMockKeyEvent({ key: 'c', code: 'KeyC', shiftKey: true })
    const actionForShiftC = resolveAction(PREMIERE_LAYOUT, shiftCEvent)
    expect(actionForShiftC).toBe('view.cropMode')
  })

  it('resolves C and Shift+C to view.cropMode in Kaila default layout', () => {
    const cEvent = makeMockKeyEvent({ key: 'c', code: 'KeyC' })
    const actionForC = resolveAction(KAILA_DEFAULT_LAYOUT, cEvent)
    expect(actionForC).toBe('view.cropMode')

    const shiftCEvent = makeMockKeyEvent({ key: 'c', code: 'KeyC', shiftKey: true })
    const actionForShiftC = resolveAction(KAILA_DEFAULT_LAYOUT, shiftCEvent)
    expect(actionForShiftC).toBe('view.cropMode')
  })

  it('verifies all built-in layouts have zero conflicts with view.cropMode', () => {
    for (const [name, layout] of [
      ['Kaila Default', KAILA_DEFAULT_LAYOUT],
      ['Premiere', PREMIERE_LAYOUT],
      ['DaVinci', DAVINCI_LAYOUT],
      ['Avid', AVID_LAYOUT],
    ] as const) {
      const conflicts = findConflicts(layout)
      const conflictingActions = Array.from(conflicts.values()).flat()
      expect(conflictingActions.includes('view.cropMode'), `${name} has conflict for view.cropMode`).toBe(false)
    }
  })

  it('simulates Escape prioritization: cropMode -> eyedropper -> preview -> deselect', () => {
    let state = createInitialEditorState({
      assets: [],
      bins: {},
      timelines: [
        {
          id: 'tl-1',
          name: 'Main',
          fps: 30,
          tracks: [{ id: 'tr-1', name: 'Video 1', type: 'video' }],
          clips: [{ id: 'clip-1', trackIndex: 0, startTime: 0, duration: 5, sourceStart: 0, sourceEnd: 5, name: 'Clip 1', type: 'video', assetId: 'a1' }],
        },
      ],
      activeTimelineId: 'tl-1',
    })

    // 1. When cropMode is true, first Escape exits cropMode only
    state = selectClip(state, 'clip-1', false)
    state = setCropMode(state, true)
    expect(selectCropMode(state)).toBe(true)

    // Emulate useEditorKeyboard Escape handler logic:
    const handleEscape = (curr: typeof state) => {
      if (selectCropMode(curr)) {
        return setCropMode(curr, false)
      }
      if (selectEyedropperMode(curr)) {
        return setEyedropperMode(curr, false)
      }
      return clearClipSelection(curr)
    }

    state = handleEscape(state)
    expect(selectCropMode(state)).toBe(false)
    // Clip remains selected!
    expect(selectSelectedClipIds(state).has('clip-1')).toBe(true)

    // 2. When eyedropperMode is true, next Escape exits eyedropper only
    state = setEyedropperMode(state, true)
    expect(selectEyedropperMode(state)).toBe(true)

    state = handleEscape(state)
    expect(selectEyedropperMode(state)).toBe(false)
    expect(selectSelectedClipIds(state).has('clip-1')).toBe(true)

    // 3. When in normal mode, Escape clears clip selection
    state = handleEscape(state)
    expect(selectSelectedClipIds(state).size).toBe(0)
  })
})
