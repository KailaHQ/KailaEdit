import { useState, useCallback, useEffect } from 'react'
import type { TimelineClip } from '../../../types/project-model'

export interface SlipSlideClipState {
  clipId: string
  tool: 'slip' | 'slide'
  startX: number
  originalTrimStart: number
  originalTrimEnd: number
  originalStartTime: number
  originalDuration: number
  prevClipId?: string
  prevOrigDuration?: number
  nextClipId?: string
  nextOrigStartTime?: number
  nextOrigDuration?: number
  nextOrigTrimStart?: number
}

interface UseTimelineSlipSlideParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  pixelsPerSecond: number
}

export function useTimelineSlipSlide({
  clips,
  setClips,
  pixelsPerSecond,
}: UseTimelineSlipSlideParams) {
  const [slipSlideClip, setSlipSlideClip] = useState<SlipSlideClipState | null>(null)

  const handleSlipSlideMove = useCallback((e: MouseEvent) => {
    if (!slipSlideClip) return

    const clip = clips.find(c => c.id === slipSlideClip.clipId)
    if (!clip) return

    const deltaX = e.clientX - slipSlideClip.startX
    const deltaTime = deltaX / pixelsPerSecond

    if (slipSlideClip.tool === 'slip') {
      // SLIP: shift source content within the clip (change trimStart/trimEnd, keep position)
      // Moving right = shift source earlier = increase trimStart, decrease trimEnd
      if (clip.type !== 'video' || !clip.asset?.duration) return

      const mediaDuration = clip.asset.duration
      const shiftAmount = deltaTime * clip.speed // convert to media time

      let newTrimStart = slipSlideClip.originalTrimStart + shiftAmount
      let newTrimEnd = slipSlideClip.originalTrimEnd - shiftAmount

      // Clamp so neither goes negative
      if (newTrimStart < 0) {
        newTrimEnd += newTrimStart
        newTrimStart = 0
      }
      if (newTrimEnd < 0) {
        newTrimStart += newTrimEnd
        newTrimEnd = 0
      }

      // Ensure trimStart + trimEnd + visible media <= total media duration
      const visibleMedia = clip.duration * clip.speed
      if (newTrimStart + visibleMedia + newTrimEnd > mediaDuration) {
        return // Can't slip further
      }

      setClips(prev => prev.map(c =>
        c.id === clip.id ? { ...c, trimStart: Math.max(0, newTrimStart), trimEnd: Math.max(0, newTrimEnd) } : c
      ))
    } else {
      // SLIDE: move clip in time, adjust neighbor durations to fill the space
      let newStartTime = slipSlideClip.originalStartTime + deltaTime

      // Clamp: can't go before prevClip's start (or 0)
      const minStart = slipSlideClip.prevClipId
        ? clips.find(c => c.id === slipSlideClip.prevClipId)?.startTime ?? 0
        : 0
      // Clamp: can't go past nextClip's end (or infinity)
      const nextEnd = slipSlideClip.nextClipId
        ? (slipSlideClip.nextOrigStartTime ?? 0) + (slipSlideClip.nextOrigDuration ?? 0)
        : Infinity
      newStartTime = Math.max(minStart, Math.min(nextEnd - clip.duration, newStartTime))

      const actualDelta = newStartTime - slipSlideClip.originalStartTime

      setClips(prev => prev.map(c => {
        if (c.id === clip.id) {
          return { ...c, startTime: newStartTime }
        }
        // Adjust previous clip: extend its duration
        if (slipSlideClip.prevClipId && c.id === slipSlideClip.prevClipId) {
          const newDur = (slipSlideClip.prevOrigDuration ?? c.duration) + actualDelta
          return { ...c, duration: Math.max(0.5, newDur) }
        }
        // Adjust next clip: shift start and extend duration
        if (slipSlideClip.nextClipId && c.id === slipSlideClip.nextClipId) {
          const newStart = (slipSlideClip.nextOrigStartTime ?? c.startTime) + actualDelta
          const newDur = (slipSlideClip.nextOrigDuration ?? c.duration) - actualDelta
          const newTrimStart = (slipSlideClip.nextOrigTrimStart ?? c.trimStart) + actualDelta * c.speed
          return { ...c, startTime: newStart, duration: Math.max(0.5, newDur), trimStart: Math.max(0, newTrimStart) }
        }
        return c
      }))
    }
  }, [slipSlideClip, clips, pixelsPerSecond, setClips])

  const handleSlipSlideUp = useCallback(() => {
    setSlipSlideClip(null)
  }, [])

  useEffect(() => {
    if (slipSlideClip) {
      window.addEventListener('mousemove', handleSlipSlideMove)
      window.addEventListener('mouseup', handleSlipSlideUp)
      return () => {
        window.removeEventListener('mousemove', handleSlipSlideMove)
        window.removeEventListener('mouseup', handleSlipSlideUp)
      }
    }
  }, [slipSlideClip, handleSlipSlideMove, handleSlipSlideUp])

  return {
    slipSlideClip,
    setSlipSlideClip,
    handleSlipSlideMove,
    handleSlipSlideUp,
  }
}
