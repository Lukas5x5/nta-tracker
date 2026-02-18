import React, { useState, useRef, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { createPortal } from 'react-dom'
import { useFlightStore } from '../stores/flightStore'
import { usePanelDrag } from '../hooks/usePanelDrag'
import { Task, TaskType, Goal, GoalType, ScoringArea } from '../../shared/types'
import {
  latLonToUTM as latLonToUTMWGS84,
  latLonToMGRS,
  mgrsToLatLon,
  parseMGRS,
  formatMGRS,
  formatUTM,
  formatCoordinate,
  getGridPrecision,
  gridRefToFullUTM
} from '../utils/coordinatesWGS84'
import { TasksheetImportPanel } from './TasksheetImportPanel'

interface BriefingPanelProps {
  isOpen: boolean
  onClose: () => void
  clickedPosition: { lat: number; lon: number } | null
  onClearClick: () => void
  onTaskFormActiveChange?: (active: boolean) => void
}

interface TaskFormData {
  name: string
  taskNumber: string
  loggerId: string
  loggerGoalId: string
  markerColor: string
  east: string
  north: string
  lat: number | null
  lon: number | null
  goalRadius: number
  mma: string
  mmaDashed: boolean
  showRings: boolean
  ring1: string
  ring2: string
  ring3: string
  ring4: string
  // Multi-Marker Support
  multiMarker: boolean
  markerCount: number  // 2 oder 3
  markerColors: string[]  // Farben für jeden zusätzlichen Marker
  // Task Endzeit
  endsAt: string  // UTC Zeit im Format "HH:MM"
  reminderEnabled: boolean
  reminderValue: number  // Individuelle Erinnerungszeit
  reminderUnit: 'minutes' | 'seconds'  // Einheit
}

const emptyTaskForm = (defaultMma: number, reminderValue?: number, reminderUnit?: 'minutes' | 'seconds'): TaskFormData => ({
  name: '',
  taskNumber: '',
  loggerId: '',
  loggerGoalId: '',
  markerColor: '#3b82f6',
  east: '',
  north: '',
  lat: null,
  lon: null,
  goalRadius: 100,
  mma: defaultMma.toString(),
  mmaDashed: false,
  showRings: false,
  ring1: '',
  ring2: '',
  ring3: '',
  ring4: '',
  // Multi-Marker Defaults
  multiMarker: false,
  markerCount: 2,
  markerColors: [],  // Werden aus Settings geladen
  // Task Endzeit Defaults - globale Settings verwenden
  endsAt: '',
  reminderEnabled: false,
  reminderValue: reminderValue ?? 5,
  reminderUnit: reminderUnit ?? 'minutes'
})

export function BriefingPanel({ isOpen, onClose, clickedPosition, onClearClick, onTaskFormActiveChange }: BriefingPanelProps) {
  const {
    tasks,
    addTask,
    removeTask,
    setActiveTask,
    setSelectedGoal,
    settings,
    updateSettings,
    activeCompetitionMap
  } = useFlightStore()

  // UTM Bounds und Zone aus aktiver Wettkampfkarte (wie OZI Explorer)
  const mapUtmBounds = activeCompetitionMap?.utmReprojection?.utmBounds
  const mapUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone
  const effectiveUtmZone = mapUtmZone || settings.utmZone || undefined

  // Hole taskMarkerColors aus Settings für Multi-Marker
  const availableMarkerColors = settings.taskMarkerColors || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b']

  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskForm, setTaskForm] = useState<TaskFormData>(() => ({
    ...emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit),
    markerColors: availableMarkerColors.slice(0, 3),  // Erste 3 Farben als Default
  }))
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showTasksheetImport, setShowTasksheetImport] = useState(false)
  const [tasksheetFile, setTasksheetFile] = useState<File | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Position aus Settings - mit Sicherheitsprüfung für sichtbaren Bereich
  const rawPosition = settings.briefingPanelPosition || { x: window.innerWidth - 420, y: 80 }
  const position = {
    x: Math.max(0, Math.min(rawPosition.x, window.innerWidth - 100)),
    y: Math.max(0, Math.min(rawPosition.y, window.innerHeight - 100))
  }

  // Position-Change Handler für Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    updateSettings({ briefingPanelPosition: pos })
  }, [updateSettings])

  // Panel Drag Hook (Mouse + Touch)
  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // Position korrigieren wenn sie außerhalb des sichtbaren Bereichs war
  useEffect(() => {
    if (isOpen && settings.briefingPanelPosition) {
      const { x, y } = settings.briefingPanelPosition
      if (x < 0 || x > window.innerWidth - 100 || y < 0 || y > window.innerHeight - 100) {
        updateSettings({
          briefingPanelPosition: {
            x: Math.max(0, Math.min(x, window.innerWidth - 100)),
            y: Math.max(0, Math.min(y, window.innerHeight - 100))
          }
        })
      }
    }
  }, [isOpen])

  // Formular zurücksetzen wenn Panel geöffnet wird
  useEffect(() => {
    if (isOpen) {
      setShowTaskForm(false)
      setTaskForm(emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit))
      setEditingTaskId(null)
    }
  }, [isOpen])

  // Callback wenn sich showTaskForm ändert (für Kartenklick-Steuerung)
  useEffect(() => {
    onTaskFormActiveChange?.(showTaskForm)
  }, [showTaskForm, onTaskFormActiveChange])

  // Schließe Farbauswahl wenn woanders geklickt wird
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showColorPicker) {
        setShowColorPicker(false)
      }
    }
    if (showColorPicker) {
      // Verzögerung damit der aktuelle Klick nicht sofort schließt
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)
    }
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showColorPicker])

  // Hilfsfunktion: Extrahiere Precision aus coordinateFormat (East/North getrennt)
  const getPrec = () => getGridPrecision(settings.coordinateFormat)
  const getPrecision = (): number => {
    return getPrec().east // Legacy: Rückwärtskompatibel für maxLength etc.
  }

  const precision = getPrecision()

  // Wenn auf Karte geklickt wird → Koordinaten setzen (WGS84)
  useEffect(() => {
    if (clickedPosition && showTaskForm) {
      let eastStr = ''
      let northStr = ''

      // Neue WGS84-basierte Formate - MGRS Grid Reference (nur innerhalb 100km Square)
      if (settings.coordinateFormat.startsWith('mgrs')) {
        const { east: ePrec, north: nPrec } = getGridPrecision(settings.coordinateFormat)
        const mgrs = latLonToMGRS(clickedPosition.lat, clickedPosition.lon, ePrec as 4|5|6, nPrec as 4|5|6, effectiveUtmZone)

        // Automatisch Grid Zone und UTM Base aktualisieren
        const utm = latLonToUTMWGS84(clickedPosition.lat, clickedPosition.lon, effectiveUtmZone)
        const gridSquareEastBase = Math.floor(utm.easting / 100000) * 100000
        const gridSquareNorthBase = Math.floor(utm.northing / 100000) * 100000

        if (!effectiveUtmZone) {
          updateSettings({
            utmZone: utm.zone,
            utmBaseEasting: gridSquareEastBase,
            utmBaseNorthing: gridSquareNorthBase
          })
        } else {
          updateSettings({
            utmBaseEasting: gridSquareEastBase,
            utmBaseNorthing: gridSquareNorthBase
          })
        }

        // MGRS zeigt nur Meter INNERHALB des 100km Squares
        eastStr = mgrs.easting
        northStr = mgrs.northing
      } else if (settings.coordinateFormat === 'utm') {
        const utm = latLonToUTMWGS84(clickedPosition.lat, clickedPosition.lon, effectiveUtmZone)

        // Automatisch Grid Zone und UTM Base aktualisieren
        const gridSquareEastBase = Math.floor(utm.easting / 100000) * 100000
        const gridSquareNorthBase = Math.floor(utm.northing / 100000) * 100000

        if (!effectiveUtmZone) {
          updateSettings({
            utmZone: utm.zone,
            utmBaseEasting: gridSquareEastBase,
            utmBaseNorthing: gridSquareNorthBase
          })
        } else {
          updateSettings({
            utmBaseEasting: gridSquareEastBase,
            utmBaseNorthing: gridSquareNorthBase
          })
        }

        eastStr = Math.round(utm.easting).toString()
        northStr = Math.round(utm.northing).toString()
      } else {
        // Legacy: Fallback für alte utm4/utm5 etc. - wird ignoriert
        eastStr = ''
        northStr = ''
      }

      setTaskForm(prev => ({
        ...prev,
        east: eastStr,
        north: northStr,
        lat: clickedPosition.lat,
        lon: clickedPosition.lon
      }))
    }
  }, [clickedPosition, showTaskForm, settings.coordinateFormat, updateSettings])

  // East/North Eingabe ändern und zu Lat/Lon konvertieren (WGS84-basiert)
  const handleCoordinateChange = async (east: string, north: string) => {
    setTaskForm(prev => ({ ...prev, east, north }))

    // Versuche zu parsen wenn beide Felder ausgefüllt sind
    if (east && north) {
      try {
        let result: { lat: number; lon: number } | null = null

        // MGRS Format - Konvertiere Grid Reference zu Lat/Lon
        if (settings.coordinateFormat.startsWith('mgrs')) {
          const { east: ePrec, north: nPrec } = getGridPrecision(settings.coordinateFormat)

          // Referenz-Koordinate für Prefix-Rekonstruktion
          // (Karten-Mitte oder gespeicherte Base)
          let refEasting: number
          let refNorthing: number

          if (mapUtmBounds) {
            refEasting = (mapUtmBounds.minE + mapUtmBounds.maxE) / 2
            refNorthing = (mapUtmBounds.minN + mapUtmBounds.maxN) / 2
          } else {
            refEasting = settings.utmBaseEasting || 500000
            refNorthing = settings.utmBaseNorthing || 5500000
          }

          const { easting: fullEasting, northing: fullNorthing } = gridRefToFullUTM(
            east, north,
            ePrec as 4 | 5 | 6, nPrec as 4 | 5 | 6,
            refEasting, refNorthing
          )

          // UTM Zone: Priorität Karte > Settings
          const effectiveUtmZone = mapUtmZone || settings.utmZone

          // Konvertiere UTM → Lat/Lon
          const { utmToLatLon } = await import('../utils/coordinatesWGS84')
          result = utmToLatLon({
            zone: effectiveUtmZone,
            hemisphere: 'N',
            easting: fullEasting,
            northing: fullNorthing
          })

          // Speichere für Grid Snapping
          const eastNum = parseInt(east)
          const northNum = parseInt(north)
          if (!isNaN(eastNum) && !isNaN(northNum)) {
            updateSettings({
              gridOriginEasting: eastNum,
              gridOriginNorthing: northNum
            })
          }
        }
        // UTM Format
        else if (settings.coordinateFormat === 'utm') {
          const eastNum = parseInt(east)
          const northNum = parseInt(north)

          if (!isNaN(eastNum) && !isNaN(northNum)) {
            // Verwende aktuelle UTM Zone (wird automatisch berechnet)
            const utm = {
              zone: settings.utmZone,
              hemisphere: 'N' as const,
              easting: eastNum,
              northing: northNum
            }

            // utmToLatLon wurde oben bereits importiert
            const { utmToLatLon } = await import('../utils/coordinatesWGS84')
            result = utmToLatLon(utm)

            updateSettings({
              gridOriginEasting: eastNum,
              gridOriginNorthing: northNum
            })
          }
        }

        if (result) {
          setTaskForm(prev => ({
            ...prev,
            lat: result.lat,
            lon: result.lon
          }))
        }
      } catch (error) {
        console.error('Fehler beim Parsen der Koordinaten:', error)
      }
    }
  }

  // Task erstellen
  const handleCreateTask = () => {
    if (!taskForm.lat || !taskForm.lon || !taskForm.name.trim()) {
      alert('Bitte Namen und Koordinaten eingeben')
      return
    }

    const goal: Goal = {
      id: crypto.randomUUID(),
      name: taskForm.name,
      position: {
        latitude: taskForm.lat,
        longitude: taskForm.lon,
        altitude: 0,
        timestamp: new Date()
      },
      radius: taskForm.goalRadius,
      type: GoalType.Ground,
      declaredBy: 'judge'
    }

    // Rings: Alle Ringe sammeln und in Meter umwandeln
    const rings = [
      taskForm.ring1 ? parseFloat(taskForm.ring1) : null,
      taskForm.ring2 ? parseFloat(taskForm.ring2) : null,
      taskForm.ring3 ? parseFloat(taskForm.ring3) : null,
      taskForm.ring4 ? parseFloat(taskForm.ring4) : null
    ].filter((r): r is number => r !== null).map(r => r * 1000) // Konvertiere km zu m

    // Deaktiviere alle anderen Tasks
    tasks.forEach(t => {
      if (t.isActive) {
        const deactivated = { ...t, isActive: false }
        removeTask(t.id)
        addTask(deactivated)
      }
    })

    const task: Task = {
      id: crypto.randomUUID(),
      type: TaskType.JDG, // Default Type
      name: taskForm.name,
      taskNumber: taskForm.taskNumber || undefined,
      loggerId: taskForm.loggerId ? `${settings.loggerLabelPrefix ?? 'LM'}${taskForm.loggerId.toUpperCase()}` : undefined,
      loggerGoalId: taskForm.loggerGoalId ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${taskForm.loggerGoalId.toUpperCase()}` : undefined,
      markerColor: taskForm.markerColor || '#3b82f6',
      goals: [goal],
      rings: rings.length > 0 ? rings : undefined,
      // Legacy Support: minDistance und maxDistance für Kompatibilität
      minDistance: rings.length > 0 ? Math.min(...rings) : undefined,
      maxDistance: rings.length > 0 ? Math.max(...rings) : undefined,
      mmaRadius: taskForm.mma ? parseFloat(taskForm.mma) : 100,
      mmaDashed: settings.mmaFillDashed || false,
      // Multi-Marker Support
      markerCount: taskForm.multiMarker ? taskForm.markerCount : 1,
      markerColors: taskForm.multiMarker ? taskForm.markerColors.slice(0, taskForm.markerCount) : undefined,
      // Task Endzeit
      endsAt: taskForm.endsAt || undefined,
      reminderEnabled: taskForm.reminderEnabled,
      reminderValue: taskForm.reminderEnabled ? taskForm.reminderValue : undefined,
      reminderUnit: taskForm.reminderEnabled ? taskForm.reminderUnit : undefined,
      isActive: true
    }

    addTask(task)
    setActiveTask(task)
    setSelectedGoal(goal)
    setTaskForm(emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit))
    setShowTaskForm(false)
    onClearClick()
  }

  // Task bearbeiten
  const handleEditTask = (task: Task) => {
    const goal = task.goals[0]
    if (!goal) return

    // Berechne rings zurück aus rings array oder minDistance/maxDistance
    let ring1 = '', ring2 = '', ring3 = '', ring4 = ''

    if (task.rings && task.rings.length > 0) {
      // Neue Methode: rings array
      ring1 = task.rings[0] ? (task.rings[0] / 1000).toString() : ''
      ring2 = task.rings[1] ? (task.rings[1] / 1000).toString() : ''
      ring3 = task.rings[2] ? (task.rings[2] / 1000).toString() : ''
      ring4 = task.rings[3] ? (task.rings[3] / 1000).toString() : ''
    } else {
      // Legacy: minDistance und maxDistance
      const minKm = task.minDistance ? task.minDistance / 1000 : ''
      const maxKm = task.maxDistance ? task.maxDistance / 1000 : ''
      ring1 = minKm.toString()
      ring4 = maxKm.toString()
    }

    // Konvertiere Lat/Lon zu East/North (mit erzwungener Zone der Wettkampfkarte)
    const utm = latLonToUTMWGS84(goal.position.latitude, goal.position.longitude, effectiveUtmZone)

    // Berechne Grid Reference (nur Meter innerhalb des 100km Squares)
    let eastStr = ''
    let northStr = ''

    if (settings.coordinateFormat.startsWith('mgrs')) {
      const { east: ePrec, north: nPrec } = getGridPrecision(settings.coordinateFormat)
      const mgrs = latLonToMGRS(goal.position.latitude, goal.position.longitude, ePrec as 4|5|6, nPrec as 4|5|6, effectiveUtmZone)
      eastStr = mgrs.easting
      northStr = mgrs.northing
    } else if (settings.coordinateFormat === 'utm') {
      eastStr = Math.round(utm.easting).toString()
      northStr = Math.round(utm.northing).toString()
      console.log('[BriefingPanel] editTask UTM:', { effectiveUtmZone, utmZone: utm.zone, eastStr, northStr })
    }

    setTaskForm({
      name: task.name,
      taskNumber: task.taskNumber || '',
      loggerId: task.loggerId ? task.loggerId.replace(new RegExp(`^${(settings.loggerLabelPrefix ?? 'LM').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '') : '',
      loggerGoalId: task.loggerGoalId ? task.loggerGoalId.replace(new RegExp(`^${(settings.loggerGoalLabelPrefix ?? 'LG').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '') : '',
      markerColor: task.markerColor || '#3b82f6',
      east: eastStr,
      north: northStr,
      lat: goal.position.latitude,
      lon: goal.position.longitude,
      goalRadius: goal.radius,
      mma: (task.mmaRadius || 100).toString(),
      mmaDashed: task.mmaDashed || false,
      showRings: !!(task.rings?.length || task.minDistance || task.maxDistance),
      ring1,
      ring2,
      ring3,
      ring4,
      // Multi-Marker
      multiMarker: (task.markerCount || 1) > 1,
      markerCount: task.markerCount || 1,
      markerColors: task.markerColors || availableMarkerColors.slice(0, 3),
      // Task Endzeit
      endsAt: task.endsAt || '',
      reminderEnabled: task.reminderEnabled || false,
      reminderValue: task.reminderValue ?? settings.taskReminderValue ?? 5,
      reminderUnit: task.reminderUnit ?? settings.taskReminderUnit ?? 'minutes'
    })
    setEditingTaskId(task.id)
    setShowTaskForm(true)
  }

  // Task Update
  const handleUpdateTask = () => {
    if (!taskForm.lat || !taskForm.lon || !taskForm.name.trim() || !editingTaskId) {
      alert('Bitte Namen und Koordinaten eingeben')
      return
    }

    const goal: Goal = {
      id: crypto.randomUUID(),
      name: taskForm.name,
      position: {
        latitude: taskForm.lat,
        longitude: taskForm.lon,
        altitude: 0,
        timestamp: new Date()
      },
      radius: taskForm.goalRadius,
      type: GoalType.Ground,
      declaredBy: 'judge'
    }

    // Rings: Alle Ringe sammeln und in Meter umwandeln
    const rings = [
      taskForm.ring1 ? parseFloat(taskForm.ring1) : null,
      taskForm.ring2 ? parseFloat(taskForm.ring2) : null,
      taskForm.ring3 ? parseFloat(taskForm.ring3) : null,
      taskForm.ring4 ? parseFloat(taskForm.ring4) : null
    ].filter((r): r is number => r !== null).map(r => r * 1000) // Konvertiere km zu m

    const existingTask = tasks.find(t => t.id === editingTaskId)
    const updatedTask: Task = {
      id: editingTaskId,
      type: existingTask?.type || TaskType.JDG, // Behalte den alten Type
      name: taskForm.name,
      taskNumber: taskForm.taskNumber || undefined,
      loggerId: taskForm.loggerId ? `${settings.loggerLabelPrefix ?? 'LM'}${taskForm.loggerId.toUpperCase()}` : undefined,
      loggerGoalId: taskForm.loggerGoalId ? `${settings.loggerGoalLabelPrefix ?? 'LG'}${taskForm.loggerGoalId.toUpperCase()}` : undefined,
      markerColor: taskForm.markerColor || '#3b82f6',
      goals: [goal],
      rings: rings.length > 0 ? rings : undefined,
      // Legacy Support: minDistance und maxDistance für Kompatibilität
      minDistance: rings.length > 0 ? Math.min(...rings) : undefined,
      maxDistance: rings.length > 0 ? Math.max(...rings) : undefined,
      mmaRadius: taskForm.mma ? parseFloat(taskForm.mma) : 100,
      mmaDashed: settings.mmaFillDashed || false,
      // Multi-Marker Support
      markerCount: taskForm.multiMarker ? taskForm.markerCount : 1,
      markerColors: taskForm.multiMarker ? taskForm.markerColors.slice(0, taskForm.markerCount) : undefined,
      // Task Endzeit
      endsAt: taskForm.endsAt || undefined,
      reminderEnabled: taskForm.reminderEnabled,
      reminderValue: taskForm.reminderEnabled ? taskForm.reminderValue : undefined,
      reminderUnit: taskForm.reminderEnabled ? taskForm.reminderUnit : undefined,
      isActive: existingTask?.isActive || false
    }

    removeTask(editingTaskId)
    addTask(updatedTask)

    // Wenn der Task aktiv war, reaktivieren
    if (existingTask?.isActive) {
      setActiveTask(updatedTask)
      setSelectedGoal(goal)
    }

    setTaskForm(emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit))
    setEditingTaskId(null)
    setShowTaskForm(false)
    onClearClick()
  }

  if (!isOpen) return null

  // Panel Skalierung - echte transform scale für Breite UND Höhe
  const scale = settings.briefingPanelScale ?? 1

  return (
    <>
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 1001,
          width: '320px',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'default',
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
      {/* Header - kompakt wie andere Panels */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(0,0,0,0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'grab',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'white' }}>Briefing</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
              {tasks.length} Task{tasks.length !== 1 ? 's' : ''}
            </div>
          </div>
          {/* Tasksheet Import Button - öffnet direkt Datei-Dialog */}
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                setTasksheetFile(file)
                setShowTasksheetImport(true)
              }
              // Reset input für erneute Auswahl derselben Datei
              e.target.value = ''
            }}
            style={{ display: 'none' }}
            id="tasksheet-file-input"
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Öffne direkt den Datei-Dialog
              const input = document.getElementById('tasksheet-file-input') as HTMLInputElement
              if (input) input.click()
            }}
            title="Tasksheet importieren"
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '6px',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '4px'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content - scrollbar */}
      <div style={{
        padding: '12px',
        overflowY: 'auto',
        flex: 1
      }}>
        {/* Task Form */}
        {showTaskForm ? (
          <div style={{
            background: 'rgba(59, 130, 246, 0.06)',
            border: '1px solid rgba(59, 130, 246, 0.15)',
            borderRadius: '8px',
            padding: '10px',
            marginBottom: '10px'
          }}>
            {/* Task Name + Farbe in einer Zeile */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                ref={nameInputRef}
                type="text"
                value={taskForm.name}
                onChange={e => setTaskForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Task Name (PDG, JDG...)"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white'
                }}
              />
              {/* Farb-Dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  style={{
                    width: '36px',
                    height: '36px',
                    background: taskForm.markerColor,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                  title="Farbe wählen"
                />
                {/* Farb-Popup */}
                {showColorPicker && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    padding: '8px',
                    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                    zIndex: 100,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '4px',
                    minWidth: '140px'
                  }}>
                    {(settings.taskMarkerColors || [
                      '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
                      '#ec4899', '#a855f7', '#14b8a6', '#64748b'
                    ]).map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          setTaskForm(prev => ({ ...prev, markerColor: color }))
                          setShowColorPicker(false)
                        }}
                        style={{
                          width: '28px',
                          height: '28px',
                          background: color,
                          border: taskForm.markerColor === color ? '2px solid white' : '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Logger LM + LG + Task Nr */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#10b981',
                  fontWeight: 600,
                  fontSize: '11px',
                  pointerEvents: 'none'
                }}>LM</span>
                <input
                  type="text"
                  value={taskForm.loggerId}
                  onChange={e => setTaskForm(prev => ({ ...prev, loggerId: e.target.value.toUpperCase() }))}
                  placeholder="Marker"
                  maxLength={4}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    paddingLeft: '28px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '5px',
                    color: '#10b981'
                  }}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#f59e0b',
                  fontWeight: 600,
                  fontSize: '11px',
                  pointerEvents: 'none'
                }}>LG</span>
                <input
                  type="text"
                  value={taskForm.loggerGoalId}
                  onChange={e => setTaskForm(prev => ({ ...prev, loggerGoalId: e.target.value.toUpperCase() }))}
                  placeholder="Goal"
                  maxLength={4}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    paddingLeft: '28px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '5px',
                    color: '#f59e0b'
                  }}
                />
              </div>
              <input
                type="number"
                value={taskForm.taskNumber}
                onChange={e => setTaskForm(prev => ({ ...prev, taskNumber: e.target.value }))}
                placeholder="Task Nr"
                min="1"
                max="999"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '5px',
                  color: '#3b82f6',
                  textAlign: 'center'
                }}
              />
            </div>

            {/* Koordinaten - kompakt */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{
                fontSize: '9px',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '4px',
                textTransform: 'uppercase'
              }}>
                Koordinaten (oder Karte klicken)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <input
                  type="text"
                  value={taskForm.east}
                  onChange={e => handleCoordinateChange(e.target.value, taskForm.north)}
                  placeholder={settings.coordinateFormat === 'utm' ? 'E 511025' : `E ${'1234567'.slice(0, getPrec().east)}`}
                  maxLength={settings.coordinateFormat === 'utm' ? 7 : getPrec().east}
                  style={{
                    width: '100%',
                    padding: '10px 8px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '6px',
                    color: '#3b82f6',
                    textAlign: 'center',
                    fontWeight: 700
                  }}
                />
                <input
                  type="text"
                  value={taskForm.north}
                  onChange={e => handleCoordinateChange(taskForm.east, e.target.value)}
                  placeholder={settings.coordinateFormat === 'utm' ? 'N 5330100' : `N ${'1234567'.slice(0, getPrec().north)}`}
                  maxLength={settings.coordinateFormat === 'utm' ? 7 : getPrec().north}
                  style={{
                    width: '100%',
                    padding: '10px 8px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '6px',
                    color: '#3b82f6',
                    textAlign: 'center',
                    fontWeight: 700
                  }}
                />
              </div>
            </div>

            {/* MMA + Ends At */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>MMA (m)</div>
                <input
                  type="number"
                  value={taskForm.mma}
                  onChange={e => {
                    const val = parseInt(e.target.value) || 0
                    if (val >= 0 && val <= 500) {
                      setTaskForm(prev => ({ ...prev, mma: e.target.value }))
                    }
                  }}
                  min="0"
                  max="500"
                  placeholder="100"
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '5px',
                    color: 'white',
                    textAlign: 'center'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>
                  Ends at ({settings.taskTimeZone === 'local' ? 'Lok' : 'UTC'})
                </div>
                <input
                  type="time"
                  value={taskForm.endsAt}
                  onChange={e => setTaskForm(prev => ({ ...prev, endsAt: e.target.value }))}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.stopPropagation()}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '5px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.3)',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600,
                    fontFamily: 'monospace'
                  }}
                />
              </div>
            </div>

            {/* Reminder Einstellungen - nur wenn endsAt gesetzt */}
            {taskForm.endsAt && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                padding: '8px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: '6px'
              }}>
                <input
                  type="checkbox"
                  checked={taskForm.reminderEnabled}
                  onChange={e => setTaskForm(prev => ({ ...prev, reminderEnabled: e.target.checked }))}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '14px', height: '14px', accentColor: '#f59e0b', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>Erinnerung</span>
                <input
                  type="number"
                  value={taskForm.reminderValue}
                  onChange={e => setTaskForm(prev => ({ ...prev, reminderValue: Math.max(1, parseInt(e.target.value) || 1) }))}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.stopPropagation()}
                  min="1"
                  max={taskForm.reminderUnit === 'seconds' ? 300 : 60}
                  style={{
                    width: '40px',
                    padding: '4px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '4px',
                    color: '#f59e0b',
                    fontSize: '11px',
                    fontWeight: 600,
                    textAlign: 'center',
                    outline: 'none'
                  }}
                />
                <select
                  value={taskForm.reminderUnit}
                  onChange={e => setTaskForm(prev => ({ ...prev, reminderUnit: e.target.value as 'minutes' | 'seconds' }))}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  style={{
                    padding: '4px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '4px',
                    color: '#f59e0b',
                    fontSize: '10px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="minutes">min</option>
                  <option value="seconds">sek</option>
                </select>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>vor Ende</span>
              </div>
            )}

            {/* Multi-Marker + Rings Buttons */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={() => setTaskForm(prev => ({ ...prev, multiMarker: !prev.multiMarker }))}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  background: taskForm.multiMarker ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: taskForm.multiMarker ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                  color: taskForm.multiMarker ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Multi-Marker
              </button>
              <button
                type="button"
                onClick={() => setTaskForm(prev => ({ ...prev, showRings: !prev.showRings }))}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  background: taskForm.showRings ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: taskForm.showRings ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                  color: taskForm.showRings ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Rings
              </button>
            </div>

            {/* Multi-Marker Einstellungen - nur wenn aktiviert */}
            {taskForm.multiMarker && (
              <div style={{
                padding: '8px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: '6px',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                marginBottom: '8px'
              }}>
                {/* Anzahl */}
                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                  {[2, 3].map(count => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setTaskForm(prev => ({ ...prev, markerCount: count }))}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '4px',
                        background: taskForm.markerCount === count ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                        border: 'none',
                        color: taskForm.markerCount === count ? 'black' : 'white',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {count}x Marker
                    </button>
                  ))}
                </div>

                {/* Farben */}
                {Array.from({ length: taskForm.markerCount }).map((_, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '3px', marginBottom: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', width: '14px' }}>{idx + 1}:</span>
                    {availableMarkerColors.map((color, colorIdx) => (
                      <button
                        key={colorIdx}
                        type="button"
                        onClick={() => {
                          const newColors = [...taskForm.markerColors]
                          newColors[idx] = color
                          setTaskForm(prev => ({ ...prev, markerColors: newColors }))
                        }}
                        style={{
                          flex: 1,
                          height: '20px',
                          borderRadius: '3px',
                          background: color,
                          border: taskForm.markerColors[idx] === color ? '2px solid white' : 'none',
                          cursor: 'pointer'
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Rings Eingabe - nur wenn aktiviert */}
            {taskForm.showRings && (
              <div style={{
                padding: '8px',
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: '6px',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                marginBottom: '8px'
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '4px'
                }}>
                  {(['ring1', 'ring2', 'ring3', 'ring4'] as const).map((ring, i) => (
                    <input
                      key={ring}
                      type="number"
                      value={taskForm[ring]}
                      onChange={e => setTaskForm(prev => ({ ...prev, [ring]: e.target.value }))}
                      placeholder={`R${i + 1}`}
                      step="0.1"
                      style={{
                        width: '100%',
                        padding: '6px 4px',
                        fontSize: '11px',
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '4px',
                        color: 'white',
                        textAlign: 'center'
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Buttons - kompakt */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={editingTaskId ? handleUpdateTask : handleCreateTask}
                disabled={!taskForm.lat || !taskForm.name.trim()}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '6px',
                  background: (!taskForm.lat || !taskForm.name.trim())
                    ? 'rgba(255,255,255,0.05)'
                    : editingTaskId
                    ? '#3b82f6'
                    : '#22c55e',
                  border: 'none',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: (!taskForm.lat || !taskForm.name.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (!taskForm.lat || !taskForm.name.trim()) ? 0.4 : 1
                }}
              >
                {editingTaskId ? 'Speichern' : 'Erstellen'}
              </button>
              <button
                onClick={() => {
                  setShowTaskForm(false)
                  setTaskForm(emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit))
                  setEditingTaskId(null)
                  onClearClick()
                }}
                style={{
                  padding: '10px 16px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          /* Add Task Button - kompakt */
          <button
            onClick={() => setShowTaskForm(true)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px dashed rgba(59, 130, 246, 0.4)',
              color: '#3b82f6',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginBottom: '12px'
            }}
          >
            <span style={{ fontSize: '16px' }}>+</span>
            Neuer Task
          </button>
        )}

        {/* Tasks List - kompakt */}
        {tasks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '24px 16px',
            color: 'rgba(255,255,255,0.3)',
            fontSize: '12px'
          }}>
            Keine Tasks vorhanden
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                {/* Color Badge */}
                <div style={{
                  width: '4px',
                  height: '28px',
                  borderRadius: '2px',
                  background: task.markerColor || '#3b82f6',
                  flexShrink: 0
                }} />

                {/* Task Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'white',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {task.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                    {task.loggerId && <span style={{ color: '#10b981' }}>{task.loggerId}</span>}
                    {task.loggerId && task.loggerGoalId && ' '}
                    {task.loggerGoalId && <span style={{ color: '#f59e0b' }}>{task.loggerGoalId}</span>}
                    {(task.loggerId || task.loggerGoalId) && task.mmaRadius && ' • '}
                    {task.mmaRadius && `${task.mmaRadius}m`}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleEditTask(task)}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: 'none',
                      color: '#3b82f6',
                      fontSize: '14px',
                      cursor: 'pointer',
                      width: '28px',
                      height: '28px',
                      borderRadius: '5px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Bearbeiten"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setTaskToDelete(task.id)
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '14px',
                      cursor: 'pointer',
                      width: '28px',
                      height: '28px',
                      borderRadius: '5px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Löschen"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Dialog - kompakt */}
      {taskToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setTaskToDelete(null)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '10px',
              padding: '16px',
              maxWidth: '300px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'white', marginBottom: '8px' }}>Task löschen?</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '16px' }}>
              "{tasks.find(t => t.id === taskToDelete)?.name}"
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setTaskToDelete(null)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  removeTask(taskToDelete)
                  setTaskToDelete(null)
                  setEditingTaskId(null)
                  setTaskForm(emptyTaskForm(settings.defaultMmaRadius || 100, settings.taskReminderValue, settings.taskReminderUnit))
                  setShowTaskForm(false)
                }}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#ef4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Tasksheet Import Panel - als Portal außerhalb des skalierten Panels */}
      {showTasksheetImport && tasksheetFile && createPortal(
        <TasksheetImportPanel
          isOpen={showTasksheetImport}
          onClose={() => {
            setShowTasksheetImport(false)
            setTasksheetFile(null)
          }}
          initialFile={tasksheetFile}
        />,
        document.body
      )}
    </>
  )
}
