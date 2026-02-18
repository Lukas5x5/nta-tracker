/**
 * Task-spezifische Typen und Konfigurationen
 * Basierend auf FAI/CIA Competition Rules
 */

// Alle Task Typen
export enum TaskType {
  PDG = 'PDG',   // Pilot Declared Goal
  JDG = 'JDG',   // Judge Declared Goal
  HWZ = 'HWZ',   // Hesitation Waltz
  FIN = 'FIN',   // Fly In
  FON = 'FON',   // Fly On
  HNH = 'HNH',   // Hare and Hounds
  WSD = 'WSD',   // Watership Down
  GBM = 'GBM',   // Gordon Bennett Memorial
  CRT = 'CRT',   // Calculated Rate of Approach
  RTA = 'RTA',   // Race to Area
  ELB = 'ELB',   // Elbow
  LRN = 'LRN',   // Land Run
  MDT = 'MDT',   // Minimum Distance
  MDD = 'MDD',   // Minimum Distance Double Drop
  XDI = 'XDI',   // Maximum Distance
  XDT = 'XDT',   // Maximum Distance Time
  XDD = 'XDD',   // Maximum Distance Double Drop
  ANG = 'ANG',   // Angle Task
  SFL = 'SFL',   // Shortest Flight
  ThreeD = '3DT', // 3D Shape Task
  LTT = 'LTT',   // Least Time Task
  MTT = 'MTT',   // Most Time Task
  APT = 'APT',   // Altitude Profile Task
}

// Task Beschreibungen
export const TASK_INFO: Record<TaskType, {
  name: string
  description: string
  scoringMethod: 'distance_min' | 'distance_max' | 'time_min' | 'time_max' | 'angle' | 'area' | 'altitude_profile'
  requiresGoals: boolean
  multipleGoals: boolean
  requiresDeclaration: boolean
  requires3D: boolean
  requiresScoringArea: boolean
  requiresReferencePoint: boolean
  requiresTimeLimit: boolean
}> = {
  [TaskType.PDG]: {
    name: 'Pilot Declared Goal',
    description: 'Pilot deklariert Ziel vor dem Start',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: true,
    requiresDeclaration: true,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.JDG]: {
    name: 'Judge Declared Goal',
    description: 'Wettkampfleitung gibt ein Ziel vor',
    scoringMethod: 'distance_min',
    requiresGoals: true,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.HWZ]: {
    name: 'Hesitation Waltz',
    description: 'Mehrere Ziele zur Auswahl',
    scoringMethod: 'distance_min',
    requiresGoals: true,
    multipleGoals: true,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.FIN]: {
    name: 'Fly In',
    description: 'Ziel am Startplatz, freie Startplatzwahl',
    scoringMethod: 'distance_min',
    requiresGoals: true,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.FON]: {
    name: 'Fly On',
    description: 'Zieldeklaration während des Fluges',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: true,
    requiresDeclaration: true,
    requires3D: true,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.HNH]: {
    name: 'Hare and Hounds',
    description: 'Verfolgung eines Leitballons',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.WSD]: {
    name: 'Watership Down',
    description: 'Zum Hare fliegen und folgen',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: true,
  },
  [TaskType.GBM]: {
    name: 'Gordon Bennett Memorial',
    description: 'Marker innerhalb definierter Scoring Area',
    scoringMethod: 'distance_min',
    requiresGoals: true,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.CRT]: {
    name: 'Calculated Rate of Approach',
    description: 'Zeitabhängige Scoring Areas',
    scoringMethod: 'distance_min',
    requiresGoals: true,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: true,
  },
  [TaskType.RTA]: {
    name: 'Race to Area',
    description: 'Schnellste Zeit zur Scoring Area',
    scoringMethod: 'time_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.ELB]: {
    name: 'Elbow',
    description: 'Maximale Richtungsänderung (180° - Winkel)',
    scoringMethod: 'angle',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.LRN]: {
    name: 'Land Run',
    description: 'Maximale Dreiecksfläche',
    scoringMethod: 'area',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: true,
    requiresTimeLimit: false,
  },
  [TaskType.MDT]: {
    name: 'Minimum Distance',
    description: 'Nächster Punkt zum Referenzpunkt nach Min-Zeit',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: true,
    requiresTimeLimit: true,
  },
  [TaskType.MDD]: {
    name: 'Minimum Distance Double Drop',
    description: 'Zwei Marker mit minimaler Distanz',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.XDI]: {
    name: 'Maximum Distance',
    description: 'Maximale Distanz zum Referenzpunkt',
    scoringMethod: 'distance_max',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: true,
    requiresTimeLimit: false,
  },
  [TaskType.XDT]: {
    name: 'Maximum Distance Time',
    description: 'Maximale Distanz innerhalb Zeitlimit',
    scoringMethod: 'distance_max',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: true,
    requiresTimeLimit: true,
  },
  [TaskType.XDD]: {
    name: 'Maximum Distance Double Drop',
    description: 'Maximale Distanz zwischen zwei Markern',
    scoringMethod: 'distance_max',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.ANG]: {
    name: 'Angle Task',
    description: 'Maximale Abweichung von Richtung',
    scoringMethod: 'angle',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.SFL]: {
    name: 'Shortest Flight',
    description: 'Kürzeste Distanz zum Referenzpunkt',
    scoringMethod: 'distance_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: true,
    requiresTimeLimit: false,
  },
  [TaskType.ThreeD]: {
    name: '3D Shape Task',
    description: 'Maximale Distanz im definierten Luftraum',
    scoringMethod: 'distance_max',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: true,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.LTT]: {
    name: 'Least Time Task',
    description: 'Schnellste Durchquerung der Scoring Area',
    scoringMethod: 'time_min',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.MTT]: {
    name: 'Most Time Task',
    description: 'Langsamste Durchquerung der Scoring Area',
    scoringMethod: 'time_max',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: true,
    requiresReferencePoint: false,
    requiresTimeLimit: false,
  },
  [TaskType.APT]: {
    name: 'Altitude Profile Task',
    description: 'Höhenprofil so genau wie möglich folgen',
    scoringMethod: 'altitude_profile',
    requiresGoals: false,
    multipleGoals: false,
    requiresDeclaration: false,
    requires3D: false,
    requiresScoringArea: false,
    requiresReferencePoint: false,
    requiresTimeLimit: true,
  },
}

// Task Konfiguration
export interface TaskConfig {
  // Basis
  id: string
  type: TaskType
  name: string
  description?: string

  // Goals (für JDG, HWZ, FIN, GBM, CRT)
  goals: TaskGoal[]

  // Distanz Limits
  minDistance?: number  // Meter
  maxDistance?: number  // Meter

  // 3D Task / Höhen Limits
  minAltitude?: number  // MSL Meter
  maxAltitude?: number  // MSL Meter
  altitudeReference?: 'MSL' | 'AGL' | 'QNH'

  // Scoring Area (Kreis, Polygon, etc.)
  scoringArea?: ScoringAreaConfig

  // Marker Measurement Area (MMA)
  mmaRadius?: number  // Meter (typisch 100m, 200m, etc.)

  // Referenzpunkt (für XDI, MDT, etc.)
  referencePoint?: {
    latitude: number
    longitude: number
    altitude?: number
  }

  // Zeit Limits
  minTime?: number  // Sekunden
  maxTime?: number  // Sekunden
  timeWindow?: {
    start: Date
    end: Date
  }

  // Angle Task spezifisch
  setDirection?: number  // Grad (0-360)

  // Logger Declaration Settings
  declarationRequired: boolean
  declarationBeforeLaunch: boolean
  maxDeclarations?: number

  // Task Rings (für Anzeige auf Karte)
  rings: TaskRing[]

  // Status
  isActive: boolean
  completedAt?: Date
}

export interface TaskGoal {
  id: string
  name: string
  latitude: number
  longitude: number
  altitude?: number  // Für 3D Goals
  radius: number     // Goal Radius in Metern
  type: 'ground' | '3d'
  isSelected?: boolean
  gridReference?: string  // UTM Grid Reference
}

export interface ScoringAreaConfig {
  type: 'circle' | 'polygon' | 'sector' | 'rectangle'

  // Für Kreis
  center?: { latitude: number; longitude: number }
  radius?: number

  // Für Polygon/Rechteck
  points?: { latitude: number; longitude: number }[]

  // Für Sektor
  startAngle?: number
  endAngle?: number

  // Für alle
  minAltitude?: number
  maxAltitude?: number

  // Zeitabhängig (CRT)
  validFrom?: Date
  validUntil?: Date
}

export interface TaskRing {
  radius: number
  color: string
  style: 'solid' | 'dashed' | 'dotted'
  label?: string
}

// UTM Koordinaten Konfiguration
export interface UTMConfig {
  zone: number          // z.B. 33 für Österreich
  hemisphere: 'N' | 'S'
  digits: 4 | 5 | 6 | 8  // Anzahl der Stellen pro Koordinate
}

// Koordinaten Format
export type CoordinateFormat = 'decimal' | 'dms' | 'dm' | 'utm4' | 'utm5' | 'utm6' | 'utm8'
