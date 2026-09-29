import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Pause, Play } from 'lucide-react'
import type { Asset, TimelineClip } from '../../types/project-model'
import { clampReplacementStart, replacementSlack, replacementSourceSpan } from '@core/clip-replace'
import { pathToFileUrl } from '../../lib/file-url'
import { useTranslation } from '../../i18n/I18nContext'

export interface ReplaceSegmentPickerProps {
  clip: TimelineClip
  /** A video with more media than the clip plays. */
  asset: Asset
  onBack: () => void
  onConfirm: (sourceStart: number) => void
}

/** 01:02.3 — tenths are the resolution the picker moves in. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

const NUDGE = 0.1
const NUDGE_FAST = 1

/**
 * Where in a longer video the replaced clip starts.
 *
 * The bar is the whole video; the bright window is exactly the stretch the clip will play,
 * so it can only be moved, never resized — the clip's length is fixed. The preview shows
 * the window's first frame as it moves, and Play runs just the window.
 */
export function ReplaceSegmentPicker({ clip, asset, onBack, onConfirm }: ReplaceSegmentPickerProps) {
  const { t } = useTranslation()
  const mediaDuration = asset.duration ?? 0
  const span = replacementSourceSpan(clip)
  const slack = replacementSlack(clip, asset)

  const [start, setStart] = useState(0)
  const [playing, setPlaying] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const dragRef = useRef<{ pointerX: number; start: number } | null>(null)

  const clamp = useCallback((value: number) => clampReplacementStart(value, clip, asset), [clip, asset])
  const secondsPerPixel = () => mediaDuration / Math.max(1, barRef.current?.getBoundingClientRect().width ?? 1)

  // The preview follows the window's first frame while it is being chosen.
  useEffect(() => {
    const video = videoRef.current
    if (!video || playing) return
    if (Math.abs(video.currentTime - start) > 0.04) video.currentTime = start
  }, [start, playing])

  // Play runs only the chosen stretch, then stops at its end, back at its start.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing) return
    const stopAt = start + span
    const onTime = () => {
      if (video.currentTime >= stopAt) {
        video.pause()
        video.currentTime = start
        setPlaying(false)
      }
    }
    video.currentTime = start
    void video.play().catch(() => setPlaying(false))
    video.addEventListener('timeupdate', onTime)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.pause()
    }
  }, [playing, start, span])

  const onWindowPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPlaying(false)
    dragRef.current = { pointerX: e.clientX, start }
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setStart(clamp(drag.start + (ev.clientX - drag.pointerX) * secondsPerPixel()))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // A press on the bar outside the window centres the window there.
  const onBarPointerDown = (e: React.PointerEvent) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    setPlaying(false)
    const at = ((e.clientX - rect.left) / Math.max(1, rect.width)) * mediaDuration
    setStart(clamp(at - span / 2))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? NUDGE_FAST : NUDGE
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); setStart(s => clamp(s - step)) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setStart(s => clamp(s + step)) }
    else if (e.key === 'Home') { e.preventDefault(); setStart(0) }
    else if (e.key === 'End') { e.preventDefault(); setStart(slack) }
    else if (e.key === 'Enter') { e.preventDefault(); onConfirm(clamp(start)) }
  }

  const leftPct = mediaDuration > 0 ? (start / mediaDuration) * 100 : 0
  const widthPct = mediaDuration > 0 ? Math.min(100, (span / mediaDuration) * 100) : 100

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('replaceClip.chooseSegment')}</span>
        <span className="truncate text-[11px] text-zinc-400" title={asset.path}>{asset.path.split(/[\\/]/).pop()}</span>
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16 / 9', maxHeight: '38vh' }}>
        <video
          ref={videoRef}
          src={pathToFileUrl(asset.path)}
          preload="auto"
          muted
          playsInline
          className="h-full w-full object-contain"
          onLoadedMetadata={e => { e.currentTarget.currentTime = start }}
        />
        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[11px] text-zinc-100 hover:bg-black/85"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? t('replaceClip.pausePreview') : t('replaceClip.playSegment')}
        </button>
      </div>

      {/* The whole video, and the stretch the clip will play. */}
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={t('replaceClip.chooseSegment')}
        aria-valuemin={0}
        aria-valuemax={Number(slack.toFixed(2))}
        aria-valuenow={Number(start.toFixed(2))}
        aria-valuetext={`${clock(start)} – ${clock(start + span)}`}
        data-segment-bar=""
        onPointerDown={onBarPointerDown}
        onKeyDown={onKeyDown}
        className="relative h-9 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/70"
      >
        <div
          data-segment-window=""
          onPointerDown={onWindowPointerDown}
          className="absolute inset-y-0 cursor-grab rounded-md border-2 border-cyan-400 bg-cyan-400/20 active:cursor-grabbing"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] tabular-nums text-zinc-400">
        <span>{clock(0)}</span>
        <span className="text-zinc-200">
          {t('replaceClip.segmentRange', { start: clock(start), end: clock(start + span), length: `${span.toFixed(1)}s` })}
        </span>
        <span>{clock(mediaDuration)}</span>
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">{t('replaceClip.segmentHint')}</p>

      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('replaceClip.back')}
        </button>
        <button
          type="button"
          data-segment-confirm=""
          onClick={() => onConfirm(clamp(start))}
          className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-cyan-400"
        >
          {t('replaceClip.confirm')}
        </button>
      </div>
    </div>
  )
}
