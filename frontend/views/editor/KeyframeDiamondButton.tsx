import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TimelineClip, KeyframeProperty } from '../../types/project-model'
import { getKeyframeTrack } from '@core/keyframes'
import { selectCurrentTime } from './editor-selectors'
import { useEditorActions, useEditorGetState, useEditorSubscribeToSlice } from './editor-store'

export interface KeyframeDiamondButtonProps {
  clip: TimelineClip
  property: KeyframeProperty
  currentValue: number
  className?: string
}

export const KeyframeDiamondButton: React.FC<KeyframeDiamondButtonProps> = ({
  clip,
  property,
  currentValue,
  className = '',
}) => {
  const { setKeyframe, removeKeyframeAt, setCurrentTime } = useEditorActions()
  const getState = useEditorGetState()
  const subscribeToSlice = useEditorSubscribeToSlice()

  const track = getKeyframeTrack(clip, property)
  const hasTrack = Boolean(track && track.points && track.points.length > 0)

  // Track whether playhead is on a keyframe point
  const [playheadState, setPlayheadState] = useState<{
    timeInClip: number
    isOnKeyframe: boolean
    activePointT: number | null
    isInsideClip: boolean
  }>(() => {
    const time = selectCurrentTime(getState())
    const timeInClip = time - clip.startTime
    const isInsideClip = timeInClip >= -0.05 && timeInClip <= clip.duration + 0.05
    const matchedPoint = track?.points.find(p => Math.abs(p.t - timeInClip) <= 0.08)
    return {
      timeInClip: Math.max(0, Math.min(clip.duration, timeInClip)),
      isOnKeyframe: Boolean(matchedPoint),
      activePointT: matchedPoint ? matchedPoint.t : null,
      isInsideClip,
    }
  })

  // Keep a ref to latest track and clip so the subscription callback is fresh
  const trackRef = useRef(track)
  trackRef.current = track
  const clipRef = useRef(clip)
  clipRef.current = clip

  const updateFromTime = useCallback((currentTime: number) => {
    const currentClip = clipRef.current
    const currentTrack = trackRef.current
    const timeInClip = currentTime - currentClip.startTime
    const isInsideClip = timeInClip >= -0.05 && timeInClip <= currentClip.duration + 0.05
    const clampedT = Math.max(0, Math.min(currentClip.duration, timeInClip))
    const matchedPoint = currentTrack?.points.find(p => Math.abs(p.t - clampedT) <= 0.08)
    setPlayheadState({
      timeInClip: clampedT,
      isOnKeyframe: Boolean(matchedPoint),
      activePointT: matchedPoint ? matchedPoint.t : null,
      isInsideClip,
    })
  }, [])

  useEffect(() => {
    updateFromTime(selectCurrentTime(getState()))
    return subscribeToSlice(selectCurrentTime, updateFromTime)
  }, [getState, subscribeToSlice, updateFromTime, clip.id, track])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!playheadState.isInsideClip) return

    if (playheadState.isOnKeyframe && playheadState.activePointT !== null) {
      removeKeyframeAt(clip.id, property, playheadState.activePointT)
    } else {
      setKeyframe(clip.id, property, playheadState.timeInClip, currentValue, 'linear')
    }
  }

  // Find previous and next keyframe points relative to current playhead
  const sortedPoints = track?.points ? [...track.points].sort((a, b) => a.t - b.t) : []
  const prevPoint = sortedPoints
    .filter(p => p.t < playheadState.timeInClip - 0.04)
    .pop()
  const nextPoint = sortedPoints.find(p => p.t > playheadState.timeInClip + 0.04)

  const handlePrevKeyframe = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!prevPoint) return
    setCurrentTime(clip.startTime + prevPoint.t)
  }

  const handleNextKeyframe = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!nextPoint) return
    setCurrentTime(clip.startTime + nextPoint.t)
  }

  const { isInsideClip, isOnKeyframe } = playheadState

  const tooltip = !isInsideClip
    ? 'Playhead is outside this clip'
    : isOnKeyframe
      ? 'Remove keyframe at playhead'
      : hasTrack
        ? 'Add keyframe at playhead'
        : 'Enable keyframing for this property'

  const diamondButton = (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isInsideClip}
      title={tooltip}
      className={`inline-flex items-center justify-center w-4 h-5 rounded hover:bg-zinc-800/80 transition-colors ${
        !isInsideClip ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" className="flex-shrink-0">
        <polygon
          points="6,1 11,6 6,11 1,6"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className={
            isOnKeyframe
              ? 'fill-cyan-400 stroke-cyan-400 hover:fill-cyan-300 hover:stroke-cyan-300'
              : hasTrack
                ? 'fill-transparent stroke-cyan-400 hover:fill-cyan-400/30'
                : 'fill-transparent stroke-zinc-500 hover:stroke-cyan-400'
          }
        />
      </svg>
    </button>
  )

  return (
    <div className={`inline-flex items-center justify-end gap-0.5 rounded px-0.5 select-none ${className}`}>
      <button
        type="button"
        onClick={handlePrevKeyframe}
        disabled={!prevPoint || !isInsideClip}
        title={prevPoint ? `Previous keyframe (${(clip.startTime + prevPoint.t).toFixed(2)}s)` : 'No previous keyframe'}
        className={`inline-flex items-center justify-center w-2.5 h-5 rounded transition-colors ${
          !prevPoint || !isInsideClip ? 'opacity-20 cursor-default text-zinc-600' : 'cursor-pointer text-zinc-400 hover:text-cyan-400'
        }`}
      >
        <ChevronLeft className="w-2.5 h-2.5" />
      </button>

      {diamondButton}

      <button
        type="button"
        onClick={handleNextKeyframe}
        disabled={!nextPoint || !isInsideClip}
        title={nextPoint ? `Next keyframe (${(clip.startTime + nextPoint.t).toFixed(2)}s)` : 'No next keyframe'}
        className={`inline-flex items-center justify-center w-2.5 h-5 rounded transition-colors ${
          !nextPoint || !isInsideClip ? 'opacity-20 cursor-default text-zinc-600' : 'cursor-pointer text-zinc-400 hover:text-cyan-400'
        }`}
      >
        <ChevronRight className="w-2.5 h-2.5" />
      </button>
    </div>
  )
}

