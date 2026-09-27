import { useState, useCallback, useEffect } from 'react'
import type { Asset, TimelineClip, Track } from '../../../types/project-model'
import { packMainVideoTrack, mainVideoTrackIndex, resolveOverlaps, type ToolType } from '../video-editor-utils'

export interface ResizingClipState {
  clipId: string
  edge: 'left' | 'right'
  startX: number
  originalStartTime: number
  originalDuration: number
  originalTrimStart: number
  originalTrimEnd: number
  tool: ToolType
  adjacentClipId?: string
  adjacentOrigDuration?: number
  adjacentOrigTrimStart?: number
  adjacentOrigTrimEnd?: number
  adjacentOrigStartTime?: number
  trackIndex: number
  track1Order?: string[]
}

interface UseTimelineResizeParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  pixelsPerSecond: number
  snapEnabled: boolean
  getCurrentTime: () => number
  getMaxClipDuration: (clip: TimelineClip) => number
  assets: Asset[]
  activeTool: ToolType
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  expandWithLinkedClips: (ids: Set<string>) => Set<string>
  activeTimeline: any
  setCurrentTime?: (time: number) => void
}

export function useTimelineResize({
  clips,
  setClips,
  tracks,
  pixelsPerSecond,
  snapEnabled,
  getCurrentTime,
  getMaxClipDuration,
  assets,
  activeTool,
  setSelectedClipIds,
  expandWithLinkedClips,
  activeTimeline,
  setCurrentTime,
}: UseTimelineResizeParams) {
  const [resizingClip, setResizingClip] = useState<ResizingClipState | null>(null)

  /**
   * How far left the left edge of a clip may be dragged.
   * Can go down to (originalStartTime - originalTrimStart / speed) to restore cut media at the in-point.
   */
  const earliestTrimStartTime = useCallback((
    clip: TimelineClip,
    originalStartTime: number,
    originalTrimStart: number,
  ): number => {
    if (!Number.isFinite(getMaxClipDuration(clip))) return 0
    return originalStartTime - (originalTrimStart / clip.speed)
  }, [getMaxClipDuration])

  const sourceDurationOf = useCallback((clip: TimelineClip): number | null => {
    const isTimeBasedMedia = clip.type === 'video' || clip.type === 'audio'
    if (!isTimeBasedMedia) return null
    const asset = (clip.assetId ? assets.find(candidate => candidate.id === clip.assetId) : null) ?? clip.asset
    return asset?.duration ?? null
  }, [assets])

  /**
   * The longest a clip can be made by dragging its right edge: everything from
   * its in-point to the end of the source.
   */
  const maxDurationFromInPoint = useCallback((clip: TimelineClip): number => {
    const sourceDuration = sourceDurationOf(clip)
    if (sourceDuration === null) return Infinity
    return Math.max(0.5, (sourceDuration - clip.trimStart) / clip.speed)
  }, [sourceDurationOf])

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingClip) return

    const clip = clips.find(c => c.id === resizingClip.clipId)
    if (!clip) return

    const deltaX = e.clientX - resizingClip.startX
    const deltaTime = deltaX / pixelsPerSecond

    // === ROLL TRIM (two-clip edit at junction) ===
    if (resizingClip.tool === 'roll' && resizingClip.adjacentClipId) {
      const adjacent = clips.find(c => c.id === resizingClip.adjacentClipId)
      if (!adjacent) return

      if (resizingClip.edge === 'right') {
        // Dragging right edge of this clip + left edge of adjacent clip
        let proposedDelta = deltaTime

        // Limit: can't shrink this clip below min duration (0.5s)
        const thisMinDur = 0.5
        proposedDelta = Math.max(-(resizingClip.originalDuration - thisMinDur), proposedDelta)
        // Limit: can't expand this clip beyond source media
        proposedDelta = Math.min(maxDurationFromInPoint(clip) - resizingClip.originalDuration, proposedDelta)

        // Limit: can't shrink adjacent clip below min duration
        const adjMinDur = 0.5
        const adjOrigDur = resizingClip.adjacentOrigDuration ?? adjacent.duration
        proposedDelta = Math.min(adjOrigDur - adjMinDur, proposedDelta)
        // Limit: can't roll left past adjacent clip's source start (trimStart >= 0)
        const adjOrigTrimStart = resizingClip.adjacentOrigTrimStart ?? adjacent.trimStart
        const maxRollLeft = adjOrigTrimStart / adjacent.speed
        proposedDelta = Math.max(-maxRollLeft, proposedDelta)

        const finalDelta = proposedDelta
        const newThisDuration = resizingClip.originalDuration + finalDelta
        const newAdjStart = (resizingClip.adjacentOrigStartTime ?? adjacent.startTime) + finalDelta
        const newAdjDuration = adjOrigDur - finalDelta
        const newAdjTrimStart = Math.max(0, adjOrigTrimStart + finalDelta * adjacent.speed)

        setClips(prev => prev.map(c => {
          if (c.id === clip.id) {
            return { ...c, duration: Math.max(0.5, newThisDuration) }
          }
          if (c.id === adjacent.id) {
            return {
              ...c,
              startTime: newAdjStart,
              duration: Math.max(0.5, newAdjDuration),
              trimStart: newAdjTrimStart,
            }
          }
          return c
        }))
      } else {
        // Dragging left edge of this clip + right edge of adjacent clip (before this one)
        let proposedDelta = deltaTime

        // Limit: can't shrink this clip below min duration
        proposedDelta = Math.min(resizingClip.originalDuration - 0.5, proposedDelta)
        // Limit: can't roll left past this clip's source start
        const maxRollLeft = resizingClip.originalTrimStart / clip.speed
        proposedDelta = Math.max(-maxRollLeft, proposedDelta)

        // Limit: can't shrink adjacent clip below min duration
        const adjOrigDur = resizingClip.adjacentOrigDuration ?? adjacent.duration
        proposedDelta = Math.max(-(adjOrigDur - 0.5), proposedDelta)
        // Limit: can't expand adjacent clip beyond source media
        proposedDelta = Math.min(maxDurationFromInPoint(adjacent) - adjOrigDur, proposedDelta)

        const finalDelta = proposedDelta
        const newThisStart = resizingClip.originalStartTime + finalDelta
        const newThisDuration = resizingClip.originalDuration - finalDelta
        const newThisTrimStart = Math.max(0, resizingClip.originalTrimStart + finalDelta * clip.speed)
        const newAdjDuration = adjOrigDur + finalDelta

        setClips(prev => prev.map(c => {
          if (c.id === clip.id) {
            return {
              ...c,
              startTime: newThisStart,
              duration: Math.max(0.5, newThisDuration),
              trimStart: newThisTrimStart,
            }
          }
          if (c.id === adjacent.id) {
            return { ...c, duration: Math.max(0.5, newAdjDuration) }
          }
          return c
        }))
      }
      return
    }

    // === MAGNETIC TRACK TRIM (Layer 1 / V1) ===
    // On magnetic track, clips sit end to end with no gaps or overlaps.
    // Every resize updates duration/trims and repacks via packMainVideoTrack in real time:
    // - Right edge:
    //   - Pushing left (deltaTime < 0): cuts video from right down to min 0.5s.
    //   - Pulling right (deltaTime > 0): restores cut video up to source media end (stops at end).
    //   - Downstream clips ripple left/right in real-time.
    // - Left edge:
    //   - Pushing right (deltaTime > 0): cuts video from start to drag position.
    //   - Pulling left (deltaTime < 0): restores cut video from start until trimStart reaches 0 (stops at start).
    const mainIndex = mainVideoTrackIndex(tracks)
    const effectiveMainIndex = mainIndex >= 0 ? mainIndex : 0
    const isMagnetic = clip.trackIndex === effectiveMainIndex

    if (isMagnetic && resizingClip.tool !== 'roll') {
      const sourceDuration = sourceDurationOf(clip)
      const currentTransitions = activeTimeline?.transitions ?? []
      const linkedIds = new Set<string>(clip.linkedClipIds || [])

      if (resizingClip.edge === 'right') {
        const maxDuration = sourceDuration !== null && sourceDuration > 0
          ? Math.max(0.5, (sourceDuration - resizingClip.originalTrimStart) / clip.speed)
          : Infinity

        let proposedDuration = resizingClip.originalDuration + deltaTime
        if (snapEnabled) {
          const snapThreshold = 0.2
          const newEndTime = resizingClip.originalStartTime + proposedDuration
          if (Math.abs(newEndTime - getCurrentTime()) < snapThreshold) {
            proposedDuration = getCurrentTime() - resizingClip.originalStartTime
          }
          for (const otherClip of clips) {
            if (otherClip.id === clip.id) continue
            if (Math.abs(newEndTime - otherClip.startTime) < snapThreshold) {
              proposedDuration = otherClip.startTime - resizingClip.originalStartTime
            }
          }
        }

        const newDuration = Math.max(0.5, Math.min(proposedDuration, maxDuration))
        const trimEnd = sourceDuration !== null && sourceDuration > 0
          ? Math.max(0, sourceDuration - resizingClip.originalTrimStart - newDuration * clip.speed)
          : clip.trimEnd

        setClips(prev => {
          const updated = prev.map(c => {
            if (c.id === clip.id || linkedIds.has(c.id)) {
              return { ...c, duration: newDuration, trimEnd }
            }
            return c
          })
          return packMainVideoTrack(tracks, updated, currentTransitions)
        })

        if (setCurrentTime) {
          setCurrentTime(Math.max(0, resizingClip.originalStartTime + newDuration - 0.04))
        }
        return
      } else {
        // Left edge on Track 1
        const minDelta = -resizingClip.originalTrimStart / clip.speed
        const maxDelta = resizingClip.originalDuration - 0.5
        let proposedDelta = deltaTime

        if (snapEnabled) {
          const snapThreshold = 0.2
          const proposedStartTime = resizingClip.originalStartTime + proposedDelta
          if (Math.abs(proposedStartTime - getCurrentTime()) < snapThreshold) {
            proposedDelta = getCurrentTime() - resizingClip.originalStartTime
          }
        }

        const clampedDelta = Math.max(minDelta, Math.min(maxDelta, proposedDelta))
        const newTrimStart = Math.max(0, resizingClip.originalTrimStart + clampedDelta * clip.speed)
        const newDuration = Math.max(0.5, resizingClip.originalDuration - clampedDelta)

        setClips(prev => {
          const updated = prev.map(c => {
            if (c.id === clip.id || linkedIds.has(c.id)) {
              return {
                ...c,
                duration: newDuration,
                trimStart: newTrimStart,
              }
            }
            return c
          })
          return packMainVideoTrack(tracks, updated, currentTransitions)
        })

        if (setCurrentTime) {
          setCurrentTime(Math.max(0, resizingClip.originalStartTime))
        }
        return
      }
    }

    // === RIPPLE TRIM (Overlay tracks) ===
    if (resizingClip.tool === 'ripple') {
      if (resizingClip.edge === 'left') {
        let newStartTime = resizingClip.originalStartTime + deltaTime
        const earliestStart = earliestTrimStartTime(clip, resizingClip.originalStartTime, resizingClip.originalTrimStart)
        newStartTime = Math.max(earliestStart, newStartTime)
        const maxStart = resizingClip.originalStartTime + resizingClip.originalDuration - 0.5
        newStartTime = Math.min(maxStart, newStartTime)

        const actualDelta = newStartTime - resizingClip.originalStartTime
        const newDuration = resizingClip.originalDuration - actualDelta
        const newTrimStart = Math.max(0, resizingClip.originalTrimStart + actualDelta * clip.speed)
        const rippleShift = -actualDelta

        const linkedIds = new Set<string>(clip.linkedClipIds || [])

        setClips(prev => prev.map(c => {
          if (c.id === clip.id || linkedIds.has(c.id)) {
            return { ...c, startTime: newStartTime, duration: Math.max(0.5, newDuration), trimStart: newTrimStart }
          }
          // Shift downstream clips on the same track (and linked clips)
          if (c.trackIndex === clip.trackIndex && c.startTime > resizingClip.originalStartTime) {
            return { ...c, startTime: Math.max(0, c.startTime + rippleShift) }
          }
          return c
        }))
      } else {
        // Ripple trim right edge
        let newDuration = resizingClip.originalDuration + deltaTime
        newDuration = Math.max(0.5, Math.min(newDuration, maxDurationFromInPoint(clip)))
        const durationDelta = newDuration - resizingClip.originalDuration

        const linkedIds = new Set<string>(clip.linkedClipIds || [])

        setClips(prev => prev.map(c => {
          if (c.id === clip.id || linkedIds.has(c.id)) {
            return { ...c, duration: newDuration }
          }
          if (c.trackIndex === clip.trackIndex && c.startTime >= resizingClip.originalStartTime + resizingClip.originalDuration - 0.05) {
            return { ...c, startTime: Math.max(0, c.startTime + durationDelta) }
          }
          return c
        }))
      }
      return
    }

    // === STANDARD TRIM (Overlay tracks) ===
    if (resizingClip.edge === 'left') {
      let newStartTime = resizingClip.originalStartTime + deltaTime
      const earliestStart = earliestTrimStartTime(
        clip,
        resizingClip.originalStartTime,
        resizingClip.originalTrimStart,
      )
      newStartTime = Math.max(earliestStart, newStartTime)
      const maxStart = resizingClip.originalStartTime + resizingClip.originalDuration - 0.5
      newStartTime = Math.min(maxStart, newStartTime)

      if (snapEnabled) {
        const snapThreshold = 0.2
        if (Math.abs(newStartTime - getCurrentTime()) < snapThreshold) {
          newStartTime = Math.max(earliestStart, Math.min(maxStart, getCurrentTime()))
        }
        for (const otherClip of clips) {
          if (otherClip.id === clip.id) continue
          if (Math.abs(newStartTime - otherClip.startTime) < snapThreshold) {
            newStartTime = Math.max(earliestStart, Math.min(maxStart, otherClip.startTime))
          }
          const otherEnd = otherClip.startTime + otherClip.duration
          if (Math.abs(newStartTime - otherEnd) < snapThreshold) {
            newStartTime = Math.max(earliestStart, Math.min(maxStart, otherEnd))
          }
        }
      }

      const actualDelta = newStartTime - resizingClip.originalStartTime
      const newDuration = resizingClip.originalDuration - actualDelta
      const newTrimStart = Math.max(0, resizingClip.originalTrimStart + actualDelta * clip.speed)

      const linkedIds = new Set<string>(clip.linkedClipIds || [])

      setClips(prev => prev.map(c => {
        if (c.id === clip.id || linkedIds.has(c.id)) {
          return {
            ...c,
            startTime: newStartTime,
            duration: Math.max(0.5, newDuration),
            trimStart: newTrimStart,
          }
        }
        return c
      }))
    } else {
      let newDuration = resizingClip.originalDuration + deltaTime

      if (snapEnabled) {
        const snapThreshold = 0.2
        const newEndTime = clip.startTime + newDuration

        if (Math.abs(newEndTime - getCurrentTime()) < snapThreshold) {
          newDuration = getCurrentTime() - clip.startTime
        }
        for (const otherClip of clips) {
          if (otherClip.id === clip.id) continue
          if (Math.abs(newEndTime - otherClip.startTime) < snapThreshold) {
            newDuration = otherClip.startTime - clip.startTime
          }
          const otherEnd = otherClip.startTime + otherClip.duration
          if (Math.abs(newEndTime - otherEnd) < snapThreshold) {
            newDuration = otherEnd - clip.startTime
          }
        }
      }

      newDuration = Math.min(newDuration, maxDurationFromInPoint(clip))

      const linkedIds = new Set<string>(clip.linkedClipIds || [])
      const finalDuration = Math.max(0.5, newDuration)

      const trimEndFor = (c: TimelineClip): number => {
        const sourceDuration = sourceDurationOf(c)
        if (sourceDuration === null) return c.trimEnd
        return Math.max(0, sourceDuration - c.trimStart - finalDuration * c.speed)
      }

      setClips(prev => prev.map(c => {
        if (c.id === clip.id || linkedIds.has(c.id)) {
          return { ...c, duration: finalDuration, trimEnd: trimEndFor(c) }
        }
        return c
      }))
    }
  }, [resizingClip, clips, pixelsPerSecond, snapEnabled, getCurrentTime, earliestTrimStartTime, maxDurationFromInPoint, sourceDurationOf, setClips, tracks, setCurrentTime])

  const handleResizeStart = useCallback((e: React.MouseEvent, clip: TimelineClip, edge: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()

    if (tracks[clip.trackIndex]?.locked) return

    setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))

    let adjacentClip: TimelineClip | undefined
    if (activeTool === 'roll') {
      const clipEnd = clip.startTime + clip.duration
      if (edge === 'right') {
        adjacentClip = clips.find(c => c.id !== clip.id && c.trackIndex === clip.trackIndex && Math.abs(c.startTime - clipEnd) < 0.05)
      } else {
        adjacentClip = clips.find(c => c.id !== clip.id && c.trackIndex === clip.trackIndex && Math.abs((c.startTime + c.duration) - clip.startTime) < 0.05)
      }
    }

    const mainIndex = mainVideoTrackIndex(tracks)
    const effectiveMainIndex = mainIndex >= 0 ? mainIndex : 0
    const isMagnetic = clip.trackIndex === effectiveMainIndex
    const track1Order = isMagnetic
      ? clips
          .filter(c => c.trackIndex === effectiveMainIndex)
          .sort((a, b) => a.startTime - b.startTime)
          .map(c => c.id)
      : undefined

    setResizingClip({
      clipId: clip.id,
      edge,
      startX: e.clientX,
      originalStartTime: clip.startTime,
      originalDuration: clip.duration,
      originalTrimStart: clip.trimStart,
      originalTrimEnd: clip.trimEnd,
      tool: activeTool,
      adjacentClipId: adjacentClip?.id,
      adjacentOrigDuration: adjacentClip?.duration,
      adjacentOrigTrimStart: adjacentClip?.trimStart,
      adjacentOrigTrimEnd: adjacentClip?.trimEnd,
      adjacentOrigStartTime: adjacentClip?.startTime,
      trackIndex: clip.trackIndex,
      track1Order,
    })
  }, [tracks, setSelectedClipIds, expandWithLinkedClips, activeTool, clips])

  const finalizeResize = useCallback(() => {
    if (resizingClip) {
      const currentTransitions = activeTimeline?.transitions ?? []
      const mainIndex = mainVideoTrackIndex(tracks)
      const effectiveMainIndex = mainIndex >= 0 ? mainIndex : 0
      const isMagnetic = resizingClip.trackIndex === effectiveMainIndex

      setClips(prev => {
        if (isMagnetic) {
          if (resizingClip.track1Order && resizingClip.track1Order.length > 0) {
            const orderMap = new Map<string, number>()
            resizingClip.track1Order.forEach((id, idx) => orderMap.set(id, idx))
            const track1Clips = prev
              .filter(c => c.trackIndex === effectiveMainIndex)
              .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

            const overlapAfter = new Map<string, number>()
            for (const transition of currentTransitions) {
              overlapAfter.set(transition.leftClipId, transition.duration)
            }
            const remappedTrack1 = new Map<string, TimelineClip>()
            const clipDeltas = new Map<string, number>()
            let currentCursor = 0

            for (const c of track1Clips) {
              const delta = currentCursor - c.startTime
              clipDeltas.set(c.id, delta)
              remappedTrack1.set(c.id, {
                ...c,
                startTime: currentCursor,
              })
              const overlap = Math.min(overlapAfter.get(c.id) ?? 0, c.duration)
              currentCursor += c.duration - overlap
            }

            return prev.map(c => {
              if (c.trackIndex === effectiveMainIndex) {
                return remappedTrack1.get(c.id) || c
              }
              if (c.linkedClipIds?.length) {
                for (const linkedId of c.linkedClipIds) {
                  if (clipDeltas.has(linkedId)) {
                    return {
                      ...c,
                      startTime: Math.max(0, c.startTime + clipDeltas.get(linkedId)!),
                    }
                  }
                }
              }
              return c
            })
          }
          return packMainVideoTrack(tracks, prev, currentTransitions)
        }

        const resolved = resolveOverlaps(prev, new Set([resizingClip.clipId]), currentTransitions, effectiveMainIndex)
        return packMainVideoTrack(tracks, resolved, currentTransitions)
      })
      setResizingClip(null)
    }
  }, [resizingClip, activeTimeline, setClips, tracks])

  useEffect(() => {
    if (resizingClip) {
      const onUp = () => finalizeResize()
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', handleResizeMove)
        window.removeEventListener('mouseup', onUp)
      }
    }
  }, [resizingClip, handleResizeMove, finalizeResize])

  return {
    resizingClip,
    setResizingClip,
    handleResizeStart,
    handleResizeMove,
    finalizeResize,
  }
}
