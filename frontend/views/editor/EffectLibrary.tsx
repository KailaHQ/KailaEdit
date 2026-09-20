import { EFFECT_DEFINITIONS } from '../../types/project'
import type { EffectType } from '../../types/project-model'
import type { LibraryTab } from './editor-state'
import { selectSelectedClipIds } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

/* ── Effects / Filters / Adjust ──
   All three read from the same effect registry; the tab just narrows which
   categories are on offer. */

const CATEGORIES_BY_TAB: Record<string, readonly string[]> = {
  effects: ['stylize', 'filter'],
  filters: ['color-preset'],
  adjust: ['filter'],
}

const SWATCH: Record<string, string> = {
  blur: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
  glow: 'linear-gradient(135deg,#eab308,#ca8a04)',
  sharpen: 'linear-gradient(135deg,#06b6d4,#0891b2)',
  vignette: 'linear-gradient(135deg,#18181b,#27272a)',
  grain: 'linear-gradient(135deg,#71717a,#52525b)',
}

export function EffectLibrary({ tab }: { tab: LibraryTab }) {
  const actions = useEditorActions()
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const categories = CATEGORIES_BY_TAB[tab] ?? []

  const entries = (Object.entries(EFFECT_DEFINITIONS) as [EffectType, { name: string; category: string }][])
    .filter(([, def]) => categories.includes(def.category))

  const apply = (type: EffectType) => {
    // Effects attach to a clip, so without a selection there is nothing to
    // apply to — greys the whole grid out in that case.
    for (const clipId of selectedClipIds) actions.addClipEffect(clipId, type)
  }

  const disabled = selectedClipIds.size === 0

  return (
    <>
      {disabled && (
        <p className="mb-3 text-[11px] text-zinc-500">Select a clip on the timeline to apply.</p>
      )}
      <div className={`grid grid-cols-3 gap-2 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
        {entries.map(([type, def]) => (
          <button
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('effectType', type)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => apply(type)}
            className="group flex flex-col gap-1.5"
            title={`${def.name} — click to apply, or drag onto a clip`}
          >
            <div
              className="h-[62px] w-full rounded-[6px] ring-1 ring-white/5 transition-all group-hover:ring-accent"
              style={{ background: SWATCH[type] ?? 'linear-gradient(135deg,#2a2a2e,#3a3a42)' }}
            />
            <span className="truncate text-[11px] text-zinc-400 group-hover:text-zinc-100">{def.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}
