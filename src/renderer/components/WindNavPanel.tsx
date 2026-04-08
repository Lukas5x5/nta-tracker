/**
 * Wind Navigation Panel (WNV) — Beta
 * Berechnet live die optimale Flugstrategie um ein Ziel am Boden zu erreichen.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { calculateWindNav, WnvResult } from '../utils/windNavigation'
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
  const o = getOutdoor(settings.outdoorMode)

  const [windFilter, setWindFilter] = useState<WindSourceFilter>('all')
  const [goalElevation, setGoalElevation] = useState<number | null>(null)

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

  // Live-Update bei GPS-Änderung (alle 3 Sekunden throttled)
  const lastCalcRef = useRef(0)
  useEffect(() => {
    if (!wnvConfig.autoRecalc || !canCalculate) return
    if (Date.now() - lastCalcRef.current < 3000) return
    lastCalcRef.current = Date.now()
    doCalculate()
  }, [wnvConfig.autoRecalc, canCalculate, gpsData?.latitude, gpsData?.longitude, currentAlt, doCalculate])

  const currentAltFt = Math.round(currentAlt * 3.28084 / 50) * 50

  // Farbe für Anweisung
  const instrColor = wnvResult?.instructionAction === 'STEIGEN' ? '#22c55e'
    : wnvResult?.instructionAction === 'SINKEN' ? '#ef4444' : '#06b6d4'

  // Farbe für Rate
  const rateAbs = wnvResult?.recommendedRate || 0
  const rateColor = rateAbs <= 2 ? (o.on ? '#15803d' : '#22c55e') : rateAbs <= 3.5 ? (o.on ? '#b45309' : '#f59e0b') : (o.on ? '#dc2626' : '#ef4444')

  return (
    <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ ...style, minWidth: '250px', maxWidth: '290px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>
            🧭 WNV <span style={{ fontSize: '8px', color: `rgba(${o.c},${o.c},${o.c},${o.textDim})`, fontWeight: 400 }}>BETA</span>
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
          {([1, 2] as const).map(n => (
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
        {wnvResult && (
          <button onClick={() => setWnvResult(null)}
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

      {/* Ergebnis */}
      {wnvResult && (
        <>
          {/* Hauptanweisung + Rate */}
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

          {/* Distanz */}
          <div style={{
            textAlign: 'center', padding: '6px', borderRadius: '6px', marginBottom: '8px',
            background: wnvResult.distanceToGoal < 100 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${wnvResult.distanceToGoal < 100 ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.2)'}`
          }}>
            <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.textMuted})` }}>DISTANZ </span>
            <span style={{
              fontSize: '16px', fontWeight: 800, fontFamily: 'monospace',
              color: wnvResult.distanceToGoal < 100 ? '#22c55e' : wnvResult.distanceToGoal < 500 ? '#f59e0b' : '#ef4444'
            }}>
              {wnvResult.distanceToGoal >= 1000 ? `${(wnvResult.distanceToGoal / 1000).toFixed(1)} km` : `${wnvResult.distanceToGoal} m`}
            </span>
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
