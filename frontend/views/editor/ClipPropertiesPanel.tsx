import { useState } from 'react'
import { mainVideoTrackIndex } from '@core/video-editor-utils'
import { clampClipSpeed } from '@core/clip-speed'
import { SpeedSlider } from './SpeedSlider'
import { shallow } from 'zustand/vanilla/shallow'
import {
  FileVideo, FileImage, FileAudio, Layers, Type,
  FlipHorizontal2, FlipVertical2, ChevronDown, ChevronRight,
  Palette, Eye, Sun, Contrast, Droplets, Thermometer,
  SunDim, Moon, RotateCcw, Film, Sparkles, Trash2, X,
  AlignLeft, AlignCenter, AlignRight, Crop, Pipette,
} from 'lucide-react'
import type { Asset, TimelineClip, LetterboxSettings, TextOverlayStyle, TransitionType, ClipMaskShape } from '../../types/project-model'
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_COLOR_CORRECTION, DEFAULT_LETTERBOX, MAX_CLIP_VOLUME, DEFAULT_CLIP_MASK, DEFAULT_CHROMA_KEY } from '../../types/project-model'
import { EFFECT_DEFINITIONS } from '../../types/project'
import {
  PropertyNumberInput,
  PropertyToggle,
  PropertyAlignmentBar,
  PropertyRotateDial,
} from './PropertyControls'
import { TEXT_PRESETS, TEXT_ANIMATIONS } from '@core/text-presets'
import { isPreviewBoostAvailable } from './audio-boost'
import { namedResolutionTier } from '../../lib/video-resolution'
import { formatTime } from './video-editor-utils'
import { getFilterDefinition } from '@core/filters'
import { BLEND_MODES, type ClipBlendMode } from '@core/blend-modes'
import { useTranslation } from '../../i18n/I18nContext'
import { useSettings } from '../../contexts/SettingsContext'
import {
  selectActiveTimeline,
  selectAssets,
  selectClips,
  selectCurrentTime,
  selectEyedropperMode,
  selectMaskMode,
  selectSelectedClipAudioControls,
  selectSelectedClipForProperties,
  selectTracks,
} from './editor-selectors'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { KeyframeDiamondButton } from './KeyframeDiamondButton'
import { hasKeyframesForProperty, getAudioFadeDurations, sampleClipAt } from '@core/keyframes'
import { computeSpeechIntervalsFromSilence, voiceClipSpeechToTimeline } from '@core/audio-ducking'

/** The tabs across the top of the right-hand panel. */
type PropertiesTab = 'text' | 'adjust' | 'video' | 'audio' | 'speed' | 'effects' | 'metadata'

export function ClipPropertiesPanel() {
  const {
    clearClipEffects,
    removeClipEffect,
    setClipEffectEnabled,
    setClipEffectParam,
    setClipAudioLevel,
    setClipAudioMuted,
    setAudioFade,
    normalizeClipAudio,
    duckClipAudio,
    removeClipFilter,
    setClipFilterIntensity,
    updateClip,
    setClipSpeed,
    setClipStartTime,
    setKeyframe,
    setClipMask,
    setMaskMode,
    toggleMaskMode,
    setClipChromaKey,
    toggleEyedropperMode,
    setClipBlendMode,
    applyTextPresetToClip,
    applyTextAnimationToClip,
    clearKeyframes,
  } = useEditorActions()
  const getEditorState = useEditorGetState()

  const { t } = useTranslation()
  const { settings } = useSettings()
  const activeTimelineFps = useEditorStore(state => selectActiveTimeline(state)?.fps)
  const fps = activeTimelineFps ?? settings.defaultFps ?? 30
  const timecodeFormat = settings.timecodeFormat ?? 'timecode'
  const assets = useEditorStore(selectAssets)
  const tracks = useEditorStore(selectTracks)
  const clips = useEditorStore(selectClips)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const clipAudioControls = useEditorStore(selectSelectedClipAudioControls, shallow)
  const currentTime = useEditorStore(selectCurrentTime)
  if (!selectedClip) return null

  const timeInClip = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.startTime))
  const sampledClip = sampleClipAt(selectedClip, timeInClip)

  const effectiveMuted = clipAudioControls?.muted ?? (selectedClip.muted || false)
  const effectiveVolume = clipAudioControls?.volume ?? (selectedClip.volume ?? 1)

  const getLiveAsset = (clip: TimelineClip): Asset | null | undefined => {
    if (!clip.assetId) return clip.asset
    return assets.find(asset => asset.id === clip.assetId) || clip.asset
  }

  const getMaxClipDuration = (clip: TimelineClip): number => {
    const isTimeBasedMedia = clip.type === 'video' || clip.type === 'audio'
    const liveAsset = getLiveAsset(clip)
    if (!isTimeBasedMedia || !liveAsset?.duration) return Infinity
    const mediaDuration = liveAsset.duration
    const usableMedia = mediaDuration - clip.trimStart - clip.trimEnd
    return Math.max(0.5, usableMedia / clip.speed)
  }

  const [propertiesTab, setPropertiesTab] = useState<PropertiesTab>('video')
  const [videoSubTab, setVideoSubTab] = useState<'basic' | 'remove-bg' | 'mask' | 'retouch'>('basic')
  const [uniformScale, setUniformScale] = useState(true)
  const [showBlend, setShowBlend] = useState(true)
  const [showTransitions, setShowTransitions] = useState(false)
  const [showColorCorrection, setShowColorCorrection] = useState(false)
  const [showTransform, setShowTransform] = useState(true)
  const maskMode = useEditorStore(selectMaskMode)
  const eyedropperMode = useEditorStore(selectEyedropperMode)
  const [targetLufs, setTargetLufs] = useState<number>(-14)
  const [isMeasuringLoudness, setIsMeasuringLoudness] = useState<boolean>(false)
  const [loudnessMessage, setLoudnessMessage] = useState<string | null>(null)
  const [duckingDb, setDuckingDb] = useState<number>(-12)
  const [duckingAttack, setDuckingAttack] = useState<number>(0.3)
  const [duckingRelease, setDuckingRelease] = useState<number>(0.5)
  const [duckingSourceTrack, setDuckingSourceTrack] = useState<string>('other')
  const [isDuckingProcessing, setIsDuckingProcessing] = useState<boolean>(false)
  const [duckingMessage, setDuckingMessage] = useState<string | null>(null)

  const getClipDimensions = (clip: TimelineClip): { width: number; height: number } | null => {
    if (clip.type === 'audio') return null
    const liveAsset = getLiveAsset(clip)
    if (!liveAsset) return null

    if (liveAsset.width && liveAsset.height) {
      return { width: liveAsset.width, height: liveAsset.height }
    }

    return null
  }

  // The main video track is magnetic: clips there are packed end to end, so a
  // start time typed into the panel would be overwritten by the pack.
  const isOnMagneticTrack = mainVideoTrackIndex(tracks) === selectedClip.trackIndex
  const hasPlaybackControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasAudioControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasVisualTransformControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasTransitionControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasColorCorrectionControls = selectedClip.type === 'video' || selectedClip.type === 'image'

  // Which tabs exist depends on the clip: shows Video/Audio/Speed for
  // a video, but Text for a text overlay.
  const tabs: { id: PropertiesTab; label: string }[] = [
    ...(selectedClip.type === 'text' ? [{ id: 'text' as const, label: 'Text' }] : []),
    ...(selectedClip.type === 'adjustment' ? [{ id: 'adjust' as const, label: 'Adjust' }] : []),
    ...(hasVisualTransformControls ? [{ id: 'video' as const, label: 'Video' }] : []),
    ...(hasAudioControls ? [{ id: 'audio' as const, label: 'Audio' }] : []),
    ...(hasPlaybackControls ? [{ id: 'speed' as const, label: 'Speed' }] : []),
    { id: 'effects', label: 'Effects' },
    { id: 'metadata', label: 'Info' },
  ]

  // Keep the selection valid as the clip type changes under us.
  const tab: PropertiesTab = tabs.some(t => t.id === propertiesTab)
    ? propertiesTab
    : tabs[0].id

  return (
    <div className="flex h-full w-full flex-shrink-0 flex-col bg-zinc-900">
      {/* Tab strip */}
      <div className="flex h-[34px] flex-shrink-0 items-center gap-4 overflow-x-auto border-b border-zinc-800 px-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setPropertiesTab(t.id)}
            className={`flex-shrink-0 text-[13px] transition-colors ${
              tab === t.id ? 'text-accent' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
      {/* Info tab */}
      {tab === 'metadata' && (() => {
        const liveAsset = getLiveAsset(selectedClip)
        const dims = getClipDimensions(selectedClip)
        const filePath = liveAsset?.path || ''
        const qualityTier = dims ? namedResolutionTier(Math.min(dims.width, dims.height)) : 0

        return (
          <div className="space-y-3">
            {/* Currently Displayed */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Currently Displayed</h4>
              <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                {dims ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Quality</span>
                      <span className="text-xs text-white">
                        {qualityTier >= 2160 ? 'Ultra HD' : qualityTier >= 1080 ? 'Full HD' : qualityTier >= 720 ? 'HD' : 'SD'}
                      </span>
                    </div>
                    {dims.width > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">Dimensions</span>
                        <span className="text-xs text-white font-mono">{dims.width} × {dims.height}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-zinc-500 italic">Dimension metadata unavailable.</div>
                )}
              </div>
            </div>

            {/* Clip Info */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Clip Info</h4>
              <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Type</span>
                  <div className="flex items-center gap-1">
                    {selectedClip.type === 'video' && <FileVideo className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'image' && <FileImage className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'audio' && <FileAudio className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'text' && <Type className="h-3 w-3 text-zinc-400" />}
                    <span className="text-xs text-white capitalize">{selectedClip.type}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Duration</span>
                  <span className="text-xs text-white">{selectedClip.duration.toFixed(2)}s</span>
                </div>
                {liveAsset?.duration && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Source Duration</span>
                    <span className="text-xs text-white">{liveAsset.duration.toFixed(2)}s</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Speed</span>
                  <span className="text-xs text-white">{selectedClip.speed}x</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Track</span>
                  <span className="text-xs text-white">{tracks[selectedClip.trackIndex]?.name || `Track ${selectedClip.trackIndex + 1}`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Start</span>
                  <span className="text-xs text-white">{formatTime(selectedClip.startTime, fps, timecodeFormat)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">End</span>
                  <span className="text-xs text-white">{formatTime(selectedClip.startTime + selectedClip.duration, fps, timecodeFormat)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Trim In</span>
                  <span className="text-xs text-white">{selectedClip.trimStart.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Trim Out</span>
                  <span className="text-xs text-white">{selectedClip.trimEnd.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Opacity</span>
                  <span className="text-xs text-white">{selectedClip.opacity}%</span>
                </div>
              </div>
            </div>

            {/* File Path */}
            {filePath && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">File</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <p className="text-[10px] text-zinc-400 break-all font-mono leading-relaxed">{filePath}</p>
                </div>
              </div>
            )}

            {/* Asset Created At */}
            {liveAsset?.createdAt && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Created</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <span className="text-xs text-zinc-300">{new Date(liveAsset.createdAt).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {tab !== 'metadata' && <div className="space-y-4">
        {/* Adjustment Layer properties */}
        {tab === 'adjust' && selectedClip.type === 'adjustment' && (() => {
          const lb = { ...DEFAULT_LETTERBOX, ...selectedClip.letterbox }
          const updateLetterbox = (patch: Partial<LetterboxSettings>) => {
            updateClip(selectedClip.id, { letterbox: { ...lb, ...patch } })
          }
          return (
            <div className="bg-blue-950/30 border border-blue-700/30 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-4 w-4 text-blue-400" />
                <h4 className="text-xs font-semibold text-blue-300">Adjustment Layer</h4>
              </div>

              {/* Letterbox toggle */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Letterbox</span>
                <button
                  onClick={() => updateLetterbox({ enabled: !lb.enabled })}
                  className={`px-2.5 py-0.5 rounded text-[10px] border transition-colors ${
                    lb.enabled
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500/40'
                      : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                  }`}
                >
                  {lb.enabled ? 'On' : 'Off'}
                </button>
              </div>

              {lb.enabled && (
                <>
                  {/* Aspect ratio */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Aspect Ratio</span>
                    <select
                      value={lb.aspectRatio}
                      onChange={e => updateLetterbox({ aspectRatio: e.target.value as LetterboxSettings['aspectRatio'] })}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="2.39:1">2.39:1 (Anamorphic)</option>
                      <option value="2.35:1">2.35:1 (Cinemascope)</option>
                      <option value="2.76:1">2.76:1 (Ultra Panavision)</option>
                      <option value="1.85:1">1.85:1 (Flat Widescreen)</option>
                      <option value="4:3">4:3 (Classic TV)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {/* Custom ratio input */}
                  {lb.aspectRatio === 'custom' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400">Custom Ratio</span>
                      <input
                        type="number"
                        step={0.01}
                        min={1}
                        max={4}
                        value={lb.customRatio || 2.35}
                        onChange={e => updateLetterbox({ customRatio: parseFloat(e.target.value) || 2.35 })}
                        onKeyDown={e => e.stopPropagation()}
                        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white text-center focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  )}

                  {/* Bar color */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Bar Color</span>
                    <input
                      type="color"
                      value={lb.color}
                      onChange={e => updateLetterbox({ color: e.target.value })}
                      className="w-7 h-6 rounded cursor-pointer border border-zinc-700"
                    />
                  </div>

                  {/* Bar opacity */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Bar Opacity</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={0} max={100} value={lb.opacity}
                        onChange={e => updateLetterbox({ opacity: parseInt(e.target.value) })}
                        className="w-20 accent-blue-500"
                      />
                      <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{lb.opacity}%</span>
                    </div>
                  </div>
                </>
              )}

              {/* Color correction note */}
              <p className="text-[9px] text-zinc-600 pt-1 border-t border-zinc-800">
                Color correction on this layer affects all tracks below.
              </p>
            </div>
          )
        })()}

        {/* Text overlay properties */}
        {tab === 'text' && selectedClip.type === 'text' && selectedClip.textStyle && (() => {
          const ts = selectedClip.textStyle
          const updateText = (patch: Partial<TextOverlayStyle>) => {
            updateClip(selectedClip.id, { textStyle: { ...ts, ...patch } })
          }
          return (
            <div className="bg-cyan-950/30 border border-cyan-700/30 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Type className="h-4 w-4 text-cyan-400" />
                <h4 className="text-xs font-semibold text-cyan-300">Text Overlay</h4>
              </div>

              {/* Text content */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Content</span>
                <textarea
                  value={ts.text}
                  onChange={e => updateText({ text: e.target.value })}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-cyan-500/50"
                  placeholder="Enter text..."
                />
              </div>

              {/* Preset selector */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Preset Style</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    if (e.target.value) {
                      applyTextPresetToClip(selectedClip.id, e.target.value)
                      e.target.value = ''
                    }
                  }}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50 max-w-[140px]"
                >
                  <option value="" disabled>Apply Preset...</option>
                  {TEXT_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Animation selector */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Animation</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    if (e.target.value === 'none') {
                      clearKeyframes(selectedClip.id)
                    } else if (e.target.value) {
                      applyTextAnimationToClip(selectedClip.id, e.target.value)
                    }
                    e.target.value = ''
                  }}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50 max-w-[140px]"
                >
                  <option value="" disabled>Apply Animation...</option>
                  <option value="none">None (Clear Keyframes)</option>
                  {TEXT_ANIMATIONS.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {/* Font family */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Font</span>
                <select
                  value={ts.fontFamily.split(',')[0].trim()}
                  onChange={e => updateText({ fontFamily: `${e.target.value}, sans-serif` })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50 max-w-[120px]"
                >
                  <option value="Inter">Inter</option>
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Courier New">Courier New</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Impact">Impact</option>
                  <option value="Comic Sans MS">Comic Sans MS</option>
                </select>
              </div>

              {/* Font size */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Size</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={12} max={200} value={ts.fontSize} onChange={e => updateText({ fontSize: parseInt(e.target.value) })} className="w-20 accent-cyan-500" />
                  <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{ts.fontSize}</span>
                </div>
              </div>

              {/* Font weight & style */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Weight</span>
                <select
                  value={ts.fontWeight}
                  onChange={e => updateText({ fontWeight: e.target.value as TextOverlayStyle['fontWeight'] })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="100">Thin</option>
                  <option value="300">Light</option>
                  <option value="normal">Normal</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="bold">Bold</option>
                  <option value="800">Extra Bold</option>
                  <option value="900">Black</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateText({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' })}
                  className={`px-2 py-1 rounded text-[10px] border ${ts.fontStyle === 'italic' ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
                >
                  <em>Italic</em>
                </button>
              </div>

              {/* Text color */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Color</span>
                <input type="color" value={ts.color} onChange={e => updateText({ color: e.target.value })} className="w-7 h-6 rounded cursor-pointer border border-zinc-700" />
              </div>

              {/* Background color */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Background</span>
                <div className="flex items-center gap-1.5">
                  <input type="color" value={ts.backgroundColor === 'transparent' ? '#000000' : ts.backgroundColor.slice(0, 7)} onChange={e => updateText({ backgroundColor: e.target.value + 'cc' })} className="w-7 h-6 rounded cursor-pointer border border-zinc-700" />
                  <button
                    onClick={() => updateText({ backgroundColor: ts.backgroundColor === 'transparent' ? 'rgba(0,0,0,0.7)' : 'transparent' })}
                    className={`px-1.5 py-0.5 rounded text-[9px] border ${ts.backgroundColor !== 'transparent' ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
                  >
                    {ts.backgroundColor !== 'transparent' ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              {/* Text alignment */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Align</span>
                <div className="flex gap-0.5">
                  {(['left', 'center', 'right'] as const).map(align => (
                    <button
                      key={align}
                      onClick={() => updateText({ textAlign: align })}
                      className={`p-1.5 rounded ${ts.textAlign === align ? 'bg-cyan-600/30 text-cyan-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {align === 'left' ? <AlignLeft className="h-3 w-3" /> : align === 'center' ? <AlignCenter className="h-3 w-3" /> : <AlignRight className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400">Position</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="text-[9px] text-zinc-500">X</span>
                    <input type="range" min={0} max={100} value={ts.positionX} onChange={e => updateText({ positionX: parseFloat(e.target.value) })} className="w-full accent-cyan-500" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[9px] text-zinc-500">Y</span>
                    <input type="range" min={0} max={100} value={ts.positionY} onChange={e => updateText({ positionY: parseFloat(e.target.value) })} className="w-full accent-cyan-500" />
                  </div>
                </div>
              </div>

              {/* Opacity */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Opacity</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={100} value={ts.opacity} onChange={e => updateText({ opacity: parseInt(e.target.value) })} className="w-20 accent-cyan-500" />
                  <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{ts.opacity}%</span>
                </div>
              </div>

              {/* Stroke */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Outline</span>
                <div className="flex items-center gap-1.5">
                  <input type="range" min={0} max={10} step={0.5} value={ts.strokeWidth} onChange={e => updateText({ strokeWidth: parseFloat(e.target.value) })} className="w-16 accent-cyan-500" />
                  <input type="color" value={ts.strokeColor === 'transparent' ? '#000000' : ts.strokeColor} onChange={e => updateText({ strokeColor: e.target.value, strokeWidth: Math.max(ts.strokeWidth, 1) })} className="w-5 h-5 rounded cursor-pointer border border-zinc-700" />
                </div>
              </div>

              {/* Shadow */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Shadow</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={20} value={ts.shadowBlur} onChange={e => updateText({ shadowBlur: parseInt(e.target.value) })} className="w-16 accent-cyan-500" />
                  <span className="text-[10px] text-zinc-300 w-4 text-right tabular-nums">{ts.shadowBlur}</span>
                </div>
              </div>

              {/* Presets */}
              <div className="pt-2 border-t border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-1.5">Apply Preset</span>
                <div className="grid grid-cols-2 gap-1">
                  {TEXT_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => updateText({ ...preset.style })}
                      className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-300 hover:border-cyan-500/40 hover:bg-cyan-900/20 transition-colors truncate"
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {tab === 'speed' && <div>
          <label className="block text-xs text-zinc-500 mb-1">Start Time</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={selectedClip.startTime.toFixed(2)}
              onChange={(e) => setClipStartTime(selectedClip.id, Math.max(0, parseFloat(e.target.value) || 0))}
              disabled={isOnMagneticTrack}
              title={isOnMagneticTrack
                ? 'Clips on the main track sit end to end, so their start time follows the clip before them.'
                : undefined}
              min={0}
              step={0.1}
              className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-sm"
            />
            <span className="text-xs text-zinc-500">sec</span>
          </div>
        </div>}

        {tab === 'speed' && hasPlaybackControls && (() => {
          const hasSpeedRamp = hasKeyframesForProperty(selectedClip, 'speed')
          const curTime = selectCurrentTime(getEditorState())
          const timeInClip = Math.max(0, Math.min(selectedClip.duration, curTime - selectedClip.startTime))
          const currentSpeed = hasSpeedRamp
            ? sampleClipAt(selectedClip, timeInClip).speed
            : (selectedClip.speed ?? 1)

          const applyRampPreset = (presetType: 'bullet-time' | 'montage-fast-slow' | 'jump-ramp') => {
            const dur = selectedClip.duration
            if (presetType === 'bullet-time') {
              // Normal -> Slow-mo (0.25x) in middle -> Normal
              setKeyframe(selectedClip.id, 'speed', 0, 1, 'linear')
              setKeyframe(selectedClip.id, 'speed', dur * 0.3, 1, 'ease-in-out')
              setKeyframe(selectedClip.id, 'speed', dur * 0.4, 0.25, 'ease-in-out')
              setKeyframe(selectedClip.id, 'speed', dur * 0.7, 0.25, 'ease-in-out')
              setKeyframe(selectedClip.id, 'speed', dur * 0.8, 1, 'ease-in-out')
              setKeyframe(selectedClip.id, 'speed', dur, 1, 'linear')
            } else if (presetType === 'montage-fast-slow') {
              // Fast (3x) -> Smooth slow down (0.5x)
              setKeyframe(selectedClip.id, 'speed', 0, 3, 'ease-out')
              setKeyframe(selectedClip.id, 'speed', dur * 0.4, 1, 'linear')
              setKeyframe(selectedClip.id, 'speed', dur, 0.5, 'ease-in-out')
            } else if (presetType === 'jump-ramp') {
              // Slow (0.5x) -> Fast burst (3x) -> Normal (1x)
              setKeyframe(selectedClip.id, 'speed', 0, 0.5, 'linear')
              setKeyframe(selectedClip.id, 'speed', dur * 0.4, 0.5, 'ease-in')
              setKeyframe(selectedClip.id, 'speed', dur * 0.5, 3, 'ease-out')
              setKeyframe(selectedClip.id, 'speed', dur * 0.8, 1, 'linear')
              setKeyframe(selectedClip.id, 'speed', dur, 1, 'linear')
            }
          }

          /** One path for both the slider, the typed field, and the duration field. */
          const applySpeed = (newSpeed: number, explicitDuration?: number) => {
            if (hasSpeedRamp && timeInClip >= 0 && timeInClip <= selectedClip.duration) {
              setKeyframe(selectedClip.id, 'speed', timeInClip, newSpeed)
              return
            }
            const oldSpeed = selectedClip.speed ?? 1
            let newDuration = explicitDuration !== undefined
              ? explicitDuration
              : selectedClip.duration * (oldSpeed / newSpeed)
            const maxDur = getMaxClipDuration({ ...selectedClip, speed: newSpeed })
            newDuration = Math.min(newDuration, maxDur)
            newDuration = Math.max(0.1, newDuration)
            setClipSpeed(selectedClip.id, newSpeed, newDuration)
          }

          const applyDurationInSpeedTab = (targetDuration: number) => {
            const currentDuration = selectedClip.duration
            const curSpeed = selectedClip.speed ?? 1
            const mediaSeconds = currentDuration * curSpeed
            const calculatedSpeed = clampClipSpeed(Math.round((mediaSeconds / targetDuration) * 100) / 100)
            applySpeed(calculatedSpeed, targetDuration)
          }

          return (
            <div className="space-y-4 pt-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-zinc-500 font-medium">Speed</label>
                    <KeyframeDiamondButton
                      clip={selectedClip}
                      property="speed"
                      currentValue={currentSpeed}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSpeedRamp && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
                        RAMP
                      </span>
                    )}
                    <button
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                      onClick={() => {
                        if (hasSpeedRamp) {
                          clearKeyframes(selectedClip.id, 'speed')
                        }
                        const restored = Math.max(
                          0.5,
                          Math.min(
                            selectedClip.duration * (selectedClip.speed ?? 1),
                            getMaxClipDuration({ ...selectedClip, speed: 1 }),
                          ),
                        )
                        setClipSpeed(selectedClip.id, 1, restored)
                      }}
                      title="Reset to 1.0x"
                    >
                      Reset (1.0x)
                    </button>
                  </div>
                </div>
                <SpeedSlider
                  speed={currentSpeed}
                  onChange={(newSpeed) => applySpeed(newSpeed)}
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1">Duration</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={selectedClip.duration.toFixed(2)}
                    onChange={(e) => {
                      const dur = Math.max(0.1, parseFloat(e.target.value) || 1)
                      applyDurationInSpeedTab(dur)
                    }}
                    min={0.1}
                    step={0.1}
                    className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-sm"
                  />
                  <span className="text-xs text-zinc-500">sec</span>
                  {selectedClip.type === 'video' && selectedClip.asset?.duration && (
                    <span className="text-[10px] text-zinc-600">max {getMaxClipDuration(selectedClip).toFixed(1)}s</span>
                  )}
                </div>
              </div>

              {/* Speed Ramp Presets & Actions */}
              <div className="pt-2 border-t border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-400">Speed Ramp Presets</span>
                  {hasSpeedRamp && (
                    <button
                      onClick={() => clearKeyframes(selectedClip.id, 'speed')}
                      className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      Clear Ramp
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => applyRampPreset('bullet-time')}
                    className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 hover:border-blue-500/50 hover:bg-zinc-750 text-[10px] text-zinc-300 transition-colors text-center"
                    title="Normal -> Slow motion (0.25x) -> Normal"
                  >
                    Bullet Time
                  </button>
                  <button
                    onClick={() => applyRampPreset('montage-fast-slow')}
                    className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 hover:border-blue-500/50 hover:bg-zinc-750 text-[10px] text-zinc-300 transition-colors text-center"
                    title="Fast burst (3x) -> Slow down (0.5x)"
                  >
                    Fast-to-Slow
                  </button>
                  <button
                    onClick={() => applyRampPreset('jump-ramp')}
                    className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 hover:border-blue-500/50 hover:bg-zinc-750 text-[10px] text-zinc-300 transition-colors text-center"
                    title="Slow motion -> Quick burst -> Normal"
                  >
                    Jump Ramp
                  </button>
                </div>
              </div>

              {/* Audio Behavior Notification */}
              {hasSpeedRamp && (
                <div className="rounded-md bg-amber-950/30 border border-amber-800/40 p-2 text-[10px] text-amber-300/90 space-y-0.5">
                  <span className="font-semibold block">⚠️ Audio muted during Speed Ramp</span>
                  <p className="text-zinc-400 leading-relaxed">
                    {t('clipProperties.speedRampAudioMuted')}
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {tab === 'audio' && hasAudioControls && (() => {
          const hasKf = hasKeyframesForProperty(selectedClip, 'volume')
          const currentVolume = hasKf && sampledClip ? sampledClip.volume : effectiveVolume
          const displayVolume = effectiveMuted ? 0 : currentVolume
          const decibels = displayVolume > 0 ? 20 * Math.log10(displayVolume) : null
          const isBoosted = displayVolume > 1
          return (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-zinc-500">Volume</label>
                  <KeyframeDiamondButton
                    clip={selectedClip}
                    property="volume"
                    currentValue={displayVolume}
                  />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xs tabular-nums ${isBoosted ? 'text-amber-400' : 'text-white'}`}>
                    {Math.round(displayVolume * 100)}%
                  </span>
                  <span className="text-[10px] text-zinc-600 tabular-nums">
                    {decibels === null ? '-∞ dB' : `${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`}
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={MAX_CLIP_VOLUME}
                step={0.05}
                value={displayVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (hasKf) {
                    setKeyframe(selectedClip.id, 'volume', timeInClip, val)
                  }
                  setClipAudioLevel(selectedClip.id, val)
                }}
                className={`w-full ${isBoosted ? 'accent-amber-500' : 'accent-blue-500'}`}
              />
              {/* Unity marker, so 100% is findable by eye on a 0..400% track. */}
              <div className="relative h-2 mt-0.5">
                <div
                  className="absolute top-0 w-px h-1.5 bg-zinc-600"
                  style={{ left: `${(1 / MAX_CLIP_VOLUME) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>0%</span>
                <button
                  className="hover:text-blue-400 transition-colors"
                  onClick={() => setClipAudioLevel(selectedClip.id, 1)}
                  title="Reset to 100%"
                >
                  100%
                </button>
                <span>{MAX_CLIP_VOLUME * 100}%</span>
              </div>
              {isBoosted && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                  {isPreviewBoostAvailable()
                    ? 'Boosted clips are kept clean on export by a look-ahead limiter, so peaks are ridden down instead of clipping.'
                    : 'Preview is capped at 100% on this system, but the exported file is boosted and kept clean by a look-ahead limiter.'}
                </p>
              )}
            </div>
          )
        })()}

        {tab === 'audio' && hasAudioControls && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedClip.reversed}
                onChange={(e) => updateClip(selectedClip.id, { reversed: e.target.checked })}
                className="rounded bg-zinc-800 border-zinc-600"
              />
              <span className="text-sm text-zinc-300">Reverse playback</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={effectiveMuted}
                onChange={(e) => setClipAudioMuted(selectedClip.id, e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-600"
              />
              <span className="text-sm text-zinc-300">Mute audio</span>
            </label>
          </div>
        )}

        {tab === 'audio' && hasAudioControls && (() => {
          const { fadeIn, fadeOut } = getAudioFadeDurations(selectedClip)
          return (
            <div className="pt-3 border-t border-zinc-800 space-y-2">
              <label className="text-xs font-semibold text-zinc-400 block">Audio Fade</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Fade In</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={fadeIn > 0 ? Number(fadeIn.toFixed(2)) : 0}
                      onChange={(e) => {
                        const val = Math.max(0, parseFloat(e.target.value) || 0)
                        setAudioFade(selectedClip.id, val, undefined)
                      }}
                      min={0}
                      max={Math.max(0, Number((selectedClip.duration - fadeOut).toFixed(2)))}
                      step={0.1}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-xs text-zinc-500">s</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Fade Out</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={fadeOut > 0 ? Number(fadeOut.toFixed(2)) : 0}
                      onChange={(e) => {
                        const val = Math.max(0, parseFloat(e.target.value) || 0)
                        setAudioFade(selectedClip.id, undefined, val)
                      }}
                      min={0}
                      max={Math.max(0, Number((selectedClip.duration - fadeIn).toFixed(2)))}
                      step={0.1}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-xs text-zinc-500">s</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {tab === 'audio' && hasAudioControls && (() => {
          const liveAsset = getLiveAsset(selectedClip)
          const filePath = liveAsset?.path || selectedClip.asset?.path

          const handleNormalize = async () => {
            if (!filePath || !window.electronAPI?.measureLoudness) return
            setIsMeasuringLoudness(true)
            setLoudnessMessage(null)
            try {
              const res = await window.electronAPI.measureLoudness({
                filePath,
                startTime: selectedClip.trimStart,
                duration: selectedClip.duration * selectedClip.speed,
              })
              if (res && typeof res.integratedLufs === 'number' && isFinite(res.integratedLufs)) {
                const deltaDb = targetLufs - res.integratedLufs
                normalizeClipAudio(selectedClip.id, targetLufs, res.integratedLufs)
                const sign = deltaDb > 0 ? '+' : ''
                setLoudnessMessage(`${sign}${deltaDb.toFixed(1)} dB (${res.integratedLufs.toFixed(1)} LUFS)`)
              } else {
                setLoudnessMessage(t('clipProperties.cannotMeasure'))
              }
            } catch (err: any) {
              setLoudnessMessage(`${t('clipProperties.measurementError')} ${err?.message || t('clipProperties.failed')}`)
            } finally {
              setIsMeasuringLoudness(false)
            }
          }

          return (
            <div className="pt-3 border-t border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-400">{t('clipProperties.lufsTitle')}</label>
                <span className="text-[10px] text-zinc-500">{t('clipProperties.targetLevel')} {targetLufs} LUFS</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    value={targetLufs}
                    onChange={(e) => setTargetLufs(parseFloat(e.target.value) || -14)}
                    min={-36}
                    max={-6}
                    step={1}
                    className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-zinc-500">LUFS</span>
                </div>

                <button
                  onClick={handleNormalize}
                  disabled={isMeasuringLoudness || !filePath}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    isMeasuringLoudness
                      ? 'bg-zinc-700 text-zinc-400 cursor-wait'
                      : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {isMeasuringLoudness ? t('clipProperties.measuring') : t('clipProperties.normalize')}
                </button>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: 'YouTube/Web', value: -14 },
                  { label: 'Podcast', value: -16 },
                  { label: 'Broadcast', value: -23 },
                ].map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => setTargetLufs(preset.value)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                      targetLufs === preset.value
                        ? 'bg-blue-900/50 text-blue-300 border border-blue-600/40'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700'
                    }`}
                  >
                    {preset.value} ({preset.label})
                  </button>
                ))}
              </div>

              {loudnessMessage && (
                <p className="text-[11px] text-emerald-400 leading-tight pt-1">
                  {loudnessMessage}
                </p>
              )}

              {/* --- Audio Ducking --- */}
              <div className="pt-3 border-t border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-400">{t('clipProperties.duckingTitle')}</label>
                  <span className="text-[10px] text-zinc-500">{duckingDb} dB</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-zinc-500 block mb-1">{t('clipProperties.voiceSource')}</span>
                    <select
                      value={duckingSourceTrack}
                      onChange={(e) => setDuckingSourceTrack(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="other">{t('clipProperties.allOtherTracks')}</option>
                      {tracks.map((tr, idx) => (
                        <option key={tr.id || idx} value={String(idx)}>
                          {tr.name || `Track ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block mb-1">{t('clipProperties.duckingAmount')}</span>
                    <input
                      type="number"
                      value={duckingDb}
                      onChange={(e) => setDuckingDb(parseFloat(e.target.value) || -12)}
                      min={-36}
                      max={-1}
                      step={1}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block mb-1">{t('clipProperties.attackSec')}</span>
                    <input
                      type="number"
                      value={duckingAttack}
                      onChange={(e) => setDuckingAttack(parseFloat(e.target.value) || 0.3)}
                      min={0.05}
                      max={5}
                      step={0.05}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block mb-1">{t('clipProperties.releaseSec')}</span>
                    <input
                      type="number"
                      value={duckingRelease}
                      onChange={(e) => setDuckingRelease(parseFloat(e.target.value) || 0.5)}
                      min={0.05}
                      max={5}
                      step={0.05}
                      className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    onClick={async () => {
                      setIsDuckingProcessing(true)
                      setDuckingMessage(null)
                      try {
                        const candidateClips = clips.filter(c => {
                          if (c.id === selectedClip.id) return false
                          if (c.type !== 'audio' && c.type !== 'video') return false
                          if (duckingSourceTrack !== 'other') {
                            return String(c.trackIndex) === duckingSourceTrack
                          }
                          return c.trackIndex !== selectedClip.trackIndex
                        })

                        if (candidateClips.length === 0) {
                          setDuckingMessage(t('clipProperties.noVoiceClipsFound'))
                          return
                        }

                        const allSpeechIntervalsOnTimeline: { start: number; end: number }[] = []

                        for (const voiceClip of candidateClips) {
                          const live = getLiveAsset(voiceClip)
                          const filePath = live?.path || voiceClip.asset?.path
                          let localSpeech: { start: number; end: number }[] = []

                          if (filePath && window.electronAPI?.detectSilence) {
                            try {
                              const silences = await window.electronAPI.detectSilence({
                                filePath,
                                startTime: voiceClip.trimStart,
                                duration: voiceClip.duration * voiceClip.speed,
                                noiseDb: -32,
                                minDurationSec: 0.4,
                              })
                              localSpeech = computeSpeechIntervalsFromSilence(
                                silences,
                                (live?.duration || voiceClip.duration * voiceClip.speed)
                              )
                            } catch {
                              localSpeech = [{ start: voiceClip.trimStart, end: voiceClip.trimStart + voiceClip.duration * voiceClip.speed }]
                            }
                          } else {
                            localSpeech = [{ start: voiceClip.trimStart, end: voiceClip.trimStart + voiceClip.duration * voiceClip.speed }]
                          }

                          const timelineSpeech = voiceClipSpeechToTimeline(voiceClip, localSpeech)
                          allSpeechIntervalsOnTimeline.push(...timelineSpeech)
                        }

                        if (allSpeechIntervalsOnTimeline.length === 0) {
                          setDuckingMessage(t('clipProperties.noSpeechDetected'))
                          return
                        }

                        duckClipAudio(selectedClip.id, allSpeechIntervalsOnTimeline, {
                          duckingDb,
                          attack: duckingAttack,
                          release: duckingRelease,
                        })

                        setDuckingMessage(`Ducked music (${duckingDb} dB) against ${allSpeechIntervalsOnTimeline.length} speech segments`)
                      } catch (err: any) {
                        setDuckingMessage(`${t('clipProperties.cannotApplyDucking')}: ${err?.message || ''}`)
                      } finally {
                        setIsDuckingProcessing(false)
                      }
                    }}
                    disabled={isDuckingProcessing}
                    className={`w-full py-1.5 px-3 rounded text-xs font-medium transition-colors ${
                      isDuckingProcessing
                        ? 'bg-zinc-700 text-zinc-400 cursor-wait'
                        : 'bg-indigo-600 text-white hover:bg-indigo-500'
                    }`}
                  >
                    {isDuckingProcessing ? t('clipProperties.analyzingSpeech') : t('clipProperties.autoDuckBtn')}
                  </button>
                </div>

                {duckingMessage && (
                  <p className="text-[11px] text-indigo-300 leading-tight pt-0.5">
                    {duckingMessage}
                  </p>
                )}
              </div>
            </div>
          )
        })()}

        {/* --- Video Tab --- */}
        {tab === 'video' && (
          <div className="space-y-4">
            {/* Level 2 Sub-Tabs (Pill Navigation) */}
            <div className="flex items-center bg-[#141416] p-1 rounded-lg border border-zinc-800/80 gap-1 select-none">
              {(['basic', 'remove-bg', 'mask', 'retouch'] as const).map((sub) => {
                const labels: Record<typeof sub, string> = {
                  'basic': 'Basic',
                  'remove-bg': 'Remove BG',
                  'mask': 'Mask',
                  'retouch': 'Retouch',
                }
                const isActive = videoSubTab === sub
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setVideoSubTab(sub)}
                    className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all text-center ${
                      isActive
                        ? 'bg-[#252529] text-white shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                    }`}
                  >
                    {labels[sub]}
                  </button>
                )
              })}
            </div>

            {/* ── Sub-tab 1: Basic ── */}
            {videoSubTab === 'basic' && (
              <div className="space-y-4">
                {/* Transform */}
                {hasVisualTransformControls && (() => {
                  const tf = selectedClip.transform ?? DEFAULT_CLIP_TRANSFORM
                  const setTransform = (patch: Partial<typeof tf>) =>
                    updateClip(selectedClip.id, { transform: { ...tf, ...patch } })
                  const isDefault = (Object.keys(DEFAULT_CLIP_TRANSFORM) as Array<keyof typeof tf>)
                    .every(key => tf[key] === DEFAULT_CLIP_TRANSFORM[key])

                  const hasScaleKf = hasKeyframesForProperty(selectedClip, 'transform.scale')
                  const currentScale = hasScaleKf && sampledClip ? (sampledClip.scale ?? tf.scale) : tf.scale

                  const hasPosXKf = hasKeyframesForProperty(selectedClip, 'transform.positionX')
                  const currentPosX = hasPosXKf && sampledClip ? (sampledClip.positionX ?? tf.positionX) : tf.positionX

                  const hasPosYKf = hasKeyframesForProperty(selectedClip, 'transform.positionY')
                  const currentPosY = hasPosYKf && sampledClip ? (sampledClip.positionY ?? tf.positionY) : tf.positionY

                  const hasRotKf = hasKeyframesForProperty(selectedClip, 'transform.rotation')
                  const currentRot = hasRotKf && sampledClip ? (sampledClip.rotation ?? tf.rotation) : tf.rotation

                  return (
                    <div className="space-y-2">
                      {/* Section Header */}
                      <div className="flex items-center justify-between h-6">
                        <span className="text-xs font-semibold text-zinc-200">Transform</span>
                        <div className="flex items-center gap-1.5">
                          {!isDefault && (
                            <button
                              type="button"
                              onClick={() => updateClip(selectedClip.id, { transform: { ...DEFAULT_CLIP_TRANSFORM } })}
                              className="text-zinc-400 hover:text-cyan-400 transition-colors p-0.5"
                              title="Reset Transform"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          <KeyframeDiamondButton
                            clip={selectedClip}
                            property="transform.scale"
                            currentValue={currentScale}
                          />
                        </div>
                      </div>

                      {/* 1. Scale Row */}
                      <div className="flex items-center justify-between gap-2 h-7">
                        <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Scale</span>
                        <input
                          type="range"
                          min={1}
                          max={400}
                          step={1}
                          value={currentScale}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value)
                            if (hasScaleKf) {
                              setKeyframe(selectedClip.id, 'transform.scale', timeInClip, val)
                            }
                            setTransform({ scale: val })
                          }}
                          className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
                        />
                        <PropertyNumberInput
                          value={currentScale}
                          min={1}
                          max={400}
                          step={1}
                          suffix="%"
                          className="w-16 flex-shrink-0"
                          onChange={(val) => {
                            if (hasScaleKf) {
                              setKeyframe(selectedClip.id, 'transform.scale', timeInClip, val)
                            }
                            setTransform({ scale: val })
                          }}
                        />
                        <KeyframeDiamondButton
                          clip={selectedClip}
                          property="transform.scale"
                          currentValue={currentScale}
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* 2. Uniform scale Row */}
                      <div className="flex items-center justify-between h-6">
                        <span className="text-xs text-zinc-300">Uniform scale</span>
                        <PropertyToggle
                          checked={uniformScale}
                          onChange={setUniformScale}
                        />
                      </div>

                      {/* 3. Position Row */}
                      <div className="flex items-center justify-between gap-2 h-7">
                        <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Position</span>
                        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                          <PropertyNumberInput
                            prefix="X"
                            value={Math.round(currentPosX)}
                            min={-1920}
                            max={1920}
                            step={1}
                            className="flex-1 max-w-[76px]"
                            onChange={(val) => {
                              if (hasPosXKf) {
                                setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, val)
                              }
                              setTransform({ positionX: val })
                            }}
                          />
                          <PropertyNumberInput
                            prefix="Y"
                            value={Math.round(currentPosY)}
                            min={-1080}
                            max={1080}
                            step={1}
                            className="flex-1 max-w-[76px]"
                            onChange={(val) => {
                              if (hasPosYKf) {
                                setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, val)
                              }
                              setTransform({ positionY: val })
                            }}
                          />
                        </div>
                        <KeyframeDiamondButton
                          clip={selectedClip}
                          property="transform.positionX"
                          currentValue={currentPosX}
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* 4. Rotate Row */}
                      <div className="flex items-center justify-between gap-2 h-7">
                        <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Rotate</span>
                        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                          <PropertyNumberInput
                            value={currentRot}
                            min={-360}
                            max={360}
                            step={1}
                            precision={2}
                            suffix="°"
                            className="w-20"
                            onChange={(val) => {
                              if (hasRotKf) setKeyframe(selectedClip.id, 'transform.rotation', timeInClip, val)
                              setTransform({ rotation: val })
                            }}
                          />
                          <PropertyRotateDial
                            rotation={currentRot}
                            onReset={() => {
                              if (hasRotKf) setKeyframe(selectedClip.id, 'transform.rotation', timeInClip, 0)
                              setTransform({ rotation: 0 })
                            }}
                          />
                        </div>
                        <KeyframeDiamondButton
                          clip={selectedClip}
                          property="transform.rotation"
                          currentValue={currentRot}
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* Alignment Toolbar */}
                      <div className="pt-1">
                        <PropertyAlignmentBar
                          onAlignLeft={() => {
                            const newX = -(50 - 50 * (tf.scale / 100))
                            if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, newX)
                            setTransform({ positionX: newX })
                          }}
                          onAlignCenterH={() => {
                            if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, 0)
                            setTransform({ positionX: 0 })
                          }}
                          onAlignRight={() => {
                            const newX = (50 - 50 * (tf.scale / 100))
                            if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, newX)
                            setTransform({ positionX: newX })
                          }}
                          onAlignTop={() => {
                            const newY = -(50 - 50 * (tf.scale / 100))
                            if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, newY)
                            setTransform({ positionY: newY })
                          }}
                          onAlignCenterV={() => {
                            if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, 0)
                            setTransform({ positionY: 0 })
                          }}
                          onAlignBottom={() => {
                            const newY = (50 - 50 * (tf.scale / 100))
                            if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, newY)
                            setTransform({ positionY: newY })
                          }}
                        />
                      </div>

                      {/* Flip & Crop */}
                      <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-400">Flip</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateClip(selectedClip.id, { flipH: !selectedClip.flipH })}
                              className={`p-1.5 rounded text-xs border transition-colors ${
                                selectedClip.flipH
                                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700/60 hover:text-white'
                              }`}
                              title="Flip Horizontal"
                            >
                              <FlipHorizontal2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => updateClip(selectedClip.id, { flipV: !selectedClip.flipV })}
                              className={`p-1.5 rounded text-xs border transition-colors ${
                                selectedClip.flipV
                                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700/60 hover:text-white'
                              }`}
                              title="Flip Vertical"
                            >
                              <FlipVertical2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Crop Collapsible */}
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowTransform(!showTransform)}
                            className="flex items-center justify-between w-full py-1 text-xs text-zinc-400 hover:text-zinc-200"
                          >
                            <span>Crop Edges</span>
                            {showTransform ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          {showTransform && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <PropertyNumberInput
                                prefix="Top"
                                value={tf.cropTop || 0}
                                min={0}
                                max={90}
                                suffix="%"
                                onChange={(v) => setTransform({ cropTop: v })}
                              />
                              <PropertyNumberInput
                                prefix="Bottom"
                                value={tf.cropBottom || 0}
                                min={0}
                                max={90}
                                suffix="%"
                                onChange={(v) => setTransform({ cropBottom: v })}
                              />
                              <PropertyNumberInput
                                prefix="Left"
                                value={tf.cropLeft || 0}
                                min={0}
                                max={90}
                                suffix="%"
                                onChange={(v) => setTransform({ cropLeft: v })}
                              />
                              <PropertyNumberInput
                                prefix="Right"
                                value={tf.cropRight || 0}
                                min={0}
                                max={90}
                                suffix="%"
                                onChange={(v) => setTransform({ cropRight: v })}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Blend */}
                {(() => {
                  const hasKf = hasKeyframesForProperty(selectedClip, 'opacity')
                  const currentOpacity = hasKf && sampledClip ? sampledClip.opacity : (selectedClip.opacity ?? 100)

                  return (
                    <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                      <div className="flex items-center justify-between h-6">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="blend-toggle"
                            checked={showBlend}
                            onChange={(e) => setShowBlend(e.target.checked)}
                            className="rounded bg-zinc-800 border-zinc-700 accent-cyan-400"
                          />
                          <label htmlFor="blend-toggle" className="text-xs font-semibold text-zinc-300 cursor-pointer flex items-center gap-1">
                            Blend
                            <ChevronDown className="w-3 h-3 text-zinc-400" />
                          </label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {selectedClip.blendMode && selectedClip.blendMode !== 'normal' && (
                            <button
                              type="button"
                              onClick={() => setClipBlendMode(selectedClip.id, 'normal')}
                              className="text-zinc-400 hover:text-cyan-400 transition-colors p-0.5"
                              title="Reset Blend Mode"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          <KeyframeDiamondButton
                            clip={selectedClip}
                            property="opacity"
                            currentValue={currentOpacity}
                          />
                        </div>
                      </div>

                      {showBlend && (
                        <div className="space-y-1.5 pl-0.5">
                          {/* Opacity Row */}
                          <div className="flex items-center justify-between gap-2 h-7">
                            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Opacity</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={currentOpacity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10)
                                if (hasKf) {
                                  setKeyframe(selectedClip.id, 'opacity', timeInClip, val)
                                }
                                updateClip(selectedClip.id, { opacity: val })
                              }}
                              className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
                            />
                            <PropertyNumberInput
                              value={Math.round(currentOpacity)}
                              min={0}
                              max={100}
                              step={1}
                              suffix="%"
                              className="w-16 flex-shrink-0"
                              onChange={(val) => {
                                if (hasKf) {
                                  setKeyframe(selectedClip.id, 'opacity', timeInClip, val)
                                }
                                updateClip(selectedClip.id, { opacity: val })
                              }}
                            />
                            <KeyframeDiamondButton
                              clip={selectedClip}
                              property="opacity"
                              currentValue={currentOpacity}
                              className="flex-shrink-0"
                            />
                          </div>

                          {/* Mode Row */}
                          <div className="flex items-center justify-between gap-2 h-7">
                            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Mode</span>
                            <select
                              value={selectedClip.blendMode ?? 'normal'}
                              onChange={(e) => setClipBlendMode(selectedClip.id, e.target.value as ClipBlendMode)}
                              className="flex-1 bg-[#19191c] hover:bg-[#232327] border border-zinc-800 hover:border-zinc-700 rounded h-6 px-2 text-[11px] text-zinc-200 focus:outline-none focus:border-cyan-400 transition-colors"
                            >
                              {BLEND_MODES.map((mode) => (
                                <option key={mode.id} value={mode.id}>
                                  {t(`clipProperties.blendModes.${mode.id}`) || mode.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Feature Accordion Cards */}
                <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                  {[
                    { id: 'stabilize', title: 'Stabilize', pro: true, desc: 'Reduce shaky camera movements' },
                    { id: 'enhance', title: 'Enhance quality', pro: true, desc: 'AI upscaling and detail sharpness' },
                    { id: 'denoise', title: 'Reduce image noise', pro: true, desc: 'Clear grain in low-light clips' },
                    { id: 'optical-flow', title: 'Optical flow', pro: true, desc: 'Smooth motion interpolation' },
                    { id: 'ai-remove', title: 'AI remove', pro: true, desc: 'Intelligently remove unwanted objects' },
                  ].map(feature => (
                    <div key={feature.id} className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-300">{feature.title}</span>
                          {feature.pro && (
                            <span className="text-[10px] text-cyan-400 font-bold px-1 py-0.2 bg-cyan-950/60 border border-cyan-800/50 rounded">
                              PRO
                            </span>
                          )}
                        </div>
                        <PropertyToggle
                          checked={false}
                          onChange={() => {}}
                        />
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1">{feature.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Sub-tab 2: Remove BG ── */}
            {videoSubTab === 'remove-bg' && (() => {
              const chroma = selectedClip.chromaKey ?? DEFAULT_CHROMA_KEY
              const isEnabled = Boolean(selectedClip.chromaKey?.enabled)

              const handleNativeEyedropper = async () => {
                if (typeof window !== 'undefined' && 'EyeDropper' in window) {
                  try {
                    const eyeDropper = new (window as any).EyeDropper()
                    const result = await eyeDropper.open()
                    if (result?.sRGBHex) {
                      setClipChromaKey(selectedClip.id, { color: result.sRGBHex.toUpperCase(), enabled: true })
                      return
                    }
                  } catch {
                    return
                  }
                }
                toggleEyedropperMode()
              }

              return (
                <div className="space-y-4">
                  {/* Chroma Key Card */}
                  <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pipette className="h-4 w-4 text-cyan-400" />
                        <span className="text-xs font-semibold text-zinc-200">Chroma key</span>
                      </div>
                      <PropertyToggle
                        checked={isEnabled}
                        onChange={(checked) => {
                          setClipChromaKey(selectedClip.id, { enabled: checked })
                        }}
                      />
                    </div>

                    {isEnabled && (
                      <div className="space-y-3 pt-2 border-t border-zinc-800/60">
                        {/* Eyedropper & Color Picker */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={chroma.color.startsWith('#') ? chroma.color : `#${chroma.color}`}
                              onChange={(e) => setClipChromaKey(selectedClip.id, { color: e.target.value.toUpperCase(), enabled: true })}
                              className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
                            />
                            <input
                              type="text"
                              value={chroma.color}
                              onChange={(e) => {
                                const val = e.target.value
                                if (/^#?[0-9a-fA-F]{0,6}$/.test(val)) {
                                  setClipChromaKey(selectedClip.id, { color: val.toUpperCase(), enabled: true })
                                }
                              }}
                              placeholder="#00FF00"
                              className="w-20 px-2 py-1 text-[11px] font-mono rounded bg-zinc-800 text-zinc-200 border border-zinc-700 focus:outline-none focus:border-cyan-400"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={handleNativeEyedropper}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                              eyedropperMode
                                ? 'bg-cyan-500 text-black shadow-sm'
                                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                            }`}
                          >
                            <Pipette className="h-3 w-3" />
                            {eyedropperMode ? t('clipProperties.samplingColor') : 'Pick Color'}
                          </button>
                        </div>

                        {/* Quick Presets */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-zinc-500 mr-1">Presets</span>
                          {[
                            { name: 'Green', hex: '#00FF00' },
                            { name: 'Blue', hex: '#0000FF' },
                            { name: 'Magenta', hex: '#FF00FF' },
                            { name: 'Black', hex: '#000000' },
                            { name: 'White', hex: '#FFFFFF' },
                          ].map((p) => (
                            <button
                              key={p.hex}
                              type="button"
                              onClick={() => setClipChromaKey(selectedClip.id, { color: p.hex, enabled: true })}
                              className="w-5 h-5 rounded border border-zinc-700/80 hover:scale-110 transition-transform"
                              style={{ backgroundColor: p.hex }}
                              title={p.name}
                            />
                          ))}
                        </div>

                        {/* Similarity / Strength */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span>Strength</span>
                            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(chroma.similarity)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={chroma.similarity}
                            onChange={(e) => setClipChromaKey(selectedClip.id, { similarity: parseFloat(e.target.value), enabled: true })}
                            className="w-full h-1.5 accent-cyan-400"
                          />
                        </div>

                        {/* Shadow / Smoothness */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span>Shadow</span>
                            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(chroma.smoothness)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={chroma.smoothness}
                            onChange={(e) => setClipChromaKey(selectedClip.id, { smoothness: parseFloat(e.target.value), enabled: true })}
                            className="w-full h-1.5 accent-cyan-400"
                          />
                        </div>

                        {/* Spill */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span>Spill</span>
                            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(chroma.spill)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={chroma.spill}
                            onChange={(e) => setClipChromaKey(selectedClip.id, { spill: parseFloat(e.target.value), enabled: true })}
                            className="w-full h-1.5 accent-cyan-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Auto Cutout Card */}
                  <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crop className="h-4 w-4 text-cyan-400" />
                        <span className="text-xs font-semibold text-zinc-200">Auto Cutout</span>
                        <span className="text-[10px] text-cyan-400 font-bold px-1 py-0.2 bg-cyan-950/60 border border-cyan-800/50 rounded">
                          AI
                        </span>
                      </div>
                      <PropertyToggle
                        checked={false}
                        onChange={() => {}}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Separate portrait / subject automatically without green screen.
                    </p>
                  </div>
                </div>
              )
            })()}

            {/* ── Sub-tab 3: Mask ── */}
            {videoSubTab === 'mask' && (() => {
              const mask = selectedClip.mask ?? DEFAULT_CLIP_MASK
              const hasCustomMask = !!selectedClip.mask && selectedClip.mask.enabled

              return (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">Mask Shape</span>
                    <PropertyToggle
                      checked={hasCustomMask}
                      onChange={(checked) => {
                        setClipMask(selectedClip.id, checked ? { ...(selectedClip.mask || DEFAULT_CLIP_MASK), enabled: true } : { ...(selectedClip.mask || DEFAULT_CLIP_MASK), enabled: false })
                        setMaskMode(checked)
                      }}
                    />
                  </div>

                  {/* Canvas Edit button */}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                        maskMode
                          ? 'bg-cyan-500 text-black shadow-sm'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                      onClick={() => toggleMaskMode()}
                    >
                      {maskMode ? 'Active on Canvas' : 'Edit on Canvas'}
                    </button>
                    {selectedClip.mask && (
                      <button
                        type="button"
                        className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                        onClick={() => {
                          setClipMask(selectedClip.id, null)
                          setMaskMode(false)
                        }}
                      >
                        Reset Mask
                      </button>
                    )}
                  </div>

                  {/* Shape Selector Buttons */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['rectangle', 'ellipse', 'linear'] as ClipMaskShape[]).map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => setClipMask(selectedClip.id, { shape, enabled: true })}
                        className={`py-2 px-2 text-xs rounded-md capitalize transition-colors text-center ${
                          mask.shape === shape && selectedClip.mask?.enabled
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-medium'
                            : 'bg-[#1c1c1f] text-zinc-400 hover:bg-[#252529] border border-zinc-800'
                        }`}
                      >
                        {shape}
                      </button>
                    ))}
                  </div>

                  {/* Dimensions & Controls */}
                  <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
                    {/* Position X / Y */}
                    <div className="space-y-1">
                      <span className="text-xs text-zinc-400">Position</span>
                      <div className="grid grid-cols-2 gap-2">
                        <PropertyNumberInput
                          prefix="X"
                          value={Math.round(mask.x)}
                          min={0}
                          max={100}
                          suffix="%"
                          onChange={(v) => setClipMask(selectedClip.id, { x: v, enabled: true })}
                        />
                        <PropertyNumberInput
                          prefix="Y"
                          value={Math.round(mask.y)}
                          min={0}
                          max={100}
                          suffix="%"
                          onChange={(v) => setClipMask(selectedClip.id, { y: v, enabled: true })}
                        />
                      </div>
                    </div>

                    {/* Size (Width / Height) */}
                    {mask.shape !== 'linear' && (
                      <div className="space-y-1">
                        <span className="text-xs text-zinc-400">Size</span>
                        <div className="grid grid-cols-2 gap-2">
                          <PropertyNumberInput
                            prefix="W"
                            value={Math.round(mask.width)}
                            min={1}
                            max={200}
                            suffix="%"
                            onChange={(v) => setClipMask(selectedClip.id, { width: v, enabled: true })}
                          />
                          <PropertyNumberInput
                            prefix="H"
                            value={Math.round(mask.height)}
                            min={1}
                            max={200}
                            suffix="%"
                            onChange={(v) => setClipMask(selectedClip.id, { height: v, enabled: true })}
                          />
                        </div>
                      </div>
                    )}

                    {/* Rotation */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>Rotation</span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(mask.rotation ?? 0)}°</span>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={mask.rotation ?? 0}
                        onChange={(e) => setClipMask(selectedClip.id, { rotation: parseFloat(e.target.value), enabled: true })}
                        className="w-full h-1.5 accent-cyan-400"
                      />
                    </div>

                    {/* Feather */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>Feather</span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(mask.feather ?? 0)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={mask.feather ?? 0}
                        onChange={(e) => setClipMask(selectedClip.id, { feather: parseFloat(e.target.value), enabled: true })}
                        className="w-full h-1.5 accent-cyan-400"
                      />
                    </div>

                    {/* Invert */}
                    <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mask.invert ?? false}
                          onChange={(e) => setClipMask(selectedClip.id, { invert: e.target.checked, enabled: true })}
                          className="rounded bg-zinc-800 border-zinc-600 accent-cyan-400"
                        />
                        <span className="text-xs text-zinc-300">Invert Mask</span>
                      </label>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* ── Sub-tab 4: Retouch ── */}
            {videoSubTab === 'retouch' && (
              <div className="space-y-4">
                {/* 3D LUT Filter */}
                <div className="rounded-lg bg-[#19191c] border border-zinc-800/80 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-cyan-400" />
                      <span className="text-xs font-semibold text-zinc-200">{t('filters.tabTitle')}</span>
                    </div>
                    {selectedClip.filter && (
                      <button
                        type="button"
                        onClick={() => removeClipFilter(selectedClip.id)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                        title={t('filters.removeFilter')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {selectedClip.filter ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-200">
                          {getFilterDefinition(selectedClip.filter.id)?.name || selectedClip.filter.id}
                        </span>
                        <span className="text-xs text-zinc-400 tabular-nums">
                          {selectedClip.filter.intensity ?? 100}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={selectedClip.filter.intensity ?? 100}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            const curTime = selectCurrentTime(getEditorState())
                            const tInClip = curTime - selectedClip.startTime
                            if (hasKeyframesForProperty(selectedClip, 'filter.intensity') && tInClip >= 0 && tInClip <= selectedClip.duration) {
                              setKeyframe(selectedClip.id, 'filter.intensity', tInClip, val)
                            } else {
                              setClipFilterIntensity(selectedClip.id, val)
                            }
                          }}
                          className="flex-1 h-1.5 accent-cyan-400"
                        />
                        <KeyframeDiamondButton
                          clip={selectedClip}
                          property="filter.intensity"
                          currentValue={selectedClip.filter.intensity ?? 100}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 italic">
                      No filter applied. Choose a filter from the library to preview.
                    </p>
                  )}
                </div>

                {/* Color Adjustments */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">Adjustments</span>
                    {selectedClip.colorCorrection && Object.values(selectedClip.colorCorrection).some(v => v !== 0) && (
                      <button
                        type="button"
                        onClick={() => updateClip(selectedClip.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
                        className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-cyan-400 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset
                      </button>
                    )}
                  </div>

                  {[
                    { key: 'exposure' as const, label: 'Exposure', min: -100, max: 100 },
                    { key: 'brightness' as const, label: 'Brightness', min: -100, max: 100 },
                    { key: 'contrast' as const, label: 'Contrast', min: -100, max: 100 },
                    { key: 'saturation' as const, label: 'Saturation', min: -100, max: 100 },
                    { key: 'temperature' as const, label: 'Temperature', min: -100, max: 100 },
                  ].map((ctrl) => {
                    const currentVal = selectedClip.colorCorrection?.[ctrl.key] ?? 0
                    return (
                      <div key={ctrl.key} className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-zinc-400">
                          <span>{ctrl.label}</span>
                          <span className="text-[10px] text-zinc-500 tabular-nums">{currentVal}</span>
                        </div>
                        <input
                          type="range"
                          min={ctrl.min}
                          max={ctrl.max}
                          step={1}
                          value={currentVal}
                          onChange={(e) => updateClip(selectedClip.id, {
                            colorCorrection: {
                              ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION),
                              [ctrl.key]: parseInt(e.target.value, 10),
                            }
                          })}
                          className="w-full h-1.5 accent-cyan-400"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- Transitions --- */}
        {tab === 'effects' && hasTransitionControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowTransitions(!showTransitions)}
            >
              {showTransitions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Film className="h-3.5 w-3.5" />
              Transitions
            </button>
            {showTransitions && (
              <div className="space-y-3 pl-5">
                {/* Transition In */}
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition In</label>
                  <select
                    value={selectedClip.transitionIn?.type || 'none'}
                    onChange={(e) => updateClip(selectedClip.id, {
                      transitionIn: { ...selectedClip.transitionIn, type: e.target.value as TransitionType }
                    })}
                    className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                  >
                    <option value="none">None</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="fade-to-black">Fade from Black</option>
                    <option value="fade-to-white">Fade from White</option>
                    <option value="wipe-left">Wipe Left</option>
                    <option value="wipe-right">Wipe Right</option>
                    <option value="wipe-up">Wipe Up</option>
                    <option value="wipe-down">Wipe Down</option>
                  </select>
                  {selectedClip.transitionIn?.type !== 'none' && (
                    <div className="mt-1.5">
                      <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.1}
                          max={Math.min(2, selectedClip.duration / 2)}
                          step={0.1}
                          value={selectedClip.transitionIn?.duration || 0.5}
                          onChange={(e) => updateClip(selectedClip.id, {
                            transitionIn: { ...selectedClip.transitionIn, duration: parseFloat(e.target.value) }
                          })}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionIn?.duration || 0.5).toFixed(1)}s</span>
                      </div>
                    </div>
                  )}
                </div>
                {/* Transition Out */}
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition Out</label>
                  <select
                    value={selectedClip.transitionOut?.type || 'none'}
                    onChange={(e) => updateClip(selectedClip.id, {
                      transitionOut: { ...selectedClip.transitionOut, type: e.target.value as TransitionType }
                    })}
                    className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                  >
                    <option value="none">None</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="fade-to-black">Fade to Black</option>
                    <option value="fade-to-white">Fade to White</option>
                    <option value="wipe-left">Wipe Left</option>
                    <option value="wipe-right">Wipe Right</option>
                    <option value="wipe-up">Wipe Up</option>
                    <option value="wipe-down">Wipe Down</option>
                  </select>
                  {selectedClip.transitionOut?.type !== 'none' && (
                    <div className="mt-1.5">
                      <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.1}
                          max={Math.min(2, selectedClip.duration / 2)}
                          step={0.1}
                          value={selectedClip.transitionOut?.duration || 0.5}
                          onChange={(e) => updateClip(selectedClip.id, {
                            transitionOut: { ...selectedClip.transitionOut, duration: parseFloat(e.target.value) }
                          })}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionOut?.duration || 0.5).toFixed(1)}s</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- Applied Effects --- */}
        {tab === 'effects' && hasVisualTransformControls && (selectedClip.effects?.length ?? 0) > 0 && (
          <div className="pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <Sparkles className="h-3.5 w-3.5" />
                Effects
              </div>
              <button
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                onClick={() => clearClipEffects(selectedClip.id)}
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            <div className="space-y-2 pl-1">
              {selectedClip.effects!.map(effect => {
                const definition = EFFECT_DEFINITIONS[effect.type]
                return (
                  <div key={effect.id} className="rounded-lg bg-zinc-800/50 p-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setClipEffectEnabled(selectedClip.id, effect.id, !effect.enabled)}
                        className={`transition-colors ${effect.enabled ? 'text-blue-400' : 'text-zinc-600'}`}
                        title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <span className={`flex-1 text-[11px] ${effect.enabled ? 'text-zinc-200' : 'text-zinc-500'}`}>
                        {definition?.name ?? effect.type}
                      </span>
                      <button
                        onClick={() => removeClipEffect(selectedClip.id, effect.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title="Remove effect"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {effect.enabled && definition && Object.entries(definition.paramRanges).map(([param, range]) => (
                      <div key={param} className="mt-1.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-zinc-500">{range.label}</span>
                          <span className="text-[10px] text-zinc-500 tabular-nums">
                            {effect.params[param] ?? definition.defaultParams[param] ?? 0}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={range.min}
                          max={range.max}
                          step={range.step}
                          value={effect.params[param] ?? definition.defaultParams[param] ?? 0}
                          onChange={(e) => setClipEffectParam(selectedClip.id, effect.id, param, parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* --- 3D LUT Filter --- */}
        {tab === 'effects' && (selectedClip.type === 'video' || selectedClip.type === 'image' || selectedClip.type === 'adjustment') && (
          <div className="pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <Sparkles className="h-3.5 w-3.5 text-teal-400" />
                <span>{t('filters.tabTitle')}</span>
              </div>
              {selectedClip.filter && (
                <button
                  onClick={() => removeClipFilter(selectedClip.id)}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                  title={t('filters.removeFilter')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {selectedClip.filter ? (
              <div className="rounded-[6px] bg-zinc-900/60 p-2.5 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-zinc-200">
                    {getFilterDefinition(selectedClip.filter.id)?.name || selectedClip.filter.id}
                  </span>
                  <span className="text-[10px] text-zinc-500 tabular-nums">
                    {selectedClip.filter.intensity ?? 100}%
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500">{t('filters.intensity')}</span>
                      <KeyframeDiamondButton
                        clip={selectedClip}
                        property="filter.intensity"
                        currentValue={selectedClip.filter.intensity ?? 100}
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={selectedClip.filter.intensity ?? 100}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      const curTime = selectCurrentTime(getEditorState())
                      const timeInClip = curTime - selectedClip.startTime
                      if (hasKeyframesForProperty(selectedClip, 'filter.intensity') && timeInClip >= 0 && timeInClip <= selectedClip.duration) {
                        setKeyframe(selectedClip.id, 'filter.intensity', timeInClip, val)
                      } else {
                        setClipFilterIntensity(selectedClip.id, val)
                      }
                    }}
                    className="w-full accent-teal-400"
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 italic">
                {t('filters.noSelection')}
              </p>
            )}
          </div>
        )}

        {/* --- Color Correction --- */}
        {tab === 'effects' && hasColorCorrectionControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowColorCorrection(!showColorCorrection)}
            >
              {showColorCorrection ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Palette className="h-3.5 w-3.5" />
              Color Correction
              {selectedClip.colorCorrection && Object.values(selectedClip.colorCorrection).some(v => v !== 0) && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </button>
            {showColorCorrection && (
              <div className="space-y-2.5 pl-1">
              <button
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                onClick={() => updateClip(selectedClip.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
              >
                <RotateCcw className="h-3 w-3" />
                Reset All
              </button>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Exposure</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.exposure || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.exposure || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), exposure: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Brightness</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.brightness || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.brightness || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), brightness: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Contrast className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Contrast</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.contrast || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.contrast || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), contrast: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Droplets className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Saturation</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.saturation || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.saturation || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), saturation: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Temperature</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.temperature || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.temperature || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), temperature: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Cool</span>
                  <span>Warm</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Palette className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Tint</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.tint || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.tint || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), tint: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Green</span>
                  <span>Magenta</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <SunDim className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Highlights</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.highlights || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.highlights || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), highlights: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Moon className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Shadows</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.shadows || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.shadows || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), shadows: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>
              </div>
            )}
          </div>
        )}
      </div>}
      </div>
    </div>
  )
}
