import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Film } from 'lucide-react'
import type { Timeline, Asset } from '@core/project-model'
import { pathToFileUrl } from '../../../lib/file-url'
import { useTranslation } from '../../../i18n/I18nContext'
import { formatTime } from '../video-editor-utils'

export interface CoverPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenDesign: (initialFrameDataUrl: string, selectedTime: number, isLocalImage: boolean) => void
  onRemoveCover?: () => void
  activeTimeline: Timeline | null
  assets: Asset[]
}

export const CoverPickerModal: React.FC<CoverPickerModalProps> = ({
  isOpen,
  onClose,
  onOpenDesign,
  activeTimeline,
  assets,
}) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'video' | 'local'>(
    activeTimeline?.cover?.type === 'custom_image' ? 'local' : 'video'
  )
  const [selectedTime, setSelectedTime] = useState<number>(activeTimeline?.cover?.time ?? 0)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(
    activeTimeline?.cover?.customImagePath ?? null
  )
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [frameDataUrl, setFrameDataUrl] = useState<string>(
    activeTimeline?.cover?.customImagePath || activeTimeline?.cover?.thumbnailDataUrl || ''
  )

  const scrubberRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clips = activeTimeline?.clips || []
  const videoClips = clips.filter(c => c.type === 'video' || (c.asset && c.asset.type === 'video'))
  const totalDuration = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0) || 5

  // Map asset lookup
  const assetMap = useRef<Map<string, Asset>>(new Map())
  useEffect(() => {
    const map = new Map<string, Asset>()
    for (const a of assets) map.set(a.id, a)
    for (const c of clips) {
      if (c.asset) map.set(c.asset.id, c.asset)
    }
    assetMap.current = map
  }, [assets, clips])

  // Resolve active clip and media file at selectedTime
  const activeClipAtTime = videoClips.find(
    c => selectedTime >= c.startTime && selectedTime <= c.startTime + c.duration
  ) || videoClips[0]

  const activeAsset = activeClipAtTime
    ? activeClipAtTime.asset || (activeClipAtTime.assetId ? assetMap.current.get(activeClipAtTime.assetId) : null)
    : null

  const videoSrc = activeAsset?.path ? pathToFileUrl(activeAsset.path) : ''

  // Compute media timestamp inside the clip
  const mediaTime = activeClipAtTime
    ? Math.max(0, (selectedTime - activeClipAtTime.startTime) * (activeClipAtTime.speed || 1) + (activeClipAtTime.trimStart || 0))
    : 0

  // Update hidden video currentTime when mediaTime or activeClip changes
  useEffect(() => {
    if (videoRef.current && videoSrc) {
      if (Math.abs(videoRef.current.currentTime - mediaTime) > 0.05) {
        videoRef.current.currentTime = mediaTime
      }
    }
  }, [mediaTime, videoSrc])

  // Capture frame from video or image to canvas / dataUrl
  const captureFrame = useCallback(() => {
    if (tab === 'local' && localImageUrl) {
      setFrameDataUrl(localImageUrl)
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.videoWidth === 0) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const dataUrl = canvas.toDataURL('image/png')
        setFrameDataUrl(dataUrl)
      } catch (err) {
        console.warn('Unable to export canvas data URL:', err)
      }
    }
  }, [tab, localImageUrl])

  const handleVideoSeeked = () => {
    captureFrame()
  }

  // Handle filmstrip mouse down / scrub
  const handleScrubStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsScrubbing(true)
    handleScrubMove(e)
  }

  const handleScrubMove = useCallback((e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (!scrubberRef.current) return
    const rect = scrubberRef.current.getBoundingClientRect()
    const clientX = 'clientX' in e ? e.clientX : (e as MouseEvent).clientX
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const time = ratio * totalDuration
    setSelectedTime(time)
  }, [totalDuration])

  useEffect(() => {
    if (!isScrubbing) return
    const onMouseMove = (e: MouseEvent) => handleScrubMove(e)
    const onMouseUp = () => {
      setIsScrubbing(false)
      captureFrame()
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isScrubbing, handleScrubMove, captureFrame])

  // File picker handler for Local tab
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setLocalImageUrl(result)
        setFrameDataUrl(result)
      }
      reader.readAsDataURL(file)
    }
  }

  // Proceed to Design Studio
  const handleProceedToDesign = () => {
    captureFrame()
    const finalUrl =
      frameDataUrl ||
      localImageUrl ||
      activeTimeline?.cover?.customImagePath ||
      activeTimeline?.cover?.thumbnailDataUrl ||
      ''
    onOpenDesign(
      finalUrl,
      selectedTime,
      tab === 'local' || Boolean(activeTimeline?.cover?.type === 'custom_image')
    )
  }

  if (!isOpen) return null

  // Aspect ratio calculation (e.g. 9:16 or 16:9)
  const isVertical = (activeTimeline?.height || 1080) > (activeTimeline?.width || 1920)
  const scrubRatio = totalDuration > 0 ? (selectedTime / totalDuration) : 0

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm select-none p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[620px] rounded-xl border border-zinc-700/80 bg-zinc-900/95 shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">
            {t('cover.selectTitle') || 'Select a cover'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center">
          {/* Video / Image Preview Area */}
          <div
            className={`relative rounded-lg overflow-hidden bg-black border border-zinc-800 shadow-xl flex items-center justify-center ${
              isVertical ? 'w-[260px] h-[390px]' : 'w-[440px] h-[248px]'
            }`}
          >
            {tab === 'local' && localImageUrl ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={localImageUrl}
                  alt="Local cover preview"
                  className="w-full h-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setLocalImageUrl(null)}
                  className="absolute top-2.5 right-2.5 p-1 rounded-full bg-black/70 hover:bg-red-600 text-zinc-300 hover:text-white border border-zinc-700/80 transition-colors shadow-md cursor-pointer"
                  title="Xoá ảnh này"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full h-full object-contain pointer-events-none"
                muted
                playsInline
                preload="auto"
                onSeeked={handleVideoSeeked}
                onLoadedData={captureFrame}
                onCanPlay={captureFrame}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-zinc-500">
                <Film className="h-8 w-8 text-zinc-600" />
                <span className="text-xs">No video footage on timeline</span>
              </div>
            )}

            {/* Timecode overlay badge */}
            {tab === 'video' && (
              <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[11px] font-mono text-zinc-200">
                {formatTime(selectedTime)}
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {/* Segmented Tab Switcher */}
          <div className="mt-5 flex items-center p-1 rounded-lg bg-zinc-950 border border-zinc-800">
            <button
              onClick={() => setTab('video')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'video'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t('cover.selectFromVideo') || 'Select from video'}
            </button>
            <button
              onClick={() => setTab('local')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'local'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t('cover.local') || 'Local'}
            </button>
          </div>

          {/* Tab Content */}
          {tab === 'video' ? (
            <div className="w-full mt-5">
              {/* Filmstrip Scrubber Track */}
              <div
                ref={scrubberRef}
                onMouseDown={handleScrubStart}
                className="relative h-12 rounded-md bg-zinc-950 border border-zinc-700/80 cursor-pointer overflow-hidden group shadow-inner"
              >
                {/* Visual filmstrip ticks/thumbs representation */}
                <div className="absolute inset-0 flex">
                  {videoClips.length > 0 ? (
                    videoClips.map((clip, idx) => {
                      const widthPct = Math.max(2, (clip.duration / totalDuration) * 100)
                      return (
                        <div
                          key={clip.id}
                          className="h-full border-r border-zinc-800 bg-zinc-800/40 relative overflow-hidden flex items-center justify-center"
                          style={{ width: `${widthPct}%` }}
                        >
                          <span className="text-[9px] text-zinc-500 font-mono truncate px-1">
                            {clip.importedName || `Clip ${idx + 1}`}
                          </span>
                        </div>
                      )
                    })
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                      Empty timeline
                    </div>
                  )}
                </div>

                {/* Draggable needle / playhead pin */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none transition-transform"
                  style={{ left: `${scrubRatio * 100}%`, transform: 'translateX(-50%)' }}
                >
                  {/* Pin teardrop / rounded handle at top */}
                  <div className="w-3.5 h-3.5 bg-white border border-sky-400 rounded-t-sm rounded-b-full shadow-md mx-auto" />
                  {/* Vertical needle bar */}
                  <div className="w-0.5 h-full bg-white mx-auto shadow" />
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full mt-4 flex flex-col items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-zinc-600 hover:border-sky-400 hover:bg-zinc-800/50 text-zinc-300 hover:text-white transition-all text-xs"
              >
                <Upload className="h-4 w-4 text-sky-400" />
                <span>{t('cover.uploadImage') || 'Choose local image (PNG, JPG, WEBP)'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-zinc-950/60 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setLocalImageUrl(null)
                handleProceedToDesign()
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              {t('cover.createNewCover') || 'Create new cover'}
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleProceedToDesign}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-sky-500 hover:bg-sky-400 shadow-sm transition-colors"
            >
              {t('cover.editCover') || 'Edit cover'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
