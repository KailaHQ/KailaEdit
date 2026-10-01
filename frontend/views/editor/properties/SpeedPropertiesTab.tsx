import { useState } from 'react'
import { clampClipSpeed, formatClipSpeed } from '@core/clip-speed'
import { clipHasSpeedCurve, speedCurveForPreset } from '@core/speed-curve'
import { mainVideoTrackIndex } from '@core/video-editor-utils'
import { SpeedSlider } from '../SpeedSlider'
import type { TimelineClip } from '../../../types/project-model'
import { selectAssets, selectTracks } from '../editor-selectors'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions, useEditorStore } from '../editor-store'
import { SpeedCurveEditor, SpeedCurvePresetGrid } from './SpeedCurveEditor'

export interface SpeedPropertiesTabProps {
  selectedClip: TimelineClip
}

type SpeedSubTab = 'standard' | 'curve'

/**
 * The Speed tab: a constant speed under Standard, a speed curve under Curve.
 * A clip uses one or the other — picking a curve replaces the constant speed,
 * and setting a speed under Standard removes the curve.
 */
export function SpeedPropertiesTab({ selectedClip }: SpeedPropertiesTabProps) {
  // Remount per clip so the sub-tab opens on the mode the clip is in.
  return <SpeedPropertiesTabInner key={selectedClip.id} selectedClip={selectedClip} />
}

function SpeedPropertiesTabInner({ selectedClip }: SpeedPropertiesTabProps) {
  const { t } = useTranslation()
  const { setClipStartTime, setClipSpeed, setClipSpeedCurve } = useEditorActions()

  const assets = useEditorStore(selectAssets)
  const tracks = useEditorStore(selectTracks)

  const hasCurve = clipHasSpeedCurve(selectedClip)
  const [subTab, setSubTab] = useState<SpeedSubTab>(hasCurve ? 'curve' : 'standard')
  const canCurve = selectedClip.type === 'video' || selectedClip.type === 'audio'

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

  const currentSpeed = selectedClip.speed ?? 1

  const applySpeed = (newSpeed: number, explicitDuration?: number) => {
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
    <div className="space-y-4" data-speed-properties>
      {canCurve && (
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-[#141416] p-1 select-none" role="tablist">
          {([
            ['standard', t('clipProperties.speedCurve.tabStandard')],
            ['curve', t('clipProperties.speedCurve.tabCurve')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={subTab === id}
              data-speed-subtab={id}
              onClick={() => setSubTab(id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-all ${
                subTab === id
                  ? 'bg-[#252529] font-semibold text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
              }`}
            >
              {label}
              {id === 'curve' && hasCurve && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 align-middle" />}
            </button>
          ))}
        </div>
      )}

      {(subTab === 'standard' || !canCurve) && (
        <>
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

          {hasCurve && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] text-amber-300" data-speed-curve-replaced-note>
              {t('clipProperties.speedCurve.standardReplacesCurve')}
            </p>
          )}

          {/* Speed Slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-500">Speed</label>
              <span className="text-xs text-white tabular-nums">{formatClipSpeed(currentSpeed)}</span>
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
                    !hasCurve && Math.abs(currentSpeed - presetSpeed) < 0.01
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {presetSpeed}x
                </button>
              ))}
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
        </>
      )}

      {subTab === 'curve' && canCurve && (
        <div className="space-y-4">
          <SpeedCurvePresetGrid
            active={hasCurve ? selectedClip.speedCurve!.preset : null}
            onPick={preset => setClipSpeedCurve(selectedClip.id, preset ? speedCurveForPreset(preset) : null)}
          />

          {hasCurve && selectedClip.speedCurve && (
            <SpeedCurveEditor
              clip={selectedClip}
              curve={selectedClip.speedCurve}
              onCommit={curve => setClipSpeedCurve(selectedClip.id, curve)}
            />
          )}

          {hasCurve && (
            <p className="text-[11px] leading-relaxed text-zinc-500">
              {t('clipProperties.speedCurve.audioPitchNote')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
