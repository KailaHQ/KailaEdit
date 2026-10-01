import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import type { SpeedCurve, SpeedCurvePreset, TimelineClip } from '../../../types/project-model'
import {
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  SPEED_CURVE_PRESETS,
  clipSourceSpan,
  clipTimeAtSourceOffset,
  curveSpeedAtX,
  durationForSpeedCurve,
  insertSpeedCurvePoint,
  moveSpeedCurvePoint,
  normalizeSpeedCurve,
  removeSpeedCurvePoint,
  sourceOffsetAtClipTime,
  speedCurveForPreset,
} from '@core/speed-curve'
import { formatClipSpeed } from '@core/clip-speed'
import { selectCurrentTime } from '../editor-selectors'
import { useEditorActions, useEditorGetState } from '../editor-store'
import { useTranslation } from '../../../i18n/I18nContext'

// ── Geometry ────────────────────────────────────────────────────────────────

const LOG_MIN = Math.log10(MIN_CURVE_SPEED)
const LOG_MAX = Math.log10(MAX_CURVE_SPEED)

/** 0 at the top (10x) to 1 at the bottom (0.1x): speed is drawn on a log scale. */
function yFractionForSpeed(v: number): number {
  return (LOG_MAX - Math.log10(Math.max(MIN_CURVE_SPEED, Math.min(MAX_CURVE_SPEED, v)))) / (LOG_MAX - LOG_MIN)
}

function speedForYFraction(f: number): number {
  return Math.pow(10, LOG_MAX - Math.max(0, Math.min(1, f)) * (LOG_MAX - LOG_MIN))
}

/** Within this many decades of 1x a dragged point lands on 1x exactly. */
const ONE_X_SNAP = 0.04

function roundSpeed(v: number): number {
  if (Math.abs(Math.log10(v)) < ONE_X_SNAP) return 1
  return v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10
}

function curvePath(curve: SpeedCurve, width: number, height: number, samples = 96): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const x = i / samples
    const px = x * width
    const py = yFractionForSpeed(curveSpeedAtX(curve, x)) * height
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`
  }
  return d
}

// ── Preset grid ─────────────────────────────────────────────────────────────

const PRESET_LABEL_KEYS: Record<SpeedCurvePreset, string> = {
  custom: 'clipProperties.speedCurve.presets.custom',
  montage: 'clipProperties.speedCurve.presets.montage',
  hero: 'clipProperties.speedCurve.presets.hero',
  bullet: 'clipProperties.speedCurve.presets.bullet',
  'jump-cut': 'clipProperties.speedCurve.presets.jumpCut',
  'flash-in': 'clipProperties.speedCurve.presets.flashIn',
  'flash-out': 'clipProperties.speedCurve.presets.flashOut',
}

function PresetThumbnail({ preset }: { preset: SpeedCurvePreset }) {
  const d = useMemo(() => curvePath(speedCurveForPreset(preset), 48, 28, 40), [preset])
  return (
    <svg viewBox="-2 -2 52 32" className="h-7 w-12" aria-hidden>
      <line x1="0" x2="48" y1="14" y2="14" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="2 2" />
      <path d={d} fill="none" stroke="#facc15" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  )
}

export function SpeedCurvePresetGrid({
  active,
  onPick,
}: {
  /** The preset the clip's curve came from, or null when it has none. */
  active: SpeedCurvePreset | null
  onPick: (preset: SpeedCurvePreset | null) => void
}) {
  const { t } = useTranslation()
  const tile = 'flex h-[68px] flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-[#2a2a2e] px-1 text-center text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700'
  const ring = (on: boolean) => (on ? ' ring-2 ring-cyan-400 text-white' : '')

  return (
    <div className="grid grid-cols-4 gap-1.5" data-speed-curve-presets>
      <button type="button" className={tile + ring(active === null)} data-speed-curve-preset="none" onClick={() => onPick(null)}>
        <Ban className="h-5 w-5 text-zinc-400" />
        <span>{t('clipProperties.speedCurve.presets.none')}</span>
      </button>
      {SPEED_CURVE_PRESETS.map(preset => (
        <button
          key={preset}
          type="button"
          className={tile + ring(active === preset)}
          data-speed-curve-preset={preset}
          onClick={() => onPick(preset)}
        >
          {preset === 'custom'
            ? <SlidersHorizontal className="h-5 w-5 text-zinc-300" />
            : <PresetThumbnail preset={preset} />}
          <span className="w-full truncate">{t(PRESET_LABEL_KEYS[preset])}</span>
        </button>
      ))}
    </div>
  )
}

// ── Curve editor ────────────────────────────────────────────────────────────

const VIEW_W = 300
const VIEW_H = 170

export interface SpeedCurveEditorProps {
  clip: TimelineClip
  curve: SpeedCurve
  /** Called once per gesture, with the curve the user ended on. */
  onCommit: (curve: SpeedCurve) => void
}

/**
 * The speed graph: x runs along the footage, y is speed on a log scale from
 * 0.1x to 10x. Points drag up and down for speed and sideways between their
 * neighbours; the ends stay at the ends.
 *
 * A drag is held locally and committed on release, so one drag is one undo
 * step. The playhead line is moved by a rAF loop reading the store directly —
 * subscribing this panel to `currentTime` would re-render it every frame.
 */
export function SpeedCurveEditor({ clip, curve, onCommit }: SpeedCurveEditorProps) {
  const { t } = useTranslation()
  const { setCurrentTime } = useEditorActions()
  const getEditorState = useEditorGetState()
  const svgRef = useRef<SVGSVGElement>(null)
  const playheadRef = useRef<SVGLineElement>(null)
  const [draft, setDraft] = useState<SpeedCurve | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const shown = useMemo(() => normalizeSpeedCurve(draft ?? curve) ?? speedCurveForPreset('custom'), [draft, curve])
  const sourceSpan = clipSourceSpan(clip)
  const shownDuration = durationForSpeedCurve(sourceSpan, shown)
  const path = useMemo(() => curvePath(shown, VIEW_W, VIEW_H), [shown])

  // Forget the selection when the point it named no longer exists.
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= shown.points.length) setSelectedIndex(null)
  }, [selectedIndex, shown.points.length])

  // Playhead: where in the footage the clip is at the current time.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const line = playheadRef.current
      if (line) {
        const time = selectCurrentTime(getEditorState()) - clip.startTime
        const inside = time >= 0 && time <= clip.duration && sourceSpan > 0
        const x = inside ? sourceOffsetAtClipTime(clip, time) / sourceSpan : 0
        line.style.display = inside ? '' : 'none'
        line.setAttribute('x1', String(x * VIEW_W))
        line.setAttribute('x2', String(x * VIEW_W))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [clip, getEditorState, sourceSpan])

  const pointerFractions = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }

  const playheadX = () => {
    const time = selectCurrentTime(getEditorState()) - clip.startTime
    if (time < 0 || time > clip.duration || sourceSpan <= 0) return null
    return sourceOffsetAtClipTime(clip, time) / sourceSpan
  }

  const selected = selectedIndex !== null ? shown.points[selectedIndex] : null
  const canRemove = selectedIndex !== null && selectedIndex > 0 && selectedIndex < shown.points.length - 1
  const readout = dragIndex !== null ? shown.points[dragIndex] : selected

  return (
    <div className="space-y-2" data-speed-curve-editor>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300">{t('clipProperties.speedCurve.duration')}</span>
        <span className="tabular-nums text-zinc-400" data-speed-curve-duration>
          {sourceSpan.toFixed(1)}s <span className="text-zinc-600">→</span>{' '}
          <span className="text-white">{shownDuration.toFixed(1)}s</span>
        </span>
      </div>

      <div className="relative rounded-md border border-zinc-800 bg-[#111113]">
        <span className="pointer-events-none absolute left-1.5 top-1 text-[9px] text-zinc-500">10x</span>
        <span className="pointer-events-none absolute left-1.5 text-[9px] text-zinc-500" style={{ top: 'calc(50% - 12px)' }}>1x</span>
        <span className="pointer-events-none absolute bottom-1 left-1.5 text-[9px] text-zinc-500">0.1x</span>
        {readout && (
          <span className="pointer-events-none absolute right-1.5 top-1 rounded bg-zinc-800 px-1 text-[10px] tabular-nums text-yellow-300">
            {formatClipSpeed(readout.v)}
          </span>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="block h-[170px] w-full touch-none select-none"
          onPointerDown={event => {
            // A press on empty graph seeks there, like clicking the timeline.
            if (event.target !== event.currentTarget) return
            const at = pointerFractions(event.clientX, event.clientY)
            if (!at) return
            setSelectedIndex(null)
            setCurrentTime(clip.startTime + clipTimeAtSourceOffset(clip, at.x * sourceSpan))
          }}
        >
          <line x1="0" x2={VIEW_W} y1={yFractionForSpeed(1) * VIEW_H} y2={yFractionForSpeed(1) * VIEW_H} stroke="#52525b" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <line x1="0" x2={VIEW_W} y1={yFractionForSpeed(10) * VIEW_H + 0.5} y2={yFractionForSpeed(10) * VIEW_H + 0.5} stroke="#3f3f46" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <line x1="0" x2={VIEW_W} y1={yFractionForSpeed(0.1) * VIEW_H - 0.5} y2={yFractionForSpeed(0.1) * VIEW_H - 0.5} stroke="#3f3f46" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <path d={path} fill="none" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <line ref={playheadRef} y1="0" y2={VIEW_H} stroke="#ffffff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" style={{ display: 'none' }} />
        </svg>

        {/* Points sit in HTML over the graph so they stay round however the graph is stretched. */}
        {shown.points.map((point, index) => {
          const isEnd = index === 0 || index === shown.points.length - 1
          const active = index === selectedIndex || index === dragIndex
          return (
            <div
              key={index}
              role="slider"
              tabIndex={0}
              aria-label={`Speed point ${index + 1}`}
              aria-valuemin={MIN_CURVE_SPEED}
              aria-valuemax={MAX_CURVE_SPEED}
              aria-valuenow={point.v}
              data-speed-curve-point={index}
              className={`absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                active ? 'border-white bg-yellow-300' : 'border-zinc-200 bg-zinc-700'
              } ${isEnd ? 'cursor-ns-resize' : 'cursor-move'}`}
              style={{ left: `${point.x * 100}%`, top: `${yFractionForSpeed(point.v) * 100}%`, touchAction: 'none' }}
              onPointerDown={event => {
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                setSelectedIndex(index)
                setDragIndex(index)
                setDraft(shown)
              }}
              onPointerMove={event => {
                if (dragIndex !== index || !draft) return
                const at = pointerFractions(event.clientX, event.clientY)
                if (!at) return
                setDraft(moveSpeedCurvePoint(draft, index, at.x, roundSpeed(speedForYFraction(at.y))))
              }}
              onPointerUp={() => {
                if (dragIndex === index && draft) onCommit(draft)
                setDragIndex(null)
                setDraft(null)
              }}
              onKeyDown={event => {
                const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
                if (step === 0) return
                event.preventDefault()
                const nextV = roundSpeed(point.v * Math.pow(10, step * 0.05))
                onCommit(moveSpeedCurvePoint(shown, index, point.x, nextV))
              }}
            />
          )
        })}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-40"
          title={t('clipProperties.speedCurve.addPoint')}
          data-speed-curve-add
          onClick={() => {
            const x = playheadX() ?? 0.5
            const next = insertSpeedCurvePoint(shown, x)
            if (next.points.length === shown.points.length) return
            setSelectedIndex(next.points.findIndex(p => Math.abs(p.x - x) < 1e-9))
            onCommit(next)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-40"
          title={t('clipProperties.speedCurve.removePoint')}
          data-speed-curve-remove
          disabled={!canRemove}
          onClick={() => {
            if (!canRemove || selectedIndex === null) return
            setSelectedIndex(null)
            onCommit(removeSpeedCurvePoint(shown, selectedIndex))
          }}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 hover:text-white"
          data-speed-curve-reset
          onClick={() => {
            setSelectedIndex(null)
            onCommit(speedCurveForPreset(curve.preset))
          }}
        >
          {t('clipProperties.speedCurve.reset')}
        </button>
      </div>
    </div>
  )
}
