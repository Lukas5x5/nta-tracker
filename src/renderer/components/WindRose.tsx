import React, { useMemo, useState, useCallback } from 'react'
import { WindLayer, WindSource } from '../../shared/types'
import { useFlightStore } from '../stores/flightStore'
import { usePanelDrag } from '../hooks/usePanelDrag'

type WindSourceFilter = 'all' | 'forecast' | 'measured' | 'sounding'

interface WindRoseProps {
  windLayers: WindLayer[]
  windSourceFilter: WindSourceFilter
  windDirectionMode: 'from' | 'to'
  altitudeUnit: 'meters' | 'feet'
  onClose: () => void
}

// Höhenbasierte Farbcodierung (gleiche Logik wie FlightWindsPanel)
const getAltitudeColor = (altitudeM: number, minAlt: number, maxAlt: number): string => {
  const range = maxAlt - minAlt
  const normalized = range > 0 ? (altitudeM - minAlt) / range : 0.5

  if (normalized < 0.2) {
    const t = normalized / 0.2
    return `rgb(${Math.round(34 + t * 98)}, ${Math.round(197 - t * 27)}, ${Math.round(94 - t * 70)})`
  } else if (normalized < 0.4) {
    const t = (normalized - 0.2) / 0.2
    return `rgb(${Math.round(132 + t * 102)}, ${Math.round(170 - t * 11)}, ${Math.round(24 - t * 16)})`
  } else if (normalized < 0.6) {
    const t = (normalized - 0.4) / 0.2
    return `rgb(${Math.round(234 + t * 15)}, ${Math.round(159 - t * 56)}, ${Math.round(8 + t * 14)})`
  } else if (normalized < 0.8) {
    const t = (normalized - 0.6) / 0.2
    return `rgb(${Math.round(249 - t * 31)}, ${Math.round(103 - t * 34)}, ${Math.round(22 + t * 178)})`
  } else {
    const t = (normalized - 0.8) / 0.2
    return `rgb(${Math.round(218 - t * 159)}, ${Math.round(69 + t * 61)}, ${Math.round(200 + t * 46)})`
  }
}

// Windrose Konstanten
const CX = 110
const CY = 110
const MAX_RADIUS = 85

// Windprofil Konstanten
const PROFILE_W = 300
const PROFILE_H = 280
const PROFILE_PAD = { top: 15, right: 15, bottom: 30, left: 45 }
const PLOT_W = PROFILE_W - PROFILE_PAD.left - PROFILE_PAD.right
const PLOT_H = PROFILE_H - PROFILE_PAD.top - PROFILE_PAD.bottom

export function WindRose({ windLayers, windSourceFilter, windDirectionMode, altitudeUnit, onClose }: WindRoseProps) {
  const settings = useFlightStore(s => s.settings)
  const scale = settings.windRoseScale ?? 1
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'rose' | 'profile'>('rose')
  const [position, setPosition] = useState({ x: 16, y: window.innerHeight - 380 })

  // Panel Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 100, pos.x)),
      y: Math.max(0, Math.min(window.innerHeight - 100, pos.y))
    })
  }, [])

  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // Windschichten filtern
  const filteredLayers = useMemo(() => {
    if (windSourceFilter === 'forecast') {
      return windLayers.filter(l => l.source === WindSource.Forecast)
    } else if (windSourceFilter === 'measured') {
      return windLayers.filter(l => l.source === WindSource.Measured)
    } else if (windSourceFilter === 'sounding') {
      return windLayers.filter(l => l.source === WindSource.Windsond || l.source === WindSource.Pibal)
    }
    return windLayers
  }, [windLayers, windSourceFilter])

  // Sortiert nach Höhe (aufsteigend)
  const sortedLayers = useMemo(() =>
    [...filteredLayers].sort((a, b) => a.altitude - b.altitude),
  [filteredLayers])

  // Max Speed für Windrose-Skalierung
  const maxSpeed = useMemo(() =>
    Math.max(...filteredLayers.map(l => l.speed), 10),
  [filteredLayers])

  // Geschwindigkeits-Ringe für Windrose
  const speedRings = useMemo(() => {
    const step = maxSpeed <= 15 ? 5 : maxSpeed <= 30 ? 10 : 20
    const rings: { speed: number; radius: number }[] = []
    for (let s = step; s <= maxSpeed; s += step) {
      rings.push({ speed: s, radius: (s / maxSpeed) * MAX_RADIUS })
    }
    return rings
  }, [maxSpeed])

  // Min/Max Höhe für Farbskala
  const minAlt = useMemo(() => Math.min(...filteredLayers.map(l => l.altitude), 0), [filteredLayers])
  const maxAlt = useMemo(() => Math.max(...filteredLayers.map(l => l.altitude), 100), [filteredLayers])

  if (filteredLayers.length === 0) return null

  // Hilfsfunktionen für Tooltip
  const getAltLabel = (alt: number) => altitudeUnit === 'feet'
    ? `${Math.round(alt * 3.28084)} ft` : `${Math.round(alt)} m`
  const getDirLabel = (dir: number) => windDirectionMode === 'from'
    ? dir.toString().padStart(3, '0') : ((dir + 180) % 360).toString().padStart(3, '0')

  // Toggle-Button Style
  const tabStyle = (active: boolean) => ({
    padding: '3px 10px',
    border: 'none',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 700 as const,
    cursor: 'pointer' as const,
    background: active ? 'rgba(6, 182, 212, 0.25)' : 'transparent',
    color: active ? '#06b6d4' : 'rgba(255,255,255,0.4)',
    transition: 'all 0.15s'
  })

  return (
    <div
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        background: 'rgba(10, 15, 30, 0.92)',
        borderRadius: '12px',
        padding: '8px',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: 10000,
        transform: `scale(${scale})`,
        transformOrigin: 'bottom left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header: Tabs + X-Button */}
      <div className="no-drag" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '4px',
        padding: '0 2px'
      }}>
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px' }}>
          <button className="no-drag" onClick={() => { setViewMode('rose'); setHoveredIndex(null) }} style={tabStyle(viewMode === 'rose')}>
            Rose
          </button>
          <button className="no-drag" onClick={() => { setViewMode('profile'); setHoveredIndex(null) }} style={tabStyle(viewMode === 'profile')}>
            Profil
          </button>
        </div>
        <button
          className="no-drag"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '2px 6px',
            lineHeight: 1
          }}
        >
          ✕
        </button>
      </div>

      {/* === Windrose Ansicht === */}
      {viewMode === 'rose' && (
        <>
          <svg viewBox="0 0 220 220" width="220" height="220">
            <circle cx={CX} cy={CY} r={MAX_RADIUS + 12} fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

            {speedRings.map(ring => (
              <React.Fragment key={ring.speed}>
                <circle cx={CX} cy={CY} r={ring.radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="3,3" />
                <text x={CX + ring.radius + 2} y={CY - 2} fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="monospace">{ring.speed}</text>
              </React.Fragment>
            ))}

            <line x1={CX} y1={CY - MAX_RADIUS - 8} x2={CX} y2={CY + MAX_RADIUS + 8} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
            <line x1={CX - MAX_RADIUS - 8} y1={CY} x2={CX + MAX_RADIUS + 8} y2={CY} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />

            <text x={CX} y={CY - MAX_RADIUS - 12} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="13" fontWeight="700">N</text>
            <text x={CX + MAX_RADIUS + 14} y={CY + 4} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontWeight="600">O</text>
            <text x={CX} y={CY + MAX_RADIUS + 20} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontWeight="600">S</text>
            <text x={CX - MAX_RADIUS - 14} y={CY + 4} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontWeight="600">W</text>

            {sortedLayers.map((layer, i) => {
              const spokeLength = (layer.speed / maxSpeed) * MAX_RADIUS
              if (spokeLength < 2) return null
              const angle = windDirectionMode === 'from' ? layer.direction : (layer.direction + 180) % 360
              const color = getAltitudeColor(layer.altitude, minAlt, maxAlt)
              const isHovered = hoveredIndex === i
              const rad = (angle - 90) * Math.PI / 180
              const endX = CX + Math.cos(rad) * spokeLength
              const endY = CY + Math.sin(rad) * spokeLength

              return (
                <g key={`${layer.altitude}-${i}`} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} style={{ cursor: 'pointer' }}>
                  <line x1={CX} y1={CY} x2={endX} y2={endY} stroke={color} strokeWidth={isHovered ? 4 : 2.5} strokeLinecap="round" opacity={isHovered ? 1 : 0.85} />
                  <circle cx={endX} cy={endY} r={isHovered ? 5 : 3.5} fill={color} stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
                  <line x1={CX} y1={CY} x2={endX} y2={endY} stroke="transparent" strokeWidth="12" />
                </g>
              )
            })}

            <circle cx={CX} cy={CY} r="3" fill="rgba(255,255,255,0.6)" />
          </svg>
        </>
      )}

      {/* === Windprofil Ansicht === */}
      {viewMode === 'profile' && (() => {
        // Höhenstufen berechnen
        const altRange = maxAlt - minAlt
        const altStep = altRange <= 500 ? 100 : altRange <= 1500 ? 250 : altRange <= 3000 ? 500 : 1000

        // Richtung für X-Achse (0-360, Mitte bei 0°/Nord)
        // X-Achse: 180°(S) → 270°(W) → 0°/360°(N) → 90°(O) → 180°(S)
        const dirToX = (dir: number) => {
          // Richtung so mappen dass 0° (Nord) in der Mitte ist
          // Offset: 180° → links(0), 270° → 1/4, 0° → Mitte(1/2), 90° → 3/4, 180° → rechts(1)
          let mapped = (dir + 180) % 360
          return PROFILE_PAD.left + (mapped / 360) * PLOT_W
        }
        const altToY = (alt: number) => {
          if (altRange === 0) return PROFILE_PAD.top + PLOT_H / 2
          return PROFILE_PAD.top + PLOT_H - ((alt - minAlt) / altRange) * PLOT_H
        }

        // Richtungs-Labels für X-Achse
        const dirLabels = [
          { deg: 180, label: 'S' },
          { deg: 270, label: 'W' },
          { deg: 0, label: 'N' },
          { deg: 90, label: 'O' },
          { deg: 180, label: 'S' }
        ]

        // Richtungswert pro Layer (respektiert from/to)
        const getDisplayDir = (layer: WindLayer) =>
          windDirectionMode === 'from' ? layer.direction : (layer.direction + 180) % 360

        // Farben und Labels pro WindSource
        const sourceConfig: Record<string, { color: string; label: string }> = {
          [WindSource.Measured]: { color: '#22c55e', label: 'Live' },
          [WindSource.Forecast]: { color: '#3b82f6', label: 'FC' },
          [WindSource.Windsond]: { color: '#a855f7', label: 'WS' },
          [WindSource.Pibal]: { color: '#f59e0b', label: 'PB' },
          [WindSource.Manual]: { color: '#06b6d4', label: 'MAN' },
          [WindSource.Calculated]: { color: '#6b7280', label: 'Calc' }
        }

        // Gruppiere nach Source, sortiere jede Gruppe nach Höhe
        const groups = new Map<string, WindLayer[]>()
        for (const layer of filteredLayers) {
          const key = layer.source
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(layer)
        }
        // Jede Gruppe nach Höhe sortieren
        for (const [, layers] of groups) {
          layers.sort((a, b) => a.altitude - b.altitude)
        }
        const groupEntries = Array.from(groups.entries())

        return (
          <svg viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} width={PROFILE_W} height={PROFILE_H}>
            {/* Hintergrund */}
            <rect x={PROFILE_PAD.left} y={PROFILE_PAD.top} width={PLOT_W} height={PLOT_H}
              fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />

            {/* Horizontale Gitterlinien (Höhenstufen) */}
            {(() => {
              const lines: React.ReactNode[] = []
              const startAlt = Math.ceil(minAlt / altStep) * altStep
              for (let a = startAlt; a <= maxAlt; a += altStep) {
                const y = altToY(a)
                const label = altitudeUnit === 'feet' ? `${Math.round(a * 3.28084)}` : `${Math.round(a)}`
                lines.push(
                  <React.Fragment key={`h-${a}`}>
                    <line x1={PROFILE_PAD.left} y1={y} x2={PROFILE_PAD.left + PLOT_W} y2={y}
                      stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
                    <text x={PROFILE_PAD.left - 4} y={y + 3} textAnchor="end"
                      fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="monospace">{label}</text>
                  </React.Fragment>
                )
              }
              return lines
            })()}

            {/* Vertikale Gitterlinien (Richtungsstufen) */}
            {dirLabels.map((d, i) => {
              const x = dirToX(d.deg)
              return (
                <React.Fragment key={`v-${i}`}>
                  <line x1={x} y1={PROFILE_PAD.top} x2={x} y2={PROFILE_PAD.top + PLOT_H}
                    stroke={d.label === 'N' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'} strokeWidth="0.5" />
                  <text x={x} y={PROFILE_H - 8} textAnchor="middle"
                    fill={d.label === 'N' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)'}
                    fontSize={d.label === 'N' ? '11' : '10'} fontWeight={d.label === 'N' ? '700' : '400'}
                    fontFamily="monospace">
                    {d.deg}°({d.label})
                  </text>
                </React.Fragment>
              )
            })}

            {/* Y-Achse Label */}
            <text x={12} y={PROFILE_PAD.top + PLOT_H / 2}
              textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace"
              transform={`rotate(-90, 12, ${PROFILE_PAD.top + PLOT_H / 2})`}>
              {altitudeUnit === 'feet' ? 'Höhe (ft)' : 'Höhe (m)'}
            </text>

            {/* Pro WindSource eine eigene verbundene Linie */}
            {groupEntries.map(([source, layers]) => {
              const cfg = sourceConfig[source] || { color: '#888', label: source }
              const points = layers.map(l => ({
                x: dirToX(getDisplayDir(l)),
                y: altToY(l.altitude)
              }))
              const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ')

              return (
                <g key={`group-${source}`}>
                  {/* Verbindungslinie */}
                  {layers.length > 1 && (
                    <polyline
                      points={polyPoints}
                      fill="none"
                      stroke={cfg.color}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity="0.7"
                    />
                  )}
                  {/* Punkte */}
                  {layers.map((layer, j) => {
                    const globalIdx = sortedLayers.indexOf(layer)
                    const isHovered = hoveredIndex === globalIdx
                    return (
                      <g key={`pt-${source}-${j}`}
                        onMouseEnter={() => setHoveredIndex(globalIdx)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle cx={points[j].x} cy={points[j].y} r={isHovered ? 6 : 4}
                          fill={cfg.color}
                          stroke={isHovered ? 'white' : 'rgba(0,0,0,0.5)'}
                          strokeWidth={isHovered ? 2 : 1} />
                        <circle cx={points[j].x} cy={points[j].y} r="10" fill="transparent" />
                      </g>
                    )
                  })}
                </g>
              )
            })}

            {/* Legende oben rechts */}
            {groupEntries.map(([source], gi) => {
              const cfg = sourceConfig[source] || { color: '#888', label: source }
              const ly = PROFILE_PAD.top + 8 + gi * 14
              return (
                <g key={`legend-${source}`}>
                  <line x1={PROFILE_PAD.left + PLOT_W - 50} y1={ly} x2={PROFILE_PAD.left + PLOT_W - 38} y2={ly}
                    stroke={cfg.color} strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={PROFILE_PAD.left + PLOT_W - 44} cy={ly} r="2.5" fill={cfg.color} />
                  <text x={PROFILE_PAD.left + PLOT_W - 34} y={ly + 3}
                    fill={cfg.color} fontSize="8" fontWeight="600" fontFamily="monospace">
                    {cfg.label}
                  </text>
                </g>
              )
            })}
          </svg>
        )
      })()}

      {/* Hover-Tooltip (für beide Ansichten) */}
      {hoveredIndex !== null && sortedLayers[hoveredIndex] && (() => {
        const layer = sortedLayers[hoveredIndex]
        const color = getAltitudeColor(layer.altitude, minAlt, maxAlt)
        return (
          <div style={{
            position: 'absolute',
            bottom: -4,
            left: '50%',
            transform: 'translateX(-50%) translateY(100%)',
            background: 'rgba(0,0,0,0.95)',
            color: 'white',
            padding: '5px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            border: `1px solid ${color}`,
            zIndex: 10,
            pointerEvents: 'none'
          }}>
            <span style={{ color }}>{getAltLabel(layer.altitude)}</span>
            {' | '}
            {getDirLabel(layer.direction)}°
            {' | '}
            {layer.speed.toFixed(1)} km/h
          </div>
        )
      })()}

      {/* Höhen-Legende */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 4px 0'
      }}>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>
          {altitudeUnit === 'feet' ? `${Math.round(minAlt * 3.28084)}ft` : `${Math.round(minAlt)}m`}
        </span>
        <div style={{
          flex: 1,
          height: '4px',
          borderRadius: '2px',
          background: `linear-gradient(to right, ${getAltitudeColor(minAlt, minAlt, maxAlt)}, ${getAltitudeColor((minAlt + maxAlt) / 2, minAlt, maxAlt)}, ${getAltitudeColor(maxAlt, minAlt, maxAlt)})`
        }} />
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>
          {altitudeUnit === 'feet' ? `${Math.round(maxAlt * 3.28084)}ft` : `${Math.round(maxAlt)}m`}
        </span>
      </div>
    </div>
  )
}
