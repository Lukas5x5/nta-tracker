import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useAuthStore } from './authStore'

// --- IndexedDB Storage Adapter ---
// Kein Größenlimit (vs. localStorage ~5-10MB), asynchrones Lesen/Schreiben
const IDB_NAME = 'nta-store'
const IDB_STORE = 'keyval'
const IDB_VERSION = 1

let idbInstance: IDBDatabase | null = null
let idbFailed = false

function openIDB(): Promise<IDBDatabase> {
  if (idbInstance) return Promise.resolve(idbInstance)
  if (idbFailed) return Promise.reject(new Error('IDB disabled'))

  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE)
        }
      }
      req.onsuccess = () => {
        idbInstance = req.result
        idbInstance.onclose = () => { idbInstance = null }
        resolve(idbInstance)
      }
      req.onerror = () => {
        console.warn('[IDB] Open failed, trying to recover...')
        // DB korrupt: löschen und neu erstellen
        try {
          const delReq = indexedDB.deleteDatabase(IDB_NAME)
          delReq.onsuccess = () => {
            const retryReq = indexedDB.open(IDB_NAME, IDB_VERSION)
            retryReq.onupgradeneeded = () => {
              const db = retryReq.result
              if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE)
              }
            }
            retryReq.onsuccess = () => {
              idbInstance = retryReq.result
              idbInstance.onclose = () => { idbInstance = null }
              resolve(idbInstance)
            }
            retryReq.onerror = () => {
              idbFailed = true
              reject(retryReq.error)
            }
          }
          delReq.onerror = () => {
            idbFailed = true
            reject(req.error)
          }
        } catch {
          idbFailed = true
          reject(req.error)
        }
      }
    } catch (e) {
      idbFailed = true
      reject(e)
    }
  })
}

function idbGet(key: string): Promise<string | null> {
  return openIDB().then(db => new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const store = tx.objectStore(IDB_STORE)
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })).catch(() => null)
}

// Throttled IDB write: verhindert Überflutung bei hochfrequenten Updates (z.B. mousemove)
let idbWriteTimer: ReturnType<typeof setTimeout> | null = null
let idbPendingWrite: { key: string; value: string } | null = null

function idbSet(key: string, value: string): Promise<void> {
  if (idbFailed) return Promise.resolve()
  idbPendingWrite = { key, value }

  if (idbWriteTimer) return Promise.resolve()

  idbWriteTimer = setTimeout(() => {
    idbWriteTimer = null
    const pending = idbPendingWrite
    if (!pending) return
    idbPendingWrite = null

    openIDB().then(db => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        store.put(pending.value, pending.key)
      } catch {}
    }).catch(() => {})
  }, 500)

  return Promise.resolve()
}

function idbRemove(key: string): Promise<void> {
  if (idbFailed) return Promise.resolve()
  return openIDB().then(db => new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const req = store.delete(key)
      req.onsuccess = () => resolve(undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })).catch(() => undefined)
}

const idbStorage: StateStorage = {
  getItem: (name: string) => idbGet(name),
  setItem: (name: string, value: string) => idbSet(name, value),
  removeItem: (name: string) => idbRemove(name),
}

// Migration: localStorage → IndexedDB (einmalig beim ersten Start)
async function migrateLocalStorageToIDB(key: string) {
  try {
    const existing = await idbGet(key)
    if (existing) return // Bereits in IndexedDB vorhanden

    const lsData = localStorage.getItem(key)
    if (lsData) {
      console.log('[Store] Migriere localStorage → IndexedDB...')
      await idbSet(key, lsData)
      localStorage.removeItem(key)
      console.log('[Store] Migration abgeschlossen, localStorage bereinigt')
    }
  } catch (err) {
    console.warn('[Store] Migration fehlgeschlagen:', err)
  }
}

// StateStorage type from zustand
type StateStorage = {
  getItem: (name: string) => string | null | Promise<string | null>
  setItem: (name: string, value: string) => void | Promise<void>
  removeItem: (name: string) => void | Promise<void>
}

// Migration beim App-Start ausführen
migrateLocalStorageToIDB('nta-flight-storage')
import { supabase } from '../lib/supabase'
import type {
  GPSData,
  BaroData,
  Task,
  Goal,
  MarkerDrop,
  GoalDeclaration,
  WindLayer,
  Flight,
  TrackPoint,
  LogPoint,
  Waypoint,
  ConnectionStatus,
  AppSettings,
  ScoringArea,
  ImportedTrajectory,
  CompetitionMap,
  ProhibitedZone
} from '../../shared/types'
import { WindSource, WindSourceFilter, GPSFix } from '../../shared/types'
import { useTeamStore } from './teamStore'
import { saveTrackData, loadTrackData, clearTrackData } from '../utils/trackDb'
import { calculateMarkerDrop, calculateDistance as calcDist, calculateBearing as calcBrg } from '../utils/navigation'

// HDG Kurs-Linie (von Klick-Position in Kurs-Richtung)
export interface HdgCourseLine {
  id: string
  startPosition: { lat: number; lon: number }
  course: number  // Grad (0-360)
  color: string   // Farbe der Linie
  lineMode: 'from' | 'to' | 'extended'  // Linienmodus: von, zu, oder beidseitig
}

// Wind-Linie (von Klick-Position mit Wind-Daten)
export interface WindLine {
  id: string
  startPosition: { lat: number; lon: number }
  windLayer: WindLayer  // Die Windschicht-Daten
  color: string   // Farbe der Linie
}

// Fahrt-Snapshot fuer Meisterschaften
export interface FlightDataSnapshot {
  tasks: Task[]
  track: TrackPoint[]
  trackLine: [number, number][]
  markers: MarkerDrop[]
  declarations: GoalDeclaration[]
  logPoints: LogPoint[]
  hdgCourseLines: HdgCourseLine[]
  windLines: WindLine[]
  windLayers: WindLayer[]
  scoringAreas: ScoringArea[]
  importedTrajectories: ImportedTrajectory[]
  savedAt: string
}

interface FlightState {
  // Verbindung
  connectionStatus: ConnectionStatus
  isConnected: boolean
  deviceName: string | null
  connectionError: string | null

  // GPS & Baro Daten
  gpsData: GPSData | null
  smoothedGpsData: GPSData | null  // Geglättete GPS-Position für flüssige Kartenanzeige
  baroData: BaroData | null
  agl: number
  groundElevation: number

  // Flug
  flight: Flight | null
  isRecording: boolean
  track: TrackPoint[]
  trackLine: [number, number][] // Durchgehende Linie: jeder GPS-Punkt [lat, lon]
  lastRecordedTrackPoint: TrackPoint | null
  recordingStartTime: Date | null

  // Tasks & Goals
  tasks: Task[]
  activeTask: Task | null
  selectedGoal: Goal | null

  // Markers & Declarations
  markers: MarkerDrop[]
  declarations: GoalDeclaration[]

  // Wind
  windLayers: WindLayer[]
  selectedWindLayer: number | null  // Ausgewählte Windschicht (Höhe)
  windSourceFilter: WindSourceFilter  // Filter fuer Berechnungen (all/forecast/measured/sounding)

  // Waypoints
  waypoints: Waypoint[]

  // Log Points
  logPoints: LogPoint[]

  // HDG Kurs-Linien Modus (bis zu 3 Linien)
  hdgCourseMode: boolean  // Warte auf Karten-Klick
  hdgPendingCourse: number | null  // Der eingegebene Kurs
  hdgPendingLineMode: 'from' | 'to' | 'extended'  // Pending Linienmodus
  hdgCourseLines: HdgCourseLine[]  // Bis zu 3 aktive Kurslinien
  editingHdgCourseLineId: string | null  // ID der Kurslinie die gerade repositioniert wird

  // Wind-Linien Modus (bis zu 3 Linien)
  windLineMode: boolean  // Warte auf Karten-Klick
  pendingWindLayer: WindLayer | null  // Die ausgewählte Windschicht
  windLines: WindLine[]  // Bis zu 3 aktive Windlinien

  // Wind Import Position (Karten-Klick statt GPS)
  windImportPickPosition: boolean  // Modus: Auf Karte klicken um Position zu wählen
  windImportPosition: { lat: number; lon: number } | null  // Gewählte Position

  // Scoring Areas (unabhängig von Tasks)
  scoringAreas: ScoringArea[]

  // Imported Trajectories (GPX/KML)
  importedTrajectories: ImportedTrajectory[]

  // Offline Competition Maps
  savedCompetitionMaps: CompetitionMap[]
  activeCompetitionMap: CompetitionMap | null

  // Aktive Championship (wird automatisch gesetzt wenn eine Karte eingeblendet wird)
  activeChampionship: { id: string; name: string; userId?: string } | null

  // Backup-Dialog nach Tasksheet-Import
  showBackupDialog: boolean
  backupDialogChampionship: { id: string; name: string } | null

  // Prohibited Zones (PZ) / Sperrgebiete
  prohibitedZones: ProhibitedZone[]
  showProhibitedZones: boolean
  pzDrawMode: boolean  // Polygon-Zeichenmodus aktiv
  pzDrawPoints: { lat: number; lon: number }[]  // Punkte während des Zeichnens

  // OZI/Championship Maps - aktive Karten-IDs
  activeMaps: string[]

  // Goal Drag Mode (für Task-Verschiebung auf der Karte)
  goalDragMode: boolean

  // Landeprognose
  landingPrediction: {
    path: { lat: number; lon: number; altitude: number; timeSeconds: number }[]
    landingPoint: { lat: number; lon: number; altitude: number; timeSeconds: number }
    groundElevation: number
    totalTimeSeconds: number
    totalDistanceMeters: number
  } | null
  landingSinkRate: number  // m/s (positiv)
  showLandingPrediction: boolean
  landingPredictionLoading: boolean
  showWindRose: boolean

  // Drop Calculator (Klinometer)
  dropCalculator: {
    active: boolean
    markerSinkRate: number           // m/s Terminal Velocity, default 10
    impactPoint: { lat: number; lon: number } | null
    distanceToGoal: number | null
    bearingToGoal: number | null
    timeToImpact: number | null
    path: { lat: number; lon: number; altitude: number }[]
    groundElevation: number | null
    insideMma: boolean               // Aufschlagpunkt innerhalb MMA
    dropNow: boolean                 // DROP! - nächster Punkt zum Ziel erreicht
    minDistanceSeen: number | null   // Kleinste gesehene Distanz seit MMA-Eintritt
    mmaRadius: number | null         // Aktueller MMA-Radius vom Task
  }

  // Steigpunkt-Rechner Ergebnis (für Karten-Darstellung)
  climbPointResult: {
    path: { lat: number; lon: number; altitude: number }[]
    bestPoint: { lat: number; lon: number; altitude: number }
    distanceToGoal: number
  } | null

  // Land Run Rechner Ergebnis (für Karten-Darstellung)
  landRunResult: {
    pointA: { lat: number; lon: number }
    pointB: { lat: number; lon: number }
    pointC: { lat: number; lon: number }
    pathAB: { lat: number; lon: number }[]
    pathBC: { lat: number; lon: number }[]
    approachPath: { lat: number; lon: number }[]
    triangleArea: number
  } | null

  // Angle Task Rechner Ergebnis (für Karten-Darstellung)
  angleResult: {
    pointA: { lat: number; lon: number }
    pointB: { lat: number; lon: number }
    pathLeg1: { lat: number; lon: number }[]   // Leg 1 = setDirection Drift
    pathLeg2: { lat: number; lon: number }[]   // Leg 2 = Abweichung
    approachPath: { lat: number; lon: number }[]
    achievedAngle: number
    setDirection: number
  } | null

  // Aktives Tool-Panel (Marker Drop, Steigpunkt, Landeprognose, Land Run, APT, ANG)
  activeToolPanel: 'marker' | 'fly' | 'lnd' | 'lrn' | 'apt' | 'ang' | null

  // Maus-Position auf der Karte (für StatusBar Anzeige)
  mousePosition: { lat: number; lon: number } | null

  // Fly-To Position (für Navigation zu einem Punkt auf der Karte)
  flyToPosition: { lat: number; lon: number; zoom?: number } | null

  // Tasksheet Koordinaten-Picker (für Tasks ohne Koordinaten)
  tasksheetCoordPicker: {
    active: boolean
    taskNumber: number | null
    taskType: string | null
    callback: ((lat: number, lon: number) => void) | null
    // Zusätzliche Daten für den Import nach Karten-Klick
    pendingImport?: {
      tasksToImport: any[]  // ParsedTask[]
      placedPositions: Map<number, { lat: number; lon: number }>
      tasksNeedingCoords: any[]  // ParsedTask[]
      utmSettings: { zone: number; baseEasting: number; baseNorthing: number }
    }
  }

  // GPS Simulation
  gpsSimulation: {
    active: boolean
    startPosition: { lat: number; lon: number } | null
    heading: number  // Kurs in Grad
    speed: number    // Geschwindigkeit in km/h
    altitude: number // Höhe in Metern
    vario: number    // Steig-/Sinkrate in m/s
    pickingStartPoint: boolean  // Wartet auf Karten-Klick für Startpunkt
    followWind: boolean  // Folgt aufgezeichneten Wind-Layern (Kurs+Speed automatisch)
  }

  // Einstellungen
  settings: AppSettings

  // Actions
  // Landeprognose Actions
  setLandingSinkRate: (rate: number) => void
  setShowLandingPrediction: (show: boolean) => void
  setShowWindRose: (show: boolean) => void
  updateLandingPrediction: () => void

  // Drop Calculator Actions
  setDropCalculatorActive: (active: boolean) => void
  updateDropCalculator: () => void

  setClimbPointResult: (result: FlightState['climbPointResult']) => void
  setLandRunResult: (result: FlightState['landRunResult']) => void
  setAngleResult: (result: FlightState['angleResult']) => void
  setActiveToolPanel: (panel: FlightState['activeToolPanel']) => void
  setMousePosition: (position: { lat: number; lon: number } | null) => void
  setFlyToPosition: (position: { lat: number; lon: number; zoom?: number } | null) => void

  // Tasksheet Koordinaten-Picker Actions
  setTasksheetCoordPicker: (picker: { active: boolean; taskNumber: number | null; taskType: string | null; callback: ((lat: number, lon: number) => void) | null }) => void
  handleTasksheetMapClick: (lat: number, lon: number) => void

  // GPS Simulation Actions
  setGpsSimulationPickingStart: (picking: boolean) => void
  setGpsSimulationStartPosition: (position: { lat: number; lon: number } | null) => void
  setGpsSimulationParams: (params: { heading?: number; speed?: number; altitude?: number; vario?: number; followWind?: boolean }) => void
  startGpsSimulation: () => void
  stopGpsSimulation: () => void

  setConnectionStatus: (status: ConnectionStatus) => void
  setConnectionError: (error: string | null) => void
  setGPSData: (data: GPSData | null) => void
  setBaroData: (data: BaroData | null) => void

  startRecording: () => void
  stopRecording: () => void
  addTrackPoint: (point: TrackPoint) => void

  addTask: (task: Task) => void
  removeTask: (taskId: string) => void
  updateTask: (task: Task) => void
  setActiveTask: (task: Task | null) => void
  setSelectedGoal: (goal: Goal | null) => void
  updateGoalPosition: (goalId: string, lat: number, lon: number) => void
  setGoalDragMode: (enabled: boolean) => void

  dropMarker: () => MarkerDrop | null
  removeMarker: (markerId: string) => void
  clearAllMarkers: () => void
  declareGoal: (goal: Goal) => GoalDeclaration | null

  addWindLayer: (layer: WindLayer) => void
  addWindLayers: (layers: WindLayer[]) => void
  replaceWindLayers: (layers: WindLayer[]) => void
  updateWindLayer: (altitude: number, updates: Partial<WindLayer>) => void
  removeWindLayer: (altitude: number) => void
  clearWindLayers: () => void
  setSelectedWindLayer: (altitude: number | null) => void
  setWindSourceFilter: (filter: WindSourceFilter) => void

  addWaypoint: (waypoint: Waypoint) => void
  removeWaypoint: (id: string) => void

  addLogPoint: (description: string) => void

  // HDG Course Actions
  setHdgCourseMode: (active: boolean, course?: number, lineMode?: 'from' | 'to' | 'extended') => void
  setHdgPendingLineMode: (mode: 'from' | 'to' | 'extended') => void
  addHdgCourseLine: (line: Omit<HdgCourseLine, 'id' | 'color'>) => void
  updateHdgCourseLine: (id: string, updates: Partial<Pick<HdgCourseLine, 'course' | 'lineMode' | 'startPosition'>>) => void
  setEditingHdgCourseLineId: (id: string | null) => void
  removeHdgCourseLine: (id: string) => void
  clearAllHdgCourseLines: () => void

  // Wind Line Actions
  setWindLineMode: (active: boolean, windLayer?: WindLayer) => void
  addWindLine: (line: Omit<WindLine, 'id' | 'color'>) => void
  removeWindLine: (id: string) => void
  clearAllWindLines: () => void

  // Wind Import Position Actions
  setWindImportPickPosition: (active: boolean) => void
  setWindImportPosition: (pos: { lat: number; lon: number } | null) => void

  // Scoring Area Actions
  addScoringArea: (area: ScoringArea) => void
  removeScoringArea: (id: string) => void
  updateScoringArea: (id: string, updates: Partial<ScoringArea>) => void
  clearAllScoringAreas: () => void

  // Trajectory Actions
  addTrajectories: (trajectories: ImportedTrajectory[]) => void
  removeTrajectory: (id: string) => void
  toggleTrajectoryVisibility: (id: string) => void
  clearAllTrajectories: () => void

  // Competition Map Actions
  addCompetitionMap: (map: CompetitionMap) => void
  removeCompetitionMap: (id: string) => void
  setActiveCompetitionMap: (map: CompetitionMap | null) => void
  updateCompetitionMap: (id: string, updates: Partial<CompetitionMap>) => void
  clearAllCompetitionMaps: () => void

  // Championship Actions
  setActiveChampionship: (championship: { id: string; name: string } | null) => void

  // Prohibited Zone Actions
  setProhibitedZones: (zones: ProhibitedZone[]) => void
  addProhibitedZones: (zones: ProhibitedZone[]) => void
  clearProhibitedZones: () => void
  toggleShowProhibitedZones: () => void

  // PZ Draw Mode Actions
  startPzDrawMode: () => void
  stopPzDrawMode: () => void
  addPzDrawPoint: (point: { lat: number; lon: number }) => void
  removePzDrawPoint: () => void
  finishPzDraw: (name: string, elevation?: number, closed?: boolean, isTrack?: boolean, radius?: number) => void

  // Active Maps Actions (OZI/Championship Maps)
  toggleActiveMap: (mapId: string, active: boolean) => Promise<void>
  setActiveMaps: (mapIds: string[]) => void

  // Backup Dialog Actions
  openBackupDialog: () => void
  closeBackupDialog: () => void

  // Championship Actions
  getFlightSnapshot: () => FlightDataSnapshot
  loadFlightData: (data: FlightDataSnapshot) => void
  clearFlightData: () => void

  updateSettings: (settings: Partial<AppSettings>) => void
}

const defaultSettings: AppSettings = {
  altitudeUnit: 'meters',
  speedUnit: 'kmh',
  distanceUnit: 'meters',
  variometerUnit: 'ms',
  pressureUnit: 'hPa',
  qnh: 1013.25,
  coordinateFormat: 'mgrs5',  // OziExplorer/OziTarget Format (5-stellig)
  utmZone: 33,  // Österreich
  utmBand: 'U',  // Latitude Band für Österreich (48° bis 56° N)
  utmBaseEasting: 500000,
  utmBaseNorthing: 5300000,
  displayFields: [],
  fontSize: 'medium',
  theme: 'dark',
  audioAlerts: true,
  variometerAudio: false,
  variometerVolume: 0.5,
  variometerClimbThreshold: 0.3,  // Steigrate ab 0.3 m/s
  variometerSinkThreshold: -1.5,  // Sinkrate ab -1.5 m/s
  variometerClimbFreqMin: 400,
  variometerClimbFreqMax: 1200,
  variometerSinkFreqMin: 200,
  variometerSinkFreqMax: 400,
  navLineColor: '#22c55e',
  navLineWidth: 5,
  navLineEnabled: true,
  navLineShowCourse: false,
  navPanelPosition: { x: 16, y: 16 },
  navPanelFields: [
    // Höhen-Gruppe
    { id: 'alt', type: 'altitude', label: 'ALT', enabled: true, color: '#ffffff', fontSize: 'medium' },
    { id: 'agl', type: 'agl', label: 'AGL', enabled: true, color: '#22c55e', fontSize: 'medium' },
    // Flug-Daten
    { id: 'spd', type: 'speed', label: 'SPD', enabled: true, color: '#ffffff', fontSize: 'medium' },
    { id: 'hdg', type: 'heading', label: 'HDG', enabled: true, color: '#ffffff', fontSize: 'medium' },
    // Navigation zum Ziel
    { id: 'wpt', type: 'wpt', label: 'WPT', enabled: true, color: '#22c55e', fontSize: 'medium' },
    { id: 'dtg', type: 'dtg', label: 'DTG', enabled: true, color: '#3b82f6', fontSize: 'large' },
    { id: 'brg', type: 'brg', label: 'BRG', enabled: true, color: '#3b82f6', fontSize: 'medium' },
    { id: 'turn', type: 'turn', label: 'TURN', enabled: true, color: '#ffffff', fontSize: 'medium' },
    // Optionale Felder (ausgeblendet)
    { id: 'elev', type: 'elevation', label: 'ELEV', enabled: false, color: '#f59e0b', fontSize: 'medium' },
    { id: 'vario', type: 'variometer', label: 'Vario', enabled: false, color: '#ffffff', fontSize: 'medium' },
    { id: 'ete', type: 'ete', label: 'ETE', enabled: false, color: '#a855f7', fontSize: 'medium' },
    { id: 'cpa', type: 'cpa', label: 'CPA', enabled: false, color: '#14b8a6', fontSize: 'medium' },
    { id: 'drop', type: 'drop', label: 'DROP', enabled: false, color: '#ef4444', fontSize: 'medium' }
  ],
  windLayerInterval: 100,
  windSpeedUnit: 'kmh',
  windDirectionMode: 'from',
  windAltitudeUnit: 'ft',
  balloonMarkerSize: 'medium',
  balloonMarkerIcon: 'arrow',
  balloonMarkerColor: '#22c55e',
  balloonHeadingLine: true,
  balloonHeadingLineLength: 500,
  balloonHeadingLineColor: '#22c55e',
  balloonHeadingLineWidth: 2,
  defaultMmaRadius: 100,
  defaultMmaLineColor: '#ffffff',
  mmaBorderDashed: false,
  mmaFillEnabled: true,
  defaultMmaFillColor: '#ffffff',
  mmaFillDashed: false,
  crossIconColor: '#000000',
  crossIconSize: 24,
  crossIconStrokeWidth: 3,
  taskLabelFontSize: 14,
  taskLabelPadding: 6,
  taskLabelPrefix: 'Task',
  loggerLabelPrefix: 'LM',
  loggerGoalLabelPrefix: 'LG',
  loggerBadgeColor: '#10b981',
  loggerBadgeFontSize: 11,
  loggerGoalBadgeColor: '#f59e0b',
  loggerGoalBadgeFontSize: 11,
  drawingLineColor: '#3b82f6',
  drawingFillColor: '#3b82f6',
  measureColor: '#22c55e',
  lineWidth: 3,
  lineEastingValue: '',
  lineNorthingValue: '',
  pilotName: '',
  // BLS Sensor Settings
  lastConnectedBLS: null as string | null,  // ID des zuletzt verbundenen BLS
  lastConnectedBLSName: null as string | null,  // Name des zuletzt verbundenen BLS
  // Track Recording Settings
  trackRecordingMode: 'distance',
  trackRecordingTimeInterval: 5,
  trackRecordingDistanceInterval: 1,
  trackPointMarkers: true,
  trackLineColor: '#1a73e8',
  trackLineWidth: 3,
  // Grid Settings
  showGrid: false,
  gridSize: 100,
  showGridLabels: false,
  gridLineColor: '#3b82f6',
  gridLineWidth: 1,
  gridLineOpacity: 0.6,
  gridLineDashed: true,
  gridLabelColor: '#1e40af',
  gridLabelSize: 10,
  gridLabelBackground: 'rgba(255,255,255,0.85)',
  // PZ Defaults
  pzLabelSize: 11,
  pzLabelColor: '#ffffff',
  pzLabelBackground: 'rgba(239, 68, 68, 0.95)',
  pzCircleColor: '#ef4444',
  pzCircleOpacity: 0.15,
  pzCircleDashed: true,
  pzAltitudeUnit: 'feet'
}

// Throttle-Timestamps für teure Seiteneffekte in setGPSData
// Elevation und Wind brauchen nicht bei jedem 5Hz GPS-Update berechnet werden.
// Verhindert unnötige Zustand-Re-renders die die Marker-Animation blockieren.
let _lastElevationUpdate = 0   // Letztes Elevation-Update (ms) — max 1Hz
let _lastWindUpdate = 0        // Letztes Wind-Update (ms) — max 2Hz
let _lastTrackLineUpdate = 0   // Letztes TrackLine-Update (ms) — max 2Hz

export const useFlightStore = create<FlightState>()(
  persist(
    (set, get) => ({
      // Initialer State
      connectionStatus: 'disconnected' as ConnectionStatus,
      isConnected: false,
      deviceName: null,
      connectionError: null,

      gpsData: null,
      smoothedGpsData: null,
      baroData: null,
      agl: 0,
      groundElevation: 0,

      flight: null,
      isRecording: false,
      track: [],
      trackLine: [],
      lastRecordedTrackPoint: null,
      recordingStartTime: null,

      tasks: [],
      activeTask: null,
      selectedGoal: null,

      markers: [],
      declarations: [],

      windLayers: [],
      selectedWindLayer: null,
      windSourceFilter: 'all' as WindSourceFilter,

      waypoints: [],

      logPoints: [],

      // HDG Kurs-Linien (bis zu 3)
      hdgCourseMode: false,
      hdgPendingCourse: null,
      hdgPendingLineMode: 'from' as const,
      hdgCourseLines: [],
      editingHdgCourseLineId: null,

      // Wind-Linien (bis zu 3)
      windLineMode: false,
      pendingWindLayer: null,
      windLines: [],

      // Wind Import Position
      windImportPickPosition: false,
      windImportPosition: null,

      // Scoring Areas
      scoringAreas: [],

      // Imported Trajectories
      importedTrajectories: [],

      // Offline Competition Maps
      savedCompetitionMaps: [],
      activeCompetitionMap: null,

      // Aktive Championship
      activeChampionship: null,

      // Backup Dialog
      showBackupDialog: false,
      backupDialogChampionship: null,

      // Prohibited Zones (PZ)
      prohibitedZones: [],
      showProhibitedZones: true,
      pzDrawMode: false,
      pzDrawPoints: [],

      // Active Maps (OZI/Championship)
      activeMaps: [],

      // Goal Drag Mode
      goalDragMode: false,

      // Landeprognose
      landingPrediction: null,
      landingSinkRate: 2.0,
      showLandingPrediction: false,
      landingPredictionLoading: false,
      showWindRose: false,

      // Drop Calculator
      dropCalculator: {
        active: false,
        markerSinkRate: 10,
        impactPoint: null,
        distanceToGoal: null,
        bearingToGoal: null,
        timeToImpact: null,
        path: [],
        groundElevation: null,
        insideMma: false,
        dropNow: false,
        minDistanceSeen: null,
        mmaRadius: null
      },

      // Steigpunkt-Rechner
      climbPointResult: null,

      // Land Run Rechner
      landRunResult: null,

      // Angle Task Rechner
      angleResult: null,

      // Aktives Tool-Panel
      activeToolPanel: null,

      // Mouse Position
      mousePosition: null,

      // Fly-To Position
      flyToPosition: null,

      // Tasksheet Koordinaten-Picker
      tasksheetCoordPicker: {
        active: false,
        taskNumber: null,
        taskType: null,
        callback: null
      },

      // GPS Simulation
      gpsSimulation: {
        active: false,
        startPosition: null,
        heading: 0,
        speed: 10,
        altitude: 500,
        vario: 0,
        pickingStartPoint: false,
        followWind: false
      },

      settings: defaultSettings,

  // Landeprognose Actions
  setLandingSinkRate: (rate) => {
    set({ landingSinkRate: rate })
    // Prognose neu berechnen wenn aktiv
    if (get().showLandingPrediction) {
      get().updateLandingPrediction()
    }
  },
  setShowLandingPrediction: (show) => {
    set({ showLandingPrediction: show })
    if (show) {
      // Buckets sofort auf aktuelle Werte setzen, damit der Subscriber
      // nicht sofort nochmal eine Doppel-Berechnung triggert
      const s = get()
      const alt = s.baroData?.pressureAltitude || s.gpsData?.altitude || 0
      lpLastAltBucket = Math.round(alt / 50)
      lpLastLatBucket = s.gpsData ? Math.round(s.gpsData.latitude * 10000) : 0
      lpLastLonBucket = s.gpsData ? Math.round(s.gpsData.longitude * 10000) : 0
      lpLastWindHash = getWindHash(s.windLayers)
      lpLastSinkRate = s.landingSinkRate
      get().updateLandingPrediction()
    } else {
      set({ landingPrediction: null })
    }
  },
  setShowWindRose: (show) => set({ showWindRose: show }),
  updateLandingPrediction: async () => {
    const state = get()
    if (!state.showLandingPrediction) return
    if (!state.gpsData) return
    const filteredLayers = getFilteredWindLayers(state)
    if (filteredLayers.length === 0) return

    const altitude = state.baroData?.pressureAltitude || state.gpsData.altitude || 0
    if (altitude <= 0) return

    // Versions-Counter: Verhindert dass alte async-Ergebnisse neuere überschreiben
    const myVersion = ++lpVersion

    set({ landingPredictionLoading: true })

    try {
      const { calculateLandingPrediction } = await import('../utils/navigation')

      // Race-Check: Wurde zwischenzeitlich eine neuere Berechnung gestartet?
      if (lpVersion !== myVersion) return

      const getElev = async (lat: number, lon: number): Promise<number | null> => {
        if (typeof window !== 'undefined' && window.ntaAPI?.elevation) {
          return window.ntaAPI.elevation.getElevation(lat, lon)
        }
        return null
      }

      const prediction = await calculateLandingPrediction(
        state.gpsData.latitude,
        state.gpsData.longitude,
        altitude,
        state.landingSinkRate,
        filteredLayers,
        getElev
      )

      // Race-Check nach der Berechnung
      if (lpVersion !== myVersion) return

      // Hysterese: Landepunkt nur aktualisieren wenn er sich >50m bewegt hat
      // Verhindert Springen bei diskreten Windschicht-Wechseln durch GPS-Rauschen
      const currentPrediction = get().landingPrediction
      if (prediction && currentPrediction) {
        const { calculateDistance: calcDist } = await import('../utils/navigation')
        const dist = calcDist(
          currentPrediction.landingPoint.lat,
          currentPrediction.landingPoint.lon,
          prediction.landingPoint.lat,
          prediction.landingPoint.lon
        )
        if (dist < 50) {
          set({ landingPredictionLoading: false })
          return
        }
      }

      // Letzter Race-Check vor dem Setzen
      if (lpVersion !== myVersion) return

      set({ landingPrediction: prediction, landingPredictionLoading: false })
    } catch (e) {
      console.warn('[LandingPrediction] Fehler:', e)
      if (lpVersion === myVersion) {
        set({ landingPredictionLoading: false })
      }
    }
  },

  // Drop Calculator Actions
  setDropCalculatorActive: (active) => {
    if (active) {
      set((s) => ({ dropCalculator: { ...s.dropCalculator, active: true } }))
      get().updateDropCalculator()
    } else {
      set((s) => ({
        dropCalculator: {
          ...s.dropCalculator,
          active: false,
          impactPoint: null,
          distanceToGoal: null,
          bearingToGoal: null,
          timeToImpact: null,
          path: [],
          groundElevation: null,
          insideMma: false,
          dropNow: false,
          minDistanceSeen: null,
          mmaRadius: null
        }
      }))
    }
  },

  updateDropCalculator: async () => {
    if (dcRunning) {
      console.log('[DropCalc] SKIP: vorherige Berechnung läuft noch')
      return
    }
    const state = get()
    if (!state.dropCalculator.active) return
    if (!state.gpsData) {
      console.log('[DropCalc] SKIP: kein GPS')
      return
    }
    const dcFilteredLayers = getFilteredWindLayers(state)
    if (dcFilteredLayers.length === 0) {
      console.log('[DropCalc] SKIP: keine Windschichten (nach Filter)')
      return
    }

    const altitude = state.baroData?.pressureAltitude || state.gpsData.altitude || 0
    if (altitude <= 0) {
      console.log('[DropCalc] SKIP: altitude <= 0', altitude)
      return
    }

    dcRunning = true
    const t0 = performance.now()
    console.log(`[DropCalc] START: alt=${Math.round(altitude)}m, speed=${state.gpsData.speed}km/h, layers=${dcFilteredLayers.length}/${state.windLayers.length} (filter=${state.windSourceFilter}), sinkRate=${state.dropCalculator.markerSinkRate}`)

    const getElev = async (lat: number, lon: number): Promise<number | null> => {
      if (typeof window !== 'undefined' && window.ntaAPI?.elevation) {
        return window.ntaAPI.elevation.getElevation(lat, lon)
      }
      return null
    }

    try {
      const prediction = await calculateMarkerDrop(
        state.gpsData.latitude,
        state.gpsData.longitude,
        altitude,
        state.dropCalculator.markerSinkRate,
        dcFilteredLayers,
        getElev,
        state.gpsData.speed,
        state.gpsData.heading
      )

      const dt = Math.round(performance.now() - t0)

      if (!prediction) {
        console.log(`[DropCalc] RESULT: null (${dt}ms)`)
        set((s) => ({
          dropCalculator: {
            ...s.dropCalculator,
            impactPoint: null, distanceToGoal: null, bearingToGoal: null,
            timeToImpact: null, path: [], groundElevation: null,
            insideMma: false, dropNow: false, minDistanceSeen: null, mmaRadius: null
          }
        }))
        dcRunning = false
        return
      }

      console.log(`[DropCalc] RESULT: impact=(${prediction.impactPoint.lat.toFixed(4)},${prediction.impactPoint.lon.toFixed(4)}), fallzeit=${prediction.timeToImpact.toFixed(1)}s, drift=${Math.round(prediction.totalDriftMeters)}m, ground=${Math.round(prediction.groundElevation)}m, path=${prediction.path.length}pts (${dt}ms)`)

      let distToGoal: number | null = null
      let brgToGoal: number | null = null
      const currentState = get()
      if (currentState.selectedGoal) {
        distToGoal = calcDist(
          prediction.impactPoint.lat, prediction.impactPoint.lon,
          currentState.selectedGoal.position.latitude, currentState.selectedGoal.position.longitude
        )
        brgToGoal = calcBrg(
          prediction.impactPoint.lat, prediction.impactPoint.lon,
          currentState.selectedGoal.position.latitude, currentState.selectedGoal.position.longitude
        )
      }

      // MMA-basierte Logik: Finde MMA-Radius vom aktiven Task
      const mmaRadius = currentState.activeTask?.mmaRadius ?? null
      const insideMma = mmaRadius !== null && distToGoal !== null && distToGoal <= mmaRadius

      // dropNow-Logik: Wir signalisieren DROP BEVOR der nächste Punkt erreicht ist
      // damit der Pilot Zeit hat zu reagieren.
      // Sobald die Distanz im MMA abnimmt (= sich dem Ziel nähert), zeige DROP.
      // DROP bleibt aktiv solange die Distanz nahe am Minimum ist.
      // Erst wenn die Distanz wieder deutlich über dem Minimum liegt (>10m), deaktiviere DROP.
      let dropNow = currentState.dropCalculator.dropNow
      let minDistanceSeen = currentState.dropCalculator.minDistanceSeen

      if (insideMma && distToGoal !== null) {
        if (minDistanceSeen === null) {
          // Erster Eintritt in MMA - sofort DROP signalisieren
          minDistanceSeen = distToGoal
          dropNow = true
        } else if (distToGoal < minDistanceSeen) {
          // Noch näher am Ziel → Minimum aktualisieren, DROP bleibt aktiv
          minDistanceSeen = distToGoal
          dropNow = true
        } else if (distToGoal > minDistanceSeen + 10) {
          // Entfernt sich deutlich vom Minimum → DROP deaktivieren
          dropNow = false
        }
        // Zwischen Minimum und Minimum+10m: DROP-Status bleibt wie er war
      } else {
        // Außerhalb MMA → Reset
        minDistanceSeen = null
        dropNow = false
      }

      set((s) => ({
        dropCalculator: {
          ...s.dropCalculator,
          impactPoint: { lat: prediction.impactPoint.lat, lon: prediction.impactPoint.lon },
          distanceToGoal: distToGoal !== null ? Math.round(distToGoal) : null,
          bearingToGoal: brgToGoal,
          timeToImpact: prediction.timeToImpact,
          path: prediction.path.map((p: any) => ({ lat: p.lat, lon: p.lon, altitude: p.altitude })),
          groundElevation: prediction.groundElevation,
          insideMma,
          dropNow,
          minDistanceSeen,
          mmaRadius
        }
      }))
      dcRunning = false
    } catch (e) {
      console.warn('[DropCalculator] Fehler:', e)
      dcRunning = false
    }
  },

  // Mouse Position Action
  setClimbPointResult: (result) => set({ climbPointResult: result }),
  setLandRunResult: (result) => set({ landRunResult: result }),
  setAngleResult: (result) => set({ angleResult: result }),
  setActiveToolPanel: (panel) => set({ activeToolPanel: panel }),
  setMousePosition: (position) => set({ mousePosition: position }),

  // Fly-To Action
  setFlyToPosition: (position) => set({ flyToPosition: position }),

  // Tasksheet Koordinaten-Picker Actions
  setTasksheetCoordPicker: (picker) => set({ tasksheetCoordPicker: picker }),
  handleTasksheetMapClick: (lat, lon) => {
    const state = get()
    if (state.tasksheetCoordPicker.active && state.tasksheetCoordPicker.callback) {
      state.tasksheetCoordPicker.callback(lat, lon)
      // Picker deaktivieren nach Klick
      set({
        tasksheetCoordPicker: {
          active: false,
          taskNumber: null,
          taskType: null,
          callback: null
        }
      })
    }
  },

  // GPS Simulation Actions
  setGpsSimulationPickingStart: (picking) => set((state) => ({
    gpsSimulation: { ...state.gpsSimulation, pickingStartPoint: picking }
  })),

  setGpsSimulationStartPosition: (position) => set((state) => ({
    gpsSimulation: { ...state.gpsSimulation, startPosition: position, pickingStartPoint: false }
  })),

  setGpsSimulationParams: (params) => set((state) => ({
    gpsSimulation: { ...state.gpsSimulation, ...params }
  })),

  startGpsSimulation: () => {
    const state = get()
    if (!state.gpsSimulation.startPosition) return

    set((s) => ({
      gpsSimulation: { ...s.gpsSimulation, active: true }
    }))

    // Setze initiale GPS Daten
    const { startPosition, heading, speed, altitude } = state.gpsSimulation
    set({
      gpsData: {
        latitude: startPosition.lat,
        longitude: startPosition.lon,
        altitude: altitude,
        speed: speed,
        heading: heading,
        satellites: 12,
        hdop: 0.8,
        timestamp: new Date(),
        fix: GPSFix.GPS
      }
    })
  },

  stopGpsSimulation: () => {
    set((state) => ({
      gpsSimulation: {
        ...state.gpsSimulation,
        active: false
      },
      gpsData: null
    }))
  },

  // Connection Actions
  setConnectionStatus: (status) => set({
    connectionStatus: status,
    isConnected: status === 'connected'
  }),

  setConnectionError: (error) => set({ connectionError: error }),

  // GPS/Baro Actions
  setGPSData: (data) => {
    if (!data) {
      set({ gpsData: null, smoothedGpsData: null })
      return
    }

    // KEINE EMA-Glättung auf Position/Heading!
    // Die Glättung erfolgt im MapView über "Render In The Past" (60fps Interpolation
    // zwischen bekannten GPS-Positionen). Doppelte Glättung (Sensor + Store) verursacht
    // 300-400ms Verzögerung und macht den Marker träge.
    // smoothedGpsData = gpsData (1:1, keine Modifikation)
    set({ gpsData: data, smoothedGpsData: data })

    // Bodenhoehe und AGL aus HGT-Dateien berechnen — THROTTLED auf 1Hz
    // Bei 5Hz GPS würde jede Sekunde 5x IPC + HGT-Lookup + set() passieren.
    // 1Hz reicht für GND/AGL (Ballon bewegt sich nur ~5m/s).
    const nowMs = Date.now()
    if (nowMs - _lastElevationUpdate >= 1000 && typeof window !== 'undefined' && window.ntaAPI?.elevation) {
      _lastElevationUpdate = nowMs
      window.ntaAPI.elevation.getElevation(data.latitude, data.longitude).then(elev => {
        if (elev !== null) {
          const s = get()
          let currentAlt = s.baroData?.pressureAltitude || data.altitude
          const qnh = s.settings.qnh
          if (s.baroData?.pressureAltitude && qnh && qnh !== 1013.25) {
            currentAlt = s.baroData.pressureAltitude + (qnh - 1013.25) * 8.43
          }
          set({
            groundElevation: elev,
            agl: Math.max(0, Math.round(currentAlt - elev))
          })
        }
      }).catch(() => {})
    }

    // Verwende state nach dem set für weitere Operationen
    const updatedState = get()

    // Automatische Windschicht-Aktualisierung — THROTTLED auf 2Hz
    // Wind-Updates verursachen set() + Team-Share, 2Hz reicht für genaue Messung
    if (data.speed > 0.5 && nowMs - _lastWindUpdate >= 500) {
      _lastWindUpdate = nowMs
      const altitude = updatedState.baroData?.pressureAltitude || data.altitude
      // Höhe auf konfiguriertes Intervall runden
      // Intervall ist in der ausgewählten Einheit (ft oder m)
      const altitudeUnit = updatedState.settings.windAltitudeUnit || 'ft'

      // Validiere Interval - muss zur Einheit passen
      const validFtIntervals = [100, 200, 500, 1000]
      const validMIntervals = [50, 100, 200, 500]
      let intervalValue = updatedState.settings.windLayerInterval

      // Nur korrigieren wenn ungültig oder nicht gesetzt
      if (!intervalValue || (altitudeUnit === 'ft' && !validFtIntervals.includes(intervalValue))) {
        intervalValue = 100 // Default für ft
      } else if (altitudeUnit === 'm' && !validMIntervals.includes(intervalValue)) {
        intervalValue = 50 // Default für m
      }

      let roundedAltitude: number
      if (altitudeUnit === 'ft') {
        // Konvertiere zu Fuß, runde auf Intervall, konvertiere zurück zu Metern
        const altitudeFt = altitude * 3.28084
        const roundedFt = Math.round(altitudeFt / intervalValue) * intervalValue
        roundedAltitude = roundedFt / 3.28084 // Speichere intern in Metern
      } else {
        // Direkt in Metern runden
        roundedAltitude = Math.round(altitude / intervalValue) * intervalValue
      }

      // Wind kommt AUS der Richtung, Ballon fliegt IN die Richtung
      // Heading ist die Flugrichtung, Wind kommt also aus der Gegenrichtung
      const windDirection = (data.heading + 180) % 360

      // Windgeschwindigkeit in km/h speichern (GPS Speed ist bereits in km/h)
      const windSpeedKmh = data.speed

      // Vario für Stabilitätsprüfung (Steig-/Sinkrate in m/s)
      const vario = updatedState.baroData?.variometer || 0
      const isCurrentlyStable = Math.abs(vario) < 2.0 // Stabil wenn |vario| < 2 m/s

      // Prüfe ob bereits eine Schicht mit dieser Höhe existiert
      const existingLayer = updatedState.windLayers.find(l => l.altitude === roundedAltitude)

      if (existingLayer) {
        // Immer aktualisieren wenn wir in dieser Höhe sind
        // Glättung: Mische alten und neuen Wert (70% alt, 30% neu)
        const smoothedSpeed = existingLayer.speed * 0.7 + windSpeedKmh * 0.3

        // Richtung glätten mit Beachtung des 0°/360° Übergangs
        let directionDiff = windDirection - existingLayer.direction
        if (directionDiff > 180) directionDiff -= 360
        if (directionDiff < -180) directionDiff += 360
        const smoothedDirection = (existingLayer.direction + directionDiff * 0.3 + 360) % 360

        // Stabilitäts-Tracking
        const now = new Date()
        // stableSince könnte als String gespeichert sein (JSON-Serialisierung), daher konvertieren
        let stableSince: Date | undefined = existingLayer.stableSince
          ? (existingLayer.stableSince instanceof Date ? existingLayer.stableSince : new Date(existingLayer.stableSince))
          : undefined
        let isStable = existingLayer.isStable || false

        if (isCurrentlyStable) {
          // Wenn aktuell stabil, stableSince setzen falls noch nicht gesetzt
          if (!stableSince) {
            stableSince = now
          }
          // Nach 8 Sekunden stabiler Messung als stabil markieren
          const stableSeconds = (now.getTime() - stableSince.getTime()) / 1000
          if (stableSeconds >= 8) {
            isStable = true
          }
        } else {
          // Nicht stabil - Reset
          stableSince = undefined
          isStable = false
        }

        set((s) => ({
          windLayers: s.windLayers.map(layer =>
            layer.altitude === roundedAltitude
              ? {
                  ...layer,
                  direction: Math.round(smoothedDirection),
                  speed: Math.round(smoothedSpeed * 10) / 10,
                  timestamp: new Date(),
                  source: WindSource.Measured,
                  isStable,
                  stableSince,
                  vario: Math.round(vario * 10) / 10 // Vario für Stabilitätsanzeige speichern
                }
              : layer
          ).sort((a, b) => a.altitude - b.altitude)
        }))

        // Automatisch mit Team teilen wenn verbunden
        const teamState = useTeamStore.getState()
        if (teamState.session && teamState._windChannel) {
          const currentWindLayers = get().windLayers
          teamState.shareWindProfile(currentWindLayers)
        }
      } else {
        // Neue Windschicht hinzufügen
        const now = new Date()
        const newLayer: WindLayer = {
          altitude: roundedAltitude,
          direction: Math.round(windDirection),
          speed: Math.round(windSpeedKmh * 10) / 10,
          timestamp: now,
          source: WindSource.Measured,
          isStable: false,
          stableSince: isCurrentlyStable ? now : undefined,
          vario: Math.round(vario * 10) / 10 // Vario für Stabilitätsanzeige speichern
        }
        set((s) => ({
          windLayers: [...s.windLayers, newLayer].sort((a, b) => a.altitude - b.altitude)
        }))

        // Automatisch mit Team teilen wenn verbunden
        const teamState = useTeamStore.getState()
        if (teamState.session && teamState._windChannel) {
          const currentWindLayers = get().windLayers
          teamState.shareWindProfile(currentWindLayers)
        }
      }
    }

    // Wenn Recording aktiv, jeden GPS-Punkt für die durchgehende Linie speichern — THROTTLED auf 2Hz
    // Bei 5Hz würden 5 set()-Calls/sek die Animation blockieren. 2Hz reicht für glatte Track-Linie.
    if (updatedState.isRecording && nowMs - _lastTrackLineUpdate >= 500) {
      _lastTrackLineUpdate = nowMs
      set((s) => ({
        trackLine: [...s.trackLine, [data.latitude, data.longitude] as [number, number]]
      }))
    }

    // Wenn Recording aktiv, Track Point hinzufügen (smart recording)
    if (updatedState.isRecording && updatedState.baroData) {
      const lastPoint = updatedState.lastRecordedTrackPoint
      const recordingMode = updatedState.settings.trackRecordingMode
      const startTime = updatedState.recordingStartTime

      let shouldRecord = false
      let recordingReason: 'time' | 'distance' | 'significant' = 'time'

      // Berechne zusätzliche Metadaten
      let speed = data.speed / 3.6 // km/h -> m/s
      let heading = data.heading
      let verticalSpeed = updatedState.baroData.variometer
      let distance = 0
      let timeFromStart = 0

      if (startTime) {
        timeFromStart = (data.timestamp.getTime() - startTime.getTime()) / 1000
      }

      if (lastPoint) {
        // Berechne Distanz vom letzten Punkt (Haversine-Formel)
        const R = 6371000 // Erdradius in Metern
        const lat1 = lastPoint.position.latitude * Math.PI / 180
        const lat2 = data.latitude * Math.PI / 180
        const dLat = (data.latitude - lastPoint.position.latitude) * Math.PI / 180
        const dLon = (data.longitude - lastPoint.position.longitude) * Math.PI / 180

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(dLon/2) * Math.sin(dLon/2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
        distance = R * c

        // Zeitbasiert
        if (recordingMode === 'time') {
          const timeSinceLastPoint = (data.timestamp.getTime() - lastPoint.timestamp.getTime()) / 1000
          if (timeSinceLastPoint >= updatedState.settings.trackRecordingTimeInterval) {
            shouldRecord = true
            recordingReason = 'time'
          }
        }

        // Distanzbasiert
        if (recordingMode === 'distance') {
          if (distance >= updatedState.settings.trackRecordingDistanceInterval) {
            shouldRecord = true
            recordingReason = 'distance'
          }
        }

        // Smart Modus: kombiniert Zeit + Distanz + signifikante Änderungen
        if (recordingMode === 'smart') {
          const timeSinceLastPoint = (data.timestamp.getTime() - lastPoint.timestamp.getTime()) / 1000
          const minTime = 2 // Minimum 2 Sekunden zwischen Punkten
          const maxTime = 10 // Maximum 10 Sekunden ohne Punkt
          const minDistance = 5 // Minimum 5 Meter

          // Signifikante Änderungen
          const headingChange = Math.abs(heading - (lastPoint.heading || 0))
          const speedChange = Math.abs(speed - (lastPoint.speed || 0))
          const verticalSpeedChange = Math.abs(verticalSpeed - (lastPoint.verticalSpeed || 0))

          // Zu lange her → auf jeden Fall aufzeichnen
          if (timeSinceLastPoint >= maxTime) {
            shouldRecord = true
            recordingReason = 'time'
          }
          // Große Richtungsänderung (> 15°) + genug Zeit vergangen
          else if (headingChange > 15 && timeSinceLastPoint >= minTime) {
            shouldRecord = true
            recordingReason = 'significant'
          }
          // Große Geschwindigkeitsänderung (> 1 m/s) + genug Zeit vergangen
          else if (speedChange > 1 && timeSinceLastPoint >= minTime) {
            shouldRecord = true
            recordingReason = 'significant'
          }
          // Große Variometeränderung (> 0.5 m/s) + genug Zeit vergangen
          else if (verticalSpeedChange > 0.5 && timeSinceLastPoint >= minTime) {
            shouldRecord = true
            recordingReason = 'significant'
          }
          // Genug Distanz zurückgelegt
          else if (distance >= minDistance && timeSinceLastPoint >= minTime) {
            shouldRecord = true
            recordingReason = 'distance'
          }
        }
      } else {
        // Erster Trackpunkt → immer aufzeichnen
        shouldRecord = true
        recordingReason = 'time'
      }

      if (shouldRecord) {
        updatedState.addTrackPoint({
          position: {
            latitude: data.latitude,
            longitude: data.longitude,
            altitude: data.altitude,
            timestamp: data.timestamp
          },
          baro: updatedState.baroData,
          timestamp: data.timestamp,
          speed,
          heading,
          verticalSpeed,
          distance,
          timeFromStart,
          recordingReason
        })
      }
    }
  },

  setBaroData: (data) => {
    if (!data) {
      set({ baroData: null })
      return
    }
    const s = get()
    const updates: any = { baroData: data }

    // QNH vom BLS übernehmen wenn vorhanden und unterschiedlich zu Settings
    if (data.qnh && data.qnh !== 1013.25 && data.qnh !== s.settings.qnh) {
      updates.settings = { ...s.settings, qnh: data.qnh }
      console.log(`[Store] QNH vom BLS übernommen: ${data.qnh} hPa`)
    }

    // AGL sofort aktualisieren wenn Bodenhöhe bekannt ist
    if (s.groundElevation !== null && s.groundElevation !== undefined) {
      // QNH-Korrektur: BLS liefert Druckhöhe auf Basis Standard 1013.25 hPa
      const qnh = data.qnh !== 1013.25 ? data.qnh : (updates.settings?.qnh || s.settings.qnh)
      let correctedAlt = data.pressureAltitude
      if (qnh && qnh !== 1013.25) {
        correctedAlt = data.pressureAltitude + (qnh - 1013.25) * 8.43
      }
      updates.agl = Math.max(0, Math.round(correctedAlt - s.groundElevation))
    }

    set(updates)
  },

  // Recording Actions
  startRecording: () => {
    const state = get()
    const flight: Flight = {
      id: crypto.randomUUID(),
      startTime: new Date(),
      track: [],
      markers: [],
      declarations: [],
      tasks: state.tasks,
      pilot: state.settings.pilotName
    }
    clearTrackData()
    set({
      flight,
      isRecording: true,
      track: [],
      trackLine: [],
      markers: [],
      declarations: [],
      logPoints: [],
      lastRecordedTrackPoint: null,
      recordingStartTime: new Date()
    })
  },

  stopRecording: () => {
    set((state) => ({
      isRecording: false,
      lastRecordedTrackPoint: null,
      recordingStartTime: null,
      flight: state.flight ? {
        ...state.flight,
        endTime: new Date(),
        track: state.track,
        markers: state.markers,
        declarations: state.declarations
      } : null
    }))
  },

  addTrackPoint: (point) => set((state) => ({
    track: [...state.track, point],
    lastRecordedTrackPoint: point
  })),

  // Task Actions
  addTask: (task) => set((state) => ({
    tasks: [...state.tasks, task]
  })),

  removeTask: (taskId) => set((state) => {
    // Finde den Task der gelöscht wird
    const deletedTask = state.tasks.find(t => t.id === taskId)
    // Prüfe ob selectedGoal zu diesem Task gehört
    const selectedGoalBelongsToDeletedTask = deletedTask && state.selectedGoal &&
      deletedTask.goals.some(g => g.id === state.selectedGoal?.id)

    return {
      tasks: state.tasks.filter(t => t.id !== taskId),
      activeTask: state.activeTask?.id === taskId ? null : state.activeTask,
      selectedGoal: selectedGoalBelongsToDeletedTask ? null : state.selectedGoal
    }
  }),

  updateTask: (task) => set((state) => {
    // Finde das aktualisierte selectedGoal wenn es zu diesem Task gehört
    let updatedSelectedGoal = state.selectedGoal
    if (state.selectedGoal) {
      const goalInTask = task.goals.find(g => g.id === state.selectedGoal?.id)
      if (goalInTask) {
        updatedSelectedGoal = goalInTask
      }
    }

    return {
      tasks: state.tasks.map(t => t.id === task.id ? task : t),
      activeTask: state.activeTask?.id === task.id ? task : state.activeTask,
      selectedGoal: updatedSelectedGoal
    }
  }),

  setActiveTask: (task) => set((state) => ({
    activeTask: task,
    tasks: state.tasks.map(t => ({
      ...t,
      isActive: task ? t.id === task.id : false
    }))
  })),
  setSelectedGoal: (goal) => set({ selectedGoal: goal }),
  setGoalDragMode: (enabled) => set({ goalDragMode: enabled }),

  // Goal Position aktualisieren (für Drag & Drop und Pfeiltasten)
  updateGoalPosition: (goalId, lat, lon) => set((state) => {
    // Aktualisiere Goal in allen Tasks
    const updatedTasks = state.tasks.map(task => ({
      ...task,
      goals: task.goals.map(goal =>
        goal.id === goalId
          ? { ...goal, position: { ...goal.position, latitude: lat, longitude: lon } }
          : goal
      )
    }))

    // Aktualisiere auch activeTask und selectedGoal wenn betroffen
    let updatedActiveTask = state.activeTask
    let updatedSelectedGoal = state.selectedGoal

    if (state.activeTask) {
      updatedActiveTask = {
        ...state.activeTask,
        goals: state.activeTask.goals.map(goal =>
          goal.id === goalId
            ? { ...goal, position: { ...goal.position, latitude: lat, longitude: lon } }
            : goal
        )
      }
    }

    if (state.selectedGoal?.id === goalId) {
      updatedSelectedGoal = {
        ...state.selectedGoal,
        position: { ...state.selectedGoal.position, latitude: lat, longitude: lon }
      }
    }

    return {
      tasks: updatedTasks,
      activeTask: updatedActiveTask,
      selectedGoal: updatedSelectedGoal
    }
  }),

  // Marker Drop
  dropMarker: () => {
    const state = get()
    if (!state.gpsData) return null

    const marker: MarkerDrop = {
      id: crypto.randomUUID(),
      number: state.markers.length + 1,
      position: {
        latitude: state.gpsData.latitude,
        longitude: state.gpsData.longitude,
        altitude: state.gpsData.altitude,
        timestamp: new Date()
      },
      altitude: state.baroData?.pressureAltitude || state.gpsData.altitude,
      timestamp: new Date(),
      taskId: state.activeTask?.id
    }

    set((s) => ({ markers: [...s.markers, marker] }))

    // Log Point hinzufügen
    state.addLogPoint(`Marker ${marker.number} dropped`)

    return marker
  },

  // Marker entfernen
  removeMarker: (markerId: string) => {
    set((s) => {
      const filteredMarkers = s.markers.filter(m => m.id !== markerId)
      // Renummeriere die verbleibenden Marker
      const renumberedMarkers = filteredMarkers.map((m, index) => ({
        ...m,
        number: index + 1
      }))
      return { markers: renumberedMarkers }
    })
  },

  // Alle Marker löschen
  clearAllMarkers: () => {
    set({ markers: [] })
  },

  // Goal Declaration
  declareGoal: (goal) => {
    const state = get()
    if (!state.gpsData) return null

    const declaration: GoalDeclaration = {
      id: crypto.randomUUID(),
      number: state.declarations.length + 1,
      goal,
      declaredAt: new Date(),
      position: {
        latitude: state.gpsData.latitude,
        longitude: state.gpsData.longitude,
        altitude: state.gpsData.altitude,
        timestamp: new Date()
      },
      taskId: state.activeTask?.id
    }

    set((s) => ({ declarations: [...s.declarations, declaration] }))

    // Log Point hinzufügen
    state.addLogPoint(`Goal declared: ${goal.name}`)

    return declaration
  },

  // Wind Actions
  addWindLayer: (layer) => set((state) => ({
    windLayers: [...state.windLayers, layer].sort((a, b) => a.altitude - b.altitude)
  })),

  addWindLayers: (layers) => set((state) => {
    const merged = [...state.windLayers]
    for (const layer of layers) {
      const idx = merged.findIndex(l => l.altitude === layer.altitude)
      if (idx >= 0) merged[idx] = layer
      else merged.push(layer)
    }
    return { windLayers: merged.sort((a, b) => a.altitude - b.altitude) }
  }),

  replaceWindLayers: (layers) => set({
    windLayers: [...layers].sort((a, b) => a.altitude - b.altitude)
  }),

  updateWindLayer: (altitude, updates) => set((state) => ({
    windLayers: state.windLayers.map(layer =>
      layer.altitude === altitude ? { ...layer, ...updates } : layer
    ).sort((a, b) => a.altitude - b.altitude)
  })),

  removeWindLayer: (altitude) => set((state) => ({
    windLayers: state.windLayers.filter(layer => layer.altitude !== altitude)
  })),

  clearWindLayers: () => set({ windLayers: [] }),

  setSelectedWindLayer: (altitude) => set({ selectedWindLayer: altitude }),

  setWindSourceFilter: (filter) => {
    set({ windSourceFilter: filter })
    // Berechnungen mit neuem Filter neu triggern
    const state = get()
    if (state.showLandingPrediction) {
      state.updateLandingPrediction()
    }
    if (state.dropCalculator.active) {
      state.updateDropCalculator()
    }
  },

  // Waypoint Actions
  addWaypoint: (waypoint) => set((state) => ({
    waypoints: [...state.waypoints, waypoint]
  })),

  removeWaypoint: (id) => set((state) => ({
    waypoints: state.waypoints.filter(w => w.id !== id)
  })),

  // Log Point Action
  addLogPoint: (description) => {
    const state = get()
    if (!state.gpsData) return

    const logPoint: LogPoint = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      position: {
        latitude: state.gpsData.latitude,
        longitude: state.gpsData.longitude,
        altitude: state.gpsData.altitude,
        timestamp: new Date()
      },
      altitude: state.baroData?.pressureAltitude || state.gpsData.altitude,
      description,
      goalId: state.selectedGoal?.id,
      taskId: state.activeTask?.id
    }

    set((s) => ({ logPoints: [...s.logPoints, logPoint] }))
  },

      // HDG Course Actions
      setHdgCourseMode: (active, course, lineMode) => set((state) => ({
        hdgCourseMode: active,
        hdgPendingCourse: course ?? null,
        hdgPendingLineMode: lineMode ?? state.hdgPendingLineMode
      })),

      setHdgPendingLineMode: (mode) => set({ hdgPendingLineMode: mode }),

      addHdgCourseLine: (line) => {
        const state = get()
        // Max 3 Linien, älteste entfernen wenn voll
        const defaultColors = ['#f59e0b', '#3b82f6', '#22c55e']
        const colors = state.settings.hdgCourseLineColors || defaultColors
        const newLines = [...state.hdgCourseLines]
        if (newLines.length >= 3) {
          newLines.shift() // Älteste entfernen
        }
        const usedColors = newLines.map(l => l.color)
        const availableColor = colors.find(c => !usedColors.includes(c)) || colors[0]

        newLines.push({
          id: crypto.randomUUID(),
          startPosition: line.startPosition,
          course: line.course,
          color: availableColor,
          lineMode: line.lineMode
        })

        set({
          hdgCourseLines: newLines,
          hdgCourseMode: false,
          hdgPendingCourse: null
        })
      },

      updateHdgCourseLine: (id, updates) => set((state) => ({
        hdgCourseLines: state.hdgCourseLines.map(l =>
          l.id === id ? { ...l, ...updates } : l
        ),
        // Nach Position-Update: Editing-Mode beenden
        editingHdgCourseLineId: updates.startPosition ? null : state.editingHdgCourseLineId,
        hdgCourseMode: updates.startPosition ? false : state.hdgCourseMode
      })),

      setEditingHdgCourseLineId: (id) => set({
        editingHdgCourseLineId: id,
        hdgCourseMode: id !== null
      }),

      removeHdgCourseLine: (id) => set((state) => ({
        hdgCourseLines: state.hdgCourseLines.filter(l => l.id !== id)
      })),

      clearAllHdgCourseLines: () => set({
        hdgCourseMode: false,
        hdgPendingCourse: null,
        hdgCourseLines: []
      }),

      // Wind Line Actions
      setWindLineMode: (active, windLayer) => set({
        windLineMode: active,
        pendingWindLayer: windLayer ?? null
      }),

      addWindLine: (line) => {
        const state = get()
        // Max 3 Linien, älteste entfernen wenn voll
        const colors = ['#06b6d4', '#8b5cf6', '#10b981'] // Cyan, Violett, Grün
        const newLines = [...state.windLines]
        if (newLines.length >= 3) {
          newLines.shift() // Älteste entfernen
        }
        const usedColors = newLines.map(l => l.color)
        const availableColor = colors.find(c => !usedColors.includes(c)) || colors[0]

        newLines.push({
          id: crypto.randomUUID(),
          startPosition: line.startPosition,
          windLayer: line.windLayer,
          color: availableColor
        })

        set({
          windLines: newLines,
          windLineMode: false,
          pendingWindLayer: null
        })
      },

      removeWindLine: (id) => set((state) => ({
        windLines: state.windLines.filter(l => l.id !== id)
      })),

      clearAllWindLines: () => set({
        windLineMode: false,
        pendingWindLayer: null,
        windLines: []
      }),

      // Wind Import Position Actions
      setWindImportPickPosition: (active) => set({
        windImportPickPosition: active,
        ...(active ? {} : {}) // Position bleibt erhalten wenn deaktiviert
      }),
      setWindImportPosition: (pos) => set({
        windImportPosition: pos,
        windImportPickPosition: false // Pick-Modus beenden nach Auswahl
      }),

      // Scoring Area Actions
      addScoringArea: (area) => set((state) => ({
        scoringAreas: [...state.scoringAreas, {
          ...area,
          id: area.id || crypto.randomUUID(),
          visible: area.visible !== false
        }]
      })),

      removeScoringArea: (id) => set((state) => ({
        scoringAreas: state.scoringAreas.filter(a => a.id !== id)
      })),

      updateScoringArea: (id, updates) => set((state) => ({
        scoringAreas: state.scoringAreas.map(a =>
          a.id === id ? { ...a, ...updates } : a
        )
      })),

      clearAllScoringAreas: () => set({
        scoringAreas: []
      }),

      // Trajectory Actions
      addTrajectories: (trajectories) => set((state) => ({
        importedTrajectories: [...state.importedTrajectories, ...trajectories]
      })),

      removeTrajectory: (id) => set((state) => ({
        importedTrajectories: state.importedTrajectories.filter(t => t.id !== id)
      })),

      toggleTrajectoryVisibility: (id) => set((state) => ({
        importedTrajectories: state.importedTrajectories.map(t =>
          t.id === id ? { ...t, visible: !t.visible } : t
        )
      })),

      clearAllTrajectories: () => set({ importedTrajectories: [] }),

      // Competition Map Actions
      addCompetitionMap: (map) => set((state) => ({
        savedCompetitionMaps: [...state.savedCompetitionMaps, map]
      })),

      removeCompetitionMap: (id) => set((state) => ({
        savedCompetitionMaps: state.savedCompetitionMaps.filter(m => m.id !== id),
        activeCompetitionMap: state.activeCompetitionMap?.id === id ? null : state.activeCompetitionMap
      })),

      setActiveCompetitionMap: (map) => set({ activeCompetitionMap: map }),

      updateCompetitionMap: (id, updates) => set((state) => {
        const updatedMaps = state.savedCompetitionMaps.map(m =>
          m.id === id ? { ...m, ...updates } : m
        )
        // Auch activeCompetitionMap aktualisieren wenn es die gleiche ist
        const updatedActive = state.activeCompetitionMap?.id === id
          ? { ...state.activeCompetitionMap, ...updates }
          : state.activeCompetitionMap
        return {
          savedCompetitionMaps: updatedMaps,
          activeCompetitionMap: updatedActive
        }
      }),

      clearAllCompetitionMaps: () => set({
        savedCompetitionMaps: [],
        activeCompetitionMap: null
      }),

      // Championship Actions
      setActiveChampionship: (championship) => {
        if (championship) {
          // User-ID mitspeichern damit der Dialog nur für den richtigen User erscheint
          // useAuthStore ist top-level importiert
          const userId = useAuthStore.getState()?.user?.id
          set({ activeChampionship: { ...championship, userId: userId || undefined } })
        } else {
          set({ activeChampionship: null })
        }
      },

      // Backup Dialog Actions
      openBackupDialog: () => {
        const state = get()
        if (state.activeChampionship) {
          set({
            showBackupDialog: true,
            backupDialogChampionship: state.activeChampionship
          })
        }
      },
      closeBackupDialog: () => set({
        showBackupDialog: false,
        backupDialogChampionship: null
      }),

      // Prohibited Zone Actions
      setProhibitedZones: (zones) => set({ prohibitedZones: zones }),

      addProhibitedZones: (zones) => set((state) => ({
        prohibitedZones: [...state.prohibitedZones, ...zones]
      })),

      clearProhibitedZones: () => set({ prohibitedZones: [] }),

      toggleShowProhibitedZones: () => set((state) => ({
        showProhibitedZones: !state.showProhibitedZones
      })),

      // PZ Draw Mode Actions
      startPzDrawMode: () => set({ pzDrawMode: true, pzDrawPoints: [] }),

      stopPzDrawMode: () => set({ pzDrawMode: false, pzDrawPoints: [] }),

      addPzDrawPoint: (point: { lat: number; lon: number }) => set((state) => ({
        pzDrawPoints: [...state.pzDrawPoints, point]
      })),

      removePzDrawPoint: () => set((state) => ({
        pzDrawPoints: state.pzDrawPoints.slice(0, -1)
      })),

      finishPzDraw: (name: string, elevation?: number, closed?: boolean, isTrack?: boolean, radius?: number) => {
        const state = get()
        if (state.pzDrawPoints.length === 0) return

        // Einzelpunkt-Modus (1-2 Punkte): PZ-Punkt mit optionalem Radius
        if (state.pzDrawPoints.length < 3) {
          const point = state.pzDrawPoints[0]
          const newPZ: ProhibitedZone = {
            id: `pz-draw-${Date.now()}`,
            name: name || 'Neues Sperrgebiet',
            lat: point.lat,
            lon: point.lon,
            elevation: elevation,
            radius: radius,
            fillOpacity: 0.15
          }
          set({
            prohibitedZones: [...state.prohibitedZones, newPZ],
            pzDrawMode: false,
            pzDrawPoints: []
          })
          return
        }

        // Polygon-Modus (3+ Punkte)
        const sumLat = state.pzDrawPoints.reduce((sum, p) => sum + p.lat, 0)
        const sumLon = state.pzDrawPoints.reduce((sum, p) => sum + p.lon, 0)
        const centerLat = sumLat / state.pzDrawPoints.length
        const centerLon = sumLon / state.pzDrawPoints.length

        const newPZ: ProhibitedZone = {
          id: `pz-draw-${Date.now()}`,
          name: name || 'Neues Sperrgebiet',
          lat: centerLat,
          lon: centerLon,
          elevation: elevation,
          type: 'polygon',
          polygon: [...state.pzDrawPoints],
          closed: closed === false ? false : undefined,
          fillOpacity: closed === false ? 0 : 0.15,
          sourceType: isTrack ? 'track' : undefined
        }

        set({
          prohibitedZones: [...state.prohibitedZones, newPZ],
          pzDrawMode: false,
          pzDrawPoints: []
        })
      },

      // Active Maps Actions - nur EINE Karte kann aktiv sein
      toggleActiveMap: async (mapId, active) => {
        const state = get()
        if (active) {
          // Finde die Karte in savedCompetitionMaps und setze sie als aktiv
          const map = state.savedCompetitionMaps.find(m => m.id === mapId)
          set({
            activeMaps: [mapId],
            activeCompetitionMap: map || null
          })

          // Automatisch zugehörige Championship laden
          console.log('[FlightStore] Suche Championship für map_id:', mapId)
          try {
            const { data: championships, error } = await supabase
              .from('championships')
              .select('id, name, map_id')
              .eq('map_id', mapId)
              .limit(1)

            console.log('[FlightStore] Supabase Antwort:', { championships, error })

            if (championships && championships.length > 0) {
              // useAuthStore ist top-level importiert
              const userId = useAuthStore.getState()?.user?.id
              set({ activeChampionship: { id: championships[0].id, name: championships[0].name, userId: userId || undefined } })
              console.log('[FlightStore] Championship automatisch erkannt:', championships[0].name)
            } else {
              console.log('[FlightStore] Keine Championship mit dieser map_id gefunden')
              set({ activeChampionship: null })
            }
          } catch (err) {
            console.error('[FlightStore] Fehler beim Laden der Championship:', err)
            set({ activeChampionship: null })
          }
        } else {
          // Entfernen
          set({
            activeMaps: [],
            activeCompetitionMap: null,
            activeChampionship: null
          })
        }
      },

      setActiveMaps: (mapIds) => set({ activeMaps: mapIds }),

      // Championship Actions
      getFlightSnapshot: () => {
        const state = get()
        return {
          tasks: state.tasks,
          track: state.track,
          trackLine: state.trackLine,
          markers: state.markers,
          declarations: state.declarations,
          logPoints: state.logPoints,
          hdgCourseLines: state.hdgCourseLines,
          windLines: state.windLines,
          windLayers: state.windLayers,
          scoringAreas: state.scoringAreas,
          importedTrajectories: state.importedTrajectories,
          savedAt: new Date().toISOString()
        }
      },

      loadFlightData: (data) => {
        const d = (v: any): Date => v instanceof Date ? v : new Date(v)

        const tasks = (data.tasks || []).map((t: any) => ({
          ...t,
          completedAt: t.completedAt ? d(t.completedAt) : undefined,
          goals: (t.goals || []).map((g: any) => ({
            ...g,
            position: { ...g.position, timestamp: g.position?.timestamp ? d(g.position.timestamp) : new Date() },
            declaredAt: g.declaredAt ? d(g.declaredAt) : undefined
          }))
        }))

        const track = (data.track || []).map((tp: any) => ({
          ...tp,
          position: { ...tp.position, timestamp: tp.position?.timestamp ? d(tp.position.timestamp) : new Date() },
          baro: tp.baro ? { ...tp.baro, timestamp: tp.baro.timestamp ? d(tp.baro.timestamp) : new Date() } : tp.baro,
          timestamp: d(tp.timestamp)
        }))

        const markers = (data.markers || []).map((m: any) => ({
          ...m,
          position: { ...m.position, timestamp: m.position?.timestamp ? d(m.position.timestamp) : new Date() },
          timestamp: d(m.timestamp)
        }))

        const declarations = (data.declarations || []).map((decl: any) => ({
          ...decl,
          declaredAt: d(decl.declaredAt),
          position: { ...decl.position, timestamp: decl.position?.timestamp ? d(decl.position.timestamp) : new Date() },
          goal: decl.goal ? {
            ...decl.goal,
            position: { ...decl.goal.position, timestamp: decl.goal.position?.timestamp ? d(decl.goal.position.timestamp) : new Date() },
            declaredAt: decl.goal.declaredAt ? d(decl.goal.declaredAt) : undefined
          } : decl.goal
        }))

        const logPoints = (data.logPoints || []).map((lp: any) => ({
          ...lp,
          timestamp: d(lp.timestamp),
          position: { ...lp.position, timestamp: lp.position?.timestamp ? d(lp.position.timestamp) : new Date() }
        }))

        const windLayers = (data.windLayers || []).map((wl: any) => ({
          ...wl,
          timestamp: d(wl.timestamp)
        }))

        set({
          tasks,
          track,
          trackLine: data.trackLine || [],
          markers,
          declarations,
          logPoints,
          hdgCourseLines: data.hdgCourseLines || [],
          windLines: data.windLines || [],
          windLayers,
          scoringAreas: data.scoringAreas || [],
          importedTrajectories: data.importedTrajectories || [],
          activeTask: null,
          selectedGoal: null
        })
      },

      clearFlightData: () => {
        set({
          tasks: [],
          track: [],
          trackLine: [],
          markers: [],
          declarations: [],
          logPoints: [],
          hdgCourseLines: [],
          windLines: [],
          windLayers: [],
          scoringAreas: [],
          importedTrajectories: [],
          activeTask: null,
          selectedGoal: null,
          flight: null,
          isRecording: false,
          lastRecordedTrackPoint: null,
          recordingStartTime: null
        })
      },

      // Settings Actions
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      }))
    }),
    {
      name: 'nta-flight-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        // Nur diese Felder werden persistiert
        tasks: state.tasks,
        waypoints: state.waypoints,
        settings: state.settings,
        windLines: state.windLines,
        savedCompetitionMaps: state.savedCompetitionMaps,
        activeCompetitionMap: state.activeCompetitionMap,
        // PZ werden lokal gespeichert für Offline-Nutzung
        prohibitedZones: state.prohibitedZones,
        showProhibitedZones: state.showProhibitedZones,
        // Aktive Karten (OZI/Championship) persistieren
        activeMaps: state.activeMaps,
        // Scoring Areas persistieren
        scoringAreas: state.scoringAreas,
        // HDG Course Lines persistieren
        hdgCourseLines: state.hdgCourseLines,
        // Importierte Trajektorien persistieren
        importedTrajectories: state.importedTrajectories,
        // Windschichten persistieren
        windLayers: state.windLayers,
        // Wind-Quellen-Filter persistieren
        windSourceFilter: state.windSourceFilter,
        // Landeprognose Sinkrate persistieren
        landingSinkRate: state.landingSinkRate,
        // Drop Calculator Settings persistieren
        dropCalculatorMarkerSinkRate: state.dropCalculator.markerSinkRate,
        // Aktive Meisterschaft persistieren
        activeChampionship: state.activeChampionship,
        // Flugaufzeichnung persistieren (Track/TrackLine in IndexedDB, nicht localStorage)
        flight: state.flight,
        markers: state.markers,
        declarations: state.declarations,
        logPoints: state.logPoints,
      }),
      // Merge: Settings beim Laden validieren und korrigieren
      merge: (persistedState: any, currentState: FlightState) => {
        const merged = { ...currentState, ...persistedState }

        // Wind Interval validieren: muss zu Einheit passen
        if (merged.settings) {
          const unit = merged.settings.windAltitudeUnit || 'ft'
          const interval = merged.settings.windLayerInterval

          // Gültige Intervalle für ft: 100, 200, 500, 1000
          // Gültige Intervalle für m: 50, 100, 200, 500
          const validFtIntervals = [100, 200, 500, 1000]
          const validMIntervals = [50, 100, 200, 500]

          if (unit === 'ft' && !validFtIntervals.includes(interval)) {
            // Ungültiges ft Intervall - auf 100ft setzen
            merged.settings = { ...merged.settings, windLayerInterval: 100 }
          } else if (unit === 'm' && !validMIntervals.includes(interval)) {
            // Ungültiges m Intervall - auf 50m setzen
            merged.settings = { ...merged.settings, windLayerInterval: 50 }
          }
        }

        // activeCompetitionMap aus activeMaps rekonstruieren beim App-Start
        // (wie OZI Explorer - die aktive Karte bestimmt die UTM-Base für Tasksheet-Import)
        if (merged.activeMaps && merged.activeMaps.length > 0 && merged.savedCompetitionMaps) {
          const activeMapId = merged.activeMaps[0]
          const activeMap = merged.savedCompetitionMaps.find((m: any) => m.id === activeMapId)
          if (activeMap) {
            merged.activeCompetitionMap = activeMap
          }
        }

        // Drop Calculator Settings wiederherstellen
        if (persistedState.dropCalculatorMarkerSinkRate) {
          merged.dropCalculator = { ...merged.dropCalculator, markerSinkRate: persistedState.dropCalculatorMarkerSinkRate }
        }

        // Wind-Quellen-Filter wiederherstellen
        if (persistedState.windSourceFilter) {
          merged.windSourceFilter = persistedState.windSourceFilter
        }

        return merged
      },
    }
  )
)

// IndexedDB: Track-Daten beim Start laden
loadTrackData().then(({ track, trackLine }) => {
  const state = useFlightStore.getState()
  // Nur laden wenn noch leer (nicht überschreiben wenn Recording bereits läuft)
  if (state.track.length === 0 && track.length > 0) {
    useFlightStore.setState({ track, trackLine })
  }
})

// Landeprognose: Versions-Counter gegen Race Conditions
let lpVersion = 0

// Landeprognose: Update nur wenn sich relevante Daten geändert haben
let lpLastSinkRate: number = 0
let lpLastWindHash: string = ''
let lpLastAltBucket: number = 0
let lpLastLatBucket: number = 0
let lpLastLonBucket: number = 0
let lpLastFilter: WindSourceFilter = 'all'
let lpTimer: ReturnType<typeof setTimeout> | null = null

function getWindHash(layers: { altitude: number; direction: number; speed: number }[]): string {
  return layers.map(l => `${l.altitude}:${Math.round(l.direction)}:${Math.round(l.speed * 10)}`).join('|')
}

// Windschichten nach aktuellem Filter filtern (fuer Berechnungen)
function getFilteredWindLayers(state: { windLayers: WindLayer[]; windSourceFilter: WindSourceFilter }): WindLayer[] {
  const { windLayers, windSourceFilter } = state
  if (windSourceFilter === 'all') return windLayers
  if (windSourceFilter === 'forecast') return windLayers.filter(l => l.source === WindSource.Forecast)
  if (windSourceFilter === 'measured') return windLayers.filter(l => l.source === WindSource.Measured)
  if (windSourceFilter === 'sounding') return windLayers.filter(l => l.source === WindSource.Windsond || l.source === WindSource.Pibal)
  return windLayers
}

useFlightStore.subscribe((state) => {
  if (!state.showLandingPrediction) {
    // Reset bei Deaktivierung
    lpLastSinkRate = 0
    lpLastWindHash = ''
    lpLastAltBucket = 0
    lpLastLatBucket = 0
    lpLastLonBucket = 0
    lpLastFilter = 'all'
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
    return
  }

  // Prüfe ob sich etwas Relevantes geändert hat
  const alt = state.baroData?.pressureAltitude || state.gpsData?.altitude || 0
  const altBucket = Math.round(alt / 10) // 10m Schritte (feiner für stabilere LP)
  const latBucket = state.gpsData ? Math.round(state.gpsData.latitude * 10000) : 0  // ~11m Auflösung
  const lonBucket = state.gpsData ? Math.round(state.gpsData.longitude * 10000) : 0
  const windHash = getWindHash(getFilteredWindLayers(state))
  const sinkRate = state.landingSinkRate
  const filter = state.windSourceFilter

  const changed =
    sinkRate !== lpLastSinkRate ||
    windHash !== lpLastWindHash ||
    altBucket !== lpLastAltBucket ||
    latBucket !== lpLastLatBucket ||
    lonBucket !== lpLastLonBucket ||
    filter !== lpLastFilter

  if (!changed) return

  lpLastSinkRate = sinkRate
  lpLastWindHash = windHash
  lpLastAltBucket = altBucket
  lpLastLatBucket = latBucket
  lpLastLonBucket = lonBucket
  lpLastFilter = filter

  // Throttle statt Debounce: Sofort feuern, dann 500ms Pause
  if (!lpTimer) {
    useFlightStore.getState().updateLandingPrediction()
    lpTimer = setTimeout(() => {
      lpTimer = null
    }, 500)
  }
})

// Drop Calculator: Update bei Position/Höhe/Wind-Änderung
let dcLastWindHash: string = ''
let dcLastAltBucket: number = 0
let dcLastLatBucket: number = 0
let dcLastLonBucket: number = 0
let dcLastSinkRate: number = 0
let dcLastGoalId: string | null = null
let dcLastFilter: WindSourceFilter = 'all'
let dcTimer: ReturnType<typeof setTimeout> | null = null
let dcRunning = false  // Concurrency-Guard: nur eine Berechnung gleichzeitig

useFlightStore.subscribe((state) => {
  if (!state.dropCalculator.active) {
    dcLastWindHash = ''
    dcLastAltBucket = 0
    dcLastLatBucket = 0
    dcLastLonBucket = 0
    dcLastSinkRate = 0
    dcLastGoalId = null
    dcLastFilter = 'all'
    if (dcTimer) { clearTimeout(dcTimer); dcTimer = null }
    return
  }

  const alt = state.baroData?.pressureAltitude || state.gpsData?.altitude || 0
  const altBucket = Math.round(alt / 10)
  const latBucket = state.gpsData ? Math.round(state.gpsData.latitude * 100000) : 0
  const lonBucket = state.gpsData ? Math.round(state.gpsData.longitude * 100000) : 0
  const windHash = getWindHash(getFilteredWindLayers(state))
  const sinkRate = state.dropCalculator.markerSinkRate
  const goalId = state.selectedGoal?.id || null
  const filter = state.windSourceFilter

  const changed =
    sinkRate !== dcLastSinkRate ||
    windHash !== dcLastWindHash ||
    altBucket !== dcLastAltBucket ||
    latBucket !== dcLastLatBucket ||
    lonBucket !== dcLastLonBucket ||
    goalId !== dcLastGoalId ||
    filter !== dcLastFilter

  if (!changed) return

  dcLastSinkRate = sinkRate
  dcLastWindHash = windHash
  dcLastAltBucket = altBucket
  dcLastLatBucket = latBucket
  dcLastLonBucket = lonBucket
  dcLastGoalId = goalId
  dcLastFilter = filter

  // Throttle statt Debounce: Sofort feuern wenn kein Timer läuft,
  // sonst nächsten Aufruf nach 200ms einplanen
  if (!dcTimer) {
    console.log(`[DropCalc-Sub] THROTTLE FIRE (sofort)`)
    useFlightStore.getState().updateDropCalculator()
    dcTimer = setTimeout(() => {
      dcTimer = null
    }, 200)
  }
})

// IndexedDB: Track-Daten debounced speichern bei Änderungen
let trackSaveTimer: ReturnType<typeof setTimeout> | null = null
let lastTrackRef: any[] = []
let lastTrackLineRef: [number, number][] = []
useFlightStore.subscribe((state) => {
  if (state.track !== lastTrackRef || state.trackLine !== lastTrackLineRef) {
    lastTrackRef = state.track
    lastTrackLineRef = state.trackLine
    if (trackSaveTimer) clearTimeout(trackSaveTimer)
    trackSaveTimer = setTimeout(() => {
      saveTrackData(state.track, state.trackLine)
    }, 2000) // Alle 2 Sekunden maximal speichern
  }
})
