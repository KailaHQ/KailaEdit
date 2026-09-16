import { useEffect, useRef, useState, useCallback } from 'react'
import type { UpdateState } from '@core/update-state'

/**
 * Hook to read and subscribe to the auto-updater state.
 *
 * - Seeds from window.electronAPI.updateGetState() on mount.
 * - Listens for 'update:state' events.
 * - Throttles download-progress updates to ~10 fps (~100ms) to protect the title bar from high-frequency re-renders.
 * - Immediately propagates discrete status transitions (checking, available, downloaded, error, etc.).
 */
export function useUpdateState() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const lastProgressTimeRef = useRef(0)
  const pendingProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    let isMounted = true

    // Seed state from main process
    api.updateGetState()
      .then(state => {
        if (isMounted && state) {
          setUpdateState(state as UpdateState)
        }
      })
      .catch(() => {})

    // Subscribe to IPC events
    const unsubscribe = api.on('update:state', (payload: unknown) => {
      if (!isMounted) return
      const newState = payload as UpdateState

      if (newState.status === 'downloading') {
        const now = Date.now()
        const elapsed = now - lastProgressTimeRef.current
        const THROTTLE_MS = 100 // ~10 fps

        if (elapsed >= THROTTLE_MS) {
          lastProgressTimeRef.current = now
          if (pendingProgressTimerRef.current) {
            clearTimeout(pendingProgressTimerRef.current)
            pendingProgressTimerRef.current = null
          }
          setUpdateState(newState)
        } else if (!pendingProgressTimerRef.current) {
          pendingProgressTimerRef.current = setTimeout(() => {
            lastProgressTimeRef.current = Date.now()
            pendingProgressTimerRef.current = null
            if (isMounted) {
              setUpdateState(newState)
            }
          }, THROTTLE_MS - elapsed)
        }
      } else {
        // Discrete status change: apply immediately
        if (pendingProgressTimerRef.current) {
          clearTimeout(pendingProgressTimerRef.current)
          pendingProgressTimerRef.current = null
        }
        setUpdateState(newState)
      }
    })

    return () => {
      isMounted = false
      if (pendingProgressTimerRef.current) {
        clearTimeout(pendingProgressTimerRef.current)
      }
      unsubscribe?.()
    }
  }, [])

  const downloadUpdate = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return { success: false, error: 'No electron API' }
    return api.updateDownload()
  }, [])

  const installNow = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return { success: false, error: 'No electron API' }
    return api.updateInstallNow()
  }, [])

  const checkForUpdates = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return { status: 'unsupported' as const }
    return api.checkForUpdates()
  }, [])

  return {
    updateState,
    downloadUpdate,
    installNow,
    checkForUpdates,
  }
}
