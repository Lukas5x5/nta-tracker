import React, { useState } from 'react'
import { useFlightStore } from '../stores/flightStore'

// UTM zu WGS84 Konvertierung
function utmToLatLng(zone: number, hemisphere: 'N' | 'S', easting: number, northing: number): { lat: number; lon: number } {
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e / (1 - e * e)
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e))

  const x = easting - 500000
  let y = northing
  if (hemisphere === 'S') y -= 10000000

  const M = y / k0
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * e * e * e * e * e * e / 256))

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)

  const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1))
  const T1 = Math.tan(phi1) * Math.tan(phi1)
  const C1 = e2 * Math.cos(phi1) * Math.cos(phi1)
  const R1 = a * (1 - e * e) / Math.pow(1 - e * e * Math.sin(phi1) * Math.sin(phi1), 1.5)
  const D = x / (N1 * k0)

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2 - 3 * C1 * C1) * D * D * D * D * D * D / 720)

  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180
  const lon = lng0 + (D - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1)

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI }
}

interface PZDrawPanelProps {
  onClose: () => void
}

export function PZDrawPanel({ onClose }: PZDrawPanelProps) {
  const {
    pzDrawPoints,
    addPzDrawPoint,
    removePzDrawPoint,
    finishPzDraw,
    stopPzDrawMode,
    settings
  } = useFlightStore()

  const [pzName, setPzName] = useState('')
  const [pzElevation, setPzElevation] = useState('')
  const [pzClosed, setPzClosed] = useState(true)  // Default: geschlossen
  const [pzRadius, setPzRadius] = useState('')     // Radius in Metern (nur für Einzelpunkt)
  // UTM Bandbuchstaben: C-X (ohne I und O)
  const utmLetters = ['C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X']
  const [utmZone, setUtmZone] = useState(String(settings.utmZone || 33))
  const [utmBand, setUtmBand] = useState('U') // Default U (Mitteleuropa)
  const [utmEasting, setUtmEasting] = useState('')
  const [utmNorthing, setUtmNorthing] = useState('')

  const isSinglePoint = pzDrawPoints.length >= 1 && pzDrawPoints.length < 3
  const isPolygon = pzDrawPoints.length >= 3
  const canFinish = pzDrawPoints.length >= 1

  const handleFinish = () => {
    if (!canFinish) return
    // Höhe in ft
    let elevationFt: number | undefined
    if (pzElevation) {
      const elev = parseFloat(pzElevation)
      if (!isNaN(elev)) {
        elevationFt = elev
      }
    }

    if (isSinglePoint) {
      // Einzelpunkt-Modus: PZ-Punkt mit optionalem Radius
      let radiusM: number | undefined
      if (pzRadius) {
        const r = parseFloat(pzRadius)
        if (!isNaN(r) && r > 0) radiusM = r
      }
      finishPzDraw(pzName || 'Neuer PZ', elevationFt, undefined, false, radiusM)
    } else {
      // Polygon-Modus: Track zeichnen
      finishPzDraw(pzName || 'Neuer Track', elevationFt, pzClosed, true)
    }
    onClose()
  }

  const handleAddCoord = () => {
    const zone = parseInt(utmZone)
    const easting = parseFloat(utmEasting)
    const northing = parseFloat(utmNorthing)
    if (isNaN(zone) || zone < 1 || zone > 60) return
    if (isNaN(easting) || isNaN(northing)) return
    // Hemisphäre aus Bandbuchstabe: N-X = Nord, C-M = Süd
    const hemisphere: 'N' | 'S' = utmBand >= 'N' ? 'N' : 'S'
    const { lat, lon } = utmToLatLng(zone, hemisphere, easting, northing)
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return
    addPzDrawPoint({ lat, lon })
    setUtmEasting('')
    setUtmNorthing('')
  }

  const handleCancel = () => {
    stopPzDrawMode()
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '80px',
        right: '20px',
        width: '320px',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        zIndex: 9999
      }}
    >
      {/* Header */}
      <div style={{
        background: 'rgba(245, 158, 11, 0.15)',
        padding: '12px 16px',
        borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
            <polyline points="4 17 10 11 4 5"/>
            <line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#f59e0b' }}>
            {isPolygon ? 'Track zeichnen' : 'PZ zeichnen'}
          </span>
        </div>
        <button
          onClick={handleCancel}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {/* Anleitung */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
            <strong style={{ color: '#f59e0b' }}>Anleitung:</strong><br />
            Klicke auf die Karte um Punkte zu setzen.<br />
            {pzDrawPoints.length < 1
              ? '1 Punkt = PZ-Punkt, 3+ Punkte = Polygon/Track.'
              : isSinglePoint
                ? 'Fertig für PZ-Punkt oder weitere Punkte für Polygon.'
                : 'Polygon-Modus: Fertig klicken zum Abschließen.'}
          </div>
        </div>

        {/* UTM Koordinaten-Eingabe */}
        <div style={{
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
            UTM Koordinaten eingeben
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
            <input
              type="number"
              min="1"
              max="60"
              value={utmZone}
              onChange={(e) => setUtmZone(e.target.value)}
              placeholder="Zone"
              style={{
                width: '52px',
                padding: '8px 6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#f59e0b',
                fontSize: '12px',
                fontWeight: 600,
                textAlign: 'center',
                outline: 'none'
              }}
            />
            <select
              value={utmBand}
              onChange={(e) => setUtmBand(e.target.value)}
              style={{
                padding: '8px 6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '6px',
                color: '#f59e0b',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {utmLetters.map(l => (
                <option key={l} value={l} style={{ background: '#1e293b', color: '#f59e0b' }}>{l}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="number"
              step="any"
              value={utmEasting}
              onChange={(e) => setUtmEasting(e.target.value)}
              placeholder="Easting"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '8px 6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '11px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCoord()}
            />
            <input
              type="number"
              step="any"
              value={utmNorthing}
              onChange={(e) => setUtmNorthing(e.target.value)}
              placeholder="Northing"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '8px 6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '11px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCoord()}
            />
            <button
              onClick={handleAddCoord}
              disabled={!utmEasting || !utmNorthing}
              style={{
                padding: '8px 12px',
                background: utmEasting && utmNorthing ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${utmEasting && utmNorthing ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '6px',
                color: utmEasting && utmNorthing ? '#f59e0b' : 'rgba(255,255,255,0.3)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: utmEasting && utmNorthing ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap'
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* Punktzähler */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginBottom: '16px'
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: canFinish ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
            border: `2px solid ${canFinish ? '#22c55e' : '#f59e0b'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 700,
            color: canFinish ? '#22c55e' : '#f59e0b'
          }}>
            {pzDrawPoints.length}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
            {isSinglePoint ? 'Punkt (PZ)' : isPolygon ? 'Punkte (Polygon)' : 'Punkte gesetzt'}
          </div>
        </div>

        {/* Name Input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px' }}>
            Name
          </label>
          <input
            type="text"
            value={pzName}
            onChange={(e) => setPzName(e.target.value)}
            placeholder="z.B. Track 1"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '13px',
              outline: 'none'
            }}
            autoFocus
          />
        </div>

        {/* Höhe Input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px' }}>
            Maximale Höhe in ft (optional)
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              value={pzElevation}
              onChange={(e) => setPzElevation(e.target.value)}
              placeholder="z.B. 3500"
              style={{
                flex: 1,
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            <span style={{
              padding: '10px 14px',
              background: '#f59e0b',
              borderRadius: '6px',
              color: '#000',
              fontSize: '14px',
              fontWeight: 700
            }}>
              ft
            </span>
          </div>
        </div>

        {/* Radius Input - nur bei Einzelpunkt */}
        {isSinglePoint && (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px' }}>
              Radius in Meter (optional)
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                value={pzRadius}
                onChange={(e) => setPzRadius(e.target.value)}
                placeholder="z.B. 500"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
              <span style={{
                padding: '10px 14px',
                background: '#f59e0b',
                borderRadius: '6px',
                color: '#000',
                fontSize: '14px',
                fontWeight: 700
              }}>
                m
              </span>
            </div>
          </div>
        )}

        {/* Polygon Form Toggle - nur bei 3+ Punkten */}
        {isPolygon && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '6px' }}>
              Form
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setPzClosed(true)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: pzClosed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${pzClosed ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '6px',
                  color: pzClosed ? '#22c55e' : 'rgba(255,255,255,0.5)',
                  fontSize: '12px',
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
                Geschlossen
              </button>
              <button
                onClick={() => setPzClosed(false)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: !pzClosed ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${!pzClosed ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '6px',
                  color: !pzClosed ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 7 12 3 20 7" />
                  <polyline points="4 17 12 21 20 17" />
                </svg>
                Offen
              </button>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={handleFinish}
            disabled={!canFinish}
            style={{
              flex: 1,
              padding: '12px',
              background: canFinish ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${canFinish ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '8px',
              color: canFinish ? '#22c55e' : 'rgba(255,255,255,0.3)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: canFinish ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {isSinglePoint ? 'PZ erstellen' : 'Fertig'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={removePzDrawPoint}
            disabled={pzDrawPoints.length === 0}
            style={{
              flex: 1,
              padding: '10px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: pzDrawPoints.length > 0 ? '#f59e0b' : 'rgba(255,255,255,0.3)',
              fontSize: '12px',
              cursor: pzDrawPoints.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10h10" />
              <path d="M7 6l-4 4 4 4" />
            </svg>
            Rückgängig
          </button>
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              padding: '10px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Abbrechen
          </button>
        </div>

        {/* Punkt-Liste */}
        {pzDrawPoints.length > 0 && (
          <div style={{
            marginTop: '16px',
            maxHeight: '120px',
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '6px',
            padding: '8px'
          }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
              Gesetzte Punkte:
            </div>
            {pzDrawPoints.map((point, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 6px',
                  background: index === 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.03)',
                  borderRadius: '4px',
                  marginBottom: '2px'
                }}
              >
                <span style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: index === 0 ? '#22c55e' : '#f59e0b',
                  color: '#000',
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {index + 1}
                </span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                  {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
