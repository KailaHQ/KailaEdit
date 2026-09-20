import { Loader2, Check } from 'lucide-react'
import { useSettings } from '../../../contexts/SettingsContext'
import { useProxyStore } from '../proxy-store'

export function AssetProxyBadge({
  assetId,
  status,
}: {
  assetId: string
  status?: 'none' | 'generating' | 'ready' | 'error'
}) {
  const { settings } = useSettings()
  const progress = useProxyStore((s) => s.progressMap[assetId])

  if (!settings.proxyEnabled) return null

  if (status === 'generating' || progress !== undefined) {
    const pct = progress ?? 0
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded bg-teal-950/80 text-teal-300 border border-teal-500/30 font-mono shadow-sm"
        title={`Generating proxy: ${pct}%`}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin text-teal-400" />
        {pct > 0 ? `${pct}%` : '540p'}
      </span>
    )
  }

  if (status === 'ready') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono shadow-sm"
        title="540p proxy ready"
      >
        <Check className="w-2.5 h-2.5" />
        540p
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center text-[9px] px-1 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-500/30 font-mono shadow-sm"
        title="Proxy generation error"
      >
        err
      </span>
    )
  }

  return null
}

export function AssetProxyProgressBar({
  assetId,
  status,
}: {
  assetId: string
  status?: string
}) {
  const { settings } = useSettings()
  const progress = useProxyStore((s) => s.progressMap[assetId])
  if (!settings.proxyEnabled || (status !== 'generating' && progress === undefined)) return null
  const pct = progress ?? 0
  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/80 z-20 overflow-hidden pointer-events-none">
      <div
        className="h-full bg-teal-500 transition-all duration-150"
        style={{ width: `${Math.max(4, pct)}%` }}
      />
    </div>
  )
}
