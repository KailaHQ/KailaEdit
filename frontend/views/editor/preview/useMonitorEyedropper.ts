import React from 'react'
import type { TimelineClip } from '../../../types/project-model'
import { isImageClip } from './preview-frame-engine'

export interface UseMonitorEyedropperOptions {
  selectedClip: TimelineClip | null
  activeClip: TimelineClip | null
  videoFrameWrapperRef: React.RefObject<HTMLDivElement>
  activeImageRef: React.RefObject<HTMLImageElement | null>
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  activePoolPathRef: React.MutableRefObject<string>
  setClipChromaKey: (clipId: string, chromaKey: { color: string; enabled: boolean }) => void
  setEyedropperMode: (mode: boolean) => void
}

export function useMonitorEyedropper({
  selectedClip,
  activeClip,
  videoFrameWrapperRef,
  activeImageRef,
  videoPoolRef,
  activePoolPathRef,
  setClipChromaKey,
  setEyedropperMode,
}: UseMonitorEyedropperOptions) {
  const sampleColorAtEvent = React.useCallback((e: React.MouseEvent) => {
    if (!selectedClip) {
      setEyedropperMode(false)
      return
    }

    const wrapper = videoFrameWrapperRef.current
    if (!wrapper) {
      setEyedropperMode(false)
      return
    }

    const rect = wrapper.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      setEyedropperMode(false)
      return
    }

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    let sourceEl: HTMLImageElement | HTMLVideoElement | null = null
    if (activeClip && isImageClip(activeClip)) {
      sourceEl = activeImageRef.current
    } else if (activeClip?.asset?.type === 'video') {
      sourceEl = videoPoolRef.current.get(activePoolPathRef.current) ?? null
    }

    if (!sourceEl) {
      setEyedropperMode(false)
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const sw = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.naturalWidth) || 640
      const sh = (sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.naturalHeight) || 360
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(sourceEl, 0, 0, sw, sh)
        const px = Math.min(sw - 1, Math.max(0, Math.floor(normX * sw)))
        const py = Math.min(sh - 1, Math.max(0, Math.floor(normY * sh)))
        const pixel = ctx.getImageData(px, py, 1, 1).data
        const r = pixel[0].toString(16).padStart(2, '0')
        const g = pixel[1].toString(16).padStart(2, '0')
        const b = pixel[2].toString(16).padStart(2, '0')
        const hex = `#${r}${g}${b}`.toUpperCase()
        setClipChromaKey(selectedClip.id, { color: hex, enabled: true })
      }
    } catch (err) {
      console.warn('[ProgramMonitor] Eyedropper sample failed:', err)
    } finally {
      setEyedropperMode(false)
    }
  }, [activeClip, selectedClip, setClipChromaKey, setEyedropperMode, videoFrameWrapperRef, activeImageRef, videoPoolRef, activePoolPathRef])

  return { sampleColorAtEvent }
}
