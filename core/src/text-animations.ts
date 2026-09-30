import type { KeyframeEasing, KeyframeProperty, KeyframeTrack, TimelineClip } from './project-model'

/**
 * Text animations: how a text clip comes in, goes out, or keeps moving while it is on screen.
 *
 * An animation is data — a few keyframe curves in the clip's own units — so the monitor, the
 * export and the keyframe editor all read the very same tracks. Only what every one of them
 * understands is used: position offsets (percent of the frame), scale (percent), rotation
 * (degrees), opacity (percent), and text progress for the typewriter.
 *
 * Every clip can carry one animation per phase (`clip.textAnimation`); the keyframes are
 * rebuilt from that choice, so picking an entrance never disturbs the exit or the loop.
 */

export type TextAnimationPhase = 'in' | 'out' | 'loop'

export interface TextAnimation {
  id: string
  name: string
  description: string
  phase: TextAnimationPhase
  /** This animation's tracks alone, for a clip this long. */
  createTracks: (clipDuration: number) => KeyframeTrack[]
}

export type AnimatedProperty = Extract<
  KeyframeProperty,
  'transform.positionX' | 'transform.positionY' | 'transform.scale' | 'transform.rotation' | 'opacity' | 'text.progress'
>

/** [where in the animation 0..1, value, how it eases toward the next point] */
type Pt = readonly [at: number, value: number | ((geometry: EdgeGeometry) => number), easing?: KeyframeEasing]

/**
 * How far, in percent of the frame, a text's centre must travel to sit just outside each edge.
 * A "fly in" that starts at a fixed offset begins somewhere inside the picture unless the text
 * happens to be at the middle; measuring against the text's own position and size makes it
 * begin - and, played backwards, end - at the very edge.
 */
export interface EdgeGeometry {
  left: number
  right: number
  top: number
  bottom: number
}

const centred = (): EdgeGeometry => ({ left: -60, right: 60, top: -60, bottom: 60 })

interface AnimationDef {
  id: string
  name: string
  description: string
  phase: TextAnimationPhase
  /** Seconds an entrance or exit takes; the length of one cycle for a loop. */
  span: number
  /** Overrides `span` for clips of a given length (the typewriter scales with the text's time). */
  spanFor?: (clipDuration: number) => number
  /**
   * Curves as they play FORWARD. An entrance ends at rest (0 offset, 100 scale/opacity) and an
   * exit starts there; a loop starts and ends there so cycles join without a seam.
   */
  props: Partial<Record<AnimatedProperty, readonly Pt[]>>
}

const REST: Record<AnimatedProperty, number> = {
  'transform.positionX': 0,
  'transform.positionY': 0,
  'transform.scale': 100,
  'transform.rotation': 0,
  opacity: 100,
  'text.progress': 100,
}

/** A loop is cut off after this many seconds / points so the export's expressions stay small. */
const MAX_LOOP_SECONDS = 30
const MAX_POINTS_PER_TRACK = 90

const round = (n: number) => Math.round(n * 1000) / 1000

/** The shortest an entrance or exit may be set to. */
export const MIN_TEXT_ANIMATION_SECONDS = 0.1

function spanOf(def: AnimationDef, clipDuration: number, override?: number): number {
  if (override !== undefined && override > 0 && def.phase !== 'loop') {
    return Math.max(MIN_TEXT_ANIMATION_SECONDS, Math.min(override, clipDuration))
  }
  const wanted = def.spanFor ? def.spanFor(clipDuration) : def.span
  // An entrance and an exit share the clip, so neither may take more than half of it.
  return def.phase === 'loop' ? wanted : Math.max(0.05, Math.min(wanted, clipDuration * 0.5))
}

/** The points of one property for one animation, in clip time. */
function pointsFor(def: AnimationDef, property: AnimatedProperty, clipDuration: number, geometry: EdgeGeometry, override?: number) {
  const declared = def.props[property]
  if (!declared) return []
  const curve = declared.map(([at, value, easing]): readonly [number, number, KeyframeEasing | undefined] =>
    [at, typeof value === 'function' ? round(value(geometry)) : value, easing])
  const span = spanOf(def, clipDuration, override)

  if (def.phase === 'in') {
    return curve.map(([at, value, easing]) => ({ t: round(at * span), value, easing: easing ?? 'linear' as KeyframeEasing }))
  }
  if (def.phase === 'out') {
    const start = clipDuration - span
    return curve.map(([at, value, easing]) => ({ t: round(start + at * span), value, easing: easing ?? 'linear' as KeyframeEasing }))
  }

  const points: { t: number; value: number; easing: KeyframeEasing }[] = []
  const cycles = Math.max(1, Math.min(
    Math.ceil(Math.min(clipDuration, MAX_LOOP_SECONDS) / span),
    Math.floor(MAX_POINTS_PER_TRACK / Math.max(1, curve.length - 1)),
  ))
  for (let c = 0; c < cycles; c++) {
    curve.forEach(([at, value, easing], i) => {
      // The last point of a cycle is the first of the next.
      if (c < cycles - 1 && i === curve.length - 1) return
      const t = round(c * span + at * span)
      if (t <= clipDuration) points.push({ t, value, easing: easing ?? 'linear' })
    })
  }
  return points
}

/** Which animation each phase of a clip is set to. */
export interface TextAnimationSelection {
  in?: string
  out?: string
  loop?: string
  /** Seconds the entrance / exit takes; the animation's own length when unset. */
  inDuration?: number
  outDuration?: number
}

/**
 * The tracks a selection produces. Where an entrance or an exit and a loop both move the same
 * property, the entrance/exit wins inside its own window and the loop carries on around it.
 */
export function composeTextAnimationTracks(
  selection: TextAnimationSelection,
  clipDuration: number,
  geometry: EdgeGeometry = centred(),
): KeyframeTrack[] {
  const phases = (['loop', 'in', 'out'] as const)
    .map(phase => ({ phase, def: selection[phase] ? DEFS_BY_ID.get(selection[phase]!) : undefined }))
    .filter((entry): entry is { phase: TextAnimationPhase; def: AnimationDef } => Boolean(entry.def && entry.def.phase === entry.phase))

  const properties = new Set<AnimatedProperty>()
  for (const { def } of phases) for (const property of Object.keys(def.props) as AnimatedProperty[]) properties.add(property)

  const tracks: KeyframeTrack[] = []
  for (const property of properties) {
    let points: { t: number; value: number; easing: KeyframeEasing }[] = []
    for (const { phase, def } of phases) {
      const override = phase === 'in' ? selection.inDuration : phase === 'out' ? selection.outDuration : undefined
      const own = pointsFor(def, property, clipDuration, geometry, override)
      if (own.length === 0) continue
      const span = spanOf(def, clipDuration, override)
      if (phase === 'loop') {
        points = own
      } else if (phase === 'in') {
        // Rest until the loop's next point arrives, then hand over to it.
        points = [...own, ...points.filter(p => p.t > span)]
      } else {
        points = [...points.filter(p => p.t < clipDuration - span), ...own]
      }
    }
    points.sort((a, b) => a.t - b.t)
    // A track holds its first and last value outside its points, which is exactly rest for
    // an entrance and an exit — but a lone exit must still start at rest.
    if (points.length > 0) tracks.push({ property, points })
  }
  return tracks
}

/** How long an animation takes on a clip this long, in seconds (one cycle for a loop); 0 if unknown. */
export function textAnimationSpan(id: string | undefined, clipDuration: number, override?: number): number {
  const def = id ? DEFS_BY_ID.get(id) : undefined
  return def ? spanOf(def, clipDuration, override) : 0
}

/** Properties an animation of this selection writes; used to clear only what it owns. */
export function textAnimationProperties(selection: TextAnimationSelection | undefined): Set<AnimatedProperty> {
  const properties = new Set<AnimatedProperty>()
  if (!selection) return properties
  for (const phase of ['in', 'out', 'loop'] as const) {
    const def = selection[phase] ? DEFS_BY_ID.get(selection[phase]!) : undefined
    if (def) for (const property of Object.keys(def.props) as AnimatedProperty[]) properties.add(property)
  }
  return properties
}

// ── Building the catalogue ──────────────────────────────────────────────────

const FADE_IN: readonly Pt[] = [[0, 0, 'ease-out'], [0.6, 100]]

const fromLeft = (g: EdgeGeometry) => g.left
const fromRight = (g: EdgeGeometry) => g.right
const fromTop = (g: EdgeGeometry) => g.top
const fromBottom = (g: EdgeGeometry) => g.bottom

/** The exit that plays an entrance's curves backwards. */
function mirrored(curve: readonly Pt[]): Pt[] {
  const flip = (easing?: KeyframeEasing): KeyframeEasing =>
    easing === 'ease-in' ? 'ease-out' : easing === 'ease-out' ? 'ease-in' : easing ?? 'linear'
  const n = curve.length
  return curve.map((_, k) => {
    const source = curve[n - 1 - k]
    const easing = k < n - 1 ? flip(curve[n - 2 - k][2]) : 'linear'
    return [round(1 - source[0]), source[1], easing] as Pt
  })
}

const ENTRANCES: AnimationDef[] = [
  // The original five keep their ids.
  { id: 'fade-in', name: 'Fade In', description: 'Smooth fade in', phase: 'in', span: 0.6,
    props: { opacity: [[0, 0, 'ease-out'], [1, 100]] } },
  { id: 'fly-in', name: 'Fly In', description: 'Flies in from the bottom edge to its place', phase: 'in', span: 0.6,
    props: { 'transform.positionY': [[0, fromBottom, 'ease-out'], [1, 0]] } },
  { id: 'slide-in', name: 'Slide from Left', description: 'Slides in smoothly from beyond the left edge', phase: 'in', span: 0.5,
    props: { 'transform.positionX': [[0, fromLeft, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'pop', name: 'Pop (Bounce In)', description: 'Pops in from the centre with a subtle bounce', phase: 'in', span: 0.5,
    props: { 'transform.scale': [[0, 0, 'ease-out'], [0.7, 120, 'ease-in-out'], [1, 100]], opacity: [[0, 0], [0.3, 100]] } },
  { id: 'typewriter', name: 'Typewriter', description: 'Types the text out character by character', phase: 'in', span: 1,
    spanFor: d => Math.min(1.5, Math.max(0.6, d * 0.65)),
    props: { 'text.progress': [[0, 0], [1, 100]] } },

  { id: 'slide-in-right', name: 'Slide from Right', description: 'Slides in from the right', phase: 'in', span: 0.5,
    props: { 'transform.positionX': [[0, fromRight, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'slide-in-up', name: 'Slide from Bottom', description: 'Slides up from below', phase: 'in', span: 0.5,
    props: { 'transform.positionY': [[0, fromBottom, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'slide-in-down', name: 'Slide from Top', description: 'Slides down from above', phase: 'in', span: 0.5,
    props: { 'transform.positionY': [[0, fromTop, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'fly-in-top', name: 'Fly from Top', description: 'Flies in from the top edge', phase: 'in', span: 0.6,
    props: { 'transform.positionY': [[0, fromTop, 'ease-out'], [1, 0]] } },
  { id: 'fly-in-left', name: 'Fly from Left', description: 'Flies in from the left edge', phase: 'in', span: 0.6,
    props: { 'transform.positionX': [[0, fromLeft, 'ease-out'], [1, 0]] } },
  { id: 'fly-in-right', name: 'Fly from Right', description: 'Flies in from the right edge', phase: 'in', span: 0.6,
    props: { 'transform.positionX': [[0, fromRight, 'ease-out'], [1, 0]] } },
  { id: 'whip-left', name: 'Whip Left', description: 'A fast whip in from the left', phase: 'in', span: 0.3,
    props: { 'transform.positionX': [[0, fromLeft, 'ease-out'], [1, 0]] } },
  { id: 'whip-right', name: 'Whip Right', description: 'A fast whip in from the right', phase: 'in', span: 0.3,
    props: { 'transform.positionX': [[0, fromRight, 'ease-out'], [1, 0]] } },
  { id: 'zoom-in', name: 'Zoom In', description: 'Grows from nothing to full size', phase: 'in', span: 0.5,
    props: { 'transform.scale': [[0, 0, 'ease-out'], [1, 100]], opacity: [[0, 0], [0.4, 100]] } },
  { id: 'zoom-out', name: 'Zoom Out', description: 'Shrinks in from a huge size', phase: 'in', span: 0.6,
    props: { 'transform.scale': [[0, 220, 'ease-out'], [1, 100]], opacity: [[0, 0], [0.5, 100]] } },
  { id: 'grow', name: 'Grow', description: 'A slow, gentle grow with a fade', phase: 'in', span: 0.9,
    props: { 'transform.scale': [[0, 70, 'ease-out'], [1, 100]], opacity: [[0, 0, 'ease-out'], [0.7, 100]] } },
  { id: 'focus-in', name: 'Focus In', description: 'Settles from slightly large, like a lens pulling focus', phase: 'in', span: 0.8,
    props: { 'transform.scale': [[0, 115, 'ease-out'], [1, 100]], opacity: [[0, 0, 'ease-out'], [0.8, 100]] } },
  { id: 'stomp', name: 'Stomp', description: 'Slams down from a huge size', phase: 'in', span: 0.5,
    props: { 'transform.scale': [[0, 300, 'ease-in'], [0.6, 92, 'ease-out'], [1, 100]], opacity: [[0, 0], [0.3, 100]] } },
  { id: 'elastic-pop', name: 'Elastic Pop', description: 'Overshoots and springs back into place', phase: 'in', span: 0.8,
    props: {
      'transform.scale': [[0, 0, 'ease-out'], [0.45, 130, 'ease-in-out'], [0.7, 90, 'ease-in-out'], [0.88, 106, 'ease-in-out'], [1, 100]],
      opacity: [[0, 0], [0.15, 100]],
    } },
  { id: 'bounce-drop', name: 'Bounce Drop', description: 'Drops from above and bounces to a stop', phase: 'in', span: 0.9,
    props: {
      'transform.positionY': [[0, fromTop, 'ease-in'], [0.5, 0, 'ease-out'], [0.68, -8, 'ease-in'], [0.84, 0, 'ease-out'], [0.92, -2, 'ease-in'], [1, 0]],
    } },
  { id: 'drop-in', name: 'Drop In', description: 'Drops in from above and settles', phase: 'in', span: 0.5,
    props: { 'transform.positionY': [[0, fromTop, 'ease-in'], [1, 0]] } },
  { id: 'rise-up', name: 'Rise Up', description: 'Drifts gently upward as it fades in', phase: 'in', span: 1,
    props: { 'transform.positionY': [[0, 12, 'ease-out'], [1, 0]], opacity: [[0, 0, 'ease-out'], [0.8, 100]] } },
  { id: 'spin-in', name: 'Spin In', description: 'Spins and grows into place', phase: 'in', span: 0.7,
    props: { 'transform.rotation': [[0, -360, 'ease-out'], [1, 0]], 'transform.scale': [[0, 0, 'ease-out'], [1, 100]], opacity: [[0, 0], [0.4, 100]] } },
  { id: 'twist-in', name: 'Twist In', description: 'A quarter twist into place', phase: 'in', span: 0.6,
    props: { 'transform.rotation': [[0, -90, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'tilt-in', name: 'Tilt In', description: 'Straightens up from a slight tilt', phase: 'in', span: 0.6,
    props: { 'transform.rotation': [[0, -12, 'ease-out'], [1, 0]], 'transform.positionY': [[0, 8, 'ease-out'], [1, 0]], opacity: FADE_IN } },
  { id: 'swing-in', name: 'Swing In', description: 'Swings in and settles like a hanging sign', phase: 'in', span: 0.9,
    props: { 'transform.rotation': [[0, 45, 'ease-out'], [0.4, -18, 'ease-in-out'], [0.7, 8, 'ease-in-out'], [1, 0]], opacity: [[0, 0], [0.3, 100]] } },
  { id: 'swoop', name: 'Swoop', description: 'Sweeps in diagonally from the lower left', phase: 'in', span: 0.7,
    props: {
      'transform.positionX': [[0, fromLeft, 'ease-out'], [1, 0]],
      'transform.positionY': [[0, fromBottom, 'ease-out'], [1, 0]],
      'transform.rotation': [[0, -15, 'ease-out'], [1, 0]],
    } },
  { id: 'shake-in', name: 'Shake In', description: 'Arrives with a quick shake', phase: 'in', span: 0.6,
    props: {
      'transform.positionX': [[0, -3], [0.15, 3], [0.3, -2.5], [0.45, 2], [0.6, -1], [0.8, 0.5], [1, 0]],
      opacity: [[0, 0], [0.1, 100]],
    } },
  { id: 'glitch-in', name: 'Glitch In', description: 'Stutters in like a broken signal', phase: 'in', span: 0.5,
    props: {
      'transform.positionX': [[0, 0, 'hold'], [0.1, -3, 'hold'], [0.2, 4, 'hold'], [0.3, -2, 'hold'], [0.4, 2, 'hold'], [0.5, 0, 'hold'], [1, 0]],
      opacity: [[0, 0, 'hold'], [0.1, 100, 'hold'], [0.2, 20, 'hold'], [0.3, 100, 'hold'], [0.4, 40, 'hold'], [0.5, 100], [1, 100]],
    } },
  { id: 'flicker-in', name: 'Flicker In', description: 'Flickers on like a neon sign', phase: 'in', span: 0.7,
    props: {
      opacity: [[0, 0, 'hold'], [0.1, 100, 'hold'], [0.2, 10, 'hold'], [0.3, 100, 'hold'], [0.4, 30, 'hold'], [0.5, 100, 'hold'], [0.6, 60, 'hold'], [0.7, 100], [1, 100]],
    } },
]

/** [entrance id, exit id, name, description] — an exit is its entrance played backwards. */
const EXIT_NAMES: [string, string, string, string][] = [
  ['fade-in', 'fade-out', 'Fade Out', 'Smooth fade out'],
  ['fly-in', 'fly-out', 'Fly to Bottom', 'Flies out through the bottom'],
  ['slide-in', 'slide-out', 'Slide to Left', 'Slides out to the left'],
  ['pop', 'pop-out', 'Pop Out', 'Swells slightly, then vanishes'],
  ['slide-in-right', 'slide-out-right', 'Slide to Right', 'Slides out to the right'],
  ['slide-in-up', 'slide-out-down', 'Slide to Bottom', 'Slides down and out'],
  ['slide-in-down', 'slide-out-up', 'Slide to Top', 'Slides up and out'],
  ['fly-in-top', 'fly-out-top', 'Fly to Top', 'Flies out through the top'],
  ['fly-in-left', 'fly-out-left', 'Fly to Left', 'Flies out through the left edge'],
  ['fly-in-right', 'fly-out-right', 'Fly to Right', 'Flies out through the right edge'],
  ['whip-left', 'whip-out-left', 'Whip to Left', 'A fast whip out to the left'],
  ['whip-right', 'whip-out-right', 'Whip to Right', 'A fast whip out to the right'],
  ['zoom-in', 'zoom-shrink-out', 'Shrink Out', 'Shrinks away to nothing'],
  ['zoom-out', 'zoom-blast-out', 'Blast Out', 'Blows up past the screen and fades'],
  ['grow', 'shrink-out', 'Shrink', 'A slow shrink with a fade'],
  ['focus-in', 'focus-out', 'Focus Out', 'Swells slightly as it fades'],
  ['stomp', 'stomp-out', 'Stomp Out', 'Crashes back up and away'],
  ['elastic-pop', 'elastic-out', 'Elastic Out', 'Springs and collapses'],
  ['bounce-drop', 'bounce-out', 'Bounce Out', 'Hops and is gone'],
  ['drop-in', 'drop-out', 'Drop Out', 'Falls away'],
  ['rise-up', 'rise-out', 'Rise Out', 'Floats upward and fades'],
  ['spin-in', 'spin-out', 'Spin Out', 'Spins and shrinks away'],
  ['twist-in', 'twist-out', 'Twist Out', 'A quarter twist away'],
  ['tilt-in', 'tilt-out', 'Tilt Out', 'Tilts and fades'],
  ['swing-in', 'swing-out', 'Swing Out', 'Swings and falls away'],
  ['swoop', 'swoop-out', 'Swoop Out', 'Sweeps off to the lower left'],
  ['shake-in', 'shake-out', 'Shake Out', 'Shakes and vanishes'],
  ['glitch-in', 'glitch-out', 'Glitch Out', 'Breaks up and cuts out'],
  ['flicker-in', 'flicker-out', 'Flicker Out', 'Flickers off like a neon sign'],
]

const EXITS: AnimationDef[] = EXIT_NAMES.map(([inId, outId, name, description]) => {
  const source = ENTRANCES.find(def => def.id === inId)!
  const props: AnimationDef['props'] = {}
  for (const property of Object.keys(source.props) as AnimatedProperty[]) {
    props[property] = mirrored(source.props[property]!)
  }
  return { id: outId, name, description, phase: 'out' as const, span: source.span, props }
})

const LOOPS: AnimationDef[] = [
  { id: 'pulse', name: 'Pulse', description: 'A steady swell', phase: 'loop', span: 1,
    props: { 'transform.scale': [[0, 100, 'ease-in-out'], [0.5, 108, 'ease-in-out'], [1, 100]] } },
  { id: 'heartbeat', name: 'Heartbeat', description: 'Two quick beats, then a rest', phase: 'loop', span: 1.2,
    props: { 'transform.scale': [[0, 100, 'ease-out'], [0.15, 112, 'ease-in-out'], [0.3, 100, 'ease-out'], [0.45, 108, 'ease-in-out'], [0.6, 100], [1, 100]] } },
  { id: 'breathe', name: 'Breathe', description: 'Slowly swells and dims', phase: 'loop', span: 2.4,
    props: { 'transform.scale': [[0, 100, 'ease-in-out'], [0.5, 104, 'ease-in-out'], [1, 100]], opacity: [[0, 100, 'ease-in-out'], [0.5, 80, 'ease-in-out'], [1, 100]] } },
  { id: 'float', name: 'Float', description: 'Drifts gently up and down', phase: 'loop', span: 2.4,
    props: { 'transform.positionY': [[0, 0, 'ease-in-out'], [0.5, -2.5, 'ease-in-out'], [1, 0]] } },
  { id: 'sway', name: 'Sway', description: 'Drifts gently side to side', phase: 'loop', span: 2.4,
    props: { 'transform.positionX': [[0, 0, 'ease-in-out'], [0.25, 3, 'ease-in-out'], [0.75, -3, 'ease-in-out'], [1, 0]] } },
  { id: 'wobble', name: 'Wobble', description: 'A small rocking tilt', phase: 'loop', span: 1.2,
    props: { 'transform.rotation': [[0, 0, 'ease-in-out'], [0.25, 4, 'ease-in-out'], [0.75, -4, 'ease-in-out'], [1, 0]] } },
  { id: 'swing-loop', name: 'Swing', description: 'Swings like a pendulum', phase: 'loop', span: 2,
    props: { 'transform.rotation': [[0, 0, 'ease-in-out'], [0.25, 12, 'ease-in-out'], [0.75, -12, 'ease-in-out'], [1, 0]] } },
  { id: 'shake-loop', name: 'Shake', description: 'A fast, tight shake', phase: 'loop', span: 0.4,
    props: { 'transform.positionX': [[0, 0], [0.25, 1.2], [0.5, -1.2], [0.75, 1.2], [1, 0]] } },
  { id: 'jitter', name: 'Jitter', description: 'Nervous little jumps', phase: 'loop', span: 0.5,
    props: {
      'transform.positionX': [[0, 0, 'hold'], [0.2, 0.8, 'hold'], [0.4, -0.6, 'hold'], [0.6, 0.4, 'hold'], [0.8, -0.8, 'hold'], [1, 0]],
      'transform.positionY': [[0, 0, 'hold'], [0.2, -0.5, 'hold'], [0.4, 0.7, 'hold'], [0.6, -0.4, 'hold'], [0.8, 0.5, 'hold'], [1, 0]],
    } },
  { id: 'bounce-loop', name: 'Bounce', description: 'Hops up and down', phase: 'loop', span: 0.8,
    props: { 'transform.positionY': [[0, 0, 'ease-out'], [0.5, -5, 'ease-in'], [1, 0]] } },
  { id: 'flash', name: 'Flash', description: 'Fades down and back up', phase: 'loop', span: 1,
    props: { opacity: [[0, 100, 'ease-in-out'], [0.5, 25, 'ease-in-out'], [1, 100]] } },
  { id: 'blink', name: 'Blink', description: 'Hard on and off', phase: 'loop', span: 1,
    props: { opacity: [[0, 100, 'hold'], [0.5, 0, 'hold'], [1, 100]] } },
  { id: 'spin', name: 'Spin', description: 'A slow continuous turn', phase: 'loop', span: 3,
    props: { 'transform.rotation': [[0, 0], [1, 360]] } },
]

/** Every animation, entrances first, then exits, then loops. */
const ALL_DEFS: AnimationDef[] = [...ENTRANCES, ...EXITS, ...LOOPS]
const DEFS_BY_ID = new Map(ALL_DEFS.map(def => [def.id, def]))

export const TEXT_ANIMATIONS: TextAnimation[] = ALL_DEFS.map(def => ({
  id: def.id,
  name: def.name,
  description: def.description,
  phase: def.phase,
  createTracks: (clipDuration: number) => composeTextAnimationTracks({ [def.phase]: def.id }, clipDuration),
}))

export function getTextAnimation(id: string): TextAnimation | undefined {
  return TEXT_ANIMATIONS.find(a => a.id === id)
}

export function textAnimationsForPhase(phase: TextAnimationPhase): TextAnimation[] {
  return TEXT_ANIMATIONS.filter(a => a.phase === phase)
}

const ANIMATED_PROPERTIES = new Set<KeyframeProperty>(Object.keys(REST) as AnimatedProperty[])

const DEFAULT_ASPECT = 16 / 9
const AVERAGE_GLYPH_WIDTH = 0.6

/** Where the clip's text sits and roughly how big it is - what the edge-based flights measure against. */
export function edgeGeometryFor(clip: TimelineClip, aspect = DEFAULT_ASPECT): EdgeGeometry {
  const style = clip.textStyle
  if (!style) return centred()
  const lines = (style.text || 'Text').split('\n')
  const padding = style.padding > 0 ? style.padding : 8
  const longest = Math.max(1, ...lines.map(line => line.length))
  const maxWidthPx = ((style.maxWidth > 0 ? style.maxWidth : 80) / 100) * 1080 * aspect
  const naturalPx = longest * style.fontSize * AVERAGE_GLYPH_WIDTH
  const widthPx = Math.min(maxWidthPx, naturalPx + 2 * padding)
  const wrapped = Math.max(lines.length, Math.ceil(naturalPx / Math.max(1, maxWidthPx)))
  const heightPx = wrapped * style.fontSize * (style.lineHeight || 1.2) + 2 * padding
  // Half the box, as a share of the frame, plus a little so no edge of it is left showing.
  const halfW = (widthPx / 2 / (1080 * aspect)) * 100 + 2
  const halfH = (heightPx / 2 / 1080) * 100 + 2
  const x = style.positionX
  const y = style.positionY
  return { left: round(-(x + halfW)), right: round(100 - x + halfW), top: round(-(y + halfH)), bottom: round(100 - y + halfH) }
}

/** What the clip's animation was built from; when it changes the tracks are rebuilt. */
function stampFor(clip: TimelineClip, aspect: number, selection?: TextAnimationSelection): string {
  const s = clip.textStyle
  return [
    round(clip.duration), round(aspect), selection?.inDuration, selection?.outDuration, s?.positionX, s?.positionY, s?.fontSize, s?.lineHeight,
    s?.padding, s?.maxWidth, s?.text,
  ].join('|')
}

/** Puts `selection` on the clip: regenerates the tracks it owns and leaves every other keyframe alone. */
export function withTextAnimation(clip: TimelineClip, selection: TextAnimationSelection, aspect = DEFAULT_ASPECT): TimelineClip {
  const owned = new Set<KeyframeProperty>([
    ...textAnimationProperties(clip.textAnimation),
    ...textAnimationProperties(selection),
  ])
  const kept = (clip.keyframes ?? []).filter(track => !owned.has(track.property))
  const generated = composeTextAnimationTracks(selection, clip.duration, edgeGeometryFor(clip, aspect))
  const keyframes = [...kept, ...generated]
  const chosen = selection.in || selection.out || selection.loop
  return {
    ...clip,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    textAnimation: chosen ? { ...selection, stamp: stampFor(clip, aspect, selection) } : undefined,
  }
}

/**
 * Rebuilds the animation of any text clip whose length, position, size or words changed since
 * its keyframes were made, so an exit stays at the clip's end after a trim and a flight still
 * starts at the frame's edge after the text is moved. Returns the same
 * array when nothing needs it.
 */
export function refitTextAnimations(clips: TimelineClip[], aspect = DEFAULT_ASPECT): TimelineClip[] {
  let changed = false
  const next = clips.map(clip => {
    const chosen = clip.textAnimation
    if (!chosen || clip.type !== 'text') return clip
    const { stamp: built, ...selection } = chosen
    if (built === stampFor(clip, aspect, selection)) return clip
    changed = true
    return withTextAnimation(clip, selection, aspect)
  })
  return changed ? next : clips
}

/** Sets how long the entrance or the exit takes; the animation is rebuilt to fit. */
export function setTextAnimationDuration(
  clip: TimelineClip,
  phase: 'in' | 'out',
  seconds: number,
  aspect = DEFAULT_ASPECT,
): TimelineClip {
  const { stamp: _built, ...current } = clip.textAnimation ?? {}
  const key = phase === 'in' ? 'inDuration' : 'outDuration'
  const clamped = Math.max(MIN_TEXT_ANIMATION_SECONDS, Math.min(seconds, clip.duration))
  return withTextAnimation(clip, { ...current, [key]: Math.round(clamped * 100) / 100 }, aspect)
}

/** Sets one phase's animation (or clears it with `undefined`), keeping the other phases. */
export function setTextAnimationPhase(clip: TimelineClip, phase: TextAnimationPhase, id: string | undefined, aspect = DEFAULT_ASPECT): TimelineClip {
  const { stamp: _built, ...current } = clip.textAnimation ?? {}
  const next: TextAnimationSelection = { ...current, [phase]: id }
  if (!id) delete next[phase]
  return withTextAnimation(clip, next, aspect)
}

export { ANIMATED_PROPERTIES }
