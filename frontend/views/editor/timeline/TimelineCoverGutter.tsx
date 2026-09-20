import React from 'react'
import type { Track, TimelineCover } from '@core/project-model'
import { trackRowHeight } from '@core/timeline-rows'
import { TimelineCoverButton } from '../cover/TimelineCoverButton'

export interface TimelineCoverGutterProps {
  coverGutterRef?: React.RefObject<HTMLDivElement>
  orderedTracks: { track: Track; realIndex: number; displayRow: number }[]
  tracks: Track[]
  rowHeights: { video: number; audio: number; subtitle: number; sticker: number }
  cover?: TimelineCover
  onOpenCoverPicker?: () => void
  onRemoveCover?: () => void
}

export const TimelineCoverGutter: React.FC<TimelineCoverGutterProps> = ({
  coverGutterRef,
  orderedTracks,
  tracks,
  rowHeights,
  cover,
  onOpenCoverPicker,
  onRemoveCover,
}) => {
  const primaryVideoTrackIndex = tracks.findIndex(t => t.kind === 'video' && t.type !== 'subtitle')

  return (
    <div
      ref={coverGutterRef}
      className="w-[64px] flex-shrink-0 flex flex-col bg-zinc-950 overflow-hidden select-none z-10"
    >
      {/* Spacer matching the add-track button bar height */}
      <div className="flex-shrink-0 h-7 border-b border-zinc-700/50 bg-zinc-900/30" />

      {/* Track rows container matching trackHeaders vertical layout */}
      <div className="flex flex-1 flex-col overflow-hidden select-none">
        <div className="my-auto">
          {orderedTracks.map(({ track, realIndex }) => {
            const isPrimaryVideoTrack =
              track.kind === 'video' &&
              track.type !== 'subtitle' &&
              (track.name === 'V1' || realIndex === primaryVideoTrackIndex)

            const h = trackRowHeight(track, rowHeights)

            return (
              <div
                key={track.id}
                style={{ height: h }}
                className="border-b border-zinc-800/60 flex items-center justify-center relative bg-zinc-950 flex-shrink-0"
              >
                {isPrimaryVideoTrack && onOpenCoverPicker && (
                  <TimelineCoverButton
                    cover={cover}
                    onClick={onOpenCoverPicker}
                    onRemoveCover={onRemoveCover}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
