import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Header } from './components/Header'
import { NavigationPanel } from './components/NavigationPanel'
import { MapView } from './components/MapView'
import { StatusBar } from './components/StatusBar'
import { BriefingPanel } from './components/BriefingPanel'
import { DrawingPanel } from './components/DrawingPanel'
import { LiveTeamPanel } from './components/LiveTeamPanel'
import { BackupDialog } from './components/BackupDialog'
import { useFlightStore } from './stores/flightStore'
import { useTeamStore, type TeamMessage } from './stores/teamStore'
import { useAuthStore } from './stores/authStore'
import { LoginScreen } from './components/LoginScreen'
import { supabase } from './lib/supabase'
import type { Task, ProhibitedZone } from '../shared/types'
import { latLonToUTM } from './utils/coordinatesWGS84'

// Aktuelle App-Version (muss bei jedem Release angepasst werden)
const APP_VERSION = '1.1.1'

// Haversine-Distanzberechnung (Meter)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Erdradius in Metern
  const toRad = (deg: number) => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Distanz von Punkt zu Liniensegment (in Metern)
// Berechnet die kürzeste Distanz zu einem Segment, nicht nur zu den Endpunkten
function distanceToSegment(lat: number, lon: number, p1: { lat: number; lon: number }, p2: { lat: number; lon: number }): number {
  const segmentLength = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon)

  if (segmentLength === 0) return haversineDistance(lat, lon, p1.lat, p1.lon)

  // Projiziere Punkt auf Linie und berechne parametrische Position t
  // Vereinfachte Berechnung für kurze Distanzen (nutzt planare Approximation)
  const dx = p2.lon - p1.lon
  const dy = p2.lat - p1.lat
  const px = lon - p1.lon
  const py = lat - p1.lat

  let t = (px * dx + py * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t)) // Clampe auf Segment

  const projLon = p1.lon + t * dx
  const projLat = p1.lat + t * dy

  return haversineDistance(lat, lon, projLat, projLon)
}

// Distanz von Punkt zu Track/Polygon (minimale Distanz zu allen Kanten)
// Bei offenen Tracks: Distanz zu allen Segmenten entlang des Pfades
// Bei geschlossenen Polygonen: Distanz zum Rand des Polygons
function distanceToPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[], closedPolygon: boolean = false): number {
  if (polygon.length === 0) return Infinity
  if (polygon.length === 1) return haversineDistance(lat, lon, polygon[0].lat, polygon[0].lon)

  let minDist = Infinity

  // Iteriere über alle Segmente
  const numSegments = closedPolygon ? polygon.length : polygon.length - 1
  for (let i = 0; i < numSegments; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]
    const dist = distanceToSegment(lat, lon, p1, p2)
    minDist = Math.min(minDist, dist)
  }
  return minDist
}

// Point-in-Polygon Test (Ray-Casting Algorithmus)
// Behandelt auch offene Tracks als geschlossene Polygone
function isPointInPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  const n = polygon.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].lat
    const xi = polygon[i].lon
    const yj = polygon[j].lat
    const xj = polygon[j].lon

    // Ray-Casting: Zähle Schnittpunkte mit horizontaler Linie nach rechts
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }

  return inside
}

function App() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const authLoading = useAuthStore(s => s.isLoading)
  const checkSession = useAuthStore(s => s.checkSession)
  const isConnected = useFlightStore(s => s.isConnected)
  const settings = useFlightStore(s => s.settings)
  const tasks = useFlightStore(s => s.tasks)
  const gpsSimulation = useFlightStore(s => s.gpsSimulation)
  const gpsData = useFlightStore(s => s.gpsData)
  const baroData = useFlightStore(s => s.baroData)
  const prohibitedZones = useFlightStore(s => s.prohibitedZones)
  const showProhibitedZones = useFlightStore(s => s.showProhibitedZones)
  const tasksheetCoordPicker = useFlightStore(s => s.tasksheetCoordPicker)
  const handleTasksheetMapClick = useFlightStore(s => s.handleTasksheetMapClick)
  const teamMessages = useTeamStore(s => s.messages)

  // Championship Reload Dialog State
  const [showChampionshipDialog, setShowChampionshipDialog] = useState(false)
  const [pendingChampionship, setPendingChampionship] = useState<{ id: string; name: string } | null>(null)

  // Update-Check State
  const [updateInfo, setUpdateInfo] = useState<{ version: string; message?: string; changelog?: string[]; url?: string; downloadUrl?: string } | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Session beim Start pruefen
  useEffect(() => {
    checkSession()
  }, [])

  // Update-Check nach Login
  useEffect(() => {
    if (!isAuthenticated) return
    ;(async () => {
      try {
        const { data } = await supabase.from('app_config').select('value').eq('key', 'latest_version').single()
        if (data?.value) {
          const config = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          const latestVersion = config.version || config
          if (latestVersion && latestVersion !== APP_VERSION) {
            setUpdateInfo({
              version: latestVersion,
              message: config.message,
              changelog: config.changelog,
              url: config.url,
              downloadUrl: config.downloadUrl
            })
          }
        }
      } catch {} // Offline oder Tabelle existiert nicht
    })()
  }, [isAuthenticated])

  // Nach Hydration prüfen ob eine aktive Meisterschaft vorhanden ist
  useEffect(() => {
    if (!isAuthenticated) return

    const checkChampionship = () => {
      const state = useFlightStore.getState()
      if (state.activeChampionship) {
        // Nur Dialog zeigen wenn die Meisterschaft vom selben User stammt
        const currentUserId = useAuthStore.getState()?.user?.id
        if (state.activeChampionship.userId && currentUserId && state.activeChampionship.userId !== currentUserId) {
          // Anderer User — Championship leise entfernen
          useFlightStore.getState().setActiveChampionship(null)
          return
        }
        setPendingChampionship(state.activeChampionship)
        setShowChampionshipDialog(true)
      }
    }

    // Prüfe ob Store bereits hydrated ist
    if (useFlightStore.persist.hasHydrated()) {
      checkChampionship()
    } else {
      // Warte auf Hydration
      const unsub = useFlightStore.persist.onFinishHydration(() => {
        checkChampionship()
        unsub()
      })
    }
  }, [isAuthenticated])

  // Browser-GPS fuer Grid Zone Aktualisierung nach Login
  useEffect(() => {
    if (!isAuthenticated) return
    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        const utm = latLonToUTM(latitude, longitude)
        const { updateSettings } = useFlightStore.getState()
        updateSettings({
          utmZone: utm.zone,
          utmBaseEasting: Math.floor(utm.easting / 100000) * 100000,
          utmBaseNorthing: Math.floor(utm.northing / 100000) * 100000
        })
        console.log(`[GPS] Grid Zone aktualisiert: Zone ${utm.zone}, E${Math.floor(utm.easting / 100000)}, N${Math.floor(utm.northing / 100000)}`)
      },
      (err) => {
        console.log('[GPS] Browser-Standort nicht verfuegbar:', err.message)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }, [isAuthenticated])

  // Briefing Panel State
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [clickedPosition, setClickedPosition] = useState<{ lat: number; lon: number } | null>(null)
  const [taskFormActive, setTaskFormActive] = useState(false)
  const [disconnectNotification, setDisconnectNotification] = useState(false)

  // Globaler AudioContext - wird wiederverwendet statt jedes Mal neu erstellt
  const sharedAudioContextRef = useRef<AudioContext | null>(null)
  const getAudioContext = useCallback(() => {
    if (!sharedAudioContextRef.current || sharedAudioContextRef.current.state === 'closed') {
      sharedAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (sharedAudioContextRef.current.state === 'suspended') {
      sharedAudioContextRef.current.resume()
    }
    return sharedAudioContextRef.current
  }, [])

  // Task Reminder State
  // dismissedReminders speichert "taskId:endsAt" - so wird Erinnerung reaktiviert wenn Zeit geändert wird
  const [taskReminder, setTaskReminder] = useState<{ task: Task; minutesLeft: number } | null>(null)
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set())
  const reminderSoundIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const reminderAudioContextRef = useRef<AudioContext | null>(null)

  // PZ Warning State
  const [pzWarning, setPzWarning] = useState<{
    zone: ProhibitedZone
    distance: number
    type: 'distance' | 'altitude'
    altitudeDiff?: number
    altitudeMode?: 'floor' | 'ceiling'
    floorStatus?: 'approaching' | 'inside'  // approaching = gelb (in Margin), inside = rot (im Sperrbereich)
    distanceStatus?: 'approaching' | 'close'  // approaching = gelb (weit), close = rot (sehr nah)
  } | null>(null)
  const pzWarningSoundPlayedRef = useRef<string | null>(null) // Letzte PZ für die Sound gespielt wurde
  const pzWarningDismissedRef = useRef<string | null>(null) // PZ die vom Benutzer dismissed wurde

  // Track Warning State (für Tracks/Linien mit Distanz oder Höhenwarnung)
  const [trackWarning, setTrackWarning] = useState<{ zone: ProhibitedZone; distance: number; type: 'distance' | 'altitude'; altitudeDiff?: number; altitudeMode?: 'floor' | 'ceiling'; status?: 'approaching' | 'inside' } | null>(null)
  const trackWarningSoundPlayedRef = useRef<string | null>(null)
  const trackWarningDismissedRef = useRef<string | null>(null)

  // Drop Calculator Signal State
  const dropCalculator = useFlightStore(s => s.dropCalculator)
  const [dropSignalDismissed, setDropSignalDismissed] = useState(false)
  const dropSignalSoundPlayedRef = useRef(false)

  // Variometer Audio State - nur bei Grenzüberschreitung
  const varioLastStateRef = useRef<'neutral' | 'climbing' | 'sinking'>('neutral')

  // Team Message Toast
  const [teamToast, setTeamToast] = useState<TeamMessage | null>(null)
  const prevTeamMsgLenRef = useRef(0)

  // Draw Mode State
  const [drawOpen, setDrawOpen] = useState(false)

  // Team Panel State
  const [teamOpen, setTeamOpen] = useState(false)
  const [drawingMode, setDrawingMode] = useState<'none' | 'circle' | 'freehand' | 'line'>('none')
  const [gridSnapping, setGridSnapping] = useState(false)
  const [startPointTrigger, setStartPointTrigger] = useState<{ lat: number; lon: number } | null>(null)

  // Map Click Handler
  const handleMapClick = (lat: number, lon: number) => {
    // Tasksheet Koordinaten-Picker hat Priorität
    if (tasksheetCoordPicker.active) {
      handleTasksheetMapClick(lat, lon)
      return
    }

    // Nur Klick verarbeiten wenn Briefing offen UND Task-Formular aktiv ist
    if (briefingOpen && taskFormActive) {
      setClickedPosition({ lat, lon })
    }
  }

  // Start Point Handler
  const handleAddStartPoint = (lat: number, lon: number) => {
    setStartPointTrigger({ lat, lon })
    // Clear trigger nach kurzer Zeit
    setTimeout(() => setStartPointTrigger(null), 100)
  }

  // Clear clicked position
  const handleClearClick = () => {
    setClickedPosition(null)
  }

  // UI Skalierung: Setze CSS-Variablen basierend auf Settings
  useEffect(() => {
    const root = document.documentElement
    const headerHeight = settings.headerHeight ?? 60
    const navPanelScale = settings.navPanelScale ?? 1

    root.style.setProperty('--header-height', `${headerHeight}px`)
    root.style.setProperty('--nav-panel-scale', `${navPanelScale}`)
  }, [settings.headerHeight, settings.navPanelScale])

  // Zeige Benachrichtigung sofort wenn Verbindung verloren geht
  useEffect(() => {
    // Wenn vorher verbunden war und jetzt nicht mehr, zeige Benachrichtigung
    if (!isConnected) {
      setDisconnectNotification(true)
      // Auto-hide nach 10 Sekunden
      const timer = setTimeout(() => setDisconnectNotification(false), 10000)
      return () => clearTimeout(timer)
    }
  }, [isConnected])

  // Team Message Toast - zeigt Benachrichtigung bei neuen Team-Nachrichten (nur fremde)
  useEffect(() => {
    if (teamMessages.length > prevTeamMsgLenRef.current) {
      const newest = teamMessages[teamMessages.length - 1]
      if (!newest.isMine) {
        setTeamToast(newest)
        // Benachrichtigungston abspielen
        try {
          const ctx = getAudioContext()
          const gain = ctx.createGain()
          gain.connect(ctx.destination)

          if (newest.message === 'Guter Startplatz gefunden') {
            // Sprachausgabe: Callsign + Nachricht
            const utterance = new SpeechSynthesisUtterance(
              `${newest.callsign} meldet: Guter Startplatz gefunden`
            )
            utterance.lang = 'de-DE'
            utterance.rate = 1.0
            utterance.volume = 1.0
            speechSynthesis.speak(utterance)
            // Zusaetzlich normaler Ton
            const osc = ctx.createOscillator()
            osc.connect(gain)
            osc.frequency.value = 880
            osc.type = 'sine'
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.4)
          } else if (newest.message === 'Brauche Hilfe') {
            // SOS-Ton: 3x kurz hoch, 3x lang tief, 3x kurz hoch
            gain.gain.setValueAtTime(0.4, ctx.currentTime)
            const t = ctx.currentTime
            // 3x kurz (hoch)
            for (let i = 0; i < 3; i++) {
              const osc = ctx.createOscillator()
              osc.connect(gain)
              osc.frequency.value = 1200
              osc.type = 'square'
              osc.start(t + i * 0.2)
              osc.stop(t + i * 0.2 + 0.1)
            }
            // 3x lang (tief)
            for (let i = 0; i < 3; i++) {
              const osc = ctx.createOscillator()
              osc.connect(gain)
              osc.frequency.value = 800
              osc.type = 'square'
              osc.start(t + 0.7 + i * 0.4)
              osc.stop(t + 0.7 + i * 0.4 + 0.25)
            }
            // 3x kurz (hoch)
            for (let i = 0; i < 3; i++) {
              const osc = ctx.createOscillator()
              osc.connect(gain)
              osc.frequency.value = 1200
              osc.type = 'square'
              osc.start(t + 2.0 + i * 0.2)
              osc.stop(t + 2.0 + i * 0.2 + 0.1)
            }
          } else {
            // Normaler Benachrichtigungston
            const osc = ctx.createOscillator()
            osc.connect(gain)
            osc.frequency.value = 880
            osc.type = 'sine'
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.4)
          }
        } catch { /* Audio nicht verfuegbar */ }
      }
    }
    prevTeamMsgLenRef.current = teamMessages.length
  }, [teamMessages.length])

  // Überwache Disconnect-Events (zusätzlicher Fallback)
  useEffect(() => {
    // @ts-ignore - onDisconnected ist optional im API
    const api = window.ntaAPI as any
    if (!api?.bluetooth?.onDisconnected) return

    // Handler für unerwartete Disconnects
    const handleDisconnect = () => {
      setDisconnectNotification(true)
      // Auto-hide nach 10 Sekunden
      setTimeout(() => setDisconnectNotification(false), 10000)
    }

    api.bluetooth.onDisconnected(handleDisconnect)

    return () => {
      // Cleanup wenn möglich
      api.bluetooth.offDisconnected?.(handleDisconnect)
    }
  }, [])

  // Reminder Sound stoppen
  const stopReminderSound = useCallback(() => {
    if (reminderSoundIntervalRef.current) {
      clearInterval(reminderSoundIntervalRef.current)
      reminderSoundIntervalRef.current = null
    }
    reminderAudioContextRef.current = null
  }, [])

  // Einzelne Beep-Sequenz abspielen
  const playBeepSequence = useCallback(() => {
    if (settings.taskReminderSoundEnabled === false) return

    try {
      const audioContext = getAudioContext()
      reminderAudioContextRef.current = audioContext
      const volume = settings.taskReminderSoundVolume ?? 0.5
      const totalDuration = Math.min(settings.taskReminderSoundDuration ?? 2, 3) // Max 3 Sekunden pro Sequenz

      const beepCount = Math.max(3, Math.floor(totalDuration * 2))
      const beepDuration = totalDuration / beepCount * 0.7

      const playBeep = (startTime: number, frequency: number, duration: number) => {
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)

        oscillator.frequency.value = frequency
        oscillator.type = 'sine'

        gainNode.gain.setValueAtTime(volume, startTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      }

      const now = audioContext.currentTime
      const interval = totalDuration / beepCount

      for (let i = 0; i < beepCount; i++) {
        const freq = 880 + (i / (beepCount - 1)) * 438
        playBeep(now + i * interval, freq, beepDuration)
      }
    } catch (e) {
      console.warn('Could not play reminder sound:', e)
    }
  }, [settings.taskReminderSoundEnabled, settings.taskReminderSoundDuration, settings.taskReminderSoundVolume, getAudioContext])

  // Reminder Sound starten (wiederholt abspielen)
  const startReminderSound = useCallback(() => {
    // Stoppe vorherigen Sound falls vorhanden
    stopReminderSound()

    // Sofort erste Sequenz abspielen
    playBeepSequence()

    // Dann alle 4 Sekunden wiederholen
    reminderSoundIntervalRef.current = setInterval(() => {
      playBeepSequence()
    }, 4000)
  }, [playBeepSequence, stopReminderSound])

  // PZ Warning Sound abspielen
  const playPzWarningSound = useCallback(() => {
    if (settings.pzWarningSoundEnabled === false) return

    try {
      const audioContext = getAudioContext()
      const volume = settings.pzWarningSoundVolume ?? 0.7
      const totalDuration = settings.pzWarningSoundDuration ?? 3
      const soundType = settings.pzWarningSoundType ?? 'alarm'

      if (soundType === 'alarm') {
        // Alarm-Ton: Wechselnde hohe und tiefe Frequenzen
        const beepCount = Math.max(4, Math.floor(totalDuration * 2))
        const beepDuration = totalDuration / beepCount * 0.9

        const playAlarmBeep = (startTime: number, frequency: number, duration: number) => {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()
          oscillator.connect(gainNode)
          gainNode.connect(audioContext.destination)
          oscillator.frequency.value = frequency
          oscillator.type = 'square'
          gainNode.gain.setValueAtTime(volume * 0.5, startTime)
          gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
          oscillator.start(startTime)
          oscillator.stop(startTime + duration)
        }

        const now = audioContext.currentTime
        const interval = totalDuration / beepCount
        for (let i = 0; i < beepCount; i++) {
          const freq = i % 2 === 0 ? 880 : 440
          playAlarmBeep(now + i * interval, freq, beepDuration)
        }
      } else {
        // Beep-Ton: Aufsteigende Töne
        const beepCount = Math.max(3, Math.floor(totalDuration * 2))
        const beepDuration = totalDuration / beepCount * 0.7

        const playBeep = (startTime: number, frequency: number, duration: number) => {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()
          oscillator.connect(gainNode)
          gainNode.connect(audioContext.destination)
          oscillator.frequency.value = frequency
          oscillator.type = 'sine'
          gainNode.gain.setValueAtTime(volume, startTime)
          gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
          oscillator.start(startTime)
          oscillator.stop(startTime + duration)
        }

        const now = audioContext.currentTime
        const interval = totalDuration / beepCount
        for (let i = 0; i < beepCount; i++) {
          const freq = 440 + (i / (beepCount - 1)) * 440
          playBeep(now + i * interval, freq, beepDuration)
        }
      }
    } catch (e) {
      console.warn('Could not play PZ warning sound:', e)
    }
  }, [settings.pzWarningSoundEnabled, settings.pzWarningSoundDuration, settings.pzWarningSoundVolume, settings.pzWarningSoundType, getAudioContext])

  // ═══════════════════════════════════════════════════════════════════
  // Drop Calculator - DROP Signal Sound + Trigger
  // ═══════════════════════════════════════════════════════════════════
  const playDropSignalSound = useCallback(() => {
    if (settings.dropSignalSoundEnabled === false) return

    try {
      const audioContext = getAudioContext()
      const volume = settings.dropSignalSoundVolume ?? 0.8
      const now = audioContext.currentTime

      // 3 schnelle aufsteigende Beeps
      const beeps = [
        { freq: 880, start: 0, duration: 0.12 },
        { freq: 1100, start: 0.15, duration: 0.12 },
        { freq: 1320, start: 0.30, duration: 0.25 },
      ]

      beeps.forEach(({ freq, start, duration }) => {
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        oscillator.frequency.value = freq
        oscillator.type = 'sine'
        gainNode.gain.setValueAtTime(volume, now + start)
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + start + duration)
        oscillator.start(now + start)
        oscillator.stop(now + start + duration)
      })
    } catch (e) {
      console.warn('Could not play drop signal sound:', e)
    }
  }, [getAudioContext, settings.dropSignalSoundEnabled, settings.dropSignalSoundVolume])

  useEffect(() => {
    if (dropCalculator.dropNow) {
      if (!dropSignalSoundPlayedRef.current) {
        dropSignalSoundPlayedRef.current = true
        playDropSignalSound()
      }
      setDropSignalDismissed(false)
    } else {
      dropSignalSoundPlayedRef.current = false
      setDropSignalDismissed(false)
    }
  }, [dropCalculator.dropNow, playDropSignalSound])

  // ═══════════════════════════════════════════════════════════════════
  // Variometer Audio - Einmaliger Ton bei Grenzüberschreitung
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!settings.variometerAudio) {
      varioLastStateRef.current = 'neutral'
      return
    }

    const vario = baroData?.variometer ?? 0
    const climbThreshold = settings.variometerClimbThreshold ?? 0.3
    const sinkThreshold = settings.variometerSinkThreshold ?? -1.5
    const volume = settings.variometerVolume ?? 0.5

    // Bestimme aktuellen Zustand
    let currentState: 'neutral' | 'climbing' | 'sinking' = 'neutral'
    if (vario >= climbThreshold) {
      currentState = 'climbing'
    } else if (vario <= sinkThreshold) {
      currentState = 'sinking'
    }

    const prevState = varioLastStateRef.current

    // Nur Ton spielen wenn Zustand sich ändert (Grenze überschritten)
    if (currentState !== prevState) {
      varioLastStateRef.current = currentState

      // Ton nur bei Übergang zu climbing oder sinking
      if (currentState === 'climbing') {
        // Steigton: Aufsteigende Tonfolge (fröhlich)
        try {
          const ctx = getAudioContext()
          const playTone = (freq: number, startTime: number, duration: number) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = freq
            osc.type = 'sine'
            gain.gain.setValueAtTime(volume, startTime)
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
            osc.start(startTime)
            osc.stop(startTime + duration)
          }
          // Aufsteigende Töne: C5 -> E5 -> G5
          playTone(523, ctx.currentTime, 0.15)        // C5
          playTone(659, ctx.currentTime + 0.12, 0.15) // E5
          playTone(784, ctx.currentTime + 0.24, 0.2)  // G5
        } catch (e) {
          console.warn('Could not play climb sound:', e)
        }
      } else if (currentState === 'sinking') {
        // Sinkton: Absteigender tiefer Ton (warnend)
        try {
          const ctx = getAudioContext()
          const playTone = (freq: number, startTime: number, duration: number) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = freq
            osc.type = 'sawtooth' // Rauerer Klang für Warnung
            gain.gain.setValueAtTime(volume * 0.6, startTime)
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
            osc.start(startTime)
            osc.stop(startTime + duration)
          }
          // Absteigende Töne: G3 -> E3 -> C3
          playTone(196, ctx.currentTime, 0.2)        // G3
          playTone(165, ctx.currentTime + 0.15, 0.2) // E3
          playTone(131, ctx.currentTime + 0.30, 0.3) // C3
        } catch (e) {
          console.warn('Could not play sink sound:', e)
        }
      }
    }
  }, [baroData?.variometer, settings.variometerAudio, settings.variometerVolume,
      settings.variometerClimbThreshold, settings.variometerSinkThreshold])

  // PZ Proximity Check - Überprüfe GPS-Position gegen echte Sperrgebiete (Punkte/Kreise, KEINE Tracks/Polygone)
  // Unterstützt jetzt auch individuelle Höhenwarnungen pro PZ
  useEffect(() => {
    if (settings.pzWarningEnabled === false) return
    if (!gpsData) return
    if (!showProhibitedZones || prohibitedZones.length === 0) return

    const globalWarningDistance = settings.pzWarningDistance ?? 500
    const globalWarningMargin = settings.pzWarningMargin ?? 500  // Globale Margin in ft
    const globalWarningMarginMeters = globalWarningMargin * 0.3048  // Konvertiere zu Metern
    const currentAltitude = baroData?.pressureAltitude || gpsData.altitude || 0

    // Nur echte Sperrgebiete (Punkte/Kreise), keine Tracks/Polygone
    const realPZs = prohibitedZones.filter(pz => pz.type !== 'polygon')

    let activeWarning: {
      zone: ProhibitedZone
      distance: number
      type: 'distance' | 'altitude'
      altitudeDiff?: number
      altitudeMode?: 'floor' | 'ceiling'
      floorStatus?: 'approaching' | 'inside'
      distanceStatus?: 'approaching' | 'close'
    } | null = null

    // Distanz-Margin: Prozentual zur Warndistanz berechnen
    // z.B. bei 500m Warndistanz und 500ft Margin (152m): close = wenn < 152m
    const closeDistanceThreshold = Math.min(globalWarningMarginMeters, globalWarningDistance * 0.3)

    for (const pz of realPZs) {
      // Warnungen für diese PZ deaktiviert?
      if (pz.warningDisabled) continue

      // Punkt PZ - berechne Distanz zum Zentrum
      let distance = haversineDistance(gpsData.latitude, gpsData.longitude, pz.lat, pz.lon)
      // Wenn Radius definiert, subtrahiere ihn
      if (pz.radius) {
        distance = Math.max(0, distance - pz.radius)
      }

      // Höhenwarnung-Einstellungen prüfen
      const hasAltitudeWarning = pz.altitudeWarning && pz.elevation && pz.elevation > 0
      const pzAltitudeMode = pz.altitudeWarningMode || 'ceiling'

      if (hasAltitudeWarning) {
        // elevation ist immer in ft, konvertiere zu Metern
        const altitudeLimitMeters = pz.elevation! * 0.3048
        // Nutze GLOBALE Margin aus Settings
        const warningDist = globalWarningDistance

        console.log(`[PZWarning] "${pz.name}" Höhenwarnung: mode=${pzAltitudeMode}, altLimit=${pz.elevation}ft (${altitudeLimitMeters.toFixed(1)}m), globalMargin=${globalWarningMargin}ft (${globalWarningMarginMeters.toFixed(1)}m), currentAlt=${currentAltitude.toFixed(1)}m, distance=${distance.toFixed(1)}m`)

        if (pzAltitudeMode === 'floor') {
          // Von Boden bis X: Sperrbereich von Boden bis zur Höhe (elevation)
          // Nutze GLOBALE Margin aus Settings
          // z.B. Limit=5000ft, globalMargin=500ft:
          // upperMargin = 5000 + 500 = 5500ft (gelbe Warnung beim Sinken)
          //
          // Im PZ + über 5500ft: Keine Warnung
          // Im PZ + 5000-5500ft: GELBE Warnung "fast im Sperrbereich"
          // Im PZ + unter 5000ft: ROTE Warnung "im Sperrbereich"
          // Außerhalb PZ + unter 5000ft: Distanzwarnung

          const upperMargin = altitudeLimitMeters + globalWarningMarginMeters
          const isInsidePZ = distance === 0
          const belowLimit = currentAltitude <= altitudeLimitMeters
          const inUpperMarginZone = currentAltitude <= upperMargin && currentAltitude > altitudeLimitMeters

          console.log(`[PZWarning] Floor: limit=${altitudeLimitMeters.toFixed(1)}m, upperMargin=${upperMargin.toFixed(1)}m, currentAlt=${currentAltitude.toFixed(1)}m, isInsidePZ=${isInsidePZ}, belowLimit=${belowLimit}, inMarginZone=${inUpperMarginZone}`)

          if (isInsidePZ) {
            // Im PZ
            if (belowLimit) {
              // Unter Limit - IM SPERRBEREICH (rot)
              const altDiff = Math.round(altitudeLimitMeters - currentAltitude)
              console.log(`[PZWarning] IM PZ + IM SPERRBEREICH! ${altDiff}m unter Limit`)
              activeWarning = {
                zone: pz,
                distance: 0,
                type: 'altitude',
                altitudeMode: 'floor',
                altitudeDiff: altDiff,
                floorStatus: 'inside'  // ROT
              }
            } else if (inUpperMarginZone) {
              // Zwischen Limit und upperMargin - FAST IM SPERRBEREICH (gelb)
              const altDiff = Math.round(currentAltitude - altitudeLimitMeters)
              console.log(`[PZWarning] IM PZ + FAST IM SPERRBEREICH! ${altDiff}m bis Sperrbereich`)
              activeWarning = {
                zone: pz,
                distance: 0,
                type: 'altitude',
                altitudeMode: 'floor',
                altitudeDiff: altDiff,
                floorStatus: 'approaching'  // GELB
              }
            }
            // Über upperMargin = keine Warnung
          } else if (distance <= warningDist) {
            // Außerhalb PZ aber in Warndistanz
            if (belowLimit) {
              // Unter Limit (in Sperrbereich-Höhe) - Distanzwarnung (gelb wenn weit, rot wenn nah)
              const isClose = distance <= closeDistanceThreshold
              console.log(`[PZWarning] AUSSERHALB + UNTER LIMIT - Distanzwarnung (${isClose ? 'CLOSE/ROT' : 'APPROACHING/GELB'})`)
              if (!activeWarning || distance < activeWarning.distance) {
                activeWarning = {
                  zone: pz,
                  distance: Math.round(distance),
                  type: 'distance',
                  distanceStatus: isClose ? 'close' : 'approaching'
                }
              }
            }
            // Über Limit = keine Warnung
          }
        } else {
          // Ceiling: Höhenbegrenzung nach oben - keine Distanzwarnung
          // Nutze GLOBALE Margin: gelb wenn in Margin, rot wenn über Limit
          const warningAltitude = altitudeLimitMeters - globalWarningMarginMeters
          const ceilingCondition = currentAltitude >= warningAltitude
          const isOverLimit = currentAltitude >= altitudeLimitMeters

          console.log(`[PZWarning] Ceiling-Check: ${currentAltitude.toFixed(1)}m >= ${warningAltitude.toFixed(1)}m = ${ceilingCondition}, overLimit=${isOverLimit}`)

          if (ceilingCondition && distance <= warningDist) {
            const altDiffToLimit = Math.round(currentAltitude - altitudeLimitMeters)
            console.log(`[PZWarning] CEILING WARNUNG! altDiff=${altDiffToLimit}m, ${isOverLimit ? 'ÜBER LIMIT/ROT' : 'IN MARGIN/GELB'}`)
            activeWarning = {
              zone: pz,
              distance: Math.round(distance),
              type: 'altitude',
              altitudeMode: 'ceiling',
              altitudeDiff: altDiffToLimit,
              floorStatus: isOverLimit ? 'inside' : 'approaching'  // Nutze floorStatus auch für ceiling: inside=rot, approaching=gelb
            }
          }
        }
      } else {
        // Keine Höhenwarnung konfiguriert - nur Distanzwarnung (gelb wenn weit, rot wenn nah)
        if (distance <= globalWarningDistance) {
          const isClose = distance <= closeDistanceThreshold
          if (!activeWarning || distance < activeWarning.distance) {
            activeWarning = {
              zone: pz,
              distance: Math.round(distance),
              type: 'distance',
              distanceStatus: isClose ? 'close' : 'approaching'
            }
          }
        }
      }
    }

    // Wenn Warnung aktiv, zeige sie
    if (activeWarning) {
      // Nicht anzeigen wenn diese PZ dismissed wurde
      if (pzWarningDismissedRef.current === activeWarning.zone.id) {
        return
      }
      // Nur Sound spielen wenn dies eine NEUE Warnung ist
      if (pzWarningSoundPlayedRef.current !== activeWarning.zone.id) {
        pzWarningSoundPlayedRef.current = activeWarning.zone.id
        playPzWarningSound()
      }
      setPzWarning(activeWarning)
    } else {
      // Keine Warnung mehr nötig - außerhalb des Bereichs
      if (pzWarning) {
        setPzWarning(null)
        pzWarningSoundPlayedRef.current = null
      }
      // Dismissed-Status zurücksetzen wenn außerhalb des Bereichs
      pzWarningDismissedRef.current = null
    }
  }, [gpsData, baroData?.pressureAltitude, prohibitedZones, showProhibitedZones, settings.pzWarningEnabled, settings.pzWarningDistance, settings.pzAltitudeUnit, playPzWarningSound])

  // Handler zum Ablehnen einer PZ-Warnung
  // Nur UI schließen - Sound wird wieder gespielt wenn du erneut in den Bereich kommst
  const handleDismissPzWarning = useCallback(() => {
    if (pzWarning) {
      // Merke welche PZ dismissed wurde - zeige sie nicht wieder an bis Benutzer den Bereich verlässt
      pzWarningDismissedRef.current = pzWarning.zone.id
      setPzWarning(null)
      // pzWarningSoundPlayedRef bleibt gesetzt damit der Sound nicht sofort wieder spielt
    }
  }, [pzWarning])

  // Track Proximity Check - Überprüfe GPS-Position gegen Tracks/Linien (mit individuellen Warnungen)
  // Höhen-Modi:
  // - 'floor': Von Boden bis X - warnt wenn UNTER dieser Höhe UND horizontal nahe am Track
  // - 'ceiling': Höhenbegrenzung - warnt wenn man sich dieser Höhe von unten nähert
  useEffect(() => {
    // Track-Warnung ist an PZ-Warnung gekoppelt
    if (settings.pzWarningEnabled === false) {
      console.log('[TrackWarning] Deaktiviert (PZ-Warnung aus)')
      return
    }
    if (!gpsData) {
      console.log('[TrackWarning] Keine GPS-Daten')
      return
    }
    if (!showProhibitedZones) {
      console.log('[TrackWarning] PZ nicht sichtbar')
      return
    }
    if (prohibitedZones.length === 0) {
      console.log('[TrackWarning] Keine PZ vorhanden')
      return
    }

    // Alle Tracks/Polygone (mindestens 2 Punkte)
    const allTracks = prohibitedZones.filter(pz =>
      pz.type === 'polygon' && pz.polygon && pz.polygon.length >= 2
    )

    console.log('[TrackWarning] PZ gesamt:', prohibitedZones.length, 'Tracks:', allTracks.length)

    if (allTracks.length === 0) {
      console.log('[TrackWarning] Keine Tracks (type=polygon) gefunden')
      return
    }

    // Debug: Zeige Distanz zu jedem Track
    for (const track of allTracks) {
      const distance = distanceToPolygon(gpsData.latitude, gpsData.longitude, track.polygon!)
      console.log(`[TrackWarning] Track "${track.name}": ${Math.round(distance)}m entfernt, GPS: ${gpsData.latitude.toFixed(5)}, ${gpsData.longitude.toFixed(5)}`)
    }

    const currentAltitude = baroData?.pressureAltitude || gpsData.altitude || 0
    // Globale PZ-Warndistanz aus Settings (gilt für alle ohne individuelle Einstellung)
    const globalWarningDistance = settings.pzWarningDistance ?? 500

    let activeWarning: {
      track: ProhibitedZone
      distance: number
      type: 'distance' | 'floor' | 'ceiling'
      altitudeDiff?: number
      status?: 'approaching' | 'inside'  // approaching = gelb (in Margin), inside = rot (über/unter Limit)
    } | null = null

    for (const track of allTracks) {
      // Warnungen für diesen Track deaktiviert?
      if (track.warningDisabled) continue

      // Berechne horizontale Distanz zum Track-Pfad (offener Track = entlang des Pfades)
      const distance = distanceToPolygon(gpsData.latitude, gpsData.longitude, track.polygon!, false)

      // Prüfe ob Punkt innerhalb des Polygons ist (auch offene Tracks werden virtuell geschlossen)
      const insidePolygon = isPointInPolygon(gpsData.latitude, gpsData.longitude, track.polygon!)

      // Prüfe ob innerhalb der globalen Warndistanz
      const withinWarningDistance = distance <= globalWarningDistance

      // Hat dieser Track eine Höhenwarnung konfiguriert? (nutzt elevation Feld)
      const hasAltitudeWarning = track.altitudeWarning && track.elevation && track.elevation > 0
      const altitudeMode = track.altitudeWarningMode || 'ceiling'

      // 1. Distanzwarnung:
      // - Bei "ceiling" (Höhenbegrenzung): Distanzwarnung wird ignoriert
      // - Bei "floor" (Von Boden bis): Distanzwarnung bleibt aktiv
      const skipDistanceWarning = hasAltitudeWarning && altitudeMode === 'ceiling'

      if (!skipDistanceWarning && withinWarningDistance && !insidePolygon) {
        if (!activeWarning || distance < activeWarning.distance) {
          activeWarning = {
            track,
            distance: Math.round(distance),
            type: 'distance'
          }
        }
      }

      // 2. Höhenwarnung (wenn konfiguriert)
      if (hasAltitudeWarning) {
        // elevation ist immer in ft, konvertiere zu Metern
        const altitudeLimitMeters = track.elevation! * 0.3048

        // Globale Margin aus Settings (in ft), konvertiere zu Metern
        const globalMarginFt = settings.pzWarningMargin ?? 500
        const marginMeters = globalMarginFt * 0.3048

        const mode = altitudeMode
        // Höhenwarnung gilt wenn im Polygon ODER innerhalb der Warndistanz
        const inWarningZone = insidePolygon || withinWarningDistance

        console.log(`[TrackWarning] "${track.name}" Höhenwarnung: mode=${mode}, altLimit=${track.elevation}ft (${altitudeLimitMeters.toFixed(1)}m), margin=${globalMarginFt}ft (${marginMeters.toFixed(1)}m), currentAlt=${currentAltitude.toFixed(1)}m, inPolygon=${insidePolygon}, withinDist=${withinWarningDistance}, inZone=${inWarningZone}`)

        if (mode === 'floor') {
          // Von Boden bis X: Sperrbereich von Boden bis zur Höhe
          // Warnung beginnt bei (Limit + Margin) beim Sinken
          // z.B. Limit=7000ft, Margin=500ft → Warnung ab 7500ft beim Sinken (gelb), ab 7000ft und darunter (rot)
          const warningAltitude = altitudeLimitMeters + marginMeters
          const floorCondition = currentAltitude <= warningAltitude
          const insideFloor = currentAltitude <= altitudeLimitMeters  // Unter dem Limit = im Sperrbereich = ROT
          console.log(`[TrackWarning] Floor-Check: ${currentAltitude.toFixed(1)}m <= ${warningAltitude.toFixed(1)}m (Limit ${altitudeLimitMeters.toFixed(1)}m + Margin ${marginMeters.toFixed(1)}m) = ${floorCondition}, insideFloor=${insideFloor}`)

          if (inWarningZone && floorCondition) {
            // altDiff = wie viel noch bis zur Obergrenze des Sperrbereichs (in Metern für Display-Konvertierung)
            const altDiff = Math.round(altitudeLimitMeters - currentAltitude)
            console.log(`[TrackWarning] FLOOR WARNUNG AKTIV! altDiff=${altDiff}m (steige ${Math.abs(altDiff)}m um Sperrbereich zu verlassen), status=${insideFloor ? 'inside' : 'approaching'}`)
            if (!activeWarning || activeWarning.type === 'distance') {
              activeWarning = {
                track,
                distance: Math.round(distance),
                type: 'floor',
                altitudeDiff: altDiff,
                status: insideFloor ? 'inside' : 'approaching'  // inside = im Sperrbereich (rot), approaching = in Margin (gelb)
              }
            }
          }
        } else {
          // Ceiling: Höhenbegrenzung nach oben
          // Warnung beginnt bei (Limit - Margin) beim Steigen
          // z.B. Limit=7000ft, Margin=500ft → Warnung ab 6500ft beim Steigen (gelb), ab 7000ft (rot)
          const warningAltitude = altitudeLimitMeters - marginMeters
          const ceilingCondition = currentAltitude >= warningAltitude
          const overLimit = currentAltitude >= altitudeLimitMeters  // Über dem eigentlichen Limit = ROT
          console.log(`[TrackWarning] Ceiling-Check: ${currentAltitude.toFixed(1)}m >= ${warningAltitude.toFixed(1)}m (Limit ${altitudeLimitMeters.toFixed(1)}m - Margin ${marginMeters.toFixed(1)}m) = ${ceilingCondition}, overLimit=${overLimit}`)

          if (inWarningZone && ceilingCondition) {
            // altDiff = wie viel über/unter dem eigentlichen Limit (in Metern für Display-Konvertierung)
            const altDiffToLimit = Math.round(currentAltitude - altitudeLimitMeters)
            console.log(`[TrackWarning] CEILING WARNUNG AKTIV! ${altDiffToLimit >= 0 ? altDiffToLimit + 'm über Limit' : Math.abs(altDiffToLimit) + 'm bis Limit'}, status=${overLimit ? 'inside' : 'approaching'}`)
            if (!activeWarning || activeWarning.type === 'distance') {
              activeWarning = {
                track,
                distance: Math.round(distance),
                type: 'ceiling',
                altitudeDiff: altDiffToLimit,
                status: overLimit ? 'inside' : 'approaching'  // inside = über Limit (rot), approaching = in Margin (gelb)
              }
            }
          }
        }
      }
    }

    if (activeWarning) {
      // Nicht anzeigen wenn dieser Track dismissed wurde
      if (trackWarningDismissedRef.current === activeWarning.track.id) {
        return
      }
      // Nur Sound spielen wenn dies eine NEUE Warnung ist
      if (trackWarningSoundPlayedRef.current !== activeWarning.track.id) {
        trackWarningSoundPlayedRef.current = activeWarning.track.id
        playPzWarningSound()
      }
      setTrackWarning({
        zone: activeWarning.track,
        distance: activeWarning.distance,
        type: activeWarning.type === 'distance' ? 'distance' : 'altitude',
        altitudeDiff: activeWarning.altitudeDiff,
        altitudeMode: activeWarning.type === 'floor' ? 'floor' : activeWarning.type === 'ceiling' ? 'ceiling' : undefined,
        status: activeWarning.status  // approaching = gelb, inside = rot
      })
    } else {
      // Keine Warnung mehr nötig
      if (trackWarning) {
        setTrackWarning(null)
        trackWarningSoundPlayedRef.current = null
      }
      trackWarningDismissedRef.current = null
    }
  }, [gpsData, baroData?.pressureAltitude, prohibitedZones, showProhibitedZones, settings.pzWarningEnabled,
      settings.pzAltitudeUnit, settings.pzWarningMargin, playPzWarningSound, trackWarning])

  // Handler zum Ablehnen einer Track-Warnung
  const handleDismissTrackWarning = useCallback(() => {
    if (trackWarning) {
      trackWarningDismissedRef.current = trackWarning.zone.id
      setTrackWarning(null)
    }
  }, [trackWarning])

  // Task Reminder Logic - Überprüfe alle 5 Sekunden (für Sekunden-Genauigkeit)
  useEffect(() => {
    const checkReminders = () => {
      const timeZone = settings.taskTimeZone ?? 'utc'

      const now = new Date()
      // Wähle UTC oder lokale Zeit basierend auf Einstellung
      const currentHours = timeZone === 'utc' ? now.getUTCHours() : now.getHours()
      const currentMinutes = timeZone === 'utc' ? now.getUTCMinutes() : now.getMinutes()
      const currentSeconds = timeZone === 'utc' ? now.getUTCSeconds() : now.getSeconds()
      const currentTimeInSeconds = currentHours * 3600 + currentMinutes * 60 + currentSeconds

      // Finde Tasks mit aktivierter Erinnerung
      for (const task of tasks) {
        if (!task.endsAt || !task.reminderEnabled) continue
        // isActive ist optional - wenn nicht gesetzt, trotzdem Erinnerung zeigen
        if (task.isActive === false) continue  // Nur explizit deaktivierte Tasks überspringen

        // Verwende individuelle Task-Reminder-Zeit, oder globale Einstellung als Fallback
        const taskReminderValue = task.reminderValue ?? settings.taskReminderValue ?? 5
        const taskReminderUnit = task.reminderUnit ?? settings.taskReminderUnit ?? 'minutes'
        // Konvertiere zu Sekunden für einheitliche Berechnung
        const reminderSeconds = taskReminderUnit === 'seconds' ? taskReminderValue : taskReminderValue * 60

        // Prüfe mit taskId:endsAt:reminderValue:reminderUnit - so wird Erinnerung reaktiviert wenn Zeit oder Erinnerungszeit geändert wird
        const reminderKey = `${task.id}:${task.endsAt}:${taskReminderValue}:${taskReminderUnit}`
        if (dismissedReminders.has(reminderKey)) {
          continue  // Bereits abgelehnt
        }

        // Parse endsAt Zeit (Format: "HH:MM")
        const [hours, minutes] = task.endsAt.split(':').map(Number)
        if (isNaN(hours) || isNaN(minutes)) continue

        const taskEndInSeconds = hours * 3600 + minutes * 60
        const secondsUntilEnd = taskEndInSeconds - currentTimeInSeconds

        // Zeige Erinnerung wenn wir im Zeitfenster sind (zwischen 0 und reminderSeconds)
        if (secondsUntilEnd >= 0 && secondsUntilEnd <= reminderSeconds) {
          // Konvertiere zurück zu Minuten für Anzeige (oder Sekunden wenn < 60)
          const displayValue = secondsUntilEnd < 60 ? secondsUntilEnd : Math.ceil(secondsUntilEnd / 60)

          // Nur Sound spielen wenn dies eine NEUE Erinnerung ist
          if (!taskReminder || taskReminder.task.id !== task.id) {
            startReminderSound()
          }

          setTaskReminder({ task, minutesLeft: displayValue })
          return  // Zeige nur eine Erinnerung auf einmal
        }
      }
    }

    // Sofort prüfen und dann alle 5 Sekunden
    checkReminders()
    const interval = setInterval(checkReminders, 5000)

    return () => clearInterval(interval)
  }, [tasks, settings.taskReminderValue, settings.taskReminderUnit, settings.taskTimeZone, dismissedReminders, taskReminder, startReminderSound])

  // Handler zum Ablehnen einer Erinnerung
  const handleDismissReminder = useCallback(() => {
    // Sound sofort stoppen
    stopReminderSound()

    if (taskReminder && taskReminder.task.endsAt) {
      // Speichere taskId:endsAt:reminderValue:reminderUnit - so wird Erinnerung reaktiviert wenn Zeit oder Erinnerungszeit geändert wird
      const taskReminderValue = taskReminder.task.reminderValue ?? settings.taskReminderValue ?? 5
      const taskReminderUnit = taskReminder.task.reminderUnit ?? settings.taskReminderUnit ?? 'minutes'
      const reminderKey = `${taskReminder.task.id}:${taskReminder.task.endsAt}:${taskReminderValue}:${taskReminderUnit}`
      setDismissedReminders(prev => new Set([...prev, reminderKey]))
      setTaskReminder(null)
    }
  }, [taskReminder, stopReminderSound, settings.taskReminderValue, settings.taskReminderUnit])

  // GPS Simulation wird in NavigationPanel.tsx verwaltet (einzige Simulations-Schleife)

  // Auth Gate
  if (authLoading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '14px'
      }}>
        Laden...
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  return (
    <div className="app">
      <Header
        onBriefingToggle={() => setBriefingOpen(!briefingOpen)}
        briefingOpen={briefingOpen}
        onDrawToggle={() => {
          const newState = !drawOpen
          setDrawOpen(newState)
          if (!newState) {
            setDrawingMode('none') // Reset drawing mode when panel closes via toggle
          }
        }}
        drawOpen={drawOpen}
        onTeamToggle={() => setTeamOpen(!teamOpen)}
        teamOpen={teamOpen}
        updateAvailable={!!updateInfo}
        onShowUpdate={() => setUpdateDismissed(false)}
      />

      {/* Draggable Panels - schweben über der App */}
      <NavigationPanel />
      <BriefingPanel
        isOpen={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        clickedPosition={clickedPosition}
        onClearClick={handleClearClick}
        onTaskFormActiveChange={setTaskFormActive}
      />
      <DrawingPanel
        isOpen={drawOpen}
        onClose={() => {
          setDrawOpen(false)
          setDrawingMode('none') // Reset drawing mode when panel closes
        }}
        onDrawingModeChange={setDrawingMode}
        drawingMode={drawingMode}
        gridSnapping={gridSnapping}
        onGridSnappingChange={setGridSnapping}
        onAddStartPoint={handleAddStartPoint}
      />
      <LiveTeamPanel
        isOpen={teamOpen}
        onClose={() => setTeamOpen(false)}
      />

      <main className="app-main">
        {/* Tasksheet Koordinaten-Picker Overlay */}
        {tasksheetCoordPicker.active && (
          <div style={{
            position: 'fixed',
            top: 'calc(var(--header-height, 60px) + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95))',
            padding: '12px 24px',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span>
              Klicke auf die Karte für Task {tasksheetCoordPicker.taskNumber} ({tasksheetCoordPicker.taskType})
            </span>
            <button
              onClick={() => useFlightStore.getState().setTasksheetCoordPicker({
                active: false,
                taskNumber: null,
                taskType: null,
                callback: null
              })}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#fff',
                fontSize: '12px',
                cursor: 'pointer',
                marginLeft: '8px'
              }}
            >
              Abbrechen
            </button>
          </div>
        )}

        <MapView
          onMapClick={handleMapClick}
          clickedPosition={clickedPosition}
          briefingOpen={briefingOpen}
          drawingMode={drawingMode}
          onDrawingModeChange={setDrawingMode}
          gridSnapping={gridSnapping}
          gridSize={settings.gridSize || 100}
          startPointTrigger={startPointTrigger}
        />
      </main>

      <footer className="app-footer">
        <StatusBar />
      </footer>

      {/* Marker Drop Indikator - Annäherung (orange/gelb) und DROP (grün) */}
      {dropCalculator.active && dropCalculator.distanceToGoal !== null && (
        dropCalculator.dropNow ? (
          /* DROP Signal - gleiche Position wie Annäherung, grün */
          <div
            onClick={() => setDropSignalDismissed(true)}
            style={{
              position: 'fixed',
              bottom: '120px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10005,
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))',
              color: 'white',
              padding: '12px 24px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(34, 197, 94, 0.5), 0 0 40px rgba(34, 197, 94, 0.3)',
              textAlign: 'center',
              cursor: 'pointer',
              animation: 'pulse 0.5s ease-in-out infinite',
              border: '2px solid rgba(255, 255, 255, 0.5)'
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 900, letterSpacing: '4px', marginBottom: '2px' }}>
              DROP!
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'monospace' }}>
              {dropCalculator.distanceToGoal} m
            </div>
            <div style={{ fontSize: '11px', opacity: 0.8 }}>
              Marker-Abstand zum Ziel
            </div>
          </div>
        ) : dropCalculator.distanceToGoal <= 200 ? (
          /* Annäherungs-Indikator - orange/gelb */
          <div style={{
            position: 'fixed',
            bottom: '120px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10002,
            background: dropCalculator.insideMma
              ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.9), rgba(202, 138, 4, 0.9))'
              : 'linear-gradient(135deg, rgba(249, 115, 22, 0.8), rgba(234, 88, 12, 0.8))',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            textAlign: 'center',
            border: '1px solid rgba(255, 255, 255, 0.3)'
          }}>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'monospace' }}>
              {dropCalculator.distanceToGoal} m
            </div>
            <div style={{ fontSize: '11px', opacity: 0.8 }}>
              Marker-Abstand zum Ziel
            </div>
          </div>
        ) : null
      )}

      {/* Disconnect Notification */}
      {disconnectNotification && (
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          background: 'linear-gradient(135deg, #ef4444, #dc2626)',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideIn 0.3s ease-out',
          minWidth: '300px'
        }}>
          <svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Verbindung verloren!</div>
            <div style={{ fontSize: '13px', opacity: 0.9 }}>Die Verbindung zum COM-Port wurde unterbrochen.</div>
          </div>
          <button
            onClick={() => setDisconnectNotification(false)}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              fontSize: '18px',
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Team Message Toast - links oben */}
      {teamToast && (
        <div style={{
          position: 'fixed',
          top: '80px',
          left: '20px',
          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
          color: 'white',
          padding: '14px 18px',
          borderRadius: '12px',
          border: `2px solid ${teamToast.color}`,
          boxShadow: `0 4px 20px rgba(0, 0, 0, 0.5), 0 0 15px ${teamToast.color}40`,
          zIndex: 10002,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideIn 0.3s ease-out',
          minWidth: '280px',
          maxWidth: '400px'
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={teamToast.color} strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '12px', color: teamToast.color, marginBottom: '2px' }}>
              {teamToast.callsign}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              {teamToast.message}
            </div>
          </div>
          <button
            onClick={() => setTeamToast(null)}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              fontSize: '16px',
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Task Reminder Notification - rechts oben */}
      {taskReminder && (() => {
        const notifScale = settings.notificationScale ?? 1
        return (
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          color: 'white',
          padding: '16px 20px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(245, 158, 11, 0.5), 0 0 40px rgba(245, 158, 11, 0.3)',
          zIndex: 10002,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          animation: 'slideIn 0.3s ease-out, pulse 2s ease-in-out infinite',
          minWidth: '320px',
          transform: `scale(${notifScale})`,
          transformOrigin: 'top right'
        }}>
          <div style={{ fontSize: '32px', animation: 'shake 0.5s ease-in-out infinite' }}>⏰</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
              Task endet bald!
            </div>
            <div style={{
              display: 'inline-block',
              padding: '4px 10px',
              background: taskReminder.task.markerColor || '#3b82f6',
              borderRadius: '6px',
              marginBottom: '4px',
              fontWeight: 600,
              fontSize: '13px'
            }}>
              {taskReminder.task.taskNumber && `${taskReminder.task.taskNumber}: `}
              {taskReminder.task.name}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>
              {taskReminder.minutesLeft < 60
                ? `${taskReminder.minutesLeft} Sekunden`
                : `${taskReminder.minutesLeft} Minute${taskReminder.minutesLeft !== 1 ? 'n' : ''}`
              }
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              Endet um {taskReminder.task.endsAt} {settings.taskTimeZone === 'local' ? 'Lokal' : 'UTC'}
            </div>
          </div>
          <button
            onClick={handleDismissReminder}
            style={{
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            OK
          </button>
        </div>
        )
      })()}

      {/* PZ Warning Notification - rechts oben (über Task Reminder wenn beide aktiv) */}
      {pzWarning && (() => {
        // Bestimme ob gelb oder rot
        const isYellow = pzWarning.floorStatus === 'approaching' || pzWarning.distanceStatus === 'approaching'
        const notifScale = settings.notificationScale ?? 1
        return (
        <div style={{
          position: 'fixed',
          top: taskReminder ? '200px' : '80px',
          right: '20px',
          background: isYellow
            ? 'linear-gradient(135deg, #f59e0b, #d97706)'  // GELB
            : 'linear-gradient(135deg, #ef4444, #b91c1c)',  // ROT
          color: 'white',
          padding: '16px 20px',
          borderRadius: '12px',
          boxShadow: isYellow
            ? '0 4px 20px rgba(245, 158, 11, 0.5), 0 0 40px rgba(245, 158, 11, 0.3)'
            : '0 4px 20px rgba(239, 68, 68, 0.5), 0 0 40px rgba(239, 68, 68, 0.3)',
          zIndex: 10003,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          animation: 'slideIn 0.3s ease-out, pulse 1s ease-in-out infinite',
          minWidth: '320px',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          transform: `scale(${notifScale})`,
          transformOrigin: 'top right'
        }}>
          <div style={{ fontSize: '32px', animation: 'shake 0.3s ease-in-out infinite' }}>
            {isYellow ? '⚠️' : '🚨'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px', textTransform: 'uppercase' }}>
              {pzWarning.type === 'altitude'
                ? (pzWarning.floorStatus === 'approaching'
                    ? 'FAST IM SPERRBEREICH!'
                    : pzWarning.floorStatus === 'inside'
                      ? (pzWarning.altitudeMode === 'floor' ? 'IM SPERRBEREICH!' : 'ÜBER HÖHENGRENZE!')
                      : 'HÖHENWARNUNG!')
                : (pzWarning.distanceStatus === 'approaching'
                    ? 'SPERRGEBIET NÄHERT SICH'
                    : 'SPERRGEBIET SEHR NAH!')}
            </div>
            <div style={{
              display: 'inline-block',
              padding: '4px 10px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '6px',
              marginBottom: '4px',
              fontWeight: 600,
              fontSize: '13px'
            }}>
              {pzWarning.zone.name}
            </div>
            {pzWarning.type === 'altitude' ? (
              pzWarning.altitudeMode === 'floor' ? (
                // Floor-Modus: Zeige verbleibende Höhe
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {pzWarning.floorStatus === 'approaching'
                    ? `Noch ${Math.round((pzWarning.altitudeDiff || 0) * 3.28084)} ft bis Sperrbereich`
                    : `Steige ${Math.round((pzWarning.altitudeDiff || 0) * 3.28084)} ft um Sperrbereich zu verlassen`
                  }
                </div>
              ) : (
                // Ceiling-Modus: Zeige wie nah an der Obergrenze
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {pzWarning.altitudeDiff && pzWarning.altitudeDiff > 0
                    ? `${Math.round(pzWarning.altitudeDiff * 3.28084)} ft über Limit`
                    : `${Math.round(Math.abs(pzWarning.altitudeDiff || 0) * 3.28084)} ft bis Limit`
                  }
                </div>
              )
            ) : (
              <div style={{ fontSize: '20px', fontWeight: 700 }}>
                {pzWarning.distance < 1000
                  ? `${pzWarning.distance} m`
                  : `${(pzWarning.distance / 1000).toFixed(1)} km`
                } entfernt
              </div>
            )}
            {pzWarning.zone.elevation && (
              <div style={{ fontSize: '12px', opacity: 0.9 }}>
                Sperrbereich bis: {pzWarning.zone.elevation} ft
              </div>
            )}
          </div>
          <button
            onClick={handleDismissPzWarning}
            style={{
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            OK
          </button>
        </div>
        )
      })()}

      {/* Track Warning Notification - rechts oben (über anderen Warnungen wenn aktiv) */}
      {trackWarning && (() => {
        // Status: approaching = gelb (in Margin), inside = rot (über/unter Limit)
        const isRed = trackWarning.status === 'inside'
        const notifScale = settings.notificationScale ?? 1
        return (
        <div style={{
          position: 'fixed',
          top: pzWarning ? '320px' : taskReminder ? '200px' : '80px',
          right: '20px',
          background: isRed
            ? 'linear-gradient(135deg, #ef4444, #b91c1c)'  // ROT - über/unter Limit
            : 'linear-gradient(135deg, #f59e0b, #d97706)', // GELB - in Margin
          color: 'white',
          padding: '16px 20px',
          borderRadius: '12px',
          boxShadow: isRed
            ? '0 4px 20px rgba(239, 68, 68, 0.5), 0 0 40px rgba(239, 68, 68, 0.3)'
            : '0 4px 20px rgba(245, 158, 11, 0.5), 0 0 40px rgba(245, 158, 11, 0.3)',
          zIndex: 10003,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          animation: 'slideIn 0.3s ease-out, pulse 1s ease-in-out infinite',
          minWidth: '320px',
          border: '2px solid rgba(255, 255, 255, 0.3)',
          transform: `scale(${notifScale})`,
          transformOrigin: 'top right'
        }}>
          <div style={{ fontSize: '32px', animation: 'shake 0.3s ease-in-out infinite' }}>
            {trackWarning.type === 'altitude'
              ? (trackWarning.altitudeMode === 'floor' ? '⚠️' : '📏')
              : '🛤️'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px', textTransform: 'uppercase' }}>
              {trackWarning.type === 'altitude'
                ? (isRed
                    ? (trackWarning.altitudeMode === 'floor' ? 'IM SPERRBEREICH!' : 'ÜBER HÖHENGRENZE!')
                    : (trackWarning.altitudeMode === 'floor' ? 'FAST IM SPERRBEREICH!' : 'HÖHENGRENZE NÄHERT SICH!'))
                : 'SPERRGEBIET NÄHERT SICH'}
            </div>
            <div style={{
              display: 'inline-block',
              padding: '4px 10px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '6px',
              marginBottom: '4px',
              fontWeight: 600,
              fontSize: '13px'
            }}>
              {trackWarning.zone.name}
            </div>
            {trackWarning.type === 'altitude' ? (
              trackWarning.altitudeMode === 'floor' ? (
                // Floor-Modus: Zeige Distanz zum Track und verbleibende Höhe bis Obergrenze
                <>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>
                    {trackWarning.distance < 1000
                      ? `${trackWarning.distance} m`
                      : `${(trackWarning.distance / 1000).toFixed(1)} km`
                    } zum Track
                  </div>
                  <div style={{ fontSize: '14px', opacity: 0.9 }}>
                    Steige {settings.pzAltitudeUnit === 'meters'
                      ? trackWarning.altitudeDiff
                      : Math.round((trackWarning.altitudeDiff || 0) * 3.28084)
                    } {settings.pzAltitudeUnit === 'meters' ? 'm' : 'ft'} um Sperrbereich zu verlassen
                  </div>
                </>
              ) : (
                // Ceiling-Modus: Zeige wie nah an der Obergrenze
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {trackWarning.altitudeDiff && trackWarning.altitudeDiff > 0
                    ? `${settings.pzAltitudeUnit === 'meters'
                        ? trackWarning.altitudeDiff
                        : Math.round(trackWarning.altitudeDiff * 3.28084)
                      } ${settings.pzAltitudeUnit === 'meters' ? 'm' : 'ft'} über Limit`
                    : `${settings.pzAltitudeUnit === 'meters'
                        ? Math.abs(trackWarning.altitudeDiff || 0)
                        : Math.round(Math.abs(trackWarning.altitudeDiff || 0) * 3.28084)
                      } ${settings.pzAltitudeUnit === 'meters' ? 'm' : 'ft'} bis Limit`
                  }
                </div>
              )
            ) : (
              <div style={{ fontSize: '20px', fontWeight: 700 }}>
                {trackWarning.distance < 1000
                  ? `${trackWarning.distance} m`
                  : `${(trackWarning.distance / 1000).toFixed(1)} km`
                } entfernt
              </div>
            )}
            {trackWarning.zone.altitudeWarningValue && (
              <div style={{ fontSize: '12px', opacity: 0.9 }}>
                {trackWarning.altitudeMode === 'floor'
                  ? `Sperrbereich bis: ${trackWarning.zone.altitudeWarningValue} ${settings.pzAltitudeUnit === 'meters' ? 'm' : 'ft'}`
                  : `Max. Höhe: ${trackWarning.zone.altitudeWarningValue} ${settings.pzAltitudeUnit === 'meters' ? 'm' : 'ft'}`
                }
              </div>
            )}
          </div>
          <button
            onClick={handleDismissTrackWarning}
            style={{
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            OK
          </button>
        </div>
        )
      })()}

      {/* Championship Reload Dialog - beim Start wenn letzte Meisterschaft vorhanden */}
      {showChampionshipDialog && pendingChampionship && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 20000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            borderRadius: '16px',
            padding: '28px 32px',
            minWidth: '380px',
            maxWidth: '480px',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              Wettkampfkarte laden?
            </div>
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', marginBottom: '20px', lineHeight: 1.5 }}>
              Die letzte aktive Wettkampfkarte war:
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                background: 'rgba(59, 130, 246, 0.15)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                fontWeight: 600,
                color: '#60a5fa',
                fontSize: '15px'
              }}>
                {pendingChampionship.name}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  // Wettkampfkarte und zugehörige Daten zurücksetzen
                  const { setActiveChampionship } = useFlightStore.getState()
                  setActiveChampionship(null)
                  useFlightStore.setState({
                    activeMaps: [],
                    activeCompetitionMap: null
                  })
                  setShowChampionshipDialog(false)
                  setPendingChampionship(null)
                }}
                style={{
                  padding: '10px 24px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600
                }}
              >
                Nein
              </button>
              <button
                onClick={() => {
                  // Wettkampfkarte aktivieren — genau wie toggleActiveMap
                  const state = useFlightStore.getState()
                  // Karte finden: zuerst activeCompetitionMap, dann aus savedCompetitionMaps + activeMaps
                  let map = state.activeCompetitionMap
                  if (!map && state.activeMaps.length > 0) {
                    map = state.savedCompetitionMaps.find(m => m.id === state.activeMaps[0]) || null
                  }
                  if (!map && state.savedCompetitionMaps.length > 0) {
                    // Fallback: erste gespeicherte Karte
                    map = state.savedCompetitionMaps[0]
                  }
                  if (map) {
                    // UTM Zone und 100km Square aus Kartenmitte setzen
                    const mapUtmZone = map.utmReprojection?.utmZone || map.utmZone
                    const centerLat = (map.bounds.north + map.bounds.south) / 2
                    const centerLon = (map.bounds.east + map.bounds.west) / 2
                    const utm = latLonToUTM(centerLat, centerLon, mapUtmZone)
                    const gridSquareEastBase = Math.floor(utm.easting / 100000) * 100000
                    const gridSquareNorthBase = Math.floor(utm.northing / 100000) * 100000
                    state.updateSettings({
                      utmZone: mapUtmZone || utm.zone,
                      utmBaseEasting: gridSquareEastBase,
                      utmBaseNorthing: gridSquareNorthBase
                    })
                    // Karte explizit aktivieren — wie toggleActiveMap — damit alle Komponenten re-rendern
                    useFlightStore.setState({
                      activeCompetitionMap: { ...map },
                      activeMaps: [map.id]
                    })
                  }
                  setShowChampionshipDialog(false)
                  setPendingChampionship(null)
                }}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxShadow: '0 2px 10px rgba(59, 130, 246, 0.4)'
                }}
              >
                Ja, laden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Dialog - wird nach Tasksheet-Import angezeigt */}
      <BackupDialog />

      {/* Update Popup */}
      {updateInfo && !updateDismissed && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 20000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setUpdateDismissed(true)}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            borderRadius: '16px',
            padding: '28px 32px',
            minWidth: '400px',
            maxWidth: '500px',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.6)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            color: '#fff'
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>Update verfügbar</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                  v{APP_VERSION} → v{updateInfo.version}
                </div>
              </div>
            </div>

            {/* Changelog */}
            {updateInfo.changelog && updateInfo.changelog.length > 0 ? (
              <div style={{
                margin: '16px 0',
                padding: '12px 14px',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.06)',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Änderungen
                </div>
                {updateInfo.changelog.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: i < updateInfo.changelog!.length - 1 ? '6px' : 0, fontSize: '12px', lineHeight: 1.5, color: 'rgba(255,255,255,0.7)' }}>
                    <span style={{ color: '#3b82f6', flexShrink: 0, marginTop: '1px' }}>+</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : updateInfo.message ? (
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', margin: '16px 0', lineHeight: 1.5 }}>
                {updateInfo.message}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '16px 0' }}>
                Eine neue Version ist verfügbar.
              </div>
            )}

            {/* Download-Fortschritt */}
            {downloading && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div style={{
                    height: '100%', width: `${downloadProgress}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                    borderRadius: '3px', transition: 'width 0.3s'
                  }} />
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>{downloadProgress}% heruntergeladen...</div>
              </div>
            )}
            {downloadError && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px', padding: '8px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' }}>{downloadError}</div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setUpdateDismissed(true)}
                style={{
                  padding: '10px 20px', background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px',
                  color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600
                }}
              >
                Später
              </button>
              {updateInfo.downloadUrl && window.ntaAPI?.update && !downloading && (
                <button
                  onClick={async () => {
                    setDownloading(true)
                    setDownloadError(null)
                    setDownloadProgress(0)
                    const removeListener = window.ntaAPI.update.onProgress((p) => setDownloadProgress(p.percent))
                    const result = await window.ntaAPI.update.downloadAndInstall(updateInfo!.downloadUrl!)
                    if (!result.success) {
                      setDownloadError(result.error || 'Download fehlgeschlagen')
                      setDownloading(false)
                    }
                    removeListener()
                  }}
                  style={{
                    padding: '10px 20px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 600, boxShadow: '0 2px 10px rgba(59,130,246,0.4)'
                  }}
                >
                  Jetzt installieren
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
