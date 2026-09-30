import { useCallback, useMemo } from 'react'
import type { Track } from '../../../types/project-model'
import { trackRowHeight } from '@core/timeline-rows'

export interface UseTimelineTrackLayoutOptions {
  tracks: Track[]
  videoTrackHeight: number
  audioTrackHeight: number
  subtitleTrackHeight: number
  stickerTrackHeight: number
}

export function useTimelineTrackLayout({
  tracks,
  videoTrackHeight,
  audioTrackHeight,
  subtitleTrackHeight,
  stickerTrackHeight,
}: UseTimelineTrackLayoutOptions) {
  const orderedTracks: { track: Track; realIndex: number; displayRow: number }[] = useMemo(() => {
    const videoTracks: { track: Track; realIndex: number }[] = []
    const audioTracks: { track: Track; realIndex: number }[] = []
    const subtitleTracks: { track: Track; realIndex: number }[] = []

    tracks.forEach((track: Track, i: number) => {
      if (track.type === 'subtitle') subtitleTracks.push({ track, realIndex: i })
      else if (track.kind === 'audio') audioTracks.push({ track, realIndex: i })
      else videoTracks.push({ track, realIndex: i })
    })

    videoTracks.reverse()
    const ordered = [...subtitleTracks, ...videoTracks, ...audioTracks]
    return ordered.map((entry, displayRow) => ({ ...entry, displayRow }))
  }, [tracks])

  const trackDisplayRow = useMemo(() => {
    const map = new Map<number, number>()
    orderedTracks.forEach(entry => map.set(entry.realIndex, entry.displayRow))
    return map
  }, [orderedTracks])

  const rowHeights = useMemo(() => ({
    video: videoTrackHeight,
    audio: audioTrackHeight,
    subtitle: subtitleTrackHeight,
    sticker: stickerTrackHeight,
  }), [videoTrackHeight, audioTrackHeight, subtitleTrackHeight, stickerTrackHeight])

  const getTrackHeight = useCallback((trackIndex: number): number =>
    trackRowHeight(tracks[trackIndex], rowHeights), [tracks, rowHeights])

  const trackTopPx = useCallback((realTrackIndex: number, padding = 0): number => {
    const displayRow = trackDisplayRow.get(realTrackIndex) ?? realTrackIndex
    let top = 0
    for (let r = 0; r < displayRow; r++) {
      const entry = orderedTracks[r]
      if (entry) {
        top += trackRowHeight(entry.track, rowHeights)
      }
    }
    return top + padding
  }, [trackDisplayRow, orderedTracks, rowHeights])

  return {
    orderedTracks,
    trackDisplayRow,
    rowHeights,
    getTrackHeight,
    trackTopPx,
  }
}
