import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  X,
  Download,
  Film,
  Package,
  Music,
  Sliders,
} from 'lucide-react'
import { DEFAULT_SUBTITLE_STYLE } from '../types/project-model'
import {
  selectActiveTimeline,
  selectTimelines,
  selectAssets,
  selectClipPathFromAssets,
  selectClips,
  selectMarkers,
  selectShowExportModal,
  selectSubtitles,
  selectTracks,
} from '../views/editor/editor-selectors'
import { resolveEffectiveClipFilter } from '@core/video-editor-utils'
import { getEffectiveTimelineDimensions } from '@core/video-resolution'
import {
  EXPORT_FORMATS,
  estimateExportFileSize,
  formatFileSize,
  type ExportCodec,
  type SocialPreset,
} from '@core/export-options'
import { useEditorActions, useEditorStore } from '../views/editor/editor-store'
import { useSettings } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n/I18nContext'

import { generateFCPXML } from './export/fcpxml'
import { ExportStatusView } from './export/ExportStatusView'
import { ExportCategoryTabs, type ExportActiveTab } from './export/ExportCategoryTabs'
import { ExportVideoSettings, type ExportSettingsState } from './export/ExportVideoSettings'

interface ExportModalProps {
  projectName: string
}

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error'

const CODEC_INFO = EXPORT_FORMATS
const FRAME_RATES = [15, 24, 25, 30, 60]

const LETTERBOX_RATIO_MAP: Record<string, number> = {
  '2.35:1': 2.35,
  '2.39:1': 2.39,
  '2.76:1': 2.76,
  '1.85:1': 1.85,
  '4:3': 4 / 3,
}

export function ExportModal({ projectName }: ExportModalProps) {
  const { t } = useTranslation()
  const { closeExportModal } = useEditorActions()
  const isOpen = useEditorStore(selectShowExportModal)
  const timeline = useEditorStore(selectActiveTimeline)
  const allTimelines = useEditorStore(selectTimelines)
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const markers = useEditorStore(selectMarkers)

  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([])

  useEffect(() => {
    if (timeline?.id) {
      setSelectedVariantIds([timeline.id])
    }
  }, [timeline?.id])

  const exportClips = useMemo(() => {
    const activeAdjustmentClips = clips.filter(
      clip => clip.type === 'adjustment' && tracks[clip.trackIndex]?.enabled !== false,
    )

    return clips
      .filter(clip => tracks[clip.trackIndex]?.enabled !== false)
      .map(clip => {
        const effectiveFilter = resolveEffectiveClipFilter(clip, activeAdjustmentClips, tracks)

        return {
          id: clip.id,
          path: selectClipPathFromAssets(assets, clip) || '',
          type: clip.type,
          startTime: clip.startTime,
          duration: clip.duration,
          trimStart: clip.trimStart,
          speed: clip.speed || 1,
          reversed: clip.reversed || false,
          flipH: clip.flipH || false,
          flipV: clip.flipV || false,
          opacity: clip.opacity ?? 100,
          trackIndex: clip.trackIndex,
          muted: clip.muted || tracks[clip.trackIndex]?.muted || false,
          volume: clip.volume ?? 1,
          linkedClipIds: clip.linkedClipIds,
          transform: clip.transform ? {
            scale: clip.transform.scale ?? 100,
            positionX: clip.transform.positionX ?? 0,
            positionY: clip.transform.positionY ?? 0,
            rotation: clip.transform.rotation ?? 0,
            cropTop: clip.transform.cropTop ?? 0,
            cropRight: clip.transform.cropRight ?? 0,
            cropBottom: clip.transform.cropBottom ?? 0,
            cropLeft: clip.transform.cropLeft ?? 0,
          } : undefined,
          colorCorrection: clip.colorCorrection ? {
            brightness: clip.colorCorrection.brightness ?? 0,
            contrast: clip.colorCorrection.contrast ?? 0,
            saturation: clip.colorCorrection.saturation ?? 0,
            temperature: clip.colorCorrection.temperature ?? 0,
            tint: clip.colorCorrection.tint ?? 0,
            exposure: clip.colorCorrection.exposure ?? 0,
            highlights: clip.colorCorrection.highlights ?? 0,
            shadows: clip.colorCorrection.shadows ?? 0,
          } : undefined,
          transitionIn: clip.transitionIn ? {
            type: clip.transitionIn.type ?? 'none',
            duration: clip.transitionIn.duration ?? 0,
          } : undefined,
          transitionOut: clip.transitionOut ? {
            type: clip.transitionOut.type ?? 'none',
            duration: clip.transitionOut.duration ?? 0,
          } : undefined,
          filter: effectiveFilter,
          effects: clip.effects ? clip.effects.map(effect => ({
            type: effect.type,
            enabled: effect.enabled ?? true,
            params: effect.params || {},
          })) : undefined,
          textStyle: clip.type === 'text' || clip.textStyle ? {
            text: clip.textStyle?.text ?? (clip.type === 'text' ? 'Text' : ''),
            fontSize: clip.textStyle?.fontSize ?? 64,
            color: clip.textStyle?.color ?? '#FFFFFF',
            backgroundColor: clip.textStyle?.backgroundColor ?? 'transparent',
            positionX: clip.textStyle?.positionX ?? 50,
            positionY: clip.textStyle?.positionY ?? 50,
            strokeColor: clip.textStyle?.strokeColor ?? 'transparent',
            strokeWidth: clip.textStyle?.strokeWidth ?? 0,
            padding: clip.textStyle?.padding ?? 0,
            opacity: clip.textStyle?.opacity ?? 100,
          } : undefined,
          keyframes: clip.keyframes,
          mask: clip.mask,
          chromaKey: clip.chromaKey,
          blendMode: clip.blendMode,
          autoMatte: clip.autoMatte,
          stroke: clip.stroke,
          assetId: clip.assetId,
        }
      })
  }, [assets, clips, tracks])

  const subtitleData = useMemo(() => (
    subtitles
      .filter(subtitle => tracks[subtitle.trackIndex]?.enabled !== false)
      .map(subtitle => {
        const track = tracks[subtitle.trackIndex]
        return {
          text: subtitle.text,
          startTime: subtitle.startTime,
          endTime: subtitle.endTime,
          style: {
            ...DEFAULT_SUBTITLE_STYLE,
            ...(track?.subtitleStyle || {}),
            ...(subtitle.style || {}),
          },
        }
      })
  ), [subtitles, tracks])

  const letterbox = useMemo(() => {
    const adjustmentClips = clips.filter(
      clip =>
        clip.type === 'adjustment'
        && clip.letterbox?.enabled
        && tracks[clip.trackIndex]?.enabled !== false,
    )
    if (adjustmentClips.length === 0) return null
    const best = adjustmentClips.reduce((currentBest, candidate) => (
      candidate.duration > currentBest.duration ? candidate : currentBest
    ))
    const config = best.letterbox!
    return {
      ratio: config.aspectRatio === 'custom'
        ? (config.customRatio || 2.35)
        : (LETTERBOX_RATIO_MAP[config.aspectRatio] || 2.35),
      color: config.color || '#000000',
      opacity: (config.opacity ?? 100) / 100,
    }
  }, [clips, tracks])

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportType, setExportType] = useState<'package' | 'video' | null>(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [exportFrameInfo, setExportFrameInfo] = useState('')
  const abortRef = useRef(false)
  const activeJobIdRef = useRef<string | null>(null)
  const { settings: appSettings } = useSettings()

  const effectiveDimensions = useMemo(() => {
    return getEffectiveTimelineDimensions(timeline, assets, appSettings.defaultFps ?? 30)
  }, [timeline, assets, appSettings.defaultFps])

  const [activeTab, setActiveTab] = useState<ExportActiveTab>('video')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)

  const [settings, setSettings] = useState<ExportSettingsState>(() => ({
    codec: 'h264',
    width: effectiveDimensions.width,
    height: effectiveDimensions.height,
    fps: effectiveDimensions.fps,
    quality: 18,
    customBitrateMbps: 8,
    useCustomBitrate: false,
  }))
  const [burnSubtitles, setBurnSubtitles] = useState(true)

  const timelineDuration = useMemo(() => {
    return exportClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
  }, [exportClips])

  const estimatedSizeBytes = useMemo(() => {
    return estimateExportFileSize({
      durationSec: timelineDuration,
      codec: settings.codec,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      quality: settings.quality,
      customBitrateMbps: settings.useCustomBitrate ? settings.customBitrateMbps : undefined,
    })
  }, [timelineDuration, settings])

  const availableResolutions = useMemo(() => {
    const list: Array<{ label: string; width: number; height: number }> = [
      {
        label: `Project: ${effectiveDimensions.width} × ${effectiveDimensions.height} (${effectiveDimensions.aspectRatioLabel})`,
        width: effectiveDimensions.width,
        height: effectiveDimensions.height,
      },
    ]

    const presets = [
      { label: '1080p (1920 x 1080)', width: 1920, height: 1080 },
      { label: '4K UHD (3840 x 2160)', width: 3840, height: 2160 },
      { label: '720p HD (1280 x 720)', width: 1280, height: 720 },
      { label: 'Vertical 1080p (1080 x 1920)', width: 1080, height: 1920 },
      { label: 'Vertical 720p (720 x 1280)', width: 720, height: 1280 },
      { label: 'Square 1:1 (1080 x 1080)', width: 1080, height: 1080 },
      { label: 'Portrait 4:5 (1080 x 1350)', width: 1080, height: 1350 },
    ]

    for (const p of presets) {
      if (!list.some(r => r.width === p.width && r.height === p.height)) {
        list.push(p)
      }
    }
    return list
  }, [effectiveDimensions])

  const availableFps = useMemo(() => {
    const list = [...FRAME_RATES]
    if (!list.includes(effectiveDimensions.fps)) {
      list.push(effectiveDimensions.fps)
      list.sort((a, b) => a - b)
    }
    return list
  }, [effectiveDimensions.fps])

  const closeModal = useCallback(() => {
    closeExportModal()
  }, [closeExportModal])

  const hasSubtitles = subtitleData.length > 0

  useEffect(() => {
    if (!isOpen) return
    const dims = getEffectiveTimelineDimensions(timeline, assets, appSettings.defaultFps ?? 30)
    setSettings(prev => ({
      ...prev,
      width: dims.width,
      height: dims.height,
      fps: dims.fps,
    }))
    setExportStatus('idle')
    setExportType(null)
    setExportProgress(0)
    setExportError(null)
    setExportPath(null)
    setExportFrameInfo('')
    abortRef.current = false
    activeJobIdRef.current = null
    setSelectedPresetId(null)
    setActiveTab('video')
  }, [isOpen, appSettings.defaultFps, timeline, assets])

  useEffect(() => {
    if (!window.electronAPI?.on) return

    const unsubProgress = window.electronAPI.on('render:progress', payload => {
      if (activeJobIdRef.current && payload.jobId === activeJobIdRef.current) {
        setExportProgress(Math.round(payload.percent))
        const parts: string[] = []
        if (payload.fps) parts.push(`${Math.round(payload.fps)} fps`)
        if (payload.speed) parts.push(`${payload.speed.toFixed(1)}x`)
        setExportFrameInfo(parts.length > 0 ? `Rendering... (${parts.join(', ')})` : 'Rendering...')
      }
    })

    const unsubComplete = window.electronAPI.on('render:complete', payload => {
      if (activeJobIdRef.current && payload.jobId === activeJobIdRef.current) {
        setExportProgress(100)
        setExportPath(payload.outputPath)
        setExportFrameInfo('Export complete')
        setExportStatus('done')
        activeJobIdRef.current = null

        const isWindowFocusedAndModalOpen = typeof document !== 'undefined' && document.hasFocus() && isOpen
        if (appSettings.exportNotifications && !isWindowFocusedAndModalOpen) {
          window.electronAPI?.showNotification({
            title: t('export.complete'),
            body: `${t('export.exportSuccessNotification', { name: projectName })} ${t('export.showInFolder')}`,
            filePath: payload.outputPath,
          })
        }
      }
    })

    const unsubError = window.electronAPI.on('render:error', payload => {
      if (activeJobIdRef.current && payload.jobId === activeJobIdRef.current) {
        setExportError(payload.error)
        setExportStatus('error')
        activeJobIdRef.current = null
      }
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  }, [isOpen, projectName, t, appSettings.exportNotifications])

  const handleCodecChange = useCallback((codec: ExportCodec) => {
    let quality = 18
    if (codec === 'prores') quality = 3
    if (codec === 'vp9') quality = 8
    setSettings(prev => ({
      ...prev,
      codec,
      quality,
      fps: codec === 'gif' ? Math.min(30, prev.fps) : prev.fps,
    }))
  }, [])

  const handleSelectSocialPreset = useCallback((preset: SocialPreset) => {
    setSelectedPresetId(preset.id)
    setSettings(prev => ({
      ...prev,
      codec: 'h264',
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
      customBitrateMbps: preset.bitrateMbps,
      useCustomBitrate: true,
      quality: 18,
    }))
  }, [])

  const handleExportPackage = useCallback(async () => {
    if (!timeline) return
    setExportType('package')
    setExportStatus('exporting')
    setExportProgress(0)
    setExportError(null)

    try {
      const filePath = await window.electronAPI?.showSaveDialog({
        title: 'Export FCPXML Package',
        defaultPath: `${projectName}_${timeline.name}.fcpxml`,
        filters: [
          { name: 'Final Cut Pro XML', extensions: ['fcpxml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (!filePath) {
        setExportStatus('idle')
        return
      }

      setExportFrameInfo('Generating FCPXML...')
      const xml = generateFCPXML(clips, tracks, projectName, timeline.name)
      const result = await window.electronAPI?.saveFile({ filePath, data: xml })
      if (result?.success) {
        setExportProgress(100)
        setExportPath(filePath)
        setExportStatus('done')

        const isWindowFocusedAndModalOpen = typeof document !== 'undefined' && document.hasFocus() && isOpen
        if (appSettings.exportNotifications && !isWindowFocusedAndModalOpen) {
          window.electronAPI?.showNotification({
            title: t('export.complete'),
            body: `${t('export.exportSuccessNotification', { name: projectName })} ${t('export.showInFolder')}`,
            filePath,
          })
        }
      } else {
        throw new Error(result && !result.success ? result.error : 'Failed to save file')
      }
    } catch (err) {
      setExportError(String(err))
      setExportStatus('error')
    }
  }, [clips, tracks, timeline, projectName, isOpen, appSettings.exportNotifications, t])

  const handleExportVideo = useCallback(async () => {
    if (!timeline || exportClips.length === 0) return
    setExportType('video')
    setExportStatus('exporting')
    setExportProgress(0)
    setExportError(null)
    setExportFrameInfo('Preparing...')
    abortRef.current = false

    try {
      const codecInfo = CODEC_INFO[settings.codec]

      const filePath = await window.electronAPI?.showSaveDialog({
        title: `Export ${codecInfo.label}`,
        defaultPath: `${projectName}_${timeline.name}.${codecInfo.ext}`,
        filters: [
          { name: codecInfo.filterName, extensions: [codecInfo.ext] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (!filePath) {
        setExportStatus('idle')
        return
      }

      setExportFrameInfo('Starting render job...')

      const videoBitrateKbps = settings.useCustomBitrate && settings.customBitrateMbps
        ? settings.customBitrateMbps * 1000
        : undefined

      const startResult = await window.electronAPI?.['render.start']({
        clips: exportClips,
        outputPath: filePath,
        codec: settings.codec,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        videoBitrate: videoBitrateKbps,
        background: timeline?.background,
        letterbox: letterbox || undefined,
        subtitles: burnSubtitles && subtitleData.length > 0 ? subtitleData : undefined,
        transitions: timeline?.transitions?.length ? timeline.transitions.map(transition => ({
          leftClipId: transition.leftClipId,
          rightClipId: transition.rightClipId,
          type: transition.type,
          duration: transition.duration,
        })) : undefined,
        hardwareAcceleration: appSettings.hardwareAcceleration,
        autoMatteDevice: appSettings.autoMatteDevice,
        markers: markers.length > 0 ? markers.map(m => ({
          id: m.id,
          time: m.time,
          label: m.label,
          color: m.color,
        })) : undefined,
      })

      if (!startResult?.success || !startResult.jobId) {
        throw new Error(startResult && !startResult.success ? startResult.error : 'Failed to start render')
      }

      activeJobIdRef.current = startResult.jobId
    } catch (err) {
      setExportError(String(err))
      setExportStatus('error')
    }
  }, [
    burnSubtitles,
    exportClips,
    letterbox,
    projectName,
    settings,
    subtitleData,
    timeline,
    markers,
    appSettings.hardwareAcceleration,
    appSettings.autoMatteDevice,
  ])

  const handleCancel = useCallback(async () => {
    abortRef.current = true
    const currentJobId = activeJobIdRef.current
    if (currentJobId) {
      window.electronAPI?.['render.cancel']({ jobId: currentJobId }).catch(() => {})
      activeJobIdRef.current = null
    }
    setExportStatus('idle')
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={closeModal}
    >
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-xl relative overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-white">{t('export.title')}</h2>
            <p className="text-xs text-zinc-500">
              Duration: {Math.floor(timelineDuration / 60)}:{String(Math.floor(timelineDuration % 60)).padStart(2, '0')} · {formatFileSize(estimatedSizeBytes)} est.
            </p>
          </div>
          <button
            onClick={closeModal}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {exportStatus !== 'idle' ? (
            <ExportStatusView
              exportStatus={exportStatus}
              exportType={exportType}
              exportProgress={exportProgress}
              exportPath={exportPath}
              exportError={exportError}
              exportFrameInfo={exportFrameInfo}
              codecLabel={CODEC_INFO[settings.codec]?.label || 'output'}
              onCancel={handleCancel}
              onReset={() => {
                setExportStatus('idle')
                setExportType(null)
              }}
            />
          ) : (
            <div className="space-y-5">
              {/* Category tabs */}
              <ExportCategoryTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                selectedPresetId={selectedPresetId}
                codec={settings.codec}
                onCodecChange={handleCodecChange}
                onSelectSocialPreset={handleSelectSocialPreset}
              />

              {/* Resolution, Quality & Options */}
              <ExportVideoSettings
                activeTab={activeTab}
                settings={settings}
                setSettings={setSettings}
                availableResolutions={availableResolutions}
                availableFps={availableFps}
                estimatedSizeBytes={estimatedSizeBytes}
                hasSubtitles={hasSubtitles}
                burnSubtitles={burnSubtitles}
                setBurnSubtitles={setBurnSubtitles}
                allTimelines={allTimelines}
                timeline={timeline}
                selectedVariantIds={selectedVariantIds}
                setSelectedVariantIds={setSelectedVariantIds}
              />

              {/* Main Export Action Button */}
              <button
                onClick={handleExportVideo}
                disabled={exportClips.length === 0}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-600/20"
              >
                {activeTab === 'audio' ? (
                  <>
                    <Music className="h-4 w-4" />
                    Export Audio ({CODEC_INFO[settings.codec]?.label.split(' ')[0]})
                  </>
                ) : activeTab === 'gif' ? (
                  <>
                    <Sliders className="h-4 w-4" />
                    Export Animated GIF
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    {selectedVariantIds.length > 1
                      ? `Export ${selectedVariantIds.length} Variants (Batch)`
                      : t('export.startExport')}
                  </>
                )}
              </button>

              {/* Package export (compact) at the bottom */}
              <div className="pt-2 border-t border-zinc-800">
                <button
                  onClick={handleExportPackage}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-zinc-700/40 bg-zinc-800/30 hover:bg-zinc-800/70 hover:border-zinc-600 transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-zinc-700/40 flex items-center justify-center flex-shrink-0">
                    <Package className="h-4 w-4 text-zinc-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs font-semibold text-zinc-300">Package (FCPXML)</p>
                    <p className="text-[9px] text-zinc-500">For Premiere Pro &amp; DaVinci Resolve</p>
                  </div>
                  <Download className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors mr-1" />
                </button>
              </div>

              {exportClips.length === 0 && (
                <p className="text-xs text-zinc-500 text-center">Add clips to the timeline to export.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
