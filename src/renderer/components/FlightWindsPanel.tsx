import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { useTeamStore } from '../stores/teamStore'
import { usePanelDrag } from '../hooks/usePanelDrag'
import { WindSource, WindLayer } from '../../shared/types'
import {
  parseWindFile, normalizeToInternal, inferWindSource, formatName,
  defaultImportSettings, WindImportSettings, WindImportResult
} from '../utils/windImport'
import { fetchIconD2Wind, IconD2Result, WEATHER_MODELS } from '../utils/iconD2'
import { parseTrajectoryFile, TRAJECTORY_COLORS } from '../utils/trajectoryImport'

interface FlightWindsPanelProps {
  isOpen: boolean
  onClose: () => void
  selectedWindLayer: number | null
  onSelectWindLayer: (altitude: number | null) => void
}

// Windsuche Ergebnis
interface WindSearchResult {
  callsign: string
  color: string
  memberId: string
  layer: WindLayer
  directionDiff: number
  turnDirection: 'L' | 'R' | ''
  score: number
}

// Windstärke-Farbcodierung
const getWindColor = (speedKmh: number): string => {
  if (speedKmh < 10) return '#22c55e'
  if (speedKmh < 20) return '#84cc16'
  if (speedKmh < 30) return '#eab308'
  if (speedKmh < 40) return '#f97316'
  if (speedKmh < 50) return '#ef4444'
  return '#dc2626'
}

// Höhenbasierte Farbcodierung (niedrig=grün, mittel=gelb/orange, hoch=blau/lila)
const getAltitudeColor = (altitudeM: number, minAlt: number, maxAlt: number): string => {
  const range = maxAlt - minAlt
  const normalized = range > 0 ? (altitudeM - minAlt) / range : 0.5

  if (normalized < 0.2) {
    const t = normalized / 0.2
    return `rgb(${Math.round(34 + t * 98)}, ${Math.round(197 - t * 27)}, ${Math.round(94 - t * 70)})`
  } else if (normalized < 0.4) {
    const t = (normalized - 0.2) / 0.2
    return `rgb(${Math.round(132 + t * 102)}, ${Math.round(170 - t * 11)}, ${Math.round(24 - t * 16)})`
  } else if (normalized < 0.6) {
    const t = (normalized - 0.4) / 0.2
    return `rgb(${Math.round(234 + t * 15)}, ${Math.round(159 - t * 56)}, ${Math.round(8 + t * 14)})`
  } else if (normalized < 0.8) {
    const t = (normalized - 0.6) / 0.2
    return `rgb(${Math.round(249 - t * 31)}, ${Math.round(103 - t * 34)}, ${Math.round(22 + t * 178)})`
  } else {
    const t = (normalized - 0.8) / 0.2
    return `rgb(${Math.round(218 - t * 159)}, ${Math.round(69 + t * 61)}, ${Math.round(200 + t * 46)})`
  }
}

// Windrichtung zu Abkürzung
const getWindDirectionName = (deg: number): string => {
  const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(((deg % 360) / 22.5)) % 16
  return directions[index]
}

// Meter zu Fuß
const mToFt = (m: number) => Math.round(m * 3.28084)

export function FlightWindsPanel({ isOpen, onClose, selectedWindLayer, onSelectWindLayer }: FlightWindsPanelProps) {
  const {
    windLayers, removeWindLayer, clearWindLayers, addWindLayers, replaceWindLayers, addWindLayer,
    gpsData, baroData, settings, updateSettings,
    windLineMode, pendingWindLayer, windLines, setWindLineMode, removeWindLine, clearAllWindLines,
    windImportPickPosition, windImportPosition, setWindImportPickPosition, setWindImportPosition,
    importedTrajectories, addTrajectories, removeTrajectory, toggleTrajectoryVisibility, clearAllTrajectories,
    windSourceFilter, setWindSourceFilter,
    showWindRose, setShowWindRose
  } = useFlightStore()

  // Team state
  const teamSession = useTeamStore(s => s.session)
  const teamWindProfiles = useTeamStore(s => s.teamWindProfiles)
  const teamMembers = useTeamStore(s => s.members)
  const shareWindProfile = useTeamStore(s => s.shareWindProfile)

  // Tab state
  const [activeTab, setActiveTab] = useState<'live' | 'import' | 'team'>('live')

  // Team profiles expanded state
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set())

  // Wind search state
  const [showWindSearch, setShowWindSearch] = useState(false)
  const [searchDirection, setSearchDirection] = useState('')

  // Settings collapsed state (default: collapsed)

  // Manual add form
  const [showAddForm, setShowAddForm] = useState(false)
  const [newWind, setNewWind] = useState({ altitude: '', direction: '', speed: '' })

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [trajImportMsg, setTrajImportMsg] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<WindImportResult | null>(null)
  const [importFilename, setImportFilename] = useState('')
  const [importSettings, setImportSettings] = useState<WindImportSettings>({ ...defaultImportSettings })
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [previewLayers, setPreviewLayers] = useState<WindLayer[]>([])

  // ICON-D2 state
  const [iconD2Loading, setIconD2Loading] = useState(false)
  const [iconD2Result, setIconD2Result] = useState<IconD2Result | null>(null)
  const [iconD2TimeOffset, setIconD2TimeOffset] = useState(0) // Stunden ab jetzt
  const [iconD2Model, setIconD2Model] = useState('icon_d2')
  const [iconD2Selected, setIconD2Selected] = useState<Set<number>>(new Set()) // Ausgewählte Layer-Indizes

  // Update preview when settings change
  useEffect(() => {
    if (importResult && importResult.success) {
      const source = inferWindSource(importResult.format, importFilename)
      const layers = normalizeToInternal(importResult.rows, importSettings, source)
      setPreviewLayers(layers)
    } else {
      setPreviewLayers([])
    }
  }, [importResult, importSettings, importFilename])

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.toLowerCase().split('.').pop()

    // GPX/KML → Trajektorie importieren
    if (ext === 'gpx' || ext === 'kml') {
      file.text().then(content => {
        const trajResult = parseTrajectoryFile(content, file.name)
        if (trajResult.trajectories.length > 0) {
          const startIndex = useFlightStore.getState().importedTrajectories.length
          const colored = trajResult.trajectories.map((t, i) => ({
            ...t,
            color: TRAJECTORY_COLORS[(startIndex + i) % TRAJECTORY_COLORS.length]
          }))
          addTrajectories(colored)
          setTrajImportMsg(`${colored.length} Trajektorie${colored.length > 1 ? 'n' : ''} importiert`)
          setTimeout(() => setTrajImportMsg(null), 3000)
        }
      })
      e.target.value = ''
      return
    }

    // JSON → gespeichertes Windprofil importieren
    if (ext === 'json') {
      file.text().then(content => {
        try {
          const data = JSON.parse(content)
          if (!Array.isArray(data) || data.length === 0) {
            alert('JSON-Datei enthält keine Wind-Daten')
            return
          }
          // JSON bereits in internen Einheiten (m MSL, km/h, VON/True)
          // → direkt als WindLayer übernehmen, kein normalizeToInternal nötig
          const layers: WindLayer[] = data.map((item: any) => ({
            altitude: item.altitude_m ?? item.altitude ?? 0,
            direction: item.direction_deg ?? item.direction ?? 0,
            speed: item.speed_kmh ?? item.speed ?? 0,
            source: item.source ?? WindSource.Manual,
            timestamp: item.timestamp ? new Date(item.timestamp) : new Date()
          }))
          replaceWindLayers(layers)
          setActiveTab('live')
        } catch {
          alert('JSON-Datei konnte nicht gelesen werden')
        }
      })
      e.target.value = ''
      return
    }

    // Wind-Datei importieren
    setImportFilename(file.name)
    file.text().then(content => {
      const result = parseWindFile(content)
      setImportResult(result)

      if (result.detectedSettings) {
        setImportSettings(prev => ({ ...prev, ...result.detectedSettings }))
      }
    })

    e.target.value = ''
  }

  // Handle import
  const handleImport = () => {
    if (previewLayers.length === 0) return

    if (importMode === 'replace') {
      replaceWindLayers(previewLayers)
    } else {
      addWindLayers(previewLayers)
    }

    setActiveTab('live')
    setImportResult(null)
    setImportFilename('')
    setImportSettings({ ...defaultImportSettings })
  }

  // Clear import
  const handleClearImport = () => {
    setImportResult(null)
    setImportFilename('')
    setImportSettings({ ...defaultImportSettings })
    setPreviewLayers([])
    setIconD2Result(null)
  }

  // ICON-D2 laden
  const handleIconD2Fetch = async () => {
    const lat = gpsData?.latitude || windImportPosition?.lat
    const lon = gpsData?.longitude || windImportPosition?.lon
    if (!lat || !lon) return

    setIconD2Loading(true)
    setIconD2Result(null)
    setImportResult(null)

    const targetDate = iconD2TimeOffset > 0
      ? new Date(Date.now() + iconD2TimeOffset * 3600000)
      : undefined

    const result = await fetchIconD2Wind(lat, lon, targetDate, iconD2Model)
    setIconD2Result(result)
    // Alle Layer standardmäßig ausgewählt
    setIconD2Selected(new Set(result.layers.map((_, i) => i)))
    setIconD2Loading(false)
  }

  // ICON-D2 Ergebnisse importieren (nur ausgewählte)
  const handleIconD2Import = () => {
    if (!iconD2Result || iconD2Result.layers.length === 0) return

    const selectedLayers = iconD2Result.layers.filter((_, i) => iconD2Selected.has(i))
    if (selectedLayers.length === 0) return

    if (importMode === 'replace') {
      replaceWindLayers(selectedLayers)
    } else {
      addWindLayers(selectedLayers)
    }

    setActiveTab('live')
    setIconD2Result(null)
  }

  // Handle manual add
  const handleAddWind = () => {
    const altitudeUnit = settings.windAltitudeUnit ?? 'm'
    const alt = parseFloat(newWind.altitude)
    const dir = parseFloat(newWind.direction)
    const spd = parseFloat(newWind.speed)

    if (isNaN(alt) || isNaN(dir) || isNaN(spd)) return

    const layer: WindLayer = {
      altitude: altitudeUnit === 'ft' ? alt / 3.28084 : alt,
      direction: dir,
      speed: spd, // Already in km/h
      timestamp: new Date(),
      source: WindSource.Manual
    }
    addWindLayer(layer)
    setNewWind({ altitude: '', direction: '', speed: '' })
    setShowAddForm(false)
  }

  // Dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 336, y: 80 })
  const panelRef = useRef<HTMLDivElement>(null)

  // Position-Change Handler für Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    setPosition({
      x: Math.max(-300, Math.min(window.innerWidth - 40, pos.x)),  // 40px müssen sichtbar bleiben
      y: Math.max(0, Math.min(window.innerHeight - 100, pos.y))
    })
  }, [])

  // Panel Drag Hook (Mouse + Touch)
  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // Aktuelle Höhe
  const currentAltitude = baroData?.pressureAltitude || gpsData?.altitude || 0

  // Sortiere Layers nach Höhe (absteigend)
  const sortedLayers = useMemo(() => {
    return [...windLayers].sort((a, b) => b.altitude - a.altitude)
  }, [windLayers])

  // Min/Max Höhe für Farbskala
  const { minAltitude, maxAltitude } = useMemo(() => {
    if (windLayers.length === 0) return { minAltitude: 0, maxAltitude: 1000 }
    const altitudes = windLayers.map(l => l.altitude)
    return {
      minAltitude: Math.min(...altitudes),
      maxAltitude: Math.max(...altitudes)
    }
  }, [windLayers])

  // Wind Suche - alle Team-Winde durchsuchen und nach Richtung sortieren
  const windSearchResults = useMemo((): WindSearchResult[] => {
    if (!searchDirection.trim()) return []
    const targetDir = parseFloat(searchDirection)
    if (isNaN(targetDir) || targetDir < 0 || targetDir > 360) return []

    const results: WindSearchResult[] = []

    const getCompareDirection = (layerDirection: number) => {
      if (settings.windDirectionMode === 'from') {
        return layerDirection
      } else {
        return (layerDirection + 180) % 360
      }
    }

    const getTurnDirection = (windDir: number): 'L' | 'R' | '' => {
      let delta = windDir - targetDir
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      if (Math.abs(delta) < 1) return ''
      return delta > 0 ? 'R' : 'L'
    }

    // Eigene Winde
    windLayers.forEach(layer => {
      const compareDir = getCompareDirection(layer.direction)
      let diff = Math.abs(compareDir - targetDir)
      if (diff > 180) diff = 360 - diff
      const stabilityBonus = layer.isStable ? 0 : (layer.vario !== undefined ? Math.abs(layer.vario) * 10 : 20)
      const score = diff + stabilityBonus

      results.push({
        callsign: 'Meine Winde',
        color: '#3b82f6',
        memberId: 'me',
        layer,
        directionDiff: diff,
        turnDirection: getTurnDirection(compareDir),
        score
      })
    })

    // Team Winde
    teamWindProfiles.forEach(profile => {
      profile.windLayers.forEach(layer => {
        const compareDir = getCompareDirection(layer.direction)
        let diff = Math.abs(compareDir - targetDir)
        if (diff > 180) diff = 360 - diff
        const stabilityBonus = layer.isStable ? 0 : (layer.vario !== undefined ? Math.abs(layer.vario) * 10 : 20)
        const score = diff + stabilityBonus

        results.push({
          callsign: profile.callsign,
          color: profile.color,
          memberId: profile.memberId,
          layer,
          directionDiff: diff,
          turnDirection: getTurnDirection(compareDir),
          score
        })
      })
    })

    // Top 3 zurückgeben
    return results.sort((a, b) => a.score - b.score).slice(0, 3)
  }, [searchDirection, windLayers, teamWindProfiles, settings.windDirectionMode])

  // Windrichtung als Pfeil
  // direction = woher der Wind kommt (0° = aus Norden)
  // SVG Pfeil zeigt bei 0° nach oben (Norden)
  // "VON" Modus: Pfeil zeigt in Richtung woher der Wind kommt → bei 0° (Nordwind) zeigt nach Norden (oben)
  // "ZU" Modus: Pfeil zeigt wohin der Wind geht → bei 0° (Nordwind) zeigt nach Süden (unten)
  const getWindArrow = (direction: number, speed: number) => {
    // Bei "from": Pfeil zeigt nach oben wenn Wind von Norden (direction bleibt)
    // Bei "to": Pfeil zeigt nach unten wenn Wind von Norden (direction + 180)
    const rotationDeg = settings.windDirectionMode === 'from' ? direction : direction + 180
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        <path
          d="M12 2L8 12h8L12 2z"
          fill={getWindColor(speed)}
        />
        <rect x="11" y="12" width="2" height="8" fill={getWindColor(speed)} opacity="0.6"/>
      </svg>
    )
  }

  // Wind Richtung als Text formatieren
  // direction = immer woher der Wind kommt (gespeichert)
  // "VON" Modus: Zeigt direction direkt an
  // "ZU" Modus: Zeigt direction + 180 an (wohin der Wind geht)
  const formatWindDirection = (direction: number) => {
    if (settings.windDirectionMode === 'from') {
      return `${Math.round(direction)}°`
    } else {
      const toDirection = (direction + 180) % 360
      return `${Math.round(toDirection)}°`
    }
  }

  // Höhe formatieren (m oder ft) - nur Zahl
  const altitudeUnit = settings.windAltitudeUnit ?? 'm'
  const formatAltitudeNumber = (altitudeM: number) => {
    if (altitudeUnit === 'ft') {
      return Math.round(altitudeM * 3.28084)
    }
    return Math.round(altitudeM)
  }
  const formatAltitude = (altitudeM: number) => {
    if (altitudeUnit === 'ft') {
      const ft = Math.round(altitudeM * 3.28084)
      return `${ft}ft`
    }
    return `${Math.round(altitudeM)}m`
  }

  if (!isOpen) return null

  const scale = settings.windPanelScale ?? 1

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '340px',
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.1)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '680px',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
          </svg>
          <span style={{ fontWeight: 700, color: 'white', fontSize: '14px' }}>Windprofil</span>

          {/* Wind-Quellen-Filter */}
          <div className="no-drag" style={{
            display: 'flex',
            gap: '2px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '6px',
            padding: '2px',
            marginLeft: '4px'
          }}>
            {([
              { key: 'all' as const, label: 'Alle', color: '#3b82f6' },
              { key: 'forecast' as const, label: 'FC', color: '#0ea5e9' },
              { key: 'measured' as const, label: 'Live', color: '#22c55e' },
              { key: 'sounding' as const, label: '.dat', color: '#a855f7' }
            ]).map(opt => (
              <button
                key={opt.key}
                className="no-drag"
                onClick={() => setWindSourceFilter(opt.key)}
                title={
                  opt.key === 'all' ? 'Alle Windquellen verwenden' :
                  opt.key === 'forecast' ? 'Nur Forecast-Winde' :
                  opt.key === 'measured' ? 'Nur Live-gemessene Winde' :
                  'Nur Windsond/Pibal-Dateien'
                }
                style={{
                  padding: '2px 7px',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: windSourceFilter === opt.key ? `${opt.color}30` : 'transparent',
                  color: windSourceFilter === opt.key ? opt.color : 'rgba(255,255,255,0.35)',
                  letterSpacing: '0.3px',
                  transition: 'all 0.15s'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button
          className="no-drag"
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Tab-Leiste */}
      <div className="no-drag" style={{
        display: 'flex',
        gap: '6px',
        padding: '12px 16px'
      }}>
        {(['live', 'import', ...(teamSession ? ['team'] as const : [])] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: '11px',
              background: activeTab === tab ? '#3b82f6' : 'rgba(255,255,255,0.05)',
              color: 'white',
              border: activeTab === tab ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              position: 'relative'
            }}
          >
            {tab === 'live' ? 'Live' : tab === 'import' ? 'Import' : 'Team'}
            {tab === 'team' && teamWindProfiles.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                background: '#22c55e',
                color: 'white',
                fontSize: '9px',
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: '8px'
              }}>
                {teamWindProfiles.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.dat,.csv,.txt,.gpx,.kml,.json"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {activeTab === 'live' && (<>
        {/* Windschichten Liste mit Höhenbalken - scrollbar mit fester Höhe */}
        <div className="no-drag" style={{
          flex: 1,
          display: 'flex',
          minHeight: '150px',
          maxHeight: '450px',
          padding: '0 8px'
        }}>
          {windLayers.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '24px 16px',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '12px',
              width: '100%'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 8px', opacity: 0.5 }}>
                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
              </svg>
              <div>Keine Winddaten</div>
            </div>
          ) : (
            <>
              {/* Höhenbalken/Legende links */}
              <div style={{
                width: '8px',
                borderRadius: '4px',
                background: 'linear-gradient(to bottom, #3b82f6, #a855f7, #ef4444, #f97316, #eab308, #84cc16, #22c55e)',
                flexShrink: 0,
                marginRight: '6px'
              }} />

              {/* Windschichten - scrollbar */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* Finde die nächste Schicht zur aktuellen Höhe */}
                {(() => {
                  const closestLayerAlt = sortedLayers.reduce((closest, layer) => {
                    const currentDiff = Math.abs(layer.altitude - currentAltitude)
                    const closestDiff = Math.abs(closest - currentAltitude)
                    return currentDiff < closestDiff ? layer.altitude : closest
                  }, sortedLayers[0]?.altitude ?? 0)

                  return sortedLayers.map((layer, i) => {
                  const isCurrentLayer = layer.altitude === closestLayerAlt
                  const isSelected = selectedWindLayer === layer.altitude
                  const speedKmh = layer.speed
                  const altColor = getAltitudeColor(layer.altitude, minAltitude, maxAltitude)
                  const windColor = getWindColor(speedKmh)
                  const displayDirection = settings.windDirectionMode === 'to' ? (layer.direction + 180) % 360 : layer.direction

                  return (
                    <div
                      key={`${layer.altitude}-${i}`}
                      onClick={() => onSelectWindLayer(isSelected ? null : layer.altitude)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 10px',
                        margin: '3px 0',
                        background: isCurrentLayer
                          ? 'linear-gradient(90deg, rgba(59, 130, 246, 0.4) 0%, rgba(59, 130, 246, 0.15) 100%)'
                          : isSelected
                            ? 'rgba(34, 197, 94, 0.25)'
                            : 'rgba(255,255,255,0.03)',
                        borderRadius: '8px',
                        border: isCurrentLayer
                          ? '2px solid #3b82f6'
                          : isSelected
                            ? '1px solid rgba(34, 197, 94, 0.5)'
                            : '1px solid rgba(255,255,255,0.1)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        boxShadow: isCurrentLayer ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none'
                      }}
                    >
                      {/* Aktuelle Höhe Indikator */}
                      {isCurrentLayer && (
                        <div style={{
                          background: '#3b82f6',
                          color: 'white',
                          fontSize: '8px',
                          fontWeight: 700,
                          padding: '2px 4px',
                          borderRadius: '3px',
                          marginRight: '6px',
                          flexShrink: 0
                        }}>
                          ▶
                        </div>
                      )}

                      {/* Höhe - Zahl farbig, Einheit weiß */}
                      <div style={{
                        width: '65px',
                        fontWeight: 800,
                        fontSize: '14px',
                        fontFamily: 'monospace',
                        textShadow: '0 0 10px rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'baseline'
                      }}>
                        <span style={{ color: altColor }}>{formatAltitudeNumber(layer.altitude)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginLeft: '1px' }}>{altitudeUnit}</span>
                      </div>

                      {/* Kurs - prominent in Gelb */}
                      <div style={{
                        fontWeight: 800,
                        fontSize: '14px',
                        color: '#fbbf24',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        borderLeft: '1px solid rgba(255,255,255,0.2)',
                        paddingLeft: '8px',
                        marginLeft: '4px'
                      }}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          style={{
                            transform: `rotate(${displayDirection}deg)`,
                            flexShrink: 0
                          }}
                        >
                          <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                          <rect x="11" y="12" width="2" height="8" fill="#fbbf24" opacity="0.6"/>
                        </svg>
                        {Math.round(displayDirection)}°
                      </div>

                      {/* Windgeschwindigkeit */}
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: windColor,
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        borderLeft: '1px solid rgba(255,255,255,0.2)',
                        paddingLeft: '8px',
                        marginLeft: '4px'
                      }}>
                        {speedKmh.toFixed(0)} km/h
                      </div>

                      {/* Stabilität-Anzeige */}
                      {layer.source === 'measured' && (
                        <div style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                          borderLeft: '1px solid rgba(255,255,255,0.2)',
                          paddingLeft: '6px',
                          marginLeft: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                        title={layer.isStable ? 'Stabil (Vario < 2 m/s)' : 'Instabil (Steigen/Sinken)'}
                        >
                          {layer.isStable ? (
                            <span style={{ color: '#22c55e' }}>stabil</span>
                          ) : (
                            <>
                              <span style={{ color: '#f59e0b', fontSize: '11px' }}>⚠</span>
                              <span style={{ color: '#f59e0b' }}>
                                {layer.vario !== undefined ? `${layer.vario > 0 ? '+' : ''}${layer.vario.toFixed(1)}` : '?'}
                              </span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Forecast-Indikator */}
                      {layer.source === 'forecast' && (
                        <div
                          title="Aus Wettermodell-Vorhersage"
                          style={{
                            fontSize: '8px',
                            fontWeight: 700,
                            color: '#0ea5e9',
                            background: 'rgba(14, 165, 233, 0.15)',
                            border: '1px solid rgba(14, 165, 233, 0.3)',
                            borderRadius: '3px',
                            padding: '2px 5px',
                            marginLeft: '6px',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.5px'
                          }}
                        >
                          FC
                        </div>
                      )}

                      {/* Windsond/Pibal-Indikator */}
                      {(layer.source === 'windsond' || layer.source === 'pibal') && (
                        <div
                          title={layer.source === 'windsond' ? 'Aus Windsond-Datei' : 'Aus Pibal-Messung'}
                          style={{
                            fontSize: '8px',
                            fontWeight: 700,
                            color: '#a855f7',
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            borderRadius: '3px',
                            padding: '2px 5px',
                            marginLeft: '6px',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.5px'
                          }}
                        >
                          {layer.source === 'windsond' ? 'WS' : 'PB'}
                        </div>
                      )}

                      {/* Manual-Indikator */}
                      {layer.source === 'manual' && (
                        <div
                          title="Manuell eingegeben"
                          style={{
                            fontSize: '8px',
                            fontWeight: 700,
                            color: '#f59e0b',
                            background: 'rgba(245, 158, 11, 0.15)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: '3px',
                            padding: '2px 5px',
                            marginLeft: '6px',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.5px'
                          }}
                        >
                          MAN
                        </div>
                      )}

                      {/* Windlinie Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setWindLineMode(!windLineMode || pendingWindLayer?.altitude !== layer.altitude, layer)
                        }}
                        style={{
                          background: windLineMode && pendingWindLayer?.altitude === layer.altitude
                            ? '#06b6d4'
                            : 'rgba(255,255,255,0.1)',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          marginLeft: '8px'
                        }}
                        title="Windlinie auf Karte"
                      >
                        📍
                      </button>

                      {/* Löschen Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeWindLayer(layer.altitude)
                        }}
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          width: '22px',
                          height: '22px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0.5,
                          marginLeft: '4px',
                          fontSize: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })
                })()}
              </div>
            </>
          )}
        </div>

        {/* Windlinien auf der Karte */}
        {windLines.length > 0 && (
          <div className="no-drag" style={{
            padding: '8px 16px',
            borderTop: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{
              fontSize: '10px',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textTransform: 'uppercase'
            }}>
              <span>Windlinien ({windLines.length}/3)</span>
              <button
                onClick={clearAllWindLines}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '2px 4px'
                }}
              >
                Alle löschen
              </button>
            </div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {windLines.map((line, index) => {
                const defaultColors = ['#00bcd4', '#ff6b6b', '#ffd93d']
                const configuredColors = settings.windLineColors || defaultColors as [string, string, string]
                const lineColor = configuredColors[index] || defaultColors[index] || '#00bcd4'

                return (
                  <div
                    key={line.id}
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      borderLeft: `3px solid ${lineColor}`
                    }}
                  >
                    <span style={{ fontSize: '10px', fontWeight: 600, color: lineColor }}>
                      {formatAltitude(line.windLayer.altitude)}
                    </span>
                    <button
                      onClick={() => removeWindLine(line.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0',
                        fontSize: '10px',
                        opacity: 0.7
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add Wind Form */}
        {showAddForm && (
          <div className="no-drag" style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>
                  {altitudeUnit === 'ft' ? 'HÖHE (FT)' : 'HÖHE (M)'}
                </div>
                <input
                  type="number"
                  placeholder={altitudeUnit === 'ft' ? '2000' : '600'}
                  value={newWind.altitude}
                  onChange={e => setNewWind(prev => ({ ...prev, altitude: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>RICHTUNG (°)</div>
                <input
                  type="number"
                  placeholder="247"
                  min="0"
                  max="360"
                  value={newWind.direction}
                  onChange={e => setNewWind(prev => ({ ...prev, direction: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>KM/H</div>
                <input
                  type="number"
                  placeholder="12"
                  step="0.1"
                  value={newWind.speed}
                  onChange={e => setNewWind(prev => ({ ...prev, speed: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowAddForm(false)}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={handleAddWind}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: '#22c55e',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Hinzufügen
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="no-drag" style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          gap: '8px'
        }}>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '12px',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"/>
              </svg>
              Wind hinzufügen
            </button>
          )}

          {windLayers.length > 0 && !showAddForm && (
            <button
              onClick={() => setShowWindRose(!showWindRose)}
              style={{
                padding: '10px 16px',
                fontSize: '12px',
                background: showWindRose ? 'rgba(6, 182, 212, 0.2)' : 'rgba(6, 182, 212, 0.1)',
                color: showWindRose ? '#06b6d4' : 'rgba(6, 182, 212, 0.7)',
                border: showWindRose ? '1px solid rgba(6, 182, 212, 0.5)' : '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title={showWindRose ? 'Windrose ausblenden' : 'Windrose auf Karte anzeigen'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polygon points="12,2 14.5,9.5 12,8 9.5,9.5" fill="currentColor" stroke="none" />
                <polygon points="12,22 9.5,14.5 12,16 14.5,14.5" fill="currentColor" stroke="none" opacity="0.4" />
              </svg>
              Windrose
            </button>
          )}

          {windLayers.length > 0 && !showAddForm && (
            <button
              onClick={clearWindLayers}
              style={{
                padding: '10px 16px',
                fontSize: '12px',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Alle löschen
            </button>
          )}
        </div>
      </>)}

      {/* === Import Tab === */}
      {activeTab === 'import' && (
        <div className="no-drag" style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* ICON-D2 Forecast */}
          {!importResult && !iconD2Result && (
            <div style={{
              padding: '12px',
              background: 'rgba(14, 165, 233, 0.08)',
              borderRadius: '10px',
              border: '1px solid rgba(14, 165, 233, 0.2)'
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#0ea5e9',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2">
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  <circle cx="12" cy="12" r="5"/>
                </svg>
                Wettermodell Vorhersage
              </div>

              {/* Modellauswahl */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Modell
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {WEATHER_MODELS.map(model => (
                    <button
                      key={model.id}
                      onClick={() => setIconD2Model(model.id)}
                      title={`${model.resolution} · ${model.coverage}`}
                      style={{
                        padding: '5px 8px',
                        fontSize: '10px',
                        background: iconD2Model === model.id ? '#0ea5e9' : 'rgba(255,255,255,0.05)',
                        color: 'white',
                        border: iconD2Model === model.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1px'
                      }}
                    >
                      <span>{model.name}</span>
                      <span style={{ fontSize: '8px', opacity: 0.7 }}>{model.resolution}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Zeitauswahl */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Zeitpunkt
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 6, 12].map(h => {
                    const t = new Date(Date.now() + h * 3600000)
                    const label = h === 0 ? 'Jetzt' : `+${h}h`
                    const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <button
                        key={h}
                        onClick={() => setIconD2TimeOffset(h)}
                        style={{
                          padding: '5px 8px',
                          fontSize: '10px',
                          background: iconD2TimeOffset === h ? '#0ea5e9' : 'rgba(255,255,255,0.05)',
                          color: 'white',
                          border: iconD2TimeOffset === h ? 'none' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '1px'
                        }}
                      >
                        <span>{label}</span>
                        <span style={{ fontSize: '8px', opacity: 0.7 }}>{timeStr}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Position Info + Karten-Klick */}
              {(() => {
                const hasGps = !!gpsData?.latitude
                const hasPickedPos = !!windImportPosition
                const hasAnyPos = hasGps || hasPickedPos
                const posLat = gpsData?.latitude || windImportPosition?.lat
                const posLon = gpsData?.longitude || windImportPosition?.lon
                return (
                  <>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '10px',
                      color: 'rgba(255,255,255,0.4)',
                      marginBottom: '8px'
                    }}>
                      <span>
                        {hasGps
                          ? `GPS: ${gpsData!.latitude.toFixed(3)}°N ${gpsData!.longitude.toFixed(3)}°E`
                          : hasPickedPos
                            ? `Karte: ${windImportPosition!.lat.toFixed(3)}°N ${windImportPosition!.lon.toFixed(3)}°E`
                            : 'Keine Position'}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => setWindImportPickPosition(true)}
                          style={{
                            background: windImportPickPosition ? '#0ea5e9' : 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: windImportPickPosition ? 'white' : 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 600
                          }}
                          title="Position auf der Karte wählen"
                        >
                          {windImportPickPosition ? '⊙ Klicke auf Karte...' : '⊙ Von Karte'}
                        </button>
                        {hasPickedPos && !hasGps && (
                          <button
                            onClick={() => setWindImportPosition(null)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'rgba(255,255,255,0.3)',
                              cursor: 'pointer',
                              padding: '3px 4px',
                              fontSize: '10px'
                            }}
                            title="Position löschen"
                          >×</button>
                        )}
                      </div>
                    </div>

                    {/* Laden Button */}
                    <button
                      onClick={handleIconD2Fetch}
                      disabled={iconD2Loading || !hasAnyPos}
                      style={{
                        width: '100%',
                        padding: '12px',
                        fontSize: '13px',
                        background: iconD2Loading
                          ? 'rgba(14, 165, 233, 0.3)'
                          : hasAnyPos
                            ? '#0ea5e9'
                            : 'rgba(255,255,255,0.1)',
                        color: hasAnyPos ? 'white' : 'rgba(255,255,255,0.4)',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: hasAnyPos && !iconD2Loading ? 'pointer' : 'default',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                    >
                      {iconD2Loading ? (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                          Lade {WEATHER_MODELS.find(m => m.id === iconD2Model)?.name ?? 'Wind'}...
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          {WEATHER_MODELS.find(m => m.id === iconD2Model)?.name ?? 'Wind'} laden
                        </>
                      )}
                    </button>
                  </>
                )
              })()}
            </div>
          )}

          {/* ICON-D2 Ergebnisse */}
          {iconD2Result && !importResult && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                background: iconD2Result.success ? 'rgba(14, 165, 233, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderRadius: '8px',
                border: `1px solid ${iconD2Result.success ? 'rgba(14, 165, 233, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'white' }}>
                    {WEATHER_MODELS.find(m => m.id === iconD2Result.modelId)?.name ?? iconD2Result.modelId} Vorhersage
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
                    {iconD2Result.success
                      ? `${iconD2Result.layers.length} Schichten · ${new Date(iconD2Result.modelTime).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
                      : iconD2Result.errors.join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => setIconD2Result(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '14px'
                  }}
                >
                  ✕
                </button>
              </div>

              {iconD2Result.success && (
                <>
                  {/* Modus */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>MODUS</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['merge', 'replace'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setImportMode(m)}
                            style={{
                              flex: 1, padding: '5px', fontSize: '10px',
                              background: importMode === m ? '#0ea5e9' : 'rgba(255,255,255,0.05)',
                              color: 'white',
                              border: importMode === m ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '5px', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {m === 'merge' ? 'Merge' : 'Ersetzen'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Vorschau */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                        Windprofil ({iconD2Selected.size}/{iconD2Result.layers.length} ausgewählt)
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => setIconD2Selected(new Set(iconD2Result!.layers.map((_, i) => i)))}
                          style={{ fontSize: '9px', color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Alle
                        </button>
                        <button
                          onClick={() => setIconD2Selected(new Set())}
                          style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Keine
                        </button>
                      </div>
                    </div>
                    <div style={{
                      maxHeight: '200px',
                      overflow: 'auto',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {iconD2Result.layers.map((layer, i) => {
                        const displayDir = settings.windDirectionMode === 'to' ? (layer.direction + 180) % 360 : layer.direction
                        const isChecked = iconD2Selected.has(i)
                        return (
                          <div
                            key={i}
                            onClick={() => {
                              const next = new Set(iconD2Selected)
                              if (next.has(i)) next.delete(i); else next.add(i)
                              setIconD2Selected(next)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '5px 8px',
                              fontSize: '11px',
                              borderBottom: i < iconD2Result.layers.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                              cursor: 'pointer',
                              opacity: isChecked ? 1 : 0.4,
                              background: isChecked ? 'rgba(14, 165, 233, 0.05)' : 'transparent'
                            }}
                          >
                            <div style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              border: isChecked ? '2px solid #0ea5e9' : '2px solid rgba(255,255,255,0.2)',
                              background: isChecked ? '#0ea5e9' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginRight: '8px',
                              flexShrink: 0
                            }}>
                              {isChecked && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <span style={{
                              width: '60px',
                              color: getAltitudeColor(layer.altitude,
                                iconD2Result.layers[0]?.altitude ?? 0,
                                iconD2Result.layers[iconD2Result.layers.length - 1]?.altitude ?? 1000),
                              fontFamily: 'monospace',
                              fontWeight: 700
                            }}>
                              {altitudeUnit === 'ft' ? `${Math.round(layer.altitude * 3.28084)}ft` : `${Math.round(layer.altitude)}m`}
                            </span>
                            <span style={{
                              width: '60px',
                              color: '#fbbf24',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" style={{ transform: `rotate(${displayDir}deg)`, flexShrink: 0 }}>
                                <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                              </svg>
                              {Math.round(displayDir)}°
                            </span>
                            <span style={{
                              color: getWindColor(layer.speed),
                              fontFamily: 'monospace',
                              fontWeight: 600
                            }}>
                              {layer.speed.toFixed(0)} km/h
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Import Button */}
                  <button
                    onClick={handleIconD2Import}
                    disabled={iconD2Selected.size === 0}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '13px',
                      background: iconD2Selected.size > 0 ? '#22c55e' : 'rgba(255,255,255,0.1)',
                      color: iconD2Selected.size > 0 ? 'white' : 'rgba(255,255,255,0.4)',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: iconD2Selected.size > 0 ? 'pointer' : 'default',
                      fontWeight: 700
                    }}
                  >
                    Importieren ({iconD2Selected.size} Schichten)
                  </button>
                </>
              )}

              {/* Zurück Button */}
              <button
                onClick={() => setIconD2Result(null)}
                style={{
                  width: '100%',
                  padding: '8px',
                  fontSize: '11px',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Zurück
              </button>
            </div>
          )}

          {/* Datei auswählen */}
          {!importResult && !iconD2Result ? (
            <div style={{ textAlign: 'center', padding: '8px 12px' }}>
              <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                fontWeight: 600
              }}>
                oder Datei importieren
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'white',
                  border: '2px dashed rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Datei auswählen...
              </button>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '6px' }}>
                .xml (oziTarget), .dat (Windsond), .csv, .txt, .gpx/.kml (Trajektorien)
              </div>
              {trajImportMsg && (
                <div style={{ fontSize: '11px', color: '#a855f7', marginTop: '6px', fontWeight: 600 }}>
                  {trajImportMsg}
                </div>
              )}
            </div>
          ) : importResult ? (
            <>
              {/* Datei-Info */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'white' }}>
                    {importFilename}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                    {formatName(importResult.format)} - {importResult.rows.length} Einträge
                  </div>
                </div>
                <button
                  onClick={handleClearImport}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '14px'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Fehler/Warnungen */}
              {importResult.errors.length > 0 && (
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#ef4444'
                }}>
                  {importResult.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}

              {importResult.success && (
                <>
                  {/* Einstellungen - kompakt */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>HÖHE</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['meters', 'feet'] as const).map(u => (
                          <button
                            key={u}
                            onClick={() => setImportSettings(s => ({ ...s, altitudeUnit: u }))}
                            style={{
                              flex: 1, padding: '5px', fontSize: '10px',
                              background: importSettings.altitudeUnit === u ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                              color: 'white',
                              border: importSettings.altitudeUnit === u ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '5px', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {u === 'meters' ? 'm' : 'ft'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: 1.5 }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>GESCHW.</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['kmh', 'ms', 'knots'] as const).map(u => (
                          <button
                            key={u}
                            onClick={() => setImportSettings(s => ({ ...s, speedUnit: u }))}
                            style={{
                              flex: 1, padding: '5px', fontSize: '9px',
                              background: importSettings.speedUnit === u ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                              color: 'white',
                              border: importSettings.speedUnit === u ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '5px', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {u === 'kmh' ? 'km/h' : u === 'ms' ? 'm/s' : 'kts'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>RICHTUNG</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['from', 'to'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setImportSettings(s => ({ ...s, directionMode: m }))}
                            style={{
                              flex: 1, padding: '5px', fontSize: '10px',
                              background: importSettings.directionMode === m ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                              color: 'white',
                              border: importSettings.directionMode === m ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '5px', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {m === 'from' ? 'VON' : 'ZU'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>MODUS</div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['merge', 'replace'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setImportMode(m)}
                            style={{
                              flex: 1, padding: '5px', fontSize: '9px',
                              background: importMode === m ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                              color: 'white',
                              border: importMode === m ? 'none' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '5px', cursor: 'pointer', fontWeight: 600
                            }}
                          >
                            {m === 'merge' ? 'Merge' : 'Ersetzen'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Vorschau - scrollbar */}
                  {previewLayers.length > 0 && (
                    <div>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                        Vorschau ({previewLayers.length} Schichten)
                      </div>
                      <div style={{
                        maxHeight: '120px',
                        overflow: 'auto',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)'
                      }}>
                        {previewLayers.slice(0, 20).map((layer, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              padding: '4px 8px',
                              fontSize: '11px',
                              borderBottom: i < previewLayers.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                            }}
                          >
                            <span style={{ flex: 1, color: 'white', fontFamily: 'monospace' }}>
                              {altitudeUnit === 'ft' ? `${Math.round(layer.altitude * 3.28084)} ft` : `${Math.round(layer.altitude)} m`}
                            </span>
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                              {formatWindDirection(layer.direction)} {getWindDirectionName(settings.windDirectionMode === 'from' ? layer.direction : (layer.direction + 180) % 360)}
                            </span>
                            <span style={{ color: getWindColor(layer.speed), fontFamily: 'monospace' }}>
                              {layer.speed.toFixed(1)} km/h
                            </span>
                          </div>
                        ))}
                        {previewLayers.length > 20 && (
                          <div style={{ padding: '4px 8px', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                            ... und {previewLayers.length - 20} weitere
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Import Button */}
                  <button
                    onClick={handleImport}
                    disabled={previewLayers.length === 0}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '13px',
                      background: previewLayers.length > 0 ? '#22c55e' : 'rgba(255,255,255,0.1)',
                      color: previewLayers.length > 0 ? 'white' : 'rgba(255,255,255,0.4)',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: previewLayers.length > 0 ? 'pointer' : 'default',
                      fontWeight: 600
                    }}
                  >
                    Importieren ({previewLayers.length})
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontSize: '11px',
                      background: 'transparent',
                      color: 'rgba(255,255,255,0.5)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    Andere Datei...
                  </button>
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* === Team Tab === */}
      {activeTab === 'team' && teamSession && (
        <div className="no-drag" style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* Info: Automatisches Teilen */}
          <div style={{
            padding: '10px 12px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(34, 197, 94, 0.2)',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.7)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>Windprofil wird automatisch mit Team geteilt</span>
          </div>

          {/* Team Windprofile Header mit Windsuche Button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
              TEAM WINDPROFILE ({teamWindProfiles.length})
            </div>
            <button
              onClick={() => setShowWindSearch(!showWindSearch)}
              style={{
                padding: '4px 10px',
                background: showWindSearch ? 'rgba(6, 182, 212, 0.2)' : 'rgba(6, 182, 212, 0.1)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: '6px',
                color: '#06b6d4',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Wind suchen
            </button>
          </div>

          {/* Wind Suche Panel */}
          {showWindSearch && (
            <div style={{
              padding: '12px',
              background: 'rgba(6, 182, 212, 0.08)',
              borderRadius: '8px',
              border: '1px solid rgba(6, 182, 212, 0.2)'
            }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="number"
                  placeholder="Richtung (0-360°)"
                  value={searchDirection}
                  onChange={(e) => setSearchDirection(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '12px'
                  }}
                  min={0}
                  max={360}
                />
                {searchDirection && (
                  <button
                    onClick={() => setSearchDirection('')}
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Suchergebnisse - Layout wie aufgeklappte Team-Windschichten */}
              {windSearchResults.length > 0 && (
                <div style={{
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}>
                  {(() => {
                    const allAltitudes = windSearchResults.map(r => r.layer.altitude)
                    const searchMinAlt = allAltitudes.length > 0 ? Math.min(...allAltitudes) : 0
                    const searchMaxAlt = allAltitudes.length > 0 ? Math.max(...allAltitudes) : 1000

                    return windSearchResults.map((result, i) => {
                      const isLineActive = windLineMode && pendingWindLayer?.altitude === result.layer.altitude
                      const displayDir = settings.windDirectionMode === 'from'
                        ? result.layer.direction
                        : (result.layer.direction + 180) % 360
                      const altColor = getAltitudeColor(result.layer.altitude, searchMinAlt, searchMaxAlt)
                      const windColor = getWindColor(result.layer.speed)

                      return (
                        <div
                          key={`${result.memberId}-${result.layer.altitude}-${i}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 12px',
                            borderBottom: i < windSearchResults.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                            background: isLineActive ? 'rgba(6, 182, 212, 0.15)' : 'transparent'
                          }}
                        >
                          {/* Pilot Farbe */}
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: result.color,
                            marginRight: '8px',
                            flexShrink: 0
                          }} />

                          {/* Höhe - Zahl farbig, Einheit weiß */}
                          <div style={{
                            width: '65px',
                            fontWeight: 800,
                            fontSize: '14px',
                            fontFamily: 'monospace',
                            display: 'flex',
                            alignItems: 'baseline'
                          }}>
                            <span style={{ color: altColor }}>
                              {altitudeUnit === 'ft' ? Math.round(result.layer.altitude * 3.28084) : Math.round(result.layer.altitude)}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginLeft: '1px' }}>
                              {altitudeUnit}
                            </span>
                          </div>

                          {/* Kurs - gelb mit Separator */}
                          <div style={{
                            fontWeight: 800,
                            fontSize: '14px',
                            color: '#fbbf24',
                            fontFamily: 'monospace',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            borderLeft: '1px solid rgba(255,255,255,0.2)',
                            paddingLeft: '8px',
                            marginLeft: '4px'
                          }}>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              style={{
                                transform: `rotate(${displayDir}deg)`,
                                flexShrink: 0
                              }}
                            >
                              <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                              <rect x="11" y="12" width="2" height="8" fill="#fbbf24" opacity="0.6"/>
                            </svg>
                            {Math.round(displayDir)}°
                          </div>

                          {/* Windgeschwindigkeit */}
                          <div style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: windColor,
                            fontFamily: 'monospace',
                            whiteSpace: 'nowrap',
                            borderLeft: '1px solid rgba(255,255,255,0.2)',
                            paddingLeft: '8px',
                            marginLeft: '4px'
                          }}>
                            {result.layer.speed.toFixed(0)} km/h
                          </div>

                          {/* Stabilität */}
                          {(result.layer.isStable !== undefined || result.layer.vario !== undefined) && (
                            <div style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                              borderLeft: '1px solid rgba(255,255,255,0.2)',
                              paddingLeft: '6px',
                              marginLeft: '4px'
                            }}>
                              {result.layer.isStable ? (
                                <span style={{ color: '#22c55e' }}>stabil</span>
                              ) : (
                                <span style={{ color: '#f59e0b' }}>
                                  {result.layer.vario !== undefined ? `${result.layer.vario > 0 ? '+' : ''}${result.layer.vario.toFixed(1)}` : '?'}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Windlinie Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setWindLineMode(!isLineActive, result.layer)
                            }}
                            style={{
                              background: isLineActive ? '#06b6d4' : 'rgba(255,255,255,0.1)',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '4px 6px',
                              cursor: 'pointer',
                              marginLeft: 'auto',
                              fontSize: '11px',
                              color: 'white'
                            }}
                            title="Windlinie auf Karte"
                          >
                            📍
                          </button>
                        </div>
                      )
                    })
                  })()}
                </div>
              )}

              {searchDirection && windSearchResults.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '10px',
                  padding: '10px'
                }}>
                  Keine Winde gefunden
                </div>
              )}
            </div>
          )}

          {teamWindProfiles.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '24px 16px',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '12px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 8px', opacity: 0.5 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <div>Noch keine Windprofile vom Team</div>
            </div>
          ) : (
            teamWindProfiles.map((profile) => {
              const isExpanded = expandedProfiles.has(profile.memberId)
              return (
                <div
                  key={profile.memberId}
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '10px',
                    border: `2px solid ${profile.color}40`,
                    overflow: 'hidden'
                  }}
                >
                  {/* Header - klickbar zum Auf-/Zuklappen */}
                  {(() => {
                    // Finde die aktuelle Position des Piloten
                    const member = teamMembers.find(m => m.id === profile.memberId)
                    const pos = member?.currentPosition

                    return (
                      <div
                        onClick={() => {
                          setExpandedProfiles(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(profile.memberId)) {
                              newSet.delete(profile.memberId)
                            } else {
                              newSet.add(profile.memberId)
                            }
                            return newSet
                          })
                        }}
                        style={{
                          padding: '10px 12px',
                          cursor: 'pointer',
                          background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent'
                        }}
                      >
                        {/* Erste Zeile: Name, Anzahl, Zeit, Pfeil */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pos && !isExpanded ? '6px' : '0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              background: profile.color
                            }} />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>
                              {profile.callsign}
                            </span>
                            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                              ({profile.windLayers.length})
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                              {new Date(profile.sharedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="rgba(255,255,255,0.5)"
                              strokeWidth="2"
                              style={{
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s'
                              }}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                        </div>

                        {/* Zweite Zeile: Aktuelle Flugdaten des Piloten - nur wenn zugeklappt */}
                        {pos && !isExpanded && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontFamily: 'monospace',
                            marginLeft: '18px'
                          }}>
                            {/* Höhe */}
                            <div style={{ display: 'flex', alignItems: 'baseline' }}>
                              <span style={{ color: getAltitudeColor(pos.altitude, 0, 4000), fontWeight: 800, fontSize: '13px' }}>
                                {altitudeUnit === 'ft' ? Math.round(pos.altitude * 3.28084) : Math.round(pos.altitude)}
                              </span>
                              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', marginLeft: '1px' }}>
                                {altitudeUnit}
                              </span>
                            </div>

                            {/* Kurs */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: '#fbbf24',
                              fontWeight: 800,
                              fontSize: '13px',
                              borderLeft: '1px solid rgba(255,255,255,0.15)',
                              paddingLeft: '8px'
                            }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" style={{ transform: `rotate(${pos.heading}deg)` }}>
                                <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                                <rect x="11" y="12" width="2" height="8" fill="#fbbf24" opacity="0.6"/>
                              </svg>
                              {Math.round(pos.heading)}°
                            </div>

                            {/* Geschwindigkeit */}
                            <div style={{
                              color: getWindColor(pos.speed * 3.6),
                              fontWeight: 600,
                              fontSize: '13px',
                              borderLeft: '1px solid rgba(255,255,255,0.15)',
                              paddingLeft: '8px'
                            }}>
                              {Math.round(pos.speed * 3.6)} km/h
                            </div>

                            {/* Vario */}
                            <span style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: pos.vario > 0.3 ? '#22c55e' : pos.vario < -0.3 ? '#ef4444' : 'rgba(255,255,255,0.5)',
                              borderLeft: '1px solid rgba(255,255,255,0.15)',
                              paddingLeft: '8px'
                            }}>
                              {pos.vario > 0 ? '+' : ''}{pos.vario.toFixed(1)}m/s
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Windschichten - nur wenn aufgeklappt */}
                  {isExpanded && (
                    <div style={{
                      maxHeight: '250px',
                      overflow: 'auto',
                      borderTop: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.2)'
                    }}>
                      {(() => {
                        const teamLayers = profile.windLayers.slice().sort((a, b) => b.altitude - a.altitude)
                        const teamMinAlt = teamLayers.length > 0 ? Math.min(...teamLayers.map(l => l.altitude)) : 0
                        const teamMaxAlt = teamLayers.length > 0 ? Math.max(...teamLayers.map(l => l.altitude)) : 1000

                        return teamLayers.map((layer, i) => {
                          const speedKmh = layer.speed
                          const isLineActive = windLineMode && pendingWindLayer?.altitude === layer.altitude
                          const teamAltColor = getAltitudeColor(layer.altitude, teamMinAlt, teamMaxAlt)
                          const teamWindColor = getWindColor(speedKmh)
                          const displayDir = settings.windDirectionMode === 'to' ? (layer.direction + 180) % 360 : layer.direction

                          return (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '8px 12px',
                                borderBottom: i < teamLayers.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                                background: isLineActive ? 'rgba(6, 182, 212, 0.15)' : 'transparent'
                              }}
                            >
                              {/* Höhe - Zahl farbig, Einheit weiß */}
                              <div style={{
                                width: '65px',
                                fontWeight: 800,
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                display: 'flex',
                                alignItems: 'baseline'
                              }}>
                                <span style={{ color: teamAltColor }}>
                                  {altitudeUnit === 'ft' ? Math.round(layer.altitude * 3.28084) : Math.round(layer.altitude)}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginLeft: '1px' }}>
                                  {altitudeUnit}
                                </span>
                              </div>

                              {/* Kurs - gelb mit Separator */}
                              <div style={{
                                fontWeight: 800,
                                fontSize: '14px',
                                color: '#fbbf24',
                                fontFamily: 'monospace',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                borderLeft: '1px solid rgba(255,255,255,0.2)',
                                paddingLeft: '8px',
                                marginLeft: '4px'
                              }}>
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  style={{
                                    transform: `rotate(${displayDir}deg)`,
                                    flexShrink: 0
                                  }}
                                >
                                  <path d="M12 2L8 12h8L12 2z" fill="#fbbf24" />
                                  <rect x="11" y="12" width="2" height="8" fill="#fbbf24" opacity="0.6"/>
                                </svg>
                                {Math.round(displayDir)}°
                              </div>

                              {/* Windgeschwindigkeit */}
                              <div style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: teamWindColor,
                                fontFamily: 'monospace',
                                whiteSpace: 'nowrap',
                                borderLeft: '1px solid rgba(255,255,255,0.2)',
                                paddingLeft: '8px',
                                marginLeft: '4px'
                              }}>
                                {speedKmh.toFixed(0)} km/h
                              </div>

                              {/* Stabilität */}
                              {(layer.isStable !== undefined || layer.vario !== undefined) && (
                                <div style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  fontFamily: 'monospace',
                                  whiteSpace: 'nowrap',
                                  borderLeft: '1px solid rgba(255,255,255,0.2)',
                                  paddingLeft: '6px',
                                  marginLeft: '4px'
                                }}>
                                  {layer.isStable ? (
                                    <span style={{ color: '#22c55e' }}>stabil</span>
                                  ) : (
                                    <span style={{ color: '#f59e0b' }}>
                                      {layer.vario !== undefined ? `${layer.vario > 0 ? '+' : ''}${layer.vario.toFixed(1)}` : '?'}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Windlinie Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setWindLineMode(!windLineMode || pendingWindLayer?.altitude !== layer.altitude, layer)
                                }}
                                style={{
                                  background: isLineActive
                                    ? '#06b6d4'
                                    : 'rgba(255,255,255,0.1)',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '4px 6px',
                                  cursor: 'pointer',
                                  marginLeft: 'auto',
                                  fontSize: '11px',
                                  color: 'white'
                                }}
                                title="Windlinie auf Karte"
                              >
                                📍
                              </button>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
