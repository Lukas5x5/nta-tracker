import React from 'react'
import { useFlightStore } from '../stores/flightStore'
import { Task } from '../../shared/types'
import { calculateDistance } from '../utils/navigation'
import { formatDistance } from '../utils/formatting'
import { formatCoordinate } from '../utils/coordinatesWGS84'

export function TaskPanel() {
  const {
    activeTask,
    tasks,
    gpsData,
    settings,
    setSelectedGoal,
    setActiveTask,
    removeTask
  } = useFlightStore()

  // Navigiere zu einem Task
  const handleNavigateTo = (task: Task) => {
    const goal = task.goals[0]
    if (goal) {
      setActiveTask(task)
      setSelectedGoal(goal)
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      height: '100%',
      padding: '8px'
    }}>
      {/* Header */}
      <div style={{
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: '4px'
      }}>
        TASKS ({tasks.length})
      </div>

      {/* Tasks Liste */}
      {tasks.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '24px 12px',
          color: 'var(--text-muted)',
          fontSize: '13px'
        }}>
          Keine Tasks vorhanden.<br/>
          Briefing öffnen um Tasks hinzuzufügen.
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flex: 1,
          overflow: 'auto'
        }}>
          {tasks.map((task, index) => {
            const goal = task.goals[0]
            const isActive = activeTask?.id === task.id

            // Berechne Distanz zum Goal
            let distance: number | null = null
            if (gpsData && goal) {
              distance = calculateDistance(
                gpsData.latitude, gpsData.longitude,
                goal.position.latitude, goal.position.longitude
              )
            }

            return (
              <div
                key={task.id}
                onClick={() => handleNavigateTo(task)}
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(26, 115, 232, 0.25), rgba(26, 115, 232, 0.15))'
                    : 'var(--bg-tertiary)',
                  border: isActive
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {/* Task Header: T1 PDG [Distanz] */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {/* Task Nummer Badge */}
                  <span style={{
                    background: isActive ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)',
                    color: 'white',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    minWidth: '32px',
                    textAlign: 'center'
                  }}>
                    T{index + 1}
                  </span>

                  {/* Task Type */}
                  <span style={{
                    fontWeight: 600,
                    fontSize: '14px',
                    flex: 1
                  }}>
                    {task.type}
                  </span>

                  {/* Distanz */}
                  {distance !== null && (
                    <span style={{
                      fontWeight: 700,
                      fontSize: '14px',
                      color: isActive ? '#3b82f6' : 'var(--text-primary)'
                    }}>
                      {formatDistance(distance, settings.distanceUnit)}
                      <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '2px' }}>
                        {settings.distanceUnit === 'meters' ? 'm' : 'ft'}
                      </span>
                    </span>
                  )}

                  {/* Löschen Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Task T${index + 1} löschen?`)) {
                        removeTask(task.id)
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      fontSize: '14px',
                      borderRadius: '4px',
                      opacity: 0.6
                    }}
                    title="Task löschen"
                  >
                    ✕
                  </button>
                </div>

                {/* Goal Info */}
                {goal && (
                  <div style={{
                    marginTop: '6px',
                    paddingLeft: '40px'
                  }}>
                    {/* Goal Name */}
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '2px'
                    }}>
                      {goal.name}
                    </div>

                    {/* Koordinaten */}
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: 'var(--text-muted)'
                    }}>
                      {formatCoordinate(goal.position.latitude, goal.position.longitude, settings.coordinateFormat)}
                    </div>
                  </div>
                )}

                {/* Aktiv Indikator */}
                {isActive && (
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    justifyContent: 'center'
                  }}>
                    <button
                      className="btn btn-secondary"
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px'
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveTask(null)
                        setSelectedGoal(null)
                      }}
                    >
                      Navigation beenden
                    </button>
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
