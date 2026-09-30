import { useCallback, useMemo, useRef } from 'react'
import type { TimelineClip, TimelineTransition } from '../../../types/project-model'
import { CUT_TOLERANCE, findCutPoints, findJunctionNear, findJunctions, nearestCut } from '@core/timeline-cuts'
import { planBorrow } from '@core/timeline-transitions'
import { DEFAULT_TRANSITION_DURATION, MIN_TRANSITION_DURATION, maxTransitionDuration } from '@core/transitions'

export const EMPTY_TRANSITIONS: TimelineTransition[] = []

export const TRANSITION_GAP_SNAP_PX = 48
export const TRANSITION_GAP_SNAP_MAX_SECONDS = 1

export interface UseTimelineTransitionsOptions {
  clips: TimelineClip[]
  timelineTransitions?: TimelineTransition[]
  pixelsPerSecond: number
  defaultTransitionDuration?: number
  focusCut: (time: number) => void
  showTimelineNotice: (message: string) => void
  setTimelineTransition: (
    leftClipId: string,
    rightClipId: string,
    type: string,
    duration: number,
    closeGap?: number,
  ) => void
  t: (key: string, params?: Record<string, any>) => string
}

export function useTimelineTransitions({
  clips,
  timelineTransitions = EMPTY_TRANSITIONS,
  pixelsPerSecond,
  defaultTransitionDuration,
  focusCut,
  showTimelineNotice,
  setTimelineTransition,
  t,
}: UseTimelineTransitionsOptions) {
  const cutPoints = useMemo(
    () => findCutPoints(clips, timelineTransitions),
    [clips, timelineTransitions],
  )

  const transitionGapLimit = useMemo(
    () => Math.min(TRANSITION_GAP_SNAP_PX / pixelsPerSecond, TRANSITION_GAP_SNAP_MAX_SECONDS),
    [pixelsPerSecond],
  )

  const transitionDropTargets = useMemo(() => {
    const nearlyCuts = findJunctions(clips, transitionGapLimit)
      .filter(junction => junction.gap >= CUT_TOLERANCE)
      .map(junction => ({
        leftClip: junction.leftClip,
        rightClip: junction.rightClip,
        trackIndex: junction.trackIndex,
        time: junction.time,
        overlapStart: junction.time,
        overlapEnd: junction.time,
        transition: null,
      }))
    return nearlyCuts.length > 0 ? [...cutPoints, ...nearlyCuts] : cutPoints
  }, [clips, cutPoints, transitionGapLimit])

  const shiftWarnedRef = useRef(false)
  const warnIfClipsWillShift = useCallback((
    leftClip: TimelineClip,
    rightClip: TimelineClip,
    duration: number,
  ) => {
    if (planBorrow(leftClip, rightClip, duration).shortfall <= 0) return
    if (shiftWarnedRef.current) return
    shiftWarnedRef.current = true
    showTimelineNotice(t('transitions.clipsWillShift'))
  }, [showTimelineNotice, t])

  const applyTransitionAtPoint = useCallback((
    trackIndex: number,
    time: number,
    type: string,
    snapSeconds: number,
  ): boolean => {
    const trackCuts = cutPoints.filter(cut => cut.trackIndex === trackIndex)
    const cut = nearestCut(trackCuts, time, snapSeconds)
    if (cut) {
      if (maxTransitionDuration(
        cut.leftClip.duration,
        cut.rightClip.duration,
      ) < MIN_TRANSITION_DURATION) {
        showTimelineNotice(t('transitions.clipsTooShort'))
        return false
      }
      const duration = cut.transition?.duration ?? defaultTransitionDuration ?? DEFAULT_TRANSITION_DURATION
      setTimelineTransition(cut.leftClip.id, cut.rightClip.id, type, duration)
      focusCut(cut.time)
      warnIfClipsWillShift(cut.leftClip, cut.rightClip, duration)
      return true
    }

    const junction = findJunctionNear(clips, trackIndex, time, snapSeconds, transitionGapLimit)
    if (!junction) {
      showTimelineNotice(t('transitions.noJunctionHere'))
      return false
    }

    if (maxTransitionDuration(
      junction.leftClip.duration,
      junction.rightClip.duration,
    ) < MIN_TRANSITION_DURATION) {
      showTimelineNotice(t('transitions.clipsTooShort'))
      return false
    }

    const duration = defaultTransitionDuration ?? DEFAULT_TRANSITION_DURATION
    setTimelineTransition(
      junction.leftClip.id,
      junction.rightClip.id,
      type,
      duration,
      junction.gap,
    )
    focusCut(junction.leftClip.startTime + junction.leftClip.duration)
    if (junction.gap > 0) showTimelineNotice(t('transitions.gapClosed'))
    warnIfClipsWillShift(junction.leftClip, junction.rightClip, duration)
    return true
  }, [
    clips,
    cutPoints,
    defaultTransitionDuration,
    focusCut,
    setTimelineTransition,
    showTimelineNotice,
    t,
    transitionGapLimit,
    warnIfClipsWillShift,
  ])

  return {
    cutPoints,
    transitionGapLimit,
    transitionDropTargets,
    warnIfClipsWillShift,
    applyTransitionAtPoint,
  }
}
