import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_TEXT_STYLE,
  type TimelineClip,
  type Track,
} from './project-model'
import {
  TEMPLATE_FORMAT_VERSION,
  komfyTemplateSchema,
  type KomfyTemplate,
  type TemplateSlot,
} from './template-model'

/* ────────────────────────────────────────────────────────────────
   The templates that ship with the app.

   Public online libraries are full because thousands of people publish into them.
   This offline library cannot be, so these exist to answer a narrower question:
   what does a template DO? A first-run library of zero teaches nothing, and "save
   your edit as a template" is hard to picture until you have taken one apart.

   Two deliberate limits:

   1. **No media.** Nothing here ships a music bed. Audio that could be shipped
      is either licensed or silence, and an app that quietly bundles neither is
      better than one that bundles the wrong one. What is left — the cut
      rhythm, the framing moves, the titles, the transitions — is the part that
      is actually hard to rebuild by hand.
   2. **Built in code, not files.** A folder of JSON shipped beside the app has
      to be found again at runtime, and that path differs between a dev run and
      a packaged build; it has been a source of bugs elsewhere in this repo.
      These are constructed here and validated by the schema at import, so a
      malformed one fails the test run rather than a user's first launch.

   They are read-only. Applying one and saving the result is how a user makes
   it theirs.
   ──────────────────────────────────────────────────────────────── */

const VERTICAL = { width: 1080, height: 1920 }
const HORIZONTAL = { width: 1920, height: 1080 }

/** Tracks every built-in uses: captions first, because that is how a captioned project looks. */
function tracks(extraVideo = 0): Track[] {
  const base: Track[] = [
    { id: 'bt-track-sub', name: 'Subtitles', muted: false, locked: false, kind: 'video', type: 'subtitle' },
    { id: 'bt-track-v1', name: 'V1', muted: false, locked: false, kind: 'video', type: 'default' },
  ]
  for (let i = 0; i < extraVideo; i += 1) {
    base.push({
      id: `bt-track-v${i + 2}`, name: `V${i + 2}`,
      muted: false, locked: false, kind: 'video', type: 'default',
    })
  }
  return base
}

/** A footage clip: the hole a slot stands for. */
function shot(params: {
  id: string
  startTime: number
  duration: number
  trackIndex?: number
  transitionIn?: { type: string; duration: number }
  transitionOut?: { type: string; duration: number }
  keyframes?: TimelineClip['keyframes']
  transform?: Partial<TimelineClip['transform']>
}): TimelineClip {
  return {
    id: params.id,
    assetId: null,
    type: 'video',
    startTime: params.startTime,
    duration: params.duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex: params.trackIndex ?? 1,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: params.transitionIn ?? DEFAULT_CLIP_TRANSITION,
    transitionOut: params.transitionOut ?? DEFAULT_CLIP_TRANSITION,
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM, ...params.transform },
    opacity: 100,
    ...(params.keyframes ? { keyframes: params.keyframes } : {}),
  } as TimelineClip
}

/** A title card. Not a slot — this is the part of the template that IS the template. */
function title(params: {
  id: string
  startTime: number
  duration: number
  text: string
  trackIndex: number
  fontSize?: number
  positionY?: number
  color?: string
}): TimelineClip {
  return {
    id: params.id,
    assetId: null,
    type: 'text',
    startTime: params.startTime,
    duration: params.duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex: params.trackIndex,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: DEFAULT_CLIP_TRANSITION,
    transitionOut: DEFAULT_CLIP_TRANSITION,
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    opacity: 100,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text: params.text,
      fontSize: params.fontSize ?? 84,
      fontWeight: 'bold',
      color: params.color ?? '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 8,
      positionY: params.positionY ?? 50,
      textAlign: 'center',
    },
  } as TimelineClip
}

/**
 * A slow push in across the whole clip.
 *
 * Keyframes are clip-local seconds, so this survives the slot being filled with
 * different footage — the one property that makes template animation possible
 * at all.
 */
function punchIn(duration: number, from = 100, to = 118): TimelineClip['keyframes'] {
  return [{
    property: 'transform.scale',
    points: [
      { t: 0, value: from, easing: 'ease-out' },
      { t: Number(duration.toFixed(3)), value: to, easing: 'ease-out' },
    ],
  }]
}

function slotsFor(clips: TimelineClip[], labels: string[]): TemplateSlot[] {
  return clips.map((clip, index) => ({
    slotIndex: index + 1,
    clipId: clip.id,
    duration: clip.duration,
    kind: 'any' as const,
    label: labels[index] ?? '',
  }))
}

function build(params: {
  id: string
  name: string
  category: string
  frame: { width: number; height: number }
  fps?: number
  slotClips: TimelineClip[]
  labels: string[]
  extraClips?: TimelineClip[]
  extraVideoTracks?: number
  transitions?: Array<{
    id: string; trackIndex: number; leftClipId: string; rightClipId: string
    type: string; duration: number
  }>
}): KomfyTemplate {
  const clips = [...params.slotClips, ...(params.extraClips ?? [])]
  const durationSec = clips.reduce((longest, c) => Math.max(longest, c.startTime + c.duration), 0)

  // Parsed, not merely cast: the schema fills in every default and a malformed
  // built-in fails here, in a test run, rather than on somebody's first launch.
  return komfyTemplateSchema.parse({
    format: TEMPLATE_FORMAT_VERSION,
    id: params.id,
    name: params.name,
    category: params.category,
    createdAt: 0,
    width: params.frame.width,
    height: params.frame.height,
    fps: params.fps ?? 30,
    durationSec: Number(durationSec.toFixed(3)),
    slots: slotsFor(params.slotClips, params.labels),
    bundledMedia: [],
    timeline: {
      id: `builtin-${params.id}`,
      name: params.name,
      createdAt: 0,
      tracks: tracks(params.extraVideoTracks ?? 0),
      clips,
      subtitles: [],
      ...(params.transitions ? { transitions: params.transitions } : {}),
      width: params.frame.width,
      height: params.frame.height,
      fps: params.fps ?? 30,
    },
  })
}

/* ── The templates ───────────────────────────────────────────── */

/**
 * Three shots, a hook card over the first, and a push in on each.
 *
 * The shape most short-form video actually uses: say the promise in the first
 * three seconds, then show two things that back it up.
 */
const hookThreeShots = build({
  id: 'builtin-hook-3',
  category: 'opener',  name: 'Hook 3 giây · 3 cảnh',
  frame: VERTICAL,
  slotClips: [
    shot({ id: 'bt-h3-1', startTime: 0, duration: 3, keyframes: punchIn(3, 100, 112) }),
    shot({
      id: 'bt-h3-2', startTime: 3, duration: 4,
      transitionIn: { type: 'dissolve', duration: 0.3 },
      keyframes: punchIn(4, 108, 100),
    }),
    shot({
      id: 'bt-h3-3', startTime: 7, duration: 4,
      transitionIn: { type: 'dissolve', duration: 0.3 },
      keyframes: punchIn(4, 100, 110),
    }),
  ],
  labels: ['Cảnh mở đầu (hook)', 'Cảnh triển khai', 'Cảnh chốt'],
  extraClips: [
    title({ id: 'bt-h3-title', startTime: 0, duration: 3, text: 'ĐẶT CÂU HOOK Ở ĐÂY', trackIndex: 2, positionY: 30 }),
    title({ id: 'bt-h3-cta', startTime: 8.5, duration: 2.5, text: 'Theo dõi để xem tiếp', trackIndex: 2, fontSize: 56, positionY: 80 }),
  ],
  extraVideoTracks: 1,
  transitions: [
    { id: 'bt-h3-tr1', trackIndex: 1, leftClipId: 'bt-h3-1', rightClipId: 'bt-h3-2', type: 'dissolve', duration: 0.3 },
    { id: 'bt-h3-tr2', trackIndex: 1, leftClipId: 'bt-h3-2', rightClipId: 'bt-h3-3', type: 'dissolve', duration: 0.3 },
  ],
})

/**
 * Six short shots in a row, no transitions.
 *
 * Hard cuts on a steady beat. Deliberately short slots — a montage is about
 * rhythm, and anything longer than a second and a half stops feeling like one.
 */
const fastMontage = build({
  id: 'builtin-montage-6',
  category: 'montage',  name: 'Montage nhanh · 6 cảnh',
  frame: VERTICAL,
  slotClips: Array.from({ length: 6 }, (_, index) =>
    shot({
      id: `bt-m6-${index + 1}`,
      startTime: Number((index * 1.2).toFixed(2)),
      duration: 1.2,
      // Alternating push in and pull back, so consecutive cuts do not feel flat.
      keyframes: index % 2 === 0 ? punchIn(1.2, 100, 115) : punchIn(1.2, 115, 100),
    }),
  ),
  labels: ['Cảnh 1', 'Cảnh 2', 'Cảnh 3', 'Cảnh 4', 'Cảnh 5', 'Cảnh 6'],
})

/**
 * Two shots stacked, each filling half the frame, with a label on each.
 *
 * The one built-in that needs a second video track: "before" sits on top of
 * "after" and each is pushed to its own half.
 */
const beforeAfter = build({
  id: 'builtin-before-after',
  category: 'compare',  name: 'Trước / Sau',
  frame: VERTICAL,
  slotClips: [
    shot({
      id: 'bt-ba-before', startTime: 0, duration: 5, trackIndex: 1,
      transform: { scale: 100, positionY: -25 },
    }),
    shot({
      id: 'bt-ba-after', startTime: 0, duration: 5, trackIndex: 2,
      transform: { scale: 100, positionY: 25 },
    }),
  ],
  labels: ['Cảnh TRƯỚC (nửa trên)', 'Cảnh SAU (nửa dưới)'],
  extraClips: [
    title({ id: 'bt-ba-l1', startTime: 0, duration: 5, text: 'TRƯỚC', trackIndex: 3, fontSize: 64, positionY: 8 }),
    title({ id: 'bt-ba-l2', startTime: 0, duration: 5, text: 'SAU', trackIndex: 3, fontSize: 64, positionY: 58, color: '#4ADE80' }),
  ],
  extraVideoTracks: 2,
})

/**
 * A landscape opener with a lower third.
 *
 * The one built-in that is not vertical, because not everything made here is
 * for a phone and a library that assumes so is a library that quietly decides
 * what the user is allowed to make.
 */
const vlogOpener = build({
  id: 'builtin-vlog-opener',
  category: 'opener',  name: 'Mở đầu vlog · 16:9',
  frame: HORIZONTAL,
  slotClips: [
    shot({ id: 'bt-vo-1', startTime: 0, duration: 5, keyframes: punchIn(5, 100, 108) }),
    shot({
      id: 'bt-vo-2', startTime: 5, duration: 6,
      transitionIn: { type: 'dissolve', duration: 0.5 },
    }),
  ],
  labels: ['Cảnh giới thiệu', 'Cảnh nội dung'],
  extraClips: [
    title({ id: 'bt-vo-name', startTime: 1, duration: 3.5, text: 'TÊN KÊNH', trackIndex: 2, fontSize: 72, positionY: 72 }),
    title({ id: 'bt-vo-sub', startTime: 1, duration: 3.5, text: 'Mô tả ngắn một dòng', trackIndex: 2, fontSize: 36, positionY: 84 }),
  ],
  extraVideoTracks: 1,
  transitions: [
    { id: 'bt-vo-tr1', trackIndex: 1, leftClipId: 'bt-vo-1', rightClipId: 'bt-vo-2', type: 'dissolve', duration: 0.5 },
  ],
})

/**
 * Five shots that keep moving, for footage shot on the way somewhere.
 *
 * Slower than the montage and with a drift on each shot rather than a punch:
 * travel footage is usually wide and worth looking at, so the moves get out of
 * its way.
 */
const travelFive = build({
  id: 'builtin-travel-5',
  category: 'montage',
  name: 'Du lịch · 5 cảnh',
  frame: VERTICAL,
  slotClips: Array.from({ length: 5 }, (_, index) =>
    shot({
      id: `bt-t5-${index + 1}`,
      startTime: Number((index * 2.4).toFixed(2)),
      duration: 2.4,
      transitionIn: index === 0 ? undefined : { type: 'dissolve', duration: 0.4 },
      keyframes: punchIn(2.4, 104, 100),
    }),
  ),
  labels: ['Toàn cảnh', 'Chi tiết', 'Con người', 'Món ăn', 'Cảnh chốt'],
  extraClips: [
    title({ id: 'bt-t5-place', startTime: 0.4, duration: 2, text: 'TÊN ĐỊA ĐIỂM', trackIndex: 2, fontSize: 64, positionY: 12 }),
  ],
  extraVideoTracks: 1,
  transitions: Array.from({ length: 4 }, (_, index) => ({
    id: `bt-t5-tr${index + 1}`,
    trackIndex: 1,
    leftClipId: `bt-t5-${index + 1}`,
    rightClipId: `bt-t5-${index + 2}`,
    type: 'dissolve',
    duration: 0.4,
  })),
})

/**
 * Three points, counted down, each with its number on screen.
 *
 * The list video, which is the most reliable short-form shape there is: the
 * number tells the viewer how much is left, so they stay for the end.
 */
const countdownThree = build({
  id: 'builtin-countdown-3',
  category: 'text',
  name: 'Đếm ngược 3 điều',
  frame: VERTICAL,
  slotClips: [
    shot({ id: 'bt-c3-1', startTime: 0, duration: 3.5, keyframes: punchIn(3.5, 100, 110) }),
    shot({ id: 'bt-c3-2', startTime: 3.5, duration: 3.5, keyframes: punchIn(3.5, 100, 110) }),
    shot({ id: 'bt-c3-3', startTime: 7, duration: 3.5, keyframes: punchIn(3.5, 100, 110) }),
  ],
  labels: ['Điều số 3', 'Điều số 2', 'Điều số 1'],
  extraClips: [
    title({ id: 'bt-c3-n3', startTime: 0, duration: 3.5, text: '#3', trackIndex: 2, fontSize: 120, positionY: 18 }),
    title({ id: 'bt-c3-t3', startTime: 0.3, duration: 3.2, text: 'Ghi nội dung điều 3', trackIndex: 2, fontSize: 48, positionY: 78 }),
    title({ id: 'bt-c3-n2', startTime: 3.5, duration: 3.5, text: '#2', trackIndex: 2, fontSize: 120, positionY: 18 }),
    title({ id: 'bt-c3-t2', startTime: 3.8, duration: 3.2, text: 'Ghi nội dung điều 2', trackIndex: 2, fontSize: 48, positionY: 78 }),
    title({ id: 'bt-c3-n1', startTime: 7, duration: 3.5, text: '#1', trackIndex: 2, fontSize: 120, positionY: 18, color: '#FACC15' }),
    title({ id: 'bt-c3-t1', startTime: 7.3, duration: 3.2, text: 'Ghi nội dung điều 1', trackIndex: 2, fontSize: 48, positionY: 78 }),
  ],
  extraVideoTracks: 1,
})

/**
 * One shot, one sentence, held long enough to read.
 *
 * The simplest template here on purpose: it exists to show that a template can
 * be a single slot, and that the value is in the framing and the type rather
 * than in the number of cuts.
 */
const quoteSingle = build({
  id: 'builtin-quote-1',
  category: 'text',
  name: 'Câu trích · 1 cảnh',
  frame: VERTICAL,
  slotClips: [
    shot({ id: 'bt-q1-1', startTime: 0, duration: 6, keyframes: punchIn(6, 112, 100) }),
  ],
  labels: ['Cảnh nền'],
  extraClips: [
    title({ id: 'bt-q1-text', startTime: 0.5, duration: 5, text: '"Viết câu trích ở đây"', trackIndex: 2, fontSize: 68, positionY: 45 }),
    title({ id: 'bt-q1-by', startTime: 1, duration: 4.5, text: '— Nguồn', trackIndex: 2, fontSize: 36, positionY: 62 }),
  ],
  extraVideoTracks: 1,
})

/**
 * Two shots side by side for the whole run, each on its own half.
 *
 * The stacked version above reads as "then this happened"; this one reads as
 * "at the same time", which is the comparison people actually mean when the
 * two shots are not before and after.
 */
const sideBySide = build({
  id: 'builtin-side-by-side',
  category: 'compare',
  name: 'So sánh cạnh nhau',
  frame: VERTICAL,
  slotClips: [
    shot({ id: 'bt-sbs-left', startTime: 0, duration: 5, trackIndex: 1, transform: { positionX: -25 } }),
    shot({ id: 'bt-sbs-right', startTime: 0, duration: 5, trackIndex: 2, transform: { positionX: 25 } }),
  ],
  labels: ['Cảnh bên trái', 'Cảnh bên phải'],
  extraClips: [
    title({ id: 'bt-sbs-l', startTime: 0, duration: 5, text: 'A', trackIndex: 3, fontSize: 72, positionY: 10 }),
    title({ id: 'bt-sbs-r', startTime: 0, duration: 5, text: 'B', trackIndex: 3, fontSize: 72, positionY: 88 }),
  ],
  extraVideoTracks: 2,
})

export const BUILTIN_TEMPLATES: KomfyTemplate[] = [
  hookThreeShots,
  vlogOpener,
  fastMontage,
  travelFive,
  beforeAfter,
  sideBySide,
  countdownThree,
  quoteSingle,
]

/** The file name a built-in answers to, so the browser can address it like any other. */
export function builtinTemplateFileName(template: KomfyTemplate): string {
  return `${template.id}.komfytemplate`
}

export function findBuiltinTemplate(fileName: string): KomfyTemplate | undefined {
  return BUILTIN_TEMPLATES.find(template => builtinTemplateFileName(template) === fileName)
}
