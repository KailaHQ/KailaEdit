import { useEffect, useRef } from 'react'
import { useSettings } from '../../contexts/SettingsContext'
import { useEditorActions, useEditorStore } from './editor-store'
import { useProxyStore } from './proxy-store'
import type { Asset } from '../../types/project-model'

/**
 * Assets whose "ready" proxy this session has actually confirmed on disk.
 *
 * A project stores `proxyStatus: 'ready'` and a `proxyPath` with it, and nothing used to
 * check that the file was still there — the audit below skipped every asset that claimed
 * to be ready. Clear the proxy cache (or move the app's data, or let the size cap evict
 * it) and every video clip kept resolving to a file that no longer existed: the <video>
 * element failed with ERR_FILE_NOT_FOUND, never reached readyState 2, and the monitor was
 * simply black, with no error anywhere in the app.
 *
 * This is the same lesson the matte bakes already learned — see the `matteBakeMissing`
 * audit in useMatteBake, written after a cleared cache left clips insisting the
 * background had been removed. A path recorded in a project is a claim about a cache, and
 * a cache can be emptied at any time; it has to be checked once before it is trusted.
 */
const verifiedProxies = new Set<string>()

export function useProxyManager() {
  const { settings } = useSettings()
  const proxyEnabled = settings.proxyEnabled
  const assets = useEditorStore((state) => state.editorModel.assets)
  const actions = useEditorActions()

  const assetsRef = useRef<Asset[]>(assets)
  assetsRef.current = assets

  const proxyEnabledRef = useRef(proxyEnabled)
  proxyEnabledRef.current = proxyEnabled

  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // 1. Listen for background proxy progress events from Electron
  useEffect(() => {
    if (!window.electronAPI?.on) return

    const unsubscribe = window.electronAPI.on('proxy:progress', (event) => {
      const currentAsset = assetsRef.current.find((a) => a.id === event.assetId)

      if (event.status === 'generating') {
        useProxyStore.getState().setProgress(event.assetId, event.progress)
        if (currentAsset && currentAsset.proxyStatus !== 'generating') {
          actionsRef.current.updateAsset(event.assetId, { proxyStatus: 'generating' })
        }
      } else if (event.status === 'ready') {
        useProxyStore.getState().removeProgress(event.assetId)
        if (currentAsset && (currentAsset.proxyPath !== event.proxyPath || currentAsset.proxyStatus !== 'ready')) {
          actionsRef.current.updateAsset(event.assetId, {
            proxyPath: event.proxyPath,
            proxyStatus: 'ready',
          })
        }
      } else if (event.status === 'error') {
        useProxyStore.getState().removeProgress(event.assetId)
        if (currentAsset && currentAsset.proxyStatus !== 'error') {
          actionsRef.current.updateAsset(event.assetId, { proxyStatus: 'error' })
        }
      } else if (event.status === 'none') {
        useProxyStore.getState().removeProgress(event.assetId)
        if (currentAsset && currentAsset.proxyStatus !== 'none') {
          actionsRef.current.updateAsset(event.assetId, { proxyStatus: 'none', proxyPath: undefined })
        }
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // 2. When proxyEnabled is true, check video assets and queue generation
  useEffect(() => {
    if (!proxyEnabled || !window.electronAPI?.getProxyStatus || !window.electronAPI?.generateProxy) {
      return
    }

    const videoAssets = assets.filter((a) => a.type === 'video' && a.path)

    for (const asset of videoAssets) {
      // A claim of "ready" is trusted only after this session has seen the file.
      if (asset.proxyStatus === 'ready' && asset.proxyPath && verifiedProxies.has(asset.id)) {
        continue
      }

      // Check proxy status on disk or in background queue
      window.electronAPI.getProxyStatus({ assetId: asset.id, filePath: asset.path })
        .then((res) => {
          if (!proxyEnabledRef.current) return

          if (res.status === 'ready' && res.proxyPath) {
            verifiedProxies.add(asset.id)
            actionsRef.current.updateAsset(asset.id, {
              proxyPath: res.proxyPath,
              proxyStatus: 'ready',
            })
            useProxyStore.getState().removeProgress(asset.id)
          } else if (asset.proxyStatus === 'ready' && asset.proxyPath) {
            // It claimed ready and the file is gone. Drop the claim FIRST so playback
            // falls straight back to the original media instead of a missing file, then
            // let the branches below re-queue it.
            console.warn(`[useProxyManager] proxy file is gone, falling back to the original for ${asset.id}: ${asset.proxyPath}`)
            actionsRef.current.updateAsset(asset.id, { proxyPath: undefined, proxyStatus: 'none' })
            useProxyStore.getState().removeProgress(asset.id)
          } else if (res.status === 'generating') {
            useProxyStore.getState().setProgress(asset.id, res.progress)
            if (asset.proxyStatus !== 'generating') {
              actionsRef.current.updateAsset(asset.id, { proxyStatus: 'generating' })
            }
          } else if (res.status === 'none') {
            actionsRef.current.updateAsset(asset.id, { proxyStatus: 'generating' })
            window.electronAPI.generateProxy({ assetId: asset.id, filePath: asset.path })
              .then((genRes) => {
                if (!genRes.success && genRes.error) {
                  actionsRef.current.updateAsset(asset.id, { proxyStatus: 'error' })
                  useProxyStore.getState().removeProgress(asset.id)
                }
              })
              .catch(() => {
                actionsRef.current.updateAsset(asset.id, { proxyStatus: 'error' })
                useProxyStore.getState().removeProgress(asset.id)
              })
          }
        })
        .catch(() => {})
    }
  }, [proxyEnabled, assets])

  // 3. When proxy is disabled, cancel any active generation tasks
  useEffect(() => {
    if (proxyEnabled) return

    if (window.electronAPI?.cancelProxy) {
      const videoAssets = assetsRef.current.filter(
        (a) => a.type === 'video' && a.proxyStatus === 'generating',
      )
      for (const asset of videoAssets) {
        window.electronAPI.cancelProxy({ assetId: asset.id })
      }
    }
    useProxyStore.getState().clearAll()
  }, [proxyEnabled])
}
