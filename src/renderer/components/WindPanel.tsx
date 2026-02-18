import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { WindLayer, WindSource } from '../../shared/types'

// Windstärke-Farbcodierung (Beaufort-Skala angepasst)
const getWindColor = (speedKmh: number): string => {
  if (speedKmh < 10) return '#22c55e' // Leicht - Grün
  if (speedKmh < 20) return '#84cc16' // Mäßig - Hellgrün
  if (speedKmh < 30) return '#eab308' // Frisch - Gelb
  if (speedKmh < 40) return '#f97316' // Stark - Orange
  if (speedKmh < 50) return '#ef4444' // Sehr stark - Rot
  return '#dc2626' // Stürmisch - Dunkelrot
}

// Höhenbasierte Farbcodierung (niedrig=grün, mittel=gelb/orange, hoch=blau/lila)
const getAltitudeColor = (altitudeM: number, minAlt: number, maxAlt: number): string => {
  // Normalisiere auf 0-1
  const range = maxAlt - minAlt
  const normalized = range > 0 ? (altitudeM - minAlt) / range : 0.5

  // Farbverlauf: Grün (niedrig) → Gelb → Orange → Rot → Magenta → Blau (hoch)
  if (normalized < 0.2) {
    // Grün zu Gelbgrün
    const t = normalized / 0.2
    return `rgb(${Math.round(34 + t * 98)}, ${Math.round(197 - t * 27)}, ${Math.round(94 - t * 70)})`
  } else if (normalized < 0.4) {
    // Gelbgrün zu Gelb
    const t = (normalized - 0.2) / 0.2
    return `rgb(${Math.round(132 + t * 102)}, ${Math.round(170 - t * 11)}, ${Math.round(24 - t * 16)})`
  } else if (normalized < 0.6) {
    // Gelb zu Orange
    const t = (normalized - 0.4) / 0.2
    return `rgb(${Math.round(234 + t * 15)}, ${Math.round(159 - t * 56)}, ${Math.round(8 + t * 14)})`
  } else if (normalized < 0.8) {
    // Orange zu Rot/Magenta
    const t = (normalized - 0.6) / 0.2
    return `rgb(${Math.round(249 - t * 31)}, ${Math.round(103 - t * 34)}, ${Math.round(22 + t * 178)})`
  } else {
    // Magenta zu Blau
    const t = (normalized - 0.8) / 0.2
    return `rgb(${Math.round(218 - t * 159)}, ${Math.round(69 + t * 61)}, ${Math.round(200 + t * 46)})`
  }
}

// Windrichtung zu Abkürzung
const getWindDirectionName = (deg: number): string => {
  const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(((deg % 360) / 22.5)) % 16
  return directions[index]
}

// Meter zu Fuß
const mToFt = (m: number) => Math.round(m * 3.28084)

// m/s zu km/h
const msToKmh = (ms: number) => ms * 3.6

interface WindPanelProps {
  isOpen: boolean
  onClose: () => void
  position?: { x: number; y: number }
}

export function WindPanel({ isOpen, onClose, position }: WindPanelProps) {
  const {
    windLayers,
    addWindLayer,
    removeWindLayer,
    clearWindLayers,
    gpsData,
    baroData,
    settings,
    updateSettings,
    setSelectedWindLayer,
    selectedWindLayer
  } = useFlightStore()

  // Lokaler State
  const [activeTab, setActiveTab] = useState<'live' | 'import'>('live')
  const [directionMode, setDirectionMode] = useState<'from' | 'to'>(settings.windDirectionMode || 'from')
  const [altitudeUnit, setAltitudeUnit] = useState<'m' | 'ft'>(settings.windAltitudeUnit || 'ft')
  const [intervalSize, setIntervalSize] = useState<number>(settings.windLayerInterval || 100)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newWind, setNewWind] = useState({ altitude: '', direction: '', speed: '' })

  // Drag state
  const [isDragging, setIsDragging] = useState(false)
  const [panelPosition, setPanelPosition] = useState(position || { x: 100, y: 100 })
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Sync direction mode to settings
  useEffect(() => {
    if (directionMode !== settings.windDirectionMode) {
      updateSettings({ windDirectionMode: directionMode })
    }
  }, [directionMode])

  // Sync from settings on mount (don't override with useEffect)
  // Settings werden direkt im onClick Handler aktualisiert

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return

    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: panelPosition.x,
      startPosY: panelPosition.y
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return

      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY

      // Begrenze Position - Panel darf bis zum Rand (mit 50px Puffer zum Greifen)
      const maxX = window.innerWidth - 50 // Mindestens 50px vom Panel sichtbar
      const maxY = window.innerHeight - 50

      setPanelPosition({
        x: Math.max(-50, Math.min(maxX, dragRef.current.startPosX + dx)),
        y: Math.max(0, Math.min(maxY, dragRef.current.startPosY + dy))
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Sortiere Layers nach Höhe (absteigend)
  const sortedLayers = useMemo(() => {
    return [...windLayers].sort((a, b) => b.altitude - a.altitude)
  }, [windLayers])

  // Min/Max Höhe für Farbskala
  const { minAltitude, maxAltitude } = useMemo(() => {
    if (windLayers.length === 0) return { minAltitude: 0, maxAltitude: 1000 }
    const altitudes = windLayers.map(l => l.altitude)
    return {
      minAltitude: Math.min(...altitudes),
      maxAltitude: Math.max(...altitudes)
    }
  }, [windLayers])

  // Aktuelle Höhe
  const currentAltitude = baroData?.pressureAltitude || gpsData?.altitude || 0

  // Wind hinzufügen
  const handleAddWind = () => {
    const alt = parseFloat(newWind.altitude)
    const dir = parseFloat(newWind.direction)
    const spd = parseFloat(newWind.speed)

    if (isNaN(alt) || isNaN(dir) || isNaN(spd)) return

    const layer: WindLayer = {
      altitude: altitudeUnit === 'ft' ? alt / 3.28084 : alt,
      direction: dir,
      speed: spd / 3.6, // km/h zu m/s
      timestamp: new Date(),
      source: WindSource.Manual
    }
    addWindLayer(layer)
    setNewWind({ altitude: '', direction: '', speed: '' })
    setShowAddForm(false)
  }

  // Format altitude - Daten sind bereits bei Aufzeichnung gerundet
  const formatAltitude = (meters: number) => {
    if (altitudeUnit === 'ft') {
      const ft = Math.round(mToFt(meters))
      return `${ft} ft`
    }
    return `${Math.round(meters)} m`
  }

  // Format direction based on mode
  const formatDirection = (fromDeg: number) => {
    const displayDeg = directionMode === 'to' ? (fromDeg + 180) % 360 : fromDeg
    return `${Math.round(displayDeg)}°`
  }

  // Panel scale
  const scale = settings.windPanelScale ?? 1

  if (!isOpen) return null

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${panelPosition.x}px`,
        top: `${panelPosition.y}px`,
        width: '320px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.1)',
        zIndex: 9000,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '500px'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
          </svg>
          <span style={{ fontWeight: 700, color: 'white', fontSize: '14px' }}>Windprofil</span>
          <span style={{
            background: '#3b82f6',
            color: 'white',
            fontSize: '11px',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '10px'
          }}>
            {windLayers.length}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Tab Switcher */}
      <div style={{
        display: 'flex',
        padding: '12px 16px',
        gap: '8px'
      }}>
        <button
          onClick={() => setActiveTab('live')}
          style={{
            flex: 1,
            padding: '8px 16px',
            background: activeTab === 'live' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
            border: activeTab === 'live' ? 'none' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Live
        </button>
        <button
          onClick={() => setActiveTab('import')}
          style={{
            flex: 1,
            padding: '8px 16px',
            background: activeTab === 'import' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
            border: activeTab === 'import' ? 'none' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Import
        </button>
      </div>

      {/* Settings Row */}
      <div style={{
        padding: '0 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        {/* Direction Mode */}
        <div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
            Richtung
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setDirectionMode('from')}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: directionMode === 'from' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                border: directionMode === 'from' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: 'white',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              VON
            </button>
            <button
              onClick={() => setDirectionMode('to')}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: directionMode === 'to' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                border: directionMode === 'to' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: 'white',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ZU
            </button>
          </div>
        </div>

        {/* Altitude Unit */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Höhe
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => {
                  setAltitudeUnit('m')
                  setIntervalSize(50)
                  updateSettings({ windAltitudeUnit: 'm', windLayerInterval: 50 })
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  background: altitudeUnit === 'm' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                  border: altitudeUnit === 'm' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                m
              </button>
              <button
                onClick={() => {
                  setAltitudeUnit('ft')
                  setIntervalSize(100)
                  updateSettings({ windAltitudeUnit: 'ft', windLayerInterval: 100 })
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  background: altitudeUnit === 'ft' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                  border: altitudeUnit === 'ft' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ft
              </button>
            </div>
          </div>
        </div>

        {/* Interval - basierend auf Einheit */}
        <div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
            Intervall ({altitudeUnit === 'ft' ? 'FT' : 'M'})
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(altitudeUnit === 'ft' ? [100, 200, 500, 1000] : [50, 100, 200, 500]).map(size => (
              <button
                key={size}
                onClick={() => {
                  setIntervalSize(size)
                  updateSettings({ windLayerInterval: size })
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  background: intervalSize === size ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                  border: intervalSize === size ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {size}{altitudeUnit === 'ft' ? 'ft' : 'm'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Wind List mit Höhenbalken - Scrollable */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 8px',
        minHeight: '120px',
        maxHeight: '220px',
        display: 'flex',
        gap: '8px'
      }}>
        {sortedLayers.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '24px 16px',
            color: 'rgba(255,255,255,0.4)',
            fontSize: '12px',
            width: '100%'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 8px', opacity: 0.5 }}>
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
            </svg>
            <div>Keine Winddaten</div>
          </div>
        ) : (
          <>
            {/* Höhenbalken/Legende links */}
            <div style={{
              width: '12px',
              borderRadius: '6px',
              background: 'linear-gradient(to bottom, #3b82f6, #a855f7, #ef4444, #f97316, #eab308, #84cc16, #22c55e)',
              flexShrink: 0,
              position: 'relative'
            }}>
              {/* Markierungen für Min/Max */}
              <div style={{
                position: 'absolute',
                top: '-2px',
                left: '14px',
                fontSize: '8px',
                color: 'rgba(255,255,255,0.5)',
                whiteSpace: 'nowrap'
              }}>
                {altitudeUnit === 'ft' ? `${mToFt(maxAltitude)}ft` : `${Math.round(maxAltitude)}m`}
              </div>
              <div style={{
                position: 'absolute',
                bottom: '-2px',
                left: '14px',
                fontSize: '8px',
                color: 'rgba(255,255,255,0.5)',
                whiteSpace: 'nowrap'
              }}>
                {altitudeUnit === 'ft' ? `${mToFt(minAltitude)}ft` : `${Math.round(minAltitude)}m`}
              </div>
            </div>

            {/* Windschichten */}
            <div style={{ flex: 1 }}>
              {sortedLayers.map((layer, index) => {
                const speedKmh = msToKmh(layer.speed)
                const isNearCurrent = Math.abs(layer.altitude - currentAltitude) < intervalSize / 2
                const isSelected = selectedWindLayer === layer.altitude
                const windColor = getWindColor(speedKmh)
                const altColor = getAltitudeColor(layer.altitude, minAltitude, maxAltitude)
                const displayDirection = directionMode === 'to' ? (layer.direction + 180) % 360 : layer.direction
                // Windstärke-Balken: max 60km/h = 100%
                const barWidth = Math.min(100, (speedKmh / 60) * 100)

                return (
                  <div
                    key={`${layer.altitude}-${index}`}
                    onClick={() => setSelectedWindLayer(isSelected ? null : layer.altitude)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 10px',
                      margin: '3px 0',
                      background: isSelected
                        ? 'rgba(34, 197, 94, 0.25)'
                        : isNearCurrent
                          ? 'rgba(59, 130, 246, 0.2)'
                          : `linear-gradient(90deg, ${altColor}33 0%, rgba(255,255,255,0.03) 100%)`,
                      borderRadius: '8px',
                      border: isSelected
                        ? '1px solid rgba(34, 197, 94, 0.5)'
                        : isNearCurrent
                          ? '1px solid rgba(59, 130, 246, 0.3)'
                          : `1px solid ${altColor}44`,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {/* Höhen-Indikator Punkt */}
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: altColor,
                      marginRight: '8px',
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${altColor}`
                    }} />

                    {/* Höhe - in Höhenfarbe */}
                    <div style={{
                      width: '65px',
                      fontWeight: 700,
                      fontSize: '15px',
                      color: altColor,
                      fontFamily: 'monospace',
                      textShadow: '0 0 8px rgba(0,0,0,0.5)'
                    }}>
                      {formatAltitude(layer.altitude)}
                    </div>

                    {/* Kurs - prominent in Gelb, direkt neben Höhe */}
                    <div style={{
                      width: '55px',
                      fontWeight: 700,
                      fontSize: '15px',
                      color: '#fbbf24',
                      fontFamily: 'monospace',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      borderLeft: '1px solid rgba(255,255,255,0.1)',
                      paddingLeft: '8px',
                      marginLeft: '4px'
                    }}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        style={{
                          transform: `rotate(${displayDirection}deg)`,
                          flexShrink: 0
                        }}
                      >
                        <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                        <rect x="11" y="12" width="2" height="8" fill="#fbbf24" opacity="0.6"/>
                      </svg>
                      {Math.round(displayDirection)}°
                    </div>

                    {/* Windstärke-Balken + Wert */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
                      {/* Balken */}
                      <div style={{
                        flex: 1,
                        height: '12px',
                        background: 'rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${barWidth}%`,
                          height: '100%',
                          background: windColor,
                          borderRadius: '6px',
                          transition: 'width 0.3s'
                        }} />
                      </div>
                      {/* km/h Wert */}
                      <div style={{
                        width: '35px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: windColor,
                        textAlign: 'right',
                        fontFamily: 'monospace'
                      }}>
                        {speedKmh.toFixed(0)}
                      </div>
                    </div>

                    {/* Delete Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeWindLayer(layer.altitude)
                      }}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: 'none',
                        color: '#ef4444',
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: 0.5,
                        marginLeft: '6px',
                        fontSize: '10px'
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Windstärke-Legende */}
      {sortedLayers.length > 0 && (
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '9px',
          color: 'rgba(255,255,255,0.5)'
        }}>
          <span>km/h:</span>
          <div style={{ display: 'flex', flex: 1, height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ flex: 1, background: '#22c55e' }} title="0-10" />
            <div style={{ flex: 1, background: '#84cc16' }} title="10-20" />
            <div style={{ flex: 1, background: '#eab308' }} title="20-30" />
            <div style={{ flex: 1, background: '#f97316' }} title="30-40" />
            <div style={{ flex: 1, background: '#ef4444' }} title="40-50" />
            <div style={{ flex: 1, background: '#dc2626' }} title="50+" />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: '4px' }}>
            <span>0</span>
            <span>20</span>
            <span>40</span>
            <span>60+</span>
          </div>
        </div>
      )}

      {/* Add Wind Form */}
      {showAddForm && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>
                {altitudeUnit === 'ft' ? 'HÖHE (FT)' : 'HÖHE (M)'}
              </div>
              <input
                type="number"
                placeholder={altitudeUnit === 'ft' ? '2000' : '600'}
                value={newWind.altitude}
                onChange={e => setNewWind(prev => ({ ...prev, altitude: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>RICHTUNG (°)</div>
              <input
                type="number"
                placeholder="247"
                min="0"
                max="360"
                value={newWind.direction}
                onChange={e => setNewWind(prev => ({ ...prev, direction: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>KM/H</div>
              <input
                type="number"
                placeholder="12"
                step="0.1"
                value={newWind.speed}
                onChange={e => setNewWind(prev => ({ ...prev, speed: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowAddForm(false)}
              style={{
                flex: 1,
                padding: '8px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: 'rgba(255,255,255,0.7)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Abbrechen
            </button>
            <button
              onClick={handleAddWind}
              style={{
                flex: 1,
                padding: '8px',
                background: '#22c55e',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Hinzufügen
            </button>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        gap: '8px'
      }}>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              flex: 1,
              padding: '10px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"/>
            </svg>
            Wind hinzufügen
          </button>
        )}

        {windLayers.length > 0 && !showAddForm && (
          <button
            onClick={clearWindLayers}
            style={{
              padding: '10px 16px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#ef4444',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Alle Winds löschen
          </button>
        )}
      </div>
    </div>
  )
}

// Export für Sidebar-Version (falls noch benötigt)
export function WindPanelSidebar() {
  const { windLayers } = useFlightStore()

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: '16px',
      height: '100%'
    }}>
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
        Wind Panel wurde in ein Floating Panel verschoben.
        <br />
        Öffne es über das Menü.
      </div>
    </div>
  )
}
