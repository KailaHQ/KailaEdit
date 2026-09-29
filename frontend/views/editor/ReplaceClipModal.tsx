import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Film, Image as ImageIcon, Upload, X } from 'lucide-react'
import type { Asset, TimelineClip, Track } from '../../types/project-model'
import { replaceClipRefusal, replacementSlack, replacementSourceSpan } from '@core/clip-replace'
import { ReplaceSegmentPicker } from './ReplaceSegmentPicker'
import { pathToFileUrl } from '../../lib/file-url'
import { useTranslation } from '../../i18n/I18nContext'

export interface ReplaceClipModalProps {
  clip: TimelineClip
  assets: Asset[]
  tracks: Track[]
  /** Put this asset into the clip, starting `sourceStart` seconds into it. */
  onReplace: (asset: Asset, sourceStart: number) => void
  /** Import files picked from disk; resolves to what was imported. */
  onImportFiles: (files: FileList) => Promise<Asset[]>
  /** Say something outside the dialog — an import that brought nothing usable. */
  onNotice: (message: string) => void
  /** Open straight on the "choose the part" step for this video — a drop onto the clip. */
  initialSegmentAsset?: Asset | null
  onClose: () => void
}

const seconds = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}s`
const fileName = (asset: Asset) => asset.path.split(/[\\/]/).pop() || asset.prompt || asset.id

/**
 * Picks the media that replaces a clip: any video or image in the library, or a file
 * imported for the purpose. Media that cannot fill the clip is shown, but disabled with
 * the reason, so the user is not left guessing why a file is missing from the list.
 */
export function ReplaceClipModal({ clip, assets, tracks, onReplace, onImportFiles, onNotice, initialSegmentAsset, onClose }: ReplaceClipModalProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** A video with room to spare: the second step, choosing where in it the clip starts. */
  const [segmentAsset, setSegmentAsset] = useState<Asset | null>(initialSegmentAsset ?? null)

  /**
   * A video longer than the clip goes to the segment step; anything that fits exactly, or
   * a still, goes straight in — there is nothing to choose.
   */
  const pick = (asset: Asset) => {
    if (replacementSlack(clip, asset) > 0.05) setSegmentAsset(asset)
    else onReplace(asset, 0)
  }

  // What the user imported into the project, not what the app made (stickers, sound effects).
  const candidates = useMemo(
    () => assets.filter(asset => !asset.source && (asset.type === 'video' || asset.type === 'image')),
    [assets],
  )
  const span = replacementSourceSpan(clip)

  useEffect(() => {
    // Escape steps back out of the segment step before it closes the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (segmentAsset) setSegmentAsset(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, segmentAsset])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm select-none p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('replaceClip.title')}
        className="w-full max-w-[640px] max-h-[80vh] rounded-xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">{t('replaceClip.title')}</h2>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">
              {t('replaceClip.subtitle', { duration: seconds(clip.duration) })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t('replaceClip.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {segmentAsset ? (
          <ReplaceSegmentPicker
            clip={clip}
            asset={segmentAsset}
            onBack={() => setSegmentAsset(null)}
            onConfirm={start => onReplace(segmentAsset, start)}
          />
        ) : (<>
        {/* Library */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('replaceClip.library')}</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25"
          >
            <Upload className="h-3 w-3" />
            {t('replaceClip.importFile')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*"
            className="hidden"
            onChange={e => {
              const files = e.target.files
              e.target.value = ''
              if (!files || files.length === 0) return
              void onImportFiles(files).then(imported => {
                const media = imported.find(asset => asset.type === 'video' || asset.type === 'image')
                if (!media) { onNotice(t('replaceClip.importFailed')); return }
                const refusal = replaceClipRefusal(clip, media, tracks)
                if (refusal === 'too-short') {
                  onNotice(t('replaceClip.tooShort', { media: seconds(media.duration ?? 0), clip: seconds(span) }))
                  return
                }
                pick(media)
              }, () => onNotice(t('replaceClip.importFailed')))
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-500">{t('replaceClip.empty')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {candidates.map(asset => {
                const refusal = replaceClipRefusal(clip, asset, tracks)
                const isCurrent = refusal === 'same-media'
                const disabled = refusal !== null
                const reason = refusal === 'too-short'
                  ? t('replaceClip.tooShort', { media: seconds(asset.duration ?? 0), clip: seconds(span) })
                  : isCurrent ? t('replaceClip.current') : null
                const thumb = asset.smallThumbnailPath || asset.bigThumbnailPath || (asset.type === 'image' ? asset.path : '')
                return (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(asset)}
                    title={reason ?? fileName(asset)}
                    data-replace-asset={asset.id}
                    className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
                      disabled
                        ? 'cursor-not-allowed border-zinc-800 opacity-45'
                        : 'border-zinc-800 hover:border-cyan-500/70 hover:bg-zinc-800/60'
                    } ${isCurrent ? 'ring-1 ring-cyan-500/40' : ''}`}
                  >
                    <div className="relative aspect-video w-full bg-zinc-950">
                      {/* The type icon sits underneath: it shows when there is no thumbnail, or one that fails to load. */}
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                        {asset.type === 'video' ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                      </div>
                      {thumb && (
                        <img
                          draggable={false}
                          src={pathToFileUrl(thumb)}
                          alt=""
                          className="relative h-full w-full object-cover"
                          onError={e => { e.currentTarget.style.display = 'none' }}
                        />
                      )}
                      {asset.type === 'video' && typeof asset.duration === 'number' && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] tabular-nums text-zinc-200">
                          {seconds(asset.duration)}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-[11px] text-zinc-200">{fileName(asset)}</div>
                      {reason && <div className="truncate text-[10px] text-amber-300/90">{reason}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        </>)}
      </div>
    </div>,
    document.body,
  )
}
