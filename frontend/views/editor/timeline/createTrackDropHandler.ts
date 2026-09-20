import React from 'react'
import type { Asset, TimelineClip, Track } from '../../../types/project-model'
import { migrateClip } from '../video-editor-utils'

/** How close to a junction a dropped transition has to land to count. */
const TRANSITION_DROP_SNAP_PX = 48

export interface TrackDropParams {
  pixelsPerSecond: number
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  assets: Asset[]
  timelines: any[]
  activeTimeline: any
  trackContainerRef: React.RefObject<HTMLDivElement>
  addClipToTimeline: (asset: Asset, trackIndex?: number, startTime?: number) => void
  applyTransitionAtPoint?: (trackIndex: number, time: number, type: string, snapSeconds: number) => boolean
  addFilterClip?: (params: { filterId: string; startTime?: number; trackIndex?: number }) => void
}

/**
 * Build the handler for dropping an asset, filter, transition, or timeline onto a track.
 *
 * This is extracted from `useTimelineDrag` to keep the hook file smaller while
 * remaining a plain function (no hooks) so it can be called from a regular
 * event handler.
 */
export function createTrackDropHandler(params: TrackDropParams) {
  const {
    pixelsPerSecond,
    setClips,
    tracks,
    assets,
    timelines,
    activeTimeline,
    trackContainerRef,
    addClipToTimeline,
    applyTransitionAtPoint,
    addFilterClip,
  } = params

  return (e: React.DragEvent, trackIndex: number) => {
    e.preventDefault()

    // Check if it's a filter being dropped
    const filterId = e.dataTransfer.getData('filterId') ||
      e.dataTransfer.getData('application/x-komfyedit-filter')
    if (filterId && trackContainerRef.current && addFilterClip) {
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const dropTime = Math.max(0, x / pixelsPerSecond)
      // A filter is an adjustment layer: if dropped on main video track (0) or negative,
      // leave trackIndex undefined so addFilterClip puts it on the topmost overlay layer!
      const targetTrack = (trackIndex > 0) ? trackIndex : undefined
      addFilterClip({
        filterId,
        startTime: dropTime,
        trackIndex: targetTrack,
      })
      return
    }

    // Check if it's a transition being dropped near a junction on this track
    const transitionType = e.dataTransfer.getData('transitionType') ||
      e.dataTransfer.getData('application/x-komfyedit-transition') ||
      e.dataTransfer.getData('text/plain')
    if (transitionType && trackContainerRef.current && applyTransitionAtPoint && trackIndex >= 0) {
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const dropTime = Math.max(0, x / pixelsPerSecond)

      if (applyTransitionAtPoint(
        trackIndex,
        dropTime,
        transitionType,
        TRANSITION_DROP_SNAP_PX / pixelsPerSecond,
      )) {
        return
      }
    }
    
    // Check if it's a timeline being dropped (flatten on drop)
    const timelineData = e.dataTransfer.getData('timeline')
    if (timelineData && trackContainerRef.current) {
      const droppedTimeline = JSON.parse(timelineData) as { id: string; name: string }
      const sourceTimeline = timelines.find(t => t.id === droppedTimeline.id)
      if (!sourceTimeline || sourceTimeline.id === activeTimeline?.id) return
      if (sourceTimeline.clips.length === 0) return
      
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const dropTime = Math.max(0, x / pixelsPerSecond)
      
      // Flatten: copy all clips from the source timeline, offset to drop position
      // Find the earliest clip start in the source to compute relative offsets
      const earliestStart = sourceTimeline.clips.reduce(
        (min: number, c: any) => Math.min(min, c.startTime), Infinity
      )
      
      const newClips = sourceTimeline.clips.map((srcClip: any) => migrateClip({
        ...srcClip,
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        startTime: dropTime + (srcClip.startTime - earliestStart),
        // Remap trackIndex: offset by the drop track, but keep relative spacing
        trackIndex: Math.min(trackIndex + srcClip.trackIndex, tracks.length - 1),
      }))
      
      setClips(prev => [...prev, ...newClips])
      return
    }
    
    // Multi-asset drop (from multi-select drag) — add sequentially using addClipToTimeline
    const assetIdsJson = e.dataTransfer.getData('assetIds')
    if (assetIdsJson && trackContainerRef.current) {
      try {
        const ids: string[] = JSON.parse(assetIdsJson)
        const droppedAssets = ids.map(id => assets.find(a => a.id === id)).filter(Boolean) as Asset[]
        if (droppedAssets.length > 0) {
          const rect = trackContainerRef.current.getBoundingClientRect()
          const scrollLeft = trackContainerRef.current.scrollLeft
          const x = e.clientX - rect.left + scrollLeft
          let nextStart = Math.max(0, x / pixelsPerSecond)
          for (const a of droppedAssets) {
            addClipToTimeline(a, trackIndex, nextStart)
            nextStart += a.duration || 5
          }
          return
        }
      } catch { /* ignore parse errors */ }
    }
    
    // Single asset drop
    const assetId = e.dataTransfer.getData('assetId')
    const assetData = e.dataTransfer.getData('asset')
    
    let asset: Asset | undefined
    if (assetData) {
      asset = JSON.parse(assetData)
    } else if (assetId) {
      asset = assets.find(a => a.id === assetId)
    }
    
    if (asset && trackContainerRef.current) {
      const rect = trackContainerRef.current.getBoundingClientRect()
      const scrollLeft = trackContainerRef.current.scrollLeft
      const x = e.clientX - rect.left + scrollLeft
      const startTime = Math.max(0, x / pixelsPerSecond)
      addClipToTimeline(asset, trackIndex, startTime)
    }
  }
}
