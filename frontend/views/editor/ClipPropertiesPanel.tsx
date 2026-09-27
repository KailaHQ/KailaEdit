import { useState } from 'react'
import { shallow } from 'zustand/vanilla/shallow'
import { useTranslation } from '../../i18n/I18nContext'
import {
  selectCurrentTime,
  selectSelectedClipAudioControls,
  selectSelectedClipForProperties,
  selectSelectedKeyframe,
} from './editor-selectors'
import { useEditorStore } from './editor-store'
import { sampleClipAt } from '@core/keyframes'

import { MetadataTab } from './properties/MetadataTab'
import { AdjustmentTab } from './properties/AdjustmentTab'
import { TextPropertiesTab } from './properties/TextPropertiesTab'
import { SpeedPropertiesTab } from './properties/SpeedPropertiesTab'
import { AudioPropertiesTab } from './properties/AudioPropertiesTab'
import { BasicVideoSection } from './properties/BasicVideoSection'
import { RemoveBgTab } from './removebg/RemoveBgTab'
import { MaskPropertiesSection } from './properties/MaskPropertiesSection'
import { RetouchPropertiesSection } from './properties/RetouchPropertiesSection'
import { EffectsPropertiesTab } from './properties/EffectsPropertiesTab'

/** The tabs across the top of the right-hand panel. */
type PropertiesTab = 'text' | 'adjust' | 'video' | 'audio' | 'speed' | 'effects' | 'metadata'

export function ClipPropertiesPanel() {
  const { t } = useTranslation()
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const clipAudioControls = useEditorStore(selectSelectedClipAudioControls, shallow)
  const currentTime = useEditorStore(selectCurrentTime)
  const selectedKeyframe = useEditorStore(selectSelectedKeyframe)

  const [propertiesTab, setPropertiesTab] = useState<PropertiesTab>('video')
  const [videoSubTab, setVideoSubTab] = useState<'basic' | 'remove-bg' | 'mask' | 'retouch'>('basic')

  if (!selectedClip) return null

  const playheadTimeInClip = Math.max(0, Math.min(selectedClip.duration, currentTime - selectedClip.startTime))
  // When a keyframe on this clip is selected (e.g. dragged to the end or clicked), bind property edits directly to that keyframe's exact timestamp
  const isKeyframeSelected = Boolean(
    selectedKeyframe &&
    selectedKeyframe.clipId === selectedClip.id &&
    Math.abs(selectedKeyframe.t - playheadTimeInClip) <= 0.1
  )
  const timeInClip = isKeyframeSelected && selectedKeyframe
    ? selectedKeyframe.t
    : playheadTimeInClip
  const sampledClip = sampleClipAt(selectedClip, timeInClip)

  const effectiveMuted = clipAudioControls?.muted ?? (selectedClip.muted || false)
  const effectiveVolume = clipAudioControls?.volume ?? (selectedClip.volume ?? 1)

  const hasPlaybackControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasAudioControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasVisualTransformControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasTransitionControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasColorCorrectionControls = selectedClip.type === 'video' || selectedClip.type === 'image'

  // Which tabs exist depends on the clip
  const tabs: { id: PropertiesTab; label: string }[] = [
    ...(selectedClip.type === 'text' ? [{ id: 'text' as const, label: 'Text' }] : []),
    ...(selectedClip.type === 'adjustment' ? [{ id: 'adjust' as const, label: 'Adjust' }] : []),
    ...(hasVisualTransformControls ? [{ id: 'video' as const, label: 'Video' }] : []),
    ...(hasAudioControls ? [{ id: 'audio' as const, label: 'Audio' }] : []),
    ...(hasPlaybackControls ? [{ id: 'speed' as const, label: 'Speed' }] : []),
    { id: 'effects', label: 'Effects' },
    { id: 'metadata', label: 'Info' },
  ]

  // Keep the selection valid as the clip type changes
  const tab: PropertiesTab = tabs.some(item => item.id === propertiesTab)
    ? propertiesTab
    : tabs[0].id

  return (
    <div className="flex h-full w-full flex-shrink-0 flex-col bg-zinc-900">
      {/* Tab strip */}
      <div className="flex h-[34px] flex-shrink-0 items-center gap-4 overflow-x-auto border-b border-zinc-800 px-4">
        {tabs.map(item => (
          <button
            key={item.id}
            onClick={() => setPropertiesTab(item.id)}
            className={`flex-shrink-0 text-[13px] transition-colors ${
              tab === item.id ? 'text-accent' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Info tab */}
        {tab === 'metadata' && (
          <MetadataTab selectedClip={selectedClip} />
        )}

        {tab !== 'metadata' && (
          <div className="space-y-4">
            {/* Adjustment Layer properties */}
            {tab === 'adjust' && selectedClip.type === 'adjustment' && (
              <AdjustmentTab selectedClip={selectedClip} />
            )}

            {/* Text Overlay properties */}
            {tab === 'text' && selectedClip.type === 'text' && (
              <TextPropertiesTab selectedClip={selectedClip} />
            )}

            {/* Speed tab */}
            {tab === 'speed' && hasPlaybackControls && (
              <SpeedPropertiesTab selectedClip={selectedClip} />
            )}

            {/* Audio tab */}
            {tab === 'audio' && hasAudioControls && (
              <AudioPropertiesTab
                selectedClip={selectedClip}
                effectiveMuted={effectiveMuted}
                effectiveVolume={effectiveVolume}
                timeInClip={timeInClip}
                sampledClip={sampledClip}
              />
            )}

            {/* Video Tab */}
            {tab === 'video' && (
              <div className="space-y-4">
                {/* Level 2 Sub-Tabs (Pill Navigation) */}
                <div className="flex items-center bg-[#141416] p-1 rounded-lg border border-zinc-800/80 gap-1 select-none">
                  {(['basic', 'remove-bg', 'mask', 'retouch'] as const).map((sub) => {
                    const labels: Record<typeof sub, string> = {
                      'basic': t('clipProperties.subTabs.basic') || 'Basic',
                      'remove-bg': t('clipProperties.subTabs.removeBg') || 'Remove BG',
                      'mask': t('clipProperties.subTabs.mask') || 'Mask',
                      'retouch': t('clipProperties.subTabs.retouch') || 'Retouch',
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

                {/* Sub-tab 1: Basic */}
                {videoSubTab === 'basic' && (
                  <BasicVideoSection
                    selectedClip={selectedClip}
                    sampledClip={sampledClip}
                    timeInClip={timeInClip}
                    hasVisualTransformControls={hasVisualTransformControls}
                  />
                )}

                {/* Sub-tab 2: Remove BG */}
                {videoSubTab === 'remove-bg' && (
                  <RemoveBgTab clip={selectedClip} />
                )}

                {/* Sub-tab 3: Mask */}
                {videoSubTab === 'mask' && (
                  <MaskPropertiesSection selectedClip={selectedClip} />
                )}

                {/* Sub-tab 4: Retouch */}
                {videoSubTab === 'retouch' && (
                  <RetouchPropertiesSection selectedClip={selectedClip} />
                )}
              </div>
            )}

            {/* Effects tab */}
            {tab === 'effects' && (
              <EffectsPropertiesTab
                selectedClip={selectedClip}
                hasTransitionControls={hasTransitionControls}
                hasVisualTransformControls={hasVisualTransformControls}
                hasColorCorrectionControls={hasColorCorrectionControls}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
