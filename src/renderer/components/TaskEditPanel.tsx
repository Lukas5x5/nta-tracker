import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Task, Goal } from '../../shared/types'
import { useFlightStore } from '../stores/flightStore'
import { latLonToUTM, utmToLatLon, latLonToMGRS, getGridPrecision, gridRefToFullUTM } from '../utils/coordinatesWGS84'

interface TaskEditPanelProps {
  task: Task
  isOpen: boolean
  onClose: () => void
}

type MoveStepSize = 10 | 100 | 1000

export function TaskEditPanel({ task, isOpen, onClose }: TaskEditPanelProps) {
  const { settings, updateSettings, updateTask, goalDragMode, setGoalDragMode, activeCompetitionMap } = useFlightStore()
  const mapUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone
  const effectiveUtmZone = mapUtmZone || settings.utmZone || undefined
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState(() => {
    const savedX = settings.taskEditPanelPosition?.x ?? 100
    const savedY = settings.taskEditPanelPosition?.y ?? 100
    // Stelle sicher, dass Panel im sichtbaren Bereich startet
    return {
      x: Math.min(savedX, Math.max(0, window.innerWidth - 340)),
      y: Math.min(savedY, Math.max(0, window.innerHeight - 200))
    }
  })
  const [moveStepSize, setMoveStepSize] = useState<MoveStepSize>(100)
  const [editingEast, setEditingEast] = useState<string | null>(null)
  const [editingNorth, setEditingNorth] = useState<string | null>(null)
  const [coordsEditMode, setCoordsEditMode] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; isTouch: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Deaktiviere Drag-Modus wenn Panel geschlossen wird
  useEffect(() => {
    return () => {
      setGoalDragMode(false)
    }
  }, [])

  // Beim Öffnen und bei Fenster-Resize: Panel in sichtbaren Bereich zurückholen
  useEffect(() => {
    if (!isOpen) return

    const clampPosition = () => {
      setPosition(prev => {
        const maxX = Math.max(0, window.innerWidth - 80)
        const maxY = Math.max(0, window.innerHeight - 60)
        const minY = 0
        const newX = Math.max(0, Math.min(prev.x, maxX))
        const newY = Math.max(minY, Math.min(prev.y, maxY))
        if (newX !== prev.x || newY !== prev.y) {
          return { x: newX, y: newY }
        }
        return prev
      })
    }

    clampPosition()
    window.addEventListener('resize', clampPosition)
    return () => window.removeEventListener('resize', clampPosition)
  }, [isOpen])

  // Drag-and-drop handlers for panel (Mouse)
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return

    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: false
    }
  }

  // Drag-and-drop handlers for panel (Touch)
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return

    const touch = e.touches[0]
    if (!touch) return

    setIsDragging(true)
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: true
    }
  }

  useEffect(() => {
    if (!isDragging || !dragRef.current) return

    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY

      // Begrenze auf sichtbaren Bereich
      const maxX = window.innerWidth - 80
      const maxY = window.innerHeight - 60
      const minY = 0

      setPosition({
        x: Math.max(0, Math.min(maxX, dragRef.current.startPosX + dx)),
        y: Math.max(minY, Math.min(maxY, dragRef.current.startPosY + dy))
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
      // Speichere Panel-Position
      updateSettings({ taskEditPanelPosition: position })
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
  }, [isDragging])

  // Keyboard handler for moving task
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Nur wenn Drag-Modus aktiviert ist
      if (!goalDragMode) return

      // Ignoriere wenn ein Input-Feld fokussiert ist
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return

      e.preventDefault()

      const goal = task.goals[0]
      if (!goal) return

      // Berechne aktuelle UTM-Position (mit Zone der Wettkampfkarte)
      const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)
      let newEasting = utm.easting
      let newNorthing = utm.northing

      // Bewege basierend auf Pfeil und Step Size
      switch (e.key) {
        case 'ArrowUp':
          newNorthing += moveStepSize
          break
        case 'ArrowDown':
          newNorthing -= moveStepSize
          break
        case 'ArrowRight':
          newEasting += moveStepSize
          break
        case 'ArrowLeft':
          newEasting -= moveStepSize
          break
      }

      // Konvertiere zurück zu Lat/Lon
      const newLatLon = utmToLatLon({
        zone: utm.zone,
        hemisphere: utm.hemisphere,
        easting: newEasting,
        northing: newNorthing
      })

      // Update Goal Position
      const updatedGoals = task.goals.map(g =>
        g.id === goal.id
          ? {
              ...g,
              position: {
                ...g.position,
                latitude: newLatLon.lat,
                longitude: newLatLon.lon
              }
            }
          : g
      )

      // Update Task
      updateTask({ ...task, goals: updatedGoals })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, task, moveStepSize, updateTask, goalDragMode])

  if (!isOpen) return null

  // Panel Skalierung
  const scale = settings.taskEditPanelScale ?? 1

  // Hole das erste Goal des Tasks
  const goal = task.goals[0]
  if (!goal) return null

  // Berechne Grid Reference basierend auf Präzision (East/North getrennt)
  const { east: eastPrecision, north: northPrecision } = getGridPrecision(settings.coordinateFormat)

  // Verwende latLonToMGRS für korrekte Koordinaten-Berechnung (mit Zone der Wettkampfkarte)
  const mgrs = latLonToMGRS(goal.position.latitude, goal.position.longitude, eastPrecision as 4|5|6, northPrecision as 4|5|6, effectiveUtmZone)
  const eastStr = mgrs.easting
  const northStr = mgrs.northing

  // UTM wird noch für Keyboard-Navigation benötigt (mit Zone der Wettkampfkarte)
  const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '320px',
        maxWidth: '380px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.15)',
        zIndex: 10000,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 12px',
            background: task.markerColor || '#3b82f6',
            borderRadius: '6px',
            gap: '8px'
          }}>
            {task.taskNumber && (
              <span style={{
                color: 'white',
                fontWeight: 700,
                fontSize: '14px'
              }}>
                Task {task.taskNumber}:
              </span>
            )}
            <span style={{
              color: 'white',
              fontWeight: 600,
              fontSize: '14px'
            }}>
              {task.name}
            </span>
          </div>
          {/* Logger ID neben dem Task-Namen */}
          {task.loggerId && (
            <div style={{
              padding: '6px 10px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px',
              boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)'
            }}>
              {task.loggerId}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>

      {/* Position */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px'
        }}>
          <label style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.6)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 600
          }}>
            Position ({eastPrecision}/{northPrecision})
          </label>
          <button
            onClick={() => setCoordsEditMode(!coordsEditMode)}
            style={{
              padding: '4px 8px',
              background: coordsEditMode ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.1)',
              border: coordsEditMode ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              color: coordsEditMode ? '#f59e0b' : 'rgba(255,255,255,0.7)',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {coordsEditMode ? '✓ Fertig' : '✎ Bearbeiten'}
          </button>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px'
        }}>
          <div style={{
            padding: '12px',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: '10px',
            border: coordsEditMode ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(59, 130, 246, 0.3)'
          }}>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '6px',
              fontWeight: 500
            }}>
              EAST
            </div>
            {coordsEditMode ? (
              <input
                type="text"
                value={editingEast !== null ? editingEast : eastStr}
                onFocus={() => setEditingEast(eastStr)}
                onChange={(e) => {
                  const newEastStr = e.target.value.replace(/[^0-9]/g, '').slice(0, eastPrecision)
                  setEditingEast(newEastStr)
                }}
                onBlur={() => {
                  if (editingEast !== null && editingEast.length === eastPrecision) {
                    const { easting: newEasting } = gridRefToFullUTM(
                      editingEast, northStr,
                      eastPrecision as 4 | 5 | 6, northPrecision as 4 | 5 | 6,
                      utm.easting, utm.northing
                    )
                    const newLatLon = utmToLatLon({
                      zone: utm.zone,
                      hemisphere: utm.hemisphere,
                      easting: newEasting,
                      northing: utm.northing
                    })
                    const updatedGoals = task.goals.map(g =>
                      g.id === goal.id
                        ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } }
                        : g
                    )
                    updateTask({ ...task, goals: updatedGoals })
                  }
                  setEditingEast(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  borderRadius: '6px',
                  color: '#f59e0b',
                  fontSize: '20px',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: '2px',
                  outline: 'none',
                  textAlign: 'center',
                  height: '40px',
                  boxSizing: 'border-box'
                }}
              />
            ) : (
              <div style={{
                padding: '8px',
                color: '#3b82f6',
                fontSize: '20px',
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: '2px',
                textAlign: 'center',
                height: '40px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {eastStr}
              </div>
            )}
          </div>
          <div style={{
            padding: '12px',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: '10px',
            border: coordsEditMode ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(59, 130, 246, 0.3)'
          }}>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '6px',
              fontWeight: 500
            }}>
              NORTH
            </div>
            {coordsEditMode ? (
              <input
                type="text"
                value={editingNorth !== null ? editingNorth : northStr}
                onFocus={() => setEditingNorth(northStr)}
                onChange={(e) => {
                  const newNorthStr = e.target.value.replace(/[^0-9]/g, '').slice(0, northPrecision)
                  setEditingNorth(newNorthStr)
                }}
                onBlur={() => {
                  if (editingNorth !== null && editingNorth.length === northPrecision) {
                    const { northing: newNorthing } = gridRefToFullUTM(
                      eastStr, editingNorth,
                      eastPrecision as 4 | 5 | 6, northPrecision as 4 | 5 | 6,
                      utm.easting, utm.northing
                    )
                    const newLatLon = utmToLatLon({
                      zone: utm.zone,
                      hemisphere: utm.hemisphere,
                      easting: utm.easting,
                      northing: newNorthing
                    })
                    const updatedGoals = task.goals.map(g =>
                      g.id === goal.id
                        ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } }
                        : g
                    )
                    updateTask({ ...task, goals: updatedGoals })
                  }
                  setEditingNorth(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  borderRadius: '6px',
                  color: '#f59e0b',
                  fontSize: '20px',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: '2px',
                  outline: 'none',
                  textAlign: 'center',
                  height: '40px',
                  boxSizing: 'border-box'
                }}
              />
            ) : (
              <div style={{
                padding: '8px',
                color: '#3b82f6',
                fontSize: '20px',
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: '2px',
                textAlign: 'center',
                height: '40px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {northStr}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MMA und Ends At nebeneinander */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginBottom: '12px'
      }}>
        {/* MMA */}
        <div>
          <label style={{
            fontSize: '10px',
            color: 'rgba(255,255,255,0.5)',
            display: 'block',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            MMA
          </label>
          <div style={{
            padding: '8px 10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.1)',
            textAlign: 'center'
          }}>
            <span style={{
              fontSize: '14px',
              fontWeight: 700,
              color: task.mmaRadius && task.mmaRadius > 0 ? 'white' : 'rgba(255,255,255,0.4)'
            }}>
              {task.mmaRadius && task.mmaRadius > 0 ? `${task.mmaRadius}m` : '-'}
            </span>
          </div>
        </div>

        {/* Ends At */}
        <div>
          <label style={{
            fontSize: '10px',
            color: 'rgba(255,255,255,0.5)',
            display: 'block',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Ends At
          </label>
          <input
            type="time"
            value={task.endsAt || ''}
            onChange={(e) => {
              updateTask({ ...task, endsAt: e.target.value || undefined })
            }}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'rgba(0,0,0,0.3)',
              border: task.endsAt ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'monospace',
              outline: 'none',
              cursor: 'pointer',
              textAlign: 'center'
            }}
          />
        </div>
      </div>

      {/* Reminder - nur wenn Ends At gesetzt */}
      {task.endsAt && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '12px',
          padding: '8px',
          background: 'rgba(245, 158, 11, 0.1)',
          borderRadius: '6px'
        }}>
          <input
            type="checkbox"
            checked={task.reminderEnabled || false}
            onChange={(e) => updateTask({ ...task, reminderEnabled: e.target.checked })}
            style={{ width: '14px', height: '14px', accentColor: '#f59e0b', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>Erinnerung</span>
          <input
            type="number"
            min="1"
            max="60"
            value={task.reminderValue ?? settings.taskReminderValue ?? 5}
            onChange={(e) => updateTask({ ...task, reminderValue: parseInt(e.target.value) || 5 })}
            style={{
              width: '40px',
              padding: '4px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '4px',
              color: '#f59e0b',
              fontSize: '11px',
              fontWeight: 600,
              textAlign: 'center',
              outline: 'none'
            }}
          />
          <select
            value={task.reminderUnit ?? settings.taskReminderUnit ?? 'minutes'}
            onChange={(e) => updateTask({ ...task, reminderUnit: e.target.value as 'minutes' | 'seconds' })}
            style={{
              padding: '4px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '4px',
              color: '#f59e0b',
              fontSize: '10px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="minutes">min</option>
            <option value="seconds">sek</option>
          </select>
        </div>
      )}

      {/* Beschreibung */}
      {task.description && (
        <div style={{ marginBottom: '12px' }}>
          <label style={{
            fontSize: '10px',
            color: 'rgba(255,255,255,0.5)',
            display: 'block',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Beschreibung
          </label>
          <div style={{
            padding: '10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '12px',
            lineHeight: 1.5
          }}>
            {task.description}
          </div>
        </div>
      )}

      {/* Task verschieben - kompakt */}
      <div style={{
        marginTop: '12px',
        padding: '10px',
        background: goalDragMode ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.05)',
        borderRadius: '6px',
        border: `1px solid ${goalDragMode ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255,255,255,0.1)'}`,
        transition: 'all 0.2s'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Drag Mode Toggle */}
          <button
            onClick={(e) => {
              setGoalDragMode(!goalDragMode)
              ;(e.target as HTMLButtonElement).blur()
            }}
            style={{
              padding: '6px 10px',
              background: goalDragMode
                ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            {goalDragMode ? '🔓' : '🔒'} Verschieben
          </button>

          {/* Step Size Buttons */}
          <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
            {([10, 100, 1000] as MoveStepSize[]).map(step => (
              <button
                key={step}
                onClick={(e) => {
                  setMoveStepSize(step)
                  ;(e.target as HTMLButtonElement).blur()
                }}
                style={{
                  flex: 1,
                  padding: '5px 6px',
                  background: moveStepSize === step
                    ? '#10b981'
                    : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {step}m
              </button>
            ))}
          </div>
        </div>

        {goalDragMode && (
          <div style={{ marginTop: '8px' }}>
            {/* Pfeil-Buttons zum Verschieben (Stift/Touch) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              {/* Oben */}
              <button
                onClick={() => {
                  const goal = task.goals[0]
                  if (!goal) return
                  const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)
                  const newLatLon = utmToLatLon({ zone: utm.zone, hemisphere: utm.hemisphere, easting: utm.easting, northing: utm.northing + moveStepSize })
                  updateTask({ ...task, goals: task.goals.map(g => g.id === goal.id ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } } : g) })
                }}
                style={{
                  width: '36px', height: '28px', border: 'none', borderRadius: '4px',
                  background: 'rgba(245,158,11,0.25)', color: '#f59e0b', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                }}
              >▲</button>
              {/* Mitte: Links + Rechts */}
              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    const goal = task.goals[0]
                    if (!goal) return
                    const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)
                    const newLatLon = utmToLatLon({ zone: utm.zone, hemisphere: utm.hemisphere, easting: utm.easting - moveStepSize, northing: utm.northing })
                    updateTask({ ...task, goals: task.goals.map(g => g.id === goal.id ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } } : g) })
                  }}
                  style={{
                    width: '36px', height: '28px', border: 'none', borderRadius: '4px',
                    background: 'rgba(245,158,11,0.25)', color: '#f59e0b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                  }}
                >◀</button>
                <div style={{
                  width: '36px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.4)'
                }}>
                  {moveStepSize}m
                </div>
                <button
                  onClick={() => {
                    const goal = task.goals[0]
                    if (!goal) return
                    const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)
                    const newLatLon = utmToLatLon({ zone: utm.zone, hemisphere: utm.hemisphere, easting: utm.easting + moveStepSize, northing: utm.northing })
                    updateTask({ ...task, goals: task.goals.map(g => g.id === goal.id ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } } : g) })
                  }}
                  style={{
                    width: '36px', height: '28px', border: 'none', borderRadius: '4px',
                    background: 'rgba(245,158,11,0.25)', color: '#f59e0b', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                  }}
                >▶</button>
              </div>
              {/* Unten */}
              <button
                onClick={() => {
                  const goal = task.goals[0]
                  if (!goal) return
                  const utm = latLonToUTM(goal.position.latitude, goal.position.longitude, effectiveUtmZone)
                  const newLatLon = utmToLatLon({ zone: utm.zone, hemisphere: utm.hemisphere, easting: utm.easting, northing: utm.northing - moveStepSize })
                  updateTask({ ...task, goals: task.goals.map(g => g.id === goal.id ? { ...g, position: { ...g.position, latitude: newLatLon.lat, longitude: newLatLon.lon } } : g) })
                }}
                style={{
                  width: '36px', height: '28px', border: 'none', borderRadius: '4px',
                  background: 'rgba(245,158,11,0.25)', color: '#f59e0b', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'
                }}
              >▼</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
