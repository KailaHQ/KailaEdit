import { Ban } from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import { TEXT_ANIMATIONS, TEXT_PRESETS } from '@core/text-presets'
import { useEditorActions } from '../editor-store'

export interface TextAnimationTabProps {
  selectedClip: TimelineClip
}

/**
 * The text clip's "Animation" tab: the keyframed entrance animations, and the named
 * templates (a whole look plus size and font) that used to share the Text tab.
 */
export function TextAnimationTab({ selectedClip }: TextAnimationTabProps) {
  const { applyTextPresetToClip, applyTextAnimationToClip, clearKeyframes } = useEditorActions()
  if (selectedClip.type !== 'text') return null

  const tile = 'flex h-14 flex-col items-center justify-center gap-0.5 rounded-md bg-[#2a2a2e] px-1 text-center text-[11px] text-zinc-200 transition-colors hover:bg-zinc-700'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-xs font-medium text-zinc-200">Animation</span>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" className={tile} title="Remove the animation" onClick={() => clearKeyframes(selectedClip.id)}>
            <Ban className="h-4 w-4 text-zinc-400" />
            <span>None</span>
          </button>
          {TEXT_ANIMATIONS.map(animation => (
            <button
              key={animation.id}
              type="button"
              className={tile}
              title={animation.description}
              onClick={() => applyTextAnimationToClip(selectedClip.id, animation.id)}
            >
              <span className="truncate w-full">{animation.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <span className="text-xs font-medium text-zinc-200">Templates</span>
        <div className="grid grid-cols-2 gap-1.5">
          {TEXT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => applyTextPresetToClip(selectedClip.id, preset.id)}
              className="truncate rounded-md bg-[#2a2a2e] px-2 py-2 text-left text-[11px] text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
