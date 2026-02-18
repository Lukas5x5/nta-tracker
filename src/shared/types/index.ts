// ============================================
// NTA - Navigation Tool Austria
// Gemeinsame Typdefinitionen
// ============================================

// GPS & Navigation
// ============================================

export interface GPSPosition {
  latitude: number
  longitude: number
  altitude: number // MSL in Metern
  timestamp: Date
}

export interface GPSData extends GPSPosition {
  speed: number // km/h
  heading: number // Grad (0-360)
  satellites: number
  hdop: number
  fix: GPSFix
}

export enum GPSFix {
  NoFix = 0,
  GPS = 1,
  DGPS = 2,
  PPS = 3,
  RTK = 4,
  FloatRTK = 5
}

export interface BaroData {
  pressureAltitude: number // Druckhöhe in Metern
  qnh: number // hPa
  variometer: number // m/s (positiv = steigen)
  timestamp: Date
}

export interface NavigationData {
  gps: GPSData
  baro: BaroData
  agl: number // Height Above Ground Level
  groundElevation: number // Geländehöhe unter dem Ballon
}

// Wettbewerbs-Tasks
// ============================================

export enum TaskType {
  PDG = 'PDG', // Pilot Declared Goal
  JDG = 'JDG', // Judge Declared Goal
  HWZ = 'HWZ', // Hesitation Waltz
  FIN = 'FIN', // Fly In
  FON = 'FON', // Fly On
  HNH = 'HNH', // Hare and Hounds
  WSD = 'WSD', // Watership Down
  GBM = 'GBM', // Gordon Bennett Memorial
  ELB = 'ELB', // Elbow
  MDD = 'MDD', // Minimum Distance Double Drop
  MDT = 'MDT', // Minimum Distance
  CRT = 'CRT', // Calculated Rate of Approach Task
  RTA = 'RTA', // Race to Area
  LRN = 'LRN', // Land Run
  XDI = 'XDI', // Maximum Distance
  XDT = 'XDT', // Maximum Distance Time
  XDD = 'XDD', // Maximum Distance Double Drop
  ANG = 'ANG', // Angle Task
  SFL = 'SFL', // Shortest Flight
  LTT = 'LTT', // Least Time Task
  MTT = 'MTT', // Most Time Task
  ThreeD = '3D',  // 3D Tasks
  APT = 'APT',  // Altitude Profile Task
}

export interface Task {
  id: string
  type: TaskType
  name: string
  description?: string

  // Ziel(e)
  goals: Goal[]

  // Task Rings (min/max Distanzen) - Legacy für alte Tasks
  minDistance?: number
  maxDistance?: number

  // Task Rings (alle 4 Ringe in Meter)
  rings?: number[]  // Array von 1-4 Ringen in Metern

  // Scoring Area
  scoringArea?: ScoringArea

  // MMA (Marker Measurement Area) Radius
  mmaRadius?: number  // typisch 100m, 200m
  mmaDashed?: boolean  // MMA gestrichelt anzeigen
  mmaLineColor?: string  // Farbe der MMA-Linie (default: '#ffffff')
  mmaFillColor?: string  // Farbe der MMA-Füllung (default: '#ffffff')
  mmaFillDashed?: boolean  // Füllung auch gestrichelt anzeigen

  // Multi-Marker Support (für Tasks mit mehreren Drops)
  markerCount?: number  // Anzahl der Marker (1-3, default: 1)
  markerColors?: string[]  // Farben für jeden Marker (z.B. ['#ef4444', '#22c55e', '#3b82f6'])

  // Task Endzeit und Erinnerung
  endsAt?: string  // UTC Zeit im Format "HH:MM" (z.B. "07:00")
  reminderEnabled?: boolean  // Erinnerung vor Taskende aktiviert
  reminderValue?: number  // Individuelle Erinnerungszeit (überschreibt globale Einstellung)
  reminderUnit?: 'minutes' | 'seconds'  // Einheit der Erinnerungszeit

  // Task Darstellung
  taskNumber?: string  // z.B. "T1", "T25"
  markerColor?: string  // Hex-Farbe für den Marker
  loggerId?: string  // Logger Marker ID (LM) für digitalen Logger
  loggerGoalId?: string  // Logger Goal ID (LG) für digitalen Logger

  // 3D Task spezifisch
  minAltitude?: number
  maxAltitude?: number
  altitudeReference?: 'MSL' | 'AGL' | 'QNH'

  // Referenzpunkt (für XDI, MDT, SFL, etc.)
  referencePoint?: GPSPosition

  // Zeit Limits
  minTime?: number  // Sekunden
  maxTime?: number  // Sekunden

  // Angle Task spezifisch
  setDirection?: number  // Grad (0-360)

  // Declaration Settings
  declarationRequired?: boolean
  maxDeclarations?: number

  // APT (Altitude Profile Task) spezifisch
  aptProfile?: {
    points: { timeMinutes: number; altitudeFt: number }[]
    layerAFt: number   // Layer A Toleranz in Feet (z.B. 50)
    layerBFt: number   // Layer B Toleranz in Feet (z.B. 100)
    isDefault?: boolean  // true = Default-Punkte (Profil aus Diagramm manuell eintragen)
  }

  // Status
  isActive: boolean
  completedAt?: Date
}

export interface Goal {
  id: string
  name: string
  description?: string // Optionale Beschreibung des Ziels
  position: GPSPosition
  radius: number // Zielradius in Metern

  // Goal Typ
  type: GoalType
  declaredBy: 'pilot' | 'judge'
  declaredAt?: Date

  // Für HWZ: mehrere Ziele zur Auswahl
  isSelected?: boolean
}

export enum GoalType {
  Ground = 'ground',
  Air3D = '3d'
}

export interface ScoringArea {
  id?: string // Eindeutige ID für die Scoring Area
  type: 'circle' | 'polygon' | 'sector'
  center?: GPSPosition
  radius?: number // in Metern
  points?: GPSPosition[] // Für Polygon
  startAngle?: number // Für Sektor (Grad, 0-360)
  endAngle?: number // Für Sektor (Grad, 0-360)
  color?: string // Linienfarbe
  fillColor?: string // Füllfarbe
  visible?: boolean // Sichtbarkeit auf der Karte
  name?: string // Optionaler Name
}

// Marker & Declarations
// ============================================

export interface MarkerDrop {
  id: string
  number: number // 1-18
  position: GPSPosition
  altitude: number
  timestamp: Date
  taskId?: string
  notes?: string
}

export interface GoalDeclaration {
  id: string
  number: number // 1-18
  goal: Goal
  declaredAt: Date
  position: GPSPosition // Position bei Deklaration
  taskId?: string
}

// Wind Daten
// ============================================

export interface WindLayer {
  altitude: number // Meter
  direction: number // Grad (woher der Wind kommt)
  speed: number // m/s oder km/h
  timestamp: Date
  source: WindSource
  isStable?: boolean // true wenn >8 Sekunden stabil gemessen (Vario < 2m/s)
  stableSince?: Date // Zeitpunkt ab dem der Wind stabil ist
  vario?: number // m/s - Steig-/Sinkrate zum Zeitpunkt der Messung (für Stabilitätsanzeige)
}

export enum WindSource {
  Measured = 'measured', // Während des Flugs gemessen
  Pibal = 'pibal', // Pilotballon Messung
  Windsond = 'windsond', // Windsond Daten
  Forecast = 'forecast', // Vorhersage
  Manual = 'manual', // Manuell eingegeben
  Calculated = 'calculated' // Interpoliert/berechnet
}

// Wind-Quellen-Filter fuer Berechnungen
export type WindSourceFilter = 'all' | 'forecast' | 'measured' | 'sounding'

export interface WindProfile {
  layers: WindLayer[]
  measuredAt: Date
  location?: GPSPosition
}

// Flug & Aufzeichnung
// ============================================

export interface Flight {
  id: string
  startTime: Date
  endTime?: Date

  // Track
  track: TrackPoint[]

  // Markers & Goals
  markers: MarkerDrop[]
  declarations: GoalDeclaration[]

  // Tasks
  tasks: Task[]

  // Wind
  windProfile?: WindProfile

  // Metadaten
  pilot: string
  balloon?: string
  competition?: string
  notes?: string
}

export interface TrackPoint {
  position: GPSPosition
  baro: BaroData
  timestamp: Date
  // Erweiterte Metadaten
  speed?: number  // Geschwindigkeit in m/s
  heading?: number  // Kurs in Grad (0-360)
  verticalSpeed?: number  // Vertikalgeschwindigkeit in m/s
  distance?: number  // Distanz vom letzten Punkt in Metern
  timeFromStart?: number  // Zeit seit Start in Sekunden
  recordingReason?: 'time' | 'distance' | 'significant'  // Grund der Aufzeichnung
}

export interface FlightReport {
  flight: Flight
  logPoints: LogPoint[]
  exportedAt: Date
}

export interface LogPoint {
  id: string
  timestamp: Date
  position: GPSPosition
  altitude: number
  description: string
  goalId?: string
  taskId?: string
}

// Waypoints & Karte
// ============================================

export interface Waypoint {
  id: string
  name: string
  position: GPSPosition
  type: WaypointType
  description?: string
  elevation?: number
}

export enum WaypointType {
  Target = 'target',
  Landmark = 'landmark',
  Airfield = 'airfield',
  Obstacle = 'obstacle',
  Custom = 'custom'
}

export interface MapSettings {
  centerPosition: GPSPosition
  zoom: number
  showTrack: boolean
  showWaypoints: boolean
  showTaskRings: boolean
  showScoringAreas: boolean
  showWindLayers: boolean
  showGridLines: boolean
  offlineMaps: boolean
}

// Bluetooth / Sensor
// ============================================

export interface BluetoothDevice {
  id: string
  name: string
  rssi: number
  connected: boolean
  batteryLevel?: number
}

export enum ConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error'
}

// Einstellungen
// ============================================

export interface AppSettings {
  // Einheiten
  altitudeUnit: 'meters' | 'feet'
  speedUnit: 'kmh' | 'knots' | 'mph' | 'ms'
  distanceUnit: 'meters' | 'feet' | 'nm'
  variometerUnit: 'ms' | 'fpm'
  pressureUnit: 'hPa' | 'inHg'

  // QNH
  qnh: number

  // Koordinaten Format (WGS84 basiert)
  coordinateFormat: 'decimal' | 'dms' | 'dm' | 'utm' | 'mgrs4' | 'mgrs45' | 'mgrs54' | 'mgrs5' | 'mgrs6'
  // DEPRECATED: utm4, utm5, utm6, utm8 - verwende stattdessen 'utm' oder 'mgrs4/5/6'
  utmZone: number  // z.B. 33 für Österreich (wird automatisch berechnet)
  utmBand: string  // Latitude Band (C-X ohne I und O), z.B. 'U' für Österreich
  utmBaseEasting: number  // Legacy: Basis für Grid Reference (z.B. 500000)
  utmBaseNorthing: number  // Legacy: Basis für Grid Reference (z.B. 5300000)

  // Anzeige
  displayFields: DisplayField[]
  fontSize: 'small' | 'medium' | 'large'
  theme: 'light' | 'dark' | 'auto'

  // Audio
  audioAlerts: boolean
  variometerAudio: boolean
  variometerVolume: number  // Lautstärke 0-1
  variometerClimbThreshold: number  // Steigrate ab der Ton beginnt (m/s), z.B. 0.5
  variometerSinkThreshold: number  // Sinkrate ab der Ton beginnt (m/s), z.B. -1.0
  variometerClimbFreqMin: number  // Minimale Frequenz für Steigen (Hz), z.B. 400
  variometerClimbFreqMax: number  // Maximale Frequenz für Steigen (Hz), z.B. 1200
  variometerSinkFreqMin: number  // Minimale Frequenz für Sinken (Hz), z.B. 200
  variometerSinkFreqMax: number  // Maximale Frequenz für Sinken (Hz), z.B. 400

  // Navigationslinie
  navLineColor: string  // Farbe der Navigationslinie (z.B. '#22c55e')
  navLineWidth: number  // Breite in Pixel (z.B. 3, 5, 8)
  navLineEnabled: boolean  // Navigationslinie anzeigen (default: true)
  navLineShowCourse: boolean  // Kurs-Anzeige entlang der Linie (default: false)
  navLineCourseHideDistance?: number  // Entfernung in Metern ab der das Kurs-Badge ausgeblendet wird (0 = nie ausblenden, default: 0)

  // Navigations-Panel Position & Felder
  navPanelPosition: { x: number; y: number }  // Position auf dem Bildschirm
  navPanelFields: NavPanelField[]  // Konfigurierbare Felder

  // Wind Einstellungen
  windLayerInterval: number  // Höhenintervall für Windschichten in Metern (25, 50, 100, 200 oder entsprechend in ft: 30, 61, 152, 305)
  windSpeedUnit: 'kmh' | 'ms'  // Windgeschwindigkeit in km/h oder m/s
  windDirectionMode: 'from' | 'to'  // Wind kommt VON (from) oder geht ZU (to)
  windAltitudeUnit: 'm' | 'ft'  // Höhenanzeige in Metern oder Fuß

  // Track Recording Einstellungen
  trackRecordingMode: 'time' | 'distance' | 'smart'  // Aufzeichnungsmodus
  trackRecordingTimeInterval: number  // Zeitintervall in Sekunden (z.B. 1, 5, 10)
  trackRecordingDistanceInterval: number  // Distanzintervall in Metern (z.B. 1, 5, 10, 50)
  trackPointMarkers: boolean  // Trackpunkte auf Karte anzeigen
  trackLineColor: string  // Farbe der Tracklinie
  trackLineWidth: number  // Breite der Tracklinie in Pixel

  // Positionsmarker Einstellungen
  balloonMarkerSize: 'small' | 'medium' | 'large'  // Größe des Ballonmarkers
  balloonMarkerIcon: 'arrow' | 'triangle' | 'dart' | 'pointer'  // Pfeil-Stil
  balloonMarkerColor: string  // Farbe des Positionsmarkers
  balloonHeadingLine: boolean  // Heading-Linie anzeigen
  balloonHeadingLineLength: number  // Länge der Heading-Linie in Metern
  balloonHeadingLineColor: string  // Farbe der Heading-Linie
  balloonHeadingLineWidth: number  // Stärke der Heading-Linie

  // Briefing Panel Position
  briefingPanelPosition?: { x: number; y: number }

  // Drawing Panel Position
  drawingPanelPosition?: { x: number; y: number }

  // Grid Snapping Origin (UTM) - Verkürzte 4-stellige Grid-Referenz
  gridOriginEasting?: number  // z.B. 2300 - kombiniert mit utmBaseEasting ergibt volle Koordinate
  gridOriginNorthing?: number  // z.B. 1700 - kombiniert mit utmBaseNorthing ergibt volle Koordinate

  // MMA Einstellungen
  defaultMmaRadius: number  // Standard MMA-Radius in Metern (0-500)
  defaultMmaLineColor: string  // Standard Farbe der MMA-Linie
  mmaBorderDashed: boolean  // Rand gestrichelt (true) oder durchgezogen (false)
  mmaFillEnabled: boolean  // Füllung aktivieren
  defaultMmaFillColor: string  // Standard Farbe der MMA-Füllung
  mmaFillDashed: boolean  // Füllung gestrichelt anzeigen
  // Legacy (für Kompatibilität)
  mmaDashedFilled?: boolean

  // Kreuz Icon Einstellungen
  crossIconColor: string  // Farbe des Kreuzes (default: '#000000')
  crossIconSize: number  // Größe des Kreuzes in Pixel (default: 24)
  crossIconStrokeWidth: number  // Strichstärke des Kreuzes (default: 3)

  // Task Label Einstellungen (Anzeige auf der Karte)
  taskLabelFontSize: number  // Schriftgröße in Pixel (default: 14)
  taskLabelPadding: number  // Padding in Pixel (default: 6)
  taskLabelPrefix: string  // Prefix vor der Task-Nummer (default: 'Task')
  loggerLabelPrefix: string  // Prefix vor der Logger-ID im Badge (default: 'LM')
  loggerBadgeColor: string  // Farbe des LM-Badges (default: '#10b981')
  loggerBadgeFontSize: number  // Schriftgröße des LM-Badges (default: 11)
  loggerGoalLabelPrefix?: string  // Prefix vor der Logger-Goal-ID im Badge (default: 'LG')
  loggerGoalBadgeColor?: string  // Farbe des LG-Badges (default: '#f59e0b')
  loggerGoalBadgeFontSize?: number  // Schriftgröße des LG-Badges (default: 11)

  // Drawing Colors
  drawingLineColor: string  // Linienfarbe für Zeichnungen (default: '#3b82f6')
  drawingFillColor: string  // Füllfarbe für Zeichnungen (default: '#3b82f6')

  // Measure Tool Settings
  measureColor: string  // Farbe für Distanz- und Flächenmessung (default: '#22c55e')

  // Tile-Server Einstellungen (für eigenen Server)
  customTileServerUrl?: string  // URL zum eigenen Tile-Server (z.B. https://tiles.example.com/{z}/{x}/{y}.png)
  useCustomTileServer?: boolean  // Eigenen Tile-Server verwenden statt OSM

  // Grid Einstellungen
  showGrid?: boolean  // UTM Grid auf Karte anzeigen
  gridSize?: number  // Grid-Größe in Metern (50, 100, 200, 500, 1000, 2000)
  showGridLabels?: boolean  // UTM Koordinaten an Gridlinien anzeigen
  gridLineColor?: string  // Farbe der Gridlinien (default: '#3b82f6')
  gridLineWidth?: number  // Breite der Gridlinien in Pixel (1-5, default: 1)
  gridLineOpacity?: number  // Transparenz der Gridlinien (0.1-1.0, default: 0.6)
  gridLineDashed?: boolean  // Gestrichelte Linien (default: true)
  gridLabelColor?: string  // Farbe der Grid-Labels (default: '#1e40af')
  gridLabelSize?: number  // Schriftgröße der Labels (8-14, default: 10)
  gridLabelBackground?: string  // Hintergrundfarbe der Labels (default: 'rgba(255,255,255,0.85)')

  // PZ (Prohibited Zones) Einstellungen
  pzLabelSize?: number  // Schriftgröße der PZ-Labels (8-14, default: 11)
  pzLabelColor?: string  // Schriftfarbe der PZ-Labels (default: '#ffffff')
  pzLabelBackground?: string  // Hintergrundfarbe der PZ-Labels (default: 'rgba(239, 68, 68, 0.95)')
  pzCircleColor?: string  // Farbe der PZ-Kreise (default: '#ef4444')
  pzCircleOpacity?: number  // Transparenz der PZ-Kreisfüllung (0.0-1.0, default: 0.15)
  pzCircleDashed?: boolean  // Gestrichelte PZ-Kreise (default: true)
  pzAltitudeUnit?: 'feet' | 'meters'  // Einheit für PZ-Höhenanzeige (default: 'feet')

  // Circle Drawing Settings
  circleRadius?: number  // Radius für Kreis-Zeichnung
  circleGridSnapping?: boolean  // Grid Snapping für Kreise
  circleCenterEasting?: string  // Zentrum Ost-Koordinate
  circleCenterNorthing?: string  // Zentrum Nord-Koordinate

  // Line Drawing Settings
  lineGridSnapping?: boolean  // Grid Snapping für Linien
  lineWidth?: number  // Linienbreite in Pixel (1-10)
  lineEastingValue?: string  // Easting Line (N-S) - Vertikale Linie bei E-Koordinate
  lineNorthingValue?: string  // Northing Line (E-W) - Horizontale Linie bei N-Koordinate

  // Task Ring Einstellungen
  showTaskRings?: boolean  // Task Rings anzeigen (default: true)
  ringColors?: string[]  // Farben für Ring 1-4 (default: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'])
  ringLineWidth?: number  // Linienstärke der Rings (default: 2)
  ringDashed?: boolean  // Rings gestrichelt anzeigen (default: true)

  // Kurslinie Einstellungen (3 Linien)
  hdgCourseLineColors?: string[]  // Farben für die 3 Kurslinien (default: ['#f59e0b', '#3b82f6', '#22c55e'])
  hdgCourseLineWidth?: number  // Linienstärke der Kurslinien (default: 3)
  hdgCourseLineLength?: number  // Länge der Kurslinien in Metern (default: 10000)

  // Kurs-Anzeige Einstellungen
  courseDisplaySize?: number  // Schriftgröße der Kurs-Anzeige (default: 11)
  courseDisplayBold?: boolean  // Fett gedruckt (default: true)
  courseDisplayBgColor?: string  // Hintergrundfarbe der Kurs-Anzeige (default: nutzt Linienfarbe)
  courseDisplayTextColor?: string  // Textfarbe der Kurs-Anzeige (default: '#ffffff')

  // Wind-Linie Einstellungen
  windLineColor?: string  // DEPRECATED - nutze windLineColors stattdessen
  windLineColors?: [string, string, string]  // 3 individuelle Farben für Windlinien (default: ['#00bcd4', '#ff6b6b', '#ffd93d'])
  windLineWidth?: number  // Linienstärke der Wind-Linien (default: 3)

  // Task Marker Farben (8 Farben für die Farbauswahl beim Erstellen von Tasks)
  taskMarkerColors?: string[]  // default: ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#64748b']

  // Task Erinnerung
  taskReminderValue?: number  // Wert vor Task-Ende für Erinnerung (default: 5)
  taskReminderUnit?: 'minutes' | 'seconds'  // Einheit: Minuten oder Sekunden (default: 'minutes')
  taskTimeZone?: 'utc' | 'local'  // Zeitzone für Task-Endzeit (default: 'utc')
  taskReminderSoundEnabled?: boolean  // Sound bei Erinnerung aktiviert (default: true)
  taskReminderSoundDuration?: number  // Dauer des Sounds in Sekunden (default: 2, range: 1-10)
  taskReminderSoundVolume?: number  // Lautstärke 0-1 (default: 0.5)

  // PZ (Prohibited Zone) Warnung
  pzWarningEnabled?: boolean  // PZ-Warnung aktiviert (default: true)
  pzWarningDistance?: number  // Warnungsdistanz in Metern (default: 500, range: 100-2000)
  pzWarningMargin?: number  // Vorlauf-Warnung in ft - gelbe Warnung bevor rot (default: 500, range: 0-2000)
  pzWarningSoundEnabled?: boolean  // Sound bei PZ-Warnung aktiviert (default: true)
  pzWarningSoundDuration?: number  // Dauer des Sounds in Sekunden (default: 3, range: 1-10)
  pzWarningSoundVolume?: number  // Lautstärke 0-1 (default: 0.7)
  pzWarningSoundType?: 'beep' | 'alarm'  // Sound-Typ: beep = aufsteigende Töne, alarm = Alarm-Ton (default: 'alarm')

  // Track/Polygon Warnung (für importierte Tracks/Linien)
  trackWarningEnabled?: boolean  // Track-Warnung global aktiviert (default: false)
  trackWarningSoundVolume?: number  // Lautstärke 0-1 (default: 0.7)

  // Marker Drop Signal
  dropSignalSoundEnabled?: boolean  // DROP-Signal Sound aktiviert (default: true)
  dropSignalSoundVolume?: number  // Lautstärke 0-1 (default: 0.8)

  // UI Skalierung - für kleine Bildschirme
  uiScale?: 'compact' | 'normal' | 'large'  // Allgemeine UI-Skalierung (default: 'normal')
  headerHeight?: number  // Header-Höhe in Pixel (default: 60, min: 40, max: 80)
  panelBackgroundOpacity?: number  // Panel-Hintergrund Transparenz (0.0-1.0, default: 0.95)
  navPanelScale?: number  // NavigationPanel Skalierung (default: 1.0, range: 0.6-1.5)
  briefingPanelScale?: number  // Briefing Panel Skalierung (default: 1.0, range: 0.6-1.5)
  windPanelScale?: number  // Wind Panel Skalierung (default: 1.0, range: 0.6-1.5)
  drawPanelScale?: number  // Draw Panel Skalierung (default: 1.0, range: 0.6-1.5)
  taskEditPanelScale?: number  // Task Edit Panel Skalierung (default: 1.0, range: 0.6-1.5)
  taskEditPanelPosition?: { x: number; y: number }  // Task Edit Panel Position
  teamPanelScale?: number  // Live Team Panel Skalierung (default: 1.0, range: 0.6-1.5)
  notificationScale?: number  // Benachrichtigungs-Skalierung (default: 1.0, range: 0.6-1.5)
  markerPanelScale?: number   // Marker Drop Panel Skalierung (default: 1.0, range: 0.6-1.5)
  climbPanelScale?: number    // PDG/FON Flugrechner Panel Skalierung (default: 1.0, range: 0.6-1.5)
  landingPanelScale?: number  // Landeprognose Panel Skalierung (default: 1.0, range: 0.6-1.5)
  lrnPanelScale?: number      // Land Run Panel Skalierung (default: 1.0, range: 0.6-1.5)
  aptPanelScale?: number      // APT Panel Skalierung (default: 1.0, range: 0.6-1.5)
  angPanelScale?: number      // ANG Berechnung Panel Skalierung (default: 1.0, range: 0.6-1.5)
  windRoseScale?: number      // Windrose Skalierung (default: 1.0, range: 0.6-1.5)

  // Pilot
  pilotName: string
  balloonId?: string

  // BLS Sensor
  lastConnectedBLS?: string | null  // ID des zuletzt verbundenen BLS
  lastConnectedBLSName?: string | null  // Name des zuletzt verbundenen BLS
}

export interface DisplayField {
  id: string
  type: DisplayFieldType
  enabled: boolean
  order: number
  color?: string
}

// Konfiguration für ein Nav-Panel Feld
export interface NavPanelField {
  id: string
  type: NavPanelFieldType
  label: string
  enabled: boolean
  color: string  // Textfarbe
  bgColor?: string  // Hintergrundfarbe (optional)
  fontSize: 'small' | 'medium' | 'large' | 'xlarge'
  fontSizePx?: number  // Präzise Schriftgröße in Pixel (12-48)
  fieldHeight?: number  // Feldhöhe/Padding in Pixel (24-60)
}

// Alle verfügbaren Feldtypen für das Navigation Panel
export type NavPanelFieldType =
  | 'altitude'      // ALT - Höhe MSL
  | 'elevation'     // ELEV - Geländehöhe
  | 'agl'           // AGL - Höhe über Grund
  | 'speed'         // SPD - Geschwindigkeit
  | 'variometer'    // Vario
  | 'heading'       // HDG - Aktueller Kurs
  | 'goal'          // Ziel Info
  | 'dtg'           // DTG - Distance to Goal
  | 'brg'           // BRG - Bearing to Goal
  | 'turn'          // TURN - Differenz zwischen HDG und BRG
  | 'wpt'           // WPT - Waypoint Name
  | 'ete'           // ETE - Estimated Time Enroute
  | 'drop'          // DROP - Marker Drop Nummer
  | 'cpa'           // CPA - Closest Point of Approach

export enum DisplayFieldType {
  Altitude = 'altitude',
  AGL = 'agl',
  Speed = 'speed',
  Heading = 'heading',
  Variometer = 'variometer',
  GoalDistance = 'goalDistance',
  GoalBearing = 'goalBearing',
  Satellites = 'satellites',
  Time = 'time',
  QNH = 'qnh',
  GroundElevation = 'groundElevation',
  TransitPoint = 'transitPoint'
}

// ============================================
// Live Team Tracking
// ============================================

export interface TeamSession {
  id: string
  joinCode: string
  name?: string
  createdAt: Date
  expiresAt: Date
  isActive: boolean
  maxMembers: number
}

export interface TeamMember {
  id: string
  teamId: string
  callsign: string
  color: string
  role: 'pilot' | 'crew'
  joinedAt: Date
  lastSeen: Date
  isOnline: boolean
}

export interface TeamPosition {
  id: string
  teamId: string
  memberId: string
  latitude: number
  longitude: number
  altitude: number
  heading: number
  speed: number
  vario: number
  recordedAt: Date
  receivedAt: Date
  isQueued: boolean
}

export interface QueuedPosition {
  latitude: number
  longitude: number
  altitude: number
  heading: number
  speed: number
  vario: number
  recordedAt: string
}

export enum TeamConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Offline = 'offline',
  Syncing = 'syncing',
  Error = 'error'
}

export const TEAM_MEMBER_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
] as const

// ============================================
// Authentication
// ============================================

export interface AppUser {
  id: string
  username: string
  display_name: string | null
  is_admin: boolean
  is_active: boolean
  role: 'pilot' | 'crew'
  created_at: string
  license_key?: string | null
  bound_installation_id?: string | null
}

export interface AppUserRow extends AppUser {
  password_hash: string
  salt: string
  last_online_check?: string | null
}

// ============================================
// Imported Trajectories (GPX/KML)
// ============================================

export interface TrajectoryPoint {
  latitude: number
  longitude: number
  altitude: number    // Meter MSL
  timestamp?: Date
}

export interface ImportedTrajectory {
  id: string
  name: string
  points: TrajectoryPoint[]
  color: string
  visible: boolean
  sourceFile: string
  sourceFormat: 'gpx' | 'kml'
  altitudeLevel?: number
}

// ============================================
// Offline Competition Maps
// ============================================

export interface CompetitionMapBounds {
  north: number  // Max Latitude
  south: number  // Min Latitude
  east: number   // Max Longitude
  west: number   // Min Longitude
}

export interface CompetitionMap {
  id: string
  name: string
  bounds: CompetitionMapBounds
  minZoom: number
  maxZoom: number
  tileCount: number
  downloadedAt: string  // ISO date string
  provider: string  // e.g. 'openstreetmap'
  // UTM Zone für Grid-Darstellung (wird aus Bounds berechnet oder von OZI-Import übernommen)
  utmZone?: number
  // UTM-reprojiziertes Bild für gerades Grid
  utmReprojection?: {
    imagePath: string
    utmZone: number
    utmBounds: {
      minE: number  // Min Easting
      maxE: number  // Max Easting
      minN: number  // Min Northing
      maxN: number  // Max Northing
    }
  }
  // 1x1km Grid Overlay
  showGrid?: boolean
  gridSize?: number  // Grid-Größe in Metern (default: 1000 = 1km)
}

// ============================================
// Prohibited Zones (PZ) / Sperrgebiete
// ============================================

export interface ProhibitedZone {
  id: string
  name: string
  description?: string
  lat: number           // Zentrum (für Punkt/Kreis) oder erster Punkt (für Polygon)
  lon: number           // Zentrum (für Punkt/Kreis) oder erster Punkt (für Polygon)
  elevation?: number    // Meter
  radius?: number       // Radius in Metern (optional für Kreis-Darstellung)

  // Polygon-Support (für Linien/Flächen aus PLT-Dateien)
  type?: 'point' | 'polygon'  // Default: 'point' wenn nicht gesetzt
  polygon?: { lat: number; lon: number }[]  // Polygon-Punkte (wenn type='polygon')
  closed?: boolean      // true = geschlossenes Polygon (Default), false = offene Linie (Track)
  color?: string        // Farbe für diese PZ (optional, überschreibt globale Einstellung)
  fillOpacity?: number  // Deckkraft der Füllung (0-1, nur bei geschlossenen Polygonen)
  sourceType?: 'plt' | 'track'  // Quelldatei-Typ: PLT (Polygon) oder Track (Linie)

  // Individuelle Warnungs-Einstellungen
  warningDisabled?: boolean  // Alle Warnungen für diese PZ deaktiviert
  distanceWarning?: boolean  // Individuelle Distanz-Warnung aktiviert (überschreibt globale)
  distanceWarningValue?: number  // Warnungsdistanz in Metern
  altitudeWarning?: boolean  // Höhen-Warnung für diese PZ aktiviert
  altitudeWarningMode?: 'floor' | 'ceiling'  // 'floor' = von Boden bis X (warnt wenn unter Höhe UND nahe), 'ceiling' = Höhenbegrenzung nach oben
  altitudeWarningValue?: number  // Höhenwert (in der Einheit aus Settings: ft oder m)
  altitudeWarningMargin?: number  // Vorlauf-Warnung: wie viele ft/m VOR der Grenze warnen (in der Einheit aus Settings)
}
