import { useFlightStore } from '../stores/flightStore'
import { formatCoordinate } from '../utils/coordinatesWGS84'

/**
 * Berechnet Distanz zwischen zwei Punkten (Haversine)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Erdradius in Metern
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Berechnet Bearing (Richtung) zwischen zwei Punkten
 */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180

  const x = Math.sin(dLon) * Math.cos(lat2Rad)
  const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  let bearing = Math.atan2(x, y) * 180 / Math.PI
  bearing = (bearing + 360) % 360

  return bearing
}

/**
 * Berechnet benötigte Drift-Richtung (relative zum aktuellen Heading)
 */
function calculateDrift(currentHeading: number, targetBearing: number): number {
  let drift = targetBearing - currentHeading
  if (drift > 180) drift -= 360
  if (drift < -180) drift += 360
  return drift
}

/**
 * Formatiert Distanz
 */
function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${Math.round(meters)} m`
}

interface TaskListPanelProps {
  isOpen: boolean
  onClose: () => void
  onNavigateTo: (taskId: string) => void
}

export function TaskListPanel({ isOpen, onClose, onNavigateTo }: TaskListPanelProps) {
  const {
    tasks,
    activeTask,
    selectedGoal,
    gpsData,
    setActiveTask,
    setSelectedGoal,
    settings
  } = useFlightStore()

  if (!isOpen) return null

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: '380px',
      height: '100%',
      background: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.3)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)'
      }}>
        <span style={{ fontWeight: 600, flex: 1, fontSize: '16px' }}>Tasks für Fahrt</span>
        <button className="btn btn-icon btn-secondary" onClick={onClose} style={{ padding: '6px' }}>
          ✕
        </button>
      </div>

      {/* Task List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {tasks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            padding: '40px 20px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <div>Keine Tasks erstellt</div>
            <div style={{ fontSize: '13px', marginTop: '8px' }}>
              Öffne das Briefing-Menü, um Tasks zu erstellen
            </div>
          </div>
        ) : (
          tasks.map((task, index) => {
            const goal = task.goals[0]
            if (!goal) return null

            const isActive = activeTask?.id === task.id
            const isSelected = selectedGoal?.id === goal.id

            // Berechne Distanz und Richtung zum Goal
            let distance: number | null = null
            let bearing: number | null = null
            let drift: number | null = null

            if (gpsData) {
              distance = calculateDistance(
                gpsData.latitude, gpsData.longitude,
                goal.position.latitude, goal.position.longitude
              )
              bearing = calculateBearing(
                gpsData.latitude, gpsData.longitude,
                goal.position.latitude, goal.position.longitude
              )
              drift = calculateDrift(gpsData.heading, bearing)
            }

            return (
              <div
                key={task.id}
                style={{
                  background: isActive ? 'rgba(26, 115, 232, 0.15)' : 'var(--bg-card)',
                  border: isActive ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  overflow: 'hidden'
                }}
              >
                {/* Task Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px',
                  borderBottom: '1px solid var(--border-color)',
                  gap: '12px'
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: isActive ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                    color: isActive ? 'white' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '14px'
                  }}>
                    T{index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{task.name || `Task ${index + 1}`}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {task.type} • {goal.name}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{
                      background: 'var(--color-secondary)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600
                    }}>
                      AKTIV
                    </div>
                  )}
                </div>

                {/* Navigation Info */}
                {gpsData && distance !== null && bearing !== null && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '1px',
                    background: 'var(--border-color)'
                  }}>
                    {/* Distanz */}
                    <div style={{
                      background: 'var(--bg-card)',
                      padding: '12px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        Distanz
                      </div>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: distance < 1000 ? 'var(--color-secondary)' : 'var(--text-primary)'
                      }}>
                        {formatDistance(distance)}
                      </div>
                    </div>

                    {/* Richtung */}
                    <div style={{
                      background: 'var(--bg-card)',
                      padding: '12px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        Richtung
                      </div>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}>
                        <span style={{
                          display: 'inline-block',
                          transform: `rotate(${bearing}deg)`,
                          fontSize: '16px'
                        }}>↑</span>
                        {bearing.toFixed(0)}°
                      </div>
                    </div>

                    {/* Drift */}
                    <div style={{
                      background: 'var(--bg-card)',
                      padding: '12px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        Drift
                      </div>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: Math.abs(drift!) < 30 ? 'var(--color-secondary)' :
                               Math.abs(drift!) < 90 ? 'var(--color-warning)' : 'var(--color-danger)'
                      }}>
                        {drift! > 0 ? '+' : ''}{drift!.toFixed(0)}°
                        <span style={{ fontSize: '12px', marginLeft: '4px' }}>
                          {drift! > 0 ? 'R' : 'L'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Goal Details */}
                <div style={{
                  padding: '12px',
                  fontSize: '13px'
                }}>
                  {/* Koordinaten */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '8px'
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>Koordinaten:</span>
                    <span style={{ fontFamily: 'monospace' }}>
                      {formatCoordinate(
                        goal.position.latitude,
                        goal.position.longitude,
                        settings.coordinateFormat
                      )}
                    </span>
                  </div>

                  {/* Radius */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '8px'
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>Goal Radius:</span>
                    <span>{goal.radius} m</span>
                  </div>

                  {/* MMA */}
                  {task.mmaRadius && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px'
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>MMA:</span>
                      <span>{task.mmaRadius} m</span>
                    </div>
                  )}

                  {/* Höhe */}
                  {(task.minAltitude || task.maxAltitude) && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px'
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>Höhe:</span>
                      <span>
                        {task.minAltitude ? `${task.minAltitude}m` : '—'} bis {task.maxAltitude ? `${task.maxAltitude}m` : '—'}
                      </span>
                    </div>
                  )}

                  {/* Task Rings */}
                  {(task.minDistance || task.maxDistance) && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>Rings:</span>
                      <span>
                        {task.minDistance ? `${(task.minDistance / 1000).toFixed(1)}km` : '—'} - {task.maxDistance ? `${(task.maxDistance / 1000).toFixed(1)}km` : '—'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Action Button */}
                <div style={{ padding: '0 12px 12px' }}>
                  <button
                    className={isActive ? 'btn btn-secondary' : 'btn btn-primary'}
                    style={{ width: '100%', padding: '12px' }}
                    onClick={() => {
                      if (isActive) {
                        // Deaktivieren
                        setActiveTask(null)
                        setSelectedGoal(null)
                      } else {
                        // Aktivieren und navigieren
                        setActiveTask(task)
                        setSelectedGoal(goal)
                        onNavigateTo(task.id)
                      }
                    }}
                  >
                    {isActive ? (
                      <>✕ Navigation beenden</>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '8px' }}>
                          <path d="M8 0l6 14-6-4-6 4z"/>
                        </svg>
                        Navigiere zu
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer mit aktuellem Status */}
      {gpsData && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          gap: '16px',
          fontSize: '12px'
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Heading: </span>
            <span style={{ fontWeight: 600 }}>{gpsData.heading.toFixed(0)}°</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Speed: </span>
            <span style={{ fontWeight: 600 }}>{gpsData.speed.toFixed(1)} km/h</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Alt: </span>
            <span style={{ fontWeight: 600 }}>{gpsData.altitude.toFixed(0)} m</span>
          </div>
        </div>
      )}
    </div>
  )
}
