import { useState, useCallback, useRef } from 'react'
import type { CoverElement } from './types'

export function useCoverHistory(initialElements: CoverElement[]) {
  const [elements, setElements] = useState<CoverElement[]>(initialElements)
  const [history, setHistory] = useState<CoverElement[][]>([])
  const [future, setFuture] = useState<CoverElement[][]>([])

  const elementsRef = useRef<CoverElement[]>(elements)
  elementsRef.current = elements

  const dragStartSnapshotRef = useRef<CoverElement[] | null>(null)

  const pushHistory = useCallback((newElements: CoverElement[]) => {
    setHistory(prev => [...prev.slice(-30), elementsRef.current])
    setFuture([])
    setElements(newElements)
  }, [])

  const handleStartTransform = useCallback(() => {
    dragStartSnapshotRef.current = elementsRef.current
  }, [])

  const handleCommitTransform = useCallback(() => {
    if (dragStartSnapshotRef.current) {
      const snapshot = dragStartSnapshotRef.current
      dragStartSnapshotRef.current = null
      setHistory(prev => [...prev.slice(-30), snapshot])
      setFuture([])
    }
  }, [])

  const handleUndo = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setFuture(f => [elementsRef.current, ...f])
    setElements(prev)
  }, [history])

  const handleRedo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setHistory(h => [...h, elementsRef.current])
    setElements(next)
  }, [future])

  return {
    elements,
    setElements,
    elementsRef,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    pushHistory,
    handleStartTransform,
    handleCommitTransform,
    handleUndo,
    handleRedo,
  }
}
