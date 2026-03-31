/**
 * PDG Cone Navigator Panel — Vereinfachtes UI
 */
import React, { useState, useEffect } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { calculateCone, calculateConeGuidance, ConeResult, TurnLayer } from '../utils/coneNavigator'
import { latLonToMGRS, formatCoordinate } from '../utils/coordinatesWGS84'
import { Goal } from '../../shared/types'

interface Props {
  onClose: () => void
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
}

export function ConeNavigatorPanel({ onClose, style, onMouseDown, onTouchStart }: Props) {
  const { gpsData, baroData, selectedGoal, settings, tasks, updateTask, setSelectedGoal, windLayers: allWindLayers, setClimbPointResult, setConeLines, coneDeclared, setConeDeclared, coneResult, setConeResult } = useFlightStore()
  const o = getOutdoor(settings.outdoorMode)

  const filteredWindLayers = allWindLayers.filter(l => l.speed > 0)
  const activeCompetitionMap = useFlightStore(s => s.activeCompetitionMap)
  const effectiveUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone || settings.utmZone || 33

  // States
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [minAltFt, setMinAltFt] = useState(1000)
  const [maxAltFt, setMaxAltFt] = useState(0)
  const [minDistM, setMinDistM] = useState(1000)
  const cone = coneResult as ConeResult | null
  const declared = coneDeclared as { lat: number; lon: number; altitude: number; turnLayer: TurnLayer } | null

  const canCalculate = gpsData && selectedGoal && filteredWindLayers.length > 0
  const currentAlt = baroData?.pressureAltitude || gpsData?.altitude || 0
  const currentAltFt = Math.round(currentAlt * 3.28084 / 50) * 50
  const varioMs = baroData?.variometer || 0

  // Live Guidance
  const guidance = declared && gpsData ? calculateConeGuidance(
    gpsData.latitude, gpsData.longitude, currentAlt,
    declared.lat, declared.lon, declared.altitude,
    declared.turnLayer, filteredWindLayers, varioMs
  ) : null

  const targetReached = declared && Math.abs(currentAlt - declared.altitude) < 15
  const declAltFt = declared ? Math.round(declared.altitude * 3.28084 / 50) * 50 : 0

  // Live-Pfad
  useEffect(() => {
    if (targetReached) {
      setClimbPointResult(null)
    } else if (guidance?.livePath && guidance.livePath.length > 1) {
      setClimbPointResult({
        path: guidance.livePath,
        bestPoint: guidance.livePath[guidance.livePath.length - 1],
        distanceToGoal: guidance.distToTarget
      })
    }
  }, [guidance?.livePath?.length, gpsData?.latitude, gpsData?.longitude, currentAlt, targetReached])

  // Berechnen
  const handleCalculate = () => {
    if (!gpsData || !selectedGoal || filteredWindLayers.length === 0) return
    const alt = baroData?.pressureAltitude || gpsData.altitude || 0

    const result = calculateCone({
      lat: gpsData.latitude, lon: gpsData.longitude, altitude: alt,
      direction, minAltChangeFt: minAltFt, maxAltitudeFt: maxAltFt, minDistanceM: minDistM,
      windLayers: filteredWindLayers,
      goalLat: selectedGoal.position.latitude, goalLon: selectedGoal.position.longitude
    })

    setConeResult(result)
    if (result) {
      setConeDeclared({ lat: result.target.lat, lon: result.target.lon, altitude: result.target.altitude, turnLayer: result.turnLayer })
      // Goal auf Deklarationspunkt setzen (wenn Goal vorhanden)
      if (selectedGoal) {
        const updatedGoal: Goal = {
          ...selectedGoal,
          position: { ...selectedGoal.position, latitude: result.target.lat, longitude: result.target.lon, altitude: result.target.altitude, timestamp: new Date() }
        }
        const parentTask = tasks.find(t => t.goals.some(g => g.id === selectedGoal.id))
        if (parentTask) updateTask({ ...parentTask, goals: parentTask.goals.map(g => g.id === selectedGoal.id ? updatedGoal : g) })
        setSelectedGoal(updatedGoal)
      }
      setClimbPointResult({ path: result.path, bestPoint: result.target, distanceToGoal: result.distToGoal })
      setConeLines(result.cone)
    }
  }

  const handleReset = () => {
    setConeResult(null); setConeDeclared(null); setClimbPointResult(null); setConeLines(null)
  }

  // Koordinaten formatieren (nur Easting/Northing bei MGRS)
  const formatCoords = (lat: number, lon: number) => {
    const fmt = settings.coordinateFormat
    if (fmt.startsWith('mgrs')) {
      const precMap: Record<string, [4|5|6, 4|5|6]> = { mgrs4: [4,4], mgrs45: [4,5], mgrs54: [5,4], mgrs5: [5,5], mgrs6: [6,6] }
      const [ep, np] = precMap[fmt] || [4, 4]
      const m = latLonToMGRS(lat, lon, ep, np, effectiveUtmZone)
      return `${m.easting}  ${m.northing}`
    }
    return formatCoordinate(lat, lon, fmt, effectiveUtmZone)
  }

  // Abweichungsfarbe
  const offColor = !guidance ? '#888' :
    Math.abs(guidance.angleOff) <= 3 ? (o.on ? '#15803d' : '#22c55e') :
    Math.abs(guidance.angleOff) <= 15 ? (o.on ? '#b45309' : '#f59e0b') : (o.on ? '#dc2626' : '#ef4444')

  return (
    <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ ...style, minWidth: '260px', maxWidth: '300px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#06b6d4' }}>
          PDG/FON {declared && <span style={{ color: '#22c55e', fontSize: '9px', marginLeft: '6px' }}>DEKLARIERT</span>}
        </span>
        <button onClick={() => { onClose(); if (!declared) handleReset() }}
          style={{ background: 'none', border: 'none', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.4})`, cursor: 'pointer', fontSize: '15px', padding: '0 2px' }}>✕</button>
      </div>

      {/* ═══ EINGABE ═══ */}
      {!declared && (
        <>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {(['up', 'down'] as const).map(dir => (
              <button key={dir} onClick={() => setDirection(dir)}
                style={{
                  flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer',
                  background: direction === dir ? (dir === 'up' ? '#22c55e' : '#ef4444') : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
                  color: direction === dir ? '#fff' : `rgba(${o.c},${o.c},${o.c},${o.textSec})`,
                  border: direction === dir ? 'none' : `1px solid rgba(${o.c},${o.c},${o.c},${o.border})`
                }}>
                {dir === 'up' ? '▲ Steigen' : '▼ Sinken'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontWeight: 600, marginBottom: '3px' }}>
                {direction === 'up' ? 'MIN STEIGEN' : 'MIN SINKEN'}
              </div>
              <input type="number" value={minAltFt} onChange={e => setMinAltFt(Number(e.target.value))}
                step="100" min="0" max="10000"
                style={{ width: '100%', padding: '5px', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`, border: `1px solid rgba(${o.c},${o.c},${o.c},${o.border})`, borderRadius: '5px', color: '#06b6d4', textAlign: 'center', outline: 'none' }} />
              <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, textAlign: 'center', marginTop: '2px' }}>ft</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontWeight: 600, marginBottom: '3px' }}>
                {direction === 'up' ? 'MAX HÖHE' : 'MIN HÖHE'}
              </div>
              <input type="number" value={maxAltFt || ''} onChange={e => setMaxAltFt(Number(e.target.value) || 0)}
                placeholder="∞" step="100" min="0" max="30000"
                style={{ width: '100%', padding: '5px', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`, border: `1px solid rgba(${o.c},${o.c},${o.c},${o.border})`, borderRadius: '5px', color: maxAltFt > 0 ? '#f59e0b' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`, textAlign: 'center', outline: 'none' }} />
              <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, textAlign: 'center', marginTop: '2px' }}>ft absolut</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontWeight: 600 }}>MIN DISTANZ</span>
            <span style={{ fontSize: '12px', color: '#06b6d4', fontWeight: 700, fontFamily: 'monospace' }}>
              {minDistM >= 1000 ? `${(minDistM / 1000).toFixed(1)} km` : `${minDistM} m`}
            </span>
          </div>
          <input type="range" min="0" max="5000" step="100" value={minDistM}
            onChange={e => setMinDistM(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer', marginBottom: '10px' }} />

          <button onClick={handleCalculate} disabled={!canCalculate}
            style={{
              width: '100%', padding: '10px', borderRadius: '6px', border: 'none',
              background: canCalculate ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
              color: canCalculate ? 'white' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.3 : 0.2})`,
              fontSize: '12px', fontWeight: 700, cursor: canCalculate ? 'pointer' : 'not-allowed'
            }}>
            Berechnen & Deklarieren
          </button>
          {!canCalculate && (
            <div style={{ fontSize: '9px', color: '#f59e0b', marginTop: '5px', textAlign: 'center' }}>
              {!gpsData ? 'Kein GPS' : !selectedGoal ? 'Kein Ziel ausgewählt' : 'Keine Windschichten'}
            </div>
          )}
        </>
      )}

      {/* ═══ DEKLARIERT ═══ */}
      {declared && guidance && (
        <>
          {/* Zielhöhe — das Wichtigste, groß und prominent */}
          <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(34,197,94,0.08)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)', marginBottom: '8px' }}>
            <div style={{ fontSize: '42px', fontWeight: 800, fontFamily: 'monospace', color: o.on ? '#15803d' : '#22c55e', lineHeight: 1, letterSpacing: '2px' }}>
              {declAltFt}
              <span style={{ fontSize: '16px', fontWeight: 400, opacity: 0.6 }}> ft</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: o.textColor, marginTop: '6px', letterSpacing: '1px' }}>
              {formatCoords(declared.lat, declared.lon)}
            </div>
          </div>

          {/* Steigrate (nur wenn noch nicht auf Zielhöhe) */}
          {cone && !targetReached && Math.abs(guidance.altDiff) > 50 && (
            <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(6,182,212,0.06)', borderRadius: '6px', border: '1px solid rgba(6,182,212,0.12)', marginBottom: '8px' }}>
              <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>
                {cone.requiredRate > 0 ? 'STEIGEN' : 'SINKEN'}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'monospace', color: o.on ? '#0e7490' : '#06b6d4', marginLeft: '6px' }}>
                {Math.abs(cone.requiredRate)} m/s
              </span>
              <span style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, marginLeft: '4px' }}>
                ({Math.abs(cone.requiredRateFtMin)} ft/min)
              </span>
            </div>
          )}

          {/* Kursabweichung */}
          <div style={{
            textAlign: 'center', padding: '6px', borderRadius: '6px', marginBottom: '8px',
            background: Math.abs(guidance.angleOff) <= 3 ? 'rgba(34,197,94,0.1)' : Math.abs(guidance.angleOff) <= 15 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.15)'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: offColor }}>
              {Math.abs(guidance.angleOff) <= 3 ? '→ Auf Kurs' : guidance.angleOff > 0 ? `${guidance.angleOff}° rechts vorbei` : `${Math.abs(guidance.angleOff)}° links vorbei`}
            </span>
          </div>

          {/* Kompakte Info-Zeile */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'monospace', marginBottom: '8px', padding: '0 2px' }}>
            <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>
              {guidance.distToTarget < 1000 ? `${guidance.distToTarget}m` : `${(guidance.distToTarget / 1000).toFixed(1)}km`}
            </span>
            <span style={{ color: o.textColor, fontWeight: 600 }}>
              {currentAltFt}ft
              <span style={{ color: guidance.altDiff > 0 ? '#22c55e' : guidance.altDiff < 0 ? '#ef4444' : '#06b6d4', marginLeft: '3px', fontSize: '10px' }}>
                {guidance.altDiff > 0 ? '+' : ''}{guidance.altDiff}ft
              </span>
            </span>
            <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>
              {guidance.driftBearing}°→{guidance.bearingToTarget}°
            </span>
          </div>

          {/* Korrektur-Höhen */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <div style={{ flex: 1, padding: '4px', background: o.on ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.06)', borderRadius: '4px', textAlign: 'center', border: o.on ? '1px solid rgba(245,158,11,0.25)' : 'none' }}>
              <div style={{ fontSize: '8px', color: o.on ? '#b45309' : '#f59e0b', fontWeight: 700 }}>← LINKS</div>
              <div style={{ fontSize: '13px', fontFamily: 'monospace', color: guidance.leftAltFt !== guidance.centerAltFt ? o.textColor : `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontWeight: 700 }}>
                {guidance.leftAltFt !== guidance.centerAltFt ? `${guidance.leftAltFt}ft` : '—'}
              </div>
            </div>
            <div style={{ flex: 1, padding: '4px', background: o.on ? 'rgba(6,182,212,0.12)' : 'rgba(6,182,212,0.06)', borderRadius: '4px', textAlign: 'center', border: o.on ? '1px solid rgba(6,182,212,0.25)' : 'none' }}>
              <div style={{ fontSize: '8px', color: o.on ? '#0e7490' : '#06b6d4', fontWeight: 700 }}>MITTE</div>
              <div style={{ fontSize: '13px', fontFamily: 'monospace', color: o.textColor, fontWeight: 700 }}>{guidance.centerAltFt}ft</div>
            </div>
            <div style={{ flex: 1, padding: '4px', background: o.on ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)', borderRadius: '4px', textAlign: 'center', border: o.on ? '1px solid rgba(59,130,246,0.25)' : 'none' }}>
              <div style={{ fontSize: '8px', color: o.on ? '#1d4ed8' : '#3b82f6', fontWeight: 700 }}>RECHTS →</div>
              <div style={{ fontSize: '13px', fontFamily: 'monospace', color: guidance.rightAltFt !== guidance.centerAltFt ? o.textColor : `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontWeight: 700 }}>
                {guidance.rightAltFt !== guidance.centerAltFt ? `${guidance.rightAltFt}ft` : '—'}
              </div>
            </div>
          </div>

          {/* Warnung */}
          {cone?.turnLayer.warning && (
            <div style={{ fontSize: '9px', color: '#f59e0b', marginBottom: '6px', textAlign: 'center' }}>{cone.turnLayer.warning}</div>
          )}

          {/* Reset */}
          <button onClick={handleReset}
            style={{
              width: '100%', padding: '7px', borderRadius: '5px',
              border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)',
              color: '#ef4444', fontSize: '10px', fontWeight: 600, cursor: 'pointer'
            }}>
            Deklaration aufheben
          </button>
        </>
      )}
    </div>
  )
}
