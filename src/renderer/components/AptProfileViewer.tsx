import React, { useState } from 'react'
import { createPortal } from 'react-dom'

// ═══════════════════════════════════════════════════════════════════
// APT Profile Viewer — Gespeichertes APT-Profil anzeigen + analysieren
// ═══════════════════════════════════════════════════════════════════

interface ProfilePoint {
  timeMinutes: number
  altitudeFt: number
}

interface HistoryPoint {
  timeMinutes: number
  actualFt: number
  targetFt: number
  layer: 'A' | 'B' | 'outside'
}

export interface AptProfileData {
  type: 'apt_profile'
  profilePoints: ProfilePoint[]
  layerAFt: number
  layerBFt: number
  history: HistoryPoint[]
  totalDuration: number
  taskName: string
  stats: { layerAPercent: number; layerBPercent: number; outsidePercent: number }
  savedAt: string
}

interface AptProfileViewerProps {
  data: AptProfileData
  name: string
  onClose: () => void
}

function interpolateProfile(timeMinutes: number, points: ProfilePoint[]): number | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0].altitudeFt
  if (timeMinutes <= points[0].timeMinutes) return points[0].altitudeFt
  if (timeMinutes >= points[points.length - 1].timeMinutes) return points[points.length - 1].altitudeFt

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (timeMinutes >= p1.timeMinutes && timeMinutes <= p2.timeMinutes) {
      const fraction = (timeMinutes - p1.timeMinutes) / (p2.timeMinutes - p1.timeMinutes)
      return p1.altitudeFt + (p2.altitudeFt - p1.altitudeFt) * fraction
    }
  }
  return points[points.length - 1].altitudeFt
}

export function AptProfileViewer({ data, name, onClose }: AptProfileViewerProps) {
  const { profilePoints, layerAFt, layerBFt, history, totalDuration, stats, taskName } = data
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null)

  // ═══ SVG Rendering ═══
  const SVG_WIDTH = 520
  const SVG_HEIGHT = 280
  const PADDING = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartW = SVG_WIDTH - PADDING.left - PADDING.right
  const chartH = SVG_HEIGHT - PADDING.top - PADDING.bottom

  // Höhen-Range berechnen
  const allAltitudes = [
    ...profilePoints.map(p => p.altitudeFt + layerBFt),
    ...profilePoints.map(p => p.altitudeFt - layerBFt),
    ...history.map(h => h.actualFt),
  ]
  const minAlt = allAltitudes.length > 0 ? Math.min(...allAltitudes) - 50 : 1500
  const maxAlt = allAltitudes.length > 0 ? Math.max(...allAltitudes) + 50 : 3500
  const altRange = maxAlt - minAlt || 1

  const svgX = (timeMin: number) => PADDING.left + (timeMin / totalDuration) * chartW
  const svgY = (altFt: number) => PADDING.top + chartH - ((altFt - minAlt) / altRange) * chartH

  // Layer B Band
  const layerBPoints = (() => {
    if (profilePoints.length < 2) return ''
    const steps = 80
    const upper: string[] = []
    const lower: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalDuration
      const alt = interpolateProfile(t, profilePoints)
      if (alt === null) continue
      upper.push(`${svgX(t)},${svgY(alt + layerBFt)}`)
      lower.unshift(`${svgX(t)},${svgY(alt - layerBFt)}`)
    }
    return [...upper, ...lower].join(' ')
  })()

  // Layer A Band
  const layerAPoints = (() => {
    if (profilePoints.length < 2) return ''
    const steps = 80
    const upper: string[] = []
    const lower: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalDuration
      const alt = interpolateProfile(t, profilePoints)
      if (alt === null) continue
      upper.push(`${svgX(t)},${svgY(alt + layerAFt)}`)
      lower.unshift(`${svgX(t)},${svgY(alt - layerAFt)}`)
    }
    return [...upper, ...lower].join(' ')
  })()

  // Profil-Linie
  const profileLine = profilePoints.map(p => `${svgX(p.timeMinutes)},${svgY(p.altitudeFt)}`).join(' ')

  // Pilot-Spur (segmentiert nach Layer-Farbe)
  const renderPilotTrack = () => {
    if (history.length < 2) return null
    const segments: { points: string; color: string }[] = []
    let currentSegmentLayer = history[0].layer
    let currentSegmentPoints = [`${svgX(history[0].timeMinutes)},${svgY(history[0].actualFt)}`]

    for (let i = 1; i < history.length; i++) {
      const h = history[i]
      const ptStr = `${svgX(h.timeMinutes)},${svgY(h.actualFt)}`

      if (h.layer !== currentSegmentLayer) {
        currentSegmentPoints.push(ptStr)
        segments.push({
          points: currentSegmentPoints.join(' '),
          color: currentSegmentLayer === 'A' ? '#22c55e' : currentSegmentLayer === 'B' ? '#eab308' : '#ef4444'
        })
        currentSegmentLayer = h.layer
        currentSegmentPoints = [ptStr]
      } else {
        currentSegmentPoints.push(ptStr)
      }
    }
    if (currentSegmentPoints.length > 1) {
      segments.push({
        points: currentSegmentPoints.join(' '),
        color: currentSegmentLayer === 'A' ? '#22c55e' : currentSegmentLayer === 'B' ? '#eab308' : '#ef4444'
      })
    }

    return segments.map((seg, i) => (
      <polyline
        key={i}
        points={seg.points}
        fill="none"
        stroke={seg.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))
  }

  // Grid
  const renderGrid = () => {
    const lines: React.ReactNode[] = []
    const altStep = altRange > 800 ? 200 : 100
    const startAlt = Math.ceil(minAlt / altStep) * altStep
    for (let alt = startAlt; alt <= maxAlt; alt += altStep) {
      const y = svgY(alt)
      lines.push(
        <line key={`h-${alt}`} x1={PADDING.left} y1={y} x2={SVG_WIDTH - PADDING.right} y2={y}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" />,
        <text key={`ht-${alt}`} x={PADDING.left - 5} y={y + 3} fill="rgba(255,255,255,0.4)"
          fontSize="9" textAnchor="end">{alt}</text>
      )
    }
    const timeStep = totalDuration > 10 ? 2 : 1
    for (let t = 0; t <= totalDuration; t += timeStep) {
      const x = svgX(t)
      lines.push(
        <line key={`v-${t}`} x1={x} y1={PADDING.top} x2={x} y2={SVG_HEIGHT - PADDING.bottom}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" />,
        <text key={`vt-${t}`} x={x} y={SVG_HEIGHT - PADDING.bottom + 14} fill="rgba(255,255,255,0.4)"
          fontSize="9" textAnchor="middle">{t}m</text>
      )
    }
    return lines
  }

  // Detailanalyse: Max Deviation, etc.
  const maxDeviation = history.reduce((max, h) => {
    const dev = Math.abs(h.actualFt - h.targetFt)
    return dev > max ? dev : max
  }, 0)

  const avgDeviation = history.length > 0
    ? history.reduce((sum, h) => sum + Math.abs(h.actualFt - h.targetFt), 0) / history.length
    : 0

  // Datum formatieren
  const savedDate = new Date(data.savedAt)
  const dateStr = savedDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = savedDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50000
    }}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1e293b',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '560px',
        maxWidth: '600px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
        border: '1px solid rgba(6,182,212,0.3)',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#06b6d4' }}>{name}</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
              {taskName} | {dateStr} {timeStr} | {totalDuration} Min
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', fontSize: '20px', padding: '0 4px'
            }}
          >
            ×
          </button>
        </div>

        {/* SVG Chart */}
        <svg width={SVG_WIDTH} height={SVG_HEIGHT} style={{
          background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '12px',
          width: '100%', height: 'auto',
        }}>
          {renderGrid()}
          {layerBPoints && <polygon points={layerBPoints} fill="rgba(6,182,212,0.06)" stroke="none" />}
          {layerAPoints && <polygon points={layerAPoints} fill="rgba(6,182,212,0.12)" stroke="none" />}
          <polyline points={profileLine} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"
            strokeLinejoin="round" strokeDasharray="4,2" />
          {renderPilotTrack()}
          {/* Profil-Punkte */}
          {profilePoints.map((p, i) => (
            <circle key={i} cx={svgX(p.timeMinutes)} cy={svgY(p.altitudeFt)} r="3"
              fill="rgba(6,182,212,0.6)" />
          ))}
          {/* Ausgewählter Datenpunkt */}
          {selectedPointIdx !== null && history[selectedPointIdx] && (() => {
            const h = history[selectedPointIdx]
            const x = svgX(h.timeMinutes)
            const yActual = svgY(h.actualFt)
            const yTarget = svgY(h.targetFt)
            const layerColor = h.layer === 'A' ? '#22c55e' : h.layer === 'B' ? '#eab308' : '#ef4444'
            const dev = h.actualFt - h.targetFt
            return (
              <>
                {/* Vertikale Linie */}
                <line x1={x} y1={PADDING.top} x2={x} y2={SVG_HEIGHT - PADDING.bottom}
                  stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
                {/* Verbindungslinie IST → SOLL */}
                <line x1={x} y1={yActual} x2={x} y2={yTarget}
                  stroke={layerColor} strokeWidth="1.5" strokeDasharray="2,2" opacity="0.6" />
                {/* SOLL Punkt (Kreuz) */}
                <circle cx={x} cy={yTarget} r="4" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
                {/* IST Punkt (ausgefüllt) */}
                <circle cx={x} cy={yActual} r="6" fill={layerColor} stroke="#fff" strokeWidth="2" />
                {/* Label */}
                <rect x={x + 10} y={yActual - 28} width="90" height="36" rx="4"
                  fill="rgba(0,0,0,0.85)" stroke={layerColor} strokeWidth="1" />
                <text x={x + 14} y={yActual - 14} fill="#fff" fontSize="10" fontWeight="600">
                  IST: {Math.round(h.actualFt)} ft
                </text>
                <text x={x + 14} y={yActual + 1} fill="rgba(255,255,255,0.5)" fontSize="9">
                  Abw: {dev > 0 ? '+' : ''}{Math.round(dev)} ft
                </text>
              </>
            )
          })()}
        </svg>

        {/* Statistik-Grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: '8px', marginBottom: '12px',
        }}>
          {/* Layer A */}
          <div style={{
            padding: '10px', borderRadius: '8px',
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>LAYER A</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>{stats.layerAPercent}%</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>±{layerAFt} ft</div>
          </div>
          {/* Layer B */}
          <div style={{
            padding: '10px', borderRadius: '8px',
            background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>LAYER B</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#eab308' }}>{stats.layerBPercent}%</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>±{layerBFt} ft</div>
          </div>
          {/* Outside */}
          <div style={{
            padding: '10px', borderRadius: '8px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>OUTSIDE</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ef4444' }}>{stats.outsidePercent}%</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>Penalty</div>
          </div>
        </div>

        {/* Detailanalyse */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: '8px', marginBottom: '12px',
        }}>
          <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>MAX ABW.</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: maxDeviation > layerBFt ? '#ef4444' : '#eab308' }}>
              {Math.round(maxDeviation)} ft
            </div>
          </div>
          <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>AVG ABW.</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: avgDeviation > layerAFt ? '#eab308' : '#22c55e' }}>
              {Math.round(avgDeviation)} ft
            </div>
          </div>
          <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>PUNKTE</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{history.length}</div>
          </div>
          <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>DAUER</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{totalDuration}m</div>
          </div>
        </div>

        {/* Datenpunkte (scrollbare Tabelle) */}
        <details style={{ marginBottom: '8px' }}>
          <summary style={{
            fontSize: '11px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
            padding: '6px 0', userSelect: 'none',
          }}>
            Datenpunkte anzeigen ({history.length})
          </summary>
          <div style={{
            maxHeight: '200px', overflowY: 'auto', marginTop: '6px',
            background: 'rgba(0,0,0,0.2)', borderRadius: '6px', padding: '4px',
          }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '60px 70px 70px 60px 50px',
              gap: '4px', padding: '4px 6px',
              fontSize: '9px', color: 'rgba(255,255,255,0.3)', fontWeight: 600,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span>ZEIT</span><span>IST (ft)</span><span>SOLL (ft)</span><span>ABW.</span><span>LAYER</span>
            </div>
            {/* Zeilen — zeige max 500 (bei vielen Daten jeden n-ten) */}
            {(() => {
              const maxRows = 500
              const step = history.length > maxRows ? Math.ceil(history.length / maxRows) : 1
              return history.filter((_, i) => i % step === 0).map((h, filteredIdx) => {
                const originalIdx = filteredIdx * step
                const dev = h.actualFt - h.targetFt
                const layerColor = h.layer === 'A' ? '#22c55e' : h.layer === 'B' ? '#eab308' : '#ef4444'
                const isSelected = selectedPointIdx === originalIdx
                const m = Math.floor(h.timeMinutes)
                const s = Math.floor((h.timeMinutes - m) * 60)
                return (
                  <div key={filteredIdx}
                    onClick={() => setSelectedPointIdx(isSelected ? null : originalIdx)}
                    style={{
                      display: 'grid', gridTemplateColumns: '60px 70px 70px 60px 50px',
                      gap: '4px', padding: '2px 6px',
                      fontSize: '10px', color: isSelected ? '#fff' : 'rgba(255,255,255,0.6)',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: isSelected ? `${layerColor}20` : 'transparent',
                      cursor: 'pointer',
                      borderLeft: isSelected ? `2px solid ${layerColor}` : '2px solid transparent',
                      transition: 'background 0.1s',
                    }}>
                    <span>{m}:{s.toString().padStart(2, '0')}</span>
                    <span>{Math.round(h.actualFt)}</span>
                    <span>{Math.round(h.targetFt)}</span>
                    <span style={{ color: layerColor }}>
                      {dev > 0 ? '+' : ''}{Math.round(dev)}
                    </span>
                    <span style={{ color: layerColor, fontWeight: 600 }}>{h.layer === 'outside' ? 'OUT' : h.layer}</span>
                  </div>
                )
              })
            })()}
          </div>
        </details>

        {/* Schließen */}
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Schließen
        </button>
      </div>
    </div>,
    document.body
  )
}
