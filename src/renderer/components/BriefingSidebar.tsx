import { useState, useEffect } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { Task, TaskType, Goal, GoalType } from '../../shared/types'
import { formatCoordinate, parseGridReference, latLonToUTM, formatUTMGridRef } from '../utils/coordinatesWGS84'

interface BriefingSidebarProps {
  isOpen: boolean
  onClose: () => void
  clickedPosition: { lat: number; lon: number } | null
  onClearClick: () => void
}

// Task Slot Typ
interface TaskSlot {
  id: string
  type: TaskType
  name: string
  goalName: string
  goalGridRef: string
  goalLat: number | null
  goalLon: number | null
  goalRadius: number
  ring1: string  // km
  ring2: string
  ring3: string
  ring4: string
  mma: string
  minAlt: string
  maxAlt: string
}

const emptyTaskSlot = (index: number): TaskSlot => ({
  id: `task-${index}`,
  type: TaskType.JDG,
  name: '',
  goalName: '',
  goalGridRef: '',
  goalLat: null,
  goalLon: null,
  goalRadius: 100,
  ring1: '',
  ring2: '',
  ring3: '',
  ring4: '',
  mma: '100',
  minAlt: '',
  maxAlt: ''
})

export function BriefingSidebar({ isOpen, onClose, clickedPosition, onClearClick }: BriefingSidebarProps) {
  const {
    tasks,
    addTask,
    removeTask,
    setActiveTask,
    setSelectedGoal,
    updateSettings,
    settings
  } = useFlightStore()

  // 8 Task Slots (T1-T8) wie OZI Target
  const [taskSlots, setTaskSlots] = useState<TaskSlot[]>(() =>
    Array.from({ length: 8 }, (_, i) => emptyTaskSlot(i + 1))
  )

  // Aktiver Task Tab (0-7)
  const [activeSlot, setActiveSlot] = useState(0)

  // View: 'tasks' oder 'settings'
  const [view, setView] = useState<'tasks' | 'settings'>('tasks')

  // Aktueller Task Slot
  const currentSlot = taskSlots[activeSlot]

  // Wenn auf Karte geklickt wird → Grid Reference + Koordinaten setzen
  useEffect(() => {
    if (clickedPosition && view === 'tasks') {
      const utm = latLonToUTM(clickedPosition.lat, clickedPosition.lon)
      // Standard: 5 Stellen für Grid Reference
      const gridRef = formatUTMGridRef(utm.easting, utm.northing, 5)

      setTaskSlots(prev => prev.map((slot, i) =>
        i === activeSlot
          ? {
              ...slot,
              goalGridRef: gridRef,
              goalLat: clickedPosition.lat,
              goalLon: clickedPosition.lon,
              goalName: slot.goalName || `Goal ${activeSlot + 1}`
            }
          : slot
      ))
    }
  }, [clickedPosition])

  // Grid Reference parsen und Koordinaten aktualisieren
  const handleGridRefChange = (value: string) => {
    setTaskSlots(prev => prev.map((slot, i) => {
      if (i !== activeSlot) return slot

      const result = parseGridReference(
        value,
        settings.utmZone,
        settings.utmBaseEasting,
        settings.utmBaseNorthing
      )

      return {
        ...slot,
        goalGridRef: value,
        goalLat: result?.lat ?? slot.goalLat,
        goalLon: result?.lon ?? slot.goalLon
      }
    }))
  }

  // Task Slot aktualisieren
  const updateSlot = (field: keyof TaskSlot, value: string | number | TaskType) => {
    setTaskSlots(prev => prev.map((slot, i) =>
      i === activeSlot ? { ...slot, [field]: value } : slot
    ))
  }

  // Task aktivieren (zum Fliegen)
  const handleActivateTask = () => {
    if (!currentSlot.goalLat || !currentSlot.goalLon) {
      alert('Bitte zuerst ein Goal setzen (Karte klicken oder Grid Ref eingeben)')
      return
    }

    const goal: Goal = {
      id: crypto.randomUUID(),
      name: currentSlot.goalName || `Goal T${activeSlot + 1}`,
      position: {
        latitude: currentSlot.goalLat,
        longitude: currentSlot.goalLon,
        altitude: 0,
        timestamp: new Date()
      },
      radius: currentSlot.goalRadius,
      type: GoalType.Ground,
      declaredBy: 'judge'
    }

    const task: Task = {
      id: currentSlot.id,
      type: currentSlot.type,
      name: currentSlot.name || `Task ${activeSlot + 1}`,
      goals: [goal],
      minDistance: currentSlot.ring1 ? parseFloat(currentSlot.ring1) * 1000 : undefined,
      maxDistance: currentSlot.ring4 ? parseFloat(currentSlot.ring4) * 1000 : undefined,
      mmaRadius: currentSlot.mma ? parseFloat(currentSlot.mma) : 100,
      minAltitude: currentSlot.minAlt ? parseFloat(currentSlot.minAlt) : undefined,
      maxAltitude: currentSlot.maxAlt ? parseFloat(currentSlot.maxAlt) : undefined,
      isActive: true
    }

    // Alten Task entfernen falls vorhanden
    const existingTask = tasks.find(t => t.id === currentSlot.id)
    if (existingTask) {
      removeTask(currentSlot.id)
    }

    addTask(task)
    setActiveTask(task)
    setSelectedGoal(goal)
  }

  // Task Slot löschen
  const handleClearSlot = () => {
    setTaskSlots(prev => prev.map((slot, i) =>
      i === activeSlot ? emptyTaskSlot(activeSlot + 1) : slot
    ))
    onClearClick()
  }

  // Formatierte Koordinaten für Anzeige
  const formatPos = (lat: number | null, lon: number | null): string => {
    if (lat === null || lon === null) return '-- / --'
    return formatCoordinate(lat, lon, settings.coordinateFormat)
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: '320px',
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
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        gap: '8px'
      }}>
        <span style={{ fontWeight: 600, flex: 1 }}>Briefing</span>
        <button
          className={`btn btn-sm ${view === 'tasks' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setView('tasks')}
          style={{ padding: '4px 8px', fontSize: '12px' }}
        >
          Tasks
        </button>
        <button
          className={`btn btn-sm ${view === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setView('settings')}
          style={{ padding: '4px 8px', fontSize: '12px' }}
        >
          ⚙
        </button>
        <button className="btn btn-icon btn-secondary" onClick={onClose} style={{ padding: '4px' }}>✕</button>
      </div>

      {view === 'tasks' ? (
        <>
          {/* Task Tabs T1-T8 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            borderBottom: '1px solid var(--border-color)'
          }}>
            {taskSlots.map((slot, i) => (
              <button
                key={i}
                onClick={() => setActiveSlot(i)}
                style={{
                  padding: '8px 0',
                  background: activeSlot === i ? 'var(--color-primary)' :
                              slot.goalLat ? 'var(--bg-tertiary)' : 'transparent',
                  border: 'none',
                  borderRight: i < 7 ? '1px solid var(--border-color)' : 'none',
                  color: activeSlot === i ? 'white' :
                         slot.goalLat ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: activeSlot === i ? 600 : 400,
                  fontSize: '13px'
                }}
              >
                T{i + 1}
              </button>
            ))}
          </div>

          {/* Task Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>

            {/* Hinweis */}
            <div style={{
              background: 'var(--color-primary)',
              color: 'white',
              padding: '8px',
              borderRadius: '4px',
              marginBottom: '12px',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              Klicke auf Karte um Goal zu setzen
            </div>

            {/* Task Type */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                Task Type
              </label>
              <select
                className="input"
                value={currentSlot.type}
                onChange={e => updateSlot('type', e.target.value as TaskType)}
                style={{ padding: '6px', fontSize: '13px' }}
              >
                <option value={TaskType.JDG}>JDG - Judge Declared Goal</option>
                <option value={TaskType.PDG}>PDG - Pilot Declared Goal</option>
                <option value={TaskType.HWZ}>HWZ - Hesitation Waltz</option>
                <option value={TaskType.FIN}>FIN - Fly In</option>
                <option value={TaskType.FON}>FON - Fly On</option>
                <option value={TaskType.HNH}>HNH - Hare and Hounds</option>
                <option value={TaskType.GBM}>GBM - Gordon Bennett</option>
                <option value={TaskType.CRT}>CRT - Calculated Rate</option>
                <option value={TaskType.XDI}>XDI - Max Distance</option>
                <option value={TaskType.MDD}>MDD - Min Distance DD</option>
                <option value={TaskType.ELB}>ELB - Elbow</option>
                <option value={TaskType.ThreeD}>3D - 3D Task</option>
              </select>
            </div>

            {/* Goal Section */}
            <div style={{
              background: 'var(--bg-card)',
              padding: '10px',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              <div style={{ fontWeight: 500, marginBottom: '8px', fontSize: '13px' }}>Goal</div>

              {/* Grid Reference - großes Eingabefeld */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                  Grid Reference (UTM {settings.coordinateFormat.replace('utm', '')}-stellig)
                </label>
                <input
                  type="text"
                  className="input"
                  value={currentSlot.goalGridRef}
                  onChange={e => handleGridRefChange(e.target.value)}
                  placeholder="z.B. 12345678"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '18px',
                    padding: '8px',
                    textAlign: 'center',
                    letterSpacing: '2px'
                  }}
                />
              </div>

              {/* Koordinaten Anzeige */}
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'monospace',
                textAlign: 'center',
                marginBottom: '8px'
              }}>
                {formatPos(currentSlot.goalLat, currentSlot.goalLon)}
              </div>

              {/* Goal Name und Radius */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  value={currentSlot.goalName}
                  onChange={e => updateSlot('goalName', e.target.value)}
                  placeholder="Goal Name"
                  style={{ fontSize: '12px', padding: '6px' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    className="input"
                    value={currentSlot.goalRadius}
                    onChange={e => updateSlot('goalRadius', parseInt(e.target.value) || 100)}
                    style={{ fontSize: '12px', padding: '6px', width: '50px' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>m</span>
                </div>
              </div>
            </div>

            {/* Task Rings (4 Ringe) */}
            <div style={{
              background: 'var(--bg-card)',
              padding: '10px',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              <div style={{ fontWeight: 500, marginBottom: '8px', fontSize: '13px' }}>Task Rings (km)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {(['ring1', 'ring2', 'ring3', 'ring4'] as const).map((ring, i) => (
                  <div key={ring}>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                      R{i + 1}
                    </label>
                    <input
                      type="number"
                      className="input"
                      value={currentSlot[ring]}
                      onChange={e => updateSlot(ring, e.target.value)}
                      placeholder="km"
                      step="0.1"
                      style={{ fontSize: '12px', padding: '6px', textAlign: 'center' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* MMA und Höhe */}
            <div style={{
              background: 'var(--bg-card)',
              padding: '10px',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                    MMA (m)
                  </label>
                  <select
                    className="input"
                    value={currentSlot.mma}
                    onChange={e => updateSlot('mma', e.target.value)}
                    style={{ fontSize: '12px', padding: '6px' }}
                  >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="300">300</option>
                    <option value="500">500</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                    Min Alt
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={currentSlot.minAlt}
                    onChange={e => updateSlot('minAlt', e.target.value)}
                    placeholder="m"
                    style={{ fontSize: '12px', padding: '6px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                    Max Alt
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={currentSlot.maxAlt}
                    onChange={e => updateSlot('maxAlt', e.target.value)}
                    placeholder="m"
                    style={{ fontSize: '12px', padding: '6px' }}
                  />
                </div>
              </div>
            </div>

            {/* Aktionen */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                className="btn btn-success"
                onClick={handleActivateTask}
                disabled={!currentSlot.goalLat}
                style={{ padding: '10px', fontSize: '13px' }}
              >
                ▶ Aktivieren
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleClearSlot}
                style={{ padding: '10px', fontSize: '13px' }}
              >
                ✕ Löschen
              </button>
            </div>
          </div>

          {/* Footer - QNH */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>QNH:</span>
            <input
              type="number"
              className="input"
              value={settings.qnh}
              onChange={e => updateSettings({ qnh: parseFloat(e.target.value) || 1013.25 })}
              step="0.1"
              style={{ width: '70px', padding: '4px', fontSize: '12px' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>hPa</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
              Zone {settings.utmZone}
            </span>
          </div>
        </>
      ) : (
        /* Settings View */
        <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
          <div style={{ fontWeight: 600, marginBottom: '16px' }}>Einstellungen</div>

          {/* Höheneinheit */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Höheneinheit
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`btn ${settings.altitudeUnit === 'meters' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSettings({ altitudeUnit: 'meters' })}
                style={{ flex: 1, padding: '10px' }}
              >
                Meter (m)
              </button>
              <button
                className={`btn ${settings.altitudeUnit === 'feet' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSettings({ altitudeUnit: 'feet' })}
                style={{ flex: 1, padding: '10px' }}
              >
                Feet (ft)
              </button>
            </div>
          </div>

          {/* Navigationslinie */}
          <div style={{
            background: 'var(--bg-card)',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>
              Navigationslinie
            </div>
            {/* Farbe */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Farbe
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { color: '#22c55e', name: 'Grün' },
                  { color: '#ef4444', name: 'Rot' },
                  { color: '#3b82f6', name: 'Blau' },
                  { color: '#f59e0b', name: 'Orange' },
                  { color: '#ec4899', name: 'Pink' },
                  { color: '#ffffff', name: 'Weiß' }
                ].map(({ color, name }) => (
                  <button
                    key={color}
                    onClick={() => updateSettings({ navLineColor: color })}
                    title={name}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '4px',
                      background: color,
                      border: settings.navLineColor === color ? '3px solid var(--color-primary)' : '2px solid var(--border-color)',
                      cursor: 'pointer',
                      boxShadow: color === '#ffffff' ? 'inset 0 0 0 1px rgba(0,0,0,0.1)' : 'none'
                    }}
                  />
                ))}
              </div>
            </div>
            {/* Breite */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Breite: {settings.navLineWidth || 5}px
              </label>
              <input
                type="range"
                min="2"
                max="12"
                value={settings.navLineWidth || 5}
                onChange={e => updateSettings({ navLineWidth: parseInt(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Koordinaten Format - UTM only (OziExplorer/OziTarget Style) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Koordinaten Format
            </label>
            <div style={{
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                UTM {settings.coordinateFormat.replace('utm', '')}-stellig
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                OziExplorer/OziTarget Format
              </div>
            </div>
          </div>

          {/* Koordinaten Format */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Koordinaten Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {(['decimal', 'dms', 'utm', 'mgrs5'] as const).map((format) => (
                <button
                  key={format}
                  className={`btn ${settings.coordinateFormat === format ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => updateSettings({ coordinateFormat: format })}
                  style={{ padding: '8px', fontSize: '11px', textTransform: 'uppercase' }}
                >
                  {format === 'decimal' ? 'DEC' : format === 'dms' ? 'DMS' : format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* UTM Zone */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              UTM Zone
            </label>
            <select
              className="input"
              value={settings.utmZone}
              onChange={e => updateSettings({ utmZone: parseInt(e.target.value) })}
              style={{ fontSize: '13px' }}
            >
              <option value="32">32 (6°E - 12°E)</option>
              <option value="33">33 (12°E - 18°E) Österreich</option>
              <option value="34">34 (18°E - 24°E)</option>
            </select>
          </div>

          {/* UTM Basis */}
          <div style={{
            background: 'var(--bg-card)',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>
              UTM Basis (100km Quadrat)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Easting</label>
                <input
                  type="number"
                  className="input"
                  value={settings.utmBaseEasting}
                  onChange={e => updateSettings({ utmBaseEasting: parseInt(e.target.value) })}
                  style={{ fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Northing</label>
                <input
                  type="number"
                  className="input"
                  value={settings.utmBaseNorthing}
                  onChange={e => updateSettings({ utmBaseNorthing: parseInt(e.target.value) })}
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>
          </div>

          {/* Pilot Name */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Pilot Name
            </label>
            <input
              type="text"
              className="input"
              value={settings.pilotName}
              onChange={e => updateSettings({ pilotName: e.target.value })}
              placeholder="Für IGC Export"
              style={{ fontSize: '13px' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
