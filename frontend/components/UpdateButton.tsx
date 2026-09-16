import { useEffect, useRef, useState } from 'react'
import { Download, RotateCw, AlertCircle } from 'lucide-react'
import { useTranslation } from '../i18n/I18nContext'
import { useUpdateState } from '../hooks/useUpdateState'
import { formatDownloadSpeed } from '@core/update-state'

/**
 * Single-icon update button on the title bar and Home header.
 *
 * States:
 * - idle / checking: hidden (renders null)
 * - available: Download icon + small accent dot, click to download
 * - downloading: circular SVG progress ring around Download icon, disabled
 * - downloaded: RotateCw in accent color, pulses once on arrival, click to restart & install
 * - error: muted AlertCircle, click to retry check
 *
 * Strict layout constraints:
 * - Exactly 24px x 24px in all visible states (zero layout shift)
 * - No text inside button; all information is in the title / tooltip
 */
export function UpdateButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const { updateState, downloadUpdate, installNow, checkForUpdates } = useUpdateState()
  const [pulsing, setPulsing] = useState(false)
  const prevStatusRef = useRef(updateState.status)

  useEffect(() => {
    if (updateState.status === 'downloaded' && prevStatusRef.current !== 'downloaded') {
      setPulsing(true)
      const timer = setTimeout(() => setPulsing(false), 800)
      return () => clearTimeout(timer)
    }
    prevStatusRef.current = updateState.status
  }, [updateState.status])

  const status = updateState.status

  if (status === 'idle' || status === 'checking' || status === 'unsupported') {
    return null
  }

  const baseBtnClass =
    `editor-icon-btn cc-icon-btn app-no-drag relative flex !h-6 !w-6 h-6 w-6 flex-shrink-0 items-center justify-center rounded-[4px] transition-colors ${className}`

  if (status === 'available') {
    const tooltip = t('update.availableTooltip', {
      version: updateState.version || '',
    })

    return (
      <button
        onClick={() => { void downloadUpdate() }}
        className={`${baseBtnClass} text-zinc-300 hover:bg-zinc-800 hover:text-white`}
        title={tooltip}
        aria-label={tooltip}
      >
        <Download className="h-4 w-4" />
        {/* Accent notification dot in top-right corner */}
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-1 ring-zinc-950" />
      </button>
    )
  }

  if (status === 'downloading') {
    const percent = Math.round(updateState.percent ?? 0)
    const speed = formatDownloadSpeed(updateState.bytesPerSecond)
    const tooltip = t('update.downloadingTooltip', { percent, speed })

    // Circumference for r=9 on 24x24 viewBox: 2 * PI * 9 ≈ 56.5486
    const radius = 9
    const circumference = 2 * Math.PI * radius
    const strokeDashoffset = circumference * (1 - (updateState.percent ?? 0) / 100)

    return (
      <button
        disabled
        className={`${baseBtnClass} cursor-default opacity-90`}
        title={tooltip}
        aria-label={tooltip}
      >
        {/* Circular progress SVG */}
        <svg
          className="pointer-events-none absolute inset-0 -rotate-90 h-6 w-6"
          viewBox="0 0 24 24"
        >
          {/* Subtle background track */}
          <circle
            cx="12"
            cy="12"
            r={radius}
            className="fill-none stroke-zinc-700/60"
            strokeWidth="2"
          />
          {/* Active progress arc */}
          <circle
            cx="12"
            cy="12"
            r={radius}
            className="fill-none stroke-accent transition-all duration-150 ease-out"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <Download className="h-3.5 w-3.5 text-zinc-300" />
      </button>
    )
  }

  if (status === 'downloaded') {
    const tooltip = t('update.downloadedTooltip', {
      version: updateState.version || '',
    })

    const handleInstall = async () => {
      const res = await installNow()
      if (!res.success && res.error) {
        alert(t('update.exportInProgress'))
      }
    }

    return (
      <button
        onClick={() => { void handleInstall() }}
        className={`${baseBtnClass} text-accent hover:bg-zinc-800 ${
          pulsing ? 'animate-pulse-once' : ''
        }`}
        title={tooltip}
        aria-label={tooltip}
      >
        <RotateCw className="h-4 w-4" />
      </button>
    )
  }

  if (status === 'error') {
    const tooltip = updateState.error
      ? t('update.errorTooltip', { error: updateState.error })
      : t('update.errorTooltipGeneric')

    return (
      <button
        onClick={() => { void checkForUpdates() }}
        className={`${baseBtnClass} text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200`}
        title={tooltip}
        aria-label={tooltip}
      >
        <AlertCircle className="h-4 w-4" />
      </button>
    )
  }

  return null
}
