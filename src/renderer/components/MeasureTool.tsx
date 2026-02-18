import React, { useState, useRef, useEffect } from 'react'

interface MeasurePoint {
  lat: number
  lon: number
}

export type MeasureMode = 'distance' | 'area'

interface MeasureToolProps {
  isOpen: boolean
  onClose: () => void
  points: MeasurePoint[]
  onClear: () => void
  mode: MeasureMode
  onModeChange: (mode: MeasureMode) => void
  areaCompleted: boolean
  onAreaComplete: () => void
  color: string
  onColorChange: (color: string) => void
}

// Haversine Formel für Distanzberechnung
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Erdradius in Metern
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Bearing berechnen
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180

  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  let bearing = Math.atan2(y, x) * 180 / Math.PI
  bearing = (bearing + 360) % 360

  return bearing
}

// Fläche eines Polygons berechnen (Shoelace-Formel mit geodätischer Projektion)
function calculatePolygonArea(points: MeasurePoint[]): number {
  if (points.length < 3) return 0

  // Konvertiere zu Metern mit lokaler Projektion (mittlerer Breitengrad)
  const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const latToMeters = 111320 // ~111.32 km pro Grad Latitude
  const lonToMeters = 111320 * Math.cos(avgLat * Math.PI / 180)

  // Konvertiere Punkte zu lokalen Koordinaten in Metern
  const refLat = points[0].lat
  const refLon = points[0].lon
  const localPoints = points.map(p => ({
    x: (p.lon - refLon) * lonToMeters,
    y: (p.lat - refLat) * latToMeters
  }))

  // Shoelace-Formel für Flächenberechnung
  let area = 0
  const n = localPoints.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += localPoints[i].x * localPoints[j].y
    area -= localPoints[j].x * localPoints[i].y
  }
  area = Math.abs(area) / 2

  return area
}

// Umfang eines geschlossenen Polygons berechnen
function calculatePerimeter(points: MeasurePoint[]): number {
  if (points.length < 2) return 0
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length
    perimeter += calculateDistance(points[i].lat, points[i].lon, points[next].lat, points[next].lon)
  }
  return perimeter
}

export function MeasureTool({ isOpen, onClose, points, onClear, mode, onModeChange, areaCompleted, onAreaComplete, color, onColorChange }: MeasureToolProps) {
  // Position State für Drag
  const [position, setPosition] = useState({ x: 20, y: 200 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

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

  // Berechnungen für Distanzmodus
  const totalDistance = points.reduce((acc, point, index) => {
    if (index === 0) return 0
    const prevPoint = points[index - 1]
    return acc + calculateDistance(prevPoint.lat, prevPoint.lon, point.lat, point.lon)
  }, 0)

  const segments = points.slice(1).map((point, index) => {
    const prevPoint = points[index]
    const distance = calculateDistance(prevPoint.lat, prevPoint.lon, point.lat, point.lon)
    const bearing = calculateBearing(prevPoint.lat, prevPoint.lon, point.lat, point.lon)
    return { distance, bearing }
  })

  // Berechnungen für Flächenmodus
  const polygonArea = points.length >= 3 ? calculatePolygonArea(points) : 0
  const perimeter = points.length >= 3 ? calculatePerimeter(points) : 0

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`
    }
    return `${meters.toFixed(1)} m`
  }

  const formatArea = (sqMeters: number) => {
    // Immer in km² anzeigen
    const sqKm = sqMeters / 1000000
    if (sqKm < 0.001) {
      return `${sqKm.toFixed(6)} km²`
    }
    if (sqKm < 0.01) {
      return `${sqKm.toFixed(5)} km²`
    }
    if (sqKm < 0.1) {
      return `${sqKm.toFixed(4)} km²`
    }
    if (sqKm < 1) {
      return `${sqKm.toFixed(3)} km²`
    }
    return `${sqKm.toFixed(2)} km²`
  }

  // Modus wechseln und Messung löschen
  const handleModeChange = (newMode: MeasureMode) => {
    if (newMode !== mode) {
      onModeChange(newMode)
      onClear()
    }
  }

  // Fläche abschließen
  const handleCompleteArea = () => {
    if (points.length >= 3) {
      onAreaComplete()
    }
  }

  // Neue Messung starten
  const handleNewMeasurement = () => {
    onClear()
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '240px',
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
          <span style={{ fontSize: '14px' }}>{mode === 'distance' ? '📏' : '⬡'}</span>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'white' }}>
            {mode === 'distance' ? 'Distanz' : 'Fläche'}
          </span>
          {points.length > 0 && (
            <span style={{
              background: color,
              color: 'white',
              padding: '1px 6px',
              borderRadius: '8px',
              fontSize: '10px',
              fontWeight: 600
            }}>
              {points.length}
            </span>
          )}
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

      {/* Modus-Auswahl */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <button
          onClick={() => handleModeChange('distance')}
          style={{
            flex: 1,
            padding: '8px',
            background: mode === 'distance' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
            border: mode === 'distance' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid transparent',
            borderRadius: '6px',
            color: mode === 'distance' ? '#3b82f6' : 'rgba(255,255,255,0.6)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 22L22 2" />
            <path d="M6 18l2-2" />
            <path d="M10 14l2-2" />
            <path d="M14 10l2-2" />
            <path d="M18 6l2-2" />
          </svg>
          Distanz
        </button>
        <button
          onClick={() => handleModeChange('area')}
          style={{
            flex: 1,
            padding: '8px',
            background: mode === 'area' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
            border: mode === 'area' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid transparent',
            borderRadius: '6px',
            color: mode === 'area' ? '#22c55e' : 'rgba(255,255,255,0.6)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          </svg>
          Fläche
        </button>
      </div>

      {/* Farbauswahl */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>Farbe:</span>
        <input
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          style={{
            width: '28px',
            height: '22px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            background: 'transparent'
          }}
        />
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
          {color.toUpperCase()}
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: '12px' }}>
        {points.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '12px',
            padding: '16px 0'
          }}>
            {mode === 'distance'
              ? 'Klicke auf die Karte um Punkte zu setzen'
              : 'Klicke mindestens 3 Punkte für eine Fläche'}
          </div>
        ) : mode === 'distance' ? (
          /* Distanz-Modus Anzeige */
          <>
            {/* Gesamtdistanz */}
            <div style={{
              background: `${color}22`,
              border: `1px solid ${color}55`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: '4px',
                textTransform: 'uppercase'
              }}>
                Gesamtdistanz
              </div>
              <div style={{
                fontSize: '24px',
                fontWeight: 700,
                color: color,
                fontFamily: 'monospace'
              }}>
                {formatDistance(totalDistance)}
              </div>
            </div>

            {/* Segmente */}
            {segments.length > 0 && (
              <div style={{
                maxHeight: '120px',
                overflow: 'auto',
                marginBottom: '12px'
              }}>
                {segments.map((seg, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: '6px',
                      marginBottom: '4px',
                      fontSize: '11px'
                    }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {index + 1} → {index + 2}
                    </span>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <span style={{ color: color, fontFamily: 'monospace' }}>
                        {formatDistance(seg.distance)}
                      </span>
                      <span style={{ color: '#f59e0b', fontFamily: 'monospace' }}>
                        {seg.bearing.toFixed(0)}°
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Clear Button */}
            <button
              onClick={onClear}
              style={{
                width: '100%',
                padding: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Messung löschen
            </button>
          </>
        ) : (
          /* Flächen-Modus Anzeige */
          <>
            {!areaCompleted ? (
              /* Noch nicht abgeschlossen */
              <>
                <div style={{
                  background: `${color}22`,
                  border: `1px solid ${color}44`,
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '12px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '4px'
                  }}>
                    {points.length < 3
                      ? `Noch ${3 - points.length} Punkt${3 - points.length === 1 ? '' : 'e'} benötigt`
                      : 'Bereit zum Abschließen'}
                  </div>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: points.length >= 3 ? color : 'rgba(255,255,255,0.4)',
                    fontFamily: 'monospace'
                  }}>
                    {points.length >= 3 ? formatArea(polygonArea) : '---'}
                  </div>
                </div>

                {/* Punkte-Liste */}
                {points.length > 0 && (
                  <div style={{
                    maxHeight: '80px',
                    overflow: 'auto',
                    marginBottom: '12px'
                  }}>
                    {points.map((_, index) => (
                      <div
                        key={index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '4px 8px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '4px',
                          marginBottom: '2px',
                          fontSize: '11px',
                          color: 'rgba(255,255,255,0.6)'
                        }}
                      >
                        <span style={{
                          width: '18px',
                          height: '18px',
                          background: color,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'white'
                        }}>
                          {index + 1}
                        </span>
                        Punkt {index + 1}
                      </div>
                    ))}
                  </div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={onClear}
                    style={{
                      flex: 1,
                      padding: '8px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Löschen
                  </button>
                  <button
                    onClick={handleCompleteArea}
                    disabled={points.length < 3}
                    style={{
                      flex: 1,
                      padding: '8px',
                      background: points.length >= 3 ? `${color}33` : 'rgba(255,255,255,0.05)',
                      border: points.length >= 3 ? `1px solid ${color}66` : '1px solid transparent',
                      borderRadius: '6px',
                      color: points.length >= 3 ? color : 'rgba(255,255,255,0.3)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: points.length >= 3 ? 'pointer' : 'not-allowed'
                    }}
                  >
                    ✓ Fertig
                  </button>
                </div>
              </>
            ) : (
              /* Fläche abgeschlossen - Ergebnis anzeigen */
              <>
                {/* Fläche */}
                <div style={{
                  background: `${color}22`,
                  border: `1px solid ${color}55`,
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '4px',
                    textTransform: 'uppercase'
                  }}>
                    Fläche
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: color,
                    fontFamily: 'monospace'
                  }}>
                    {formatArea(polygonArea)}
                  </div>
                </div>

                {/* Info */}
                <div style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.5)',
                  textAlign: 'center',
                  marginBottom: '12px'
                }}>
                  {points.length} Eckpunkte
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={onClear}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Löschen
                  </button>
                  <button
                    onClick={handleNewMeasurement}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: `${color}22`,
                      border: `1px solid ${color}55`,
                      borderRadius: '6px',
                      color: color,
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Neue Messung
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Footer Hint */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.4)',
        textAlign: 'center'
      }}>
        Shift + Klick zum Messen
      </div>
    </div>
  )
}
