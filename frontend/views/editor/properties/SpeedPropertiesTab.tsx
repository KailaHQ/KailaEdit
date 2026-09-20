import { clampClipSpeed } from '@core/clip-speed'
import { mainVideoTrackIndex } from '@core/video-editor-utils'
import { SpeedSlider } from '../SpeedSlider'
import type { TimelineClip } from '../../../types/project-model'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'
import { hasKeyframesForProperty, sampleClipAt } from '@core/keyframes'
import { selectAssets, selectCurrentTime, selectTracks } from '../editor-selectors'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions, useEditorGetState, useEditorStore } from '../editor-store'

export interface SpeedPropertiesTabProps {
  selectedClip: TimelineClip
}

export function SpeedPropertiesTab({ selectedClip }: SpeedPropertiesTabProps) {
  const { t } = useTranslation()
  const {
    setClipStartTime,
    setClipSpeed,
    setKeyframe,
    clearKeyframes,
  } = useEditorActions()
  const getEditorState = useEditorGetState()

  const assets = useEditorStore(selectAssets)
  const tracks = useEditorStore(selectTracks)

  const isOnMagneticTrack = mainVideoTrackIndex(tracks) === selectedClip.trackIndex

  const getLiveAsset = (clip: TimelineClip) => {
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

  const hasSpeedRamp = hasKeyframesForProperty(selectedClip, 'speed')
  const curTime = selectCurrentTime(getEditorState())
  const timeInClip = Math.max(0, Math.min(selectedClip.duration, curTime - selectedClip.startTime))
  const currentSpeed = hasSpeedRamp
    ? sampleClipAt(selectedClip, timeInClip).speed
    : selectedClip.speed ?? 1

  const applyRampPreset = (presetType: 'bullet-time' | 'montage-fast-slow' | 'jump-ramp') => {
    const dur = selectedClip.duration
    if (presetType === 'bullet-time') {
      setKeyframe(selectedClip.id, 'speed', 0, 1, 'linear')
      setKeyframe(selectedClip.id, 'speed', dur * 0.3, 1, 'ease-in-out')
      setKeyframe(selectedClip.id, 'speed', dur * 0.4, 0.25, 'ease-in-out')
      setKeyframe(selectedClip.id, 'speed', dur * 0.7, 0.25, 'ease-in-out')
      setKeyframe(selectedClip.id, 'speed', dur * 0.8, 1, 'ease-in-out')
      setKeyframe(selectedClip.id, 'speed', dur, 1, 'linear')
    } else if (presetType === 'montage-fast-slow') {
      setKeyframe(selectedClip.id, 'speed', 0, 3, 'ease-out')
      setKeyframe(selectedClip.id, 'speed', dur * 0.4, 1, 'linear')
      setKeyframe(selectedClip.id, 'speed', dur, 0.5, 'ease-in-out')
    } else if (presetType === 'jump-ramp') {
      setKeyframe(selectedClip.id, 'speed', 0, 0.5, 'linear')
      setKeyframe(selectedClip.id, 'speed', dur * 0.4, 0.5, 'ease-in')
      setKeyframe(selectedClip.id, 'speed', dur * 0.5, 3, 'ease-out')
      setKeyframe(selectedClip.id, 'speed', dur * 0.8, 1, 'linear')
      setKeyframe(selectedClip.id, 'speed', dur, 1, 'linear')
    }
  }

  const applySpeed = (newSpeed: number, explicitDuration?: number) => {
    if (hasSpeedRamp && timeInClip >= 0 && timeInClip <= selectedClip.duration) {
      setKeyframe(selectedClip.id, 'speed', timeInClip, newSpeed)
      return
    }
    const oldSpeed = selectedClip.speed ?? 1
    let newDuration =
      explicitDuration !== undefined
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
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Start Time</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={selectedClip.startTime.toFixed(2)}
            onChange={(e) =>
              setClipStartTime(selectedClip.id, Math.max(0, parseFloat(e.target.value) || 0))
            }
            disabled={isOnMagneticTrack}
            title={
              isOnMagneticTrack
                ? 'Clips on the main track are automatically packed'
                : undefined
            }
            min={0}
            step={0.1}
            className={`w-28 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none ${
              isOnMagneticTrack ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          <span className="text-xs text-zinc-500">s</span>
        </div>
      </div>

      {/* Speed Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-zinc-500">Speed</label>
            <KeyframeDiamondButton
              clip={selectedClip}
              property="speed"
              currentValue={currentSpeed}
            />
          </div>
          <span className="text-xs text-white tabular-nums">{currentSpeed}x</span>
        </div>
        <SpeedSlider
          speed={currentSpeed}
          onChange={(newSpeed) => applySpeed(newSpeed)}
        />
        {/* Speed presets */}
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {[0.25, 0.5, 1, 1.5, 2, 4].map((presetSpeed) => (
            <button
              key={presetSpeed}
              onClick={() => applySpeed(presetSpeed)}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                Math.abs(currentSpeed - presetSpeed) < 0.01
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {presetSpeed}x
            </button>
          ))}
        </div>
      </div>

      {/* Speed Ramp Presets */}
      <div className="pt-2 border-t border-zinc-800/80">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-zinc-400 font-medium">Speed Ramp Presets</label>
          {hasSpeedRamp && (
            <button
              onClick={() => clearKeyframes(selectedClip.id, 'speed')}
              className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
            >
              Reset Ramp
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => applyRampPreset('bullet-time')}
            className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] border border-zinc-700/60 transition-colors text-center"
            title="Starts fast, dramatic slow-mo center, exits fast"
          >
            Bullet Time
          </button>
          <button
            onClick={() => applyRampPreset('montage-fast-slow')}
            className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] border border-zinc-700/60 transition-colors text-center"
            title="Starts hyper-fast, smoothly resolves into slow motion"
          >
            Montage
          </button>
          <button
            onClick={() => applyRampPreset('jump-ramp')}
            className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] border border-zinc-700/60 transition-colors text-center"
            title="Slow build, explosive burst, quick settle"
          >
            Jump Ramp
          </button>
        </div>
      </div>

      {/* Duration (linked to speed) */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Duration</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Number(selectedClip.duration.toFixed(2))}
            onChange={(e) => {
              const targetDur = parseFloat(e.target.value)
              if (targetDur > 0) {
                applyDurationInSpeedTab(targetDur)
              }
            }}
            min={0.1}
            max={Number(getMaxClipDuration(selectedClip).toFixed(2))}
            step={0.1}
            className="w-28 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs tabular-nums focus:border-blue-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">s</span>
        </div>
      </div>

      {/* Audio Muted Warning during speed ramp */}
      {hasSpeedRamp && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 text-[11px] text-amber-300 space-y-1">
          <span className="font-semibold block">⚠️ Audio muted during Speed Ramp</span>
          <p className="text-zinc-400 leading-relaxed">
            {t('clipProperties.speedRampAudioMuted')}
          </p>
        </div>
      )}
    </div>
  )
}
