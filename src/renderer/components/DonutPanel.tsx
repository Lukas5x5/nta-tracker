/**
 * Donut Tool Panel
 * Berechnet optimale Donut-Platzierung und Flugstrategie
 * für maximale Strecke im Ring.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { calculateDonut } from '../utils/donutCalculator'
import { latLonToUTM as latLonToUTMWGS84, latLonToMGRS, getGridPrecision } from '../utils/coordinatesWGS84'
import { WindSource, WindSourceFilter } from '../../shared/types'

const toFt50 = (m: number) => Math.round(m * 3.28084 / 50) * 50
const ftToM = (ft: number) => ft / 3.28084

interface Props {
  onClose: () => void
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
}

export function DonutPanel({ onClose, style, onMouseDown, onTouchStart }: Props) {
  const { gpsData, baroData, tasks, settings, windLayers: allWindLayers } = useFlightStore()
  const donutResult = useFlightStore(s => s.donutResult)
  const setDonutResult = useFlightStore(s => s.setDonutResult)
  const setActiveTask = useFlightStore(s => s.setActiveTask)
  const setSelectedGoal = useFlightStore(s => s.setSelectedGoal)
  const updateGoalPosition = useFlightStore(s => s.updateGoalPosition)
  const o = getOutdoor(settings.outdoorMode)

  const [windFilter, setWindFilter] = useState<WindSourceFilter>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [minDistKm, setMinDistKm] = useState('3.0')
  const [minAltFt, setMinAltFt] = useState('')   // Min Höhe in ft (leer = kein Filter)
  const [maxAltFt, setMaxAltFt] = useState('')   // Max Höhe in ft (leer = kein Filter)
  const [groundElevation, setGroundElevation] = useState<number>(0)
  const [calculating, setCalculating] = useState(false)
  const [noResult, setNoResult] = useState(false)
  const [declaredCoords, setDeclaredCoords] = useState<{ lat: number; lon: number } | null>(null)

  // Tasks mit mindestens 2 Ringen filtern
  const donutTasks = tasks.filter(t => t.rings && t.rings.length >= 2)

  // Auto-Select erster passender Task
  useEffect(() => {
    if (!selectedTaskId && donutTasks.length > 0) {
      setSelectedTaskId(donutTasks[0].id)
    }
  }, [donutTasks.length])

  const selectedTask = donutTasks.find(t => t.id === selectedTaskId) || null
  const innerRadius = selectedTask?.rings ? Math.min(...selectedTask.rings) : 0
  const outerRadius = selectedTask?.rings ? Math.max(...selectedTask.rings) : 0

  // Geländehöhe laden
  useEffect(() => {
    if (!gpsData) return
    ;(window as any).ntaAPI?.elevation?.getElevation(gpsData.latitude, gpsData.longitude)
      .then((elev: number | null) => setGroundElevation(elev ?? 0))
      .catch(() => setGroundElevation(0))
  }, [gpsData?.latitude, gpsData?.longitude])

  // Wind filtern (Quelle + Höhenlimits)
  const minAltM = minAltFt ? ftToM(parseFloat(minAltFt)) : null
  const maxAltM = maxAltFt ? ftToM(parseFloat(maxAltFt)) : null

  const filteredWindLayers = allWindLayers.filter(l => {
    if (l.speed <= 0) return false
    if (windFilter === 'all') { /* alle Quellen */ }
    else if (windFilter === 'forecast' && l.source !== WindSource.Forecast) return false
    else if (windFilter === 'measured' && l.source !== WindSource.Measured) return false
    else if (windFilter === 'sounding' && l.source !== WindSource.Windsond && l.source !== WindSource.Pibal) return false
    // Höhenfilter
    if (minAltM !== null && l.altitude < minAltM) return false
    if (maxAltM !== null && l.altitude > maxAltM) return false
    return true
  })

  const currentAlt = baroData?.pressureAltitude || gpsData?.altitude || 0
  const minDistM = parseFloat(minDistKm) * 1000
  const canCalculate = gpsData && selectedTask && filteredWindLayers.length >= 2 && innerRadius > 0 && outerRadius > innerRadius && minDistM > 0

  // Berechnung
  const doCalculate = useCallback(() => {
    if (!gpsData || !selectedTask || filteredWindLayers.length < 2) return
    setCalculating(true)
    setNoResult(false)
    setDeclaredCoords(null)

    setTimeout(() => {
      try {
        const result = calculateDonut({
          pilotLat: gpsData.latitude,
          pilotLon: gpsData.longitude,
          pilotAltitude: currentAlt,
          innerRadius,
          outerRadius,
          minCenterDist: minDistM,
          groundElevation,
          windLayers: filteredWindLayers,
        })
        setDonutResult(result)
        setNoResult(!result)
        if (!result) console.warn('[Donut] Keine Strategie gefunden')
      } catch (e) {
        console.error('[Donut] Berechnungsfehler:', e)
        setDonutResult(null)
        setNoResult(true)
      }
      setCalculating(false)
    }, 50)
  }, [gpsData, selectedTask, filteredWindLayers, currentAlt, innerRadius, outerRadius, minDistM, groundElevation])

  // Deklarieren: Task-Goal auf Donut-Mittelpunkt setzen
  const doDeclare = useCallback(() => {
    if (!donutResult || !selectedTask) return
    const task = tasks.find(t => t.id === selectedTask.id)
    if (!task) return

    // Task aktivieren
    setActiveTask(task)

    // Erstes Goal auf den Donut-Mittelpunkt verschieben
    if (task.goals && task.goals.length > 0) {
      const goal = task.goals[0]
      updateGoalPosition(goal.id, donutResult.centerLat, donutResult.centerLon)
      // Goal auswählen damit Ringe gezeichnet werden
      setSelectedGoal({
        ...goal,
        position: {
          ...goal.position,
          latitude: donutResult.centerLat,
          longitude: donutResult.centerLon
        }
      })
      setDeclaredCoords({ lat: donutResult.centerLat, lon: donutResult.centerLon })
    }
  }, [donutResult, selectedTask, tasks])

  const currentAltFt = Math.round(currentAlt * 3.28084 / 50) * 50

  // Farben
  const accentColor = '#ec4899'
  const instrColor = donutResult?.instructionAction === 'STEIGEN' ? '#22c55e'
    : donutResult?.instructionAction === 'SINKEN' ? '#ef4444' : '#06b6d4'
  const rateAbs = donutResult?.recommendedRate || 0
  const rateColor = rateAbs <= 2 ? (o.on ? '#15803d' : '#22c55e') : rateAbs <= 3.5 ? (o.on ? '#b45309' : '#f59e0b') : (o.on ? '#dc2626' : '#ef4444')

  // Input-Style für Höhenfelder
  const altInputStyle: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none', outline: 'none',
    color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.7})`, fontWeight: 700, fontFamily: 'monospace', fontSize: '11px',
    padding: 0
  }

  return (
    <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ ...style, minWidth: '240px', maxWidth: '280px', maxHeight: '70vh', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: accentColor }}>
            🍩 DONUT <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontWeight: 400 }}>BETA</span>
          </span>
          {/* Wind-Filter */}
          <div style={{ display: 'flex', gap: '2px', background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.12 : 0.05})`, borderRadius: '4px', padding: '2px' }}>
            {([
              { key: 'all' as const, label: 'Alle', color: '#3b82f6' },
              { key: 'forecast' as const, label: 'FC', color: '#0ea5e9' },
              { key: 'measured' as const, label: 'Live', color: '#22c55e' },
              { key: 'sounding' as const, label: '.dat', color: '#a855f7' }
            ]).map(opt => (
              <button key={opt.key} onClick={() => setWindFilter(opt.key)}
                style={{
                  padding: '2px 5px', border: 'none', borderRadius: '3px', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
                  background: windFilter === opt.key ? `${opt.color}30` : 'transparent',
                  color: windFilter === opt.key ? opt.color : `rgba(${o.c},${o.c},${o.c},${o.textDim})`,
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.4})`, cursor: 'pointer', fontSize: '15px', padding: '0 2px' }}>✕</button>
      </div>

      {/* Task-Auswahl */}
      <div style={{ marginBottom: '5px' }}>
        <select
          value={selectedTaskId || ''}
          onChange={e => { setSelectedTaskId(e.target.value || null); setDonutResult(null) }}
          style={{
            width: '100%', padding: '6px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 600,
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`,
            color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.9 : 0.7})`,
            border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.15 : 0.08})`,
            cursor: 'pointer'
          }}>
          {donutTasks.length === 0 && <option value="">Kein Task mit Ringen</option>}
          {donutTasks.map(t => (
            <option key={t.id} value={t.id}>
              {t.taskNumber ? `${t.taskNumber}: ` : ''}{t.name || t.type}
              {t.rings ? ` (${t.rings.map(r => `${(r / 1000).toFixed(1)}km`).join(' / ')})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Ring-Info + Mindestabstand */}
      {selectedTask && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
          <div style={{
            flex: 1, padding: '5px 8px', borderRadius: '5px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
            fontSize: '10px'
          }}>
            <div style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontSize: '8px', fontWeight: 600 }}>INNER</div>
            <div style={{ color: accentColor, fontWeight: 700, fontFamily: 'monospace' }}>
              {(innerRadius / 1000).toFixed(1)} km
            </div>
          </div>
          <div style={{
            flex: 1, padding: '5px 8px', borderRadius: '5px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
            fontSize: '10px'
          }}>
            <div style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontSize: '8px', fontWeight: 600 }}>OUTER</div>
            <div style={{ color: accentColor, fontWeight: 700, fontFamily: 'monospace' }}>
              {(outerRadius / 1000).toFixed(1)} km
            </div>
          </div>
          <div style={{
            flex: 1, padding: '5px 8px', borderRadius: '5px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
            fontSize: '10px'
          }}>
            <div style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontSize: '8px', fontWeight: 600 }}>MIN DIST</div>
            <input
              type="number"
              value={minDistKm}
              onChange={e => { setMinDistKm(e.target.value); setDonutResult(null) }}
              step="0.5"
              min="0.5"
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                color: accentColor, fontWeight: 700, fontFamily: 'monospace', fontSize: '12px',
                padding: 0
              }}
            />
            <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>km</span>
          </div>
        </div>
      )}

      {/* Min/Max Höhe Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px' }}>
        <div style={{
          flex: 1, padding: '5px 8px', borderRadius: '5px',
          background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
          fontSize: '10px'
        }}>
          <div style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontSize: '8px', fontWeight: 600 }}>MIN HÖHE</div>
          <input
            type="number"
            value={minAltFt}
            onChange={e => { setMinAltFt(e.target.value); setDonutResult(null) }}
            placeholder="—"
            step="100"
            style={altInputStyle}
          />
          <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>ft</span>
        </div>
        <div style={{
          flex: 1, padding: '5px 8px', borderRadius: '5px',
          background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
          fontSize: '10px'
        }}>
          <div style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, fontSize: '8px', fontWeight: 600 }}>MAX HÖHE</div>
          <input
            type="number"
            value={maxAltFt}
            onChange={e => { setMaxAltFt(e.target.value); setDonutResult(null) }}
            placeholder="—"
            step="100"
            style={altInputStyle}
          />
          <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>ft</span>
        </div>
        <div style={{
          flex: 1, padding: '5px 8px', borderRadius: '5px',
          background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.04 : 0.02})`,
          fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`
        }}>
          {filteredWindLayers.length} Schichten
        </div>
      </div>

      {/* Berechnen */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
        <button onClick={doCalculate} disabled={!canCalculate || calculating}
          style={{
            flex: 1, padding: '6px', borderRadius: '5px', border: 'none',
            background: canCalculate && !calculating ? accentColor : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
            color: canCalculate && !calculating ? 'white' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.3 : 0.2})`,
            fontSize: '11px', fontWeight: 700, cursor: canCalculate && !calculating ? 'pointer' : 'not-allowed'
          }}>
          {calculating ? 'Berechne...' : 'Berechnen'}
        </button>
        {donutResult && (
          <button onClick={() => setDonutResult(null)}
            style={{ padding: '6px 8px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '9px', fontWeight: 600, cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </div>

      {!canCalculate && (
        <div style={{ fontSize: '9px', color: accentColor, textAlign: 'center', marginBottom: '6px' }}>
          {!gpsData ? 'Kein GPS' : !selectedTask ? 'Kein Task mit Ringen' : filteredWindLayers.length < 2 ? 'Mind. 2 Windschichten' : innerRadius >= outerRadius ? 'Ungültige Ringe' : 'Mindestabstand eingeben'}
        </div>
      )}

      {/* Kein Ergebnis */}
      {noResult && !donutResult && !calculating && (
        <div style={{
          padding: '10px', borderRadius: '6px', marginBottom: '5px', textAlign: 'center',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)'
        }}>
          <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 600, marginBottom: '2px' }}>Keine Strategie gefunden</div>
          <div style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>
            Die Winde reichen nicht um den Ring bei diesem Abstand zu erreichen. Versuche kürzeren Mindestabstand oder anderen Höhenbereich.
          </div>
        </div>
      )}

      {/* Ergebnis */}
      {donutResult && (
        <>
          {/* Strecke im Ring — Haupt-Ergebnis */}
          <div style={{
            textAlign: 'center', padding: '8px 8px', borderRadius: '6px', marginBottom: '5px',
            background: `${accentColor}15`, border: `1px solid ${accentColor}40`
          }}>
            <div style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '2px', fontWeight: 600 }}>
              🍩 STRECKE IM RING
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'monospace', color: accentColor, lineHeight: 1 }}>
              {donutResult.trackInRing >= 1000
                ? `${(donutResult.trackInRing / 1000).toFixed(1)}`
                : donutResult.trackInRing}
            </div>
            <div style={{ fontSize: '12px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
              {donutResult.trackInRing >= 1000 ? 'km' : 'm'}
            </div>
          </div>

          {/* Donut-Platzierung + Zickzack-Info */}
          <div style={{
            display: 'flex', gap: '4px', marginBottom: '5px'
          }}>
            <div style={{
              flex: 1, textAlign: 'center', padding: '5px', borderRadius: '6px',
              background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
              border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.1 : 0.05})`
            }}>
              <span style={{ fontSize: '7px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, display: 'block' }}>RICHTUNG</span>
              <span style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'monospace', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.9 : 0.8})` }}>
                {donutResult.centerBearing}°
              </span>
            </div>
            <div style={{
              flex: 1, textAlign: 'center', padding: '5px', borderRadius: '6px',
              background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
              border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.1 : 0.05})`
            }}>
              <span style={{ fontSize: '7px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, display: 'block' }}>ABSTAND</span>
              <span style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'monospace', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.9 : 0.8})` }}>
                {(donutResult.centerDistance / 1000).toFixed(1)}km
              </span>
            </div>
            <div style={{
              flex: 1, textAlign: 'center', padding: '5px', borderRadius: '6px',
              background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
              border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.1 : 0.05})`
            }}>
              <span style={{ fontSize: '7px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, display: 'block' }}>ZICKZACK</span>
              <span style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'monospace', color: accentColor }}>
                {donutResult.zigzagCount}×
              </span>
            </div>
          </div>

          {/* Pendel-Höhen */}
          <div style={{
            display: 'flex', gap: '6px', marginBottom: '5px', justifyContent: 'center', alignItems: 'center',
            padding: '4px 8px', borderRadius: '5px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.04 : 0.02})`,
            fontSize: '10px', fontFamily: 'monospace'
          }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>▲ {toFt50(donutResult.altA)}ft</span>
            <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>⇄</span>
            <span style={{ color: '#3b82f6', fontWeight: 700 }}>▼ {toFt50(donutResult.altB)}ft</span>
          </div>

          {/* Hauptanweisung */}
          <div style={{
            textAlign: 'center', padding: '8px', borderRadius: '6px', marginBottom: '5px',
            background: `${instrColor}15`, border: `1px solid ${instrColor}40`
          }}>
            <div style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '2px' }}>
              {donutResult.instructionAction === 'STEIGEN' ? '▲' : donutResult.instructionAction === 'SINKEN' ? '▼' : '→'} ANWEISUNG
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'monospace', color: instrColor }}>
              {donutResult.instructionAltFt} <span style={{ fontSize: '12px', fontWeight: 400 }}>ft</span>
            </div>
            {donutResult.recommendedRate > 0 && (
              <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: rateColor, marginTop: '2px' }}>
                {donutResult.recommendedRate} m/s
                <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, marginLeft: '4px' }}>
                  ({donutResult.recommendedRateFtMin} ft/min)
                </span>
              </div>
            )}
          </div>

          {/* Flugplan (scrollbar) */}
          <div style={{ marginBottom: '5px' }}>
            <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '3px', fontWeight: 600 }}>
              FLUGPLAN ({donutResult.legs.length} Schritte)
            </div>
            <div style={{ maxHeight: '100px', overflowY: 'auto', borderRadius: '4px' }}>
            {donutResult.legs.map((leg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 6px', marginBottom: '2px', borderRadius: '4px', fontSize: '10px',
                background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.02})`
              }}>
                <span style={{
                  color: leg.action === 'STEIGEN' ? '#22c55e' : leg.action === 'SINKEN' ? '#ef4444' : accentColor,
                  fontWeight: 700, minWidth: '55px'
                }}>
                  {leg.action === 'STEIGEN' ? '▲' : leg.action === 'SINKEN' ? '▼' : '→'} {leg.targetAltitudeFt}ft
                </span>
                {leg.rate > 0 && (
                  <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textSec})`, fontFamily: 'monospace', fontSize: '9px' }}>
                    {leg.rate}m/s
                  </span>
                )}
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontFamily: 'monospace', fontSize: '9px' }}>
                  {leg.trackInRing > 0 ? `${leg.trackInRing >= 1000 ? `${(leg.trackInRing / 1000).toFixed(1)}km` : `${leg.trackInRing}m`}` : '—'}
                </span>
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontFamily: 'monospace' }}>
                  {Math.round(leg.durationSec / 60)}m
                </span>
              </div>
            ))}
            </div>
          </div>

          {/* DEKLARIEREN Button */}
          <button onClick={doDeclare}
            style={{
              width: '100%', padding: '7px', borderRadius: '5px', border: 'none',
              background: declaredCoords ? `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})` : accentColor,
              color: declaredCoords ? `rgba(${o.c},${o.c},${o.c},${o.textSec})` : 'white',
              fontSize: '11px', fontWeight: 800, cursor: 'pointer',
              marginBottom: '4px'
            }}>
            {declaredCoords ? '✓ DEKLARIERT' : '✓ DEKLARIEREN'}
          </button>

          {/* Koordinaten nach Deklaration — im eingestellten Format */}
          {declaredCoords && (() => {
            let eastStr = '', northStr = ''
            const fmt = settings.coordinateFormat
            if (fmt.startsWith('mgrs')) {
              const { east: ePrec, north: nPrec } = getGridPrecision(fmt)
              const mgrs = latLonToMGRS(declaredCoords.lat, declaredCoords.lon, ePrec as 4|5|6, nPrec as 4|5|6)
              eastStr = mgrs.easting
              northStr = mgrs.northing
            } else {
              const utm = latLonToUTMWGS84(declaredCoords.lat, declaredCoords.lon)
              eastStr = Math.round(utm.easting).toString()
              northStr = Math.round(utm.northing).toString()
            }
            return (
              <div style={{
                padding: '5px 8px', borderRadius: '5px', marginBottom: '5px',
                background: `${accentColor}10`, border: `1px solid ${accentColor}25`,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '2px', fontWeight: 600 }}>ZIEL KOORDINATEN</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>E</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.9 : 0.8})` }}>{eastStr}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>N</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.9 : 0.8})` }}>{northStr}</div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Info-Zeile */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, padding: '0 2px' }}>
            <span>{currentAltFt}ft</span>
            <span>Boden: {Math.round(groundElevation * 3.28084)}ft</span>
            <span>~{Math.round(donutResult.totalTimeSec / 60)}min</span>
          </div>
        </>
      )}
    </div>
  )
}
