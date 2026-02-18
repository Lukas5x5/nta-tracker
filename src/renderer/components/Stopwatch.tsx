import React, { useState, useEffect, useRef } from 'react'

interface StopwatchProps {
  isOpen: boolean
  onClose: () => void
}

export function Stopwatch({ isOpen, onClose }: StopwatchProps) {
  const [time, setTime] = useState(0) // Zeit in Millisekunden
  const [isRunning, setIsRunning] = useState(false)
  const [laps, setLaps] = useState<number[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Position State für Drag
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime(prev => prev + 10)
      }, 10)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isRunning])

  // Drag handlers
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY
      setPosition({
        x: Math.max(0, dragRef.current.startPosX + dx),
        y: Math.max(0, dragRef.current.startPosY + dy)
      })
    }

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) handleMove(touch.clientX, touch.clientY)
    }
    const handleEnd = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging])

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    const touch = e.touches[0]
    if (!touch) return
    e.stopPropagation()
    setIsDragging(true)
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: position.x,
      startPosY: position.y
    }
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    const centiseconds = Math.floor((ms % 1000) / 10)

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
  }

  const handleStartStop = () => {
    setIsRunning(!isRunning)
  }

  const handleReset = () => {
    setIsRunning(false)
    setTime(0)
    setLaps([])
  }

  const handleLap = () => {
    if (isRunning) {
      setLaps(prev => [time, ...prev])
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '200px',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.15)',
        zIndex: 10000,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>⏱️</span>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'white' }}>Stoppuhr</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            width: '22px',
            height: '22px',
            borderRadius: '6px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>

      {/* Time Display */}
      <div style={{
        padding: '20px 12px',
        textAlign: 'center'
      }}>
        <div style={{
          fontSize: '32px',
          fontWeight: 700,
          fontFamily: 'monospace',
          color: isRunning ? '#22c55e' : 'white',
          letterSpacing: '2px',
          textShadow: isRunning ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none'
        }}>
          {formatTime(time)}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        padding: '0 12px 12px',
        display: 'flex',
        gap: '8px'
      }}>
        <button
          onClick={handleStartStop}
          style={{
            flex: 1,
            padding: '10px',
            background: isRunning
              ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
              : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {isRunning ? 'Stop' : 'Start'}
        </button>
        <button
          onClick={handleLap}
          disabled={!isRunning}
          style={{
            flex: 1,
            padding: '10px',
            background: isRunning ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isRunning ? 'pointer' : 'default',
            opacity: isRunning ? 1 : 0.5
          }}
        >
          Runde
        </button>
        <button
          onClick={handleReset}
          style={{
            padding: '10px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          ↺
        </button>
      </div>

      {/* Laps */}
      {laps.length > 0 && (
        <div style={{
          maxHeight: '120px',
          overflow: 'auto',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: '8px 12px'
        }}>
          {laps.map((lap, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.7)',
                borderBottom: index < laps.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
              }}
            >
              <span>Runde {laps.length - index}</span>
              <span style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{formatTime(lap)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
