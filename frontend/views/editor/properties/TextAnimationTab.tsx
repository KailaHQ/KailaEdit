import { useEffect, useRef, useState } from 'react'
import { Ban } from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import {
  MIN_TEXT_ANIMATION_SECONDS,
  textAnimationSpan,
  textAnimationsForPhase,
  type TextAnimation,
  type TextAnimationPhase,
} from '@core/text-presets'
import { sampleKeyframeTrack } from '@core/keyframes'
import { useEditorActions } from '../editor-store'
import { PropertyNumberInput } from '../PropertyControls'

export interface TextAnimationTabProps {
  selectedClip: TimelineClip
}

const PHASES: { id: TextAnimationPhase; label: string }[] = [
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
  { id: 'loop', label: 'Loop' },
]

/** Seconds of the sample clip a tile plays its animation on. */
const SAMPLE_SECONDS = 2.4

/**
 * "ABC" that plays the animation while the pointer is over it, driven by the very tracks the
 * clip would get, so the tile shows exactly what applying it does.
 */
function AnimationSample({ animation, hovered }: { animation: TextAnimation; hovered: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rest = () => {
      el.style.transform = ''
      el.style.opacity = ''
      el.textContent = 'ABC'
    }
    if (!hovered) {
      rest()
      return
    }
    const tracks = animation.createTracks(SAMPLE_SECONDS)
    const track = (property: string) => tracks.find(t => t.property === property)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      // An entrance plays at the start of the sample and an exit at its end; hold each at
      // rest for a beat so the loop of the preview reads as one cycle.
      const t = ((now - start) / 1000) % (SAMPLE_SECONDS + 0.6)
      const at = Math.min(t, SAMPLE_SECONDS)
      const x = sampleKeyframeTrack(track('transform.positionX'), at, 0)
      const y = sampleKeyframeTrack(track('transform.positionY'), at, 0)
      const scale = sampleKeyframeTrack(track('transform.scale'), at, 100)
      const rotation = sampleKeyframeTrack(track('transform.rotation'), at, 0)
      const opacity = sampleKeyframeTrack(track('opacity'), at, 100)
      const progress = sampleKeyframeTrack(track('text.progress'), at, 100)
      // Offsets are percent of the frame; a tile is a small frame.
      el.style.transform = `translate(${x * 1.4}px, ${y * 1.4}px) scale(${scale / 100}) rotate(${rotation}deg)`
      el.style.opacity = String(Math.max(0, Math.min(1, opacity / 100)))
      el.textContent = 'ABC'.slice(0, Math.max(0, Math.ceil((3 * progress) / 100)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      rest()
    }
  }, [animation, hovered])

  return <span ref={ref} className="inline-block text-[13px] font-bold tracking-wide text-white will-change-transform">ABC</span>
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * One slider for both ends of the clip: the left handle is where the entrance finishes, the
 * right handle where the exit begins, so the distance from each edge is that animation's
 * length. The handles cannot cross. A drag is held locally and committed on release, so one
 * drag is one edit.
 */
function DurationRange({
  clipDuration, inSeconds, outSeconds, inEnabled, outEnabled, onCommit,
}: {
  clipDuration: number
  inSeconds: number
  outSeconds: number
  inEnabled: boolean
  outEnabled: boolean
  onCommit: (phase: 'in' | 'out', seconds: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ phase: 'in' | 'out'; seconds: number } | null>(null)
  const inValue = drag?.phase === 'in' ? drag.seconds : inSeconds
  const outValue = drag?.phase === 'out' ? drag.seconds : outSeconds

  const clampFor = (phase: 'in' | 'out', seconds: number) => {
    const other = phase === 'in' ? (outEnabled ? outValue : 0) : (inEnabled ? inValue : 0)
    return Math.max(MIN_TEXT_ANIMATION_SECONDS, Math.min(round1(seconds), round1(clipDuration - other)))
  }

  const secondsAt = (phase: 'in' | 'out', clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return phase === 'in' ? inValue : outValue
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return clampFor(phase, phase === 'in' ? fraction * clipDuration : (1 - fraction) * clipDuration)
  }

  const thumb = (phase: 'in' | 'out', enabled: boolean, left: number) => (
    <div
      role="slider"
      tabIndex={enabled ? 0 : -1}
      aria-label={phase === 'in' ? 'In duration' : 'Out duration'}
      aria-valuemin={MIN_TEXT_ANIMATION_SECONDS}
      aria-valuemax={round1(clipDuration)}
      aria-valuenow={phase === 'in' ? inValue : outValue}
      aria-disabled={!enabled}
      data-duration-thumb={phase}
      className={`absolute top-1/2 h-4 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border ${
        enabled ? 'cursor-ew-resize border-zinc-300 bg-white' : 'cursor-not-allowed border-zinc-600 bg-zinc-500'
      }`}
      style={{ left: `${left}%`, touchAction: 'none' }}
      onPointerDown={event => {
        if (!enabled) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({ phase, seconds: secondsAt(phase, event.clientX) })
      }}
      onPointerMove={event => {
        if (drag?.phase === phase) setDrag({ phase, seconds: secondsAt(phase, event.clientX) })
      }}
      onPointerUp={() => {
        if (drag?.phase === phase) onCommit(phase, drag.seconds)
        setDrag(null)
      }}
      onKeyDown={event => {
        if (!enabled) return
        const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (direction === 0) return
        event.preventDefault()
        // The out handle sits on the right, so moving it right shortens the exit.
        const delta = (phase === 'in' ? direction : -direction) * 0.1
        onCommit(phase, clampFor(phase, (phase === 'in' ? inValue : outValue) + delta))
      }}
    />
  )

  const inPercent = Math.min(100, (inValue / clipDuration) * 100)
  const outPercent = Math.min(100, (outValue / clipDuration) * 100)

  return (
    <div className="flex items-center gap-2">
      <span className="w-[52px] flex-shrink-0 text-xs text-zinc-300">Duration</span>
      <PropertyNumberInput
        value={inValue}
        min={MIN_TEXT_ANIMATION_SECONDS}
        max={round1(clipDuration)}
        step={0.1}
        precision={1}
        suffix="s"
        className={`w-[64px] ${inEnabled ? '' : 'pointer-events-none opacity-40'}`}
        onChange={seconds => onCommit('in', clampFor('in', seconds))}
      />
      <div ref={trackRef} data-duration-track className="relative mx-2 h-4 flex-1 select-none">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-zinc-700" />
        {inEnabled && <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-cyan-500" style={{ width: `${inPercent}%` }} />}
        {outEnabled && <div className="absolute right-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-cyan-500" style={{ width: `${outPercent}%` }} />}
        {thumb('in', inEnabled, inPercent)}
        {thumb('out', outEnabled, 100 - outPercent)}
      </div>
      <PropertyNumberInput
        value={outValue}
        min={MIN_TEXT_ANIMATION_SECONDS}
        max={round1(clipDuration)}
        step={0.1}
        precision={1}
        suffix="s"
        className={`w-[64px] ${outEnabled ? '' : 'pointer-events-none opacity-40'}`}
        onChange={seconds => onCommit('out', clampFor('out', seconds))}
      />
    </div>
  )
}

/**
 * The text clip's "Animation" tab: an entrance, an exit and a loop, each picked from its own
 * list, plus the named templates (a whole look plus size and font).
 */
export function TextAnimationTab({ selectedClip }: TextAnimationTabProps) {
  const { applyTextAnimationToClip, clearTextAnimationFromClip, setTextAnimationDurationOnClip, setCurrentTime, play, pause } = useEditorActions()
  const [phase, setPhase] = useState<TextAnimationPhase>('in')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const timersRef = useRef<number[]>([])

  const cancelAudition = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current = []
  }
  useEffect(() => cancelAudition, [])

  /**
   * Shows what a just-picked animation does: the playhead goes to where it happens and plays
   * for as long as the animation takes, then stops. An entrance and a loop start at the head
   * of the clip; an exit, which happens at its tail, starts half a second ahead of it.
   */
  const audition = (animation: TextAnimation, seconds?: number) => {
    cancelAudition()
    pause()
    const span = textAnimationSpan(animation.id, selectedClip.duration, seconds)
    const lead = animation.phase === 'out' ? 0.5 : 0
    const start = animation.phase === 'out'
      ? Math.max(selectedClip.startTime, selectedClip.startTime + selectedClip.duration - span - lead)
      : selectedClip.startTime
    const runFor = animation.phase === 'loop'
      ? Math.min(selectedClip.duration, span * 2)
      : Math.min(selectedClip.duration, span + lead + 0.4)
    setCurrentTime(start)
    // A beat for the monitor to settle on the new time before it starts to run.
    timersRef.current.push(window.setTimeout(() => {
      play()
      timersRef.current.push(window.setTimeout(pause, runFor * 1000))
    }, 80))
  }
  if (selectedClip.type !== 'text') return null

  const selection = selectedClip.textAnimation
  const chosen = selection?.[phase]
  const inSeconds = round1(textAnimationSpan(selection?.in, selectedClip.duration, selection?.inDuration) || 0.5)
  const outSeconds = round1(textAnimationSpan(selection?.out, selectedClip.duration, selection?.outDuration) || 0.5)
  const animations = textAnimationsForPhase(phase)
  const tile = 'flex h-[72px] flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-[#2a2a2e] px-1 text-center text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700'
  const ring = (active: boolean) => (active ? ' ring-2 ring-cyan-400 text-white' : '')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex rounded-md bg-[#232327] p-0.5" role="tablist">
          {PHASES.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={phase === entry.id}
              data-animation-phase={entry.id}
              onClick={() => setPhase(entry.id)}
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                phase === entry.id ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {entry.label}
              {selectedClip.textAnimation?.[entry.id] && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 align-middle" />}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            className={tile + ring(!chosen)}
            title="No animation"
            data-animation-id="none"
            onClick={() => {
              cancelAudition()
              clearTextAnimationFromClip(selectedClip.id, phase)
            }}
          >
            <Ban className="h-4 w-4 text-zinc-400" />
            <span>None</span>
          </button>
          {animations.map(animation => (
            <button
              key={animation.id}
              type="button"
              className={tile + ring(chosen === animation.id)}
              title={animation.description}
              data-animation-id={animation.id}
              onMouseEnter={() => setHoveredId(animation.id)}
              onMouseLeave={() => setHoveredId(current => (current === animation.id ? null : current))}
              onClick={() => {
                applyTextAnimationToClip(selectedClip.id, animation.id)
                audition(animation)
              }}
            >
              <AnimationSample animation={animation} hovered={hoveredId === animation.id} />
              <span className="w-full truncate">{animation.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-3">
        <DurationRange
          clipDuration={selectedClip.duration}
          inSeconds={inSeconds}
          outSeconds={outSeconds}
          inEnabled={Boolean(selection?.in)}
          outEnabled={Boolean(selection?.out)}
          onCommit={(which, seconds) => {
            setTextAnimationDurationOnClip(selectedClip.id, which, seconds)
            const id = which === 'in' ? selection?.in : selection?.out
            const animation = id ? textAnimationsForPhase(which).find(a => a.id === id) : undefined
            if (animation) audition(animation, seconds)
          }}
        />
      </div>
    </div>
  )
}
