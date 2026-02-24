import React, { useState, useEffect, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { usePanelDrag } from '../hooks/usePanelDrag'

interface GasPanelProps {
  isOpen: boolean
  onClose: () => void
}

// SVG Konstanten
const W = 220
const H = 220
const CX = W / 2
const BASKET_Y = 170  // Oberkante Korb
const BASKET_H = 40   // Korbhöhe
const BASKET_W = 160   // Korbbreite
const BOTTLE_W = 28    // Flaschenbreite
const BOTTLE_H = 80    // Flaschenhöhe
const BOTTLE_GAP = 8   // Abstand zwischen Flaschen

export function GasPanel({ isOpen, onClose }: GasPanelProps) {
  const settings = useFlightStore(s => s.settings)
  const gasBottleState = useFlightStore(s => s.gasBottleState)
  const activateGasBottle = useFlightStore(s => s.activateGasBottle)
  const deactivateGasBottle = useFlightStore(s => s.deactivateGasBottle)
  const resetGasTracker = useFlightStore(s => s.resetGasTracker)
  const o = getOutdoor(settings.outdoorMode)

  const bottles = settings.gasBottles || []
  const reserveMin = settings.gasReserveMinutes ?? 10

  // Position State für Drag
  const [position, setPosition] = useState({ x: 16, y: window.innerHeight - 380 })
  const [hoveredBottle, setHoveredBottle] = useState<string | null>(null)

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

  // Force-Update jede Sekunde für Live-Anzeige
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isOpen) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  // Verbrauchte Liter für eine Flasche berechnen
  const getUsedLiters = (bottleId: string): number => {
    let total = 0
    for (const record of gasBottleState.usedBottles) {
      if (record.bottleId === bottleId) {
        total += record.litersUsed
      }
    }
    if (gasBottleState.activeBottleId === bottleId && gasBottleState.activeSince) {
      const bottle = bottles.find(b => b.id === bottleId)
      if (bottle) {
        const elapsedMs = Date.now() - new Date(gasBottleState.activeSince).getTime()
        const elapsedHours = elapsedMs / (1000 * 60 * 60)
        total += bottle.consumptionPerHour * elapsedHours
      }
    }
    return total
  }

  const getRemainingLiters = (bottleId: string): number => {
    const bottle = bottles.find(b => b.id === bottleId)
    if (!bottle) return 0
    return Math.max(0, bottle.totalLiters - getUsedLiters(bottleId))
  }

  const getRemainingMinutes = (bottleId: string): number => {
    const bottle = bottles.find(b => b.id === bottleId)
    if (!bottle || bottle.consumptionPerHour <= 0) return 0
    const remaining = getRemainingLiters(bottleId)
    const totalMinutes = (remaining / bottle.consumptionPerHour) * 60
    return totalMinutes - reserveMin
  }

  const getPercentage = (bottleId: string): number => {
    const bottle = bottles.find(b => b.id === bottleId)
    if (!bottle || bottle.totalLiters <= 0) return 0
    return Math.max(0, Math.min(100, (getRemainingLiters(bottleId) / bottle.totalLiters) * 100))
  }

  // Farbe je nach Füllstand
  const getBottleColor = (bottleId: string): string => {
    const mins = getRemainingMinutes(bottleId)
    const isActive = gasBottleState.activeBottleId === bottleId
    if (mins <= 0) return '#ef4444'       // Rot: leer/Reserve aufgebraucht
    if (mins <= reserveMin) return '#f59e0b' // Orange: unter Reserve
    if (isActive) return '#22c55e'         // Grün: aktiv
    return '#3b82f6'                       // Blau: voll, inaktiv
  }

  // Aktive Laufzeit formatieren
  const getActiveTime = (): string => {
    if (!gasBottleState.activeSince) return '--:--'
    const elapsedMs = Date.now() - new Date(gasBottleState.activeSince).getTime()
    const min = Math.floor(elapsedMs / 60000)
    const sec = Math.floor((elapsedMs % 60000) / 1000)
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  if (!isOpen) return null

  // Positionen der Flaschen im Korb berechnen (max 4, zentriert)
  const visibleBottles = bottles.slice(0, 4)
  const totalBottleW = visibleBottles.length * BOTTLE_W + (visibleBottles.length - 1) * BOTTLE_GAP
  const bottleStartX = CX - totalBottleW / 2

  return (
    <div
      className="gas-panel"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        background: 'rgba(10, 15, 30, 0.92)',
        borderRadius: '12px',
        padding: '8px',
        border: `1px solid rgba(255,255,255,${o.borderStrong})`,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: 10000,
        transform: `scale(${settings.gasPanelScale ?? 1})`,
        transformOrigin: 'bottom left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '4px',
        padding: '0 2px'
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: `rgba(255,255,255,${o.textSec})`, letterSpacing: '0.5px' }}>
          GAS-TRACKER
          {gasBottleState.activeSince && (
            <span style={{ marginLeft: '8px', color: '#22c55e', fontSize: '10px' }}>{getActiveTime()}</span>
          )}
        </span>
        <button
          className="no-drag"
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: `rgba(255,255,255,${o.textMuted})`,
            cursor: 'pointer', fontSize: '16px', padding: '2px 6px', lineHeight: 1
          }}
        >✕</button>
      </div>

      {bottles.length === 0 ? (
        <div style={{ width: W, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '11px', color: `rgba(255,255,255,${o.textMuted})`, textAlign: 'center' }}>
            Keine Flaschen konfiguriert<br />
            <span style={{ fontSize: '10px' }}>Einstellungen → Gas</span>
          </span>
        </div>
      ) : (
        <>
          {/* SVG Korb + Flaschen */}
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            {/* Hintergrund-Kreis wie Windrose */}
            <circle cx={CX} cy={H / 2 - 5} r={100} fill="rgba(0,0,0,0.3)" stroke={`rgba(255,255,255,${o.on ? 0.15 : 0.08})`} strokeWidth="0.5" />

            {/* Seile vom Ballon zum Korb */}
            <line x1={CX - BASKET_W / 2 + 10} y1={BASKET_Y} x2={CX - 30} y2={8} stroke={`rgba(255,255,255,${o.on ? 0.25 : 0.12})`} strokeWidth="1" />
            <line x1={CX + BASKET_W / 2 - 10} y1={BASKET_Y} x2={CX + 30} y2={8} stroke={`rgba(255,255,255,${o.on ? 0.25 : 0.12})`} strokeWidth="1" />

            {/* Ballon-Hülle (oben, angedeutet) */}
            <ellipse cx={CX} cy={18} rx={35} ry={16} fill="none" stroke={`rgba(255,255,255,${o.on ? 0.2 : 0.1})`} strokeWidth="1" strokeDasharray="4,3" />

            {/* Gasflaschen im Korb */}
            {visibleBottles.map((bottle, i) => {
              const bx = bottleStartX + i * (BOTTLE_W + BOTTLE_GAP)
              const by = BASKET_Y - BOTTLE_H + 5  // Flaschen ragen oben aus dem Korb
              const pct = getPercentage(bottle.id)
              const color = getBottleColor(bottle.id)
              const isActive = gasBottleState.activeBottleId === bottle.id
              const isHovered = hoveredBottle === bottle.id
              const fillH = (pct / 100) * (BOTTLE_H - 12) // Füllstand-Höhe (abzgl. Flaschenhals)
              const remaining = getRemainingLiters(bottle.id)
              const mins = getRemainingMinutes(bottle.id)

              return (
                <g
                  key={bottle.id}
                  className="no-drag"
                  onMouseEnter={() => setHoveredBottle(bottle.id)}
                  onMouseLeave={() => setHoveredBottle(null)}
                  onClick={() => {
                    if (isActive) deactivateGasBottle()
                    else activateGasBottle(bottle.id)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Aktiv-Glow */}
                  {isActive && (
                    <rect x={bx - 3} y={by - 3} width={BOTTLE_W + 6} height={BOTTLE_H + 6}
                      rx={6} fill="none" stroke={color} strokeWidth="1.5" opacity="0.4">
                      <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />
                    </rect>
                  )}

                  {/* Flaschen-Körper (Umriss) */}
                  <rect x={bx} y={by + 8} width={BOTTLE_W} height={BOTTLE_H - 8}
                    rx={4} fill="rgba(0,0,0,0.4)"
                    stroke={isHovered ? 'rgba(255,255,255,0.5)' : `rgba(255,255,255,${o.on ? 0.25 : 0.15})`}
                    strokeWidth={isHovered ? 1.5 : 1} />

                  {/* Flaschenhals */}
                  <rect x={bx + BOTTLE_W / 2 - 5} y={by} width={10} height={12}
                    rx={3} fill="rgba(0,0,0,0.4)"
                    stroke={isHovered ? 'rgba(255,255,255,0.5)' : `rgba(255,255,255,${o.on ? 0.25 : 0.15})`}
                    strokeWidth={isHovered ? 1.5 : 1} />

                  {/* Füllstand (von unten) */}
                  {fillH > 0 && (
                    <rect
                      x={bx + 1.5} y={by + 8 + (BOTTLE_H - 8) - fillH - 1}
                      width={BOTTLE_W - 3} height={fillH}
                      rx={3} fill={color} opacity={isActive ? 0.7 : 0.5}
                    />
                  )}

                  {/* Flaschen-Nummer */}
                  <text x={bx + BOTTLE_W / 2} y={by + BOTTLE_H / 2 + 8}
                    textAnchor="middle" fill="white" fontSize="11" fontWeight="700"
                    fontFamily="monospace" opacity={0.9}>
                    {i + 1}
                  </text>

                  {/* Prozent unter Flasche */}
                  <text x={bx + BOTTLE_W / 2} y={by + BOTTLE_H + 14}
                    textAnchor="middle" fill={color} fontSize="9" fontWeight="700"
                    fontFamily="monospace">
                    {Math.round(pct)}%
                  </text>

                  {/* AKTIV Badge */}
                  {isActive && (
                    <text x={bx + BOTTLE_W / 2} y={by - 6}
                      textAnchor="middle" fill="#22c55e" fontSize="8" fontWeight="700"
                      fontFamily="monospace">
                      AKTIV
                    </text>
                  )}

                  {/* Hover-Hit-Area (größer für Touch) */}
                  <rect x={bx - 4} y={by - 8} width={BOTTLE_W + 8} height={BOTTLE_H + 24}
                    fill="transparent" />

                  {/* Hover-Tooltip */}
                  {isHovered && (
                    <g>
                      <rect x={bx - 10} y={by - 28} width={BOTTLE_W + 20} height={18}
                        rx={4} fill="rgba(0,0,0,0.95)" stroke={color} strokeWidth="0.5" />
                      <text x={bx + BOTTLE_W / 2} y={by - 16}
                        textAnchor="middle" fill="white" fontSize="9" fontWeight="600"
                        fontFamily="monospace">
                        {remaining.toFixed(1)}L {mins > 0 ? `${Math.floor(mins)}m` : '0m'}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* Korb – Trapezform (oben breiter, unten schmaler) */}
            {(() => {
              const bLeft = CX - BASKET_W / 2
              const bRight = CX + BASKET_W / 2
              const bTop = BASKET_Y
              const bBot = BASKET_Y + BASKET_H
              const taper = 12 // Verjüngung pro Seite
              const rimH = 5  // Rand oben
              const basketColor = o.on ? 'rgba(160,120,60,' : 'rgba(120,90,40,'

              // Korbpunkte (Trapez)
              const topLeft = `${bLeft},${bTop + rimH}`
              const topRight = `${bRight},${bTop + rimH}`
              const botLeft = `${bLeft + taper},${bBot}`
              const botRight = `${bRight - taper},${bBot}`

              // Flechtmuster: horizontale Reihen
              const hRows = 5
              const vCols = 9

              return (
                <g>
                  {/* Korb-Füllung (leicht sichtbar) */}
                  <polygon
                    points={`${topLeft} ${topRight} ${botRight} ${botLeft}`}
                    fill={`${basketColor}0.08)`}
                  />

                  {/* Flechtmuster – horizontale Linien */}
                  {Array.from({ length: hRows }, (_, r) => {
                    const t = (r + 1) / (hRows + 1)
                    const y = bTop + rimH + (BASKET_H - rimH) * t
                    const xShrink = taper * t // Wie weit die Seite nach innen gerückt ist
                    return (
                      <line key={`h${r}`}
                        x1={bLeft + xShrink + 2} y1={y}
                        x2={bRight - xShrink - 2} y2={y}
                        stroke={`${basketColor}0.25)`} strokeWidth="0.7" />
                    )
                  })}

                  {/* Flechtmuster – vertikale/diagonale Streben */}
                  {Array.from({ length: vCols }, (_, c) => {
                    const t = (c + 1) / (vCols + 1)
                    const xTop = bLeft + (bRight - bLeft) * t
                    const xBot = (bLeft + taper) + ((bRight - taper) - (bLeft + taper)) * t
                    return (
                      <line key={`v${c}`}
                        x1={xTop} y1={bTop + rimH + 2}
                        x2={xBot} y2={bBot - 2}
                        stroke={`${basketColor}0.2)`} strokeWidth="0.6" />
                    )
                  })}

                  {/* Korb-Umriss (Trapez) */}
                  <polygon
                    points={`${topLeft} ${topRight} ${botRight} ${botLeft}`}
                    fill="none"
                    stroke={`${basketColor}0.6)`} strokeWidth="1.5"
                    strokeLinejoin="round"
                  />

                  {/* Korbrand oben (dicker, leicht überstehend) */}
                  <line
                    x1={bLeft - 3} y1={bTop + rimH}
                    x2={bRight + 3} y2={bTop + rimH}
                    stroke={`${basketColor}0.7)`} strokeWidth="2.5"
                    strokeLinecap="round"
                  />

                  {/* Boden-Linie (verstärkt) */}
                  <line
                    x1={bLeft + taper + 2} y1={bBot}
                    x2={bRight - taper - 2} y2={bBot}
                    stroke={`${basketColor}0.5)`} strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </g>
              )
            })()}
          </svg>

          {/* Leiste unter SVG: Gesamtstatus */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '2px 4px 0'
          }}>
            {/* Gesamt Restliter */}
            <span style={{ fontSize: '10px', color: `rgba(255,255,255,${o.text})`, fontFamily: 'monospace' }}>
              {bottles.reduce((sum, b) => sum + getRemainingLiters(b.id), 0).toFixed(0)}L gesamt
            </span>

            {/* Reset Button */}
            <button
              className="no-drag"
              onClick={resetGasTracker}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '9px', color: `rgba(255,255,255,${o.textMuted})`,
                padding: '2px 6px', textDecoration: 'underline'
              }}
            >Reset</button>
          </div>
        </>
      )}
    </div>
  )
}
