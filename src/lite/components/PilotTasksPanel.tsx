import React, { useState } from 'react'
import { useTrackerStore, type PilotTask } from '../stores/trackerStore'
import { GroundWindDialog } from './GroundWindDialog'

// WGS84 zu UTM Konvertierung
function latLngToUTM(lat: number, lng: number): { zone: number; easting: number; northing: number; letter: string } {
  const zone = Math.floor((lng + 180) / 6) + 1
  const letter = lat >= 0 ? 'N' : 'S'

  // UTM Berechnung
  const a = 6378137 // WGS84 semi-major axis
  const f = 1 / 298.257223563 // WGS84 flattening
  const k0 = 0.9996 // UTM scale factor

  const e = Math.sqrt(2 * f - f * f)
  const e2 = e * e / (1 - e * e)

  const latRad = lat * Math.PI / 180
  const lngRad = lng * Math.PI / 180
  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180

  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad))
  const T = Math.tan(latRad) * Math.tan(latRad)
  const C = e2 * Math.cos(latRad) * Math.cos(latRad)
  const A = Math.cos(latRad) * (lngRad - lng0)

  const M = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64) * latRad
    - (3 * e * e / 8 + 3 * e * e * e * e / 32) * Math.sin(2 * latRad)
    + (15 * e * e * e * e / 256) * Math.sin(4 * latRad))

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2) * A * A * A * A * A / 120) + 500000

  let northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e2) * A * A * A * A * A * A / 720))

  if (lat < 0) {
    northing += 10000000
  }

  return { zone, easting: Math.round(easting), northing: Math.round(northing), letter }
}

// WGS84 formatieren
function formatWGS84(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`
}

// UTM formatieren
function formatUTM(lat: number, lng: number): string {
  const utm = latLngToUTM(lat, lng)
  return `${utm.zone}${utm.letter} ${utm.easting} ${utm.northing}`
}

// Google Maps Navigation öffnen
function openGoogleMapsNavigation(lat: number, lng: number, label?: string) {
  // Google Maps URL für Navigation (funktioniert auf Mobile und Desktop)
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
  window.open(url, '_blank')
}

interface PilotTasksPanelProps {
  onClose: () => void
}

export function PilotTasksPanel({ onClose }: PilotTasksPanelProps) {
  const { pilots, selectedPilot, pilotTasks, loadingTasks } = useTrackerStore()
  const [windDialogTask, setWindDialogTask] = useState<PilotTask | null>(null)

  const pilot = pilots.find(p => p.memberId === selectedPilot)

  if (!pilot) {
    return null
  }

  // Prüfen ob Pilot eine gültige Position hat (nach dem null-check)
  // pilot hat latitude/longitude direkt, nicht in einem position-Objekt
  const hasPilotPosition = pilot.latitude && pilot.longitude &&
    (pilot.latitude !== 0 || pilot.longitude !== 0)

  return (
    <>
    {windDialogTask && (
      <GroundWindDialog
        task={windDialogTask}
        onClose={() => setWindDialogTask(null)}
      />
    )}
    <div style={{
      position: 'absolute',
      bottom: 10,
      left: 10,
      right: 10,
      maxHeight: '45vh',
      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 12,
      overflow: 'hidden',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28,
            height: 28,
            background: pilot.color,
            borderRadius: '50%',
            border: '2px solid #fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>
              {pilot.callsign.substring(0, 2)}
            </span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
              {pilot.callsign}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
              {pilotTasks.length} Tasks
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Navigate to Pilot Button */}
          {hasPilotPosition && (
            <button
              onClick={() => openGoogleMapsNavigation(pilot.latitude, pilot.longitude)}
              title="Zum Piloten navigieren"
              style={{
                width: 28,
                height: 28,
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 6,
                color: '#22c55e',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {loadingTasks ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 12
          }}>
            <div style={{
              width: 18,
              height: 18,
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginRight: 10
            }} />
            Lade...
          </div>
        ) : pilotTasks.length === 0 ? (
          <div style={{
            padding: 20,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 12
          }}>
            {!pilot.userId ? 'Nicht verknüpft' : 'Keine Tasks'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pilotTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                pilotColor={pilot.color}
                onReportWind={() => setWindDialogTask(task)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}

interface TaskCardProps {
  task: PilotTask
  pilotColor: string
  onReportWind: () => void
}

function TaskCard({ task, pilotColor, onReportWind }: TaskCardProps) {
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8,
      padding: 8,
      borderLeft: `3px solid ${pilotColor}`
    }}>
      {/* Task Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: task.goals.length > 0 ? 6 : 0
      }}>
        <span style={{
          background: task.isActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.1)',
          color: task.isActive ? '#22c55e' : 'rgba(255,255,255,0.5)',
          fontSize: 9,
          fontWeight: 600,
          padding: '2px 5px',
          borderRadius: 3,
          textTransform: 'uppercase'
        }}>
          {task.type}
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#fff',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {task.name}
        </span>
        {/* Wind Report Button */}
        <button
          onClick={onReportWind}
          title="Bodenwind melden"
          style={{
            width: 26,
            height: 26,
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 5,
            color: '#3b82f6',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
          </svg>
        </button>
      </div>

      {/* Goals - kompakt */}
      {task.goals.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          paddingTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.05)'
        }}>
          {task.goals.map((goal, idx) => {
            const isExpanded = expandedGoal === goal.id
            const hasPosition = goal.position?.latitude && goal.position?.longitude

            return (
              <div key={goal.id} style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.6)',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 5,
                padding: '5px 6px'
              }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: hasPosition ? 'pointer' : 'default' }}
                  onClick={() => hasPosition && setExpandedGoal(isExpanded ? null : goal.id)}
                >
                  {hasPosition && (
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', width: 8, textAlign: 'center' }}>
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                  )}
                  <span style={{ flex: 1, fontWeight: 600, color: '#fff', fontSize: 11 }}>{goal.name || `Goal ${idx + 1}`}</span>
                  <span style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', fontSize: 9 }}>
                    {goal.radius}m
                  </span>
                  {/* Navigate to Goal Button */}
                  {hasPosition && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openGoogleMapsNavigation(goal.position.latitude, goal.position.longitude)
                      }}
                      title="Zum Goal navigieren"
                      style={{
                        width: 22,
                        height: 22,
                        background: 'rgba(34, 197, 94, 0.15)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        borderRadius: 4,
                        color: '#22c55e',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="3 11 22 2 13 21 11 13 3 11" />
                      </svg>
                    </button>
                  )}
                </div>
                {/* Koordinaten - nur sichtbar wenn aufgeklappt */}
                {isExpanded && hasPosition && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    fontFamily: 'monospace',
                    fontSize: 9,
                    marginTop: 4,
                    paddingTop: 4,
                    borderTop: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)' }}>
                      WGS84: {formatWGS84(goal.position.latitude, goal.position.longitude)}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.5)' }}>
                      UTM: {formatUTM(goal.position.latitude, goal.position.longitude)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
