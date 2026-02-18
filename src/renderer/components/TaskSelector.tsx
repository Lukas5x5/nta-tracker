import { useState } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { Task, TaskType, Goal, GoalType } from '../../shared/types'

const TASK_DESCRIPTIONS: Record<TaskType, { name: string; description: string }> = {
  [TaskType.PDG]: {
    name: 'Pilot Declared Goal',
    description: 'Pilot wählt eigenes Ziel vor dem Start'
  },
  [TaskType.JDG]: {
    name: 'Judge Declared Goal',
    description: 'Wettkampfleitung gibt Ziel vor'
  },
  [TaskType.HWZ]: {
    name: 'Hesitation Waltz',
    description: 'Pilot wählt eines von mehreren vorgegebenen Zielen'
  },
  [TaskType.FIN]: {
    name: 'Fly In',
    description: 'Ziel ist am Startplatz'
  },
  [TaskType.FON]: {
    name: 'Fly On',
    description: 'Pilot deklariert Ziel während des Fluges'
  },
  [TaskType.HNH]: {
    name: 'Hare and Hounds',
    description: 'Verfolgung eines Leitballons'
  },
  [TaskType.WSD]: {
    name: 'Watership Down',
    description: 'Zum Hare fliegen und folgen'
  },
  [TaskType.GBM]: {
    name: 'Gordon Bennett Memorial',
    description: 'Marker innerhalb definierter Scoring Area'
  },
  [TaskType.ELB]: {
    name: 'Elbow',
    description: 'Richtungsänderung - maximaler Winkel'
  },
  [TaskType.MDD]: {
    name: 'Minimum Distance Double Drop',
    description: 'Zwei Marker mit minimaler Distanz zueinander'
  },
  [TaskType.MDT]: {
    name: 'Minimum Distance',
    description: 'Nächster Punkt zum Referenzpunkt'
  },
  [TaskType.CRT]: {
    name: 'Calculated Rate Task',
    description: 'Berechnung basierend auf Annäherungsrate'
  },
  [TaskType.RTA]: {
    name: 'Race to Area',
    description: 'Rennen zu einem definierten Gebiet'
  },
  [TaskType.LRN]: {
    name: 'Land Run',
    description: 'Längste Distanz nach Landung'
  },
  [TaskType.XDI]: {
    name: 'Maximum Distance',
    description: 'Maximale Distanz vom Startpunkt'
  },
  [TaskType.XDT]: {
    name: 'Max Distance Time',
    description: 'Maximale Distanz innerhalb Zeitlimit'
  },
  [TaskType.XDD]: {
    name: 'Max Distance Double Drop',
    description: 'Maximale Distanz zwischen zwei Markern'
  },
  [TaskType.ANG]: {
    name: 'Angle Task',
    description: 'Bestimmter Winkel erreichen'
  },
  [TaskType.SFL]: {
    name: 'Shortest Flight',
    description: 'Kürzeste Distanz zum Referenzpunkt'
  },
  [TaskType.LTT]: {
    name: 'Least Time Task',
    description: 'Schnellste Durchquerung'
  },
  [TaskType.MTT]: {
    name: 'Most Time Task',
    description: 'Langsamste Durchquerung'
  },
  [TaskType.ThreeD]: {
    name: '3D Task',
    description: 'Ziel in definierter Höhe'
  },
  [TaskType.APT]: {
    name: 'Altitude Profile Task',
    description: 'Höhenprofil so genau wie möglich folgen'
  }
}

interface TaskSelectorProps {
  onClose: () => void
}

export function TaskSelector({ onClose }: TaskSelectorProps) {
  const { setActiveTask } = useFlightStore()
  const [selectedType, setSelectedType] = useState<TaskType | null>(null)
  const [taskConfig, setTaskConfig] = useState({
    name: '',
    minDistance: '',
    maxDistance: '',
    minAltitude: '',
    maxAltitude: '',
    goals: [] as { lat: string; lon: string; name: string; radius: string }[]
  })

  const handleAddGoal = () => {
    setTaskConfig(prev => ({
      ...prev,
      goals: [...prev.goals, { lat: '', lon: '', name: `Goal ${prev.goals.length + 1}`, radius: '100' }]
    }))
  }

  const handleRemoveGoal = (index: number) => {
    setTaskConfig(prev => ({
      ...prev,
      goals: prev.goals.filter((_, i) => i !== index)
    }))
  }

  const handleUpdateGoal = (index: number, field: string, value: string) => {
    setTaskConfig(prev => ({
      ...prev,
      goals: prev.goals.map((goal, i) =>
        i === index ? { ...goal, [field]: value } : goal
      )
    }))
  }

  const handleCreateTask = () => {
    if (!selectedType) return

    const goals: Goal[] = taskConfig.goals.map((g, index) => ({
      id: crypto.randomUUID(),
      name: g.name || `Goal ${index + 1}`,
      position: {
        latitude: parseFloat(g.lat) || 0,
        longitude: parseFloat(g.lon) || 0,
        altitude: 0,
        timestamp: new Date()
      },
      radius: parseFloat(g.radius) || 100,
      type: GoalType.Ground,
      declaredBy: 'judge' as const
    }))

    const task: Task = {
      id: crypto.randomUUID(),
      type: selectedType,
      name: taskConfig.name || TASK_DESCRIPTIONS[selectedType].name,
      goals,
      minDistance: taskConfig.minDistance ? parseFloat(taskConfig.minDistance) : undefined,
      maxDistance: taskConfig.maxDistance ? parseFloat(taskConfig.maxDistance) : undefined,
      minAltitude: taskConfig.minAltitude ? parseFloat(taskConfig.minAltitude) : undefined,
      maxAltitude: taskConfig.maxAltitude ? parseFloat(taskConfig.maxAltitude) : undefined,
      isActive: true
    }

    setActiveTask(task)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">Task erstellen</div>

        {/* Task Typ Auswahl */}
        {!selectedType ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            marginBottom: '16px'
          }}>
            {Object.entries(TASK_DESCRIPTIONS).map(([type, info]) => (
              <button
                key={type}
                className="btn btn-secondary"
                style={{
                  flexDirection: 'column',
                  padding: '12px',
                  height: 'auto',
                  textAlign: 'center'
                }}
                onClick={() => setSelectedType(type as TaskType)}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{type}</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                  {info.name}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Task Konfiguration */}
            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '12px',
              borderRadius: 'var(--border-radius)',
              marginBottom: '16px'
            }}>
              <div style={{ fontWeight: 600 }}>{selectedType}</div>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
                {TASK_DESCRIPTIONS[selectedType].description}
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Task Name</label>
              <input
                type="text"
                className="input"
                placeholder={TASK_DESCRIPTIONS[selectedType].name}
                value={taskConfig.name}
                onChange={e => setTaskConfig(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="input-group">
                <label className="input-label">Min Distance (m)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="Optional"
                  value={taskConfig.minDistance}
                  onChange={e => setTaskConfig(prev => ({ ...prev, minDistance: e.target.value }))}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Max Distance (m)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="Optional"
                  value={taskConfig.maxDistance}
                  onChange={e => setTaskConfig(prev => ({ ...prev, maxDistance: e.target.value }))}
                />
              </div>
            </div>

            {/* 3D Task Höhen */}
            {selectedType === TaskType.ThreeD && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label className="input-label">Min Altitude (m)</label>
                  <input
                    type="number"
                    className="input"
                    value={taskConfig.minAltitude}
                    onChange={e => setTaskConfig(prev => ({ ...prev, minAltitude: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Max Altitude (m)</label>
                  <input
                    type="number"
                    className="input"
                    value={taskConfig.maxAltitude}
                    onChange={e => setTaskConfig(prev => ({ ...prev, maxAltitude: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* Goals (für JDG, HWZ, FIN) */}
            {[TaskType.JDG, TaskType.HWZ, TaskType.FIN].includes(selectedType) && (
              <div style={{ marginTop: '16px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span className="input-label">Goals</span>
                  <button className="btn btn-secondary" onClick={handleAddGoal}>
                    + Goal hinzufügen
                  </button>
                </div>

                {taskConfig.goals.map((goal, index) => (
                  <div
                    key={index}
                    style={{
                      background: 'var(--bg-tertiary)',
                      padding: '12px',
                      borderRadius: 'var(--border-radius)',
                      marginBottom: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Goal Name"
                        value={goal.name}
                        onChange={e => handleUpdateGoal(index, 'name', e.target.value)}
                        style={{ flex: 1, marginRight: '8px' }}
                      />
                      <button
                        className="btn btn-icon btn-secondary"
                        onClick={() => handleRemoveGoal(index)}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '8px' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Latitude"
                        value={goal.lat}
                        onChange={e => handleUpdateGoal(index, 'lat', e.target.value)}
                      />
                      <input
                        type="text"
                        className="input"
                        placeholder="Longitude"
                        value={goal.lon}
                        onChange={e => handleUpdateGoal(index, 'lon', e.target.value)}
                      />
                      <input
                        type="number"
                        className="input"
                        placeholder="Radius"
                        value={goal.radius}
                        onChange={e => handleUpdateGoal(index, 'radius', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setSelectedType(null)}
              >
                Zurück
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleCreateTask}
              >
                Task erstellen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
