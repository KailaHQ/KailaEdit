import { useEffect, useRef, useState } from 'react'
import type { StabilizationBake, TimelineClip } from '@core/project-model'
import {
  activeClipStabilization,
  clipSourceRange,
  computeStabilizationFingerprint,
  isStabilizationBakeValid,
  stabilizationBakeRange,
  stabilizationContextForClip,
} from '@core/stabilization'
import { setClipStabilizationBake } from '@core/editor-actions'
import { selectAssets, selectClipById, selectClips } from '@core/editor-selectors'
import { useEditorStore, useEditorStoreApi } from '../views/editor/editor-store'

/*
 * Keeps every stabilized clip supplied with a bake.
 *
 * Whenever a clip has stabilization on and no bake that covers what it shows with its
 * current settings, a job is queued in the main process; when it lands, the bake is
 * recorded on the clip. Until then the clip plays its original — `resolveStabilizedClip`
 * never hands out a bake that does not fit — so the editor is never waiting on this.
 *
 * Recording a bake is bookkeeping, not an edit, and is applied without an undo step.
 * With one, undoing past it would drop the bake, the keeper would put it straight back
 * from cache as a new step, and that step would wipe the redo stack.
 */

export type StabilizePhase = 'idle' | 'queued' | 'analyzing' | 'stabilizing' | 'done' | 'error' | 'cancelled'

export interface StabilizeBakeState {
  isBaking: boolean
  percent: number
  phase: StabilizePhase
  error: string | null
}

interface ClipJob {
  jobId: string
  /** Identity of what was asked for, so a settings change can tell its job is stale. */
  requestKey: string
  percent: number
  phase: StabilizePhase
  error: string | null
}

const IDLE: StabilizeBakeState = { isBaking: false, percent: 0, phase: 'idle', error: null }

/** Settings are left alone this long before a bake starts, so a slider drag queues one job. */
const START_DELAY_MS = 600

// Module-level, like the matte registry: the timeline clip box and the properties panel
// read it without either of them owning the job.
const jobsByClip = new Map<string, ClipJob>()
/** Requests that failed this session; retried only when something about them changes. */
const failedRequests = new Set<string>()
/** Bake paths already reported gone, so one dead file is not re-checked every render. */
const auditedMissingPaths = new Set<string>()
const listeners = new Set<() => void>()
let applyBake: ((clipId: string, bake: StabilizationBake) => void) | null = null
/** Wakes the keeper for a change that is not a clip edit — a retry. */
let kickKeeper: (() => void) | null = null
let listenerBound = false

function notify() {
  for (const listener of listeners) listener()
}

function bindProgressListener() {
  if (listenerBound || typeof window === 'undefined' || !window.electronAPI?.on) return
  listenerBound = true
  window.electronAPI.on('stabilize:progress', (event) => {
    let clipId: string | null = null
    for (const [id, job] of jobsByClip) {
      if (job.jobId === event.jobId) { clipId = id; break }
    }
    if (!clipId) return
    const job = jobsByClip.get(clipId)!
    const changed = job.percent !== event.percent || job.phase !== event.phase
    job.percent = event.percent
    job.phase = event.phase

    if (event.phase === 'done') {
      jobsByClip.delete(clipId)
      if (event.bake) applyBake?.(clipId, event.bake)
    } else if (event.phase === 'cancelled') {
      jobsByClip.delete(clipId)
    } else if (event.phase === 'error') {
      job.error = event.error || 'Stabilization failed'
      failedRequests.add(job.requestKey)
    } else if (!changed) {
      return
    }
    notify()
  })
}

function isRunning(job: ClipJob | undefined): boolean {
  return Boolean(job && job.phase !== 'error' && job.phase !== 'cancelled')
}

export function isClipStabilizing(clipId: string | null | undefined): boolean {
  return isRunning(clipId ? jobsByClip.get(clipId) : undefined)
}

/** Stops a job and forgets it — for a job nobody wants any more. */
function dropClipJob(clipId: string): void {
  const job = jobsByClip.get(clipId)
  if (!job) return
  jobsByClip.delete(clipId)
  if (isRunning(job)) {
    window.electronAPI?.stabilizeCancel?.({ jobId: job.jobId }).catch(() => {})
  }
  notify()
}

/**
 * The user's cancel. Unlike dropping a stale job, the request is held: the clip still
 * asks for a bake, and without this the keeper would start it again on the next edit.
 * It stays cancelled until the user retries or changes a setting.
 */
export function cancelClipStabilization(clipId: string): void {
  const job = jobsByClip.get(clipId)
  if (!isRunning(job)) return
  window.electronAPI?.stabilizeCancel?.({ jobId: job!.jobId }).catch(() => {})
  failedRequests.add(job!.requestKey)
  // Detached from its job id, so the main process's 'cancelled' echo does not erase it.
  jobsByClip.set(clipId, { ...job!, jobId: '', phase: 'cancelled', error: null })
  notify()
}

/** Forgets a failure or a cancel, so the keeper tries the clip again (the panel's "retry"). */
export function retryClipStabilization(clipId: string): void {
  for (const key of [...failedRequests]) {
    if (key.startsWith(`${clipId}|`)) failedRequests.delete(key)
  }
  if (!isRunning(jobsByClip.get(clipId))) jobsByClip.delete(clipId)
  notify()
  // Nothing about the clip changed, so the keeper would not look again on its own.
  kickKeeper?.()
}

/**
 * Read-only progress for one clip. Safe to render next to every clip: it starts nothing,
 * and re-renders only when this module reports a visible change.
 */
export function useStabilizeBakeStatus(clipId: string | null | undefined): StabilizeBakeState {
  const [, setTick] = useState(0)
  useEffect(() => {
    const onUpdate = () => setTick(t => t + 1)
    listeners.add(onUpdate)
    return () => { listeners.delete(onUpdate) }
  }, [])
  const job = clipId ? jobsByClip.get(clipId) : undefined
  if (!job) return IDLE
  return {
    isBaking: isRunning(job),
    percent: job.percent,
    phase: job.phase,
    error: job.error,
  }
}

let hevcSupport: boolean | null = null

/**
 * Whether this machine can play HEVC 10-bit, which decides what an HDR source is baked
 * to. Chromium decodes HEVC only through the platform decoder, which Windows lacks
 * without the HEVC extension — and a bake the preview cannot play is worse than a
 * tone-mapped one.
 */
function canPlayHevc10(): boolean {
  if (hevcSupport !== null) return hevcSupport
  try {
    const type = 'video/mp4; codecs="hvc1.2.4.L153.B0"'
    hevcSupport = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
  } catch {
    hevcSupport = false
  }
  return hevcSupport
}

interface BakeRequest {
  clip: TimelineClip
  filePath: string
  sourceStart: number
  sourceSpan: number
  requestKey: string
}

/** What a clip needs baked right now, or null when it needs nothing. */
function bakeRequestFor(
  clip: TimelineClip,
  assets: ReturnType<typeof selectAssets>,
): BakeRequest | null {
  const stab = activeClipStabilization(clip)
  if (!stab || !clip.assetId) return null
  const ctx = stabilizationContextForClip(clip, assets)
  const need = clipSourceRange(clip, ctx.mediaDuration)
  if (!(need.sourceSpan > 0)) return null
  if (isStabilizationBakeValid(stab.bake, { ...stab, need, assetKey: ctx.assetKey })) return null

  const live = assets.find(asset => asset.id === clip.assetId)
  const filePath = live?.path || clip.asset?.path || ''
  if (!filePath) return null
  const range = stabilizationBakeRange(need, ctx.mediaDuration)
  const fingerprint = computeStabilizationFingerprint({ ...stab, ...range })
  return {
    clip,
    filePath,
    ...range,
    // Starts with the clip id, so a retry can forget every failure of one clip.
    requestKey: `${clip.id}|${clip.assetId}|${filePath}|${fingerprint}`,
  }
}

async function startBake(request: BakeRequest): Promise<void> {
  const { clip } = request
  const stab = clip.stabilization!
  const jobId = `stabilize-${clip.id}-${Date.now()}`
  // Idempotent; covers an API that was not there yet when the keeper mounted.
  bindProgressListener()
  jobsByClip.set(clip.id, { jobId, requestKey: request.requestKey, percent: 0, phase: 'queued', error: null })
  notify()

  const fail = (error: string) => {
    const job = jobsByClip.get(clip.id)
    if (job?.jobId !== jobId) return
    job.phase = 'error'
    job.error = error
    failedRequests.add(request.requestKey)
    notify()
  }

  try {
    const result = await window.electronAPI.stabilizeStart({
      jobId,
      assetId: clip.assetId!,
      filePath: request.filePath,
      sourceStart: request.sourceStart,
      sourceSpan: request.sourceSpan,
      smoothing: stab.smoothing,
      mode: stab.mode,
      hdrOutput: canPlayHevc10() ? 'hevc' : 'sdr',
    })
    if (result.cached && result.bake) {
      if (jobsByClip.get(clip.id)?.jobId === jobId) jobsByClip.delete(clip.id)
      applyBake?.(clip.id, result.bake)
      notify()
    } else if (!result.started) {
      fail(result.error || 'Stabilization could not start')
    }
  } catch (err) {
    fail((err as Error)?.message || 'Stabilization could not start')
  }
}

/**
 * The keeper. Mount once per open project, in a component of its own — it subscribes to
 * the clip list, and a re-render of whatever hosts it on every clip edit is not free.
 */
export function useStabilizeBakeKeeper(projectId?: string): void {
  const clips = useEditorStore(selectClips)
  const assets = useEditorStore(selectAssets)
  const store = useEditorStoreApi()
  const [kick, setKick] = useState(0)
  useEffect(() => {
    kickKeeper = () => setKick(k => k + 1)
    return () => { kickKeeper = null }
  }, [])

  useEffect(() => {
    applyBake = (clipId, bake) => {
      store.getState().setStateWithoutHistory(prev => {
        // The clip may have changed while the job ran; only a bake that still fits is kept.
        // A clip on a timeline that is no longer active is left for when it is: the keeper
        // asks again then, and the finished bake answers from cache.
        const clip = selectClipById(prev, clipId)
        const stab = clip && activeClipStabilization(clip)
        if (!clip || !stab) return prev
        const ctx = stabilizationContextForClip(clip, prev.editorModel.assets)
        const fits = isStabilizationBakeValid(bake, {
          ...stab,
          need: clipSourceRange(clip, ctx.mediaDuration),
          assetKey: ctx.assetKey,
        })
        return fits ? setClipStabilizationBake(prev, clipId, bake) : prev
      })
    }
    bindProgressListener()
    return () => { applyBake = null }
  }, [store])

  // A new project starts clean: its clips' jobs are not this project's business.
  const projectRef = useRef(projectId)
  useEffect(() => {
    if (projectRef.current === projectId) return
    projectRef.current = projectId
    for (const clipId of [...jobsByClip.keys()]) dropClipJob(clipId)
    failedRequests.clear()
    auditedMissingPaths.clear()
  }, [projectId])

  // Queue what is missing; drop jobs nobody wants any more.
  useEffect(() => {
    if (!window.electronAPI?.stabilizeStart) return
    const timer = setTimeout(() => {
      const wanted = new Map<string, BakeRequest>()
      for (const clip of clips) {
        const request = bakeRequestFor(clip, assets)
        if (request) wanted.set(clip.id, request)
      }

      for (const [clipId, job] of [...jobsByClip]) {
        const request = wanted.get(clipId)
        // Deleted, switched off, trimmed back inside its bake, or asking for something else.
        if (!request || request.requestKey !== job.requestKey) dropClipJob(clipId)
      }

      for (const request of wanted.values()) {
        if (jobsByClip.has(request.clip.id)) continue
        if (failedRequests.has(request.requestKey)) continue
        void startBake(request)
      }
    }, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [clips, assets, kick])

  // A cleared cache leaves clips holding paths to nothing; forget those bakes.
  useEffect(() => {
    if (!window.electronAPI?.stabilizeMissing) return
    const byPath = new Map<string, string[]>()
    for (const clip of clips) {
      const path = clip.stabilization?.bake?.path
      if (!path || auditedMissingPaths.has(path)) continue
      const ids = byPath.get(path)
      if (ids) ids.push(clip.id)
      else byPath.set(path, [clip.id])
    }
    if (byPath.size === 0) return

    let cancelled = false
    window.electronAPI.stabilizeMissing({ paths: [...byPath.keys()] })
      .then(({ missing }) => {
        if (cancelled) return
        if (missing.length === 0) return
        for (const path of missing) auditedMissingPaths.add(path)
        store.getState().setStateWithoutHistory(prev => {
          let next = prev
          for (const path of missing) {
            for (const clipId of byPath.get(path) ?? []) {
              console.warn(`[useStabilizeBake] stabilized file is gone, clearing bake for ${clipId}: ${path}`)
              next = setClipStabilizationBake(next, clipId, undefined)
            }
          }
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clips, store])
}

/** Test seam: forget all module state. */
export function __resetStabilizeBakeState(): void {
  jobsByClip.clear()
  failedRequests.clear()
  auditedMissingPaths.clear()
  listeners.clear()
  applyBake = null
  kickKeeper = null
  listenerBound = false
  hevcSupport = null
}
