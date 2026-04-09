/**
 * Wind Navigation Panel (WNV)
 * Zwei Modi:
 * - Planungsmodus: Strategie berechnen und deklarieren
 * - Cockpitmodus: Live-Guidance mit CDI, Fortschritt, Anweisungen
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { calculateWindNav, calculateWnvGuidance, recalculateWnvFromCurrent } from '../utils/windNavigation'
import { WindSource, WindSourceFilter } from '../../shared/types'

interface Props {
  onClose: () => void
  style?: React.CSSProperties
  onMouseDown?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
}

export function WindNavPanel({ onClose, style, onMouseDown, onTouchStart }: Props) {
  const { gpsData, baroData, selectedGoal, settings, windLayers: allWindLayers } = useFlightStore()
  const wnvConfig = useFlightStore(s => s.wnvConfig)
  const updateWnvConfig = useFlightStore(s => s.updateWnvConfig)
  const wnvResult = useFlightStore(s => s.wnvResult)
  const setWnvResult = useFlightStore(s => s.setWnvResult)
  const wnvDeclared = useFlightStore(s => s.wnvDeclared)
  const setWnvDeclared = useFlightStore(s => s.setWnvDeclared)
  const wnvGuidance = useFlightStore(s => s.wnvGuidance)
  const setWnvGuidance = useFlightStore(s => s.setWnvGuidance)
  const o = getOutdoor(settings.outdoorMode)

  const [windFilter, setWindFilter] = useState<WindSourceFilter>('all')
  const [goalElevation, setGoalElevation] = useState<number | null>(null)
  const [showFlugplan, setShowFlugplan] = useState(false)

  // Wind filtern
  const filteredWindLayers = allWindLayers.filter(l => {
    if (l.speed <= 0) return false
    if (windFilter === 'all') return true
    if (windFilter === 'forecast') return l.source === WindSource.Forecast
    if (windFilter === 'measured') return l.source === WindSource.Measured
    if (windFilter === 'sounding') return l.source === WindSource.Windsond || l.source === WindSource.Pibal
    return true
  })

  // Geländehöhe am Ziel laden
  useEffect(() => {
    if (!selectedGoal) { setGoalElevation(null); return }
    const { latitude, longitude } = selectedGoal.position
    ;(window as any).ntaAPI?.elevation?.getElevation(latitude, longitude)
      .then((elev: number | null) => setGoalElevation(elev ?? 0))
      .catch(() => setGoalElevation(0))
  }, [selectedGoal?.id])

  const currentAlt = baroData?.pressureAltitude || gpsData?.altitude || 0
  const canCalculate = gpsData && selectedGoal && filteredWindLayers.length >= 2 && goalElevation !== null

  // Berechnung
  const doCalculate = useCallback(() => {
    if (!gpsData || !selectedGoal || filteredWindLayers.length < 2 || goalElevation === null) return
    const result = calculateWindNav({
      pilotLat: gpsData.latitude, pilotLon: gpsData.longitude,
      pilotAltitude: currentAlt,
      goalLat: selectedGoal.position.latitude, goalLon: selectedGoal.position.longitude,
      goalElevation,
      windLayers: filteredWindLayers,
      maxLegs: wnvConfig.maxLegs,
    })
    setWnvResult(result)
  }, [gpsData?.latitude, gpsData?.longitude, currentAlt, selectedGoal, goalElevation, filteredWindLayers, wnvConfig.maxLegs])

  // Deklarieren
  const doDeclare = useCallback(() => {
    if (!wnvResult || !gpsData) return
    setWnvDeclared({
      strategy: wnvResult,
      declaredAt: Date.now(),
      declaredLat: gpsData.latitude,
      declaredLon: gpsData.longitude,
      declaredAlt: currentAlt,
    })
  }, [wnvResult, gpsData, currentAlt])

  // Deklaration aufheben
  const doUndeclare = useCallback(() => {
    setWnvDeclared(null)
    setWnvGuidance(null)
  }, [])

  // Neuberechnung mit Continuity-Bias
  const doRecalculate = useCallback(() => {
    if (!gpsData || !selectedGoal || filteredWindLayers.length < 2 || goalElevation === null || !wnvDeclared) return
    const result = recalculateWnvFromCurrent(
      {
        pilotLat: gpsData.latitude, pilotLon: gpsData.longitude,
        pilotAltitude: currentAlt,
        goalLat: selectedGoal.position.latitude, goalLon: selectedGoal.position.longitude,
        goalElevation,
        windLayers: filteredWindLayers,
        maxLegs: wnvConfig.maxLegs,
      },
      wnvDeclared.strategy.altitudeSequence
    )
    if (result) {
      setWnvResult(result)
      setWnvDeclared({
        strategy: result,
        declaredAt: Date.now(),
        declaredLat: gpsData.latitude,
        declaredLon: gpsData.longitude,
        declaredAlt: currentAlt,
      })
      setWnvGuidance(null)
    }
  }, [gpsData, selectedGoal, filteredWindLayers, goalElevation, currentAlt, wnvConfig.maxLegs, wnvDeclared])

  // Live-Guidance Update (alle 3s wenn deklariert)
  const lastGuidanceRef = useRef(0)
  useEffect(() => {
    if (!wnvDeclared || !gpsData || !selectedGoal || filteredWindLayers.length < 2 || goalElevation === null) return
    if (Date.now() - lastGuidanceRef.current < 3000) return
    lastGuidanceRef.current = Date.now()

    const guidance = calculateWnvGuidance(
      gpsData.latitude, gpsData.longitude, currentAlt,
      wnvDeclared.strategy,
      selectedGoal.position.latitude, selectedGoal.position.longitude, goalElevation,
      filteredWindLayers,
      wnvDeclared.declaredAlt
    )
    setWnvGuidance(guidance)
  }, [wnvDeclared, gpsData?.latitude, gpsData?.longitude, currentAlt, selectedGoal, filteredWindLayers, goalElevation])

  // Auto-Berechnung im Planungsmodus (wenn kein Declare aktiv)
  const lastCalcRef = useRef(0)
  useEffect(() => {
    if (wnvDeclared) return  // Im Cockpit-Modus nicht automatisch neu berechnen
    if (!wnvConfig.autoRecalc || !canCalculate) return
    if (Date.now() - lastCalcRef.current < 3000) return
    lastCalcRef.current = Date.now()
    doCalculate()
  }, [wnvDeclared, wnvConfig.autoRecalc, canCalculate, gpsData?.latitude, gpsData?.longitude, currentAlt, doCalculate])

  const currentAltFt = Math.round(currentAlt * 3.28084 / 50) * 50

  // ═══════════════════════════════════════════════════════════════════
  // Cockpit-Modus (nach Deklaration)
  // ═══════════════════════════════════════════════════════════════════

  if (wnvDeclared && wnvGuidance) {
    const g = wnvGuidance
    const instrColor = g.action === 'STEIGEN' ? '#22c55e' : g.action === 'SINKEN' ? '#ef4444' : '#06b6d4'
    const rateAbs = g.recommendedRate || 0
    const rateColor = rateAbs <= 2 ? (o.on ? '#15803d' : '#22c55e') : rateAbs <= 3.5 ? (o.on ? '#b45309' : '#f59e0b') : (o.on ? '#dc2626' : '#ef4444')
    const devColor = g.deviationLevel === 'on-track' ? '#22c55e' : g.deviationLevel === 'minor' ? '#f59e0b' : '#ef4444'

    // CDI-Position: -1 (links) bis +1 (rechts), begrenzt auf ±300m
    const cdiPos = Math.max(-1, Math.min(1, g.crossTrackErrorM / 300))
    const cdiPercent = 50 + cdiPos * 40  // 10% bis 90%

    // Fortschrittsbalken-Farbe
    const phaseColor = g.legPhase === 'climb' ? '#22c55e' : g.legPhase === 'drift' ? '#f59e0b' : '#ef4444'
    const phaseLabel = g.legPhase === 'climb' ? 'Steigen' : g.legPhase === 'drift' ? 'Drift' : 'Sinken'

    return (
      <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ ...style, minWidth: '250px', maxWidth: '290px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>
            🧭 WNV <span style={{ fontSize: '8px', color: devColor, fontWeight: 600 }}>LIVE</span>
          </span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.4})`, cursor: 'pointer', fontSize: '15px', padding: '0 2px' }}>✕</button>
        </div>

        {/* Hauptanweisung */}
        <div style={{
          textAlign: 'center', padding: '12px 10px', borderRadius: '8px', marginBottom: '8px',
          background: `${instrColor}15`, border: `1px solid ${instrColor}40`
        }}>
          <div style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '2px', fontWeight: 600 }}>
            {g.action === 'STEIGEN' ? '▲ STEIGEN' : g.action === 'SINKEN' ? '▼ SINKEN' : '→ HALTEN'}
          </div>
          <div style={{ fontSize: '42px', fontWeight: 800, fontFamily: 'monospace', color: instrColor, lineHeight: 1 }}>
            {g.targetAltFt}
          </div>
          <div style={{ fontSize: '12px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, marginTop: '2px' }}>ft</div>
          {g.recommendedRate > 0 && (
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: rateColor, marginTop: '6px' }}>
              {g.recommendedRate} m/s
              <span style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, marginLeft: '4px' }}>
                ({g.recommendedRateFtMin} ft/min)
              </span>
            </div>
          )}
        </div>

        {/* Fortschrittsbalken */}
        <div style={{ marginBottom: '8px', padding: '0 2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <span style={{ fontSize: '9px', fontWeight: 600, color: `rgba(${o.c},${o.c},${o.c},${o.textSec})` }}>
              Leg {g.currentLegIndex + 1}/{g.totalLegs}: {phaseLabel}
            </span>
            <span style={{ fontSize: '9px', fontFamily: 'monospace', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
              {Math.round(g.legProgress * 100)}%
            </span>
          </div>
          <div style={{
            height: '6px', borderRadius: '3px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.1 : 0.05})`
          }}>
            <div style={{
              height: '100%', borderRadius: '3px',
              width: `${Math.round(g.legProgress * 100)}%`,
              background: phaseColor, transition: 'width 0.5s ease'
            }} />
          </div>
        </div>

        {/* CDI — Course Deviation Indicator */}
        <div style={{
          padding: '6px 8px', borderRadius: '6px', marginBottom: '8px',
          background: `${devColor}10`, border: `1px solid ${devColor}30`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '8px', fontWeight: 600, color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>CDI</span>
            <span style={{ fontSize: '9px', fontWeight: 700, color: devColor }}>
              {g.deviationLevel === 'on-track' ? 'Auf Kurs' :
               g.deviationLevel === 'minor' ? `${g.crossTrackErrorM}m Abweichung` :
               `${g.crossTrackErrorM}m !!`}
            </span>
          </div>
          {/* CDI-Balken */}
          <div style={{
            position: 'relative', height: '12px', borderRadius: '6px',
            background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`
          }}>
            {/* Mittelmarkierung */}
            <div style={{
              position: 'absolute', left: '50%', top: '1px', bottom: '1px', width: '1px',
              background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.1})`
            }} />
            {/* Pilot-Punkt */}
            <div style={{
              position: 'absolute',
              left: `${cdiPercent}%`, top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '10px', height: '10px', borderRadius: '50%',
              background: devColor,
              boxShadow: `0 0 4px ${devColor}80`,
              transition: 'left 0.5s ease'
            }} />
          </div>
        </div>

        {/* Kompakte Info-Zeile */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '5px 8px', borderRadius: '5px', marginBottom: '8px',
          background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
          fontSize: '10px', fontFamily: 'monospace'
        }}>
          <span style={{ color: g.distToGoal < 500 ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.textSec})` }}>
            {g.distToGoal >= 1000 ? `${(g.distToGoal / 1000).toFixed(1)}km` : `${g.distToGoal}m`}
          </span>
          <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
            ~{Math.round(wnvDeclared.strategy.totalTimeSec / 60)}min
          </span>
          <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
            {g.currentDriftBearing}° drift
          </span>
        </div>

        {/* Live-Prognose */}
        <div style={{
          textAlign: 'center', padding: '4px', borderRadius: '5px', marginBottom: '8px',
          background: g.liveDistToGoal < 200 ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.06)',
          fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textSec})`
        }}>
          Live-Prognose: <span style={{
            fontWeight: 700, fontFamily: 'monospace',
            color: g.liveDistToGoal < 200 ? '#22c55e' : g.liveDistToGoal < 500 ? '#f59e0b' : '#ef4444'
          }}>
            {g.liveDistToGoal >= 1000 ? `${(g.liveDistToGoal / 1000).toFixed(1)}km` : `${g.liveDistToGoal}m`}
          </span>
        </div>

        {/* Eingeklappter Flugplan */}
        <button onClick={() => setShowFlugplan(!showFlugplan)} style={{
          width: '100%', padding: '4px', border: 'none', borderRadius: '4px', cursor: 'pointer',
          background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
          color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`,
          fontSize: '9px', fontWeight: 600, marginBottom: showFlugplan ? '4px' : '8px'
        }}>
          {showFlugplan ? '▼' : '▶'} Flugplan ({wnvDeclared.strategy.legs.length} Legs)
        </button>

        {showFlugplan && (
          <div style={{ marginBottom: '8px' }}>
            {wnvDeclared.strategy.legs.map((leg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 6px', marginBottom: '2px', borderRadius: '4px', fontSize: '10px',
                background: i === g.currentLegIndex
                  ? `${instrColor}15`
                  : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.04 : 0.02})`,
                borderLeft: i === g.currentLegIndex ? `3px solid ${instrColor}` : '3px solid transparent'
              }}>
                <span style={{
                  color: leg.action === 'STEIGEN' ? '#22c55e' : leg.action === 'SINKEN' ? '#ef4444' : '#f59e0b',
                  fontWeight: 700, minWidth: '55px'
                }}>
                  {leg.action === 'STEIGEN' ? '▲' : leg.action === 'SINKEN' ? '▼' : '→'} {leg.targetAltitudeFt}ft
                </span>
                {leg.rate > 0 && (
                  <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textSec})`, fontFamily: 'monospace', fontSize: '9px' }}>
                    {leg.rate}m/s
                  </span>
                )}
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
                  {leg.windDirection}° · {leg.windSpeedKmh}km/h
                </span>
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontFamily: 'monospace' }}>
                  {Math.round(leg.durationSec / 60)}m
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recalc-Warnung */}
        {g.shouldRecalc && g.recalcReason && (
          <div style={{
            padding: '6px 8px', borderRadius: '5px', marginBottom: '6px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            fontSize: '9px', color: '#ef4444', textAlign: 'center'
          }}>
            ⚠ {g.recalcReason}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={doRecalculate}
            style={{
              flex: 1, padding: '7px', borderRadius: '5px', border: 'none',
              background: g.shouldRecalc ? '#f59e0b' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`,
              color: g.shouldRecalc ? 'white' : `rgba(${o.c},${o.c},${o.c},${o.textSec})`,
              fontSize: '11px', fontWeight: 700, cursor: 'pointer',
              animation: g.shouldRecalc ? 'wnvPulse 1.5s ease-in-out infinite' : 'none'
            }}>
            Neu berechnen
          </button>
          <button onClick={doUndeclare}
            style={{
              padding: '7px 10px', borderRadius: '5px',
              border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)',
              color: '#ef4444', fontSize: '9px', fontWeight: 600, cursor: 'pointer'
            }}>
            Aufheben
          </button>
        </div>

        {/* Info-Zeile */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, padding: '4px 2px 0', marginTop: '4px' }}>
          <span>{currentAltFt}ft</span>
          <span>Boden: {Math.round(goalElevation! * 3.28084)}ft</span>
          <span>Score: {wnvDeclared.strategy.score}</span>
        </div>

        {/* Pulse Animation */}
        <style>{`
          @keyframes wnvPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
        `}</style>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // Planungsmodus (vor Deklaration)
  // ═══════════════════════════════════════════════════════════════════

  const instrColor = wnvResult?.instructionAction === 'STEIGEN' ? '#22c55e'
    : wnvResult?.instructionAction === 'SINKEN' ? '#ef4444' : '#06b6d4'
  const rateAbs = wnvResult?.recommendedRate || 0
  const rateColor = rateAbs <= 2 ? (o.on ? '#15803d' : '#22c55e') : rateAbs <= 3.5 ? (o.on ? '#b45309' : '#f59e0b') : (o.on ? '#dc2626' : '#ef4444')

  return (
    <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ ...style, minWidth: '250px', maxWidth: '290px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>
            🧭 WNV
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

      {/* Legs + Auto + Berechnen */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {([1, 2, 3] as const).map(n => (
            <button key={n} onClick={() => updateWnvConfig({ maxLegs: n })}
              style={{
                padding: '5px 10px', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                background: wnvConfig.maxLegs === n ? '#f59e0b' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.04})`,
                color: wnvConfig.maxLegs === n ? 'white' : `rgba(${o.c},${o.c},${o.c},${o.textMuted})`
              }}>
              {n}L
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input type="checkbox" checked={wnvConfig.autoRecalc} onChange={e => updateWnvConfig({ autoRecalc: e.target.checked })}
            style={{ accentColor: '#f59e0b', cursor: 'pointer' }} />
          <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textSec})` }}>Auto</span>
        </label>
        <button onClick={doCalculate} disabled={!canCalculate}
          style={{
            flex: 1, padding: '6px', borderRadius: '5px', border: 'none',
            background: canCalculate ? '#f59e0b' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
            color: canCalculate ? 'white' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.3 : 0.2})`,
            fontSize: '11px', fontWeight: 700, cursor: canCalculate ? 'pointer' : 'not-allowed'
          }}>
          Berechnen
        </button>
        {wnvResult && !wnvDeclared && (
          <button onClick={() => { setWnvResult(null) }}
            style={{ padding: '6px 8px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '9px', fontWeight: 600, cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </div>

      {!canCalculate && (
        <div style={{ fontSize: '9px', color: '#f59e0b', textAlign: 'center', marginBottom: '6px' }}>
          {!gpsData ? 'Kein GPS' : !selectedGoal ? 'Kein Ziel ausgewählt' : filteredWindLayers.length < 2 ? 'Mind. 2 Windschichten' : 'Lade Geländehöhe...'}
        </div>
      )}

      {/* Ergebnis-Vorschau */}
      {wnvResult && (
        <>
          {/* Hauptanweisung */}
          <div style={{
            textAlign: 'center', padding: '10px', borderRadius: '8px', marginBottom: '8px',
            background: `${instrColor}15`, border: `1px solid ${instrColor}40`
          }}>
            <div style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '4px' }}>
              {wnvResult.instructionAction === 'STEIGEN' ? '▲' : wnvResult.instructionAction === 'SINKEN' ? '▼' : '→'} NÄCHSTER SCHRITT
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'monospace', color: instrColor }}>
              {wnvResult.instructionAltFt} <span style={{ fontSize: '14px', fontWeight: 400 }}>ft</span>
            </div>
            {wnvResult.recommendedRate > 0 && (
              <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: rateColor, marginTop: '4px' }}>
                {wnvResult.recommendedRate} m/s
                <span style={{ fontSize: '10px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, marginLeft: '4px' }}>
                  ({wnvResult.recommendedRateFtMin} ft/min)
                </span>
              </div>
            )}
          </div>

          {/* Distanz + Score */}
          <div style={{
            display: 'flex', gap: '6px', marginBottom: '8px'
          }}>
            <div style={{
              flex: 1, textAlign: 'center', padding: '6px', borderRadius: '6px',
              background: wnvResult.distanceToGoal < 100 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${wnvResult.distanceToGoal < 100 ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.2)'}`
            }}>
              <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, display: 'block' }}>DISTANZ</span>
              <span style={{
                fontSize: '14px', fontWeight: 800, fontFamily: 'monospace',
                color: wnvResult.distanceToGoal < 100 ? '#22c55e' : wnvResult.distanceToGoal < 500 ? '#f59e0b' : '#ef4444'
              }}>
                {wnvResult.distanceToGoal >= 1000 ? `${(wnvResult.distanceToGoal / 1000).toFixed(1)}km` : `${wnvResult.distanceToGoal}m`}
              </span>
            </div>
            <div style={{
              textAlign: 'center', padding: '6px', borderRadius: '6px', minWidth: '60px',
              background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.03})`,
              border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.1 : 0.05})`
            }}>
              <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, display: 'block' }}>SENS</span>
              <span style={{
                fontSize: '14px', fontWeight: 800, fontFamily: 'monospace',
                color: wnvResult.sensitivity < 100 ? '#22c55e' : wnvResult.sensitivity < 300 ? '#f59e0b' : '#ef4444'
              }}>
                ±{wnvResult.sensitivity}m
              </span>
            </div>
          </div>

          {/* Flugplan */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, marginBottom: '3px', fontWeight: 600 }}>FLUGPLAN</div>
            {wnvResult.legs.map((leg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 6px', marginBottom: '2px', borderRadius: '4px', fontSize: '10px',
                background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.06 : 0.02})`
              }}>
                <span style={{
                  color: leg.action === 'STEIGEN' ? '#22c55e' : leg.action === 'SINKEN' ? '#ef4444' : '#f59e0b',
                  fontWeight: 700, minWidth: '55px'
                }}>
                  {leg.action === 'STEIGEN' ? '▲' : leg.action === 'SINKEN' ? '▼' : '→'} {leg.targetAltitudeFt}ft
                </span>
                {leg.rate > 0 && (
                  <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textSec})`, fontFamily: 'monospace', fontSize: '9px' }}>
                    {leg.rate}m/s
                  </span>
                )}
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})` }}>
                  {leg.windDirection}° · {leg.windSpeedKmh}km/h
                </span>
                <span style={{ color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontFamily: 'monospace' }}>
                  {Math.round(leg.durationSec / 60)}m
                </span>
              </div>
            ))}
          </div>

          {/* Deklarieren Button */}
          <button onClick={doDeclare}
            style={{
              width: '100%', padding: '10px', borderRadius: '6px', border: 'none',
              background: '#f59e0b', color: 'white',
              fontSize: '13px', fontWeight: 800, cursor: 'pointer',
              marginBottom: '6px'
            }}>
            ✓ DEKLARIEREN
          </button>

          {/* Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})`, padding: '0 2px' }}>
            <span>{currentAltFt}ft</span>
            <span>Boden: {Math.round(goalElevation! * 3.28084)}ft</span>
            <span>~{Math.round(wnvResult.totalTimeSec / 60)}min</span>
          </div>
        </>
      )}
    </div>
  )
}
