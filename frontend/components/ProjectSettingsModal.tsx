import { useState, useMemo } from 'react'
import { X, Check, Monitor, Smartphone, Square, Sliders, Palette, Image as ImageIcon, FolderOpen } from 'lucide-react'
import { useEditorActions, useEditorStore } from '../views/editor/editor-store'
import { selectActiveTimeline, selectAssets } from '../views/editor/editor-selectors'
import { useTranslation } from '../i18n/I18nContext'
import type { TimelineBackground } from '@core/project-model'
import { DEFAULT_TIMELINE_BACKGROUND, effectiveTimelineBackground } from '@core/project-model'
import { useProjects } from '../contexts/ProjectContext'
import { persistProjectToDisk } from '../lib/project-storage'
import { updatedProject } from '@core/editor-project-bridging'
import {
  TIMELINE_PRESETS,
  formatAspectRatio,
  getEffectiveTimelineDimensions,
} from '@core/video-resolution'

const FPS_OPTIONS = [
  { value: 24, label: '24 fps (Cinema)' },
  { value: 25, label: '25 fps (PAL)' },
  { value: 29.97, label: '29.97 fps (NTSC)' },
  { value: 30, label: '30 fps (Standard Web)' },
  { value: 50, label: '50 fps (PAL High)' },
  { value: 59.94, label: '59.94 fps (NTSC High)' },
  { value: 60, label: '60 fps (Smooth / Gaming)' },
]

export function ProjectSettingsModal() {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const assets = useEditorStore(selectAssets)

  const effectiveDims = useMemo(
    () => getEffectiveTimelineDimensions(activeTimeline, assets),
    [activeTimeline, assets],
  )

  const [name, setName] = useState(activeTimeline?.name ?? 'Main Timeline')
  const [width, setWidth] = useState(effectiveDims.width)
  const [height, setHeight] = useState(effectiveDims.height)
  const [fps, setFps] = useState(effectiveDims.fps)
  const [background, setBackground] = useState<TimelineBackground>(
    effectiveTimelineBackground(activeTimeline?.background) ?? DEFAULT_TIMELINE_BACKGROUND,
  )

  const handlePickImage = async () => {
    try {
      const files = await window.electronAPI.showOpenFileDialog({
        title: t('projectSettings.selectBgImageDialog'),
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        properties: ['openFile'],
      })
      if (files && files.length > 0) {
        setBackground({ type: 'image', imagePath: files[0] })
      }
    } catch {
      // ignore
    }
  }

  // Find matching preset, or 'custom'
  const selectedPresetId = useMemo(() => {
    const match = TIMELINE_PRESETS.find(p => p.width === width && p.height === height)
    return match ? match.id : 'custom'
  }, [width, height])

  const currentAspectRatio = useMemo(() => formatAspectRatio(width, height), [width, height])

  const handleSelectPreset = (presetId: string) => {
    if (presetId === 'custom') return
    const preset = TIMELINE_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setWidth(preset.width)
      setHeight(preset.height)
    }
  }

  const { activeProject, setProject } = useProjects()
  const editorModel = useEditorStore(state => state.editorModel)

  const handleSave = () => {
    if (!activeTimeline?.id) return
    const validWidth = Math.max(16, Math.min(7680, Math.round(width)))
    const validHeight = Math.max(16, Math.min(4320, Math.round(height)))
    const validFps = Math.max(1, Math.min(120, fps))

    actions.setTimelineSettings(activeTimeline.id, {
      name: name.trim() || undefined,
      width: validWidth,
      height: validHeight,
      fps: validFps,
      background,
    })

    if (activeProject) {
      const updatedEditorModel = {
        ...editorModel,
        timelines: editorModel.timelines.map(tl => {
          if (tl.id !== activeTimeline.id) return tl
          return {
            ...tl,
            name: name.trim() || tl.name,
            width: validWidth,
            height: validHeight,
            fps: validFps,
            background,
          }
        }),
      }
      const updated = updatedProject(activeProject, updatedEditorModel)
      setProject(activeProject.id, updated)
      void persistProjectToDisk(activeProject.id, updated)
    }

    actions.closeProjectSettingsModal()
  }

  const handleCancel = () => {
    actions.closeProjectSettingsModal()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div className="flex flex-col w-full max-w-[560px] max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-4 w-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-zinc-100">{t('projectSettings.title')}</h2>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-[13px]">
          {/* Timeline Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">{t('projectSettings.timelineName')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full h-8 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-teal-500 transition-colors"
              placeholder={t('projectSettings.timelineNamePlaceholder')}
            />
          </div>

          {/* Aspect Ratio & Resolution Presets */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">{t('projectSettings.aspectRatioPreset')}</label>
            <div className="grid grid-cols-2 gap-2">
              {TIMELINE_PRESETS.map(preset => {
                const isSelected = selectedPresetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-teal-500/10 border-teal-500 text-teal-300 shadow-sm'
                        : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60 hover:border-zinc-700'
                    }`}
                  >
                    <div className="mt-0.5 text-zinc-400">
                      {preset.aspectRatioLabel === '9:16' ? (
                        <Smartphone className="h-4 w-4" />
                      ) : preset.aspectRatioLabel === '1:1' || preset.aspectRatioLabel === '4:5' ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <Monitor className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{preset.aspectRatioLabel}</span>
                        <span className="text-[11px] text-zinc-400 font-mono">
                          {preset.width}×{preset.height}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate mt-0.5">{preset.name}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom Resolution and Visual Preview */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">{t('projectSettings.dimensionsAndRatio')}</label>
              <span className="text-xs font-mono text-teal-400 font-semibold">
                {currentAspectRatio} ({width} × {height})
              </span>
            </div>

            <div className="flex items-center gap-4 p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl">
              {/* Visual preview box */}
              <div className="w-24 h-20 flex-shrink-0 flex items-center justify-center bg-zinc-900 border border-zinc-800/90 rounded-lg p-1">
                <div
                  className="bg-teal-500/20 border border-teal-400 rounded-sm flex items-center justify-center transition-all duration-200"
                  style={{
                    width: width >= height ? '100%' : `${Math.max(20, Math.min(100, (width / height) * 100))}%`,
                    height: height >= width ? '100%' : `${Math.max(20, Math.min(100, (height / width) * 100))}%`,
                  }}
                >
                  <span className="text-[9px] font-mono text-teal-300">{currentAspectRatio}</span>
                </div>
              </div>

              {/* Inputs */}
              <div className="flex-1 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-400">{t('projectSettings.widthPx')}</span>
                  <input
                    type="number"
                    min={16}
                    max={7680}
                    step={2}
                    value={width}
                    onChange={e => setWidth(Math.max(16, parseInt(e.target.value, 10) || 16))}
                    className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-mono focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-zinc-400">{t('projectSettings.heightPx')}</span>
                  <input
                    type="number"
                    min={16}
                    max={4320}
                    step={2}
                    value={height}
                    onChange={e => setHeight(Math.max(16, parseInt(e.target.value, 10) || 16))}
                    className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-mono focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Frame Rate */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">{t('projectSettings.frameRate')}</label>
            <select
              value={fps}
              onChange={e => setFps(parseFloat(e.target.value))}
              className="w-full h-8 px-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-teal-500 transition-colors"
            >
              {FPS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Canvas Background (Aspect Ratio Compensation) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">{t('projectSettings.canvasBackground')}</label>
              <span className="text-[11px] text-zinc-500">{t('projectSettings.canvasBackgroundDesc')}</span>
            </div>

            {/* Mode selection tabs */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-950/80 border border-zinc-800 rounded-xl">
              <button
                type="button"
                onClick={() => setBackground(prev => ({ type: 'color', color: prev.type === 'color' ? prev.color : '#000000' }))}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  background.type === 'color'
                    ? 'bg-zinc-800 text-teal-300 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Palette className="h-3.5 w-3.5" />
                {t('projectSettings.bgModes.color')}
              </button>
              <button
                type="button"
                onClick={() => setBackground(prev => ({ type: 'image', imagePath: prev.type === 'image' ? prev.imagePath : '' }))}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  background.type === 'image'
                    ? 'bg-zinc-800 text-teal-300 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {t('projectSettings.bgModes.image')}
              </button>
            </div>

            {/* Mode-specific controls */}
            {background.type === 'color' && (
              <div className="flex items-center gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
                {/* Swatches */}
                <div className="flex items-center gap-2">
                  {[
                    { label: t('projectSettings.swatches.black'), hex: '#000000' },
                    { label: t('projectSettings.swatches.darkZinc'), hex: '#18181b' },
                    { label: t('projectSettings.swatches.slate'), hex: '#0f172a' },
                    { label: t('projectSettings.swatches.white'), hex: '#ffffff' },
                  ].map(swatch => (
                    <button
                      key={swatch.hex}
                      type="button"
                      title={swatch.label}
                      onClick={() => setBackground({ type: 'color', color: swatch.hex })}
                      className={`w-6 h-6 rounded-full border transition-transform ${
                        (background.color || '').toLowerCase() === swatch.hex.toLowerCase()
                          ? 'scale-110 border-teal-400 ring-2 ring-teal-400/20'
                          : 'border-zinc-700 hover:scale-105'
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                </div>

                <div className="h-4 w-px bg-zinc-800 mx-1" />

                {/* Custom Color Input */}
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="color"
                    value={background.color || '#000000'}
                    onChange={e => setBackground({ type: 'color', color: e.target.value })}
                    className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={background.color || '#000000'}
                    onChange={e => setBackground({ type: 'color', color: e.target.value })}
                    className="flex-1 h-7 px-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-mono focus:outline-none focus:border-teal-500"
                    placeholder="#000000"
                  />
                </div>
              </div>
            )}

            {background.type === 'image' && (
              <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePickImage}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-teal-400" />
                    {t('projectSettings.chooseImage')}
                  </button>
                  <span className="text-[11px] text-zinc-400 truncate flex-1">
                    {background.imagePath ? background.imagePath.split(/[\\/]/).pop() : t('projectSettings.noImageSelected')}
                  </span>
                </div>
                {background.imagePath && (
                  <p className="text-[10px] text-zinc-500 font-mono break-all">
                    {background.imagePath}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-zinc-800 bg-zinc-950/70">
          <button
            type="button"
            onClick={handleCancel}
            className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
          >
            {t('projectSettings.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-6 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 text-xs font-semibold transition-colors shadow-lg shadow-teal-500/20"
          >
            <Check className="h-3.5 w-3.5" />
            {t('projectSettings.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}
