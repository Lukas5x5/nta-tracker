import React, { useState } from 'react'
import { TrackPoint } from '../../shared/types'

interface Track3DViewProps {
  track: TrackPoint[]
  onClose: () => void
}

export function Track3DView({ track, onClose }: Track3DViewProps) {
  const [selectedView, setSelectedView] = useState<'profile' | 'stats'>('profile')

  // Track Statistiken berechnen
  const getTrackStats = () => {
    if (track.length === 0) return null

    const altitudes = track.map(t => t.position.altitude)
    const speeds = track.map(t => t.speed || 0).filter(s => s > 0)
    const minAlt = Math.min(...altitudes)
    const maxAlt = Math.max(...altitudes)
    const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
    const maxSpeed = Math.max(...speeds)
    const startTime = new Date(track[0].timestamp)
    const endTime = new Date(track[track.length - 1].timestamp)
    const duration = (endTime.getTime() - startTime.getTime()) / 1000 // Sekunden

    // Berechne Gesamtdistanz
    let totalDistance = 0
    let totalClimb = 0
    let totalDescent = 0

    for (let i = 1; i < track.length; i++) {
      const prevPoint = track[i - 1]
      const currPoint = track[i]

      // Distanz
      const R = 6371000
      const lat1 = prevPoint.position.latitude * Math.PI / 180
      const lat2 = currPoint.position.latitude * Math.PI / 180
      const dLat = (currPoint.position.latitude - prevPoint.position.latitude) * Math.PI / 180
      const dLon = (currPoint.position.longitude - prevPoint.position.longitude) * Math.PI / 180

      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(dLon/2) * Math.sin(dLon/2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      totalDistance += R * c

      // Höhengewinn/-verlust
      const altDiff = currPoint.position.altitude - prevPoint.position.altitude
      if (altDiff > 0) totalClimb += altDiff
      else totalDescent += Math.abs(altDiff)
    }

    return {
      minAlt: Math.round(minAlt),
      maxAlt: Math.round(maxAlt),
      avgSpeed: avgSpeed * 3.6, // m/s -> km/h
      maxSpeed: maxSpeed * 3.6,
      duration,
      totalDistance: Math.round(totalDistance),
      totalClimb: Math.round(totalClimb),
      totalDescent: Math.round(totalDescent),
      pointCount: track.length
    }
  }

  const stats = getTrackStats()

  // Höhenprofil zeichnen
  const renderAltitudeProfile = () => {
    if (!stats || track.length < 2) return (
      <div style={{ color: '#fff', padding: '20px' }}>
        Nicht genügend Trackpunkte für ein Höhenprofil (mindestens 2 benötigt)
      </div>
    )

    const width = 800
    const height = 300
    const padding = 40

    const altitudes = track.map(t => t.position.altitude)
    const minAlt = Math.min(...altitudes)
    const maxAlt = Math.max(...altitudes)
    const altRange = maxAlt - minAlt || 1 // Verhindere Division durch 0

    // Erstelle SVG Pfad
    const points = track.map((point, index) => {
      const x = padding + (index / Math.max(1, track.length - 1)) * (width - 2 * padding)
      const y = height - padding - ((point.position.altitude - minAlt) / altRange) * (height - 2 * padding)
      return `${x},${y}`
    }).join(' L')

    const pathData = `M${points}`

    // Farbe nach Geschwindigkeit
    const getSpeedColor = (speed: number) => {
      const kmh = speed * 3.6
      if (kmh < 5) return '#22c55e'
      if (kmh < 10) return '#84cc16'
      if (kmh < 15) return '#eab308'
      if (kmh < 20) return '#f97316'
      return '#ef4444'
    }

    return (
      <svg width={width} height={height} style={{ background: '#1a1a2e', borderRadius: '12px' }}>
        {/* Gitter */}
        {[0, 1, 2, 3, 4].map(i => {
          const y = padding + (i / 4) * (height - 2 * padding)
          const alt = maxAlt - (i / 4) * altRange
          return (
            <g key={i}>
              <line
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1"
              />
              <text
                x={padding - 10}
                y={y + 5}
                fill="#888"
                fontSize="12"
                textAnchor="end"
              >
                {Math.round(alt)}m
              </text>
            </g>
          )
        })}

        {/* Höhenprofil */}
        <path
          d={pathData}
          fill="none"
          stroke="url(#gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Fläche unter dem Profil */}
        <path
          d={`${pathData} L${width - padding},${height - padding} L${padding},${height - padding} Z`}
          fill="url(#areaGradient)"
          opacity="0.3"
        />

        {/* Gradient für Linie */}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Trackpunkte (nur alle n-ten anzeigen) */}
        {track.filter((_, i) => i % Math.max(1, Math.floor(track.length / 50)) === 0).map((point, index) => {
          const actualIndex = index * Math.max(1, Math.floor(track.length / 50))
          const x = padding + (actualIndex / Math.max(1, track.length - 1)) * (width - 2 * padding)
          const y = height - padding - ((point.position.altitude - minAlt) / altRange) * (height - 2 * padding)
          const color = getSpeedColor(point.speed || 0)

          return (
            <circle
              key={actualIndex}
              cx={x}
              cy={y}
              r="4"
              fill={color}
              stroke="#fff"
              strokeWidth="1.5"
            >
              <title>
                {`Höhe: ${Math.round(point.position.altitude)}m\n` +
                 `Geschwindigkeit: ${((point.speed || 0) * 3.6).toFixed(1)} km/h\n` +
                 `Zeit: ${new Date(point.timestamp).toLocaleTimeString()}`}
              </title>
            </circle>
          )
        })}

        {/* Achsenbeschriftungen */}
        <text
          x={width / 2}
          y={height - 5}
          fill="#fff"
          fontSize="14"
          textAnchor="middle"
        >
          Flugverlauf
        </text>
        <text
          x={10}
          y={20}
          fill="#fff"
          fontSize="14"
          transform={`rotate(-90, 10, 20)`}
          textAnchor="middle"
        >
          Höhe (m)
        </text>
      </svg>
    )
  }

  if (!stats) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10000,
      background: 'rgba(0, 0, 0, 0.95)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        paddingBottom: '15px'
      }}>
        <h2 style={{ margin: 0, color: '#fff', fontSize: '24px' }}>
          Track Analyse
        </h2>
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '16px'
          }}
        >
          ✕ Schließen
        </button>
      </div>

      {/* View Selector */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <button
          onClick={() => setSelectedView('profile')}
          style={{
            padding: '10px 20px',
            background: selectedView === 'profile' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: selectedView === 'profile' ? 'bold' : 'normal'
          }}
        >
          Höhenprofil
        </button>
        <button
          onClick={() => setSelectedView('stats')}
          style={{
            padding: '10px 20px',
            background: selectedView === 'stats' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: selectedView === 'stats' ? 'bold' : 'normal'
          }}
        >
          Statistiken
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'auto'
      }}>
        {selectedView === 'profile' ? (
          <div>{renderAltitudeProfile()}</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            maxWidth: '1200px',
            width: '100%'
          }}>
            {/* Statistik-Karten */}
            {[
              { title: 'Trackpunkte', value: stats.pointCount, unit: 'Punkte', icon: '📍', color: '#3b82f6' },
              { title: 'Gesamtdistanz', value: (stats.totalDistance / 1000).toFixed(2), unit: 'km', icon: '📏', color: '#22c55e' },
              { title: 'Flugdauer', value: `${Math.floor(stats.duration / 60)}:${(Math.floor(stats.duration % 60)).toString().padStart(2, '0')}`, unit: 'min', icon: '⏱️', color: '#f59e0b' },
              { title: 'Min Höhe', value: stats.minAlt, unit: 'm', icon: '⬇️', color: '#84cc16' },
              { title: 'Max Höhe', value: stats.maxAlt, unit: 'm', icon: '⬆️', color: '#ef4444' },
              { title: 'Höhengewinn', value: stats.totalClimb, unit: 'm', icon: '📈', color: '#22c55e' },
              { title: 'Höhenverlust', value: stats.totalDescent, unit: 'm', icon: '📉', color: '#f97316' },
              { title: 'Ø Geschwindigkeit', value: stats.avgSpeed.toFixed(1), unit: 'km/h', icon: '🚀', color: '#3b82f6' },
              { title: 'Max Geschwindigkeit', value: stats.maxSpeed.toFixed(1), unit: 'km/h', icon: '⚡', color: '#ef4444' }
            ].map((stat, index) => (
              <div key={index} style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                border: `2px solid ${stat.color}`,
                transition: 'transform 0.2s'
              }}>
                <div style={{
                  fontSize: '32px',
                  marginBottom: '10px'
                }}>
                  {stat.icon}
                </div>
                <div style={{
                  fontSize: '14px',
                  color: '#888',
                  marginBottom: '8px'
                }}>
                  {stat.title}
                </div>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: stat.color,
                  marginBottom: '5px'
                }}>
                  {stat.value}
                </div>
                <div style={{
                  fontSize: '14px',
                  color: '#aaa'
                }}>
                  {stat.unit}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legende */}
      <div style={{
        marginTop: '20px',
        padding: '15px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '8px',
        display: 'flex',
        gap: '20px',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '20px', height: '3px', background: '#22c55e' }} />
          <span style={{ color: '#fff', fontSize: '12px' }}>Langsam (&lt;5 km/h)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '20px', height: '3px', background: '#eab308' }} />
          <span style={{ color: '#fff', fontSize: '12px' }}>Mittel (5-15 km/h)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '20px', height: '3px', background: '#ef4444' }} />
          <span style={{ color: '#fff', fontSize: '12px' }}>Schnell (&gt;15 km/h)</span>
        </div>
      </div>
    </div>
  )
}
