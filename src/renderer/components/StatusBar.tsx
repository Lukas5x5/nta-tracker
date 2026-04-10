import React, { useState, useEffect, useRef } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'
import { latLonToUTM } from '../utils/coordinatesWGS84'
import { formatUTMGridRef, formatLatLonOzi, formatUTMOzi } from '../utils/coordinates'

export function StatusBar() {
  const gpsData = useFlightStore(s => s.gpsData)
  const isConnected = useFlightStore(s => s.isConnected)
  const track = useFlightStore(s => s.track)
  const settings = useFlightStore(s => s.settings)
  const mousePosition = useFlightStore(s => s.mousePosition)
  const updateSettings = useFlightStore(s => s.updateSettings)
  const o = getOutdoor(settings.outdoorMode)
  const selectedGoal = useFlightStore(s => s.selectedGoal)
  const windSourceFilter = useFlightStore(s => s.windSourceFilter)
  const activeCompetitionMap = useFlightStore(s => s.activeCompetitionMap)
  const rangeCircleRadius = useFlightStore(s => s.rangeCircleRadius)
  const setRangeCircleRadius = useFlightStore(s => s.setRangeCircleRadius)
  const [showRangeDropdown, setShowRangeDropdown] = useState(false)
  const rangeDropdownRef = useRef<HTMLDivElement>(null)

  // Distanzkreis Dropdown schließen bei Klick außerhalb
  useEffect(() => {
    if (!showRangeDropdown) return
    const handler = (e: MouseEvent) => {
      if (rangeDropdownRef.current && !rangeDropdownRef.current.contains(e.target as Node)) {
        setShowRangeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRangeDropdown])

  // Live clock
  const [currentTime, setCurrentTime] = useState(new Date())

  // Fullscreen State
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Ground elevation for mouse/GPS position
  const [mouseElevation, setMouseElevation] = useState<number | null>(null)
  const storeGroundElevation = useFlightStore(s => s.groundElevation)

  // HGT import state
  const [hgtTileCount, setHgtTileCount] = useState(0)
  const [hgtImporting, setHgtImporting] = useState(false)
  const [showHgtMenu, setShowHgtMenu] = useState(false)
  const hgtMenuRef = React.useRef<HTMLDivElement>(null)
  const hgtBtnRef = React.useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!window.ntaAPI?.elevation) return
    window.ntaAPI.elevation.status().then((s: any) => {
      setHgtTileCount(s?.tiles?.length ?? 0)
    }).catch(() => {})
  }, [])

  // Fullscreen Status beim Start prüfen
  useEffect(() => {
    // @ts-ignore
    window.ntaAPI?.isFullscreen?.().then((fs: boolean) => setIsFullscreen(fs))
  }, [])

  // Toggle Fullscreen
  const toggleFullscreen = async () => {
    try {
      // @ts-ignore
      const newState = await window.ntaAPI?.toggleFullscreen?.()
      setIsFullscreen(newState ?? false)
    } catch (err) {
      console.error('Fullscreen toggle failed:', err)
    }
  }

  // Click-outside handler for HGT menu
  useEffect(() => {
    if (!showHgtMenu) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (hgtMenuRef.current?.contains(target)) return
      if (hgtBtnRef.current?.contains(target)) return
      setShowHgtMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHgtMenu])

  const handleHgtImport = async () => {
    if (!window.ntaAPI?.elevation || hgtImporting) return
    setShowHgtMenu(false)
    setHgtImporting(true)
    try {
      const results = await window.ntaAPI.elevation.import()
      if (results) {
        const status = await window.ntaAPI.elevation.status()
        setHgtTileCount(status?.tiles?.length ?? 0)
      }
    } catch (e) {
      // ignore
    } finally {
      setHgtImporting(false)
    }
  }

  const handleOpenHgtWebsite = () => {
    setShowHgtMenu(false)
    window.open('https://www.viewfinderpanoramas.org/Coverage%20map%20viewfinderpanoramas_org3.htm', '_blank')
  }

  useEffect(() => {
    if (!mousePosition) {
      setMouseElevation(null)
      return
    }
    if (!window.ntaAPI?.elevation) return
    let cancelled = false
    // Sofort abfragen ohne Debounce für flüssige Aktualisierung
    const { lat, lon } = mousePosition
    window.ntaAPI.elevation.getElevation(lat, lon).then((elev: number | null) => {
      if (!cancelled) setMouseElevation(elev)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [mousePosition?.lat, mousePosition?.lon])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // UTM Zone aus aktiver Wettkampfkarte
  const mapUtmZone = activeCompetitionMap?.utmReprojection?.utmZone || activeCompetitionMap?.utmZone
  const effectiveUtmZone = mapUtmZone || settings.utmZone || undefined

  // UTM Grid Reference
  let utmGridRef = '????? ?????'
  let gpsUtm: { zone: number; easting: number; northing: number } | null = null
  let utmZoneLetter = ''
  if (gpsData) {
    const utm = latLonToUTM(gpsData.latitude, gpsData.longitude, effectiveUtmZone)
    gpsUtm = utm
    const digits = settings.coordinateFormat.startsWith('utm')
      ? parseInt(settings.coordinateFormat.replace('utm', '')) as 4 | 5 | 6 | 8
      : 5
    utmGridRef = formatUTMGridRef(utm.easting, utm.northing, digits)
    const letters = 'CDEFGHJKLMNPQRSTUVWX'
    const idx = Math.floor((gpsData.latitude + 80) / 8)
    utmZoneLetter = letters[Math.max(0, Math.min(idx, letters.length - 1))] || ''
  }

  // Grid mismatch check - use active competition map bounds if available
  let gridMismatch = false
  let gpsGridSquare = { east: 0, north: 0 }
  let settingsGridSquare = { east: 0, north: 0 }
  const mapUtmBounds = activeCompetitionMap?.utmReprojection?.utmBounds

  if (gpsUtm) {
    gpsGridSquare = {
      east: Math.floor(gpsUtm.easting / 100000),
      north: Math.floor(gpsUtm.northing / 100000)
    }

    // If we have an active competition map with bounds, check if GPS is within those bounds
    if (mapUtmBounds && mapUtmZone) {
      const withinBounds =
        gpsUtm.zone === mapUtmZone &&
        gpsUtm.easting >= mapUtmBounds.minE &&
        gpsUtm.easting <= mapUtmBounds.maxE &&
        gpsUtm.northing >= mapUtmBounds.minN &&
        gpsUtm.northing <= mapUtmBounds.maxN

      gridMismatch = !withinBounds

      // For display in tooltip, calculate the map's grid squares
      settingsGridSquare = {
        east: Math.floor(mapUtmBounds.minE / 100000),
        north: Math.floor(mapUtmBounds.minN / 100000)
      }
    } else {
      // Fallback to settings-based check if no active competition map
      settingsGridSquare = {
        east: Math.floor(settings.utmBaseEasting / 100000),
        north: Math.floor(settings.utmBaseNorthing / 100000)
      }
      gridMismatch = gpsUtm.zone !== settings.utmZone ||
        gpsGridSquare.east !== settingsGridSquare.east ||
        gpsGridSquare.north !== settingsGridSquare.north
    }
  }

  const handleUpdateGridBase = () => {
    if (gpsUtm) {
      updateSettings({
        utmZone: gpsUtm.zone,
        utmBaseEasting: Math.floor(gpsUtm.easting / 100000) * 100000,
        utmBaseNorthing: Math.floor(gpsUtm.northing / 100000) * 100000
      })
    }
  }

  // Mouse position in OziExplorer format
  let mouseLatLon = ''
  let mouseUTM = ''
  if (mousePosition) {
    const utm = latLonToUTM(mousePosition.lat, mousePosition.lon, effectiveUtmZone)
    mouseLatLon = formatLatLonOzi(mousePosition.lat, mousePosition.lon)
    mouseUTM = formatUTMOzi(utm.easting, utm.northing, utm.zone, mousePosition.lat)
  }

  // ─── Styles ─────────────────────────────────────────────
  const monoStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.5px',
    fontSize: '13px'
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.4})`,
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const Sep = () => (
    <div style={{
      width: '1px',
      alignSelf: 'stretch',
      margin: '4px 0',
      background: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.12})`,
      flexShrink: 0
    }} />
  )

  return (
    <div className="status-bar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      width: '100%',
      height: '100%',
      padding: '0 14px',
      fontSize: '13px',
      color: `rgba(${o.c},${o.c},${o.c},${o.textSec})`
    }}>

      {/* ─── GPS Position (UTM) ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={labelStyle}>
          {gpsUtm ? `${gpsUtm.zone}${utmZoneLetter}` : 'UTM'}
        </span>
        <span style={{
          ...monoStyle,
          color: gpsUtm ? `rgba(${o.c},${o.c},${o.c},${o.on ? 0.95 : 0.85})` : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.35 : 0.2})`
        }}>
          {gpsUtm ? utmGridRef : '---'}
        </span>
      </div>

      <Sep />

      {/* ─── Mouse Position (nur UTM) ─── */}
      <span style={{ ...monoStyle, color: mousePosition ? `rgba(${o.c},${o.c},${o.c},${o.text})` : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.1})`, minWidth: '120px' }}>
        {mousePosition ? mouseUTM : '---'}
      </span>

      <Sep />

      {/* ─── Ground Elevation (Maus-Position oder GPS-Position) ─── */}
      {(() => {
        const elev = mousePosition ? mouseElevation : storeGroundElevation
        const source = mousePosition ? 'cursor' : 'gps'
        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 10px',
            borderRadius: '4px',
            background: elev != null ? 'rgba(34,197,94,0.08)' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.03})`,
            border: `1px solid ${elev != null ? 'rgba(34,197,94,0.2)' : `rgba(${o.c},${o.c},${o.c},${o.bgSoft})`}`,
            flexShrink: 0
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: elev != null ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.5 : 0.3})`,
              letterSpacing: '0.5px'
            }}>
              GND
            </span>
            <span style={{
              ...monoStyle,
              fontWeight: 600,
              color: elev != null ? '#fff' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.35 : 0.2})`
            }}>
              {elev != null
                ? `${Math.round(elev * 3.28084)} ft`
                : '--- ft'
              }
            </span>
            {source === 'gps' && elev != null && (
              <span style={{ fontSize: '9px', color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.5 : 0.3})` }}>GPS</span>
            )}
          </div>
        )
      })()}

      {/* HGT Import Button with Dropdown - IMMER sichtbar */}
      <div style={{ position: 'relative' }}>
        <button
          ref={hgtBtnRef}
          onClick={() => setShowHgtMenu(!showHgtMenu)}
          disabled={hgtImporting}
          title={`HGT-Dateien (${hgtTileCount} Kacheln geladen)`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            padding: 0,
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: '4px',
            background: hgtImporting || showHgtMenu ? 'rgba(34,197,94,0.15)' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.08 : 0.03})`,
            color: hgtTileCount > 0 ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.5 : 0.3})`,
            cursor: hgtImporting ? 'wait' : 'pointer',
            flexShrink: 0,
            opacity: hgtImporting ? 0.6 : 1,
            transition: 'all 0.15s'
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8M5 7l3 3 3-3M3 12h10M3 14h10" />
          </svg>
        </button>

        {/* HGT Dropdown Menu */}
        {showHgtMenu && (
          <div
            ref={hgtMenuRef}
            style={{
              position: 'fixed',
              bottom: '40px',
              left: hgtBtnRef.current ? hgtBtnRef.current.getBoundingClientRect().left : 0,
              background: o.panelGradient,
              border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.1})`,
              borderRadius: '6px',
              padding: '4px',
              zIndex: 9999,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              minWidth: '180px'
            }}
          >
            <button
              onClick={handleHgtImport}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                borderRadius: '4px',
                background: 'transparent',
                color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.95 : 0.85})`,
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={e => e.currentTarget.style.background = `rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.1})`}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 10v4H2v-4M8 2v8M5 7l3 3 3-3" />
              </svg>
              HGT-Dateien importieren
            </button>
            <button
              onClick={handleOpenHgtWebsite}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                borderRadius: '4px',
                background: 'transparent',
                color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.95 : 0.85})`,
                fontSize: '12px',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={e => e.currentTarget.style.background = `rgba(${o.c},${o.c},${o.c},${o.on ? 0.2 : 0.1})`}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6" />
                <path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" />
              </svg>
              HGT-Dateien herunterladen
            </button>
          </div>
        )}
      </div>

      <Sep />

      {/* ─── Track Points ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={labelStyle}>TRK</span>
        <span style={{
          ...monoStyle,
          color: track.length > 0 ? `rgba(${o.c},${o.c},${o.c},${o.on ? 0.92 : 0.75})` : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.35 : 0.2})`
        }}>
          {track.length}
        </span>
      </div>

      <Sep />

      {/* ─── Wind-Quellen-Filter ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '4px',
        background: windSourceFilter !== 'all' ? 'rgba(245,158,11,0.1)' : 'transparent',
        border: windSourceFilter !== 'all' ? '1px solid rgba(245,158,11,0.2)' : '1px solid transparent',
        flexShrink: 0
      }}>
        <span style={labelStyle}>WIND</span>
        <span style={{
          ...monoStyle,
          fontWeight: 700,
          fontSize: '11px',
          color: windSourceFilter === 'all' ? `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.4})`
               : windSourceFilter === 'forecast' ? '#0ea5e9'
               : windSourceFilter === 'measured' ? '#22c55e'
               : '#a855f7',
          letterSpacing: '0.5px'
        }}>
          {windSourceFilter === 'all' ? 'Alle'
           : windSourceFilter === 'forecast' ? 'FC'
           : windSourceFilter === 'measured' ? 'Live'
           : '.dat'}
        </span>
      </div>

      {/* ─── Grid Mismatch Warning ─── */}
      {gridMismatch && gpsUtm && (
        <>
          <Sep />
          <button
            onClick={handleUpdateGridBase}
            title={`GPS: Zone ${gpsUtm.zone} / Grid ${gpsGridSquare.east}-${gpsGridSquare.north}\nSettings: Zone ${settings.utmZone} / Grid ${settingsGridSquare.east}-${settingsGridSquare.north}\n\nKlick = Base aktualisieren`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '4px',
              color: '#f59e0b',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              animation: 'pulse 2s infinite',
              flexShrink: 0
            }}
          >
            Grid {gpsUtm.zone}/{gpsGridSquare.east}{gpsGridSquare.north}
          </button>
        </>
      )}

      {/* ─── Spacer ─── */}
      <div style={{ flex: 1 }} />

      {/* ─── BLS Status ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '4px',
        background: isConnected ? 'rgba(34,197,94,0.08)' : 'transparent',
        flexShrink: 0
      }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: isConnected ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.borderStrong})`,
          boxShadow: isConnected ? '0 0 4px #22c55e' : 'none',
          flexShrink: 0
        }} />
        <span style={{
          fontSize: '11px',
          fontWeight: 700,
          color: isConnected ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.4 : 0.25})`,
          letterSpacing: '0.5px'
        }}>
          BLS
        </span>
      </div>

      <Sep />

      {/* ─── Time (based on settings) ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={labelStyle}>{settings.taskTimeZone === 'local' ? 'LOC' : 'UTC'}</span>
        <span style={{ ...monoStyle, color: `rgba(${o.c},${o.c},${o.c},${o.on ? 0.95 : 0.85})` }}>
          {settings.taskTimeZone === 'local'
            ? currentTime.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : currentTime.toISOString().substring(11, 19)
          }
        </span>
      </div>

      <Sep />

      {/* ─── NavLine Toggle ─── */}
      {selectedGoal && (
        <button
          onClick={() => updateSettings({ navLineEnabled: !settings.navLineEnabled })}
          title={settings.navLineEnabled ? "Navigationslinie ausblenden" : "Navigationslinie einblenden"}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            padding: 0,
            border: 'none',
            borderRadius: '4px',
            background: settings.navLineEnabled ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
            color: settings.navLineEnabled ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`,
            cursor: 'pointer',
            transition: 'all 0.15s',
            flexShrink: 0,
            marginRight: '4px'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(34, 197, 94, 0.15)'
            e.currentTarget.style.color = settings.navLineEnabled ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.textSec})`
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = settings.navLineEnabled ? 'rgba(34, 197, 94, 0.2)' : 'transparent'
            e.currentTarget.style.color = settings.navLineEnabled ? '#22c55e' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="19" x2="19" y2="5" />
            <circle cx="5" cy="19" r="3" />
            <circle cx="19" cy="5" r="3" />
          </svg>
        </button>
      )}

      {/* ─── Distanzkreis ─── */}
      <div style={{ position: 'relative', flexShrink: 0 }} ref={rangeDropdownRef}>
        <button
          onClick={() => {
            if (rangeCircleRadius) {
              setRangeCircleRadius(null)
              setShowRangeDropdown(false)
            } else {
              setShowRangeDropdown(!showRangeDropdown)
            }
          }}
          title={rangeCircleRadius ? `Distanzkreis ${rangeCircleRadius >= 1000 ? `${rangeCircleRadius / 1000}km` : `${rangeCircleRadius}m`} — Klick zum Entfernen` : 'Distanzkreis anzeigen'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '22px', padding: 0, border: 'none', borderRadius: '4px',
            background: rangeCircleRadius ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
            color: rangeCircleRadius ? '#3b82f6' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`,
            cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0, marginRight: '4px'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'
            e.currentTarget.style.color = rangeCircleRadius ? '#3b82f6' : `rgba(${o.c},${o.c},${o.c},${o.textSec})`
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = rangeCircleRadius ? 'rgba(59, 130, 246, 0.2)' : 'transparent'
            e.currentTarget.style.color = rangeCircleRadius ? '#3b82f6' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </button>

        {/* Dropdown */}
        {showRangeDropdown && (
          <div style={{
            position: 'absolute', bottom: '28px', right: 0,
            background: o.on ? 'rgba(255,255,255,0.97)' : 'rgba(30,30,30,0.95)',
            border: `1px solid rgba(${o.c},${o.c},${o.c},${o.on ? 0.15 : 0.25})`,
            borderRadius: '6px', padding: '4px', zIndex: 9999,
            boxShadow: o.on ? '0 4px 12px rgba(0,0,0,0.15)' : '0 4px 12px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '60px'
          }}>
            {[500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000].map(r => (
              <button key={r} onClick={() => { setRangeCircleRadius(r); setShowRangeDropdown(false) }}
                style={{
                  padding: '4px 8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                  background: rangeCircleRadius === r ? (o.on ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.15)') : 'transparent',
                  color: rangeCircleRadius === r ? '#3b82f6' : `rgba(${o.c},${o.c},${o.c},${o.on ? 0.85 : 0.7})`,
                  fontSize: '11px', fontWeight: 600, fontFamily: 'monospace', textAlign: 'right',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={e => (e.currentTarget.style.background = o.on ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = rangeCircleRadius === r ? (o.on ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.15)') : 'transparent')}
              >
                {`${(r / 1000).toFixed(1).replace('.', ',')}km`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Fullscreen Toggle ─── */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Vollbild beenden (F11)" : "Vollbild (F11)"}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '22px',
          height: '22px',
          padding: 0,
          border: 'none',
          borderRadius: '4px',
          background: isFullscreen ? 'rgba(100, 116, 139, 0.2)' : 'transparent',
          color: isFullscreen ? '#94a3b8' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`,
          cursor: 'pointer',
          transition: 'all 0.15s',
          flexShrink: 0
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(100, 116, 139, 0.15)'
          e.currentTarget.style.color = `rgba(${o.c},${o.c},${o.c},${o.textSec})`
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = isFullscreen ? 'rgba(100, 116, 139, 0.2)' : 'transparent'
          e.currentTarget.style.color = isFullscreen ? '#94a3b8' : `rgba(${o.c},${o.c},${o.c},${o.textDim})`
        }}
      >
        {isFullscreen ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
      </button>
    </div>
  )
}
