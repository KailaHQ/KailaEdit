import type { Timeline, TimelineClip, TimelineTransition } from './project-model'
import {
  clampTransitionDuration,
  getTransitionDefinition,
  maxTransitionDuration,
  MIN_TRANSITION_DURATION,
} from './transitions'

/**
 * Placing, moving and removing transitions on a timeline.
 *
 * The rule that shapes everything here: a transition is an OVERLAP. The two
 * pictures genuinely coexist for `d` seconds, straddling the cut — the left
 * clip plays `d/2` past it, the right clip starts `d/2` early.
 *
 * Crucially, that time is bought with media the clips were already trimming
 * away, not with time on the timeline. Both clips keep the edges the user can
 * see — `a` starts where it started, `b` ends where it ended — and nothing
 * downstream moves. Re-timing the effect therefore changes the effect and
 * nothing else, which is what makes dragging a handle feel like resizing a
 * band rather than shoving the film about.
 *
 * A clip with no spare frames cannot lend any, and then the other side covers
 * the difference; a still lends without limit, having no source to run out of.
 * Only when both are exhausted does the timeline itself pay, by closing up and
 * getting shorter — the one case where clips visibly move, and the UI says so.
 * `leftExtend` and `rightExtend` record what each clip actually lent, so
 * removal gives back exactly that and reopens exactly what was closed.
 *
 * All of it is pure: these take a timeline and return a new one, so the editor
 * store, the undo stack and the MCP patch executor share one implementation.
 */

/** Two clips are "adjacent" within this many seconds of each other. */
const ADJACENCY_EPSILON = 0.001

export interface TransitionPlacement {
  leftClip: TimelineClip
  rightClip: TimelineClip
}

/** The clip pair a cut refers to, or a reason it is not a usable cut. */
export type ResolveCutResult =
  | { ok: true; placement: TransitionPlacement }
  | { ok: false; reason: string }

export function resolveCut(
  timeline: Pick<Timeline, 'clips'>,
  leftClipId: string,
  rightClipId: string,
): ResolveCutResult {
  const leftClip = timeline.clips.find(clip => clip.id === leftClipId)
  const rightClip = timeline.clips.find(clip => clip.id === rightClipId)

  if (!leftClip) return { ok: false, reason: `Clip "${leftClipId}" not found.` }
  if (!rightClip) return { ok: false, reason: `Clip "${rightClipId}" not found.` }
  if (leftClip.id === rightClip.id) return { ok: false, reason: 'The two clips must be different.' }
  if (leftClip.trackIndex !== rightClip.trackIndex) {
    return { ok: false, reason: 'Transitions can only be placed between two clips on the same track.' }
  }

  const gap = rightClip.startTime - (leftClip.startTime + leftClip.duration)
  if (Math.abs(gap) > ADJACENCY_EPSILON) {
    return {
      ok: false,
      reason: gap > 0
        ? 'There is a gap between the two clips — snap them together before placing a transition.'
        : 'The two clips are overlapping.',
    }
  }

  if (maxTransitionDuration(leftClip.duration, rightClip.duration) < MIN_TRANSITION_DURATION) {
    return { ok: false, reason: 'The clips are too short to insert a transition.' }
  }

  return { ok: true, placement: { leftClip, rightClip } }
}

export function findTransitionAtCut(
  timeline: Pick<Timeline, 'transitions'>,
  leftClipId: string,
  rightClipId: string,
): TimelineTransition | undefined {
  return (timeline.transitions ?? []).find(
    transition => transition.leftClipId === leftClipId && transition.rightClipId === rightClipId,
  )
}

/**
 * Shifts a clip and everything starting after it on the same track.
 *
 * Linked clips ride along wherever they live, so a video clip that carries its
 * own audio track does not drift out of sync when the picture moves.
 */
function rippleFrom(
  clips: TimelineClip[],
  anchor: TimelineClip,
  deltaSeconds: number,
): TimelineClip[] {
  if (deltaSeconds === 0) return clips

  const moving = new Set<string>()
  for (const clip of clips) {
    if (clip.trackIndex !== anchor.trackIndex) continue
    if (clip.startTime + ADJACENCY_EPSILON < anchor.startTime) continue
    moving.add(clip.id)
  }

  // Pull the linked partners of everything that moves, on whatever track they
  // sit, or the picture and its audio come apart.
  for (const clip of clips) {
    if (!moving.has(clip.id)) continue
    for (const linkedId of clip.linkedClipIds ?? []) moving.add(linkedId)
  }

  return clips.map(clip => (
    moving.has(clip.id)
      ? { ...clip, startTime: Math.max(0, clip.startTime + deltaSeconds) }
      : clip
  ))
}

export type TransitionMutation =
  | { ok: true; timeline: Timeline; duration: number }
  | { ok: false; reason: string }

export interface SetTransitionOptions {
  /**
   * Close a gap up to this many seconds wide before placing the transition.
   *
   * Only the magnetic main track guarantees its clips touch; on an overlay
   * track two clips dropped by hand almost never land edge to edge, and a
   * transition has nowhere to attach. Rather than refuse a drop the user
   * clearly aimed at that junction, pull the right-hand clip back onto the
   * left one — the same gesture they would otherwise perform themselves.
   *
   * Zero (the default) keeps the strict behaviour: a gap is a refusal.
   */
  closeGapUpTo?: number
}

/**
 * Pulls the right-hand clip (and its followers) back onto the left one when the
 * two are separated by no more than `limit` seconds. Anything wider is left
 * alone so `resolveCut` can refuse it with an explanation.
 */
function closeGapForTransition(
  timeline: Timeline,
  leftClipId: string,
  rightClipId: string,
  limit: number,
): Timeline {
  if (limit <= 0) return timeline

  const leftClip = timeline.clips.find(clip => clip.id === leftClipId)
  const rightClip = timeline.clips.find(clip => clip.id === rightClipId)
  if (!leftClip || !rightClip) return timeline
  if (leftClip.trackIndex !== rightClip.trackIndex) return timeline

  const gap = rightClip.startTime - (leftClip.startTime + leftClip.duration)
  // The limit is compared loosely on purpose: a caller that measured this very
  // gap and passed it back as the licence must not lose to a float rounding.
  if (gap <= ADJACENCY_EPSILON || gap > limit + ADJACENCY_EPSILON) return timeline

  return { ...timeline, clips: rippleFrom(timeline.clips, rightClip, -gap) }
}

/**
 * Adds a transition at a cut, or re-times the one already there.
 *
 * Re-timing goes through the same path deliberately: the difference between
 * "add 0.5s" and "grow from 0.5s to 0.8s" is only how far the timeline ripples,
 * and writing it once means the two can never disagree about the arithmetic.
 */
export function setTransitionAtCut(
  timeline: Timeline,
  leftClipId: string,
  rightClipId: string,
  type: string,
  requestedDuration: number,
  makeId: () => string,
  options: SetTransitionOptions = {},
): TransitionMutation {
  if (!getTransitionDefinition(type)) {
    return { ok: false, reason: `Unknown transition "${type}".` }
  }

  const existing = findTransitionAtCut(timeline, leftClipId, rightClipId)
  // With a transition already in place the clips overlap, so their "adjacent"
  // relationship has to be judged against the timeline as it was before it.
  const withoutExisting = existing ? removeTransitionById(timeline, existing.id) : timeline
  const base = closeGapForTransition(withoutExisting, leftClipId, rightClipId, options.closeGapUpTo ?? 0)

  const cut = resolveCut(base, leftClipId, rightClipId)
  if (!cut.ok) return { ok: false, reason: cut.reason }

  const { leftClip, rightClip } = cut.placement
  const duration = clampTransitionDuration(requestedDuration, leftClip.duration, rightClip.duration)
  if (duration <= 0) return { ok: false, reason: 'The clips are too short to insert a transition.' }

  const borrow = planBorrow(leftClip, rightClip, duration)

  let clips = base.clips
  if (borrow.left > 0 || borrow.right > 0) {
    clips = clips.map(clip => {
      if (clip.id === leftClip.id) return extendTail(clip, borrow.left)
      if (clip.id === rightClip.id) return extendHead(clip, borrow.right)
      return clip
    })
  }
  // Whatever neither clip could lend has to come out of the timeline itself:
  // the right-hand clip and everything after it move up to make the overlap.
  if (borrow.shortfall > 0) {
    const movedRight = clips.find(clip => clip.id === rightClip.id) ?? rightClip
    clips = rippleFrom(clips, movedRight, -borrow.shortfall)
  }

  const transition: TimelineTransition = {
    id: existing?.id ?? makeId(),
    trackIndex: leftClip.trackIndex,
    leftClipId,
    rightClipId,
    type,
    duration,
    leftExtend: borrow.left,
    rightExtend: borrow.right,
  }

  return {
    ok: true,
    duration,
    timeline: {
      ...base,
      clips,
      transitions: [...(base.transitions ?? []), transition],
    },
  }
}

export interface TransitionBorrow {
  /** Seconds the left clip plays past the cut, out of its unused tail. */
  left: number
  /** Seconds the right clip starts early, out of its unused head. */
  right: number
  /** Overlap neither clip could pay for, which the timeline has to give up. */
  shortfall: number
}

/**
 * Who pays for the overlap.
 *
 * Half from each side keeps the effect centred on the cut and — the point of
 * paying with trimmed-off media rather than with time — leaves both clips
 * exactly where they were, so nothing downstream shifts under the user's
 * cursor while they drag the handle. A side with nothing spare makes the other
 * cover the difference; only when both are exhausted does the timeline pay,
 * by closing up, which is the old rippling behaviour and the only case where
 * the clips visibly move.
 */
export function planBorrow(
  leftClip: TimelineClip,
  rightClip: TimelineClip,
  duration: number,
): TransitionBorrow {
  const half = duration / 2
  let left = Math.min(half, tailHeadroom(leftClip))
  let right = Math.min(duration - left, headHeadroom(rightClip))
  if (left + right < duration) {
    left = Math.min(duration - right, tailHeadroom(leftClip))
  }
  // A clip cannot start before zero, however much media it still has.
  right = Math.min(right, rightClip.startTime)

  return { left, right, shortfall: Math.max(0, duration - left - right) }
}

/**
 * How much longer a clip could play before it runs out of media, in timeline
 * seconds. Stills and generated layers have no source to run out of.
 */
export function tailHeadroom(clip: TimelineClip): number {
  if (clip.type !== 'video' && clip.type !== 'audio') return Infinity
  return Math.max(0, clip.trimEnd) / (clip.speed || 1)
}

/**
 * How much earlier a clip could start before it runs out of media, in timeline
 * seconds. Stills have no source to run out of.
 */
export function headHeadroom(clip: TimelineClip): number {
  if (clip.type !== 'video' && clip.type !== 'audio') return Infinity
  return Math.max(0, clip.trimStart) / (clip.speed || 1)
}

/** Lets a clip play `seconds` longer, out of the tail it was trimming off. */
function extendTail(clip: TimelineClip, seconds: number): TimelineClip {
  // A still has no source to advance through, so it grows without a trim to pay
  // for it — and must not be handed a phantom trim to give back later.
  const usesMedia = clip.type === 'video' || clip.type === 'audio'
  return {
    ...clip,
    duration: clip.duration + seconds,
    trimEnd: usesMedia ? Math.max(0, clip.trimEnd - seconds * (clip.speed || 1)) : clip.trimEnd,
  }
}

/** Undoes `extendTail`, handing the media back to the trim. */
function retractTail(clip: TimelineClip, seconds: number): TimelineClip {
  const usesMedia = clip.type === 'video' || clip.type === 'audio'
  return {
    ...clip,
    duration: Math.max(MIN_TRANSITION_DURATION, clip.duration - seconds),
    trimEnd: usesMedia ? clip.trimEnd + seconds * (clip.speed || 1) : clip.trimEnd,
  }
}

/** Lets a clip start `seconds` earlier, out of the head it was trimming off. */
function extendHead(clip: TimelineClip, seconds: number): TimelineClip {
  if (seconds <= 0) return clip
  const usesMedia = clip.type === 'video' || clip.type === 'audio'
  return {
    ...clip,
    startTime: Math.max(0, clip.startTime - seconds),
    duration: clip.duration + seconds,
    trimStart: usesMedia ? Math.max(0, clip.trimStart - seconds * (clip.speed || 1)) : clip.trimStart,
  }
}

/** Undoes `extendHead`, handing the media back to the trim. */
function retractHead(clip: TimelineClip, seconds: number): TimelineClip {
  if (seconds <= 0) return clip
  const usesMedia = clip.type === 'video' || clip.type === 'audio'
  return {
    ...clip,
    startTime: clip.startTime + seconds,
    duration: Math.max(MIN_TRANSITION_DURATION, clip.duration - seconds),
    trimStart: usesMedia ? clip.trimStart + seconds * (clip.speed || 1) : clip.trimStart,
  }
}

/**
 * Takes a transition back out and closes the overlap it opened.
 *
 * Returns the timeline unchanged when the id is unknown, so a double remove —
 * two users, an undo racing a click — is harmless rather than a shift of the
 * whole track.
 */
export function removeTransitionById(timeline: Timeline, transitionId: string): Timeline {
  const transitions = timeline.transitions ?? []
  const transition = transitions.find(candidate => candidate.id === transitionId)
  if (!transition) return timeline

  const rightClip = timeline.clips.find(clip => clip.id === transition.rightClipId)
  const leftClip = timeline.clips.find(clip => clip.id === transition.leftClipId)

  // A transition is only in force while its clips actually overlap. Once they
  // do not — something dragged them apart, or a project was written in a state
  // that never had the overlap — the record is all that is left, and giving
  // back time nobody is holding would tear a gap open at a junction the user
  // can see is closed. Removing it is then purely deleting the record.
  const overlap = leftClip && rightClip
    ? (leftClip.startTime + leftClip.duration) - rightClip.startTime
    : 0
  if (overlap <= ADJACENCY_EPSILON) {
    return { ...timeline, transitions: transitions.filter(candidate => candidate.id !== transitionId) }
  }

  // Give back exactly what was borrowed — the left clip's lengthened tail, the
  // right clip's lengthened head — and then reopen whatever the timeline itself
  // had to pay. Recomputing any of it from the clips as they stand now would
  // drift a little further every time the transition was re-timed.
  const leftExtend = transition.leftExtend ?? 0
  const rightExtend = transition.rightExtend ?? 0
  const shortfall = Math.max(0, transition.duration - leftExtend - rightExtend)

  let clips = timeline.clips
  if (leftExtend > 0 || rightExtend > 0) {
    clips = clips.map(clip => {
      if (clip.id === transition.leftClipId) return retractTail(clip, leftExtend)
      if (clip.id === transition.rightClipId) return retractHead(clip, rightExtend)
      return clip
    })
  }
  if (shortfall > 0 && rightClip) {
    const movedRight = clips.find(clip => clip.id === rightClip.id) ?? rightClip
    clips = rippleFrom(clips, movedRight, shortfall)
  }

  return {
    ...timeline,
    clips,
    transitions: transitions.filter(candidate => candidate.id !== transitionId),
  }
}

/**
 * Drops transitions that are no longer describing anything.
 *
 * Two ways a record outlives its effect, and both leave a transition that the
 * timeline does not show but the exporter would still try to render:
 *
 *  - Its clips are gone. Deleting a clip leaves its transitions pointing at
 *    nothing; left in place they would be exported as an overlap between a
 *    clip and a ghost.
 *  - Its clips are still there but no longer overlap. A transition IS the
 *    overlap, so a pair that has been dragged, trimmed or re-packed apart is
 *    a transition in name only — as found in a real project file, where a
 *    0.72s wipe sat on two stills that met exactly.
 *
 * Clips that have ended up on different tracks count as not overlapping: a
 * transition only ever means something within one track.
 *
 * This does NOT ripple, in either case. The overlap it would have given back
 * is already gone — whatever removed it took that time with it, and pushing
 * the rest of the track around now would move clips the user has since placed
 * by hand. Contrast `removeTransitionById`, which ripples precisely because
 * there it is undoing an overlap that is still in force.
 */
export function pruneOrphanTransitions(timeline: Timeline): Timeline {
  const transitions = timeline.transitions ?? []
  if (transitions.length === 0) return timeline

  const clipsById = new Map(timeline.clips.map(clip => [clip.id, clip]))
  const kept = transitions.filter(transition => {
    const leftClip = clipsById.get(transition.leftClipId)
    const rightClip = clipsById.get(transition.rightClipId)
    if (!leftClip || !rightClip) return false
    if (leftClip.trackIndex !== rightClip.trackIndex) return false
    const overlap = (leftClip.startTime + leftClip.duration) - rightClip.startTime
    return overlap > ADJACENCY_EPSILON
  })
  return kept.length === transitions.length ? timeline : { ...timeline, transitions: kept }
}

/**
 * Rewrites the legacy paired-fade form into real transitions.
 *
 * The old "cross dissolve" set `transitionOut` on one clip and `transitionIn`
 * on the next while leaving them end to end — so the preview cross-faded but
 * the export dipped through transparent, because the two clips never actually
 * shared a moment. Converting the pairs makes both agree; the clips overlap
 * now, so the migrated timeline is genuinely shorter than the file on disk.
 */
export function migrateLegacyDissolves(timeline: Timeline, makeId: () => string): Timeline {
  if ((timeline.transitions ?? []).length > 0) return timeline

  const pairs: Array<{ leftId: string; rightId: string; duration: number }> = []
  for (const leftClip of timeline.clips) {
    if (leftClip.transitionOut?.type !== 'dissolve') continue
    const leftEnd = leftClip.startTime + leftClip.duration
    const rightClip = timeline.clips.find(candidate =>
      candidate.id !== leftClip.id &&
      candidate.trackIndex === leftClip.trackIndex &&
      candidate.transitionIn?.type === 'dissolve' &&
      Math.abs(candidate.startTime - leftEnd) < 0.05,
    )
    if (!rightClip) continue
    pairs.push({
      leftId: leftClip.id,
      rightId: rightClip.id,
      duration: leftClip.transitionOut.duration,
    })
  }

  if (pairs.length === 0) return timeline

  let next: Timeline = {
    ...timeline,
    clips: timeline.clips.map(clip => {
      const isLeft = pairs.some(pair => pair.leftId === clip.id)
      const isRight = pairs.some(pair => pair.rightId === clip.id)
      if (!isLeft && !isRight) return clip
      return {
        ...clip,
        ...(isLeft ? { transitionOut: { type: 'none' as const, duration: clip.transitionOut.duration } } : {}),
        ...(isRight ? { transitionIn: { type: 'none' as const, duration: clip.transitionIn.duration } } : {}),
      }
    }),
  }

  for (const pair of pairs) {
    const result = setTransitionAtCut(next, pair.leftId, pair.rightId, 'dissolve', pair.duration, makeId)
    // A pair that no longer fits is dropped rather than half-applied: the old
    // form rendered as a dip anyway, so nothing the user relied on is lost.
    if (result.ok) next = result.timeline
  }

  return next
}
