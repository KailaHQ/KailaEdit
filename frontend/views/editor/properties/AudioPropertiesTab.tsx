import { useState } from 'react'
import type { Asset, TimelineClip } from '../../../types/project-model'
import { MAX_CLIP_VOLUME } from '../../../types/project-model'
import { isPreviewBoostAvailable } from '../audio-boost'
import { useTranslation } from '../../../i18n/I18nContext'
import {
  selectAssets,
  selectClips,
  selectTracks,
} from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'
import { hasKeyframesForProperty, getAudioFadeDurations } from '@core/keyframes'
import { computeSpeechIntervalsFromSilence, voiceClipSpeechToTimeline } from '@core/audio-ducking'

import type { SampledClipProperties } from '@core/keyframes'

interface AudioPropertiesTabProps {
  selectedClip: TimelineClip
  effectiveMuted: boolean
  effectiveVolume: number
  timeInClip: number
  sampledClip?: SampledClipProperties | null
}

export function AudioPropertiesTab({
  selectedClip,
  effectiveMuted,
  effectiveVolume,
  timeInClip,
  sampledClip,
}: AudioPropertiesTabProps) {
  const { t } = useTranslation()
  const {
    setClipAudioLevel,
    setClipAudioMuted,
    setAudioFade,
    normalizeClipAudio,
    duckClipAudio,
    updateClip,
    setKeyframe,
  } = useEditorActions()

  const assets = useEditorStore(selectAssets)
  const tracks = useEditorStore(selectTracks)
  const clips = useEditorStore(selectClips)

  const [targetLufs, setTargetLufs] = useState<number>(-14)
  const [isMeasuringLoudness, setIsMeasuringLoudness] = useState<boolean>(false)
  const [loudnessMessage, setLoudnessMessage] = useState<string | null>(null)
  const [duckingDb, setDuckingDb] = useState<number>(-12)
  const [duckingAttack, setDuckingAttack] = useState<number>(0.3)
  const [duckingRelease, setDuckingRelease] = useState<number>(0.5)
  const [duckingSourceTrack, setDuckingSourceTrack] = useState<string>('other')
  const [isDuckingProcessing, setIsDuckingProcessing] = useState<boolean>(false)
  const [duckingMessage, setDuckingMessage] = useState<string | null>(null)

  const getLiveAsset = (clip: TimelineClip): Asset | null | undefined => {
    if (!clip.assetId) return clip.asset
    return assets.find(asset => asset.id === clip.assetId) || clip.asset
  }

  const hasKf = hasKeyframesForProperty(selectedClip, 'volume')
  const currentVolume = hasKf && sampledClip ? (sampledClip.volume ?? effectiveVolume) : effectiveVolume
  const displayVolume = effectiveMuted ? 0 : currentVolume
  const decibels = displayVolume > 0 ? 20 * Math.log10(displayVolume) : null
  const isBoosted = displayVolume > 1

  const { fadeIn, fadeOut } = getAudioFadeDurations(selectedClip)

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

  const handleAutoDuck = async () => {
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
        const voicePath = live?.path || voiceClip.asset?.path
        let localSpeech: { start: number; end: number }[] = []

        if (voicePath && window.electronAPI?.detectSilence) {
          try {
            const silences = await window.electronAPI.detectSilence({
              filePath: voicePath,
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
  }

  return (
    <div className="space-y-3">
      {/* Volume Control */}
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
        {/* Unity marker */}
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

      {/* Reverse & Mute */}
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

      {/* Audio Fade */}
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

      {/* LUFS Normalization */}
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

        {/* Audio Ducking */}
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
              onClick={handleAutoDuck}
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
    </div>
  )
}
