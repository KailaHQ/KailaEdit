import { Loader2, Check, FolderOpen, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useTranslation } from '../../i18n/I18nContext'

export interface ExportStatusViewProps {
  exportStatus: 'exporting' | 'done' | 'error'
  exportType: 'package' | 'video' | null
  exportProgress: number
  exportPath: string | null
  exportError: string | null
  exportFrameInfo: string
  codecLabel: string
  onCancel: () => void
  onReset: () => void
}

export function ExportStatusView({
  exportStatus,
  exportType,
  exportProgress,
  exportPath,
  exportError,
  exportFrameInfo,
  codecLabel,
  onCancel,
  onReset,
}: ExportStatusViewProps) {
  const { t } = useTranslation()

  if (exportStatus === 'exporting') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
          <span className="text-sm text-zinc-300">
            {exportType === 'package' ? 'Generating FCPXML...' : `Rendering ${codecLabel}...`}
          </span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${exportProgress}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">{exportProgress}% complete</p>
          {exportFrameInfo && <p className="text-xs text-zinc-500">{exportFrameInfo}</p>}
        </div>
        {exportType === 'video' && (
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-400"
            onClick={onCancel}
          >
            {t('export.cancel')}
          </Button>
        )}
      </div>
    )
  }

  if (exportStatus === 'done') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
            <Check className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-sm text-white font-medium">{t('export.complete')}</p>
            <p className="text-xs text-zinc-500 truncate max-w-[380px]">{exportPath}</p>
            {exportFrameInfo && <p className="text-xs text-zinc-500">{exportFrameInfo}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-300"
            onClick={() => {
              if (exportPath) {
                window.electronAPI?.openParentFolderOfFile({ filePath: exportPath })
              }
            }}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {t('export.openFolder')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-300"
            onClick={onReset}
          >
            Export Another
          </Button>
        </div>
      </div>
    )
  }

  if (exportStatus === 'error') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertCircle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <p className="text-sm text-white font-medium">
              {t('export.failed', { error: '' }).replace(/:\s*$/, '')}
            </p>
            <p className="text-xs text-red-400 max-w-[380px] break-words">{exportError}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-zinc-700 text-zinc-300"
          onClick={onReset}
        >
          Try Again
        </Button>
      </div>
    )
  }

  return null
}
