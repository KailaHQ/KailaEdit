import { clipSourceSpan, clipTimeAtSourceOffset } from './speed-curve'
import type { SubtitleClip, TimelineClip } from './project-model'

/* ────────────────────────────────────────────────────────────────
   The transcript every speech feature reads from.

   Captions, Auto Highlights and B-roll Copilot all need the same thing —
   what was said, and when — but each used to source it differently:
   captions called Whisper and threw the segments away, highlights called
   Whisper again, and B-roll read the caption cues. So the same recording was
   transcribed twice, and two of the three were reading captions that smart
   chunking had already cut into three-word scraps.

   Stored against the source asset, in the media's own seconds, because that
   is the only frame of reference that survives editing. A clip moved along
   the timeline, re-trimmed, or sped up still points at the same recording:
   re-trimming then just selects a different window of a transcript that is
   already on disk, rather than paying for Whisper again.
   ──────────────────────────────────────────────────────────────── */

/** One utterance, in seconds from the start of the media file. */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface AssetTranscript {
  /** Absolute path of the media this was transcribed from. */
  assetPath: string
  /** BCP-47-ish code Whisper reported or was told to use; '' when unknown. */
  language: string
  /** Segments in media seconds, ascending, blank text already dropped. */
  segments: TranscriptSegment[]
  /** When it was produced, so a stale entry can be recognised. */
  createdAt: number
}

/** Two transcripts are the same entry when they describe the same audio. */
function sameSource(entry: AssetTranscript, assetPath: string, language?: string): boolean {
  if (entry.assetPath !== assetPath) return false
  // A request that does not care about language takes whatever is stored;
  // asking for one specifically must not return a transcript of another.
  if (!language || !entry.language) return true
  return entry.language === language
}

export function findAssetTranscript(
  transcripts: AssetTranscript[] | undefined,
  assetPath: string,
  language?: string,
): AssetTranscript | undefined {
  return (transcripts ?? []).find(entry => sameSource(entry, assetPath, language))
}

/**
 * Adds a transcript, replacing any earlier one for the same audio.
 *
 * Replace rather than append: a second run means the first was unsatisfactory
 * (a different model, a corrected language), and keeping both would leave the
 * readers picking whichever happened to be first in the array.
 */
export function upsertAssetTranscript(
  transcripts: AssetTranscript[] | undefined,
  next: AssetTranscript,
): AssetTranscript[] {
  const rest = (transcripts ?? []).filter(entry => !sameSource(entry, next.assetPath, next.language))
  return [...rest, next]
}

/** Normalises raw Whisper output into what the store holds. */
export function toTranscriptSegments(
  segments: ReadonlyArray<{ start: number; end: number; text: string }>,
): TranscriptSegment[] {
  return segments
    .filter(segment => segment.text.trim().length > 0)
    .map(segment => ({
      start: Math.max(0, segment.start),
      end: Math.max(0, segment.end),
      text: segment.text.trim(),
    }))
    .filter(segment => segment.end > segment.start)
    .sort((left, right) => left.start - right.start)
}

/**
 * The part of a transcript a clip actually plays, expressed on the timeline.
 *
 * A clip shows the window `[trimStart, trimStart + duration × speed)` of its
 * media, so only the segments inside that window are on screen — and where
 * they land depends on both the clip's position and its speed, since a clip
 * played at 2× covers twice as much recording as its timeline duration says.
 *
 * Segments that straddle an edge are clipped to it rather than dropped: half a
 * sentence still tells the reader what is being said there.
 */
export function transcriptCuesForClip(
  transcript: AssetTranscript | undefined,
  clip: Pick<TimelineClip, 'startTime' | 'duration' | 'trimStart' | 'speed' | 'speedCurve'>,
): Array<{ startTime: number; endTime: number; text: string }> {
  if (!transcript) return []

  // A speed curve stretches some words and races through others, so the map
  // from recording to timeline goes through the curve, not a single factor.
  const windowStart = clip.trimStart
  const windowEnd = clip.trimStart + clipSourceSpan(clip)
  const toTimeline = (mediaSec: number) => clip.startTime + clipTimeAtSourceOffset(clip, mediaSec - windowStart)

  return transcript.segments
    .filter(segment => segment.end > windowStart && segment.start < windowEnd)
    .map(segment => ({
      startTime: toTimeline(Math.max(segment.start, windowStart)),
      endTime: toTimeline(Math.min(segment.end, windowEnd)),
      text: segment.text,
    }))
    .filter(cue => cue.endTime > cue.startTime)
}

/** Every clip's share of the stored transcripts, in timeline order. */
export function timelineTranscriptCues(
  transcripts: AssetTranscript[] | undefined,
  clips: ReadonlyArray<TimelineClip>,
): Array<{ startTime: number; endTime: number; text: string }> {
  const cues: Array<{ startTime: number; endTime: number; text: string }> = []
  for (const clip of clips) {
    const assetPath = clip.asset?.path
    if (!assetPath) continue
    cues.push(...transcriptCuesForClip(findAssetTranscript(transcripts, assetPath), clip))
  }
  return cues.sort((left, right) => left.startTime - right.startTime)
}

/**
 * Caption cues as a last-resort transcript.
 *
 * Worse than the real thing — smart chunking has already cut them into three-
 * to five-word scraps, so "a segment that is complete in meaning" is not
 * something a model can find in them — but a project captioned before this
 * store existed has nothing else, and scraps beat silence.
 */
export function subtitlesAsTranscriptCues(
  subtitles: ReadonlyArray<SubtitleClip>,
): Array<{ startTime: number; endTime: number; text: string }> {
  return subtitles.map(cue => ({
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: cue.text,
  }))
}
