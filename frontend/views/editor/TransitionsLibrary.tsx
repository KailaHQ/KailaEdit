import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Check, GripVertical } from 'lucide-react'
import {
  TRANSITION_DEFINITIONS,
  transitionCategoryValues,
  DEFAULT_TRANSITION_DURATION,
  type TransitionCategory,
  type TransitionDefinition,
} from '@core/transitions'
import { transitionLayerStyles } from '@core/transition-styles'
import { findCutPoints, nearestCut } from '@core/timeline-cuts'
import { selectActiveTimeline, selectClips, selectCurrentTime } from './editor-selectors'
import { useEditorActions, useEditorGetState, useEditorStore } from './editor-store'
import { useTranslation } from '../../i18n/I18nContext'
import { useSettings } from '../../contexts/SettingsContext'

const FALLBACK_CATEGORY_LABELS: Record<TransitionCategory, string> = {
  basic: 'Basic',
  wipe: 'Wipe',
  slide: 'Slide',
  shape: 'Shape',
  motion: 'Motion',
}

/**
 * Visual thumbnail for transition preview:
 * Contrasting Scene A (Sunset Mountain) and Scene B (Ocean / Moon)
 * At rest (!playing): shows progress at 0.48 so the geometry of the transition is immediately visible.
 * On hover (playing): animates from 0% -> 100% in a smooth loop.
 */
function TransitionThumbnail({ definition, playing }: { definition: TransitionDefinition; playing: boolean }) {
  const [progress, setProgress] = useState(0.48)
  const frameRef = useRef<number | null>(null)

  React.useEffect(() => {
    if (!playing) {
      setProgress(0.48)
      return
    }
    const started = performance.now()
    const loopDuration = 1300
    const tick = (now: number) => {
      const elapsed = ((now - started) % loopDuration) / loopDuration
      setProgress(elapsed)
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [playing])

  const styles = transitionLayerStyles(definition.id, progress)

  return (
    <div className="relative h-[54px] w-full overflow-hidden rounded-[5px] bg-zinc-900 shadow-inner border border-zinc-700/50 select-none">
      {/* Scene A: Outgoing Layer (Warm Sunset Mountain) */}
      <div
        className="absolute inset-0 overflow-hidden bg-gradient-to-br from-amber-500 via-rose-600 to-indigo-950"
        style={styles.outgoing as React.CSSProperties}
      >
        <div className="absolute top-1.5 left-2.5 h-3.5 w-3.5 rounded-full bg-amber-200/90 shadow-sm" />
        <svg
          className="absolute bottom-0 inset-x-0 h-5 w-full text-indigo-950/85 fill-current"
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
        >
          <path d="M0 30 L0 18 L25 5 L55 22 L75 8 L100 20 L100 30 Z" />
        </svg>
        <span className="absolute top-1 left-1 px-1 py-0.2 rounded bg-black/60 text-[8px] font-bold text-amber-300 leading-tight">
          A
        </span>
      </div>

      {/* Colour flash layer (for fade-to-black, fade-to-white) */}
      {styles.colour && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: styles.colour.color, opacity: Number(styles.colour.opacity) }}
        />
      )}

      {/* Scene B: Incoming Layer (Cool Cyan Ocean) */}
      <div
        className="absolute inset-0 overflow-hidden bg-gradient-to-br from-sky-400 via-teal-600 to-slate-950"
        style={styles.incoming as React.CSSProperties}
      >
        <div className="absolute top-1.5 right-2.5 h-3 w-3 rounded-full bg-cyan-100 shadow-sm" />
        <svg
          className="absolute bottom-0 inset-x-0 h-5 w-full text-teal-950/90 fill-current"
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
        >
          <path d="M0 30 L0 12 Q25 24 50 14 T100 16 L100 30 Z" />
        </svg>
        <span className="absolute top-1 right-1 px-1 py-0.2 rounded bg-black/60 text-[8px] font-bold text-cyan-300 leading-tight">
          B
        </span>
      </div>

      {/* Animated progress indicator bar on hover */}
      {playing && (
        <div className="absolute bottom-0 inset-x-0 h-[2px] bg-black/40">
          <div
            className="h-full bg-teal-400 transition-none"
            style={{ width: `${(progress * 100).toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The Transitions tab.
 *
 * Supports:
 * 1. Clicking a tile to apply to the cut point nearest the playhead.
 * 2. Dragging a tile directly onto any cut point on the timeline.
 * 3. Full i18n support for names, categories, and guidance hints.
 */
export function TransitionsLibrary() {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const actions = useEditorActions()
  const getState = useEditorGetState()
  const clips = useEditorStore(selectClips)
  const transitions = useEditorStore(state => selectActiveTimeline(state)?.transitions)
  const [hovered, setHovered] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const cuts = useMemo(() => findCutPoints(clips, transitions ?? []), [clips, transitions])

  /** The transition already on the cut we would apply to, for the tick mark. */
  const targetCut = useMemo(() => {
    const time = selectCurrentTime(getState())
    return nearestCut(cuts, time)
  }, [cuts, getState])

  const apply = useCallback((definition: TransitionDefinition) => {
    const time = selectCurrentTime(getState())
    const cut = nearestCut(findCutPoints(selectClips(getState()), selectActiveTimeline(getState())?.transitions ?? []), time)
    if (!cut) {
      setNotice(t('transitions.noCutPointsFound'))
      return
    }
    actions.setTimelineTransition(
      cut.leftClip.id,
      cut.rightClip.id,
      definition.id,
      cut.transition?.duration ?? settings.defaultTransitionDuration ?? DEFAULT_TRANSITION_DURATION,
    )
    setNotice(null)
  }, [actions, getState, settings.defaultTransitionDuration, t])

  const getCategoryTitle = (category: TransitionCategory): string => {
    const localized = t(`transitions.categories.${category}`)
    return localized && !localized.startsWith('transitions.') ? localized : (FALLBACK_CATEGORY_LABELS[category] || category)
  }

  const getDefinitionLabel = (definition: TransitionDefinition): string => {
    const localized = t(`transitions.items.${definition.id}`)
    return localized && !localized.startsWith('transitions.') ? localized : definition.label
  }

  return (
    <div className="flex h-full flex-col">
      <p className="flex-shrink-0 pb-2 text-[11px] leading-relaxed text-zinc-400">
        {cuts.length === 0
          ? t('transitions.hintEmpty')
          : t('transitions.hintSelect')}
      </p>

      {notice && (
        <p className="mb-2 flex-shrink-0 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
          {notice}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {transitionCategoryValues.map(category => {
          const entries = TRANSITION_DEFINITIONS.filter(definition => definition.category === category)
          if (entries.length === 0) return null
          return (
            <section key={category}>
              <h4 className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {getCategoryTitle(category)}
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {entries.map(definition => {
                  const isCurrent = targetCut?.transition?.type === definition.id
                  const label = getDefinitionLabel(definition)
                  return (
                    <div
                      key={definition.id}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('transitionType', definition.id)
                        e.dataTransfer.setData('application/x-komfyedit-transition', definition.id)
                        e.dataTransfer.setData('text/plain', definition.id)
                        e.dataTransfer.effectAllowed = 'copy'
                        window.dispatchEvent(new CustomEvent('komfyedit:transition-drag-start', { detail: { type: definition.id } }))
                      }}
                      onDragEnd={() => {
                        window.dispatchEvent(new CustomEvent('komfyedit:transition-drag-end'))
                      }}
                      onClick={() => apply(definition)}
                      onMouseEnter={() => setHovered(definition.id)}
                      onMouseLeave={() => setHovered(current => (current === definition.id ? null : current))}
                      className={`group flex flex-col gap-1 rounded-[6px] p-1 text-left transition-all cursor-grab active:cursor-grabbing ${
                        isCurrent ? 'bg-teal-500/15 ring-1 ring-teal-500/60' : 'hover:bg-zinc-800/80'
                      }`}
                      title={`${label} (${t('transitions.dragToCutHint')})`}
                    >
                      <div className="relative">
                        <TransitionThumbnail definition={definition} playing={hovered === definition.id} />
                        {isCurrent && (
                          <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-teal-400 text-zinc-950 shadow">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </span>
                        )}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 left-1 p-0.5 rounded bg-black/60 text-zinc-300 pointer-events-none">
                          <GripVertical className="h-2.5 w-2.5" />
                        </div>
                      </div>
                      <span className="truncate text-[10.5px] text-zinc-300 font-normal group-hover:text-white">
                        {label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

