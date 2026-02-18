import React, { useState, useEffect, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { latLonToUTM, utmToLatLon, UTMWGS84 } from '../utils/coordinatesWGS84'
import type { CompetitionMap } from '../../shared/types'

// Meisterschaft Interface (aus Supabase)
interface Championship {
  id: string
  user_id: string
  name: string
  map_id?: string
  archived?: boolean
  created_at: string
}

interface CornerPoint {
  lat: number
  lon: number
  utmEasting: string
  utmNorthing: string
}

interface DownloadProgress {
  total: number
  downloaded: number
  cached: number
  failed: number
  currentTile: string
}

const CORNER_NAMES = ['Nordwest (NW)', 'Nordost (NO)', 'Südost (SO)', 'Südwest (SW)']
const CORNER_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6']

export function CompetitionAreaPanel({ onClose }: { onClose: () => void }) {
  const {
    settings,
    addCompetitionMap,
    toggleActiveMap
  } = useFlightStore()
  const { user } = useAuthStore()

  // Kartenname für Speichern
  const [mapName, setMapName] = useState('')

  // Meisterschaften für Speichern-Dialog
  const [championships, setChampionships] = useState<Championship[]>([])
  const [selectedChampionshipId, setSelectedChampionshipId] = useState<string>('')
  const [newChampionshipName, setNewChampionshipName] = useState('')
  const [showNewChampionshipInput, setShowNewChampionshipInput] = useState(false)
  const [savingToChampionship, setSavingToChampionship] = useState(false)

  // 4 Eckpunkte
  const [corners, setCorners] = useState<CornerPoint[]>([
    { lat: 0, lon: 0, utmEasting: '', utmNorthing: '' },
    { lat: 0, lon: 0, utmEasting: '', utmNorthing: '' },
    { lat: 0, lon: 0, utmEasting: '', utmNorthing: '' },
    { lat: 0, lon: 0, utmEasting: '', utmNorthing: '' }
  ])

  // Modus: 'input' für Koordinateneingabe, 'select' für Kartenauswahl
  const [mode, setMode] = useState<'input' | 'select'>('input')
  const [selectingCorner, setSelectingCorner] = useState<number | null>(null)

  // Download-Status
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadResult, setDownloadResult] = useState<any>(null)

  // Tile-Schätzung
  const [tileEstimate, setTileEstimate] = useState<{ count: number; estimatedSize: number } | null>(null)

  // Zoom-Level Auswahl
  const [minZoom, setMinZoom] = useState(8)
  const [maxZoom, setMaxZoom] = useState(17)

  // Karten-Provider Auswahl
  const [tileProvider, setTileProvider] = useState<'openstreetmap' | 'opentopomap'>('openstreetmap')

  // UTM Zone - lokal änderbar (nur gültige Werte 1-60, sonst 33)
  const [utmZone, setUtmZone] = useState(
    settings.utmZone >= 1 && settings.utmZone <= 60 ? settings.utmZone : 33
  )
  const [hemisphere, setHemisphere] = useState<'N' | 'S'>('N')
  const [latitudeBand, setLatitudeBand] = useState<string>('U')

  // Import Status
  const [isImporting, setIsImporting] = useState(false)

  // MBTiles Import Status
  const [isMBTilesImporting, setIsMBTilesImporting] = useState(false)
  const [mbtilesProgress, setMbtilesProgress] = useState<{
    total: number; imported: number; skipped: number; failed: number
    currentTile: string; phase: 'reading' | 'importing' | 'done'
  } | null>(null)

  // Reprojection Status
  const [isReprojecting, setIsReprojecting] = useState(false)

  // Dialog: Karte jetzt anzeigen
  const [showMapSavedDialog, setShowMapSavedDialog] = useState(false)
  const [savedMapId, setSavedMapId] = useState<string | null>(null)
  const [reprojectProgress, setReprojectProgress] = useState<{ message: string; percent: number } | null>(null)
  const [reprojectResult, setReprojectResult] = useState<{
    imagePath: string
    bounds: { north: number; south: number; east: number; west: number }
    utmBounds: { minE: number; maxE: number; minN: number; maxN: number }
  } | null>(null)

  // UTM Latitude Bands (C-X, ohne I und O)
  const UTM_BANDS = [
    { band: 'C', lat: '-80° to -72°', hemisphere: 'S' },
    { band: 'D', lat: '-72° to -64°', hemisphere: 'S' },
    { band: 'E', lat: '-64° to -56°', hemisphere: 'S' },
    { band: 'F', lat: '-56° to -48°', hemisphere: 'S' },
    { band: 'G', lat: '-48° to -40°', hemisphere: 'S' },
    { band: 'H', lat: '-40° to -32°', hemisphere: 'S' },
    { band: 'J', lat: '-32° to -24°', hemisphere: 'S' },
    { band: 'K', lat: '-24° to -16°', hemisphere: 'S' },
    { band: 'L', lat: '-16° to -8°', hemisphere: 'S' },
    { band: 'M', lat: '-8° to 0°', hemisphere: 'S' },
    { band: 'N', lat: '0° to 8°', hemisphere: 'N' },
    { band: 'P', lat: '8° to 16°', hemisphere: 'N' },
    { band: 'Q', lat: '16° to 24°', hemisphere: 'N' },
    { band: 'R', lat: '24° to 32°', hemisphere: 'N' },
    { band: 'S', lat: '32° to 40°', hemisphere: 'N' },
    { band: 'T', lat: '40° to 48°', hemisphere: 'N' },
    { band: 'U', lat: '48° to 56°', hemisphere: 'N' },
    { band: 'V', lat: '56° to 64°', hemisphere: 'N' },
    { band: 'W', lat: '64° to 72°', hemisphere: 'N' },
    { band: 'X', lat: '72° to 84°', hemisphere: 'N' },
  ]

  // Wenn Latitude Band sich ändert, aktualisiere auch Hemisphere
  const handleBandChange = (band: string) => {
    setLatitudeBand(band)
    const bandInfo = UTM_BANDS.find(b => b.band === band)
    if (bandInfo) {
      setHemisphere(bandInfo.hemisphere as 'N' | 'S')
    }
  }

  // .map Datei importieren und Eckpunkte ausfüllen
  const handleImportMapFile = async () => {
    if (!window.ntaAPI?.maps?.parseCorners) {
      console.error('parseCorners API nicht verfügbar')
      return
    }

    setIsImporting(true)
    try {
      const result = await window.ntaAPI.maps.parseCorners()
      if (!result) {
        console.log('Kein Ergebnis oder abgebrochen')
        return
      }

      console.log('Importierte Eckpunkte:', result)

      // UTM Zone setzen
      setUtmZone(result.utmZone)

      // Eckpunkte in Corners setzen
      // Reihenfolge: NW (0), NO (1), SO (2), SW (3)
      const newCorners: CornerPoint[] = [
        {
          lat: result.corners.nw.lat,
          lon: result.corners.nw.lon,
          utmEasting: Math.round(latLonToUTM(result.corners.nw.lat, result.corners.nw.lon, result.utmZone).easting).toString(),
          utmNorthing: Math.round(latLonToUTM(result.corners.nw.lat, result.corners.nw.lon, result.utmZone).northing).toString()
        },
        {
          lat: result.corners.no.lat,
          lon: result.corners.no.lon,
          utmEasting: Math.round(latLonToUTM(result.corners.no.lat, result.corners.no.lon, result.utmZone).easting).toString(),
          utmNorthing: Math.round(latLonToUTM(result.corners.no.lat, result.corners.no.lon, result.utmZone).northing).toString()
        },
        {
          lat: result.corners.so.lat,
          lon: result.corners.so.lon,
          utmEasting: Math.round(latLonToUTM(result.corners.so.lat, result.corners.so.lon, result.utmZone).easting).toString(),
          utmNorthing: Math.round(latLonToUTM(result.corners.so.lat, result.corners.so.lon, result.utmZone).northing).toString()
        },
        {
          lat: result.corners.sw.lat,
          lon: result.corners.sw.lon,
          utmEasting: Math.round(latLonToUTM(result.corners.sw.lat, result.corners.sw.lon, result.utmZone).easting).toString(),
          utmNorthing: Math.round(latLonToUTM(result.corners.sw.lat, result.corners.sw.lon, result.utmZone).northing).toString()
        }
      ]

      setCorners(newCorners)

      // Kartennamen vorschlagen
      if (result.name) {
        setMapName(result.name)
      }

    } catch (error) {
      console.error('Fehler beim Importieren:', error)
    } finally {
      setIsImporting(false)
    }
  }

  // Progress Listener
  useEffect(() => {
    if (!window.ntaAPI?.tiles?.onDownloadProgress) return
    const cleanup = window.ntaAPI.tiles.onDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })
    return cleanup
  }, [])

  // MBTiles Import Progress Listener
  useEffect(() => {
    const cleanup = window.ntaAPI?.tiles?.onImportMBTilesProgress?.((progress) => {
      setMbtilesProgress(progress)
    })
    return () => cleanup?.()
  }, [])

  // Meisterschaften laden wenn Download erfolgreich
  useEffect(() => {
    const loadChampionships = async () => {
      if (!user || !downloadResult?.success) return
      try {
        const { data, error } = await supabase
          .from('championships')
          .select('*')
          .eq('user_id', user.id)
          .eq('archived', false)
          .order('created_at', { ascending: false })

        if (!error && data) {
          setChampionships(data)
        }
      } catch (e) {
        console.error('Fehler beim Laden der Meisterschaften:', e)
      }
    }
    loadChampionships()
  }, [user, downloadResult?.success])

  // UTM zu Lat/Lon konvertieren
  const utmToLatLonLocal = useCallback((easting: number, northing: number): { lat: number; lon: number } => {
    const utm: UTMWGS84 = {
      zone: utmZone,
      hemisphere,
      easting,
      northing
    }
    const result = utmToLatLon(utm)
    return { lat: result.lat, lon: result.lon }
  }, [utmZone, hemisphere])

  // Lat/Lon zu UTM konvertieren
  const latLonToUtmLocal = useCallback((lat: number, lon: number): { easting: number; northing: number } => {
    const utm = latLonToUTM(lat, lon, utmZone)
    return { easting: utm.easting, northing: utm.northing }
  }, [utmZone])

  // UTM-Eingabe verarbeiten
  const handleUtmChange = (index: number, field: 'easting' | 'northing', value: string) => {
    const newCorners = [...corners]
    if (field === 'easting') {
      newCorners[index].utmEasting = value
    } else {
      newCorners[index].utmNorthing = value
    }

    // Versuche Konvertierung wenn beide Werte vorhanden
    const easting = parseFloat(newCorners[index].utmEasting)
    const northing = parseFloat(newCorners[index].utmNorthing)
    if (!isNaN(easting) && !isNaN(northing) && easting > 100000 && northing > 1000000) {
      const latLon = utmToLatLonLocal(easting, northing)
      newCorners[index].lat = latLon.lat
      newCorners[index].lon = latLon.lon
    }

    setCorners(newCorners)
  }

  // UTM Zone aus Longitude berechnen
  const calculateUtmZone = (lon: number): number => {
    const zone = Math.floor((lon + 180) / 6) + 1
    return Math.max(1, Math.min(60, zone)) // Sicherstellen dass Zone zwischen 1-60 liegt
  }

  // Punkt von Karte setzen (wird von MapView aufgerufen)
  const setCornerFromMap = useCallback((lat: number, lon: number) => {
    if (selectingCorner === null) return

    // Bei erstem Punkt: UTM Zone automatisch setzen
    if (selectingCorner === 0) {
      const autoZone = calculateUtmZone(lon)
      setUtmZone(autoZone)

      // Latitude Band automatisch setzen
      const bandInfo = UTM_BANDS.find(b => {
        const latRange = b.lat.match(/-?\d+/g)
        if (latRange && latRange.length >= 2) {
          const minLat = parseInt(latRange[0])
          const maxLat = parseInt(latRange[1])
          return lat >= minLat && lat < maxLat
        }
        return false
      })
      if (bandInfo) {
        setLatitudeBand(bandInfo.band)
        setHemisphere(bandInfo.hemisphere as 'N' | 'S')
      }
    }

    const utm = latLonToUtmLocal(lat, lon)
    const newCorners = [...corners]
    newCorners[selectingCorner] = {
      lat,
      lon,
      utmEasting: Math.round(utm.easting).toString(),
      utmNorthing: Math.round(utm.northing).toString()
    }
    setCorners(newCorners)

    // Nächsten Punkt auswählen oder fertig
    if (selectingCorner < 3) {
      setSelectingCorner(selectingCorner + 1)
    } else {
      setSelectingCorner(null)
      setMode('input')
    }
  }, [selectingCorner, corners, latLonToUtmLocal, UTM_BANDS])

  // Expose setCornerFromMap global für MapView
  useEffect(() => {
    (window as any).setCompetitionCorner = setCornerFromMap
    return () => {
      delete (window as any).setCompetitionCorner
    }
  }, [setCornerFromMap])

  // Prüfe ob alle Punkte gültig sind
  const allPointsValid = corners.every(c => c.lat !== 0 && c.lon !== 0)

  // UTM Zone automatisch setzen wenn erste gültige Koordinate vorhanden (NW-Punkt)
  useEffect(() => {
    const firstValidCorner = corners.find(c => c.lat !== 0 && c.lon !== 0)
    if (firstValidCorner) {
      const autoZone = calculateUtmZone(firstValidCorner.lon)
      // Nur setzen wenn sich die Zone ändert (verhindert Endlos-Loop)
      if (autoZone !== utmZone) {
        setUtmZone(autoZone)
      }

      // Latitude Band automatisch setzen
      const bandInfo = UTM_BANDS.find(b => {
        const latRange = b.lat.match(/-?\d+/g)
        if (latRange && latRange.length >= 2) {
          const minLat = parseInt(latRange[0])
          const maxLat = parseInt(latRange[1])
          return firstValidCorner.lat >= minLat && firstValidCorner.lat < maxLat
        }
        return false
      })
      if (bandInfo && bandInfo.band !== latitudeBand) {
        setLatitudeBand(bandInfo.band)
        setHemisphere(bandInfo.hemisphere as 'N' | 'S')
      }
    }
  }, [corners[0].lat, corners[0].lon]) // Nur bei Änderung des ersten Eckpunkts

  // Tile-Schätzung aktualisieren
  useEffect(() => {
    if (!allPointsValid || !window.ntaAPI?.tiles?.countForBounds) {
      setTileEstimate(null)
      return
    }

    const points = corners.map(c => ({ lat: c.lat, lon: c.lon }))
    window.ntaAPI.tiles.countForBounds(points, minZoom, maxZoom)
      .then(setTileEstimate)
      .catch(() => setTileEstimate(null))
  }, [corners, minZoom, maxZoom, allPointsValid])

  // Bounds aus Corners berechnen
  const calculateBounds = () => {
    const lats = corners.map(c => c.lat)
    const lons = corners.map(c => c.lon)
    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lons),
      west: Math.min(...lons)
    }
  }

  // Karte speichern nach Download - mit Meisterschafts-Verknüpfung
  const saveCompetitionMap = async () => {
    if (!mapName.trim() || !allPointsValid) return

    // Prüfe ob Meisterschaft ausgewählt oder neue erstellt werden soll
    if (!selectedChampionshipId && !newChampionshipName.trim()) {
      alert('Bitte wähle eine Meisterschaft aus oder erstelle eine neue.')
      return
    }

    setSavingToChampionship(true)

    try {
      const bounds = calculateBounds()
      const centerLon = (bounds.west + bounds.east) / 2
      const calculatedUtmZone = Math.floor((centerLon + 180) / 6) + 1
      const effectiveUtmZone = utmZone || calculatedUtmZone

      // UTM Bounds aus den 4 Eckpunkten berechnen (wie OZI Explorer)
      // corners: 0=NW, 1=NO, 2=SO, 3=SW
      const cornerEastings = corners.map(c => parseFloat(c.utmEasting)).filter(e => !isNaN(e))
      const cornerNorthings = corners.map(c => parseFloat(c.utmNorthing)).filter(n => !isNaN(n))

      const utmBoundsFromCorners = cornerEastings.length === 4 && cornerNorthings.length === 4
        ? {
            minE: Math.min(...cornerEastings),
            maxE: Math.max(...cornerEastings),
            minN: Math.min(...cornerNorthings),
            maxN: Math.max(...cornerNorthings)
          }
        : null

      console.log('[CompetitionArea] UTM Bounds aus Eckpunkten:', utmBoundsFromCorners)

      const newMap: CompetitionMap = {
        id: crypto.randomUUID(),
        name: mapName.trim(),
        bounds,
        minZoom,
        maxZoom,
        tileCount: tileEstimate?.count || 0,
        downloadedAt: new Date().toISOString(),
        provider: tileProvider,
        utmZone: effectiveUtmZone,
        // UTM Reprojection: Verwende reprojectResult wenn vorhanden, sonst die Eckpunkt-UTM-Bounds
        utmReprojection: reprojectResult ? {
          imagePath: reprojectResult.imagePath,
          utmZone: effectiveUtmZone,
          utmBounds: reprojectResult.utmBounds
        } : utmBoundsFromCorners ? {
          imagePath: '',  // Kein reprojiziertes Bild
          utmZone: effectiveUtmZone,
          utmBounds: utmBoundsFromCorners
        } : undefined
      }

      // Karte lokal speichern
      addCompetitionMap(newMap)

      // Mit Meisterschaft verknüpfen
      let championshipId = selectedChampionshipId

      // Neue Meisterschaft erstellen wenn gewünscht
      if (showNewChampionshipInput && newChampionshipName.trim() && user) {
        const { data: newChamp, error: createError } = await supabase
          .from('championships')
          .insert({
            user_id: user.id,
            name: newChampionshipName.trim(),
            map_id: newMap.id
          })
          .select()
          .single()

        if (createError) {
          console.error('Fehler beim Erstellen der Meisterschaft:', createError)
          alert('Karte wurde gespeichert, aber Meisterschaft konnte nicht erstellt werden.')
        } else {
          console.log('Neue Meisterschaft erstellt:', newChamp)
        }
      } else if (championshipId && user) {
        // Bestehende Meisterschaft aktualisieren
        const { error: updateError } = await supabase
          .from('championships')
          .update({ map_id: newMap.id })
          .eq('id', championshipId)

        if (updateError) {
          console.error('Fehler beim Verknüpfen mit Meisterschaft:', updateError)
          alert('Karte wurde gespeichert, aber Verknüpfung mit Meisterschaft fehlgeschlagen.')
        }
      }

      // Reset
      setMapName('')
      setSelectedChampionshipId('')
      setNewChampionshipName('')
      setShowNewChampionshipInput(false)

      // Zeige Dialog ob die Karte gleich angezeigt werden soll
      setSavedMapId(newMap.id)
      setShowMapSavedDialog(true)
    } catch (e) {
      console.error('Fehler beim Speichern:', e)
      alert('Fehler beim Speichern der Karte.')
    } finally {
      setSavingToChampionship(false)
    }
  }

  // Download + UTM-Karte erstellen (alles in einem Schritt)
  const startDownload = async () => {
    if (!allPointsValid) {
      console.log('Download abgebrochen: Nicht alle Punkte gültig')
      return
    }
    if (!window.ntaAPI?.tiles?.downloadForBounds) {
      console.error('Download API nicht verfügbar')
      alert('Download-Funktion nicht verfügbar. Bitte App neu starten.')
      return
    }

    console.log('Starte Download...')
    setIsDownloading(true)
    setDownloadProgress({ total: tileEstimate?.count || 0, downloaded: 0, cached: 0, failed: 0, currentTile: 'Starte Karten-Download...' })
    setDownloadResult(null)
    setReprojectResult(null)

    const points = corners.map(c => ({ lat: c.lat, lon: c.lon }))
    console.log('Download für Punkte:', points)
    console.log('Zoom-Level:', minZoom, '-', maxZoom)

    // URL Template und Provider basierend auf Auswahl
    const urlTemplate = tileProvider === 'opentopomap'
      ? 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    const provider = tileProvider

    try {
      // Schritt 1: Kacheln herunterladen
      const result = await window.ntaAPI.tiles.downloadForBounds(
        urlTemplate,
        provider,
        points,
        minZoom,
        maxZoom
      )
      console.log('Download abgeschlossen:', result)

      if (result.success) {
        // Schritt 2: UTM-Karte automatisch erstellen
        setDownloadProgress(prev => prev ? { ...prev, currentTile: 'Erstelle UTM-Karte...' } : null)
        setIsReprojecting(true)
        setReprojectProgress({ message: 'Erstelle UTM-Karte...', percent: 50 })

        // Progress Listener für Reprojection
        const cleanup = window.ntaAPI.tiles.onReprojectProgress?.((progress) => {
          setReprojectProgress(progress)
        })

        try {
          if (window.ntaAPI?.tiles?.mergeAndReproject) {
            const reproResult = await window.ntaAPI.tiles.mergeAndReproject(
              provider,
              points,
              maxZoom,
              utmZone
            )
            console.log('UTM-Karte erstellt:', reproResult)
            setReprojectResult(reproResult)
          }
        } catch (reproError) {
          console.error('UTM-Karte Fehler (ignoriert):', reproError)
          // Fehler bei UTM-Karte ist nicht kritisch
        } finally {
          cleanup?.()
          setIsReprojecting(false)
        }
      }

      setDownloadResult(result)
    } catch (error) {
      console.error('Download error:', error)
      setDownloadResult({ success: false, error: 'Download fehlgeschlagen', tilesDownloaded: 0, tilesCached: 0, tilesFailed: 0, totalSize: 0 })
    } finally {
      setIsDownloading(false)
      setReprojectProgress(null)
    }
  }

  // Download abbrechen
  const cancelDownload = async () => {
    if (window.ntaAPI?.tiles?.cancelDownload) {
      await window.ntaAPI.tiles.cancelDownload()
    }
  }

  // MBTiles Import starten
  const startMBTilesImport = async () => {
    if (!window.ntaAPI?.tiles?.importMBTiles) {
      console.error('MBTiles Import API nicht verfügbar')
      alert('MBTiles Import nicht verfügbar. Bitte App neu starten.')
      return
    }

    setIsMBTilesImporting(true)
    setMbtilesProgress(null)
    setDownloadResult(null)
    setReprojectResult(null)

    try {
      const result = await window.ntaAPI.tiles.importMBTiles(tileProvider)

      if (!result) {
        // User hat File-Dialog abgebrochen
        setIsMBTilesImporting(false)
        return
      }

      console.log('MBTiles Import abgeschlossen:', result)

      if (result.success) {
        // Bounds aus MBTiles-Metadata übernehmen (wenn Ecken noch leer)
        if (result.bounds && !allPointsValid) {
          const b = result.bounds
          const newCorners: CornerPoint[] = [
            { // NW
              lat: b.north, lon: b.west,
              utmEasting: Math.round(latLonToUTM(b.north, b.west, utmZone).easting).toString(),
              utmNorthing: Math.round(latLonToUTM(b.north, b.west, utmZone).northing).toString()
            },
            { // NO
              lat: b.north, lon: b.east,
              utmEasting: Math.round(latLonToUTM(b.north, b.east, utmZone).easting).toString(),
              utmNorthing: Math.round(latLonToUTM(b.north, b.east, utmZone).northing).toString()
            },
            { // SO
              lat: b.south, lon: b.east,
              utmEasting: Math.round(latLonToUTM(b.south, b.east, utmZone).easting).toString(),
              utmNorthing: Math.round(latLonToUTM(b.south, b.east, utmZone).northing).toString()
            },
            { // SW
              lat: b.south, lon: b.west,
              utmEasting: Math.round(latLonToUTM(b.south, b.west, utmZone).easting).toString(),
              utmNorthing: Math.round(latLonToUTM(b.south, b.west, utmZone).northing).toString()
            }
          ]
          setCorners(newCorners)
        }

        // Zoom-Range aus MBTiles-Metadata übernehmen
        if (result.minZoom < 99) setMinZoom(result.minZoom)
        if (result.maxZoom > 0) setMaxZoom(result.maxZoom)

        // Kartenname aus MBTiles-Metadata übernehmen
        if (result.name && !mapName) {
          setMapName(result.name)
        }

        // downloadResult setzen → bestehende Speichern-UI erscheint automatisch
        setDownloadResult({
          success: true,
          tilesDownloaded: result.tilesImported,
          tilesCached: result.tilesSkipped,
          tilesFailed: result.tilesFailed,
          totalSize: result.totalSize
        })

        // UTM-Reprojizierung anstoßen (wenn Bounds vorhanden)
        const boundsToUse = result.bounds || (allPointsValid ? {
          north: Math.max(...corners.map(c => c.lat)),
          south: Math.min(...corners.map(c => c.lat)),
          east: Math.max(...corners.map(c => c.lon)),
          west: Math.min(...corners.map(c => c.lon))
        } : null)

        if (boundsToUse && window.ntaAPI?.tiles?.mergeAndReproject) {
          setIsReprojecting(true)
          setReprojectProgress({ message: 'Erstelle UTM-Karte...', percent: 50 })

          const cleanup = window.ntaAPI.tiles.onReprojectProgress?.((progress) => {
            setReprojectProgress(progress)
          })

          try {
            const points = [
              { lat: boundsToUse.north, lon: boundsToUse.west },
              { lat: boundsToUse.north, lon: boundsToUse.east },
              { lat: boundsToUse.south, lon: boundsToUse.east },
              { lat: boundsToUse.south, lon: boundsToUse.west }
            ]
            const reproResult = await window.ntaAPI.tiles.mergeAndReproject(
              tileProvider, points, result.maxZoom, utmZone
            )
            console.log('UTM-Karte erstellt:', reproResult)
            setReprojectResult(reproResult)
          } catch (reproError) {
            console.error('UTM-Karte Fehler (ignoriert):', reproError)
          } finally {
            cleanup?.()
            setIsReprojecting(false)
          }
        }
      }
    } catch (error) {
      console.error('MBTiles Import Fehler:', error)
      setDownloadResult({ success: false, error: 'Import fehlgeschlagen', tilesDownloaded: 0, tilesCached: 0, tilesFailed: 0, totalSize: 0 })
    } finally {
      setIsMBTilesImporting(false)
      setReprojectProgress(null)
    }
  }

  // MBTiles Import abbrechen
  const cancelMBTilesImport = async () => {
    if (window.ntaAPI?.tiles?.cancelMBTilesImport) {
      await window.ntaAPI.tiles.cancelMBTilesImport()
    }
  }

  // UTM Reprojizierung starten
  const startReprojection = async () => {
    if (!allPointsValid || !window.ntaAPI?.tiles?.mergeAndReproject) {
      console.error('Reprojection nicht möglich')
      return
    }

    setIsReprojecting(true)
    setReprojectProgress({ message: 'Starte...', percent: 0 })
    setReprojectResult(null)

    // Progress Listener
    const cleanup = window.ntaAPI.tiles.onReprojectProgress?.((progress) => {
      setReprojectProgress(progress)
    })

    try {
      const points = corners.map(c => ({ lat: c.lat, lon: c.lon }))
      const result = await window.ntaAPI.tiles.mergeAndReproject(
        tileProvider,
        points,
        maxZoom, // Höchste Zoom-Stufe für beste Qualität
        utmZone
      )
      console.log('Reprojection result:', result)
      setReprojectResult(result)
    } catch (error) {
      console.error('Reprojection error:', error)
    } finally {
      setIsReprojecting(false)
      cleanup?.()
    }
  }

  // Formatiere Bytes
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // Styles
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: 10,
    right: 16,
    bottom: 10,
    width: 380,
    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 16,
    zIndex: 2000,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    overflowY: 'auto'
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'monospace'
  }

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    // Schwarze Schrift im Dropdown-Menü (Options)
    colorScheme: 'light'
  } as React.CSSProperties

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s'
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#fff', fontSize: 15, fontWeight: 600 }}>
          Wettkampfbereich
        </h3>
        <button
          onClick={onClose}
          style={{
            ...buttonStyle,
            padding: '4px 8px',
            background: 'transparent',
            color: 'rgba(255,255,255,0.5)'
          }}
        >
          ✕
        </button>
      </div>

      {/* Karten Download Bereich */}
          {/* UTM Zone Auswahl */}
          <div style={{
            padding: '10px 12px',
            background: 'rgba(59,130,246,0.1)',
            borderRadius: 4,
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Zone (1-60)
                </label>
                <select
                  value={utmZone}
                  onChange={(e) => setUtmZone(parseInt(e.target.value))}
                  style={{
                    ...inputStyle,
                    padding: '6px 8px',
                    fontSize: 12
                  }}
                >
                  {Array.from({ length: 60 }, (_, i) => i + 1).map(zone => (
                    <option key={zone} value={zone} style={{ color: '#000', background: '#fff' }}>{zone}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1.5 }}>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Band (Breitengrad)
                </label>
                <select
                  value={latitudeBand}
                  onChange={(e) => handleBandChange(e.target.value)}
                  style={{
                    ...inputStyle,
                    padding: '6px 8px',
                    fontSize: 12
                  }}
                >
                  {UTM_BANDS.map(({ band, lat, hemisphere: h }) => (
                    <option key={band} value={band} style={{ color: '#000', background: '#fff' }}>
                      {band} ({lat}) {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 4,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                UTM: <strong style={{ color: '#3b82f6' }}>{utmZone}{latitudeBand}</strong>
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                {hemisphere === 'N' ? 'Nordhalbkugel' : 'Südhalbkugel'}
              </span>
            </div>
          </div>

          {/* Import aus .map Datei */}
          <button
            onClick={handleImportMapFile}
            disabled={isImporting}
            style={{
              ...buttonStyle,
              width: '100%',
              marginBottom: 16,
              padding: '12px 16px',
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: isImporting ? 0.7 : 1,
              cursor: isImporting ? 'wait' : 'pointer'
            }}
          >
            {isImporting ? (
              <>⏳ Importiere...</>
            ) : (
              <>📁 Aus OZI .map Datei importieren</>
            )}
          </button>

          {/* Modus-Auswahl */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode('input')}
          style={{
            ...buttonStyle,
            flex: 1,
            background: mode === 'input' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: mode === 'input' ? '#fff' : 'rgba(255,255,255,0.6)'
          }}
        >
          UTM Eingabe
        </button>
        <button
          onClick={() => {
            setMode('select')
            setSelectingCorner(0)
          }}
          style={{
            ...buttonStyle,
            flex: 1,
            background: mode === 'select' ? '#22c55e' : 'rgba(255,255,255,0.1)',
            color: mode === 'select' ? '#fff' : 'rgba(255,255,255,0.6)'
          }}
        >
          Auf Karte wählen
        </button>
      </div>

      {/* Kartenauswahl-Hinweis */}
      {mode === 'select' && selectingCorner !== null && (
        <div style={{
          padding: '12px',
          background: `${CORNER_COLORS[selectingCorner]}20`,
          border: `1px solid ${CORNER_COLORS[selectingCorner]}40`,
          borderRadius: 4,
          marginBottom: 16,
          textAlign: 'center'
        }}>
          <div style={{ color: CORNER_COLORS[selectingCorner], fontWeight: 600, marginBottom: 4 }}>
            Punkt {selectingCorner + 1}: {CORNER_NAMES[selectingCorner]}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
            Klicke auf die Karte um den Punkt zu setzen
          </div>
        </div>
      )}

      {/* Eckpunkte */}
      <div style={{ marginBottom: 16 }}>
        {corners.map((corner, index) => (
          <div
            key={index}
            style={{
              marginBottom: 12,
              padding: 12,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 6,
              borderLeft: `3px solid ${CORNER_COLORS[index]}`
            }}
          >
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: CORNER_COLORS[index],
              marginBottom: 8
            }}>
              {CORNER_NAMES[index]}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Easting (E)
                </label>
                <input
                  type="text"
                  placeholder="z.B. 511025"
                  value={corner.utmEasting}
                  onChange={(e) => handleUtmChange(index, 'easting', e.target.value)}
                  style={inputStyle}
                  disabled={mode === 'select'}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Northing (N)
                </label>
                <input
                  type="text"
                  placeholder="z.B. 5330100"
                  value={corner.utmNorthing}
                  onChange={(e) => handleUtmChange(index, 'northing', e.target.value)}
                  style={inputStyle}
                  disabled={mode === 'select'}
                />
              </div>
            </div>

            {/* Lat/Lon Anzeige */}
            {corner.lat !== 0 && corner.lon !== 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                {corner.lat.toFixed(6)}°, {corner.lon.toFixed(6)}°
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Kartentyp Auswahl */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 8 }}>
          Kartentyp
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { id: 'openstreetmap' as const, label: 'OSM', desc: 'Straßenkarte' },
            { id: 'opentopomap' as const, label: 'OTM', desc: 'Topographisch' }
          ]).map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => {
                setTileProvider(id)
                // OTM maximal Zoom 17
                if (id === 'opentopomap' && maxZoom > 17) {
                  setMaxZoom(16)
                }
              }}
              style={{
                flex: 1,
                padding: '8px',
                background: tileProvider === id ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                border: tileProvider === id ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: tileProvider === id ? '#fff' : 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {label}
              <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: 0.7 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Kartenqualität Auswahl */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 8 }}>
          Kartenqualität
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { label: 'Niedrig', min: 8, max: 14, size: '~20 MB', zoom: 'Zoom 8-14' },
            { label: 'Mittel', min: 8, max: tileProvider === 'opentopomap' ? 16 : 16, size: '~100 MB', zoom: tileProvider === 'opentopomap' ? 'Zoom 8-16' : 'Zoom 8-16' }
          ]).map(({ label, min, max, size, zoom }) => (
            <button
              key={label}
              onClick={() => { setMinZoom(min); setMaxZoom(max); }}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: maxZoom === max ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                border: maxZoom === max ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: maxZoom === max ? '#fff' : 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {label}
              <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: 0.7 }}>{zoom}</div>
              <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.5 }}>{size}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tile-Schätzung */}
      {tileEstimate && (
        <div style={{
          padding: 12,
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 4,
          marginBottom: 16
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Anzahl Kacheln:</span>
            <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{tileEstimate.count.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Geschätzte Größe:</span>
            <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{formatBytes(tileEstimate.estimatedSize)}</span>
          </div>
        </div>
      )}

      {/* Download-Progress (inkl. Reproject) */}
      {(isDownloading || isReprojecting) && (downloadProgress || reprojectProgress) && (
        <div style={{
          padding: 12,
          background: isReprojecting ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
          border: `1px solid ${isReprojecting ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.2)'}`,
          borderRadius: 4,
          marginBottom: 16
        }}>
          {/* Phase Anzeige */}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8, fontWeight: 600 }}>
            {isReprojecting ? '📦 Erstelle UTM-Karte...' : '📥 Lade Kacheln herunter...'}
          </div>

          {/* Fortschritt */}
          {!isReprojecting && downloadProgress && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Fortschritt:</span>
              <span style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>
                {downloadProgress.downloaded + downloadProgress.cached} / {downloadProgress.total}
              </span>
            </div>
          )}

          {/* Progress Bar */}
          <div style={{
            height: 6,
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 3,
            overflow: 'hidden',
            marginBottom: 8
          }}>
            <div style={{
              height: '100%',
              width: isReprojecting && reprojectProgress
                ? `${reprojectProgress.percent}%`
                : downloadProgress
                  ? `${((downloadProgress.downloaded + downloadProgress.cached) / downloadProgress.total) * 100}%`
                  : '0%',
              background: isReprojecting
                ? 'linear-gradient(90deg, #22c55e, #3b82f6)'
                : 'linear-gradient(90deg, #3b82f6, #22c55e)',
              transition: 'width 0.2s'
            }} />
          </div>

          {/* Status Text */}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
            {isReprojecting && reprojectProgress
              ? reprojectProgress.message
              : downloadProgress?.currentTile || ''}
          </div>

          {/* Download Statistiken */}
          {!isReprojecting && downloadProgress && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10 }}>
              <span style={{ color: '#22c55e' }}>✓ Neu: {downloadProgress.downloaded}</span>
              <span style={{ color: '#3b82f6' }}>◐ Cache: {downloadProgress.cached}</span>
              <span style={{ color: '#ef4444' }}>✕ Fehler: {downloadProgress.failed}</span>
            </div>
          )}
        </div>
      )}

      {/* Download-Ergebnis */}
      {downloadResult && !isDownloading && (
        <div style={{
          padding: 12,
          background: downloadResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${downloadResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          borderRadius: 4,
          marginBottom: 16
        }}>
          <div style={{
            fontWeight: 600,
            color: downloadResult.success ? '#22c55e' : '#ef4444',
            marginBottom: 8
          }}>
            {downloadResult.success ? '✓ Download abgeschlossen!' : '✕ Download fehlgeschlagen'}
          </div>
          {downloadResult.success && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
              {downloadResult.tilesDownloaded} neu heruntergeladen, {downloadResult.tilesCached} bereits im Cache
              {downloadResult.tilesFailed > 0 && `, ${downloadResult.tilesFailed} fehlgeschlagen`}
            </div>
          )}
        </div>
      )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {isDownloading ? (
              <button
                onClick={cancelDownload}
                style={{
                  ...buttonStyle,
                  flex: 1,
                  background: '#ef4444',
                  color: '#fff'
                }}
              >
                Abbrechen
              </button>
            ) : (
              <>
                <button
                  onClick={startDownload}
                  disabled={!allPointsValid}
                  style={{
                    ...buttonStyle,
                    flex: 1,
                    background: allPointsValid ? '#22c55e' : 'rgba(255,255,255,0.1)',
                    color: allPointsValid ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: allPointsValid ? 'pointer' : 'not-allowed'
                  }}
                >
                  Karten herunterladen
                </button>
                {/* MBTiles Import Button - ausgeblendet bis MBTiles-Quellen verfügbar
                <button
                  onClick={startMBTilesImport}
                  disabled={isDownloading}
                  style={{
                    ...buttonStyle,
                    flex: 1,
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  MBTiles importieren
                </button>
                */}
              </>
            )}
          </div>

          {/* MBTiles Import Progress */}
          {isMBTilesImporting && mbtilesProgress && (
            <div style={{
              padding: 12,
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 4,
              marginTop: 12
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8, fontWeight: 600 }}>
                {mbtilesProgress.phase === 'reading' ? 'Lese MBTiles Datei...' :
                 mbtilesProgress.phase === 'done' ? 'Import abgeschlossen' :
                 'Importiere Kacheln...'}
              </div>

              {mbtilesProgress.total > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Fortschritt:</span>
                    <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                      {mbtilesProgress.imported + mbtilesProgress.skipped} / {mbtilesProgress.total}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div style={{
                    height: 6,
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 3,
                    overflow: 'hidden',
                    marginBottom: 8
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${((mbtilesProgress.imported + mbtilesProgress.skipped) / mbtilesProgress.total) * 100}%`,
                      background: 'linear-gradient(90deg, #f59e0b, #22c55e)',
                      transition: 'width 0.2s'
                    }} />
                  </div>
                </>
              )}

              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                {mbtilesProgress.currentTile}
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10 }}>
                <span style={{ color: '#22c55e' }}>Neu: {mbtilesProgress.imported}</span>
                <span style={{ color: '#3b82f6' }}>Cache: {mbtilesProgress.skipped}</span>
                {mbtilesProgress.failed > 0 && (
                  <span style={{ color: '#ef4444' }}>Fehler: {mbtilesProgress.failed}</span>
                )}
              </div>
            </div>
          )}

          {/* Speichern nach Download - mit Meisterschafts-Auswahl */}
          {downloadResult?.success && !isReprojecting && (
            <div style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(168,85,247,0.1)',
              border: '1px solid rgba(168,85,247,0.2)',
              borderRadius: 4
            }}>
              {/* UTM Status anzeigen */}
              {reprojectResult && (
                <div style={{
                  padding: 8,
                  background: 'rgba(34,197,94,0.2)',
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.7)'
                }}>
                  <div style={{ color: '#22c55e', fontWeight: 600 }}>
                    ✓ UTM-Karte erstellt (Zone {utmZone})
                  </div>
                </div>
              )}

              {/* Kartenname */}
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 4 }}>
                Kartenname:
              </label>
              <input
                type="text"
                placeholder="z.B. Wettkampfkarte Slowenien"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                style={{ ...inputStyle, marginBottom: 12 }}
              />

              {/* Meisterschaft auswählen */}
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 4 }}>
                Zu Meisterschaft hinzufügen:
              </label>

              {!showNewChampionshipInput ? (
                <>
                  <select
                    value={selectedChampionshipId}
                    onChange={(e) => setSelectedChampionshipId(e.target.value)}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  >
                    <option value="" style={{ color: '#000' }}>-- Meisterschaft wählen --</option>
                    {championships.map(c => (
                      <option key={c.id} value={c.id} style={{ color: '#000' }}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowNewChampionshipInput(true)}
                    style={{
                      ...buttonStyle,
                      width: '100%',
                      marginBottom: 12,
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: 11
                    }}
                  >
                    + Neue Meisterschaft erstellen
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Name der neuen Meisterschaft"
                    value={newChampionshipName}
                    onChange={(e) => setNewChampionshipName(e.target.value)}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  />
                  <button
                    onClick={() => {
                      setShowNewChampionshipInput(false)
                      setNewChampionshipName('')
                    }}
                    style={{
                      ...buttonStyle,
                      width: '100%',
                      marginBottom: 12,
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: 11
                    }}
                  >
                    ← Bestehende Meisterschaft wählen
                  </button>
                </>
              )}

              {/* Speichern Button */}
              <button
                onClick={saveCompetitionMap}
                disabled={!mapName.trim() || (!selectedChampionshipId && !newChampionshipName.trim()) || savingToChampionship}
                style={{
                  ...buttonStyle,
                  width: '100%',
                  background: (mapName.trim() && (selectedChampionshipId || newChampionshipName.trim()) && !savingToChampionship)
                    ? '#a855f7'
                    : 'rgba(255,255,255,0.1)',
                  color: (mapName.trim() && (selectedChampionshipId || newChampionshipName.trim()) && !savingToChampionship)
                    ? '#fff'
                    : 'rgba(255,255,255,0.3)',
                  cursor: (mapName.trim() && (selectedChampionshipId || newChampionshipName.trim()) && !savingToChampionship)
                    ? 'pointer'
                    : 'not-allowed'
                }}
              >
                {savingToChampionship ? '⏳ Speichern...' : 'Speichern'}
              </button>
            </div>
          )}

          {/* Hinweis */}
          <div style={{
            marginTop: 16,
            padding: 10,
            background: 'rgba(245,158,11,0.1)',
            borderRadius: 4,
            fontSize: 10,
            color: 'rgba(255,255,255,0.5)'
          }}>
            Die Karten werden lokal gespeichert und sind auch offline verfügbar.
            Nach dem Download kannst du die Karte benennen und einer Meisterschaft zuordnen.
          </div>

      {/* Dialog: Karte jetzt anzeigen */}
      {showMapSavedDialog && savedMapId && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              padding: '24px',
              width: '380px',
              maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              textAlign: 'center'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Icon */}
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(34, 197, 94, 0.15)',
              border: '2px solid rgba(34, 197, 94, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>

            {/* Title */}
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
              Karte gespeichert!
            </div>

            {/* Info */}
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '20px', lineHeight: 1.5 }}>
              Die Karte wurde erfolgreich gespeichert.<br />
              Möchtest du sie jetzt anzeigen?
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  setShowMapSavedDialog(false)
                  setSavedMapId(null)
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Später
              </button>
              <button
                onClick={() => {
                  toggleActiveMap(savedMapId, true)
                  setShowMapSavedDialog(false)
                  setSavedMapId(null)
                  onClose()
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#22c55e',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Jetzt anzeigen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
