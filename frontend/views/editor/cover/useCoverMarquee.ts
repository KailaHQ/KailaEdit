import { useState, useRef, useCallback } from 'react'
import type { CoverElement } from './types'
import { isCoverBackground } from './cover-to-overlay'

export function useCoverMarquee(
  containerRef: React.RefObject<HTMLDivElement>,
  elementsRef: React.MutableRefObject<CoverElement[]>,
  setSelectedElementId: (id: string | null) => void,
  setInlineEditingId: (id: string | null) => void,
) {
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([])
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const multiSelectedIdsRef = useRef(multiSelectedIds)
  multiSelectedIdsRef.current = multiSelectedIds

  const handleStartMarquee = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const container = containerRef.current
    if (!container) return
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    let hits: string[] = []

    const update = (clientX: number, clientY: number) => {
      const left = Math.min(startX, clientX)
      const right = Math.max(startX, clientX)
      const top = Math.min(startY, clientY)
      const bottom = Math.max(startY, clientY)
      const box = container.getBoundingClientRect()
      setMarquee({
        left: left - box.left + container.scrollLeft,
        top: top - box.top + container.scrollTop,
        width: right - left,
        height: bottom - top,
      })

      hits = elementsRef.current
        .filter(el => !isCoverBackground(el) && el.visible !== false && !el.isLocked)
        .filter(el => {
          const node = document.getElementById(`cover-el-${el.id}`)
          if (!node) return false
          const r = node.getBoundingClientRect()
          return r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom
        })
        .map(el => el.id)
      setMultiSelectedIds(prev => (prev.length === hits.length && prev.every((id, i) => id === hits[i]) ? prev : hits))
    }

    const onMove = (ev: MouseEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        moved = true
        setSelectedElementId(null)
        setInlineEditingId(null)
      }
      update(ev.clientX, ev.clientY)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMarquee(null)
      if (!moved) return
      if (hits.length === 1) {
        setSelectedElementId(hits[0])
        setMultiSelectedIds([])
      } else {
        setMultiSelectedIds(hits)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [containerRef, elementsRef, setInlineEditingId, setSelectedElementId])

  return {
    multiSelectedIds,
    setMultiSelectedIds,
    multiSelectedIdsRef,
    marquee,
    handleStartMarquee,
  }
}
