// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Asset, StabilizationBake, TimelineClip } from '@core/project-model'
import { DEFAULT_CLIP_STABILIZATION } from '@core/project-model'
import { createInitialEditorState } from '@core/editor-state'
import { selectClipById } from '@core/editor-selectors'
import { setClipStabilization, updateClip } from '@core/editor-actions'
import { computeStabilizationFingerprint } from '@core/stabilization'
import { createEditorStore, EditorStoreProvider, type EditorStoreApi } from '../../views/editor/editor-store'
import { __resetStabilizeBakeState, cancelClipStabilization, retryClipStabilization, useStabilizeBakeKeeper } from '../useStabilizeBake'
import { createMockClip, createMockTimeline } from '../../../core/tests/edit-patch-test-helpers'

const ASSET: Asset = {
  id: 'asset-1', type: 'video', path: 'C:/media/IMG_4692.MOV', prompt: '', resolution: '',
  duration: 152.5, createdAt: 0,
}

type ProgressHandler = (event: { jobId: string; percent: number; phase: string; bake?: StabilizationBake; error?: string }) => void

let root: Root
let store: EditorStoreApi
let onProgress: ProgressHandler | null
let api: {
  stabilizeStart: ReturnType<typeof vi.fn>
  stabilizeCancel: ReturnType<typeof vi.fn>
  stabilizeMissing: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

function Keeper() {
  useStabilizeBakeKeeper('project-1')
  return null
}

function clipWithStabilization(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'clip-1', asset: ASSET, trimStart: 0, duration: 10, trimEnd: 142.5,
    stabilization: { ...DEFAULT_CLIP_STABILIZATION }, ...overrides,
  })
}

function bakeFor(sourceStart: number, sourceSpan: number, smoothing = 20): StabilizationBake {
  return {
    path: 'C:/cache/stab.mp4',
    fingerprint: computeStabilizationFingerprint({ smoothing, mode: 'auto', sourceStart, sourceSpan }),
    createdAt: 1, sourceStart, sourceSpan, assetKey: 'asset-1', zoomPercent: 3.5,
  }
}

async function mount(clip: TimelineClip) {
  const timeline = createMockTimeline([clip])
  store = createEditorStore(createInitialEditorState({
    assets: [ASSET], bins: {}, timelines: [timeline], activeTimelineId: timeline.id,
  }))
  root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(<EditorStoreProvider store={store}><Keeper /></EditorStoreProvider>)
  })
}

/** Lets the keeper's start delay run out and its IPC promises settle. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
}

const clipNow = () => selectClipById(store.getState().state, 'clip-1')

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  __resetStabilizeBakeState()
  onProgress = null
  api = {
    stabilizeStart: vi.fn(async () => ({ started: true })),
    stabilizeCancel: vi.fn(async () => ({ success: true })),
    stabilizeMissing: vi.fn(async () => ({ missing: [] })),
    on: vi.fn((channel: string, handler: ProgressHandler) => {
      if (channel === 'stabilize:progress') onProgress = handler
      return () => {}
    }),
  }
  ;(window as any).electronAPI = api
})

afterEach(async () => {
  await act(async () => root?.unmount())
  vi.useRealTimers()
  delete (window as any).electronAPI
})

it('queues a bake for the range the clip shows, with a handle', async () => {
  await mount(clipWithStabilization({ trimStart: 20, trimEnd: 122.5 }))
  expect(api.stabilizeStart).not.toHaveBeenCalled()
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
  expect(api.stabilizeStart.mock.calls[0][0]).toMatchObject({
    assetId: 'asset-1',
    filePath: 'C:/media/IMG_4692.MOV',
    sourceStart: 19,
    sourceSpan: 12,
    smoothing: 20,
    mode: 'auto',
    hdrOutput: 'sdr',
  })
})

it('records the finished bake without an undo step', async () => {
  await mount(clipWithStabilization())
  await settle()
  const { jobId } = api.stabilizeStart.mock.calls[0][0]
  const undoDepth = store.getState().state.history.undoStack.length

  await act(async () => {
    onProgress!({ jobId, percent: 50, phase: 'stabilizing' })
    onProgress!({ jobId, percent: 100, phase: 'done', bake: bakeFor(0, 11) })
  })
  expect(clipNow()?.stabilization?.bake?.path).toBe('C:/cache/stab.mp4')
  expect(store.getState().state.history.undoStack.length).toBe(undoDepth)

  // Nothing further to do once the clip has a bake that fits.
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
})

it('takes a cached bake straight from the start call', async () => {
  api.stabilizeStart.mockResolvedValueOnce({ started: false, cached: true, bake: bakeFor(0, 11) })
  await mount(clipWithStabilization())
  await settle()
  expect(clipNow()?.stabilization?.bake?.fingerprint).toBe(bakeFor(0, 11).fingerprint)
})

it('drops a bake that no longer fits when it lands', async () => {
  await mount(clipWithStabilization())
  await settle()
  const { jobId } = api.stabilizeStart.mock.calls[0][0]
  // The user changed the smoothing while the job ran.
  await act(async () => {
    store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { smoothing: 40 }))
  })
  await act(async () => {
    onProgress!({ jobId, percent: 100, phase: 'done', bake: bakeFor(0, 11, 20) })
  })
  expect(clipNow()?.stabilization?.bake).toBeUndefined()
})

it('cancels a stale job and starts one for the new settings', async () => {
  await mount(clipWithStabilization())
  await settle()
  const first = api.stabilizeStart.mock.calls[0][0].jobId
  await act(async () => {
    store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { smoothing: 35 }))
  })
  await settle()
  expect(api.stabilizeCancel).toHaveBeenCalledWith({ jobId: first })
  expect(api.stabilizeStart).toHaveBeenCalledTimes(2)
  expect(api.stabilizeStart.mock.calls[1][0].smoothing).toBe(35)
})

it('cancels when stabilization is switched off', async () => {
  await mount(clipWithStabilization())
  await settle()
  await act(async () => {
    store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { enabled: false }))
  })
  await settle()
  expect(api.stabilizeCancel).toHaveBeenCalledTimes(1)
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
})

it('coalesces a slider drag into one job', async () => {
  await mount(clipWithStabilization({ stabilization: undefined }))
  await act(async () => {
    for (const smoothing of [21, 24, 28, 31]) {
      store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { smoothing }))
      await vi.advanceTimersByTimeAsync(100)
    }
  })
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
  expect(api.stabilizeStart.mock.calls[0][0].smoothing).toBe(31)
})

it('does not retry a failed request on its own', async () => {
  api.stabilizeStart.mockResolvedValue({ started: false, error: 'boom' })
  await mount(clipWithStabilization())
  await settle()
  await act(async () => {
    // An unrelated edit re-runs the keeper; the same failed request is not sent again.
    store.getState().setStateWithHistory(prev => updateClip(prev, 'clip-1', { opacity: 50 }))
  })
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
  expect(clipNow()?.opacity).toBe(50)

  // A different request — new settings — is tried.
  await act(async () => {
    store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { smoothing: 30 }))
  })
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(2)
})

it('forgets a bake whose file is gone', async () => {
  api.stabilizeMissing.mockResolvedValue({ missing: ['C:/cache/stab.mp4'] })
  api.stabilizeStart.mockResolvedValue({ started: true })
  await mount(clipWithStabilization({ stabilization: { ...DEFAULT_CLIP_STABILIZATION, bake: bakeFor(0, 11) } }))
  await settle()
  expect(clipNow()?.stabilization?.bake).toBeUndefined()
  // ...and bakes it again.
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)
})

it('remembers a failed request after its job record is gone, until retried', async () => {
  api.stabilizeStart.mockResolvedValueOnce({ started: false, error: 'boom' })
  await mount(clipWithStabilization())
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)

  // Away to other settings and back: the failed request is not sent again by itself.
  for (const smoothing of [30, 20]) {
    await act(async () => {
      store.getState().setStateWithHistory(prev => setClipStabilization(prev, 'clip-1', { smoothing }))
    })
    await settle()
  }
  expect(api.stabilizeStart.mock.calls.map(c => c[0].smoothing)).toEqual([20, 30])

  // The panel's retry forgets it.
  retryClipStabilization('clip-1')
  await act(async () => {
    store.getState().setStateWithHistory(prev => updateClip(prev, 'clip-1', { opacity: 60 }))
  })
  await settle()
  expect(api.stabilizeStart.mock.calls.map(c => c[0].smoothing)).toEqual([20, 30, 20])
})

it('a retry alone restarts the job, with no clip edit to wake the keeper', async () => {
  await mount(clipWithStabilization())
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)

  await act(async () => { cancelClipStabilization('clip-1') })
  await settle()
  expect(api.stabilizeCancel).toHaveBeenCalledTimes(1)
  // Held: the cancel is not undone by the keeper's next look.
  expect(api.stabilizeStart).toHaveBeenCalledTimes(1)

  await act(async () => { retryClipStabilization('clip-1') })
  await settle()
  expect(api.stabilizeStart).toHaveBeenCalledTimes(2)
})
