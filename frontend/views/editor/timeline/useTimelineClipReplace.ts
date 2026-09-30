import { useCallback, useState } from 'react'
import type { Asset, TimelineClip, Track } from '../../../types/project-model'
import { replaceClipRefusal, replacementSlack, replacementSourceSpan } from '@core/clip-replace'

export interface UseTimelineClipReplaceOptions {
  clips: TimelineClip[]
  tracks: Track[]
  assets: Asset[]
  importFiles: (files: FileList | File[]) => Promise<Asset[]>
  replaceClipMedia: (clipId: string, assetId: string, sourceStart: number) => void
  showTimelineNotice: (message: string) => void
  t: (key: string, params?: Record<string, any>) => string
}

export function useTimelineClipReplace({
  clips,
  tracks,
  assets,
  importFiles,
  replaceClipMedia,
  showTimelineNotice,
  t,
}: UseTimelineClipReplaceOptions) {
  const [replaceClipId, setReplaceClipId] = useState<string | null>(null)
  const [replaceSegmentAsset, setReplaceSegmentAsset] = useState<Asset | null>(null)

  const replaceTarget = replaceClipId ? clips.find(clip => clip.id === replaceClipId) ?? null : null

  const acceptReplacement = useCallback((clip: TimelineClip, asset: Asset): boolean => {
    const refusal = replaceClipRefusal(clip, asset, tracks)
    if (refusal === 'too-short') {
      showTimelineNotice(t('replaceClip.tooShort', {
        media: `${(asset.duration ?? 0).toFixed(1)}s`,
        clip: `${replacementSourceSpan(clip).toFixed(1)}s`,
      }))
      return false
    }
    if (refusal === 'locked') {
      showTimelineNotice(t('replaceClip.locked'))
      return false
    }
    if (refusal === 'not-replaceable' || refusal === 'unsupported-media') {
      showTimelineNotice(t('replaceClip.notReplaceable'))
      return false
    }
    return refusal !== 'same-media'
  }, [showTimelineNotice, t, tracks])

  const closeReplace = useCallback(() => {
    setReplaceClipId(null)
    setReplaceSegmentAsset(null)
  }, [])

  const replaceWith = useCallback((asset: Asset, sourceStart = 0) => {
    const clip = replaceClipId ? clips.find(c => c.id === replaceClipId) : undefined
    if (!clip) { closeReplace(); return }
    const refusal = replaceClipRefusal(clip, asset, tracks)
    if (refusal === 'same-media') { closeReplace(); return }
    if (!acceptReplacement(clip, asset)) return
    replaceClipMedia(clip.id, asset.id, sourceStart)
    showTimelineNotice(t('replaceClip.replaced'))
    closeReplace()
  }, [acceptReplacement, replaceClipMedia, clips, closeReplace, replaceClipId, showTimelineNotice, t, tracks])

  const handleDropReplace = useCallback(async (clipId: string, payload: { assetId?: string; files?: FileList }) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    let asset: Asset | undefined
    if (payload.assetId) {
      asset = assets.find(a => a.id === payload.assetId)
    } else if (payload.files && payload.files.length > 0) {
      try {
        const imported = await importFiles(payload.files)
        asset = imported.find(a => a.type === 'video' || a.type === 'image')
      } catch {
        asset = undefined
      }
      if (!asset) { showTimelineNotice(t('replaceClip.importFailed')); return }
    }
    if (!asset || !acceptReplacement(clip, asset)) return
    if (replacementSlack(clip, asset) > 0.05) {
      setReplaceSegmentAsset(asset)
      setReplaceClipId(clipId)
      return
    }
    replaceClipMedia(clipId, asset.id, 0)
    showTimelineNotice(t('replaceClip.replaced'))
  }, [acceptReplacement, replaceClipMedia, assets, clips, importFiles, showTimelineNotice, t])

  return {
    replaceClipId,
    setReplaceClipId,
    replaceSegmentAsset,
    setReplaceSegmentAsset,
    replaceTarget,
    acceptReplacement,
    closeReplace,
    replaceWith,
    handleDropReplace,
  }
}
