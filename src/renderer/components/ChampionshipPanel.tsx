import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useFlightStore } from '../stores/flightStore'
import { useAuthStore } from '../stores/authStore'
import type { FlightDataSnapshot } from '../stores/flightStore'
import { parsePZFile, exportPZtoPLT, exportPZtoWPT, exportAllPZtoWPT, exportAllPZtoPLT, downloadFile } from '../utils/pzParser'
import { AptProfileViewer, type AptProfileData } from './AptProfileViewer'
import { latLonToUTM } from '../utils/coordinatesWGS84'
import type { ProhibitedZone } from '../../shared/types'

// ============================================
// Types
// ============================================
interface Championship {
  id: string
  user_id: string
  name: string
  prohibited_zones?: ProhibitedZone[]
  map_id?: string
  archived?: boolean
  created_at: string
  // Tasksheet PDFs als Base64 gespeichert
  tasksheet_pdfs?: TasksheetPdf[]
}

interface TasksheetPdf {
  id: string
  name: string
  data: string  // Base64-encoded PDF
  uploadedAt: string
}

interface ChampionshipFlightRow {
  id: string
  championship_id: string
  name: string
  created_at: string
  hasTrack?: boolean
  isAptProfile?: boolean
}

interface EditingPZ extends ProhibitedZone {
  isNew?: boolean
  coordMode?: 'latlon' | 'utm'
  utmEasting?: string
  utmNorthing?: string
}

// ============================================
// UTM Helper Functions
// ============================================
function utmToLatLon(easting: number, northing: number, zone: number = 33): { lat: number; lon: number } {
  const k0 = 0.9996, a = 6378137, e = 0.081819191, e1sq = 0.006739497
  const arc = northing / k0
  const mu = arc / (a * (1 - Math.pow(e, 2) / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256))
  const ei = (1 - Math.pow(1 - e * e, 0.5)) / (1 + Math.pow(1 - e * e, 0.5))
  const ca = 3 * ei / 2 - 27 * Math.pow(ei, 3) / 32
  const cb = 21 * Math.pow(ei, 2) / 16 - 55 * Math.pow(ei, 4) / 32
  const cc = 151 * Math.pow(ei, 3) / 96
  const cd = 1097 * Math.pow(ei, 4) / 512
  const phi1 = mu + ca * Math.sin(2 * mu) + cb * Math.sin(4 * mu) + cc * Math.sin(6 * mu) + cd * Math.sin(8 * mu)
  const n0 = a / Math.pow(1 - Math.pow(e * Math.sin(phi1), 2), 0.5)
  const r0 = a * (1 - e * e) / Math.pow(1 - Math.pow(e * Math.sin(phi1), 2), 1.5)
  const fact1 = n0 * Math.tan(phi1) / r0
  const dd0 = (easting - 500000) / (n0 * k0)
  const fact2 = dd0 * dd0 / 2
  const fact3 = (5 + 3 * Math.pow(Math.tan(phi1), 2) + 10 * e1sq * Math.pow(Math.cos(phi1), 2) - 4 * Math.pow(e1sq, 2) * Math.pow(Math.cos(phi1), 4) - 9 * e1sq * Math.pow(Math.tan(phi1), 2)) * Math.pow(dd0, 4) / 24
  const fact4 = (61 + 90 * Math.pow(Math.tan(phi1), 2) + 298 * e1sq * Math.pow(Math.cos(phi1), 2) + 45 * Math.pow(Math.tan(phi1), 4) - 252 * e1sq - 3 * Math.pow(e1sq * Math.cos(phi1), 2)) * Math.pow(dd0, 6) / 720
  const lof1 = (1 / Math.cos(phi1)) * dd0
  const lof2 = (1 / Math.cos(phi1)) * (1 + 2 * Math.pow(Math.tan(phi1), 2) + e1sq * Math.pow(Math.cos(phi1), 2)) * Math.pow(dd0, 3) / 6
  const lof3 = (1 / Math.cos(phi1)) * (5 + 6 * e1sq * Math.pow(Math.cos(phi1), 2) + 28 * Math.pow(Math.tan(phi1), 2) - 3 * Math.pow(e1sq * Math.cos(phi1), 2) + 8 * Math.pow(Math.tan(phi1), 2) * e1sq * Math.pow(Math.cos(phi1), 2) + 24 * Math.pow(Math.tan(phi1), 4) - 4 * Math.pow(e1sq, 2) * Math.pow(Math.cos(phi1), 4) + 4 * Math.pow(Math.tan(phi1), 2) * Math.pow(e1sq * Math.cos(phi1), 2)) * Math.pow(dd0, 5) / 120
  const delta_long = (lof1 - lof2 + lof3) * 180 / Math.PI
  const zone_cm = 6 * zone - 183
  const lat = 180 * (phi1 - fact1 * (fact2 + fact3 + fact4)) / Math.PI
  const lon = zone_cm + delta_long
  return { lat, lon }
}

function expandUtmCoord(input: string, base: number): number {
  const clean = input.replace(/\s/g, '')
  const num = parseInt(clean, 10)
  if (isNaN(num)) return base
  const len = clean.length
  if (len <= 2) return base + num * 1000
  if (len === 3) return base + num * 100
  if (len === 4) return base + num * 10
  if (len === 5) return Math.floor(base / 100000) * 100000 + num
  if (len >= 6) return num
  return base + num
}

// ============================================
// Main Component
// ============================================
export function ChampionshipPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore()
  const {
    activeMaps, toggleActiveMap, savedCompetitionMaps,
    getFlightSnapshot, loadFlightData, clearFlightData,
    setProhibitedZones, prohibitedZones, settings, startPzDrawMode,
    tasksheetCoordPicker
  } = useFlightStore()

  const pzFileInputRef = useRef<HTMLInputElement>(null)

  // ─── State ───
  const [championships, setChampionships] = useState<Championship[]>([])
  const [selectedChampionship, setSelectedChampionship] = useState<Championship | null>(null)
  const [flights, setFlights] = useState<ChampionshipFlightRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'flights' | 'pz' | 'map'>('flights')
  const [showArchived, setShowArchived] = useState(false)

  // Forms
  const [newChampName, setNewChampName] = useState('')
  const [newFlightName, setNewFlightName] = useState('')
  const [creating, setCreating] = useState(false)

  // Feedback
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // PZ
  const [editingPZ, setEditingPZ] = useState<EditingPZ | null>(null)

  // Dialogs
  const [showPZDuplicateDialog, setShowPZDuplicateDialog] = useState(false)
  const [pzDuplicateInfo, setPZDuplicateInfo] = useState<{
    duplicates: ProhibitedZone[]
    uniqueNewZones: ProhibitedZone[]
    allNewZones: ProhibitedZone[]
    totalImported: number
  } | null>(null)
  const [showPLTImportDialog, setShowPLTImportDialog] = useState(false)
  const [pltImportInfo, setPLTImportInfo] = useState<{ fileName: string; resolve: (v: 'closed' | 'open' | 'cancel') => void } | null>(null)
  const [showPZImportSettingsDialog, setShowPZImportSettingsDialog] = useState(false)
  // Neue Liste für mehrere Dateien gleichzeitig
  const [pzImportFilesList, setPZImportFilesList] = useState<Array<{
    fileName: string
    hasPolygons: boolean
    hasRadius: boolean  // Mindestens eine Zone hat einen Radius
    isPltFile: boolean
    color: string
    opacity: number
    closed: boolean
    zones: ProhibitedZone[]
  }>>([])
  // Legacy - für Kompatibilität
  const [pzImportSettings, setPZImportSettings] = useState<{
    fileName: string
    hasPolygons: boolean
    isPltFile: boolean
    color: string
    opacity: number
    closed: boolean
    resolve: (v: { color: string; opacity: number; closed: boolean } | null) => void
  } | null>(null)
  const [showLoadPZDialog, setShowLoadPZDialog] = useState(false)
  const [pendingMapToggle, setPendingMapToggle] = useState<{ mapId: string; pzCount: number; zones: ProhibitedZone[] } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: 'championship' | 'flight'; id: string; name: string } | null>(null)
  const [showExportDialog, setShowExportDialog] = useState<{ type: 'pz' | 'tracks'; items: ProhibitedZone[] } | null>(null)

  // APT Profile Viewer
  const [aptProfileView, setAptProfileView] = useState<{ data: AptProfileData; name: string } | null>(null)

  // UTM Settings
  const utmBaseEasting = settings.utmBaseEasting || 500000
  const utmBaseNorthing = settings.utmBaseNorthing || 5300000
  const utmZone = settings.utmZone || 33

  // ─── Effects ───
  useEffect(() => { if (user) loadChampionships() }, [user])
  useEffect(() => {
    if (selectedChampionship) {
      loadFlights(selectedChampionship.id)
    }
  }, [selectedChampionship?.id])
  useEffect(() => { if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 3000); return () => clearTimeout(t) } }, [successMsg])
  useEffect(() => { if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t) } }, [error])

  // Wenn der Tasksheet-Koordinaten-Picker aktiv ist, Panel ausblenden
  if (tasksheetCoordPicker.active) {
    return null
  }

  // PZ zur Meisterschaft speichern (speichert die aktuell aktiven PZ)
  const savePZToChampionship = async () => {
    if (!selectedChampionship) return
    try {
      const { error: err } = await supabase.from('championships')
        .update({ prohibited_zones: prohibitedZones }).eq('id', selectedChampionship.id)
      if (!err) {
        setSelectedChampionship(prev => prev ? { ...prev, prohibited_zones: prohibitedZones } : null)
        setChampionships(prev => prev.map(c => c.id === selectedChampionship.id ? { ...c, prohibited_zones: prohibitedZones } : c))
        setSuccessMsg(`${prohibitedZones.length} PZ gespeichert`)
      }
    } catch { setError('Speichern fehlgeschlagen') }
  }

  // Tasksheet PDF zur Meisterschaft speichern
  const saveTasksheetPdf = async (pdfData: { name: string; data: string }) => {
    if (!selectedChampionship) return
    try {
      const existingPdfs = selectedChampionship.tasksheet_pdfs || []
      const newPdf: TasksheetPdf = {
        id: crypto.randomUUID(),
        name: pdfData.name,
        data: pdfData.data,
        uploadedAt: new Date().toISOString()
      }
      const updatedPdfs = [...existingPdfs, newPdf]

      const { error: err } = await supabase.from('championships')
        .update({ tasksheet_pdfs: updatedPdfs }).eq('id', selectedChampionship.id)
      if (!err) {
        setSelectedChampionship(prev => prev ? { ...prev, tasksheet_pdfs: updatedPdfs } : null)
        setChampionships(prev => prev.map(c => c.id === selectedChampionship.id ? { ...c, tasksheet_pdfs: updatedPdfs } : c))
        setSuccessMsg(`Tasksheet "${pdfData.name}" gespeichert`)
      } else {
        setError('PDF speichern fehlgeschlagen')
      }
    } catch { setError('PDF speichern fehlgeschlagen') }
  }

  // Tasksheet PDF öffnen (im neuen Tab/Fenster)
  const openTasksheetPdf = (pdf: TasksheetPdf) => {
    try {
      // Base64 zu Blob konvertieren
      const byteCharacters = atob(pdf.data)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (err) {
      console.error('Fehler beim Öffnen des PDFs:', err)
      setError('PDF konnte nicht geöffnet werden')
    }
  }

  // Tasksheet PDF löschen
  const deleteTasksheetPdf = async (pdfId: string) => {
    if (!selectedChampionship) return
    try {
      const updatedPdfs = (selectedChampionship.tasksheet_pdfs || []).filter(p => p.id !== pdfId)
      const { error: err } = await supabase.from('championships')
        .update({ tasksheet_pdfs: updatedPdfs }).eq('id', selectedChampionship.id)
      if (!err) {
        setSelectedChampionship(prev => prev ? { ...prev, tasksheet_pdfs: updatedPdfs } : null)
        setChampionships(prev => prev.map(c => c.id === selectedChampionship.id ? { ...c, tasksheet_pdfs: updatedPdfs } : c))
        setSuccessMsg('Tasksheet gelöscht')
      }
    } catch { setError('Löschen fehlgeschlagen') }
  }

  // PZ aus Meisterschaft laden (ersetzt die aktuell aktiven PZ)
  const loadPZFromChampionship = async () => {
    if (!selectedChampionship) return
    try {
      const { data, error: err } = await supabase
        .from('championships')
        .select('prohibited_zones')
        .eq('id', selectedChampionship.id)
        .single()
      if (err || !data) { setError('Laden fehlgeschlagen'); return }
      const zones = data.prohibited_zones || []
      setProhibitedZones(zones)
      setSuccessMsg(`${zones.length} PZ geladen`)
    } catch { setError('Laden fehlgeschlagen') }
  }

  // ─── Data Loading ───
  const CHAMP_CACHE_KEY = 'nta-championships-cache'

  const loadChampionships = async () => {
    if (!user) return

    // Sofort Cache anzeigen (kein Loading-Spinner wenn Cache vorhanden)
    const cached = loadChampionshipsFromCache()
    if (cached.length > 0) {
      setChampionships(cached)
    } else {
      setLoading(true)
    }

    // Im Hintergrund von Supabase aktualisieren
    try {
      const { data, error: err } = await supabase
        .from('championships').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      if (err) {
        if (cached.length === 0) {
          setError(`Fehler: ${err.message}`)
        }
        console.log('[Championship] Supabase-Fehler, verwende Cache:', err.message)
        setLoading(false)
        return
      }
      const champs = (data || []) as Championship[]
      setChampionships(champs)
      // Cache aktualisieren
      saveChampionshipsToCache(champs)
    } catch {
      // Offline: Cache wurde bereits oben gesetzt
      if (cached.length > 0) {
        console.log('[Championship] Offline - verwende Cache:', cached.length, 'Meisterschaften')
      } else {
        setError('Verbindungsfehler')
      }
    }
    setLoading(false)
  }

  const saveChampionshipsToCache = (champs: Championship[]) => {
    try {
      localStorage.setItem(CHAMP_CACHE_KEY, JSON.stringify(champs))
    } catch {}
  }

  const loadChampionshipsFromCache = (): Championship[] => {
    try {
      const raw = localStorage.getItem(CHAMP_CACHE_KEY)
      if (!raw) return []
      return JSON.parse(raw) as Championship[]
    } catch { return [] }
  }

  const FLIGHTS_CACHE_PREFIX = 'nta-flights-cache-'

  const loadFlights = async (championshipId: string) => {
    // Sofort Cache anzeigen
    const cached = loadFlightsFromCache(championshipId)
    if (cached.length > 0) {
      setFlights(cached)
    }

    try {
      const { data, error: err } = await supabase
        .from('championship_flights').select('id, championship_id, name, created_at, flight_data')
        .eq('championship_id', championshipId).order('created_at', { ascending: true })
      if (err) {
        if (cached.length === 0) {
          setError(`Fehler: ${err.message}`)
        }
        console.log('[Championship] Flights-Fehler, verwende Cache:', err.message)
        return
      }
      const flightsWithTrackInfo = (data || []).map(row => ({
        id: row.id,
        championship_id: row.championship_id,
        name: row.name,
        created_at: row.created_at,
        hasTrack: !!(row.flight_data as FlightDataSnapshot)?.track?.length,
        isAptProfile: (row.flight_data as any)?.type === 'apt_profile'
      }))
      setFlights(flightsWithTrackInfo)
      // Cache aktualisieren (nur Metadaten, nicht flight_data)
      saveFlightsToCache(championshipId, flightsWithTrackInfo)
    } catch {
      if (cached.length > 0) {
        console.log('[Championship] Offline - verwende Flights-Cache:', cached.length, 'Flüge')
      } else {
        setError('Verbindungsfehler')
      }
    }
  }

  const saveFlightsToCache = (championshipId: string, flightList: ChampionshipFlightRow[]) => {
    try {
      localStorage.setItem(FLIGHTS_CACHE_PREFIX + championshipId, JSON.stringify(flightList))
    } catch {}
  }

  const loadFlightsFromCache = (championshipId: string): ChampionshipFlightRow[] => {
    try {
      const raw = localStorage.getItem(FLIGHTS_CACHE_PREFIX + championshipId)
      if (!raw) return []
      return JSON.parse(raw) as ChampionshipFlightRow[]
    } catch { return [] }
  }

  // ─── Championship CRUD ───
  const handleCreateChampionship = async () => {
    if (!newChampName.trim() || !user) return
    setCreating(true)
    try {
      const { error: err } = await supabase.from('championships').insert({ user_id: user.id, name: newChampName.trim(), archived: false })
      if (err) { setError(`Fehler: ${err.message}`); setCreating(false); return }
      setNewChampName('')
      setSuccessMsg('Meisterschaft erstellt')
      await loadChampionships()
    } catch { setError('Verbindungsfehler') }
    setCreating(false)
  }

  const handleDeleteChampionship = async (id: string) => {
    try {
      const { error: err } = await supabase.from('championships').delete().eq('id', id)
      if (err) { setError(`Fehler: ${err.message}`); return }
      if (selectedChampionship?.id === id) setSelectedChampionship(null)
      // Cache sofort aktualisieren (gelöschtes Item entfernen)
      setChampionships(prev => {
        const updated = prev.filter(c => c.id !== id)
        saveChampionshipsToCache(updated)
        return updated
      })
      // Auch Flights-Cache löschen
      try { localStorage.removeItem(FLIGHTS_CACHE_PREFIX + id) } catch {}
      setSuccessMsg('Gelöscht')
      await loadChampionships()
    } catch { setError('Verbindungsfehler') }
    setShowDeleteConfirm(null)
  }

  const handleArchiveChampionship = async (id: string, archive: boolean) => {
    try {
      const { error: err } = await supabase.from('championships').update({ archived: archive }).eq('id', id)
      if (err) { setError(`Fehler: ${err.message}`); return }
      setSuccessMsg(archive ? 'Archiviert' : 'Wiederhergestellt')
      await loadChampionships()
    } catch { setError('Verbindungsfehler') }
  }

  // ─── Lokale Speicher-Hilfsfunktion ───
  const saveFlightLocally = async (name: string, snapshot: any): Promise<boolean> => {
    try {
      if (!window.ntaAPI?.files?.saveBackup) {
        console.warn('[Championship] Lokales Speichern nicht verfügbar (kein Electron)')
        return false
      }

      // Dateiname: Name + Datum (ohne ungültige Zeichen)
      const safeName = name.replace(/[<>:"/\\|?*]/g, '_')
      const fileName = `${safeName}.json`

      const result = await window.ntaAPI.files.saveBackup({
        fileName,
        content: JSON.stringify(snapshot, null, 2)
      })

      if (result.success) {
        setSuccessMsg(`Lokal gespeichert: ${result.path}`)
        return true
      } else {
        setError(`Fehler: ${result.error}`)
        return false
      }
    } catch (err: any) {
      setError(`Lokaler Fehler: ${err.message}`)
      return false
    }
  }

  // ─── Flight CRUD ───
  const handleSaveFlight = async () => {
    if (!selectedChampionship || !newFlightName.trim()) return
    setCreating(true)
    try {
      const snapshot = getFlightSnapshot()
      const { error: err } = await supabase.from('championship_flights')
        .insert({ championship_id: selectedChampionship.id, name: newFlightName.trim(), flight_data: snapshot })
      if (err) {
        console.warn('[Championship] Supabase-Fehler, biete lokales Speichern an:', err.message)
        // Fallback: Lokal speichern
        const saved = await saveFlightLocally(newFlightName.trim(), snapshot)
        if (saved) {
          clearFlightData()
          setNewFlightName('')
        }
        setCreating(false)
        return
      }
      clearFlightData()
      setNewFlightName('')
      setSuccessMsg('Fahrt gespeichert')
      await loadFlights(selectedChampionship.id)
    } catch (err: any) {
      console.warn('[Championship] Verbindungsfehler, biete lokales Speichern an:', err)
      // Fallback: Lokal speichern
      const snapshot = getFlightSnapshot()
      const saved = await saveFlightLocally(newFlightName.trim(), snapshot)
      if (saved) {
        clearFlightData()
        setNewFlightName('')
      }
    }
    setCreating(false)
  }

  const handleSaveBackup = async () => {
    if (!selectedChampionship) return
    setCreating(true)
    try {
      const snapshot = getFlightSnapshot()
      const now = new Date()
      const backupName = `Backup ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      const { error: err } = await supabase.from('championship_flights')
        .insert({ championship_id: selectedChampionship.id, name: backupName, flight_data: snapshot })
      if (err) {
        console.warn('[Championship] Supabase-Fehler bei Backup:', err.message)
        await saveFlightLocally(backupName, snapshot)
        setCreating(false)
        return
      }
      setSuccessMsg('Backup gespeichert')
      await loadFlights(selectedChampionship.id)
    } catch (err: any) {
      console.warn('[Championship] Verbindungsfehler bei Backup:', err)
      const snapshot = getFlightSnapshot()
      const now = new Date()
      const backupName = `Backup ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      await saveFlightLocally(backupName, snapshot)
    }
    setCreating(false)
  }

  const handleLoadFlight = async (flightId: string, flightName?: string) => {
    try {
      const { data, error: err } = await supabase.from('championship_flights').select('flight_data').eq('id', flightId).single()
      if (err || !data) { setError(`Fehler: ${err?.message || 'Keine Daten'}`); return }

      // APT Profile → Viewer öffnen statt als Flugdaten laden
      const flightData = data.flight_data as any
      if (flightData?.type === 'apt_profile') {
        setAptProfileView({ data: flightData as AptProfileData, name: flightName || 'APT Profil' })
        return
      }

      loadFlightData(data.flight_data as FlightDataSnapshot)
      setSuccessMsg('Fahrt geladen')
      onClose()
    } catch { setError('Verbindungsfehler') }
  }

  const handleDeleteFlight = async (id: string) => {
    try {
      const { error: err } = await supabase.from('championship_flights').delete().eq('id', id)
      if (err) { setError(`Fehler: ${err.message}`); return }
      // Cache sofort aktualisieren (gelöschtes Item entfernen)
      if (selectedChampionship) {
        setFlights(prev => {
          const updated = prev.filter(f => f.id !== id)
          saveFlightsToCache(selectedChampionship.id, updated)
          return updated
        })
      }
      setSuccessMsg('Fahrt gelöscht')
      if (selectedChampionship) await loadFlights(selectedChampionship.id)
    } catch { setError('Verbindungsfehler') }
    setShowDeleteConfirm(null)
  }

  const handleOpen3DView = async (flightId: string) => {
    try {
      const { data, error: err } = await supabase.from('championship_flights').select('flight_data').eq('id', flightId).single()
      if (err || !data) { setError(`Fehler: ${err?.message || 'Keine Daten'}`); return }

      const flightData = data.flight_data as FlightDataSnapshot
      if (!flightData.track || flightData.track.length === 0) {
        setError('Keine Track-Daten vorhanden')
        return
      }

      const trackData = flightData.track.map(point => ({
        lat: point.position.latitude,
        lon: point.position.longitude,
        alt: point.position.altitude,
        timestamp: point.timestamp,
        heading: point.heading || 0,
        speed: point.speed || 0,
        vario: point.verticalSpeed || 0
      }))

      const goalData = flightData.tasks.flatMap(task =>
        task.goals.map(goal => ({
          lat: goal.position.latitude,
          lon: goal.position.longitude,
          name: goal.name || task.name,
          taskName: task.name,
          radius: goal.radius,
          mmaRadius: task.mmaRadius || 0
        }))
      )

      const viewerData = JSON.stringify({ track: trackData, goals: goalData })
      const viewerUrl = `track-viewer-3d.html`

      if (window.ntaAPI?.openExternal) {
        window.ntaAPI.openExternal(viewerUrl, viewerData)
      } else {
        localStorage.setItem('nta_track_data', viewerData)
        window.open(viewerUrl, '_blank')
      }
    } catch { setError('Verbindungsfehler') }
  }

  // ─── PZ Functions ───
  // (savePZToChampionship und loadPZFromChampionship sind oben definiert)

  // ─── Map Functions ───
  const mapInfo = selectedChampionship?.map_id ? savedCompetitionMaps.find(m => m.id === selectedChampionship.map_id) : null
  const isMapActive = selectedChampionship?.map_id ? activeMaps.includes(selectedChampionship.map_id) : false

  const handleToggleMap = () => {
    if (!selectedChampionship?.map_id) return
    if (!isMapActive && selectedChampionship.prohibited_zones && selectedChampionship.prohibited_zones.length > 0) {
      setPendingMapToggle({ mapId: selectedChampionship.map_id, pzCount: selectedChampionship.prohibited_zones.length, zones: selectedChampionship.prohibited_zones })
      setShowLoadPZDialog(true)
      return
    }
    toggleActiveMap(selectedChampionship.map_id, !isMapActive)
  }

  // ─── Filter ───
  const activeChampionships = championships.filter(c => !c.archived)
  const archivedChampionships = championships.filter(c => c.archived)
  const displayedChampionships = showArchived ? archivedChampionships : activeChampionships

  // ============================================
  // Render
  // ============================================
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.97) 0%, rgba(15, 23, 42, 0.97) 100%)',
        borderRadius: '16px', width: '800px', maxWidth: '95vw', height: '600px', maxHeight: '85vh',
        boxShadow: '0 25px 80px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>

        {/* ═══════════════════════════════════════════ */}
        {/* SIDEBAR - Meisterschafts-Liste */}
        {/* ═══════════════════════════════════════════ */}
        <div style={{
          width: '260px', borderRight: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)'
        }}>
          {/* Sidebar Header */}
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f59e0b' }}>Meisterschaften</div>
              <button onClick={() => setShowArchived(!showArchived)} style={{
                background: showArchived ? 'rgba(100,116,139,0.3)' : 'transparent', border: 'none',
                color: showArchived ? '#94a3b8' : 'rgba(255,255,255,0.4)', padding: '4px 8px',
                borderRadius: '4px', fontSize: '10px', cursor: 'pointer'
              }}>
                {showArchived ? 'Archiv' : 'Aktiv'} ({showArchived ? archivedChampionships.length : activeChampionships.length})
              </button>
            </div>

            {/* Neue MS erstellen */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text" placeholder="Neue Meisterschaft..." value={newChampName}
                onChange={e => setNewChampName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateChampionship()}
                style={{
                  flex: 1, padding: '8px 10px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#fff', fontSize: '12px', outline: 'none'
                }}
              />
              <button onClick={handleCreateChampionship} disabled={!newChampName.trim() || creating} style={{
                padding: '8px 12px', background: '#f59e0b', border: 'none', borderRadius: '6px',
                color: '#000', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
                opacity: !newChampName.trim() || creating ? 0.5 : 1
              }}>+</button>
            </div>
          </div>

          {/* MS Liste */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>Laden...</div>
            ) : displayedChampionships.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
                {showArchived ? 'Kein Archiv' : 'Keine Meisterschaften'}
              </div>
            ) : displayedChampionships.map(champ => (
              <div
                key={champ.id}
                onClick={() => setSelectedChampionship(champ)}
                style={{
                  padding: '12px', marginBottom: '4px', borderRadius: '8px', cursor: 'pointer',
                  background: selectedChampionship?.id === champ.id ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
                  border: selectedChampionship?.id === champ.id ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: selectedChampionship?.id === champ.id ? '#f59e0b' : '#fff' }}>
                    {champ.name}
                  </div>
                  {champ.map_id && (
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} title="Hat Karte" />
                  )}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                  {new Date(champ.created_at).toLocaleDateString('de-DE')}
                  {champ.prohibited_zones && champ.prohibited_zones.length > 0 && (
                    <span style={{ marginLeft: '8px', color: '#ef4444' }}>{champ.prohibited_zones.length} PZ</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* MAIN CONTENT - Details */}
        {/* ═══════════════════════════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(245, 158, 11, 0.05)'
          }}>
            <div>
              {selectedChampionship ? (
                <>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{selectedChampionship.name}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                    {flights.length} Fahrten
                    {selectedChampionship.prohibited_zones && ` · ${selectedChampionship.prohibited_zones.length} PZ`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>Wähle eine Meisterschaft</div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {selectedChampionship && (
                <>
                  <button onClick={() => handleArchiveChampionship(selectedChampionship.id, !selectedChampionship.archived)}
                    title={selectedChampionship.archived ? 'Wiederherstellen' : 'Archivieren'}
                    style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', padding: '6px 8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {selectedChampionship.archived ? <><path d="M3 12h18"/><path d="M12 3v18"/></> : <><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></>}
                    </svg>
                  </button>
                  <button onClick={() => setShowDeleteConfirm({ type: 'championship', id: selectedChampionship.id, name: selectedChampionship.name })}
                    style={{ background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '6px', padding: '6px 8px', color: '#ef4444', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </>
              )}
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          {selectedChampionship && (
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { key: 'flights', label: 'Fahrten', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
                { key: 'pz', label: 'Sperrgebiete', icon: 'M12 2L22 8.5V15.5L12 22L2 15.5V8.5L12 2Z' },
                { key: 'map', label: 'Karte', icon: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z' }
              ].map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} style={{
                  flex: 1, padding: '12px', background: activeTab === tab.key ? 'rgba(245,158,11,0.1)' : 'transparent',
                  border: 'none', borderBottom: activeTab === tab.key ? '2px solid #f59e0b' : '2px solid transparent',
                  color: activeTab === tab.key ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={tab.icon}/></svg>
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Content Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {!selectedChampionship ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Wähle links eine Meisterschaft aus</div>
              </div>
            ) : activeTab === 'flights' ? (
              /* ─── FAHRTEN TAB ─── */
              <div>
                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <button onClick={handleSaveBackup} disabled={creating} style={{
                    flex: 1, padding: '12px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                    borderRadius: '8px', color: '#a855f7', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    opacity: creating ? 0.5 : 1
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/>
                      <polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Backup
                  </button>
                </div>

                {/* Neue Fahrt speichern */}
                <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <div style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600, marginBottom: '8px' }}>Fahrt abschließen & speichern</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" placeholder="Name der Fahrt..." value={newFlightName} onChange={e => setNewFlightName(e.target.value)}
                      style={{ flex: 1, padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', outline: 'none' }} />
                    <button onClick={handleSaveFlight} disabled={!newFlightName.trim() || creating} style={{
                      padding: '10px 16px', background: '#22c55e', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
                      opacity: !newFlightName.trim() || creating ? 0.5 : 1
                    }}>Speichern</button>
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '6px' }}>
                    Speichert und löscht die aktuellen Daten
                  </div>
                </div>

                {/* Fahrten Liste */}
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>Gespeicherte Fahrten ({flights.length})</div>
                {flights.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Noch keine Fahrten</div>
                ) : flights.map(flight => (
                  <div key={flight.id} style={{
                    padding: '12px', marginBottom: '6px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${flight.isAptProfile ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.05)'}`
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {flight.isAptProfile && (
                          <span style={{
                            fontSize: '9px', fontWeight: 700, color: '#06b6d4',
                            background: 'rgba(6,182,212,0.15)', padding: '1px 5px',
                            borderRadius: '3px', letterSpacing: '0.5px',
                          }}>APT</span>
                        )}
                        {flight.name}
                      </div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{new Date(flight.created_at).toLocaleString('de-DE')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => handleLoadFlight(flight.id, flight.name)} title={flight.isAptProfile ? 'Profil anzeigen' : 'Laden'} style={{
                        padding: '6px 12px', background: flight.isAptProfile ? '#06b6d4' : '#3b82f6', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer'
                      }}>{flight.isAptProfile ? 'Anzeigen' : 'Laden'}</button>
                      {flight.hasTrack && (
                        <button onClick={() => handleOpen3DView(flight.id)} title="3D Ansicht" style={{
                          padding: '6px 8px', background: 'rgba(139,92,246,0.15)', border: 'none', borderRadius: '4px', color: '#a78bfa', cursor: 'pointer'
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        </button>
                      )}
                      <button onClick={() => setShowDeleteConfirm({ type: 'flight', id: flight.id, name: flight.name })} title="Löschen" style={{
                        padding: '6px 8px', background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '4px', color: '#ef4444', cursor: 'pointer'
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : activeTab === 'pz' ? (
              /* ─── PZ TAB ─── */
              <div>
                {/* PZ Actions */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <input type="file" ref={pzFileInputRef} accept=".gpx,.wpt,.plt,.trk" multiple style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = e.target.files
                      if (!files || files.length === 0) return

                      // Sammle alle Dateien und ihre PZ-Daten
                      const filesList: Array<{
                        fileName: string
                        hasPolygons: boolean
                        hasRadius: boolean
                        isPltFile: boolean
                        color: string
                        opacity: number
                        closed: boolean
                        zones: ProhibitedZone[]
                      }> = []

                      for (const file of Array.from(files)) {
                        const content = await new Promise<string>((resolve) => {
                          const reader = new FileReader()
                          reader.onload = (event) => resolve(event.target?.result as string)
                          reader.readAsText(file)
                        })
                        const zones = parsePZFile(content, file.name)
                        if (zones.length > 0) {
                          const hasPolygons = zones.some(z => z.type === 'polygon' && z.polygon && z.polygon.length > 2)
                          const hasRadius = zones.some(z => z.radius && z.radius > 0)
                          const isPltFile = file.name.toLowerCase().endsWith('.plt')

                          filesList.push({
                            fileName: file.name,
                            hasPolygons,
                            hasRadius,
                            isPltFile,
                            color: settings.pzCircleColor || '#ef4444',
                            opacity: settings.pzCircleOpacity ?? 0.15,
                            closed: !isPltFile, // PLT-Dateien standardmäßig offen
                            zones
                          })
                        }
                      }

                      if (filesList.length > 0) {
                        // Zeige Dialog mit Liste aller Dateien
                        setPZImportFilesList(filesList)
                        setShowPZImportSettingsDialog(true)
                      } else {
                        setError('Keine PZ gefunden')
                      }
                      e.target.value = ''
                    }}
                  />
                  <button onClick={() => pzFileInputRef.current?.click()} style={{
                    flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Import
                  </button>
                  <button onClick={() => { startPzDrawMode(); onClose() }} style={{
                    flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
                    Zeichnen
                  </button>
                </div>

                {/* Gespeicherte PZ der Meisterschaft */}
                <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Gespeicherte PZ</div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                        {selectedChampionship.prohibited_zones?.length || 0} PZ in dieser Meisterschaft
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={loadPZFromChampionship} style={{
                      flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Laden
                    </button>
                    <button onClick={savePZToChampionship} style={{
                      flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
                      Speichern
                    </button>
                  </div>
                </div>

                {/* Aktuelle PZ (auf der Karte) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                    Aktive PZ auf der Karte ({prohibitedZones.length})
                  </div>
                  {/* Alle herunterladen / Alle löschen Buttons */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {/* Alle PZ (Punkte) herunterladen */}
                    {prohibitedZones.filter(pz => !pz.type || pz.type !== 'polygon' || !pz.polygon || pz.polygon.length < 3).length > 0 && (
                      <button onClick={() => {
                        const points = prohibitedZones.filter(pz => !pz.type || pz.type !== 'polygon' || !pz.polygon || pz.polygon.length < 3)
                        setShowExportDialog({ type: 'pz', items: points })
                      }} style={{
                        padding: '4px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '4px', color: '#ef4444', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }} title="Alle PZ-Punkte exportieren">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Alle PZ
                      </button>
                    )}
                    {/* Alle Tracks herunterladen */}
                    {prohibitedZones.filter(pz => pz.type === 'polygon' && pz.polygon && pz.polygon.length >= 3).length > 0 && (
                      <button onClick={() => {
                        const polygons = prohibitedZones.filter(pz => pz.type === 'polygon' && pz.polygon && pz.polygon.length >= 3)
                        setShowExportDialog({ type: 'tracks', items: polygons })
                      }} style={{
                        padding: '4px 8px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                        borderRadius: '4px', color: '#f59e0b', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }} title="Alle Tracks exportieren">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Alle Tracks
                      </button>
                    )}
                    {/* Alle PZ löschen */}
                    {prohibitedZones.length > 0 && (
                      <button onClick={() => setShowDeleteConfirm({ type: 'championship', id: 'all-pz', name: `alle ${prohibitedZones.length} PZ` })} style={{
                        padding: '4px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: '4px', color: '#ef4444', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }} title="Alle PZ von der Karte löschen">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                        Alle
                      </button>
                    )}
                  </div>
                </div>

                {prohibitedZones.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Keine PZ geladen</div>
                ) : (
                  <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {[...prohibitedZones].sort((a, b) => a.name.localeCompare(b.name)).map((pz, idx) => {
                      const isPolygon = pz.type === 'polygon' && pz.polygon && pz.polygon.length > 0
                      const isOpen = pz.closed === false
                      const isTrack = pz.sourceType === 'track' || pz.sourceType === 'plt'
                      return (
                        <div key={pz.id} style={{
                          padding: '10px 12px', marginBottom: '4px',
                          background: isTrack ? 'rgba(245,158,11,0.05)' : 'rgba(239,68,68,0.05)',
                          borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          border: isTrack ? '1px solid rgba(245,158,11,0.1)' : '1px solid rgba(239,68,68,0.1)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '24px', height: '24px', borderRadius: '4px',
                              background: isTrack ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                              {isPolygon ? (
                                isTrack ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
                                )
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m10-10h-4M6 12H2"/></svg>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 500, color: '#fff' }}>{pz.name}</div>
                              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                                {isPolygon
                                  ? `${pz.polygon?.length || 0} Punkte · ${isOpen ? 'Linie' : 'Polygon'}`
                                  : pz.radius ? `${pz.radius}m` : 'Punkt'}
                                {pz.elevation && ` · ${pz.elevation}ft`}
                                {isTrack && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>(Track)</span>}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {/* Download Button - PLT für Tracks/Polygone, WPT für Punkte */}
                            {isPolygon ? (
                              <button onClick={() => {
                                const pltContent = exportPZtoPLT(pz)
                                const filename = `${pz.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.plt`
                                downloadFile(pltContent, filename)
                              }} style={{
                                background: isTrack ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                                border: 'none', color: isTrack ? '#f59e0b' : '#ef4444', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px'
                              }} title="Als PLT herunterladen">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </button>
                            ) : (
                              <button onClick={() => {
                                const wptContent = exportPZtoWPT(pz)
                                const filename = `${pz.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.wpt`
                                downloadFile(wptContent, filename)
                              }} style={{
                                background: 'rgba(239,68,68,0.15)', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px'
                              }} title="Als WPT herunterladen">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </button>
                            )}
                            <button onClick={() => {
                              // Bei Polygon-PZ: Koordinaten aus erstem Punkt holen falls lat/lon 0 sind
                              let editLat = pz.lat
                              let editLon = pz.lon
                              if ((pz.lat === 0 || pz.lon === 0) && pz.polygon && pz.polygon.length > 0) {
                                editLat = pz.polygon[0].lat
                                editLon = pz.polygon[0].lon
                              }
                              // UTM-Koordinaten berechnen und vorausfüllen
                              const utm = latLonToUTM(editLat, editLon, utmZone)
                              setEditingPZ({
                                ...pz,
                                lat: editLat,
                                lon: editLon,
                                isNew: false,
                                coordMode: 'utm',
                                utmEasting: Math.round(utm.easting).toString(),
                                utmNorthing: Math.round(utm.northing).toString()
                              })
                            }} style={{
                              background: 'rgba(59,130,246,0.15)', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px'
                            }} title="Bearbeiten">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button onClick={() => setProhibitedZones(prohibitedZones.filter(p => p.id !== pz.id))} style={{
                              background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '4px'
                            }} title="Löschen">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

              </div>
            ) : (
              /* ─── KARTE TAB ─── */
              <div>
                {mapInfo ? (
                  <div style={{ padding: '16px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: 'rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{mapInfo.name}</div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Wettkampfkarte verknüpft</div>
                      </div>
                    </div>
                    <button onClick={handleToggleMap} style={{
                      width: '100%', padding: '12px', background: isMapActive ? 'rgba(239,68,68,0.15)' : '#22c55e',
                      border: isMapActive ? '1px solid rgba(239,68,68,0.3)' : 'none', borderRadius: '8px',
                      color: isMapActive ? '#ef4444' : '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                    }}>
                      {isMapActive ? 'Karte ausblenden' : 'Karte einblenden'}
                    </button>
                  </div>
                ) : (
                  <div style={{ padding: '32px', textAlign: 'center' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" style={{ marginBottom: '12px' }}>
                      <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/>
                    </svg>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>Keine Karte verknüpft</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>Erstelle eine Wettkampfkarte im Competition Area Panel</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Feedback Messages */}
          {(successMsg || error) && (
            <div style={{
              padding: '12px 16px', margin: '0 16px 16px', borderRadius: '8px',
              background: successMsg ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${successMsg ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: successMsg ? '#22c55e' : '#ef4444', fontSize: '12px', fontWeight: 500
            }}>
              {successMsg || error}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* DIALOGS */}
      {/* ═══════════════════════════════════════════ */}

      {/* PZ Edit Dialog */}
      {editingPZ && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(168,85,247,0.3)', padding: '24px', width: '380px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{editingPZ.isNew ? 'Neuer PZ Punkt' : 'PZ bearbeiten'}</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Sperrgebiet {editingPZ.isNew ? 'erstellen' : 'ändern'}</div>
              </div>
            </div>

            {/* Name */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Name</div>
              <input type="text" value={editingPZ.name} onChange={e => setEditingPZ({ ...editingPZ, name: e.target.value })}
                placeholder="z.B. PZ Alpha" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            {/* Polygon Info (bei importierten Polygonen) */}
            {editingPZ.type === 'polygon' && editingPZ.polygon && editingPZ.polygon.length > 0 && (() => {
              const utm = latLonToUTM(editingPZ.lat, editingPZ.lon, utmZone)
              return (
                <div style={{ marginBottom: '12px', padding: '10px', background: 'rgba(59,130,246,0.1)', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <div style={{ fontSize: '10px', color: '#3b82f6', fontWeight: 600, marginBottom: '4px' }}>Polygon mit {editingPZ.polygon.length} Punkten</div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
                    Zentrum: E {Math.round(utm.easting)} / N {Math.round(utm.northing)} (Zone {utmZone})
                  </div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                    {editingPZ.lat.toFixed(6)}°, {editingPZ.lon.toFixed(6)}°
                  </div>
                </div>
              )
            })()}

            {/* Koordinaten Modus */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <button onClick={() => setEditingPZ({ ...editingPZ, coordMode: 'utm' })} style={{
                flex: 1, padding: '8px', background: editingPZ.coordMode === 'utm' ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
                border: editingPZ.coordMode === 'utm' ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px', color: editingPZ.coordMode === 'utm' ? '#a855f7' : 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}>UTM Grid</button>
              <button onClick={() => setEditingPZ({ ...editingPZ, coordMode: 'latlon' })} style={{
                flex: 1, padding: '8px', background: editingPZ.coordMode === 'latlon' ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
                border: editingPZ.coordMode === 'latlon' ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px', color: editingPZ.coordMode === 'latlon' ? '#a855f7' : 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer'
              }}>Lat/Lon</button>
            </div>

            {/* UTM Koordinaten */}
            {editingPZ.coordMode === 'utm' && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Easting (E)</div>
                  <input type="text" value={editingPZ.utmEasting || ''} onChange={e => setEditingPZ({ ...editingPZ, utmEasting: e.target.value })}
                    placeholder="z.B. 12345" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Northing (N)</div>
                  <input type="text" value={editingPZ.utmNorthing || ''} onChange={e => setEditingPZ({ ...editingPZ, utmNorthing: e.target.value })}
                    placeholder="z.B. 67890" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                </div>
              </div>
            )}

            {/* Lat/Lon Koordinaten */}
            {editingPZ.coordMode === 'latlon' && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Latitude</div>
                  <input type="text" value={editingPZ.lat || ''} onChange={e => setEditingPZ({ ...editingPZ, lat: parseFloat(e.target.value) || 0 })}
                    placeholder="z.B. 48.2082" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Longitude</div>
                  <input type="text" value={editingPZ.lon || ''} onChange={e => setEditingPZ({ ...editingPZ, lon: parseFloat(e.target.value) || 0 })}
                    placeholder="z.B. 16.3738" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
                </div>
              </div>
            )}

            {/* Radius & Höhe */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Radius (m)</div>
                <input type="number" value={editingPZ.radius || ''} onChange={e => setEditingPZ({ ...editingPZ, radius: parseInt(e.target.value) || undefined })}
                  placeholder="Optional" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Höhe (ft)</div>
                <input type="number" value={editingPZ.elevation || ''} onChange={e => setEditingPZ({ ...editingPZ, elevation: parseInt(e.target.value) || undefined })}
                  placeholder="Optional" style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Farbe und Deckkraft - nur wenn Radius oder Polygon vorhanden */}
            {((editingPZ.radius && editingPZ.radius > 0) || (editingPZ.type === 'polygon' && editingPZ.polygon && editingPZ.polygon.length > 0)) && (
              <div style={{ marginBottom: '12px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>Darstellung</div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Farbe</div>
                    <input
                      type="color"
                      value={editingPZ.color || settings.pzCircleColor || '#ef4444'}
                      onChange={e => setEditingPZ({ ...editingPZ, color: e.target.value })}
                      style={{ width: '100%', height: '32px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'transparent' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Deckkraft ({Math.round((editingPZ.fillOpacity ?? 0.15) * 100)}%)</div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((editingPZ.fillOpacity ?? 0.15) * 100)}
                      onChange={e => setEditingPZ({ ...editingPZ, fillOpacity: parseInt(e.target.value) / 100 })}
                      style={{ width: '100%', height: '32px', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '6px',
                    border: '2px solid ' + (editingPZ.color || settings.pzCircleColor || '#ef4444'),
                    background: (editingPZ.color || settings.pzCircleColor || '#ef4444') + Math.round((editingPZ.fillOpacity ?? 0.15) * 255).toString(16).padStart(2, '0')
                  }} />
                </div>
              </div>
            )}

            {/* Warnungs-Einstellungen */}
            <div style={{ marginBottom: '12px', padding: '12px', background: editingPZ.warningDisabled ? 'rgba(239,68,68,0.1)' : 'rgba(139,92,246,0.1)', borderRadius: '8px', border: editingPZ.warningDisabled ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(139,92,246,0.2)' }}>
              <div style={{ fontSize: '10px', color: editingPZ.warningDisabled ? '#ef4444' : '#8b5cf6', fontWeight: 600, marginBottom: '10px' }}>Warnungen</div>

              {/* Warnungen deaktivieren */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={editingPZ.warningDisabled || false}
                  onChange={e => setEditingPZ({ ...editingPZ, warningDisabled: e.target.checked })}
                  style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#ef4444' }} />
                <span style={{ fontSize: '11px', color: editingPZ.warningDisabled ? '#ef4444' : 'white' }}>Keine Warnungen für dieses Sperrgebiet</span>
              </label>

              {/* Höhen-Warnung - nur wenn Warnungen nicht deaktiviert UND Höhe eingegeben */}
              {!editingPZ.warningDisabled && (editingPZ.elevation || 0) > 0 && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editingPZ.altitudeWarning || false}
                      onChange={e => setEditingPZ({ ...editingPZ, altitudeWarning: e.target.checked })}
                      style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                    <span style={{ fontSize: '11px', color: 'white' }}>Höhen-Warnung aktivieren ({editingPZ.elevation} ft)</span>
                  </label>
              {editingPZ.altitudeWarning && (
                <div style={{ marginLeft: '22px' }}>
                  {/* Modus-Auswahl */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>Modus:</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setEditingPZ({ ...editingPZ, altitudeWarningMode: 'floor' })}
                        style={{
                          flex: 1, padding: '8px 6px', fontSize: '10px', fontWeight: 600,
                          background: (editingPZ.altitudeWarningMode || 'ceiling') === 'floor' ? 'rgba(139,92,246,0.4)' : 'rgba(0,0,0,0.3)',
                          border: (editingPZ.altitudeWarningMode || 'ceiling') === 'floor' ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '6px', color: '#fff', cursor: 'pointer'
                        }}
                      >
                        Von Boden bis
                      </button>
                      <button
                        onClick={() => setEditingPZ({ ...editingPZ, altitudeWarningMode: 'ceiling' })}
                        style={{
                          flex: 1, padding: '8px 6px', fontSize: '10px', fontWeight: 600,
                          background: (editingPZ.altitudeWarningMode || 'ceiling') === 'ceiling' ? 'rgba(139,92,246,0.4)' : 'rgba(0,0,0,0.3)',
                          border: (editingPZ.altitudeWarningMode || 'ceiling') === 'ceiling' ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '6px', color: '#fff', cursor: 'pointer'
                        }}
                      >
                        Höhenbegrenzung
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', lineHeight: '1.4' }}>
                    {(editingPZ.altitudeWarningMode || 'ceiling') === 'floor'
                      ? `Sperrbereich von Boden bis ${editingPZ.elevation} ft. Vorlauf-Warnung (Margin) wird in den Einstellungen festgelegt.`
                      : `Maximale Flughöhe: ${editingPZ.elevation} ft. Vorlauf-Warnung (Margin) wird in den Einstellungen festgelegt.`
                    }
                  </div>
                </div>
              )}
                </>
              )}
            </div>

            {/* Polygon Einstellungen (nur bei Polygon-PZ) */}
            {editingPZ.type === 'polygon' && editingPZ.polygon && editingPZ.polygon.length > 0 && (
              <>
                {/* Offen/Geschlossen Toggle */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>Polygon-Typ</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setEditingPZ({ ...editingPZ, closed: true })} style={{
                      flex: 1, padding: '10px', background: editingPZ.closed !== false ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                      border: editingPZ.closed !== false ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px', color: editingPZ.closed !== false ? '#ef4444' : 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
                      Geschlossen
                    </button>
                    <button onClick={() => setEditingPZ({ ...editingPZ, closed: false, fillOpacity: 0 })} style={{
                      flex: 1, padding: '10px', background: editingPZ.closed === false ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
                      border: editingPZ.closed === false ? '1px solid rgba(245,158,11,0.4)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px', color: editingPZ.closed === false ? '#f59e0b' : 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                      Offen (Linie)
                    </button>
                  </div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                    {editingPZ.closed !== false ? 'Geschlossenes Polygon mit Füllung' : 'Offene Linie ohne Füllung (Track)'}
                  </div>
                </div>

              </>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setEditingPZ(null)} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={() => {
                if (!editingPZ.name.trim()) return
                let finalLat = editingPZ.lat
                let finalLon = editingPZ.lon
                if (editingPZ.coordMode === 'utm' && editingPZ.utmEasting && editingPZ.utmNorthing) {
                  const easting = expandUtmCoord(editingPZ.utmEasting, utmBaseEasting)
                  const northing = expandUtmCoord(editingPZ.utmNorthing, utmBaseNorthing)
                  const coords = utmToLatLon(easting, northing, utmZone)
                  finalLat = coords.lat
                  finalLon = coords.lon
                }
                const pzData: ProhibitedZone = {
                  id: editingPZ.id,
                  name: editingPZ.name.trim(),
                  lat: finalLat,
                  lon: finalLon,
                  radius: editingPZ.radius,
                  elevation: editingPZ.elevation,
                  type: editingPZ.type,
                  polygon: editingPZ.polygon,
                  closed: editingPZ.closed,
                  fillOpacity: editingPZ.fillOpacity,
                  color: editingPZ.color,
                  sourceType: editingPZ.sourceType,
                  warningDisabled: editingPZ.warningDisabled,
                  distanceWarning: editingPZ.distanceWarning,
                  distanceWarningValue: editingPZ.distanceWarningValue,
                  altitudeWarning: editingPZ.altitudeWarning,
                  altitudeWarningMode: editingPZ.altitudeWarningMode
                }
                if (editingPZ.isNew) {
                  setProhibitedZones([...prohibitedZones, pzData])
                } else {
                  setProhibitedZones(prohibitedZones.map(pz => pz.id === pzData.id ? pzData : pz))
                }
                setEditingPZ(null)
              }} disabled={!editingPZ.name.trim()} style={{
                flex: 1, padding: '12px', background: '#a855f7', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                opacity: !editingPZ.name.trim() ? 0.5 : 1
              }}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(239,68,68,0.3)', padding: '24px', width: '340px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Löschen?</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px' }}>
              "{showDeleteConfirm.name}" wirklich löschen?
              {showDeleteConfirm.type === 'championship' && showDeleteConfirm.id !== 'all-pz' && ' Alle Fahrten werden gelöscht.'}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowDeleteConfirm(null)} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={() => {
                if (showDeleteConfirm.id === 'all-pz') {
                  setProhibitedZones([])
                  setSuccessMsg('Alle PZ gelöscht')
                  setShowDeleteConfirm(null)
                } else if (showDeleteConfirm.type === 'championship') {
                  handleDeleteChampionship(showDeleteConfirm.id)
                } else {
                  handleDeleteFlight(showDeleteConfirm.id)
                }
              }}
                style={{ flex: 1, padding: '10px', background: '#ef4444', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Löschen</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog - Einzeln oder zusammen exportieren */}
      {showExportDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.3)', padding: '24px', width: '360px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: showExportDialog.type === 'pz' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={showExportDialog.type === 'pz' ? '#ef4444' : '#f59e0b'} strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
              {showExportDialog.items.length} {showExportDialog.type === 'pz' ? 'PZ-Punkte' : 'Tracks'} exportieren
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px' }}>
              Wie möchtest du exportieren?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => {
                // Alle in eine Datei
                if (showExportDialog.type === 'pz') {
                  const wptContent = exportAllPZtoWPT(showExportDialog.items)
                  const filename = `PZ_Punkte_${new Date().toISOString().slice(0, 10)}.wpt`
                  downloadFile(wptContent, filename)
                } else {
                  const pltContent = exportAllPZtoPLT(showExportDialog.items)
                  const filename = `PZ_Tracks_${new Date().toISOString().slice(0, 10)}.plt`
                  downloadFile(pltContent, filename)
                }
                setShowExportDialog(null)
                setSuccessMsg(`${showExportDialog.items.length} ${showExportDialog.type === 'pz' ? 'PZ' : 'Tracks'} in eine Datei exportiert`)
              }} style={{
                padding: '12px', background: showExportDialog.type === 'pz' ? '#ef4444' : '#f59e0b', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg>
                Alle in eine Datei
              </button>
              <button onClick={async () => {
                // Jede einzeln in Ordner speichern
                if (window.ntaAPI?.dialog?.selectFolder && window.ntaAPI?.files?.saveToFolder) {
                  const folderPath = await window.ntaAPI.dialog.selectFolder({
                    title: `Ordner für ${showExportDialog.items.length} ${showExportDialog.type === 'pz' ? 'PZ-Dateien' : 'Track-Dateien'} auswählen`
                  })
                  if (folderPath) {
                    let savedCount = 0
                    for (const pz of showExportDialog.items) {
                      const content = showExportDialog.type === 'pz' ? exportPZtoWPT(pz) : exportPZtoPLT(pz)
                      const ext = showExportDialog.type === 'pz' ? 'wpt' : 'plt'
                      const filename = `${pz.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`
                      const result = await window.ntaAPI.files.saveToFolder({ folderPath, fileName: filename, content })
                      if (result.success) savedCount++
                    }
                    setSuccessMsg(`${savedCount} ${showExportDialog.type === 'pz' ? 'PZ' : 'Tracks'} in Ordner gespeichert`)
                  }
                } else {
                  // Fallback: Browser-Download
                  if (showExportDialog.type === 'pz') {
                    showExportDialog.items.forEach(pz => {
                      const wptContent = exportPZtoWPT(pz)
                      const filename = `${pz.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.wpt`
                      downloadFile(wptContent, filename)
                    })
                  } else {
                    showExportDialog.items.forEach(pz => {
                      const pltContent = exportPZtoPLT(pz)
                      const filename = `${pz.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.plt`
                      downloadFile(pltContent, filename)
                    })
                  }
                  setSuccessMsg(`${showExportDialog.items.length} ${showExportDialog.type === 'pz' ? 'PZ' : 'Tracks'} einzeln exportiert`)
                }
                setShowExportDialog(null)
              }} style={{
                padding: '12px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Jede einzeln in Ordner ({showExportDialog.items.length} Dateien)
              </button>
              <button onClick={() => setShowExportDialog(null)} style={{
                padding: '10px', background: 'transparent', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer'
              }}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* PZ Import Settings Dialog - Liste aller Dateien mit individuellen Einstellungen */}
      {showPZImportSettingsDialog && pzImportFilesList.length > 0 && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.3)', padding: '24px', width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>Import-Einstellungen</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                  {pzImportFilesList.length} {pzImportFilesList.length === 1 ? 'Datei' : 'Dateien'} · {pzImportFilesList.reduce((sum, f) => sum + f.zones.length, 0)} PZ
                </div>
              </div>
            </div>

            {/* Scrollbare Liste */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
              {pzImportFilesList.map((file, index) => (
                <div key={index} style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  marginBottom: index < pzImportFilesList.length - 1 ? '10px' : 0
                }}>
                  {/* Dateiname */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={file.isPltFile ? '#f59e0b' : '#3b82f6'} strokeWidth="2">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    </svg>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff', flex: 1 }}>{file.fileName}</span>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{file.zones.length} PZ</span>
                  </div>

                  {/* Farbe, Deckkraft und Vorschau - nur wenn Radius oder Polygon vorhanden */}
                  {(file.hasPolygons || file.hasRadius) && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: file.hasPolygons ? '10px' : 0 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>Farbe</div>
                        <input
                          type="color"
                          value={file.color}
                          onChange={e => {
                            const updated = [...pzImportFilesList]
                            updated[index].color = e.target.value
                            setPZImportFilesList(updated)
                          }}
                          style={{ width: '100%', height: '28px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: 'transparent' }}
                        />
                      </div>
                      <div style={{ flex: 1.5 }}>
                        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>Deckkraft ({Math.round(file.opacity * 100)}%)</div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(file.opacity * 100)}
                          onChange={e => {
                            const updated = [...pzImportFilesList]
                            updated[index].opacity = parseInt(e.target.value) / 100
                            setPZImportFilesList(updated)
                          }}
                          style={{ width: '100%', height: '28px', cursor: 'pointer' }}
                        />
                      </div>
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '6px', flexShrink: 0,
                        border: '2px solid ' + file.color,
                        background: file.color + Math.round(file.opacity * 255).toString(16).padStart(2, '0')
                      }} />
                    </div>
                  )}

                  {/* Polygon: offen/geschlossen */}
                  {file.hasPolygons && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => {
                          const updated = [...pzImportFilesList]
                          updated[index].closed = true
                          setPZImportFilesList(updated)
                        }}
                        style={{
                          flex: 1, padding: '6px', borderRadius: '6px', cursor: 'pointer',
                          background: file.closed ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                          border: file.closed ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)',
                          color: file.closed ? '#ef4444' : 'rgba(255,255,255,0.4)',
                          fontSize: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
                        Geschlossen
                      </button>
                      <button
                        onClick={() => {
                          const updated = [...pzImportFilesList]
                          updated[index].closed = false
                          setPZImportFilesList(updated)
                        }}
                        style={{
                          flex: 1, padding: '6px', borderRadius: '6px', cursor: 'pointer',
                          background: !file.closed ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
                          border: !file.closed ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                          color: !file.closed ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                          fontSize: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                        Offene Linie
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  setShowPZImportSettingsDialog(false)
                  setPZImportFilesList([])
                }}
                style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer' }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  // Alle Dateien importieren mit ihren individuellen Einstellungen
                  let allNewZones: ProhibitedZone[] = []
                  let totalImported = 0

                  for (const file of pzImportFilesList) {
                    file.zones.forEach(z => {
                      z.color = file.color
                      if (z.type === 'polygon') {
                        z.closed = file.closed
                        z.fillOpacity = file.closed ? file.opacity : 0
                        z.sourceType = file.isPltFile ? 'plt' : undefined
                      } else {
                        z.fillOpacity = file.opacity
                      }
                    })
                    allNewZones = [...allNewZones, ...file.zones]
                    totalImported += file.zones.length
                  }

                  // Duplikat-Prüfung
                  const duplicates: ProhibitedZone[] = []
                  const uniqueNewZones: ProhibitedZone[] = []
                  for (const newZone of allNewZones) {
                    const isDuplicate = prohibitedZones.some(existing =>
                      existing.name === newZone.name || (Math.abs(existing.lat - newZone.lat) < 0.0001 && Math.abs(existing.lon - newZone.lon) < 0.0001)
                    )
                    if (isDuplicate) duplicates.push(newZone)
                    else uniqueNewZones.push(newZone)
                  }

                  if (duplicates.length > 0) {
                    setPZDuplicateInfo({ duplicates, uniqueNewZones, allNewZones, totalImported })
                    setShowPZDuplicateDialog(true)
                  } else {
                    setProhibitedZones([...prohibitedZones, ...allNewZones])
                    setSuccessMsg(`${totalImported} PZ importiert`)
                  }

                  setShowPZImportSettingsDialog(false)
                  setPZImportFilesList([])
                }}
                style={{ flex: 1, padding: '12px', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                {pzImportFilesList.reduce((sum, f) => sum + f.zones.length, 0)} PZ importieren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PZ Duplicate Dialog */}
      {showPZDuplicateDialog && pzDuplicateInfo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(245,158,11,0.3)', padding: '24px', width: '380px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Duplikate gefunden</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{pzDuplicateInfo.duplicates.length}</span> von {pzDuplicateInfo.totalImported} PZ existieren bereits
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button onClick={() => { setProhibitedZones([...prohibitedZones, ...pzDuplicateInfo.allNewZones]); setSuccessMsg(`${pzDuplicateInfo.totalImported} PZ importiert`); setShowPZDuplicateDialog(false); setPZDuplicateInfo(null) }}
                style={{ flex: 1, padding: '10px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', color: '#f59e0b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Alle</button>
              <button onClick={() => { if (pzDuplicateInfo.uniqueNewZones.length > 0) { setProhibitedZones([...prohibitedZones, ...pzDuplicateInfo.uniqueNewZones]); setSuccessMsg(`${pzDuplicateInfo.uniqueNewZones.length} PZ importiert`) } else { setError('Alle waren Duplikate') }; setShowPZDuplicateDialog(false); setPZDuplicateInfo(null) }}
                style={{ flex: 1, padding: '10px', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Nur neue ({pzDuplicateInfo.uniqueNewZones.length})</button>
            </div>
            <button onClick={() => { setShowPZDuplicateDialog(false); setPZDuplicateInfo(null) }}
              style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer' }}>Abbrechen</button>
          </div>
        </div>
      )}

      {/* Load PZ Dialog */}
      {showLoadPZDialog && pendingMapToggle && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '16px', border: '1px solid rgba(239,68,68,0.3)', padding: '24px', width: '340px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Sperrgebiete laden?</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
              Diese Meisterschaft hat <span style={{ color: '#ef4444', fontWeight: 600 }}>{pendingMapToggle.pzCount}</span> gespeicherte PZ. Laden?
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { toggleActiveMap(pendingMapToggle.mapId, true); setShowLoadPZDialog(false); setPendingMapToggle(null) }}
                style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Nein</button>
              <button onClick={() => { setProhibitedZones(pendingMapToggle.zones); toggleActiveMap(pendingMapToggle.mapId, true); setShowLoadPZDialog(false); setPendingMapToggle(null) }}
                style={{ flex: 1, padding: '10px', background: '#ef4444', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Ja, laden</button>
            </div>
          </div>
        </div>
      )}

      {/* APT Profile Viewer */}
      {aptProfileView && (
        <AptProfileViewer
          data={aptProfileView.data}
          name={aptProfileView.name}
          onClose={() => setAptProfileView(null)}
        />
      )}
    </div>
  )
}
