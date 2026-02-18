import { useState, useRef, useEffect, useCallback } from 'react'

interface Position {
  x: number
  y: number
}

interface UsePanelDragOptions {
  position: Position
  onPositionChange: (pos: Position) => void
  enabled?: boolean
}

interface UsePanelDragResult {
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
  handleTouchStart: (e: React.TouchEvent) => void
}

/**
 * Hook für Panel-Dragging mit Mouse UND Touch Support
 */
export function usePanelDrag({
  position,
  onPositionChange,
  enabled = true
}: UsePanelDragOptions): UsePanelDragResult {
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    startPosX: number
    startPosY: number
    isTouch: boolean
  } | null>(null)

  // Prüfe ob Event auf interaktivem Element ist
  const isInteractiveElement = (target: HTMLElement): boolean => {
    return !!(
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('.no-drag')
    )
  }

  // Mouse Handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled) return
    const target = e.target as HTMLElement
    if (isInteractiveElement(target)) return

    e.preventDefault()
    e.stopPropagation()

    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: false
    }
  }, [enabled, position.x, position.y])

  // Touch Handler
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return
    const target = e.target as HTMLElement
    if (isInteractiveElement(target)) return

    // Nur ersten Touch verwenden
    const touch = e.touches[0]
    if (!touch) return

    // preventDefault nur wenn wir dragging starten (nicht auf interaktiven Elementen)
    e.stopPropagation()

    setIsDragging(true)
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: true
    }
  }, [enabled, position.x, position.y])

  // Global event listeners für move/end
  useEffect(() => {
    if (!isDragging || !dragRef.current) return

    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY
      onPositionChange({
        x: Math.max(0, dragRef.current.startPosX + dx),
        y: Math.max(0, dragRef.current.startPosY + dy)
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY)
    }

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) {
        handleMove(touch.clientX, touch.clientY)
      }
    }

    const handleEnd = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    // Event listeners basierend auf Drag-Typ
    if (dragRef.current.isTouch) {
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    } else {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging, onPositionChange])

  return {
    isDragging,
    handleMouseDown,
    handleTouchStart
  }
}
