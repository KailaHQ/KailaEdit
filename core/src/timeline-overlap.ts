import type { TimelineClip, Track, SubtitleClip } from './project-model'

/** Overlaps shorter than this are rounding at a shared edge, not a collision. */
export const COLLISION_EPSILON = 1e-3

/**
 * Where a drag lands on top of other clips on an overlay track, gives the dragged clips a
 * new track of their own instead.
 *
 * Dropping onto an overlay track used to overwrite: `resolveOverlaps` trimmed the clip
 * underneath, or deleted it outright when the drop covered it. Nothing warned during the
 * drag, so moving one clip could quietly eat most of another. Now the dragged clips keep
 * exactly the time they were dropped at, move up onto a fresh track of the same kind, and
 * the clips they would have landed on are left alone.
 *
 * Per target track: every moved clip landing on a track where any of them collides goes
 * up together, so a group dragged as one stays on one track. The main track is left to
 * its magnet, and clips joined by a transition overlap on purpose, so neither counts.
 * New tracks are appended — above everything of their kind, which is where the dragged
 * clip is drawn anyway.
 */
export function liftCollidingClipsToNewTracks(
  tracks: Track[],
  clips: TimelineClip[],
  movedIds: ReadonlySet<string>,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string }> = [],
  mainTrackIndex: number = mainVideoTrackIndex(tracks),
  makeTrackId: () => string = () => `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): { tracks: Track[]; clips: TimelineClip[] } {
  const joined = (a: string, b: string) => transitions.some(t =>
    (t.leftClipId === a && t.rightClipId === b) || (t.leftClipId === b && t.rightClipId === a))

  const collidingTracks = new Set<number>()
  for (const moved of clips) {
    if (!movedIds.has(moved.id) || moved.trackIndex === mainTrackIndex) continue
    if (collidingTracks.has(moved.trackIndex)) continue
    const movedEnd = moved.startTime + moved.duration
    const hits = clips.some(other =>
      !movedIds.has(other.id)
      && other.trackIndex === moved.trackIndex
      && other.startTime < movedEnd - COLLISION_EPSILON
      && other.startTime + other.duration > moved.startTime + COLLISION_EPSILON
      && !joined(moved.id, other.id))
    if (hits) collidingTracks.add(moved.trackIndex)
  }
  if (collidingTracks.size === 0) return { tracks, clips }

  const nextTracks = [...tracks]
  const liftedTo = new Map<number, number>()
  for (const from of [...collidingTracks].sort((a, b) => a - b)) {
    const source = tracks[from]
    const kind = source?.kind ?? 'video'
    const prefix = kind === 'audio' ? 'A' : kind === 'sticker' ? 'S' : 'V'
    const sameKind = nextTracks.filter(t => (t.kind ?? 'video') === kind && t.type !== 'subtitle').length
    liftedTo.set(from, nextTracks.length)
    nextTracks.push({
      id: makeTrackId(),
      name: `${prefix}${sameKind + 1}`,
      muted: false,
      locked: false,
      kind,
    })
  }

  return {
    tracks: nextTracks,
    clips: clips.map(clip => {
      const to = movedIds.has(clip.id) ? liftedTo.get(clip.trackIndex) : undefined
      return to === undefined ? clip : { ...clip, trackIndex: to }
    }),
  }
}

/**
 * How far a clip's edges may be dragged on an overlay track before they run into the
 * clips beside it — stopping a trim at the neighbour's edge.
 *
 * Without this a trim slid straight over the next clip, and on release `resolveOverlaps`
 * cut the neighbour back or deleted it. `start`–`end` is the clip's span when the trim
 * began; `trackIndexes` are the tracks being trimmed (the clip's own, plus any linked
 * clip's). A clip already overlapping that span limits nothing, and neither does one
 * joined to a resized clip by a transition — those overlap on purpose.
 */
export function neighbourTrimBounds(
  clips: ReadonlyArray<TimelineClip>,
  resizedIds: ReadonlySet<string>,
  trackIndexes: Iterable<number>,
  start: number,
  end: number,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string }> = [],
): { minStart: number; maxEnd: number } {
  const tracksToCheck = new Set(trackIndexes)
  const joined = (id: string) => transitions.some(t =>
    (resizedIds.has(t.leftClipId) && t.rightClipId === id) || (resizedIds.has(t.rightClipId) && t.leftClipId === id))
  let minStart = 0
  let maxEnd = Infinity
  for (const clip of clips) {
    if (resizedIds.has(clip.id) || !tracksToCheck.has(clip.trackIndex) || joined(clip.id)) continue
    const clipEnd = clip.startTime + clip.duration
    if (clipEnd <= start + COLLISION_EPSILON) minStart = Math.max(minStart, clipEnd)
    else if (clip.startTime >= end - COLLISION_EPSILON) maxEnd = Math.min(maxEnd, clip.startTime)
  }
  return { minStart, maxEnd }
}

export function resolveOverlaps(
  allClips: TimelineClip[],
  movedIds: Set<string>,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
  mainTrackIndex: number = 0,
): TimelineClip[] {
  let result = [...allClips]

  for (const movedId of movedIds) {
    const moved = result.find(c => c.id === movedId)
    if (!moved) continue

    const movedStart = moved.startTime
    const movedEnd = moved.startTime + moved.duration

    // On the magnetic main track the clips a dropped clip lands on are pushed out of its way.
    // They move TOGETHER, by one distance: pushing each to the dropped clip's end gave two
    // overlapped clips the very same start, and the packing that follows then ordered them by
    // chance — dropping a clip in front of 1 and 2 could put 2 in front of 1.
    let pushShift = 0
    if (moved.trackIndex === mainTrackIndex) {
      let earliest = Infinity
      for (const c of result) {
        if (movedIds.has(c.id) || c.trackIndex !== moved.trackIndex) continue
        const connected = transitions.some(t =>
          (t.leftClipId === moved.id && t.rightClipId === c.id) ||
          (t.leftClipId === c.id && t.rightClipId === moved.id))
        if (connected) continue
        if (c.startTime + c.duration <= movedStart || c.startTime >= movedEnd) continue
        if (movedStart < c.startTime + c.duration / 2) earliest = Math.min(earliest, c.startTime)
      }
      if (earliest !== Infinity) pushShift = Math.max(0, movedEnd - earliest)
    }

    const next: TimelineClip[] = []

    for (const c of result) {
      if (movedIds.has(c.id)) { next.push(c); continue }
      if (c.trackIndex !== moved.trackIndex) { next.push(c); continue }

      // If moved and c are connected by a transition, their overlap is intentional and
      // managed by transition packing, not a conflict to resolve.
      const isConnectedByTransition = transitions.some(t =>
        (t.leftClipId === moved.id && t.rightClipId === c.id) ||
        (t.leftClipId === c.id && t.rightClipId === moved.id)
      )
      if (isConnectedByTransition) {
        next.push(c)
        continue
      }

      const cStart = c.startTime
      const cEnd = c.startTime + c.duration

      if (cEnd <= movedStart || cStart >= movedEnd) { next.push(c); continue }

      // For Track 1 (magnetic): never trim, split, or delete existing clips
      if (moved.trackIndex === mainTrackIndex) {
        const cMid = cStart + c.duration / 2
        if (movedStart < cMid) {
          next.push({ ...c, startTime: cStart + pushShift })
        } else {
          next.push(c)
          if (moved.startTime < cEnd) {
            moved.startTime = cEnd
          }
        }
        continue
      }

      if (cStart >= movedStart && cEnd <= movedEnd) continue

      if (cStart < movedStart && cEnd > movedStart && cEnd <= movedEnd) {
        const newDuration = movedStart - cStart
        next.push({ ...c, duration: newDuration })
        continue
      }

      if (cStart >= movedStart && cStart < movedEnd && cEnd > movedEnd) {
        const trimAmount = movedEnd - cStart
        const newTrimStart = c.trimStart + trimAmount * c.speed
        next.push({
          ...c,
          startTime: movedEnd,
          duration: c.duration - trimAmount,
          trimStart: newTrimStart,
        })
        continue
      }

      if (cStart < movedStart && cEnd > movedEnd) {
        // Do NOT split c into two pieces. Push c forward so it stays whole.
        next.push({
          ...c,
          startTime: movedEnd,
        })
        continue
      }

      next.push(c)
    }

    result = next
  }

  return result
}

/**
 * Ensures clips on the main video track (Track 1 / index 0) form a continuous,
 * magnetic timeline starting at 0s with no gaps.
 * Also adjusts the start times of any linked audio clips accordingly.
 *
 * `transitions` is the one licensed exception to "no gaps, no overlaps": a pair
 * joined by a transition is *meant* to overlap, by exactly its duration, because
 * that overlap is the transition. Without this the magnetic packing would close
 * the overlap the instant it was created and the transition would be a no-op
 * that silently reverted itself.
 */
export function packTrack1(
  allClips: TimelineClip[],
  mainTrackIndex: number = 0,
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
): TimelineClip[] {
  // Clips that start together (a clip dropped onto the start of the track, say) are ordered by
  // the transition that joins them, left clip first, and otherwise keep the order they had.
  const leadsTo = (a: TimelineClip, b: TimelineClip) =>
    transitions.some(t => t.leftClipId === a.id && t.rightClipId === b.id)
  const track1Clips = allClips
    .filter(c => c.trackIndex === mainTrackIndex)
    .sort((a, b) => {
      const byStart = a.startTime - b.startTime
      if (Math.abs(byStart) > 1e-9) return byStart
      if (leadsTo(a, b)) return -1
      if (leadsTo(b, a)) return 1
      return 0
    })

  if (track1Clips.length === 0) return allClips

  // A transition overlaps its left clip with the clip that FOLLOWS it, and only if that clip
  // is the transition's right one. Applied to whichever clip happens to come next, a record
  // left behind by a reorder or a delete squeezed two unrelated clips into each other.
  const overlapAfter = new Map<string, { rightClipId: string; duration: number }>()
  for (const transition of transitions) {
    overlapAfter.set(transition.leftClipId, { rightClipId: transition.rightClipId, duration: transition.duration })
  }

  const clipDeltas = new Map<string, number>()
  let currentCursor = 0
  let moved = false

  const remappedTrack1 = new Map<string, TimelineClip>()
  for (let i = 0; i < track1Clips.length; i += 1) {
    const c = track1Clips[i]
    const delta = currentCursor - c.startTime
    if (delta !== 0) moved = true
    clipDeltas.set(c.id, delta)
    remappedTrack1.set(c.id, {
      ...c,
      startTime: currentCursor,
    })
    // The next clip starts early by the length of the transition out of this one.
    const joined = overlapAfter.get(c.id)
    const overlap = joined && joined.rightClipId === track1Clips[i + 1]?.id
      ? Math.min(joined.duration, c.duration)
      : 0
    currentCursor += c.duration - overlap
  }

  // Already tiled from 0: hand back the very same array so callers can treat an
  // unchanged reference as "nothing to write".
  if (!moved) return allClips

  return allClips.map(clip => {
    if (clip.trackIndex === mainTrackIndex) {
      return remappedTrack1.get(clip.id) || clip
    }
    if (clip.linkedClipIds?.length) {
      for (const linkedId of clip.linkedClipIds) {
        if (clipDeltas.has(linkedId)) {
          const delta = clipDeltas.get(linkedId)!
          return {
            ...clip,
            startTime: Math.max(0, clip.startTime + delta),
          }
        }
      }
    }
    return clip
  })
}

/** Index of the main video track (V1) — the magnetic one — or -1 if there is none. */
export function mainVideoTrackIndex(tracks: Track[]): number {
  // First prefer explicit base video track by id ('track-v1'), name ('V1'), or sourcePatched flag
  const explicit = tracks.findIndex(
    track => track.kind === 'video' && track.type !== 'subtitle' && (track.id === 'track-v1' || track.name === 'V1' || track.sourcePatched),
  )
  if (explicit >= 0) return explicit

  // Avoid choosing overlay tracks (e.g. titled 'Kinetic Titles', 'Text Overlay', etc.) over main video tracks
  const nonOverlay = tracks.findIndex(
    track => track.kind === 'video' && track.type !== 'subtitle' && !/text|title|chữ|adj|overlay|sticker/i.test(track.name),
  )
  if (nonOverlay >= 0) return nonOverlay

  return tracks.findIndex(track => track.kind === 'video' && track.type !== 'subtitle')
}

/**
 * Enforce the magnetic main track: clips on V1 always tile from 0 with no gaps.
 * Overlay tracks (V2 and up) are left alone — a clip put anywhere on them stays
 * where it was put.
 *
 * Returns the same `clips` reference when nothing had to move.
 */
export function packMainVideoTrack(
  tracks: Track[],
  clips: TimelineClip[],
  transitions: ReadonlyArray<{ leftClipId: string; rightClipId: string; duration: number }> = [],
): TimelineClip[] {
  const mainIndex = mainVideoTrackIndex(tracks)
  if (mainIndex < 0) return clips
  return packTrack1(clips, mainIndex, transitions)
}

/**
 * Removes every track nothing is sitting on.
 *
 * An empty row is a row the user has to scroll past and aim around, and the
 * editor used to leave a trail of them: an overlay that was cleared, an audio
 * row kept "ready" for a drop, a sticker row whose sticker was deleted.
 *
 * Three rows are spared:
 *  - the first video track, so there is always somewhere to drop the first clip
 *  - subtitle tracks, whose contents live in `subtitles` rather than `clips`
 *  - locked tracks: locking a row is the user saying leave it alone, and an
 *    empty locked row is usually one being held open on purpose
 *
 * Nothing is lost by pruning aggressively: dropping media builds whatever track
 * it needs (see buildDroppedAudioClipInsertion and addStickerClip), and +V / +A
 * still add one by hand.
 */
export function pruneEmptyTracks(
  tracks: Track[],
  clips: TimelineClip[],
  subtitles: SubtitleClip[] = [],
): { tracks: Track[]; clips: TimelineClip[]; subtitles: SubtitleClip[] } {
  const baseVideoIndex = mainVideoTrackIndex(tracks)

  const isOccupied = (index: number) =>
    clips.some(clip => clip.trackIndex === index)
    || subtitles.some(sub => sub.trackIndex === index)

  const removed = new Set<number>()
  tracks.forEach((track, index) => {
    if (index === baseVideoIndex) return
    if (track.type === 'subtitle') return
    if (track.locked) return
    if (isOccupied(index)) return
    removed.add(index)
  })

  if (removed.size === 0) {
    return { tracks, clips, subtitles }
  }

  const oldToNewIndex = new Map<number, number>()
  const nextTracks: Track[] = []
  let videoCounter = 1
  let audioCounter = 1
  let stickerCounter = 1

  tracks.forEach((track, index) => {
    if (removed.has(index)) return
    oldToNewIndex.set(index, nextTracks.length)

    if (track.type === 'subtitle') {
      nextTracks.push(track)
    } else if (track.kind === 'audio') {
      nextTracks.push({ ...track, name: `A${audioCounter++}` })
    } else if (track.kind === 'sticker') {
      nextTracks.push({ ...track, name: `S${stickerCounter++}` })
    } else {
      nextTracks.push({ ...track, name: `V${videoCounter++}` })
    }
  })

  return {
    tracks: nextTracks,
    clips: clips.map(clip => ({
      ...clip,
      trackIndex: oldToNewIndex.get(clip.trackIndex) ?? clip.trackIndex,
    })),
    subtitles: subtitles.map(sub => ({
      ...sub,
      trackIndex: oldToNewIndex.get(sub.trackIndex) ?? sub.trackIndex,
    })),
  }
}

/**
 * Automatically removes empty overlay video tracks (V2, V3, etc.) when they
 * contain no clips. Track 1 (V1) is never removed.
 * Remaps clip and subtitle track indices accordingly.
 */
export function pruneEmptyOverlayTracks(
  tracks: Track[],
  clips: TimelineClip[],
  subtitles: SubtitleClip[] = [],
): { tracks: Track[]; clips: TimelineClip[]; subtitles: SubtitleClip[] } {
  return pruneEmptyTracks(tracks, clips, subtitles)
}
