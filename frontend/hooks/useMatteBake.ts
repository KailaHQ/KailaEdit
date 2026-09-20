import { useState, useEffect, useCallback, useRef } from 'react'
import type { TimelineClip, AutoMatte, AutoMatteBake, AutoMatteModel, AutoMatteQuality, AutoMatteDevice } from '@core/project-model'
import { isAutoMatteBakeValid } from '@core/auto-matte'
import { selectAssets, selectClipPathFromAssets, selectClips } from '@core/editor-selectors'
import { useEditorActions, useEditorStore } from '../views/editor/editor-store'
import { useSettings } from '../contexts/SettingsContext'

export interface MatteBakeState {
  isBaking: boolean
  percent: number
  phase: string
  error: string | null
  jobId: string | null
}

interface ClipBakeRecord {
  jobId: string
  clipId: string
  percent: number
  phase: string
  isBaking: boolean
  error: string | null
}

// Module-level registry to track ongoing bake jobs per clipId
const activeClipBakes = new Map<string, ClipBakeRecord>()
const listeners = new Set<() => void>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

let isGlobalListenerBound = false
let updateClipBakeCallback: ((clipId: string, bake: AutoMatteBake) => void) | null = null

function ensureGlobalListener(updateClipBake: (clipId: string, bake: AutoMatteBake) => void) {
  updateClipBakeCallback = updateClipBake
  if (isGlobalListenerBound) return
  if (typeof window === 'undefined' || !window.electronAPI?.on) return

  window.electronAPI.on('matte:progress', async (payload) => {
    // Find which clip owns this jobId
    let matchedClipId: string | null = null
    for (const [cId, record] of activeClipBakes.entries()) {
      if (record.jobId === payload.jobId) {
        matchedClipId = cId
        break
      }
    }

    if (!matchedClipId) return

    const record = activeClipBakes.get(matchedClipId)!
    const nextPercent = Math.round(payload.percent ?? 0)
    // The progress bar now lives on the timeline clip, next to every other clip box.
    // Waking that list up for a repeated percent is the kind of re-render the timeline
    // cannot afford, so only a visible change notifies.
    const changed = nextPercent !== record.percent || payload.phase !== record.phase
    record.percent = nextPercent
    record.phase = payload.phase

    if (payload.phase === 'done') {
      record.isBaking = false
      record.percent = 100

      // Retrieve full bake details
      try {
        const status = await window.electronAPI.matteBakeStatus({ jobId: payload.jobId })
        // `status.bake` says which stretch of the source the file covers, which is what
        // lets a later trim reuse it instead of baking the same footage again. A status
        // without one can only be an older main process, so fall back to the bare record
        // — it will fail validation and be re-baked once, which is the honest outcome.
        if (status?.bake) {
          updateClipBakeCallback?.(matchedClipId, { ...status.bake, createdAt: Date.now() })
        } else if (status?.mattePath && status?.fingerprint) {
          updateClipBakeCallback?.(matchedClipId, {
            path: status.mattePath,
            fingerprint: status.fingerprint,
            frameCount: status.frameCount || payload.totalFrames || 0,
            createdAt: Date.now(),
          })
        }
      } catch (err) {
        console.error('[useMatteBake] Failed to query status after done:', err)
      }

      activeClipBakes.delete(matchedClipId)
    } else if (payload.phase === 'cancelled') {
      record.isBaking = false
      activeClipBakes.delete(matchedClipId)
    } else if (payload.phase === 'error') {
      record.isBaking = false
      record.error = payload.error || 'Bake failed'
      // Keep error in record for UI display until dismissed
    } else if (!changed) {
      return
    }

    notifyListeners()
  })

  isGlobalListenerBound = true
}

export function isClipBaking(clipId: string | null | undefined): boolean {
  if (!clipId) return false
  return Boolean(activeClipBakes.get(clipId)?.isBaking)
}

/**
 * Cancels the bake belonging to ONE clip, by clip id.
 *
 * Split out of the hook so the timeline clip box can cancel the job it is showing
 * progress for without mounting the whole properties-panel hook for that clip.
 */
export async function cancelClipBake(clipId: string): Promise<void> {
  const record = activeClipBakes.get(clipId)
  if (!record) return

  const jId = record.jobId
  // Immediately remove from active state so UI clears without lag
  activeClipBakes.delete(clipId)
  notifyListeners()

  if (window.electronAPI?.matteBakeCancel && jId) {
    try {
      await window.electronAPI.matteBakeCancel({ jobId: jId })
    } catch (err) {
      console.warn('[useMatteBake] Cancel failed:', err)
    }
  }
}

/**
 * Read-only view of one clip's bake progress.
 *
 * For the timeline clip box: it subscribes to the same registry `useMatteBake` writes to,
 * but starts nothing and touches no store, so rendering it next to every clip is safe.
 */
export function useMatteBakeStatus(clipId: string | null | undefined): MatteBakeState {
  const [, setTick] = useState(0)
  useEffect(() => {
    const onUpdate = () => setTick(t => t + 1)
    listeners.add(onUpdate)
    return () => {
      listeners.delete(onUpdate)
    }
  }, [])

  const record = clipId ? activeClipBakes.get(clipId) : undefined
  return {
    isBaking: Boolean(record?.isBaking),
    percent: record?.percent ?? 0,
    phase: record?.phase ?? 'idle',
    error: record?.error ?? null,
    jobId: record?.jobId ?? null,
  }
}

/** Bake paths already reported gone, so one dead file is not re-checked every render. */
const auditedMissingPaths = new Set<string>()

/** Clips this session has already re-baked on its own, so it never loops on a failure. */
const autoBakedThisSession = new Set<string>()

/**
 * Starts a bake for one clip. Shared by the Remove BG panel and by the keeper below, so
 * the two cannot drift into starting bakes on different terms.
 */
async function beginClipBake(params: {
  clip: TimelineClip
  filePath: string
  device: AutoMatteDevice
  setClipAutoMatte: (clipId: string, autoMatte: Partial<AutoMatte>) => void
  model?: AutoMatteModel
  quality?: AutoMatteQuality
}): Promise<void> {
  const { clip, filePath, device, setClipAutoMatte } = params
  if (clip.type !== 'video' && clip.type !== 'image') return
  if (!window.electronAPI?.matteBakeStart) return
  // One job per clip. Without this a second caller overwrites the registry entry and the
  // first job's progress events stop matching any clip, leaving a bake running in the
  // background that nothing can show or cancel.
  if (activeClipBakes.get(clip.id)?.isBaking) return

  const jobId = `matte-bake-${clip.id}-${Date.now()}`
  const model = params.model || clip.autoMatte?.model || 'rvm-mobilenetv3'
  const quality = params.quality || clip.autoMatte?.quality || 'standard'

  activeClipBakes.set(clip.id, {
    jobId,
    clipId: clip.id,
    isBaking: true,
    percent: 0,
    phase: 'extracting',
    error: null,
  })
  notifyListeners()

  try {
    const result = await window.electronAPI.matteBakeStart({
      jobId,
      device,
      clipId: clip.id,
      filePath,
      trimStart: clip.trimStart,
      duration: clip.duration,
      speed: clip.speed ?? 1,
      reversed: Boolean(clip.reversed),
      model,
      quality,
      still: clip.type === 'image',
    })

    if (result.cached && result.path && result.fingerprint) {
      setClipAutoMatte(clip.id, {
        bake: result.bake
          ? { ...result.bake, createdAt: Date.now() }
          : {
              path: result.path,
              fingerprint: result.fingerprint,
              frameCount: result.frameCount ?? 1,
              createdAt: Date.now(),
            },
      })
      activeClipBakes.delete(clip.id)
      notifyListeners()
    } else if (result.error) {
      const rec = activeClipBakes.get(clip.id)
      if (rec) {
        rec.isBaking = false
        rec.error = result.error
        rec.phase = 'error'
      }
      notifyListeners()
    }
  } catch (err) {
    const rec = activeClipBakes.get(clip.id)
    if (rec) {
      rec.isBaking = false
      rec.error = (err as Error)?.message || 'Failed to start bake'
      rec.phase = 'error'
    }
    notifyListeners()
  }
}

/**
 * Drops bake records whose file is no longer on disk.
 *
 * `isAutoMatteBakeValid` compares what the record says against what the clip needs; it has
 * no way to ask whether the file is still there, and the renderer cannot touch the
 * filesystem. So a matte evicted by the cache size cap, cleared from Settings, or dropped
 * by a format migration left the clip claiming "matte ready" forever: the panel said the
 * background was removed, the preview showed the background, and nothing re-baked because
 * as far as the app knew there was nothing to do.
 *
 * Clearing the record puts the clip back into the honest state — "not baked" — which the
 * panel offers to fix and the preview falls back from.
 */
export function useMatteBakeAudit(): void {
  const { setClipAutoMatte } = useEditorActions()
  const clips = useEditorStore(selectClips)
  const assets = useEditorStore(selectAssets)
  const { settings } = useSettings()

  const deviceRef = useRef<AutoMatteDevice>(settings.autoMatteDevice)
  deviceRef.current = settings.autoMatteDevice

  // Re-bake what the project still asks for.
  //
  // Remove BG being on is the user's standing instruction, saved with the project — but a
  // bake lives in a cache that evicts, gets cleared from Settings, or is dropped by a
  // format migration. Reopening the project then showed the background with the toggle
  // still on and nothing running, because validity is a comparison of recorded fields and
  // the only thing that ever started a bake was a click.
  //
  // This is deliberately NOT the effect that used to live in the properties panel. That
  // one fired whenever the panel re-mounted, so merely clicking a clip started baking it,
  // and a bake on one clip looked like it belonged to another. This runs once per clip per
  // session, keyed off what the project says rather than off what is selected.
  useEffect(() => {
    if (!window.electronAPI?.matteBakeStart) return

    for (const clip of clips) {
      if (!clip.autoMatte?.enabled) continue
      if (clip.type !== 'video' && clip.type !== 'image') continue
      if (autoBakedThisSession.has(clip.id)) continue
      if (activeClipBakes.get(clip.id)?.isBaking) continue

      const valid = isAutoMatteBakeValid(clip.autoMatte.bake, {
        trimStart: clip.trimStart,
        duration: clip.duration,
        speed: clip.speed,
        reversed: clip.reversed,
        model: clip.autoMatte.model || 'rvm-mobilenetv3',
        quality: clip.autoMatte.quality || 'standard',
      })
      if (valid) continue

      const filePath = selectClipPathFromAssets(assets, clip) || clip.asset?.path || (clip as { path?: string }).path || ''
      if (!filePath) continue

      autoBakedThisSession.add(clip.id)
      console.info(`[useMatteBake] Remove BG is on for ${clip.id} with no usable matte — baking it.`)
      void beginClipBake({
        clip,
        filePath,
        device: deviceRef.current,
        setClipAutoMatte,
      })
    }
  }, [clips, assets, setClipAutoMatte])

  useEffect(() => {
    if (!window.electronAPI?.matteBakeMissing) return

    const byPath = new Map<string, string[]>()
    for (const clip of clips) {
      const path = clip.autoMatte?.bake?.path
      if (!path || auditedMissingPaths.has(path)) continue
      const ids = byPath.get(path)
      if (ids) ids.push(clip.id)
      else byPath.set(path, [clip.id])
    }
    if (byPath.size === 0) return

    let cancelled = false
    window.electronAPI
      .matteBakeMissing({ paths: [...byPath.keys()] })
      .then(({ missing }) => {
        if (cancelled) return
        for (const path of missing) {
          auditedMissingPaths.add(path)
          for (const clipId of byPath.get(path) ?? []) {
            console.warn(`[useMatteBake] matte file is gone, clearing bake for ${clipId}: ${path}`)
            setClipAutoMatte(clipId, { bake: undefined })
          }
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [clips, setClipAutoMatte])
}

export function useMatteBake(clip: TimelineClip | null | undefined) {
  const { setClipAutoMatte } = useEditorActions()
  const { settings } = useSettings()
  const assets = useEditorStore(selectAssets)

  // Read through a ref so changing the setting does not re-create startBake and, with it,
  // every consumer's callbacks mid-bake.
  const deviceRef = useRef<AutoMatteDevice>(settings.autoMatteDevice)
  deviceRef.current = settings.autoMatteDevice
  const clipId = clip?.id

  // Resolve actual media path whether embedded on clip or tracked in project assets
  const filePath = clip
    ? (selectClipPathFromAssets(assets, clip) || clip.asset?.path || (clip as any).path || '')
    : ''

  // Keep a ref to the setter so ensureGlobalListener can use it
  const setClipAutoMatteRef = useRef(setClipAutoMatte)
  setClipAutoMatteRef.current = setClipAutoMatte

  useEffect(() => {
    ensureGlobalListener((cId, bake) => {
      setClipAutoMatteRef.current(cId, { bake })
    })
  }, [])

  // Local re-render trigger when module state changes
  const [, setTick] = useState(0)
  useEffect(() => {
    const onUpdate = () => setTick(t => t + 1)
    listeners.add(onUpdate)
    return () => {
      listeners.delete(onUpdate)
    }
  }, [])

  const currentRecord = clipId ? activeClipBakes.get(clipId) : undefined

  const isBaking = Boolean(currentRecord?.isBaking)
  const percent = currentRecord?.percent ?? 0
  const phase = currentRecord?.phase ?? 'idle'
  const error = currentRecord?.error ?? null
  const jobId = currentRecord?.jobId ?? null

  const startBake = useCallback(
    async (options?: { model?: AutoMatteModel; quality?: AutoMatteQuality }) => {
      if (!clip || !filePath) {
        console.warn('[useMatteBake] Cannot start bake: missing clip or filePath', { clipId: clip?.id, filePath })
        return
      }
      await beginClipBake({
        clip,
        filePath,
        device: deviceRef.current,
        setClipAutoMatte,
        model: options?.model,
        quality: options?.quality,
      })
    },
    [clip, filePath, setClipAutoMatte],
  )

  const cancelBake = useCallback(async () => {
    if (!clipId) return
    await cancelClipBake(clipId)
  }, [clipId])

  return {
    isBaking,
    percent,
    phase,
    error,
    jobId,
    startBake,
    cancelBake,
  }
}
