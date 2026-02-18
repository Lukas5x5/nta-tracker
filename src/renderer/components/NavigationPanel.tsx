import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { formatAltitude, formatSpeed, formatHeading, formatVariometer, formatDistance } from '../utils/formatting'
import { calculateDistance, calculateBearing, calculateDestination, calculateClimbPoint, ClimbPointResult, calculateLandRun, LandRunResult, LandRunLimits, calculateAngleTask, AngleTaskResult, interpolateWind } from '../utils/navigation'
import { latLonToUTM, utmToLatLon, formatCoordinate, getGridPrecision } from '../utils/coordinatesWGS84'
import { NavPanelField, NavPanelFieldType, GPSFix, Goal, Task } from '../../shared/types'
import { AltitudeProfilePanel } from './AltitudeProfilePanel'

// Schriftgrößen-Mapping (jetzt mit px-Werten für Slider)
const fontSizeMap = {
  small: '16px',
  medium: '20px',
  large: '28px',
  xlarge: '36px'
}

// Konvertiere fontSize-String zu number für Slider
const fontSizeToNumber = (size: 'small' | 'medium' | 'large' | 'xlarge'): number => {
  switch (size) {
    case 'small': return 16
    case 'medium': return 20
    case 'large': return 28
    case 'xlarge': return 36
    default: return 20
  }
}

// Konvertiere number zu fontSize-String (für Kompatibilität)
const numberToFontSize = (px: number): 'small' | 'medium' | 'large' | 'xlarge' => {
  if (px <= 16) return 'small'
  if (px <= 22) return 'medium'
  if (px <= 32) return 'large'
  return 'xlarge'
}

// Farb-Optionen für Text
const colorOptions = [
  '#ffffff', '#22c55e', '#ef4444', '#3b82f6',
  '#f59e0b', '#ec4899', '#a855f7', '#14b8a6'
]

// Farb-Optionen für Hintergrund (mit transparent)
const bgColorOptions = [
  'transparent', 'rgba(34,197,94,0.2)', 'rgba(239,68,68,0.2)', 'rgba(59,130,246,0.2)',
  'rgba(245,158,11,0.2)', 'rgba(236,72,153,0.2)', 'rgba(168,85,247,0.2)', 'rgba(20,184,166,0.2)'
]

// Alle verfügbaren Feldtypen mit Beschreibungen
const allFieldTypes: { type: NavPanelFieldType; label: string; defaultLabel: string; description: string }[] = [
  { type: 'altitude', label: 'ALT', defaultLabel: 'Höhe MSL', description: 'GPS-Höhe über Meeresspiegel (Mean Sea Level)' },
  { type: 'elevation', label: 'ELEV', defaultLabel: 'Gelände', description: 'Geländehöhe unter dem Ballon' },
  { type: 'agl', label: 'AGL', defaultLabel: 'Höhe AGL', description: 'Höhe über Grund (Above Ground Level)' },
  { type: 'speed', label: 'SPD', defaultLabel: 'Speed', description: 'Aktuelle Geschwindigkeit über Grund' },
  { type: 'variometer', label: 'Vario', defaultLabel: 'Vario', description: 'Steig-/Sinkrate (grün=steigen, rot=sinken)' },
  { type: 'heading', label: 'HDG', defaultLabel: 'Kurs', description: 'Aktueller Flugkurs in Grad (0-360°)' },
  { type: 'dtg', label: 'DTG', defaultLabel: 'Distanz', description: 'Distance To Go - Entfernung zum Ziel' },
  { type: 'brg', label: 'BRG', defaultLabel: 'Peilung', description: 'Bearing - Richtung zum Ziel in Grad' },
  { type: 'turn', label: 'TURN', defaultLabel: 'Drift', description: 'Kursabweichung zum Ziel (L=links, R=rechts)' },
  { type: 'wpt', label: 'WPT', defaultLabel: 'Ziel', description: 'Name des aktuell ausgewählten Ziels' },
  { type: 'ete', label: 'ETE', defaultLabel: 'Zeit zum Ziel', description: 'Estimated Time Enroute - geschätzte Flugzeit zum Ziel' },
  { type: 'drop', label: 'DROP', defaultLabel: 'Marker', description: 'Anzahl der gesetzten Marker' },
  { type: 'cpa', label: 'CPA', defaultLabel: 'Nächster Punkt', description: 'Closest Point of Approach - kürzeste Distanz bei aktuellem Kurs' },
  { type: 'goal', label: 'GOAL', defaultLabel: 'Ziel Info', description: 'Zielinformationen mit Distanz' }
]

// Beschreibung für ein Feld holen
const getFieldDescription = (type: NavPanelFieldType): string => {
  return allFieldTypes.find(f => f.type === type)?.description || ''
}

// Default Felder - kompakt und übersichtlich
const defaultNavPanelFields: NavPanelField[] = [
  { id: 'alt', type: 'altitude', label: 'ALT', enabled: true, color: '#ffffff', fontSize: 'medium' },
  { id: 'agl', type: 'agl', label: 'AGL', enabled: true, color: '#22c55e', fontSize: 'medium' },
  { id: 'spd', type: 'speed', label: 'SPD', enabled: true, color: '#ffffff', fontSize: 'medium' },
  { id: 'hdg', type: 'heading', label: 'HDG', enabled: true, color: '#ffffff', fontSize: 'medium' },
  { id: 'wpt', type: 'wpt', label: 'WPT', enabled: true, color: '#22c55e', fontSize: 'medium' },
  { id: 'dtg', type: 'dtg', label: 'DTG', enabled: true, color: '#3b82f6', fontSize: 'large' },
  { id: 'brg', type: 'brg', label: 'BRG', enabled: true, color: '#3b82f6', fontSize: 'medium' },
  { id: 'turn', type: 'turn', label: 'TURN', enabled: true, color: '#ffffff', fontSize: 'medium' },
  { id: 'elev', type: 'elevation', label: 'ELEV', enabled: false, color: '#f59e0b', fontSize: 'medium' },
  { id: 'vario', type: 'variometer', label: 'Vario', enabled: false, color: '#ffffff', fontSize: 'medium' },
  { id: 'ete', type: 'ete', label: 'ETE', enabled: false, color: '#a855f7', fontSize: 'medium' },
  { id: 'cpa', type: 'cpa', label: 'CPA', enabled: false, color: '#14b8a6', fontSize: 'medium' },
  { id: 'drop', type: 'drop', label: 'DROP', enabled: false, color: '#ef4444', fontSize: 'medium' }
]

export function NavigationPanel() {
  const {
    gpsData, smoothedGpsData, baroData, agl, groundElevation, selectedGoal, settings, updateSettings,
    markers, dropMarker, removeMarker, clearAllMarkers, isRecording,
    hdgCourseMode, hdgPendingCourse, hdgPendingLineMode, hdgCourseLines, editingHdgCourseLineId,
    setHdgCourseMode, setHdgPendingLineMode, addHdgCourseLine, updateHdgCourseLine, removeHdgCourseLine, clearAllHdgCourseLines, setEditingHdgCourseLineId,
    gpsSimulation, setGpsSimulationPickingStart, setGpsSimulationStartPosition,
    setGpsSimulationParams, startGpsSimulation, stopGpsSimulation, setGPSData, setBaroData,
    setFlyToPosition,
    showLandingPrediction, setShowLandingPrediction, landingSinkRate, setLandingSinkRate,
    landingPrediction, landingPredictionLoading, windLayers, windSourceFilter,
    dropCalculator, setDropCalculatorActive,
    tasks, updateTask, setSelectedGoal,
    activeCompetitionMap,
    activeToolPanel, setActiveToolPanel
  } = useFlightStore()

  // Gefilterte Windschichten fuer Berechnungen (nach aktivem Quellen-Filter)
  const filteredWindLayers = useMemo(() => {
    if (windSourceFilter === 'all') return windLayers
    if (windSourceFilter === 'forecast') return windLayers.filter(l => l.source === 'forecast')
    if (windSourceFilter === 'measured') return windLayers.filter(l => l.source === 'measured')
    if (windSourceFilter === 'sounding') return windLayers.filter(l => l.source === 'windsond' || l.source === 'pibal')
    return windLayers
  }, [windLayers, windSourceFilter])

  // Tool panel visibility derived from store
  const showLandingPanel = activeToolPanel === 'lnd'
  const showDropCalcPanel = activeToolPanel === 'marker'
  const showClimbPanel = activeToolPanel === 'fly'
  const showLandRunPanel = activeToolPanel === 'lrn'
  const showAptPanel = activeToolPanel === 'apt'
  const showAngPanel = activeToolPanel === 'ang'

  const [isDragging, setIsDragging] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [showCoursePanel, setShowCoursePanel] = useState(false)
  const [showCourseInput, setShowCourseInput] = useState(false)
  const [courseInputValue, setCourseInputValue] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showDropsPanel, setShowDropsPanel] = useState(false)
  const [showGpsSimPanel, setShowGpsSimPanel] = useState(false)
  const [lrnClimbRate, setLrnClimbRate] = useState(1.5) // m/s
  const [lrnLimitMode, setLrnLimitMode] = useState<'leg1' | 'leg2' | 'leg1+leg2' | 'total'>('leg1')
  const [lrnLimitUnit, setLrnLimitUnit] = useState<'min' | 'km'>('min')
  const [lrnLeg1Value, setLrnLeg1Value] = useState(10) // Min oder km
  const [lrnLeg2Value, setLrnLeg2Value] = useState(10) // Min oder km
  const [lrnTotalValue, setLrnTotalValue] = useState(20) // Min oder km
  const [lrnResult, setLrnResult] = useState<LandRunResult | null>(null)
  const [lrnCalculating, setLrnCalculating] = useState(false)
  const [lrnSelectedAlt, setLrnSelectedAlt] = useState<number>(-1) // Index der ausgewählten Alternative (-1 = best)
  const [lrnAltLimit, setLrnAltLimit] = useState(false) // Höhenbegrenzung aktiv?
  const [lrnAltLimitMode, setLrnAltLimitMode] = useState<'ceiling' | 'floor'>('ceiling') // Obergrenze oder Untergrenze
  const [lrnAltLimitValue, setLrnAltLimitValue] = useState(5000) // ft
  const setLandRunResult = useFlightStore(s => s.setLandRunResult)
  // ANG (Angle Task) Rechner State
  const [angSetDir, setAngSetDir] = useState(0)
  const [angLimitMode, setAngLimitMode] = useState<'km' | 'min'>('km')
  const [angMinDist, setAngMinDist] = useState(3) // km
  const [angMaxDist, setAngMaxDist] = useState(4) // km
  const [angMinTime, setAngMinTime] = useState(5) // Minuten
  const [angMaxTime, setAngMaxTime] = useState(20) // Minuten
  const [angClimbRate, setAngClimbRate] = useState(2.0) // m/s
  const [angResult, setAngResultLocal] = useState<AngleTaskResult | null>(null)
  const [angCalculating, setAngCalculating] = useState(false)
  const [angSelectedAlt, setAngSelectedAlt] = useState<number>(-1)
  const setAngleResult = useFlightStore(s => s.setAngleResult)
  // Punkt A Koordinaten-Eingabe (optional)
  const [angPointAEast, setAngPointAEast] = useState('')
  const [angPointANorth, setAngPointANorth] = useState('')
  const [angPointALatLon, setAngPointALatLon] = useState<{ lat: number; lon: number } | null>(null)

  // UTM Bounds aus aktiver Wettkampfkarte (für Koordinaten-Parsing)
  const mapUtmBounds = activeCompetitionMap?.utmReprojection?.utmBounds
  const mapUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone
  const effectiveUtmZone = mapUtmZone || settings.utmZone || undefined

  // Koordinaten parsen (gleiche Logik wie BriefingPanel)
  const parseAngCoordinate = (east: string, north: string): { lat: number; lon: number } | null => {
    try {
      const format = settings.coordinateFormat
      if (format === 'mgrs4' || format === 'mgrs5' || format === 'mgrs6') {
        const eastMeters = parseInt(east.padEnd(5, '0'))
        const northMeters = parseInt(north.padEnd(5, '0'))
        if (isNaN(eastMeters) || isNaN(northMeters)) return null

        let fullEasting: number
        let fullNorthing: number

        if (mapUtmBounds) {
          const minEQ = Math.floor(mapUtmBounds.minE / 100000) * 100000
          const maxEQ = Math.floor(mapUtmBounds.maxE / 100000) * 100000
          if (minEQ === maxEQ) {
            fullEasting = minEQ + eastMeters
          } else {
            const cMin = minEQ + eastMeters
            const cMax = maxEQ + eastMeters
            if (cMin >= mapUtmBounds.minE && cMin <= mapUtmBounds.maxE) fullEasting = cMin
            else if (cMax >= mapUtmBounds.minE && cMax <= mapUtmBounds.maxE) fullEasting = cMax
            else {
              const center = (mapUtmBounds.minE + mapUtmBounds.maxE) / 2
              fullEasting = Math.abs(cMin - center) < Math.abs(cMax - center) ? cMin : cMax
            }
          }

          const minNQ = Math.floor(mapUtmBounds.minN / 100000) * 100000
          const maxNQ = Math.floor(mapUtmBounds.maxN / 100000) * 100000
          if (minNQ === maxNQ) {
            fullNorthing = minNQ + northMeters
          } else {
            const cMin = minNQ + northMeters
            const cMax = maxNQ + northMeters
            if (cMin >= mapUtmBounds.minN && cMin <= mapUtmBounds.maxN) fullNorthing = cMin
            else if (cMax >= mapUtmBounds.minN && cMax <= mapUtmBounds.maxN) fullNorthing = cMax
            else {
              const center = (mapUtmBounds.minN + mapUtmBounds.maxN) / 2
              fullNorthing = Math.abs(cMin - center) < Math.abs(cMax - center) ? cMin : cMax
            }
          }
        } else {
          const gridSquareEastBase = Math.floor(settings.utmBaseEasting / 100000) * 100000
          const gridSquareNorthBase = Math.floor(settings.utmBaseNorthing / 100000) * 100000
          fullEasting = gridSquareEastBase + eastMeters
          fullNorthing = gridSquareNorthBase + northMeters
        }

        const effectiveZone = mapUtmZone || settings.utmZone || 33
        return utmToLatLon({ zone: effectiveZone, hemisphere: 'N', easting: fullEasting, northing: fullNorthing })
      } else if (format === 'utm') {
        const eastNum = parseInt(east)
        const northNum = parseInt(north)
        if (isNaN(eastNum) || isNaN(northNum)) return null
        const zone = settings.utmZone || 33
        return utmToLatLon({ zone, hemisphere: 'N', easting: eastNum, northing: northNum })
      }
      return null
    } catch {
      return null
    }
  }

  const [climbRate, setClimbRate] = useState(2)  // m/s
  const [climbDirection, setClimbDirection] = useState<'up' | 'down'>('up')
  const [climbMinAltFt, setClimbMinAltFt] = useState(1000)  // ft
  const [climbMinDist, setClimbMinDist] = useState(1000)  // m
  const [climbExactMode, setClimbExactMode] = useState(false)
  const [climbLeadTime, setClimbLeadTime] = useState(0)  // Vorlaufzeit in Sekunden
  const [climbCountdownStart, setClimbCountdownStart] = useState<number | null>(null)
  const [climbCountdownRemaining, setClimbCountdownRemaining] = useState<number | null>(null)
  const [climbResult, setClimbResultLocal] = useState<ClimbPointResult | null>(null)
  const setClimbPointResult = useFlightStore(s => s.setClimbPointResult)

  // Countdown-Timer für PDG-Vorlaufzeit
  useEffect(() => {
    if (!climbCountdownStart || !climbResult || climbResult.leadTime <= 0) {
      setClimbCountdownRemaining(null)
      return
    }
    const update = () => {
      const elapsed = (Date.now() - climbCountdownStart) / 1000
      const remaining = climbResult.leadTime - elapsed
      setClimbCountdownRemaining(Math.max(0, Math.round(remaining)))
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [climbCountdownStart, climbResult])

  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; isTouch: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Tool-Panel Drag State — Position pro Tool gespeichert
  const [toolPanelPositions, setToolPanelPositions] = useState<Record<string, { x: number; y: number }>>({})
  const toolPanelPos = activeToolPanel ? toolPanelPositions[activeToolPanel] || null : null
  const setToolPanelPos = (pos: { x: number; y: number } | null) => {
    if (!activeToolPanel) return
    if (pos) {
      setToolPanelPositions(prev => ({ ...prev, [activeToolPanel]: pos }))
    }
  }
  const [isToolDragging, setIsToolDragging] = useState(false)
  const toolDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; isTouch: boolean } | null>(null)

  // ANG: Auto-fill setDirection aus aktivem ANG-Task
  useEffect(() => {
    const activeAng = tasks.find(t => t.isActive && t.type === 'ANG')
    if (activeAng?.setDirection != null) setAngSetDir(activeAng.setDirection)
  }, [tasks])

  // Tool-Panel Drag Handlers
  const handleToolMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return
    e.preventDefault()
    const pos = toolPanelPos || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }
    setIsToolDragging(true)
    toolDragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y, isTouch: false }
  }

  const handleToolTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('select')) return
    const touch = e.touches[0]
    if (!touch) return
    const pos = toolPanelPos || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }
    setIsToolDragging(true)
    toolDragRef.current = { startX: touch.clientX, startY: touch.clientY, startPosX: pos.x, startPosY: pos.y, isTouch: true }
  }

  // Tool-Panel Drag Effect
  useEffect(() => {
    if (!isToolDragging || !toolDragRef.current) return

    const handleMove = (clientX: number, clientY: number) => {
      if (!toolDragRef.current) return
      const dx = clientX - toolDragRef.current.startX
      const dy = clientY - toolDragRef.current.startY
      setToolPanelPos({
        x: Math.max(80, Math.min(window.innerWidth - 80, toolDragRef.current.startPosX + dx)),
        y: Math.max(40, Math.min(window.innerHeight - 40, toolDragRef.current.startPosY + dy))
      })
    }

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) handleMove(touch.clientX, touch.clientY)
    }
    const handleEnd = () => { setIsToolDragging(false); toolDragRef.current = null }

    if (toolDragRef.current.isTouch) {
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    } else {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isToolDragging])

  // Tool-Panel Position Style
  const toolPanelStyle = (panelScale: number, borderColor: string, active?: boolean): React.CSSProperties => {
    const pos = toolPanelPos
    return {
      position: 'fixed',
      ...(pos
        ? { left: pos.x, top: pos.y, transform: `translate(-50%, -50%) scale(${panelScale})` }
        : { left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${panelScale})` }
      ),
      zIndex: 2000,
      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
      borderRadius: '16px',
      padding: '16px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
      border: active ? `1px solid ${borderColor}` : '1px solid rgba(255, 255, 255, 0.1)',
      transformOrigin: 'center center',
      cursor: isToolDragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
    }
  }

  // Position aus Settings
  const position = settings.navPanelPosition || { x: 16, y: 76 }

  // Verwende Default-Felder wenn keine gespeichert sind
  const fields = (settings.navPanelFields && settings.navPanelFields.length > 0)
    ? settings.navPanelFields
    : defaultNavPanelFields

  // Initialisiere Felder wenn nicht vorhanden
  useEffect(() => {
    if (!settings.navPanelFields || settings.navPanelFields.length === 0) {
      updateSettings({ navPanelFields: defaultNavPanelFields })
    }
  }, [])

  // GPS Simulation Position Tracking
  const simPositionRef = useRef<{ lat: number; lon: number; altitude: number } | null>(null)

  // Initialisiere Position wenn Simulation startet
  useEffect(() => {
    if (gpsSimulation.active && gpsSimulation.startPosition) {
      simPositionRef.current = {
        lat: gpsSimulation.startPosition.lat,
        lon: gpsSimulation.startPosition.lon,
        altitude: gpsSimulation.altitude
      }
    } else {
      simPositionRef.current = null
    }
  }, [gpsSimulation.active, gpsSimulation.startPosition?.lat, gpsSimulation.startPosition?.lon])

  // GPS Simulation Update-Loop
  useEffect(() => {
    if (!gpsSimulation.active || !gpsSimulation.startPosition) return

    const intervalId = setInterval(() => {
      // Hole aktuelle Simulation-Werte aus dem Store
      const storeState = useFlightStore.getState()
      const simState = storeState.gpsSimulation
      if (!simState.active || !simPositionRef.current) return

      // Berechne neue Position basierend auf Kurs und Geschwindigkeit
      // Geschwindigkeit ist in km/h, Update alle 1000ms (1Hz)
      const updateIntervalMs = 1000

      // Wind-Following: Kurs und Speed aus Wind-Layern ermitteln
      let effectiveHeading = simState.heading
      let effectiveSpeed = simState.speed

      if (simState.followWind && storeState.windLayers.length > 0) {
        // Dieselbe interpolateWind()-Funktion wie die Landeprognose verwenden
        const currentAlt = simPositionRef.current.altitude
        const wind = interpolateWind(currentAlt, storeState.windLayers)

        // Wind kommt FROM → Ballon driftet in Gegenrichtung
        effectiveHeading = (wind.direction + 180) % 360
        effectiveSpeed = wind.speedMs * 3.6  // m/s zurück zu km/h
      }

      const speedMs = (effectiveSpeed * 1000) / 3600  // km/h zu m/s
      const distanceM = speedMs * (updateIntervalMs / 1000)  // Distanz in diesem Intervall

      // Dieselbe calculateDestination()-Funktion wie alle anderen Tools
      const newPos = calculateDestination(
        simPositionRef.current.lat, simPositionRef.current.lon,
        effectiveHeading, distanceM
      )
      const newLat = newPos.lat
      const newLon = newPos.lon

      // Höhe aktualisieren basierend auf Vario (m/s)
      const newAltitude = simPositionRef.current.altitude + simState.vario * (updateIntervalMs / 1000)

      // Position speichern für nächstes Update
      simPositionRef.current = { lat: newLat, lon: newLon, altitude: newAltitude }

      // GPS Daten setzen
      setGPSData({
        latitude: newLat,
        longitude: newLon,
        altitude: newAltitude,
        speed: effectiveSpeed,
        heading: effectiveHeading,
        satellites: 12,  // Simuliert
        hdop: 1.0,      // Simuliert - gute Qualität
        timestamp: new Date(),
        fix: GPSFix.GPS
      })

      // Barometer-Daten setzen
      setBaroData({
        pressureAltitude: newAltitude,
        qnh: 1013.25,
        variometer: simState.vario,
        timestamp: new Date()
      })
    }, 1000)  // Update alle 1000ms (1Hz, wie BLS Sensor)

    return () => clearInterval(intervalId)
  }, [gpsSimulation.active, gpsSimulation.startPosition?.lat, gpsSimulation.startPosition?.lon, setGPSData])

  // Berechne Navigationswerte
  let goalDistance: number | null = null
  let goalBearing: number | null = null
  let turn: number | null = null
  let ete: number | null = null
  let cpa: number | null = null

  if (gpsData && selectedGoal) {
    goalDistance = calculateDistance(
      gpsData.latitude, gpsData.longitude,
      selectedGoal.position.latitude, selectedGoal.position.longitude
    )
    goalBearing = calculateBearing(
      gpsData.latitude, gpsData.longitude,
      selectedGoal.position.latitude, selectedGoal.position.longitude
    )
    turn = goalBearing - (gpsData?.heading || 0)
    if (turn > 180) turn -= 360
    if (turn < -180) turn += 360

    if (goalDistance !== null && turn !== null) {
      const turnRad = Math.abs(turn) * Math.PI / 180
      cpa = goalDistance * Math.sin(turnRad)
    }

    // ETE Berechnung: Zeit bis zum Ziel basierend auf Geschwindigkeit
    if (gpsData.speed > 0.5 && goalDistance) {
      // Berechne effektive Geschwindigkeit in Richtung Ziel
      const turnRad = (turn || 0) * Math.PI / 180
      const effectiveSpeedKmh = gpsData.speed * Math.cos(turnRad)

      if (effectiveSpeedKmh > 0.5) {
        // Normale Berechnung wenn wir uns auf das Ziel zubewegen
        const distanceKm = goalDistance / 1000
        ete = (distanceKm / effectiveSpeedKmh) * 3600
      } else if (Math.abs(turn || 0) <= 90) {
        // Wenn wir uns seitwärts bewegen, verwende direkte Geschwindigkeit als Schätzung
        const distanceKm = goalDistance / 1000
        ete = (distanceKm / gpsData.speed) * 3600
      }
      // Bei turn > 90° (wir entfernen uns) bleibt ete null -> zeigt "--:--"
    }
  }

  // Variometer
  const vario = baroData?.variometer || 0
  const isClimbing = vario > 0.1
  const isSinking = vario < -0.1

  // Gelaendehoehe direkt aus Store
  const elevation = groundElevation || 0

  // Drag-Handling (Mouse)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (editingField || showSettings) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: false
    }
  }

  // Drag-Handling (Touch)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (editingField || showSettings) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    const touch = e.touches[0]
    if (!touch) return
    setIsDragging(true)
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: position.x,
      startPosY: position.y,
      isTouch: true
    }
  }

  // Panel Skalierung - echte transform scale für Breite UND Höhe
  const scale = settings.navPanelScale ?? 1

  // Sub-Panel (Kurslinien, Feld-Editor) links oder rechts anzeigen
  // Wenn das NavPanel zu weit rechts ist, Sub-Panel links davon anzeigen
  // Verwende tatsächliche Panel-Breite über Ref, Fallback auf 240
  const navPanelWidth = panelRef.current?.offsetWidth || 240
  const subPanelWidth = 280 // maxWidth der Sub-Panels
  const subPanelGap = 12  // Abstand zwischen NavPanel und Sub-Panel
  const subPanelOnRight = (position.x + (navPanelWidth * scale) + subPanelGap + (subPanelWidth * scale)) <= window.innerWidth
  // Position als left oder right (fuer praezise Ausrichtung unabhaengig von Panel-Breite)
  const subPanelPosition: React.CSSProperties = subPanelOnRight
    ? { left: position.x + (navPanelWidth * scale) + subPanelGap, right: undefined }
    : { left: undefined, right: window.innerWidth - position.x + subPanelGap }

  useEffect(() => {
    if (!isDragging || !dragRef.current) return

    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY
      updateSettings({
        navPanelPosition: {
          x: Math.max(0, dragRef.current.startPosX + dx),
          y: Math.max(0, dragRef.current.startPosY + dy)
        }
      })
    }

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) handleMove(touch.clientX, touch.clientY)
    }

    const handleEnd = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    // Event listeners basierend auf Drag-Typ
    if (dragRef.current.isTouch) {
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    } else {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging, updateSettings, scale])

  // Feld aktualisieren
  const updateField = (fieldId: string, updates: Partial<NavPanelField>) => {
    const newFields = fields.map(f =>
      f.id === fieldId ? { ...f, ...updates } : f
    )
    updateSettings({ navPanelFields: newFields })
  }

  // Feld nach oben/unten verschieben
  const moveField = (fieldId: string, direction: 'up' | 'down') => {
    const idx = fields.findIndex(f => f.id === fieldId)
    if (idx === -1) return

    const newFields = [...fields]
    if (direction === 'up' && idx > 0) {
      [newFields[idx - 1], newFields[idx]] = [newFields[idx], newFields[idx - 1]]
    } else if (direction === 'down' && idx < fields.length - 1) {
      [newFields[idx], newFields[idx + 1]] = [newFields[idx + 1], newFields[idx]]
    }
    updateSettings({ navPanelFields: newFields })
  }

  // Zeit formatieren (MM:SS oder HH:MM)
  const formatTime = (seconds: number): string => {
    if (seconds < 0) return '--:--'
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60)
      const secs = Math.floor(seconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    } else {
      const hours = Math.floor(seconds / 3600)
      const mins = Math.floor((seconds % 3600) / 60)
      return `${hours}:${mins.toString().padStart(2, '0')}`
    }
  }

  // Wert für ein Feld berechnen
  const getFieldValue = (field: NavPanelField): { value: string; unit: string; color?: string } => {
    switch (field.type) {
      case 'altitude':
        return {
          value: formatAltitude(gpsData?.altitude || 0, settings.altitudeUnit),
          unit: settings.altitudeUnit === 'meters' ? 'm' : 'ft'
        }
      case 'elevation':
        return {
          value: formatAltitude(elevation, settings.altitudeUnit),
          unit: settings.altitudeUnit === 'meters' ? 'm' : 'ft'
        }
      case 'agl':
        return {
          value: formatAltitude(agl, settings.altitudeUnit),
          unit: settings.altitudeUnit === 'meters' ? 'm' : 'ft'
        }
      case 'variometer':
        return {
          value: (vario > 0 ? '+' : '') + formatVariometer(vario, settings.variometerUnit),
          unit: settings.variometerUnit === 'ms' ? 'm/s' : 'fpm',
          color: isClimbing ? '#22c55e' : isSinking ? '#ef4444' : undefined
        }
      case 'speed':
        return {
          value: formatSpeed(gpsData?.speed || 0, settings.speedUnit),
          unit: settings.speedUnit === 'kmh' ? 'km/h' : settings.speedUnit === 'knots' ? 'kn' : 'm/s'
        }
      case 'heading':
        return {
          value: formatHeading(smoothedGpsData?.heading ?? gpsData?.heading ?? 0),
          unit: '°'
        }
      case 'dtg':
        if (!selectedGoal || goalDistance === null) return { value: '--', unit: '' }
        // DTG bleibt immer in Metern (nicht vom m/ft Toggle betroffen)
        return {
          value: formatDistance(goalDistance, 'meters'),
          unit: 'm'
        }
      case 'brg':
        if (!selectedGoal || goalBearing === null) return { value: '--', unit: '' }
        return {
          value: formatHeading(goalBearing),
          unit: '°'
        }
      case 'turn':
        if (!selectedGoal || turn === null) return { value: '--', unit: '' }
        return {
          value: (turn > 0 ? '+' : '') + turn.toFixed(0),
          unit: turn > 0 ? '°R' : turn < 0 ? '°L' : '°'
        }
      case 'wpt':
        return {
          value: selectedGoal?.name || '--',
          unit: ''
        }
      case 'ete':
        if (!selectedGoal || ete === null || ete < 0) return { value: '--:--', unit: '' }
        return {
          value: formatTime(ete),
          unit: ete >= 3600 ? 'h' : 'min'
        }
      case 'drop':
        if (markers.length === 0) {
          return { value: '-', unit: '' }
        }
        // Letzten Marker anzeigen mit UTM-Koordinaten
        const lastMarker = markers[markers.length - 1]
        const markerUtm = latLonToUTM(lastMarker.position.latitude, lastMarker.position.longitude)
        const markerEasting = Math.round(markerUtm.easting % 100000).toString().padStart(5, '0')
        const markerNorthing = Math.round(markerUtm.northing % 100000).toString().padStart(5, '0')
        return {
          value: `#${lastMarker.number} ${markerEasting}/${markerNorthing}`,
          unit: `(${markers.length})`
        }
      case 'cpa':
        if (!selectedGoal || cpa === null) return { value: '--', unit: '' }
        // CPA bleibt immer in Metern (nicht vom m/ft Toggle betroffen)
        return {
          value: formatDistance(cpa, 'meters'),
          unit: 'm'
        }
      case 'goal':
        if (!selectedGoal) return { value: '-', unit: '' }
        return {
          value: goalDistance !== null ? formatDistance(goalDistance, settings.distanceUnit) : '-',
          unit: settings.distanceUnit === 'meters' ? 'm' : 'ft'
        }
      default:
        return { value: '-', unit: '' }
    }
  }

  // HDG Kurs-Linie: Öffnet Eingabedialog
  const handleHdgCourseClick = () => {
    if (hdgCourseMode) {
      setHdgCourseMode(false)
    } else {
      setShowCourseInput(true)
      setCourseInputValue('')
      setEditingCourseLineId(null)
    }
  }

  // Kurs-Wert aendert sich: automatisch Karten-Klick-Modus aktivieren
  const handleCourseInputChange = (value: string) => {
    setCourseInputValue(value)
    const course = parseInt(value)
    if (!isNaN(course) && course >= 0 && course <= 360) {
      if (editingCourseLineId) {
        // Beim Editieren: Linie direkt aktualisieren
        updateHdgCourseLine(editingCourseLineId, { course: course % 360 })
      } else {
        // Neue Linie: Karten-Klick-Modus aktivieren
        setHdgCourseMode(true, course % 360)
      }
    } else {
      if (!editingCourseLineId) {
        setHdgCourseMode(false)
      }
    }
  }

  // Kurs-Eingabe abschliessen
  const handleCourseInputDone = () => {
    if (editingCourseLineId) {
      // Beim Editieren: nur Input schliessen
      setShowCourseInput(false)
      setCourseInputValue('')
      setEditingCourseLineId(null)
    } else {
      // Neue Linie: Input schliessen, Modus bleibt aktiv wenn Kurs gueltig
      setShowCourseInput(false)
      setCourseInputValue('')
    }
  }

  // Bestehende Kurslinie bearbeiten
  const [editingCourseLineId, setEditingCourseLineId] = useState<string | null>(null)
  const handleEditCourseLine = (line: typeof hdgCourseLines[0]) => {
    // Positions-Bearbeitungsmodus beenden wenn aktiv
    if (editingHdgCourseLineId) {
      setEditingHdgCourseLineId(null)
    }
    setEditingCourseLineId(line.id)
    setCourseInputValue(line.course.toFixed(0))
    setShowCourseInput(true)
  }

  // Nach Karten-Klick (Linie wurde platziert): Input schliessen
  const prevHdgCourseLinesCount = useRef(hdgCourseLines.length)
  useEffect(() => {
    if (hdgCourseLines.length > prevHdgCourseLinesCount.current && showCourseInput && !editingCourseLineId) {
      // Neue Linie wurde hinzugefuegt -> Input schliessen
      setShowCourseInput(false)
      setCourseInputValue('')
    }
    prevHdgCourseLinesCount.current = hdgCourseLines.length
  }, [hdgCourseLines.length, showCourseInput, editingCourseLineId])

  const enabledFields = fields.filter(f => f.enabled)
  const disabledFields = fields.filter(f => !f.enabled)

  return (
    <>
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '16px',
        padding: '16px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        minWidth: '200px',
        maxWidth: '240px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.1)',
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header mit Titel, m/ft Toggle und Settings */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'rgba(255,255,255,0.7)',
          letterSpacing: '1px'
        }}>
          NAVIGATION
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* m/ft Toggle */}
          <button
            onClick={() => updateSettings({
              altitudeUnit: settings.altitudeUnit === 'meters' ? 'feet' : 'meters',
              distanceUnit: settings.altitudeUnit === 'meters' ? 'feet' : 'meters'
            })}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: 'white',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              transition: 'all 0.15s'
            }}
            title="Zwischen Meter und Fuß umschalten"
          >
            {settings.altitudeUnit === 'meters' ? 'm' : 'ft'}
          </button>
          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: showSettings ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
              border: 'none',
              color: showSettings ? '#3b82f6' : 'rgba(255,255,255,0.4)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px'
            }}
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '12px',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px' }}>
            Felder anzeigen/verbergen:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {fields.map(field => (
              <div
                key={field.id}
                onClick={() => updateField(field.id, { enabled: !field.enabled })}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: field.enabled ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.03)',
                  border: field.enabled ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '4px'
                }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: field.enabled ? '#22c55e' : 'rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    color: 'white'
                  }}>
                    {field.enabled && '✓'}
                  </div>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: field.enabled ? '#22c55e' : 'rgba(255,255,255,0.6)'
                  }}>
                    {field.label}
                  </span>
                </div>
                <div style={{
                  fontSize: '10px',
                  color: 'rgba(255,255,255,0.4)',
                  paddingLeft: '24px',
                  lineHeight: 1.3
                }}>
                  {getFieldDescription(field.type)}
                </div>
              </div>
            ))}
          </div>

          {/* Trennlinie */}
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '12px 0' }} />

          {/* GPS Simulation Button */}
          <button
            onClick={() => {
              setShowSettings(false)
              if (!showGpsSimPanel) setShowCoursePanel(false)
              setShowGpsSimPanel(!showGpsSimPanel)
            }}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              background: gpsSimulation.active
                ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.1))'
                : 'rgba(255,255,255,0.05)',
              border: gpsSimulation.active
                ? '1px solid rgba(34, 197, 94, 0.4)'
                : '1px solid rgba(255,255,255,0.1)',
              color: gpsSimulation.active ? '#22c55e' : 'rgba(255,255,255,0.7)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.15s'
            }}
          >
            <span style={{ fontSize: '18px' }}>🛰️</span>
            <span>GPS Simulation</span>
            {gpsSimulation.active && (
              <span style={{
                background: '#22c55e',
                color: 'black',
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 700,
                marginLeft: '4px'
              }}>AKTIV</span>
            )}
          </button>
        </div>
      )}

      {/* Navigationsfelder - Hauptbereich */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {enabledFields.map(field => {
          const { value, unit, color: dynamicColor } = getFieldValue(field)
          const isSelected = editingField === field.id
          const fieldFontSize = field.fontSizePx ? `${field.fontSizePx}px` : fontSizeMap[field.fontSize]
          const fieldPadding = field.fieldHeight ? `${Math.max(4, (field.fieldHeight - 20) / 2)}px 10px` : '6px 10px'

          return (
            <div
              key={field.id}
              onDoubleClick={() => setEditingField(isSelected ? null : field.id)}
              style={{
                padding: fieldPadding,
                borderRadius: '8px',
                background: isSelected
                  ? 'rgba(59, 130, 246, 0.15)'
                  : field.bgColor || 'rgba(255,255,255,0.03)',
                border: isSelected ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'default',
                transition: 'all 0.15s'
              }}
            >
              {/* Label */}
              <div style={{
                fontSize: '12px',
                color: 'rgba(255,255,255,0.5)',
                fontWeight: 600,
                letterSpacing: '0.5px',
                minWidth: '40px'
              }}>
                {field.label}
              </div>

              {/* Wert */}
              <div style={{
                fontSize: fieldFontSize,
                fontWeight: 700,
                color: dynamicColor || field.color,
                fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                display: 'flex',
                alignItems: 'baseline',
                gap: '4px'
              }}>
                <span>{value}</span>
                <span style={{
                  fontSize: '0.45em',
                  opacity: 0.6,
                  fontWeight: 500
                }}>{unit}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Trennlinie */}
      <div style={{
        height: '1px',
        background: 'rgba(255,255,255,0.08)',
        margin: '10px 0'
      }} />

      {/* Action Buttons - kompakt horizontal */}
      <div style={{
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap'
      }}>
        {/* DROP Button */}
        <button
          onClick={() => dropMarker()}
          disabled={!gpsData}
          style={{
            flex: 1,
            minWidth: '60px',
            padding: '8px 10px',
            borderRadius: '6px',
            background: gpsData ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
            border: 'none',
            color: gpsData ? '#ef4444' : 'rgba(255,255,255,0.3)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: gpsData ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '12px' }}>🎯</span>
          DROP
        </button>

        {/* Drops Liste Button */}
        <button
          onClick={() => {
            if (!showDropsPanel) setShowCoursePanel(false) // Schließe Kurs-Panel
            setShowDropsPanel(!showDropsPanel)
          }}
          style={{
            minWidth: '40px',
            padding: '8px 10px',
            borderRadius: '6px',
            background: (showDropsPanel || markers.length > 0)
              ? 'rgba(239, 68, 68, 0.15)'
              : 'rgba(255,255,255,0.03)',
            border: 'none',
            color: (showDropsPanel || markers.length > 0) ? '#ef4444' : 'rgba(255,255,255,0.5)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '12px' }}>📋</span>
          {markers.length > 0 && markers.length}
        </button>

        {/* Kurslinien Button */}
        <button
          onClick={() => {
            if (!showCoursePanel) { setShowDropsPanel(false); setShowGpsSimPanel(false) }
            setShowCoursePanel(!showCoursePanel)
          }}
          style={{
            flex: 1,
            minWidth: '50px',
            padding: '8px 10px',
            borderRadius: '6px',
            background: (showCoursePanel || hdgCourseLines.length > 0)
              ? 'rgba(245, 158, 11, 0.15)'
              : 'rgba(255,255,255,0.03)',
            border: 'none',
            color: (showCoursePanel || hdgCourseLines.length > 0) ? '#f59e0b' : 'rgba(255,255,255,0.5)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            transition: 'all 0.15s'
          }}
        >
          <span style={{ fontSize: '12px' }}>📐</span>
          {hdgCourseLines.length > 0 ? hdgCourseLines.length : ''}
        </button>


      </div>
    </div>

      {/* Rechtes Panel für Feld-Editor (bei Doppelklick) */}
      {editingField && (() => {
        const currentField = fields.find(f => f.id === editingField)
        if (!currentField) return null
        const currentFontSize = currentField.fontSizePx ?? fontSizeToNumber(currentField.fontSize)
        const currentFieldHeight = currentField.fieldHeight ?? 32

        return (
          <div
            style={{
              position: 'fixed',
              ...subPanelPosition,
              top: position.y,
              zIndex: 1001,
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              padding: '16px',
              minWidth: '220px',
              maxWidth: '280px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              transform: `scale(${scale})`,
              transformOrigin: subPanelOnRight ? 'top left' : 'top right'
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              paddingBottom: '12px',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#3b82f6'
              }}>
                {currentField.label} bearbeiten
              </div>
              <button
                onClick={() => setEditingField(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Beschreibung */}
            <div style={{
              fontSize: '11px',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '16px',
              lineHeight: 1.4
            }}>
              {getFieldDescription(currentField.type)}
            </div>

            {/* Position */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                Position
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => moveField(editingField, 'up')}
                  disabled={fields.findIndex(f => f.id === editingField) === 0}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: fields.findIndex(f => f.id === editingField) === 0 ? 'rgba(255,255,255,0.2)' : 'white',
                    fontSize: '14px',
                    cursor: fields.findIndex(f => f.id === editingField) === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  ▲ Nach oben
                </button>
                <button
                  onClick={() => moveField(editingField, 'down')}
                  disabled={fields.findIndex(f => f.id === editingField) === fields.length - 1}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: fields.findIndex(f => f.id === editingField) === fields.length - 1 ? 'rgba(255,255,255,0.2)' : 'white',
                    fontSize: '14px',
                    cursor: fields.findIndex(f => f.id === editingField) === fields.length - 1 ? 'not-allowed' : 'pointer'
                  }}
                >
                  ▼ Nach unten
                </button>
              </div>
            </div>

            {/* Schriftgröße Slider */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                  Schriftgröße
                </span>
                <span style={{
                  fontSize: '13px',
                  color: '#3b82f6',
                  fontWeight: 600,
                  fontFamily: 'monospace'
                }}>
                  {currentFontSize}px
                </span>
              </div>
              <input
                type="range"
                min="12"
                max="48"
                value={currentFontSize}
                onChange={(e) => {
                  const px = parseInt(e.target.value)
                  updateField(editingField, {
                    fontSizePx: px,
                    fontSize: numberToFontSize(px)
                  })
                }}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'rgba(255,255,255,0.1)',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '4px'
              }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>12px</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>48px</span>
              </div>
            </div>

            {/* Feldhöhe Slider */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                  Feldhöhe
                </span>
                <span style={{
                  fontSize: '13px',
                  color: '#3b82f6',
                  fontWeight: 600,
                  fontFamily: 'monospace'
                }}>
                  {currentFieldHeight}px
                </span>
              </div>
              <input
                type="range"
                min="24"
                max="60"
                value={currentFieldHeight}
                onChange={(e) => updateField(editingField, { fieldHeight: parseInt(e.target.value) })}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'rgba(255,255,255,0.1)',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '4px'
              }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>24px</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>60px</span>
              </div>
            </div>

            {/* Textfarbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                Textfarbe
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {colorOptions.map(c => (
                  <button
                    key={c}
                    onClick={() => updateField(editingField, { color: c })}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: c,
                      border: currentField.color === c
                        ? '3px solid #3b82f6'
                        : '2px solid rgba(255,255,255,0.2)',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Hintergrundfarbe */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                Hintergrund
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {bgColorOptions.map(c => (
                  <button
                    key={c}
                    onClick={() => updateField(editingField, { bgColor: c === 'transparent' ? undefined : c })}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: c === 'transparent'
                        ? 'repeating-linear-gradient(45deg, #444, #444 4px, #333 4px, #333 8px)'
                        : c,
                      border: (currentField.bgColor === c) || (c === 'transparent' && !currentField.bgColor)
                        ? '3px solid #3b82f6'
                        : '2px solid rgba(255,255,255,0.2)',
                      cursor: 'pointer'
                    }}
                    title={c === 'transparent' ? 'Kein Hintergrund' : ''}
                  />
                ))}
              </div>
            </div>

            {/* Fertig Button */}
            <button
              onClick={() => setEditingField(null)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: '#3b82f6',
                border: 'none',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Fertig
            </button>
          </div>
        )
      })()}

      {/* Rechtes Panel für Kurslinien */}
      {showCoursePanel && (
        <div
          style={{
            position: 'fixed',
            ...subPanelPosition,
            top: position.y,
            zIndex: 1001,
            background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '16px',
            minWidth: '220px',
            maxWidth: '280px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            transform: `scale(${scale})`,
            transformOrigin: subPanelOnRight ? 'top left' : 'top right'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#f59e0b'
            }}>
              KURS-LINIEN
            </div>
            <button
              onClick={() => setShowCoursePanel(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Linientyp-Auswahl */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
              Linientyp
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[
                { mode: 'from' as const, label: 'Zu', icon: '→' },
                { mode: 'to' as const, label: 'Von', icon: '←' },
                { mode: 'extended' as const, label: 'Beides', icon: '↔' }
              ].map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  onClick={() => setHdgPendingLineMode(mode)}
                  style={{
                    flex: 1,
                    padding: '8px 6px',
                    borderRadius: '6px',
                    background: hdgPendingLineMode === mode
                      ? '#f59e0b'
                      : 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: hdgPendingLineMode === mode ? 'black' : 'rgba(255,255,255,0.7)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Kurs-Eingabe */}
          {showCourseInput ? (
            <div style={{
              padding: '12px',
              background: editingCourseLineId
                ? 'rgba(59, 130, 246, 0.1)'
                : hdgCourseMode
                  ? 'rgba(34, 197, 94, 0.15)'
                  : 'rgba(245, 158, 11, 0.1)',
              borderRadius: '10px',
              border: `1px solid ${editingCourseLineId
                ? 'rgba(59, 130, 246, 0.3)'
                : hdgCourseMode
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(245, 158, 11, 0.2)'}`,
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>
                {editingCourseLineId ? 'Kurs bearbeiten (0-360°)' : 'Kurs eingeben (0-360°)'}
              </div>
              <input
                type="number"
                min="0"
                max="360"
                value={courseInputValue}
                onChange={e => handleCourseInputChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCourseInputDone()
                  if (e.key === 'Escape') {
                    setShowCourseInput(false)
                    setCourseInputValue('')
                    setEditingCourseLineId(null)
                    if (!editingCourseLineId) setHdgCourseMode(false)
                  }
                }}
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.4)',
                  color: 'white',
                  fontSize: '18px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  boxSizing: 'border-box'
                }}
                placeholder="180"
              />
              {!editingCourseLineId && hdgCourseMode && (
                <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '8px', fontWeight: 600 }}>
                  Jetzt auf Karte oder Ziel klicken
                </div>
              )}
              {!editingCourseLineId && !hdgCourseMode && courseInputValue && (
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
                  Gueltigen Kurs eingeben (0-360)
                </div>
              )}
              <button
                onClick={() => {
                  setShowCourseInput(false)
                  setCourseInputValue('')
                  setEditingCourseLineId(null)
                  if (!editingCourseLineId) setHdgCourseMode(false)
                }}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '8px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                {editingCourseLineId ? 'Fertig' : 'Abbrechen'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleHdgCourseClick}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#f59e0b',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '12px'
              }}
            >
              <span style={{ fontSize: '18px' }}>+</span>
              Neue Kurslinie ({hdgCourseLines.length}/3)
            </button>
          )}

          {/* Aktive Kurslinien */}
          {hdgCourseLines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {hdgCourseLines.map((line) => {
                const isRepositioning = editingHdgCourseLineId === line.id
                return (
                <div
                  key={line.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '12px 14px',
                    background: isRepositioning ? 'rgba(34, 197, 94, 0.1)' : editingCourseLineId === line.id ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255,255,255,0.03)',
                    borderRadius: '10px',
                    border: `2px solid ${isRepositioning ? '#22c55e' : editingCourseLineId === line.id ? '#3b82f6' : line.color + '40'}`
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                      onClick={() => handleEditCourseLine(line)}
                      title="Kurs bearbeiten"
                    >
                      <div style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: line.color,
                        boxShadow: `0 0 8px ${line.color}80`
                      }} />
                      <span style={{
                        fontSize: '22px',
                        fontWeight: 700,
                        color: line.color,
                        fontFamily: 'monospace'
                      }}>
                        {line.course.toFixed(0).padStart(3, '0')}°
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ marginLeft: '4px' }}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </div>
                    <button
                      onClick={() => removeHdgCourseLine(line.id)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '16px',
                        cursor: 'pointer',
                        padding: '6px 12px',
                        borderRadius: '6px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {/* Position ändern Button */}
                  {isRepositioning ? (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      background: 'rgba(34, 197, 94, 0.15)',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>
                        Jetzt auf Karte klicken
                      </span>
                      <button
                        onClick={() => setEditingHdgCourseLineId(null)}
                        style={{
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          color: 'rgba(255,255,255,0.7)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: '4px'
                        }}
                      >
                        Abbrechen
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingCourseLineId(null)
                        setShowCourseInput(false)
                        setEditingHdgCourseLineId(line.id)
                      }}
                      style={{
                        marginTop: '8px',
                        padding: '6px 10px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      Position ändern
                    </button>
                  )}
                </div>
              )})}

              {/* Alle löschen Button */}
              <button
                onClick={clearAllHdgCourseLines}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Alle Kurslinien löschen
              </button>
            </div>
          )}

          {/* Schließen Button */}
          <button
            onClick={() => setShowCoursePanel(false)}
            style={{
              width: '100%',
              marginTop: '16px',
              padding: '12px',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'white',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Schließen
          </button>
        </div>
      )}

      {/* GPS Simulation Panel - schwebendes Fenster */}
      {showGpsSimPanel && (
        <div
          style={{
            position: 'fixed',
            ...subPanelPosition,
            top: position.y,
            zIndex: 1001,
            background: gpsSimulation.active
              ? 'linear-gradient(180deg, rgba(22,101,52,0.95) 0%, rgba(15,23,42,0.98) 30%)'
              : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '16px',
            minWidth: '240px',
            maxWidth: '280px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            border: gpsSimulation.active ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.1)',
            transform: `scale(${scale})`,
            transformOrigin: subPanelOnRight ? 'top left' : 'top right'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: gpsSimulation.active ? '#22c55e' : '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              GPS SIMULATION
              {gpsSimulation.active && (
                <span style={{
                  background: '#22c55e',
                  color: 'black',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '10px',
                  fontWeight: 700,
                  animation: 'pulse 2s infinite'
                }}>AKTIV</span>
              )}
            </div>
            <button
              onClick={() => setShowGpsSimPanel(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Startpunkt */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
              Startpunkt
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setGpsSimulationPickingStart(true)}
                disabled={gpsSimulation.active}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: gpsSimulation.pickingStartPoint
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : 'rgba(59,130,246,0.2)',
                  border: gpsSimulation.pickingStartPoint
                    ? '1px solid #f59e0b'
                    : '1px solid rgba(59,130,246,0.3)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: gpsSimulation.active ? 'not-allowed' : 'pointer',
                  opacity: gpsSimulation.active ? 0.5 : 1
                }}
              >
                {gpsSimulation.pickingStartPoint ? '⏳ Klicke auf Karte...' : '📍 Punkt wählen'}
              </button>
              {gpsSimulation.startPosition && (
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(34,197,94,0.1)',
                  borderRadius: '6px',
                  fontSize: '10px',
                  color: '#22c55e',
                  fontFamily: 'monospace',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  {gpsSimulation.startPosition.lat.toFixed(4)}, {gpsSimulation.startPosition.lon.toFixed(4)}
                </div>
              )}
            </div>
          </div>

          {/* Parameter Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            {/* Kurs */}
            <div style={{ opacity: gpsSimulation.followWind ? 0.4 : 1 }}>
              <div style={{ fontSize: '10px', color: gpsSimulation.followWind ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                Kurs (°) {gpsSimulation.followWind && '🌬️'}
              </div>
              <input
                type="number"
                min="0"
                max="360"
                value={gpsSimulation.heading}
                onChange={(e) => setGpsSimulationParams({ heading: parseInt(e.target.value) || 0 })}
                disabled={gpsSimulation.followWind}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: gpsSimulation.followWind ? 'rgba(59,130,246,0.1)' : 'rgba(0,0,0,0.3)',
                  border: gpsSimulation.followWind ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: gpsSimulation.followWind ? '#60a5fa' : 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Geschwindigkeit */}
            <div style={{ opacity: gpsSimulation.followWind ? 0.4 : 1 }}>
              <div style={{ fontSize: '10px', color: gpsSimulation.followWind ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                Speed (km/h) {gpsSimulation.followWind && '🌬️'}
              </div>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={gpsSimulation.speed}
                onChange={(e) => setGpsSimulationParams({ speed: parseFloat(e.target.value) || 0 })}
                disabled={gpsSimulation.followWind}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: gpsSimulation.followWind ? 'rgba(59,130,246,0.1)' : 'rgba(0,0,0,0.3)',
                  border: gpsSimulation.followWind ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: gpsSimulation.followWind ? '#60a5fa' : 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Höhe */}
            <div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                Höhe ({settings.altitudeUnit === 'feet' ? 'ft' : 'm'})
              </div>
              <input
                type="number"
                min="0"
                max={settings.altitudeUnit === 'feet' ? 33000 : 10000}
                step={settings.altitudeUnit === 'feet' ? 100 : 10}
                value={settings.altitudeUnit === 'feet'
                  ? Math.round(gpsSimulation.altitude * 3.28084)
                  : gpsSimulation.altitude
                }
                onChange={(e) => {
                  const inputValue = parseInt(e.target.value) || 0
                  const altitudeInMeters = settings.altitudeUnit === 'feet'
                    ? inputValue / 3.28084
                    : inputValue
                  setGpsSimulationParams({ altitude: altitudeInMeters })
                  if (gpsSimulation.active && simPositionRef.current) {
                    simPositionRef.current.altitude = altitudeInMeters
                  }
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Vario */}
            <div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                Vario (m/s)
              </div>
              <input
                type="number"
                min="-10"
                max="10"
                step="0.1"
                value={gpsSimulation.vario}
                onChange={(e) => setGpsSimulationParams({ vario: parseFloat(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: gpsSimulation.vario > 0 ? '#22c55e' : gpsSimulation.vario < 0 ? '#ef4444' : 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Wind folgen Toggle */}
          <button
            onClick={() => setGpsSimulationParams({ followWind: !gpsSimulation.followWind })}
            disabled={windLayers.length === 0}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: '10px',
              borderRadius: '8px',
              background: gpsSimulation.followWind
                ? 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(139,92,246,0.2))'
                : 'rgba(255,255,255,0.05)',
              border: gpsSimulation.followWind
                ? '1px solid rgba(59,130,246,0.5)'
                : '1px solid rgba(255,255,255,0.1)',
              color: gpsSimulation.followWind ? '#60a5fa' : 'rgba(255,255,255,0.5)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: windLayers.length === 0 ? 'not-allowed' : 'pointer',
              opacity: windLayers.length === 0 ? 0.4 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.15s'
            }}
            title={windLayers.length === 0 ? 'Keine Wind-Layer vorhanden' : 'Kurs und Speed aus aufgezeichneten Winden übernehmen'}
          >
            <span style={{ fontSize: '14px' }}>🌬️</span>
            <span>Wind folgen</span>
            {gpsSimulation.followWind && (
              <span style={{
                background: '#3b82f6',
                color: 'white',
                padding: '1px 6px',
                borderRadius: '8px',
                fontSize: '9px',
                fontWeight: 700
              }}>AN</span>
            )}
            {!gpsSimulation.followWind && windLayers.length > 0 && (
              <span style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: '10px',
                marginLeft: 'auto'
              }}>
                {windLayers.length} Layer
              </span>
            )}
          </button>
          {gpsSimulation.followWind && (
            <div style={{
              fontSize: '10px',
              color: 'rgba(96,165,250,0.7)',
              marginBottom: '10px',
              marginTop: '-6px',
              padding: '0 4px',
              lineHeight: '1.3'
            }}>
              Kurs + Speed aus Flight Winds. Nur Vario wird manuell gesteuert.
            </div>
          )}

          {/* Start/Stop Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {!gpsSimulation.active ? (
              <button
                onClick={startGpsSimulation}
                disabled={!gpsSimulation.startPosition}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: gpsSimulation.startPosition
                    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                    : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: gpsSimulation.startPosition ? 'pointer' : 'not-allowed',
                  opacity: gpsSimulation.startPosition ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <span>▶️</span> Start Simulation
              </button>
            ) : (
              <button
                onClick={stopGpsSimulation}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <span>⏹️</span> Stop Simulation
              </button>
            )}
          </div>
        </div>
      )}

      {/* Landeprognose Panel - eigenständiges schwebendes Fenster */}
      {showLandingPanel && (
        <div
          onMouseDown={handleToolMouseDown}
          onTouchStart={handleToolTouchStart}
          style={{
            ...toolPanelStyle(settings.landingPanelScale ?? 1, 'rgba(168,85,247,0.3)', showLandingPrediction),
            minWidth: '220px',
            maxWidth: '260px',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            paddingBottom: '8px',
            borderBottom: '1px solid rgba(168,85,247,0.2)'
          }}>
            <div style={{
              fontSize: '13px',
              fontWeight: 600,
              color: showLandingPrediction ? '#a855f7' : 'rgba(255,255,255,0.8)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              Landeprognose
              {landingPredictionLoading && (
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>...</span>
              )}
            </div>
            <button
              onClick={() => setActiveToolPanel(null)}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '16px', padding: '0 2px', lineHeight: 1
              }}
            >x</button>
          </div>

          {/* Sinkrate Regler */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Sinkrate
              </span>
              <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                {landingSinkRate.toFixed(1)} m/s
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={Math.round(landingSinkRate * 10)}
              onChange={e => setLandingSinkRate(Number(e.target.value) / 10)}
              style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
            />
          </div>

          {/* Aktivieren/Deaktivieren */}
          <button
            onClick={() => setShowLandingPrediction(!showLandingPrediction)}
            disabled={filteredWindLayers.length === 0}
            title={filteredWindLayers.length === 0 ? 'Mindestens eine Windschicht erforderlich' : ''}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '8px',
              border: 'none',
              background: showLandingPrediction
                ? 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(168,85,247,0.2))'
                : filteredWindLayers.length === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(168,85,247,0.1)',
              color: showLandingPrediction ? '#fff' : filteredWindLayers.length === 0 ? 'rgba(255,255,255,0.25)' : '#a855f7',
              fontSize: '12px',
              fontWeight: 600,
              cursor: filteredWindLayers.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              opacity: filteredWindLayers.length === 0 ? 0.5 : 1
            }}
          >
            {showLandingPrediction ? 'Ausblenden' : 'Anzeigen'}
          </button>

          {/* Wind-Info */}
          {filteredWindLayers.length === 0 && (
            <div style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.35)',
              marginTop: '6px', textAlign: 'center', fontStyle: 'italic'
            }}>
              Keine Windschichten. Bewege den Ballon um Wind zu messen.
            </div>
          )}

          {/* Ergebnis */}
          {landingPrediction && showLandingPrediction && (
            <div style={{
              marginTop: '8px', padding: '8px',
              background: 'rgba(0,0,0,0.3)', borderRadius: '8px',
              fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Entfernung</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {landingPrediction.totalDistanceMeters < 1000
                    ? `${Math.round(landingPrediction.totalDistanceMeters)} m`
                    : `${(landingPrediction.totalDistanceMeters / 1000).toFixed(1)} km`
                  }
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Flugzeit</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {Math.floor(landingPrediction.totalTimeSeconds / 60)}:{String(Math.floor(landingPrediction.totalTimeSeconds % 60)).padStart(2, '0')} min
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Boden</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {Math.round(landingPrediction.groundElevation)} m ({Math.round(landingPrediction.groundElevation * 3.28084)} ft)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Wind</span>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                  {filteredWindLayers.length}{windSourceFilter !== 'all' ? `/${windLayers.length}` : ''} Schichten
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drop Calculator Panel - eigenständiges schwebendes Fenster */}
      {showDropCalcPanel && (
        <div
          onMouseDown={handleToolMouseDown}
          onTouchStart={handleToolTouchStart}
          style={{
            ...toolPanelStyle(settings.markerPanelScale ?? 1, 'rgba(249, 115, 22, 0.3)', dropCalculator.active),
            minWidth: '220px',
            maxWidth: '260px',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '12px', paddingBottom: '8px',
            borderBottom: '1px solid rgba(249, 115, 22, 0.2)'
          }}>
            <div style={{
              fontSize: '13px', fontWeight: 600,
              color: dropCalculator.active ? '#f97316' : 'rgba(255,255,255,0.8)',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}>
              Marker Drop
              {dropCalculator.active && (
                <span style={{
                  background: '#f97316', color: 'black',
                  padding: '1px 6px', borderRadius: '8px', fontSize: '9px', fontWeight: 700
                }}>AKTIV</span>
              )}
            </div>
            <button
              onClick={() => setActiveToolPanel(null)}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '16px', padding: '0 2px', lineHeight: 1
              }}
            >x</button>
          </div>

          {/* Aktivieren/Deaktivieren */}
          <button
            onClick={() => setDropCalculatorActive(!dropCalculator.active)}
            disabled={filteredWindLayers.length === 0}
            style={{
              width: '100%', padding: '8px', borderRadius: '8px', border: 'none',
              background: dropCalculator.active
                ? 'linear-gradient(135deg, rgba(249,115,22,0.4), rgba(249,115,22,0.2))'
                : filteredWindLayers.length === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(249,115,22,0.1)',
              color: dropCalculator.active ? '#fff'
                : filteredWindLayers.length === 0 ? 'rgba(255,255,255,0.25)' : '#f97316',
              fontSize: '12px', fontWeight: 600,
              cursor: filteredWindLayers.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              opacity: filteredWindLayers.length === 0 ? 0.5 : 1
            }}
          >
            {dropCalculator.active ? 'Deaktivieren' : 'Aktivieren'}
          </button>

          {/* Wind-Info */}
          {filteredWindLayers.length === 0 && (
            <div style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.35)',
              marginTop: '6px', textAlign: 'center', fontStyle: 'italic'
            }}>
              Keine Windschichten vorhanden.
            </div>
          )}

          {/* Ergebnisse */}
          {dropCalculator.active && dropCalculator.impactPoint && (
            <div style={{
              marginTop: '8px', padding: '8px',
              background: 'rgba(0,0,0,0.3)', borderRadius: '8px',
              fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              {/* Abstand zum Ziel - farbcodiert nach MMA */}
              {dropCalculator.distanceToGoal !== null ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>Abstand Ziel</span>
                    <span style={{
                      fontWeight: 700, fontFamily: 'monospace', fontSize: '16px',
                      color: dropCalculator.dropNow ? '#22c55e'
                           : dropCalculator.insideMma ? '#eab308'
                           : '#ef4444'
                    }}>
                      {dropCalculator.distanceToGoal} m
                    </span>
                  </div>
                  {dropCalculator.insideMma && (
                    <div style={{
                      textAlign: 'center', fontSize: '10px', fontWeight: 700,
                      color: dropCalculator.dropNow ? '#22c55e' : '#eab308',
                      background: dropCalculator.dropNow ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                      borderRadius: '4px', padding: '2px 6px'
                    }}>
                      {dropCalculator.dropNow ? 'DROP JETZT!' : 'In MMA'}
                      {dropCalculator.mmaRadius && ` (${dropCalculator.mmaRadius}m)`}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', textAlign: 'center', fontStyle: 'italic' }}>
                  Kein Ziel ausgewählt
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Fallzeit</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {dropCalculator.timeToImpact !== null ? `${dropCalculator.timeToImpact.toFixed(1)} s` : '--'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Boden</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {dropCalculator.groundElevation !== null
                    ? `${Math.round(dropCalculator.groundElevation)} m (${Math.round(dropCalculator.groundElevation * 3.28084)} ft)`
                    : '--'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Wind</span>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                  {filteredWindLayers.length}{windSourceFilter !== 'all' ? `/${windLayers.length}` : ''} Schichten
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PDG/FON Berechnung Panel - eigenständiges schwebendes Fenster */}
      {showClimbPanel && (
        <div
          onMouseDown={handleToolMouseDown}
          onTouchStart={handleToolTouchStart}
          style={{
            ...toolPanelStyle(settings.climbPanelScale ?? 1, 'rgba(6, 182, 212, 0.3)', !!climbResult),
            minWidth: '240px',
            maxWidth: '280px',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '12px', paddingBottom: '8px',
            borderBottom: '1px solid rgba(6, 182, 212, 0.2)'
          }}>
            <div style={{
              fontSize: '13px', fontWeight: 600,
              color: '#06b6d4',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}>
              PDG/FON Berechnung
            </div>
            <button
              onClick={() => setActiveToolPanel(null)}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '16px', padding: '0 2px', lineHeight: 1
              }}
            >x</button>
          </div>

          {/* Richtung Toggle */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Richtung
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['up', 'down'] as const).map(dir => (
                <button
                  key={dir}
                  onClick={() => setClimbDirection(dir)}
                  style={{
                    flex: 1, padding: '6px', fontSize: '11px',
                    background: climbDirection === dir ? '#06b6d4' : 'rgba(255,255,255,0.05)',
                    color: 'white',
                    border: climbDirection === dir ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                  }}
                >
                  {dir === 'up' ? 'Steigen ▲' : 'Sinken ▼'}
                </button>
              ))}
            </div>
          </div>

          {/* Steigrate */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Steigrate
              </span>
              <span style={{ fontSize: '13px', color: '#06b6d4', fontWeight: 700, fontFamily: 'monospace' }}>
                {climbRate.toFixed(1)} m/s
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={Math.round(climbRate * 10)}
              onChange={e => setClimbRate(Number(e.target.value) / 10)}
              style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
            />
          </div>

          {/* Mindest-Höhenänderung */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Mindesthöhe
              </span>
              <span style={{ fontSize: '13px', color: '#06b6d4', fontWeight: 700, fontFamily: 'monospace' }}>
                {climbMinAltFt} ft
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="3000"
              step="100"
              value={climbMinAltFt}
              onChange={e => setClimbMinAltFt(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
            />
          </div>

          {/* Mindestentfernung */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Mindestentfernung
              </span>
              <span style={{ fontSize: '13px', color: '#06b6d4', fontWeight: 700, fontFamily: 'monospace' }}>
                {climbMinDist >= 1000 ? `${(climbMinDist / 1000).toFixed(1)} km` : `${climbMinDist} m`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="5000"
              step="100"
              value={climbMinDist}
              onChange={e => setClimbMinDist(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
            />
          </div>

          {/* Vorlaufzeit */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Vorlaufzeit
              </span>
              <span style={{ fontSize: '13px', color: climbLeadTime > 0 ? '#f59e0b' : '#06b6d4', fontWeight: 700, fontFamily: 'monospace' }}>
                {climbLeadTime > 0 ? `${climbLeadTime} sek` : 'Aus'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="120"
              step="5"
              value={climbLeadTime}
              onChange={e => setClimbLeadTime(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
            />
          </div>

          {/* Exakt-Modus Checkbox */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '12px', cursor: 'pointer',
            fontSize: '11px', color: 'rgba(255,255,255,0.7)'
          }}>
            <input
              type="checkbox"
              checked={climbExactMode}
              onChange={e => setClimbExactMode(e.target.checked)}
              style={{ accentColor: '#06b6d4', cursor: 'pointer', width: '14px', height: '14px' }}
            />
            <span>Exakte Werte (stoppt bei ft/m statt besten Punkt zu suchen)</span>
          </label>

          {/* Berechnen Button */}
          <button
            onClick={() => {
              if (!gpsData || !selectedGoal || filteredWindLayers.length === 0) return
              const currentAlt = baroData?.pressureAltitude || gpsData.altitude || 0
              const effectiveRate = climbDirection === 'up' ? climbRate : -climbRate
              const result = calculateClimbPoint(
                gpsData.latitude, gpsData.longitude, currentAlt,
                effectiveRate, climbMinAltFt, climbMinDist,
                filteredWindLayers,
                selectedGoal.position.latitude, selectedGoal.position.longitude,
                climbExactMode,
                climbLeadTime,
                30  // 30s Ramp-Up (Beschleunigungsphase)
              )
              setClimbResultLocal(result)
              setClimbPointResult(result ? {
                path: result.path,
                bestPoint: result.bestPoint,
                distanceToGoal: result.distanceToGoal
              } : null)
              // Countdown starten wenn Vorlaufzeit > 0
              setClimbCountdownStart(climbLeadTime > 0 && result ? Date.now() : null)
            }}
            disabled={!gpsData || !selectedGoal || filteredWindLayers.length === 0}
            style={{
              width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
              background: (!gpsData || !selectedGoal || filteredWindLayers.length === 0)
                ? 'rgba(255,255,255,0.03)'
                : '#06b6d4',
              color: (!gpsData || !selectedGoal || filteredWindLayers.length === 0)
                ? 'rgba(255,255,255,0.25)' : 'white',
              fontSize: '12px', fontWeight: 700,
              cursor: (!gpsData || !selectedGoal || filteredWindLayers.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (!gpsData || !selectedGoal || filteredWindLayers.length === 0) ? 0.5 : 1
            }}
          >
            Berechnen
          </button>

          {/* Fehlende Voraussetzungen */}
          {(!selectedGoal || filteredWindLayers.length === 0) && (
            <div style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.35)',
              marginTop: '6px', textAlign: 'center', fontStyle: 'italic'
            }}>
              {!selectedGoal && filteredWindLayers.length === 0
                ? 'Kein Ziel und keine Windschichten.'
                : !selectedGoal
                  ? 'Kein Ziel ausgewählt.'
                  : 'Keine Windschichten vorhanden.'}
            </div>
          )}

          {/* Live-Countdown */}
          {climbResult && climbResult.leadTime > 0 && climbCountdownRemaining !== null && (
            <div style={{
              marginTop: '10px', padding: '12px',
              background: climbCountdownRemaining <= 0
                ? 'rgba(239,68,68,0.15)'
                : climbCountdownRemaining <= 10
                  ? 'rgba(245,158,11,0.12)'
                  : 'rgba(34,197,94,0.1)',
              border: `1px solid ${
                climbCountdownRemaining <= 0
                  ? 'rgba(239,68,68,0.4)'
                  : climbCountdownRemaining <= 10
                    ? 'rgba(245,158,11,0.3)'
                    : 'rgba(34,197,94,0.2)'
              }`,
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              {climbCountdownRemaining <= 0 ? (
                <div style={{
                  fontSize: '20px', fontWeight: 800, fontFamily: 'monospace',
                  color: '#ef4444',
                  animation: 'pulse 1s infinite'
                }}>
                  JETZT {climbDirection === 'up' ? 'STEIGEN' : 'SINKEN'}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    {climbDirection === 'up' ? 'Steigen' : 'Sinken'} beginnen in
                  </div>
                  <div style={{
                    fontSize: '28px', fontWeight: 800, fontFamily: 'monospace',
                    color: climbCountdownRemaining <= 10 ? '#f59e0b' : '#22c55e',
                    letterSpacing: '1px'
                  }}>
                    {climbCountdownRemaining} sek
                  </div>
                </>
              )}
            </div>
          )}

          {/* Ergebnis */}
          {climbResult && (
            <div style={{
              marginTop: '10px', padding: '10px',
              background: 'rgba(0,0,0,0.3)', borderRadius: '8px',
              fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Abstand Ziel</span>
                <span style={{
                  fontWeight: 700, fontFamily: 'monospace', fontSize: '16px',
                  color: (goalDistance ?? Infinity) < 100 ? '#22c55e'
                       : (goalDistance ?? Infinity) < 500 ? '#eab308'
                       : '#ef4444'
                }}>
                  {goalDistance !== null ? `${Math.round(goalDistance)} m` : '-- m'}
                </span>
              </div>
              {/* Benötigte Rate – Echtzeit basierend auf Distanz und Höhendifferenz */}
              {(() => {
                if (!gpsData || !selectedGoal) return null
                const currentAlt = baroData?.pressureAltitude || gpsData.altitude || 0
                const targetAlt = climbResult.bestPoint.altitude
                const altDiff = targetAlt - currentAlt  // Positiv = muss steigen, negativ = muss sinken
                // Horizontaldistanz zum berechneten Punkt
                const hDist = calculateDistance(
                  gpsData.latitude, gpsData.longitude,
                  climbResult.bestPoint.lat, climbResult.bestPoint.lon
                )
                // Geschwindigkeit des Ballons in m/s
                const speedMs = (gpsData.speed || 0) / 3.6
                if (speedMs < 0.5 || hDist < 10) return null  // Zu langsam oder schon da
                const timeToPoint = hDist / speedMs  // Sekunden bis zum Punkt
                const requiredRate = altDiff / timeToPoint  // m/s die nötig sind
                const absRate = Math.abs(requiredRate)
                const direction = requiredRate > 0.05 ? 'steigen' : requiredRate < -0.05 ? 'sinken' : 'halten'
                return (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 8px', marginTop: '2px', marginBottom: '2px',
                    background: 'rgba(6,182,212,0.08)',
                    border: '1px solid rgba(6,182,212,0.2)',
                    borderRadius: '6px'
                  }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                      Benötigte Rate
                    </span>
                    <span style={{
                      fontWeight: 700, fontFamily: 'monospace', fontSize: '14px',
                      color: direction === 'steigen' ? '#22c55e'
                           : direction === 'sinken' ? '#ef4444'
                           : '#06b6d4'
                    }}>
                      {direction === 'halten' ? '~ 0 m/s'
                       : `${requiredRate > 0 ? '+' : ''}${requiredRate.toFixed(1)} m/s`}
                    </span>
                  </div>
                )
              })()}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Höhenänderung</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {climbResult.altitudeChange > 0 ? '+' : ''}{Math.round(climbResult.altitudeChange * 3.28084)} ft
                  <span style={{ fontSize: '9px', opacity: 0.6, marginLeft: '4px' }}>
                    ({climbResult.altitudeChange > 0 ? '+' : ''}{climbResult.altitudeChange} m)
                  </span>
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{climbDirection === 'up' ? 'Steigzeit' : 'Sinkzeit'}</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {Math.floor(climbResult.climbTime / 60)}:{String(climbResult.climbTime % 60).padStart(2, '0')} min
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Zielhöhe</span>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {Math.round(climbResult.bestPoint.altitude * 3.28084)} ft
                </span>
              </div>

              {/* Koordinaten des berechneten Punktes */}
              <div style={{
                marginTop: '4px', padding: '10px',
                background: 'rgba(34,197,94,0.1)', borderRadius: '6px',
                border: '1px solid rgba(34,197,94,0.2)'
              }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', marginBottom: '6px' }}>
                  Neue Ziel-Position
                </div>
                {/* Höhe prominent */}
                <div style={{
                  fontFamily: 'monospace', fontSize: '20px', fontWeight: 700,
                  color: '#22c55e', letterSpacing: '0.5px'
                }}>
                  {Math.round(climbResult.bestPoint.altitude * 3.28084)} ft
                  <span style={{ fontSize: '11px', opacity: 0.5, marginLeft: '6px', fontWeight: 400 }}>
                    ({Math.round(climbResult.bestPoint.altitude)} m)
                  </span>
                </div>
                {/* Koordinaten im eingestellten Format - ohne Zone, prominent */}
                <div style={{
                  fontFamily: 'monospace', fontSize: '18px', fontWeight: 700,
                  color: '#fff', marginTop: '6px', letterSpacing: '0.5px'
                }}>
                  {(() => {
                    const fmt = settings.coordinateFormat
                    if (fmt.startsWith('mgrs')) {
                      const coord = formatCoordinate(climbResult.bestPoint.lat, climbResult.bestPoint.lon, fmt, effectiveUtmZone)
                      // Zone und 100km-Quadrant entfernen, nur Easting/Northing anzeigen
                      return coord.replace(/^\d{1,2}[C-X]\s+[A-Z]{2}\s+/, '')
                    }
                    if (fmt === 'utm') {
                      const coord = formatCoordinate(climbResult.bestPoint.lat, climbResult.bestPoint.lon, fmt, effectiveUtmZone)
                      // Zone entfernen (z.B. "34U 351614E 5533774N" → "351614E 5533774N")
                      return coord.replace(/^\d{1,2}[C-X]\s+/, '')
                    }
                    return formatCoordinate(climbResult.bestPoint.lat, climbResult.bestPoint.lon, fmt, effectiveUtmZone)
                  })()}
                </div>
              </div>

              {/* Ziel versetzen Button */}
              <button
                onClick={() => {
                  if (!climbResult || !selectedGoal) return
                  const bp = climbResult.bestPoint

                  // Ausgewählten Goal auf berechnete Position versetzen
                  const updatedGoal: Goal = {
                    ...selectedGoal,
                    position: {
                      ...selectedGoal.position,
                      latitude: bp.lat,
                      longitude: bp.lon,
                      altitude: bp.altitude,
                      timestamp: new Date()
                    }
                  }

                  // Task finden der diesen Goal enthält und Goal darin aktualisieren
                  const parentTask = tasks.find(t => t.goals.some(g => g.id === selectedGoal.id))
                  if (parentTask) {
                    const updated: Task = {
                      ...parentTask,
                      goals: parentTask.goals.map(g => g.id === selectedGoal.id ? updatedGoal : g)
                    }
                    updateTask(updated)
                  }

                  // Aktualisierten Goal auswählen
                  setSelectedGoal(updatedGoal)
                }}
                style={{
                  marginTop: '4px', width: '100%', padding: '8px',
                  borderRadius: '6px', border: 'none',
                  background: '#22c55e',
                  color: 'white',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer'
                }}
              >
                Ziel versetzen ({goalDistance !== null ? `${Math.round(goalDistance)} m` : '--'})
              </button>

              {/* Löschen Button */}
              <button
                onClick={() => { setClimbResultLocal(null); setClimbPointResult(null); setClimbCountdownStart(null) }}
                style={{
                  marginTop: '4px', width: '100%', padding: '6px',
                  borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'rgba(255,255,255,0.5)',
                  fontSize: '10px', cursor: 'pointer'
                }}
              >
                Ergebnis löschen
              </button>
            </div>
          )}

          {/* Kein Ergebnis */}
          {climbResult === null && gpsData && selectedGoal && filteredWindLayers.length > 0 && (
            <div style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.35)',
              marginTop: '6px', textAlign: 'center', fontStyle: 'italic'
            }}>
              Klicke "Berechnen" um den optimalen Punkt zu finden.
            </div>
          )}
        </div>
      )}

      {/* Land Run Rechner Panel - eigenständiges schwebendes Fenster */}
      {showLandRunPanel && (
        <div
          onMouseDown={handleToolMouseDown}
          onTouchStart={handleToolTouchStart}
          style={{
            ...toolPanelStyle(settings.lrnPanelScale ?? 1, 'rgba(34, 197, 94, 0.3)', !!lrnResult),
            minWidth: '240px',
            maxWidth: '280px',
            maxHeight: '80vh',
            overflowY: 'auto' as const,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#22c55e' }}>
              △ Land Run
            </div>
            <button
              onClick={() => {
                setActiveToolPanel(null)
                setLrnResult(null)
                setLandRunResult(null)
              }}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '16px', padding: '2px 6px'
              }}
            >×</button>
          </div>

          {/* Limit-Modus Auswahl */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Limit-Modus
            </div>
            <div style={{ display: 'flex', gap: '3px' }}>
              {([
                { key: 'leg1' as const, label: 'Leg 1' },
                { key: 'leg1+leg2' as const, label: 'L1+L2' },
                { key: 'total' as const, label: 'Gesamt' }
              ]).map(m => (
                <button
                  key={m.key}
                  onClick={() => setLrnLimitMode(m.key)}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: '5px',
                    border: 'none', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer',
                    background: lrnLimitMode === m.key ? '#22c55e' : 'rgba(255,255,255,0.06)',
                    color: lrnLimitMode === m.key ? 'white' : 'rgba(255,255,255,0.5)'
                  }}
                >{m.label}</button>
              ))}
            </div>
          </div>

          {/* Einheit Auswahl */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              {([
                { key: 'min' as const, label: 'Minuten' },
                { key: 'km' as const, label: 'Kilometer' }
              ]).map(u => (
                <button
                  key={u.key}
                  onClick={() => setLrnLimitUnit(u.key)}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: '5px',
                    border: 'none', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer',
                    background: lrnLimitUnit === u.key ? '#22c55e' : 'rgba(255,255,255,0.06)',
                    color: lrnLimitUnit === u.key ? 'white' : 'rgba(255,255,255,0.5)'
                  }}
                >{u.label}</button>
              ))}
            </div>
          </div>

          {/* Leg 1 Limit Slider */}
          {(lrnLimitMode === 'leg1' || lrnLimitMode === 'leg1+leg2') && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                  {lrnLimitMode === 'leg1' ? 'Leg-Dauer (A→B = B→C)' : 'Leg 1 (A→B)'}
                </span>
                <span style={{ fontSize: '13px', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                  {lrnLeg1Value} {lrnLimitUnit === 'min' ? 'Min' : 'km'}
                </span>
              </div>
              <input
                type="range"
                min={lrnLimitUnit === 'min' ? 3 : 1}
                max={lrnLimitUnit === 'min' ? 60 : 30}
                step="1"
                value={lrnLeg1Value}
                onChange={e => setLrnLeg1Value(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#22c55e', cursor: 'pointer' }}
              />
            </div>
          )}

          {/* Leg 2 Limit Slider (nur bei leg1+leg2) */}
          {lrnLimitMode === 'leg1+leg2' && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                  Leg 2 (B→C)
                </span>
                <span style={{ fontSize: '13px', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                  {lrnLeg2Value} {lrnLimitUnit === 'min' ? 'Min' : 'km'}
                </span>
              </div>
              <input
                type="range"
                min={lrnLimitUnit === 'min' ? 3 : 1}
                max={lrnLimitUnit === 'min' ? 60 : 30}
                step="1"
                value={lrnLeg2Value}
                onChange={e => setLrnLeg2Value(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#22c55e', cursor: 'pointer' }}
              />
            </div>
          )}

          {/* Gesamt-Limit Slider (nur bei total) */}
          {lrnLimitMode === 'total' && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                  Gesamt (A→C)
                </span>
                <span style={{ fontSize: '13px', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                  {lrnTotalValue} {lrnLimitUnit === 'min' ? 'Min' : 'km'}
                </span>
              </div>
              <input
                type="range"
                min={lrnLimitUnit === 'min' ? 5 : 2}
                max={lrnLimitUnit === 'min' ? 120 : 60}
                step="1"
                value={lrnTotalValue}
                onChange={e => setLrnTotalValue(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#22c55e', cursor: 'pointer' }}
              />
            </div>
          )}

          {/* Höhenbegrenzung */}
          <div style={{ marginBottom: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: lrnAltLimit ? '8px' : '0' }}>
              <input
                type="checkbox"
                checked={lrnAltLimit}
                onChange={e => setLrnAltLimit(e.target.checked)}
                style={{ accentColor: '#22c55e', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>Höhenbegrenzung</span>
            </label>
            {lrnAltLimit && (
              <>
                <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
                  <button
                    onClick={() => setLrnAltLimitMode('ceiling')}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: '5px',
                      border: 'none', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                      background: lrnAltLimitMode === 'ceiling' ? '#22c55e' : 'rgba(255,255,255,0.06)',
                      color: lrnAltLimitMode === 'ceiling' ? 'white' : 'rgba(255,255,255,0.5)'
                    }}
                  >Obergrenze</button>
                  <button
                    onClick={() => setLrnAltLimitMode('floor')}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: '5px',
                      border: 'none', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                      background: lrnAltLimitMode === 'floor' ? '#22c55e' : 'rgba(255,255,255,0.06)',
                      color: lrnAltLimitMode === 'floor' ? 'white' : 'rgba(255,255,255,0.5)'
                    }}
                  >Von Boden bis</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    value={lrnAltLimitValue}
                    onChange={e => setLrnAltLimitValue(Number(e.target.value))}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.3)',
                      borderRadius: '5px', color: '#22c55e', fontSize: '13px',
                      fontWeight: 700, fontFamily: 'monospace', textAlign: 'center'
                    }}
                  />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>ft</span>
                </div>
              </>
            )}
          </div>

          {/* Steigrate Slider */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Steig-/Sinkrate
              </span>
              <span style={{ fontSize: '13px', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                {lrnClimbRate.toFixed(1)} m/s
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              value={Math.round(lrnClimbRate * 10)}
              onChange={e => setLrnClimbRate(Number(e.target.value) / 10)}
              style={{ width: '100%', accentColor: '#22c55e', cursor: 'pointer' }}
            />
          </div>

          {/* Berechnen Button */}
          <button
            onClick={() => {
              if (!gpsData || filteredWindLayers.length < 2 || lrnCalculating) return
              const currentAlt = baroData?.pressureAltitude || gpsData.altitude || 0
              const bounds = activeCompetitionMap?.bounds || null
              const lrnLimits: LandRunLimits = {
                mode: lrnLimitMode,
                unit: lrnLimitUnit,
                leg1Value: lrnLeg1Value,
                leg2Value: lrnLeg2Value,
                totalValue: lrnTotalValue
              }
              setLrnCalculating(true)
              // Windschichten nach Höhenbegrenzung filtern (auf Basis der quellgefilterten Layers)
              let lrnWindLayers = filteredWindLayers
              if (lrnAltLimit) {
                const limitAltM = lrnAltLimitValue / 3.28084 // ft → m
                if (lrnAltLimitMode === 'ceiling') {
                  lrnWindLayers = filteredWindLayers.filter(l => l.altitude <= limitAltM)
                } else {
                  lrnWindLayers = filteredWindLayers.filter(l => l.altitude >= limitAltM)
                }
              }
              if (lrnWindLayers.length < 2) {
                setLrnResult(null)
                setLandRunResult(null)
                setLrnCalculating(false)
                return
              }
              // setTimeout damit React erst den "Berechne..." State rendern kann
              setTimeout(() => {
                const result = calculateLandRun(
                  gpsData.latitude, gpsData.longitude, currentAlt,
                  lrnClimbRate,
                  lrnWindLayers,
                  lrnLimits,
                  bounds ? { north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west } : null
                )
                setLrnResult(result)
                setLrnSelectedAlt(-1)
                if (result) {
                  setLandRunResult({
                    pointA: result.best.pointA,
                    pointB: result.best.pointB,
                    pointC: result.best.pointC,
                    pathAB: result.best.pathAB,
                    pathBC: result.best.pathBC,
                    approachPath: result.best.approachPath,
                    triangleArea: result.best.triangleArea
                  })
                } else {
                  setLandRunResult(null)
                }
                setLrnCalculating(false)
              }, 50)
            }}
            disabled={!gpsData || filteredWindLayers.length < 2 || lrnCalculating}
            style={{
              width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
              background: (!gpsData || filteredWindLayers.length < 2 || lrnCalculating)
                ? 'rgba(255,255,255,0.03)' : '#22c55e',
              color: (!gpsData || filteredWindLayers.length < 2 || lrnCalculating) ? 'rgba(255,255,255,0.25)' : 'white',
              fontSize: '12px', fontWeight: 700,
              cursor: (!gpsData || filteredWindLayers.length < 2 || lrnCalculating) ? 'not-allowed' : 'pointer',
              opacity: (!gpsData || filteredWindLayers.length < 2 || lrnCalculating) ? 0.5 : 1,
              marginBottom: '10px'
            }}
          >
            {lrnCalculating ? 'Berechne...' : 'Berechnen'}
          </button>

              {/* Fehlende Voraussetzungen */}
              {!gpsData && (
                <div style={{ fontSize: '10px', color: '#ef4444', textAlign: 'center' }}>
                  Kein GPS Signal
                </div>
              )}
              {gpsData && filteredWindLayers.length < 2 && (
                <div style={{ fontSize: '10px', color: '#ef4444', textAlign: 'center' }}>
                  Mind. 2 Windschichten nötig
                </div>
              )}
              {!activeCompetitionMap && (
                <div style={{ fontSize: '10px', color: '#f59e0b', textAlign: 'center', marginTop: '4px' }}>
                  Keine Wettkampfkarte aktiv - keine Begrenzung
                </div>
              )}

              {/* Ergebnis */}
              {lrnResult && (() => {
                const selected = lrnSelectedAlt === -1
                  ? lrnResult.best
                  : lrnResult.alternatives[lrnSelectedAlt]
                if (!selected) return null

                const altUnit = settings.altitudeUnit === 'meters' ? 'm' : 'ft'
                const fmtAlt = (m: number) => settings.altitudeUnit === 'feet'
                  ? Math.round(m * 3.28084)
                  : Math.round(m)

                return (
                  <div>
                    {/* Beste Option */}
                    <div style={{
                      background: 'rgba(34, 197, 94, 0.08)',
                      borderRadius: '8px', padding: '10px', marginBottom: '8px',
                      border: '1px solid rgba(34, 197, 94, 0.2)'
                    }}>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
                        {lrnSelectedAlt === -1 ? 'Beste Option' : `Alternative ${lrnSelectedAlt + 1}`}
                      </div>

                      {/* Fläche */}
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e', marginBottom: '6px' }}>
                        {selected.triangleArea >= 10000
                          ? `${(selected.triangleArea / 1000000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`
                          : `${selected.triangleArea} m²`
                        }
                      </div>

                      {/* Legs */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px',
                        fontSize: '11px', color: 'rgba(255,255,255,0.7)'
                      }}>
                        <div>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px' }}>LEG 1 (A→B)</span><br/>
                          {fmtAlt(selected.leg1Altitude)} {altUnit} MSL<br/>
                          {selected.leg1Wind.direction}° / {selected.leg1Wind.speedKmh} km/h<br/>
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                            {Math.round(selected.leg1Time / 60)} Min / {(selected.leg1Distance / 1000).toFixed(1)} km
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px' }}>LEG 2 (B→C)</span><br/>
                          {fmtAlt(selected.leg2Altitude)} {altUnit} MSL<br/>
                          {selected.leg2Wind.direction}° / {selected.leg2Wind.speedKmh} km/h<br/>
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                            {Math.round(selected.leg2Time / 60)} Min / {(selected.leg2Distance / 1000).toFixed(1)} km
                          </span>
                        </div>
                      </div>

                      <div style={{
                        marginTop: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.5)',
                        display: 'flex', justifyContent: 'space-between'
                      }}>
                        <span>Winkel: {selected.angleDifference}°</span>
                        <span>Gesamt: {Math.round(selected.totalTime / 60)} Min</span>
                      </div>

                      {/* Anflug-Info */}
                      {selected.approachTime > 0 && (
                        <div style={{
                          marginTop: '6px', padding: '4px 6px', borderRadius: '4px',
                          background: 'rgba(59, 130, 246, 0.1)',
                          fontSize: '10px', color: 'rgba(255,255,255,0.5)'
                        }}>
                          Anflug: ~{Math.round(selected.approachTime / 60)} Min zum Startpunkt
                        </div>
                      )}
                    </div>

                    {/* Ziel verschieben Button - nur wenn ein Ziel ausgewählt ist */}
                    {selectedGoal && (
                      <button
                        onClick={() => {
                          if (!selected) return
                          const activeTask = tasks.find(t => t.isActive && t.goals.some(g => g.id === selectedGoal?.id))
                          if (activeTask && selectedGoal) {
                            const updatedGoals = activeTask.goals.map(g =>
                              g.id === selectedGoal.id
                                ? {
                                    ...g,
                                    position: {
                                      ...g.position,
                                      latitude: selected.pointA.lat,
                                      longitude: selected.pointA.lon
                                    }
                                  }
                                : g
                            )
                            updateTask({ ...activeTask, goals: updatedGoals })
                            setSelectedGoal({
                              ...selectedGoal,
                              position: {
                                ...selectedGoal.position,
                                latitude: selected.pointA.lat,
                                longitude: selected.pointA.lon
                              }
                            })
                          }
                        }}
                        style={{
                          width: '100%', padding: '8px', borderRadius: '6px', border: 'none',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#3b82f6',
                          fontSize: '11px', fontWeight: 600,
                          cursor: 'pointer', marginBottom: '8px'
                        }}
                      >
                        Ziel auf LRN-Startpunkt verschieben
                      </button>
                    )}

                    {/* Alternativen */}
                    {lrnResult.alternatives.length > 0 && (
                      <div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>
                          Alternativen
                        </div>
                        {lrnResult.alternatives.map((alt, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setLrnSelectedAlt(lrnSelectedAlt === idx ? -1 : idx)
                              const opt = lrnSelectedAlt === idx ? lrnResult.best : alt
                              setLandRunResult({
                                pointA: opt.pointA,
                                pointB: opt.pointB,
                                pointC: opt.pointC,
                                pathAB: opt.pathAB,
                                pathBC: opt.pathBC,
                                approachPath: opt.approachPath,
                                triangleArea: opt.triangleArea
                              })
                            }}
                            style={{
                              width: '100%', padding: '6px 8px', marginBottom: '3px',
                              borderRadius: '6px', border: 'none',
                              background: lrnSelectedAlt === idx
                                ? 'rgba(34, 197, 94, 0.15)'
                                : 'rgba(255,255,255,0.03)',
                              color: lrnSelectedAlt === idx ? '#22c55e' : 'rgba(255,255,255,0.5)',
                              fontSize: '10px', cursor: 'pointer', textAlign: 'left',
                              display: 'flex', justifyContent: 'space-between'
                            }}
                          >
                            <span>{fmtAlt(alt.leg1Altitude)} → {fmtAlt(alt.leg2Altitude)} {altUnit}</span>
                            <span style={{ fontWeight: 600 }}>
                              {alt.triangleArea >= 10000
                                ? `${(alt.triangleArea / 1000000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`
                                : `${alt.triangleArea} m²`
                              }
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
        </div>
      )}

      {/* Panel für Marker Drops */}
      {showDropsPanel && (
        <div
          style={{
            position: 'fixed',
            ...subPanelPosition,
            top: position.y,
            zIndex: 1001,
            background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '16px',
            minWidth: '260px',
            maxWidth: '320px',
            maxHeight: '400px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            transform: `scale(${scale})`,
            transformOrigin: subPanelOnRight ? 'top left' : 'top right'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            paddingBottom: '12px',
            borderBottom: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#ef4444'
            }}>
              MARKER DROPS ({markers.length})
            </div>
            <button
              onClick={() => setShowDropsPanel(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Marker Liste */}
          {markers.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '12px',
              padding: '20px 0'
            }}>
              Noch keine Marker gesetzt
            </div>
          ) : (
            <div style={{
              maxHeight: '280px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {markers.map((marker, index) => {
                const utm = latLonToUTM(marker.position.latitude, marker.position.longitude)
                const easting = Math.round(utm.easting % 100000).toString().padStart(5, '0')
                const northing = Math.round(utm.northing % 100000).toString().padStart(5, '0')
                const time = new Date(marker.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                // Höhe je nach Einstellung formatieren
                const altitudeValue = settings.altitudeUnit === 'feet'
                  ? Math.round(marker.altitude * 3.28084)
                  : Math.round(marker.altitude)
                const altitudeUnit = settings.altitudeUnit === 'feet' ? 'ft' : 'm'

                return (
                  <div
                    key={marker.id}
                    onClick={() => {
                      setFlyToPosition({ lat: marker.position.latitude, lon: marker.position.longitude, zoom: 17 })
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)'
                    }}
                  >
                    {/* Marker Nummer */}
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: '#ef4444',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 700,
                      flexShrink: 0
                    }}>
                      {marker.number}
                    </div>

                    {/* Infos */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'white',
                        fontFamily: 'monospace'
                      }}>
                        {easting} / {northing}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.5)',
                        marginTop: '2px'
                      }}>
                        {time} • {altitudeValue}{altitudeUnit} MSL
                      </div>
                    </div>

                    {/* Löschen Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation() // Verhindert dass der Klick auf den ganzen Marker-Bereich weitergeleitet wird
                        removeMarker(marker.id)
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: 'rgba(255,255,255,0.4)',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px'
                      }}
                      title="Marker löschen"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Alle löschen Button */}
          {markers.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Alle Marker löschen?')) {
                  clearAllMarkers()
                }
              }}
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '10px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Alle löschen
            </button>
          )}
        </div>
      )}

      {/* APT (Altitude Profile Task) Panel */}
      {showAptPanel && (
        <AltitudeProfilePanel
          onClose={() => setActiveToolPanel(null)}
        />
      )}

      {/* ANG (Angle Task) Rechner Panel - eigenständiges schwebendes Fenster */}
      {showAngPanel && (
        <div
          onMouseDown={handleToolMouseDown}
          onTouchStart={handleToolTouchStart}
          style={{
            ...toolPanelStyle(settings.angPanelScale ?? 1, 'rgba(168, 85, 247, 0.3)', !!angResult),
            minWidth: '240px',
            maxWidth: '280px',
            maxHeight: '80vh',
            overflowY: 'auto' as const,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#a855f7' }}>
              ∠ ANG Berechnung
            </div>
            <button
              onClick={() => {
                setActiveToolPanel(null)
                setAngResultLocal(null)
                setAngleResult(null)
              }}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer', fontSize: '16px', padding: '2px 6px'
              }}
            >×</button>
          </div>

          {/* Punkt A Koordinaten (optional) */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Pkt A</span>
              <input
                type="text"
                value={angPointAEast}
                onChange={e => {
                  const val = e.target.value.replace(/[^0-9]/g, '')
                  setAngPointAEast(val)
                  if (val && angPointANorth) {
                    setAngPointALatLon(parseAngCoordinate(val, angPointANorth))
                  } else {
                    setAngPointALatLon(null)
                  }
                }}
                placeholder={settings.coordinateFormat === 'mgrs4' ? '1234' : settings.coordinateFormat === 'mgrs6' ? '123456' : settings.coordinateFormat === 'utm' ? 'East' : '12345'}
                maxLength={settings.coordinateFormat === 'utm' ? 7 : (settings.coordinateFormat === 'mgrs4' ? 4 : settings.coordinateFormat === 'mgrs6' ? 6 : 5)}
                style={{
                  width: '70px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(168,85,247,0.15)',
                  borderRadius: '3px', color: angPointALatLon ? '#22c55e' : '#a855f7', padding: '2px 4px', fontSize: '11px',
                  fontFamily: 'monospace', textAlign: 'center', outline: 'none'
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '9px' }}>/</span>
              <input
                type="text"
                value={angPointANorth}
                onChange={e => {
                  const val = e.target.value.replace(/[^0-9]/g, '')
                  setAngPointANorth(val)
                  if (angPointAEast && val) {
                    setAngPointALatLon(parseAngCoordinate(angPointAEast, val))
                  } else {
                    setAngPointALatLon(null)
                  }
                }}
                placeholder={settings.coordinateFormat === 'mgrs4' ? '5678' : settings.coordinateFormat === 'mgrs6' ? '567890' : settings.coordinateFormat === 'utm' ? 'North' : '56789'}
                maxLength={settings.coordinateFormat === 'utm' ? 7 : (settings.coordinateFormat === 'mgrs4' ? 4 : settings.coordinateFormat === 'mgrs6' ? 6 : 5)}
                style={{
                  width: '70px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(168,85,247,0.15)',
                  borderRadius: '3px', color: angPointALatLon ? '#22c55e' : '#a855f7', padding: '2px 4px', fontSize: '11px',
                  fontFamily: 'monospace', textAlign: 'center', outline: 'none'
                }}
              />
              {(angPointAEast || angPointANorth) && (
                <button
                  onClick={() => { setAngPointAEast(''); setAngPointANorth(''); setAngPointALatLon(null) }}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', lineHeight: 1 }}
                >×</button>
              )}
            </div>
            {angPointAEast && angPointANorth && !angPointALatLon && (
              <div style={{ fontSize: '8px', color: '#ef4444', marginTop: '1px', textAlign: 'center' }}>
                Ungültige Koordinaten
              </div>
            )}
          </div>

          {/* Richtung (setDirection) = Leg 1 */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Leg 1 Richtung (vorgegeben)
              </span>
              <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                {angSetDir}° {angSetDir >= 337.5 || angSetDir < 22.5 ? 'N' : angSetDir < 67.5 ? 'NE' : angSetDir < 112.5 ? 'E' : angSetDir < 157.5 ? 'SE' : angSetDir < 202.5 ? 'S' : angSetDir < 247.5 ? 'SW' : angSetDir < 292.5 ? 'W' : 'NW'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              step="1"
              value={angSetDir}
              onChange={e => setAngSetDir(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
            />
          </div>

          {/* Steig-/Sinkrate */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Steig-/Sinkrate
              </span>
              <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                {angClimbRate.toFixed(1)} m/s
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={angClimbRate * 10}
              onChange={e => setAngClimbRate(Number(e.target.value) / 10)}
              style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
            />
          </div>

          {/* Limit-Modus: km oder Minuten */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>
              B Limit
            </div>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
              {([
                { key: 'km' as const, label: 'Kilometer' },
                { key: 'min' as const, label: 'Minuten' }
              ]).map(u => (
                <button
                  key={u.key}
                  onClick={() => setAngLimitMode(u.key)}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: '5px',
                    border: 'none', fontSize: '10px', fontWeight: 600,
                    cursor: 'pointer',
                    background: angLimitMode === u.key ? '#a855f7' : 'rgba(255,255,255,0.06)',
                    color: angLimitMode === u.key ? 'white' : 'rgba(255,255,255,0.5)'
                  }}
                >{u.label}</button>
              ))}
            </div>
          </div>

          {angLimitMode === 'km' ? (
            <>
              {/* Min Distanz A→B */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                    Min Distanz (A→B)
                  </span>
                  <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                    {angMinDist.toFixed(1)} km
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="1"
                  value={Math.round(angMinDist * 10)}
                  onChange={e => {
                    const val = Number(e.target.value) / 10
                    setAngMinDist(val)
                    if (angMaxDist < val) setAngMaxDist(val)
                  }}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>

              {/* Max Distanz A→B */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                    Max Distanz (A→B)
                  </span>
                  <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                    {angMaxDist.toFixed(1)} km
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="150"
                  step="1"
                  value={Math.round(angMaxDist * 10)}
                  onChange={e => {
                    const val = Number(e.target.value) / 10
                    setAngMaxDist(val)
                    if (angMinDist > val) setAngMinDist(val)
                  }}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>
            </>
          ) : (
            <>
              {/* Min Zeit A→B */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                    Min Zeit (A→B)
                  </span>
                  <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                    {angMinTime} Min
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="59"
                  step="1"
                  value={angMinTime}
                  onChange={e => {
                    const val = Number(e.target.value)
                    setAngMinTime(val)
                    if (angMaxTime <= val) setAngMaxTime(val + 1)
                  }}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>
              {/* Max Zeit A→B */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                    Max Zeit (A→B)
                  </span>
                  <span style={{ fontSize: '13px', color: '#a855f7', fontWeight: 700, fontFamily: 'monospace' }}>
                    {angMaxTime} Min
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="60"
                  step="1"
                  value={angMaxTime}
                  onChange={e => {
                    const val = Number(e.target.value)
                    setAngMaxTime(val)
                    if (angMinTime >= val) setAngMinTime(val - 1)
                  }}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>
            </>
          )}

          {/* Berechnen Button */}
          <button
            onClick={() => {
              if ((!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating) return
              const currentAlt = baroData?.pressureAltitude || gpsData?.altitude || 0
              const pilotLat = gpsData?.latitude || 0
              const pilotLon = gpsData?.longitude || 0
              const bounds = activeCompetitionMap?.bounds || null
              setAngCalculating(true)
              setTimeout(() => {
                const result = calculateAngleTask(
                  pilotLat, pilotLon, currentAlt,
                  angClimbRate,
                  filteredWindLayers,
                  angSetDir,
                  angMinDist * 1000,
                  angMaxDist * 1000,
                  angLimitMode,
                  angMinTime * 60,
                  angMaxTime * 60,
                  bounds ? { north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west } : null,
                  angPointALatLon
                )
                setAngResultLocal(result)
                setAngSelectedAlt(-1)
                if (result) {
                  setAngleResult({
                    pointA: result.best.pointA,
                    pointB: result.best.pointB,
                    pathLeg1: result.best.pathLeg1,
                    pathLeg2: result.best.pathLeg2,
                    approachPath: result.best.approachPath,
                    achievedAngle: result.best.achievedAngle,
                    setDirection: angSetDir
                  })
                } else {
                  setAngleResult(null)
                }
                setAngCalculating(false)
              }, 50)
            }}
            disabled={(!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating}
            style={{
              width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
              background: ((!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating)
                ? 'rgba(255,255,255,0.03)' : '#a855f7',
              color: ((!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating) ? 'rgba(255,255,255,0.25)' : 'white',
              fontSize: '12px', fontWeight: 700,
              cursor: ((!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating) ? 'not-allowed' : 'pointer',
              opacity: ((!gpsData && !angPointALatLon) || filteredWindLayers.length < 2 || angCalculating) ? 0.5 : 1,
              marginBottom: '10px'
            }}
          >
            {angCalculating ? 'Berechne...' : 'Berechnen'}
          </button>

          {/* Fehlende Voraussetzungen */}
          {!gpsData && !angPointALatLon && (
            <div style={{ fontSize: '10px', color: '#ef4444', textAlign: 'center' }}>
              Kein GPS Signal und kein Punkt A eingegeben
            </div>
          )}
          {(gpsData || angPointALatLon) && filteredWindLayers.length < 2 && (
            <div style={{ fontSize: '10px', color: '#ef4444', textAlign: 'center' }}>
              Mind. 2 Windschichten nötig
            </div>
          )}
          {!activeCompetitionMap && (
            <div style={{ fontSize: '10px', color: '#f59e0b', textAlign: 'center', marginTop: '4px' }}>
              Keine Wettkampfkarte aktiv - keine Begrenzung
            </div>
          )}

          {/* Ergebnis */}
          {angResult && (() => {
            const selected = angSelectedAlt === -1
              ? angResult.best
              : angResult.alternatives[angSelectedAlt]
            if (!selected) return null

            const altUnit = settings.altitudeUnit === 'meters' ? 'm' : 'ft'
            const fmtAlt = (m: number) => settings.altitudeUnit === 'feet'
              ? Math.round(m * 3.28084)
              : Math.round(m)

            return (
              <div>
                {/* Beste Option */}
                <div style={{
                  background: 'rgba(168, 85, 247, 0.08)',
                  borderRadius: '8px', padding: '10px', marginBottom: '8px',
                  border: '1px solid rgba(168, 85, 247, 0.2)'
                }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
                    {angSelectedAlt === -1 ? 'Beste Option' : `Alternative ${angSelectedAlt + 1}`}
                  </div>

                  {/* Winkel */}
                  <div style={{ fontSize: '24px', fontWeight: 700, color: '#a855f7', marginBottom: '4px' }}>
                    {selected.achievedAngle}°
                  </div>

                  {/* Bearing Info */}
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>
                    Leg 2 Bearing: {selected.bearingAtoB}° | A→B: {(selected.distanceAB / 1000).toFixed(1)} km
                  </div>

                  {/* Leg 1 = vorgegebene Richtung (nur Info) */}
                  <div style={{
                    borderLeft: '2px solid rgba(168,85,247,0.5)', paddingLeft: '6px',
                    fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px'
                  }}>
                    <span style={{ color: '#a855f7', fontSize: '9px', fontWeight: 700 }}>LEG 1 (vorgegeben) = {angSetDir}°</span>
                  </div>

                  {/* Leg 2 = Empfehlung */}
                  <div style={{
                    borderLeft: '2px solid rgba(34,197,94,0.5)', paddingLeft: '6px',
                    fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px'
                  }}>
                    <span style={{ color: '#22c55e', fontSize: '9px', fontWeight: 700 }}>LEG 2 = {selected.bearingAtoB}°</span><br/>
                    {fmtAlt(selected.leg2Altitude)} {altUnit} MSL<br/>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                      Wind: {selected.leg2Wind.direction}° / {selected.leg2Wind.speedKmh} km/h
                    </span><br/>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                      {Math.round(selected.leg2Time / 60)} Min | {(selected.distanceAB / 1000).toFixed(1)} km
                    </span>
                  </div>

                  {/* Empfehlung: nur Leg 2 Höhe */}
                  <div style={{
                    padding: '8px', borderRadius: '6px',
                    background: 'rgba(34, 197, 94, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                    fontSize: '12px', color: '#22c55e', fontWeight: 700,
                    textAlign: 'center'
                  }}>
                    Geh auf {fmtAlt(selected.leg2Altitude)} {altUnit} für Leg 2
                  </div>
                </div>

                {/* Alternativen */}
                {angResult.alternatives.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>
                      Alternativen
                    </div>
                    {angResult.alternatives.map((alt, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setAngSelectedAlt(angSelectedAlt === idx ? -1 : idx)
                          const opt = angSelectedAlt === idx ? angResult.best : alt
                          setAngleResult({
                            pointA: opt.pointA,
                            pointB: opt.pointB,
                            pathLeg1: opt.pathLeg1,
                            pathLeg2: opt.pathLeg2,
                            approachPath: opt.approachPath,
                            achievedAngle: opt.achievedAngle,
                            setDirection: angSetDir
                          })
                        }}
                        style={{
                          width: '100%', padding: '6px 8px', marginBottom: '3px',
                          borderRadius: '6px', border: 'none',
                          background: angSelectedAlt === idx
                            ? 'rgba(168, 85, 247, 0.15)'
                            : 'rgba(255,255,255,0.03)',
                          color: angSelectedAlt === idx ? '#a855f7' : 'rgba(255,255,255,0.5)',
                          fontSize: '10px', cursor: 'pointer', textAlign: 'left',
                          display: 'flex', justifyContent: 'space-between'
                        }}
                      >
                        <span>Leg 2: {fmtAlt(alt.leg2Altitude)} {altUnit}</span>
                        <span style={{ fontWeight: 600 }}>{alt.achievedAngle}°</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

    </>
  )
}
