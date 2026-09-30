/**
 * The transition catalogue: one definition per effect, shared by everything.
 *
 * A transition has to be drawn twice — once by the preview, in CSS over two
 * stacked DOM layers, and once by the exporter, as an ffmpeg `xfade`. When
 * those two lists are maintained separately they drift, and the drift is
 * invisible until someone exports and finds a different film than the one they
 * edited. So the catalogue is one table: an entry exists only if both sides can
 * render it, and each entry carries the name each side needs.
 *
 * That constraint is also why the browsable library shows no light leaks or
 * glitch effects: those need a shader preview, which is a separate piece of
 * work rather than a longer list here.
 */

export const transitionCategoryValues = ['basic', 'wipe', 'slide', 'shape', 'motion'] as const
export type TransitionCategory = (typeof transitionCategoryValues)[number]

export interface TransitionDefinition {
  id: string
  label: string
  category: TransitionCategory
  /**
   * `transition=` value for ffmpeg's xfade filter. Verified present in the
   * bundled ffmpeg-static build.
   */
  xfade: string
  /**
   * How the preview draws it. The renderer switches on this; the geometry
   * (direction, shape) comes from the id.
   */
  preview: 'opacity' | 'colour' | 'wipe' | 'slide' | 'shape' | 'scale' | 'squeeze' | 'blur'
}

export const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
  { id: 'dissolve',      label: 'Dissolve',        category: 'basic',  xfade: 'fade',        preview: 'opacity' },
  { id: 'fade-to-black', label: 'Fade to Black',   category: 'basic',  xfade: 'fadeblack',   preview: 'colour' },
  { id: 'fade-to-white', label: 'Fade to White',   category: 'basic',  xfade: 'fadewhite',   preview: 'colour' },

  { id: 'wipe-left',     label: 'Wipe Left',       category: 'wipe',   xfade: 'wipeleft',    preview: 'wipe' },
  { id: 'wipe-right',    label: 'Wipe Right',      category: 'wipe',   xfade: 'wiperight',   preview: 'wipe' },
  { id: 'wipe-up',       label: 'Wipe Up',         category: 'wipe',   xfade: 'wipeup',      preview: 'wipe' },
  { id: 'wipe-down',     label: 'Wipe Down',       category: 'wipe',   xfade: 'wipedown',    preview: 'wipe' },

  { id: 'slide-left',    label: 'Slide Left',      category: 'slide',  xfade: 'slideleft',   preview: 'slide' },
  { id: 'slide-right',   label: 'Slide Right',     category: 'slide',  xfade: 'slideright',  preview: 'slide' },
  { id: 'slide-up',      label: 'Slide Up',        category: 'slide',  xfade: 'slideup',     preview: 'slide' },
  { id: 'slide-down',    label: 'Slide Down',      category: 'slide',  xfade: 'slidedown',   preview: 'slide' },

  { id: 'circle-open',   label: 'Circle Open',     category: 'shape',  xfade: 'circleopen',  preview: 'shape' },
  { id: 'circle-close',  label: 'Circle Close',    category: 'shape',  xfade: 'circleclose', preview: 'shape' },
  { id: 'rect-crop',     label: 'Rectangle Crop',  category: 'shape',  xfade: 'rectcrop',    preview: 'shape' },

  { id: 'zoom-in',       label: 'Zoom In',         category: 'motion', xfade: 'zoomin',      preview: 'scale' },
  { id: 'squeeze-h',     label: 'Squeeze Horizontal', category: 'motion', xfade: 'squeezeh', preview: 'squeeze' },
  { id: 'squeeze-v',     label: 'Squeeze Vertical', category: 'motion', xfade: 'squeezev',   preview: 'squeeze' },

  { id: 'blur-dissolve', label: 'Blur Dissolve',   category: 'motion', xfade: 'hblur',       preview: 'blur' },
]

export const TRANSITION_IDS = TRANSITION_DEFINITIONS.map(definition => definition.id)

const BY_ID = new Map(TRANSITION_DEFINITIONS.map(definition => [definition.id, definition]))

export function getTransitionDefinition(id: string): TransitionDefinition | undefined {
  return BY_ID.get(id)
}

export function transitionsByCategory(category: TransitionCategory): TransitionDefinition[] {
  return TRANSITION_DEFINITIONS.filter(definition => definition.category === category)
}

/** Fallback duration when the caller does not name one, in seconds. */
export const DEFAULT_TRANSITION_DURATION = 0.5

/** Nothing shorter than this is worth a transition; below it, it reads as a glitch. */
export const MIN_TRANSITION_DURATION = 0.1

/**
 * How long a transition between these two clips may be.
 *
 * The transition model overlaps the two clips, so the overlap can never exceed either
 * of them — a transition longer than a clip would consume it whole. The extra
 * halving keeps at least half of each clip visible on its own, which is what
 * stops a short clip from becoming nothing but transition.
 */
export function maxTransitionDuration(leftDuration: number, rightDuration: number): number {
  return Math.max(0, Math.min(leftDuration, rightDuration) / 2)
}

/** Clamps a requested duration into what these two clips can actually give. */
export function clampTransitionDuration(
  requested: number,
  leftDuration: number,
  rightDuration: number,
): number {
  const max = maxTransitionDuration(leftDuration, rightDuration)
  if (max <= 0) return 0
  return Math.min(Math.max(requested, MIN_TRANSITION_DURATION), max)
}
