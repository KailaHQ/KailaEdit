import React, { useState, useRef, useEffect, useCallback } from 'react'

export interface AssetLassoState {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export function useAssetLasso(
  assetGridRef: React.RefObject<HTMLDivElement | null>,
  selectedAssetIds: Set<string>,
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
) {
  const [assetLasso, setAssetLasso] = useState<AssetLassoState | null>(null)
  const assetLassoRef = useRef(assetLasso)
  assetLassoRef.current = assetLasso
  const assetLassoPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const assetLassoBaseSelectionRef = useRef<Set<string>>(new Set())
  const assetLassoAutoScrollFrameRef = useRef<number | null>(null)

  const updateAssetLassoSelection = useCallback((clientX: number, clientY: number) => {
    const currentLasso = assetLassoRef.current
    const container = assetGridRef.current
    if (!currentLasso || !container) return

    const rect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop
    const x = clientX - rect.left
    const y = clientY - rect.top + scrollTop

    setAssetLasso({
      ...currentLasso,
      currentX: x,
      currentY: y,
    })

    const lassoLeft = Math.min(currentLasso.startX, x)
    const lassoRight = Math.max(currentLasso.startX, x)
    const lassoTop = Math.min(currentLasso.startY, y)
    const lassoBottom = Math.max(currentLasso.startY, y)
    const nextSelected = new Set(assetLassoBaseSelectionRef.current)
    const cards = container.querySelectorAll<HTMLElement>('[data-asset-card]')

    cards.forEach(card => {
      const cardRect = card.getBoundingClientRect()
      const cardLeft = cardRect.left - rect.left
      const cardRight = cardRect.right - rect.left
      const cardTop = cardRect.top - rect.top + scrollTop
      const cardBottom = cardRect.bottom - rect.top + scrollTop

      if (cardLeft < lassoRight && cardRight > lassoLeft && cardTop < lassoBottom && cardBottom > lassoTop) {
        const id = card.dataset.assetId
        if (id) nextSelected.add(id)
      }
    })

    setSelectedAssetIds(nextSelected)
  }, [assetGridRef, setSelectedAssetIds])

  const tickAssetLassoAutoScroll = useCallback(() => {
    assetLassoAutoScrollFrameRef.current = null

    const currentLasso = assetLassoRef.current
    const pointer = assetLassoPointerRef.current
    const container = assetGridRef.current
    if (!currentLasso || !pointer || !container) return

    const rect = container.getBoundingClientRect()
    const edgeThreshold = 28
    const maxStep = 18
    let scrollDelta = 0

    if (pointer.clientY < rect.top + edgeThreshold) {
      const distance = rect.top + edgeThreshold - pointer.clientY
      scrollDelta = -Math.min(maxStep, Math.max(4, distance * 0.35))
    } else if (pointer.clientY > rect.bottom - edgeThreshold) {
      const distance = pointer.clientY - (rect.bottom - edgeThreshold)
      scrollDelta = Math.min(maxStep, Math.max(4, distance * 0.35))
    }

    if (scrollDelta !== 0) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop + scrollDelta))
      if (nextScrollTop !== container.scrollTop) {
        container.scrollTop = nextScrollTop
        updateAssetLassoSelection(pointer.clientX, pointer.clientY)
      }
    }

    if (assetLassoRef.current) {
      assetLassoAutoScrollFrameRef.current = requestAnimationFrame(tickAssetLassoAutoScroll)
    }
  }, [assetGridRef, updateAssetLassoSelection])

  useEffect(() => {
    if (!assetLasso) return

    const handleMouseMove = (event: MouseEvent) => {
      assetLassoPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
      updateAssetLassoSelection(event.clientX, event.clientY)
    }

    const handleMouseUp = () => {
      setAssetLasso(null)
      assetLassoPointerRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    assetLassoAutoScrollFrameRef.current = requestAnimationFrame(tickAssetLassoAutoScroll)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (assetLassoAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(assetLassoAutoScrollFrameRef.current)
        assetLassoAutoScrollFrameRef.current = null
      }
    }
  }, [assetLasso, tickAssetLassoAutoScroll, updateAssetLassoSelection])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-asset-card]')) return
    if (e.button !== 0) return
    const container = assetGridRef.current
    const rect = container?.getBoundingClientRect()
    if (!rect) return
    const additiveSelection = e.ctrlKey || e.metaKey || e.shiftKey
    const scrollTop = container?.scrollTop || 0
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top + scrollTop
    setAssetLasso({ startX: x, startY: y, currentX: x, currentY: y })
    assetLassoPointerRef.current = { clientX: e.clientX, clientY: e.clientY }
    assetLassoBaseSelectionRef.current = additiveSelection ? new Set(selectedAssetIds) : new Set()
    if (!additiveSelection) setSelectedAssetIds(new Set())
  }, [assetGridRef, selectedAssetIds, setSelectedAssetIds])

  return {
    assetLasso,
    handleMouseDown,
  }
}
