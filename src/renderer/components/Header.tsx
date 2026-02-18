import React, { useState, useEffect, useRef } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { ConnectionModal } from './ConnectionModal'
import { TaskSettingsPanel } from './TaskSettingsPanel'
import { FlightWindsPanel } from './FlightWindsPanel'
import { Track3DView } from './Track3DView'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { AdminPanel } from './AdminPanel'
import { ChampionshipPanel } from './ChampionshipPanel'
// TrajectoryPanel wurde in FlightWindsPanel integriert
import { PZDrawPanel } from './PZDrawPanel'
import { RegionDownloadPanel } from './RegionDownloadPanel'

interface HeaderProps {
  onBriefingToggle: () => void
  briefingOpen: boolean
  onDrawToggle: () => void
  drawOpen: boolean
  onTeamToggle: () => void
  teamOpen: boolean
  updateAvailable?: boolean
  onShowUpdate?: () => void
}

export function Header({ onBriefingToggle, briefingOpen, onDrawToggle, drawOpen, onTeamToggle, teamOpen, updateAvailable, onShowUpdate }: HeaderProps) {
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [showTaskSettings, setShowTaskSettings] = useState(false)
  const [showWindsPanel, setShowWindsPanel] = useState(false)
  const {
    isConnected, deviceName, isRecording, startRecording, stopRecording,
    tasks, activeTask, setActiveTask, setSelectedGoal, windLayers, settings,
    track, clearFlightData, recordingStartTime, prohibitedZones, clearProhibitedZones,
    markers, hdgCourseLines, windLines, scoringAreas,
    clearAllMarkers, clearWindLayers, clearAllHdgCourseLines, clearAllWindLines, clearAllScoringAreas,
    pzDrawMode, stopPzDrawMode,
    activeToolPanel, setActiveToolPanel
  } = useFlightStore()
  const teamSession = useTeamStore(s => s.session)
  const teamMemberCount = useTeamStore(s => s.members.length)
  const { user: authUser, logout } = useAuthStore()
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [showChampionshipPanel, setShowChampionshipPanel] = useState(false)
  const [showRegionDownload, setShowRegionDownload] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  // Clear-Optionen
  const [clearTasks, setClearTasks] = useState(true)
  const [clearTrack, setClearTrack] = useState(true)
  const [clearMarkers, setClearMarkers] = useState(true)
  const [clearWind, setClearWind] = useState(true)
  const [clearCourseLines, setClearCourseLines] = useState(true)
  const [clearScoringAreas, setClearScoringAreas] = useState(true)
  const [clearPZAlso, setClearPZAlso] = useState(false)
  const [showStopRecConfirm, setShowStopRecConfirm] = useState(false)
  const [showUnsavedTrackWarning, setShowUnsavedTrackWarning] = useState(false)
  const [showToolsDropdown, setShowToolsDropdown] = useState(false)
  const toolsDropdownRef = useRef<HTMLDivElement>(null)
  const toolsBtnRef = useRef<HTMLButtonElement>(null)
  const [toolsMenuPos, setToolsMenuPos] = useState({ top: 0, left: 0 })

  // State fuer HGT-Warnung
  const [showHgtWarning, setShowHgtWarning] = useState(false)
  const [pendingViewerData, setPendingViewerData] = useState<string | null>(null)

  // Neuer State: Recording-Timer
  const [recElapsed, setRecElapsed] = useState(0)

  // Neuer State: User-Menu Dropdown
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  // Recording elapsed timer
  useEffect(() => {
    if (!isRecording || !recordingStartTime) {
      setRecElapsed(0)
      return
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(recordingStartTime).getTime()) / 1000)
      setRecElapsed(Math.max(0, elapsed))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [isRecording, recordingStartTime])

  // Click-outside fuer User-Menu
  useEffect(() => {
    if (!showUserMenu) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      // Ignore clicks on the dropdown itself or the trigger button
      if (userMenuRef.current?.contains(target)) return
      if (userBtnRef.current?.contains(target)) return
      setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showUserMenu])

  // Click-outside fuer Tools-Dropdown
  useEffect(() => {
    if (!showToolsDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (toolsDropdownRef.current?.contains(target)) return
      if (toolsBtnRef.current?.contains(target)) return
      setShowToolsDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showToolsDropdown])

  // Function to open 3D track in external browser
  const open3DTrackInBrowser = async () => {
    if (track.length === 0) return

    const trackData = track.map(point => ({
      lat: point.position.latitude,
      lon: point.position.longitude,
      alt: point.position.altitude,
      timestamp: point.timestamp,
      heading: point.heading || 0,
      speed: point.speed || 0,
      vario: point.verticalSpeed || 0
    }))

    const goalData = tasks.flatMap(task =>
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

    if (window.ntaAPI?.elevation) {
      const firstPoint = trackData[0]
      const elev = await window.ntaAPI.elevation.getElevation(firstPoint.lat, firstPoint.lon)
      if (elev === null) {
        setPendingViewerData(viewerData)
        setShowHgtWarning(true)
        return
      }
    }

    openViewer(viewerData)
  }

  const openViewer = (viewerData: string) => {
    const viewerUrl = `track-viewer-3d.html`
    if (window.ntaAPI?.openExternal) {
      window.ntaAPI.openExternal(viewerUrl, viewerData)
    } else {
      localStorage.setItem('nta_track_data', viewerData)
      window.open(viewerUrl, '_blank')
    }
  }

  // Helper: Elapsed time formatieren
  const formatElapsed = (s: number): string => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  // ─── Skalierung ───────────────────────────────────────────
  const headerHeight = settings.headerHeight ?? 60
  const scale = headerHeight / 60
  const iconSize = Math.round(18 * scale)
  const showLabels = scale >= 0.75

  // ─── Separator ────────────────────────────────────────────
  const Separator = () => (
    <div style={{
      width: '1px',
      height: `${Math.round(headerHeight * 0.5)}px`,
      background: 'rgba(255,255,255,0.08)',
      flexShrink: 0,
      margin: `0 ${Math.round(4 * scale)}px`
    }} />
  )

  // ─── Badge ────────────────────────────────────────────────
  const badgeSize = Math.round(14 * scale)
  const Badge = ({ count, color }: { count: number; color: string }) => (
    <span style={{
      position: 'absolute',
      top: `${Math.round(-2 * scale)}px`,
      right: `${Math.round(-2 * scale)}px`,
      background: color,
      color: '#fff',
      fontSize: `${Math.round(8 * scale)}px`,
      fontWeight: 700,
      minWidth: `${badgeSize}px`,
      height: `${badgeSize}px`,
      borderRadius: '999px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `0 ${Math.round(3 * scale)}px`,
      lineHeight: 1,
      zIndex: 1
    }}>
      {count}
    </span>
  )

  // ─── Typ A: Panel-Toggle Style ────────────────────────────
  const toggleStyle = (active: boolean, accent: string): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${Math.round(2 * scale)}px`,
    width: `${Math.round(50 * scale)}px`,
    height: `${Math.round(headerHeight * 0.82)}px`,
    padding: 0,
    border: 'none',
    borderRadius: `${Math.round(4 * scale)}px`,
    background: active ? `${accent}18` : 'transparent',
    color: active ? accent : 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.15s',
    fontSize: `${Math.round(11 * scale)}px`,
    fontWeight: 500,
    flexShrink: 0,
    borderBottom: active
      ? `${Math.max(2, Math.round(3 * scale))}px solid ${accent}`
      : `${Math.max(2, Math.round(3 * scale))}px solid transparent`
  })

  // ─── Dropdown Item Style ─────────────────────────────────
  const dropdownItem: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: `${Math.round(8 * scale)}px`,
    width: '100%',
    padding: `${Math.round(10 * scale)}px ${Math.round(14 * scale)}px`,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    fontSize: `${Math.round(13 * scale)}px`,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s'
  }

  return (
    <>
    <header style={{
      height: `${headerHeight}px`,
      minHeight: `${headerHeight}px`,
      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      padding: `0 ${Math.round(8 * scale)}px`,
      gap: `${Math.round(4 * scale)}px`,
      overflow: 'hidden'
    }}>

      {/* ═══ Zone 1: Logo ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(4 * scale)}px`, flexShrink: 0 }}>
        <img
          src="nta-logo.png"
          alt="NTA"
          style={{
            height: `${Math.round(28 * scale)}px`,
            objectFit: 'contain'
          }}
          draggable={false}
        />
        {showLabels && (
          <span style={{ fontSize: `${Math.round(14 * scale)}px`, fontWeight: 700, color: '#fff', letterSpacing: '0.5px' }}>NTA</span>
        )}
      </div>

      <Separator />

      {/* ═══ Zone 2: Panel-Toggles (Typ A) ═══ */}
      <div style={{ display: 'flex', gap: `${Math.round(2 * scale)}px`, flexShrink: 0 }}>
        {/* Briefing */}
        <button onClick={onBriefingToggle} title="Briefing Panel" style={toggleStyle(briefingOpen, '#22c55e')}>
          <svg width={iconSize} height={iconSize} viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
          </svg>
          {showLabels && <span>Brief</span>}
        </button>

        {/* Draw */}
        <button onClick={onDrawToggle} title="Zeichenwerkzeuge" style={toggleStyle(drawOpen, '#22c55e')}>
          <svg width={iconSize} height={iconSize} viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          {showLabels && <span>Draw</span>}
        </button>

        {/* Wind */}
        <button onClick={() => setShowWindsPanel(!showWindsPanel)} title="Windschichten" style={toggleStyle(showWindsPanel, '#3b82f6')}>
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
          </svg>
          {showLabels && <span>Wind</span>}
        </button>

        {/* Tools Dropdown */}
        <button
          ref={toolsBtnRef}
          onClick={() => {
            if (!showToolsDropdown && toolsBtnRef.current) {
              const rect = toolsBtnRef.current.getBoundingClientRect()
              setToolsMenuPos({ top: rect.bottom + 4, left: rect.left })
            }
            setShowToolsDropdown(!showToolsDropdown)
          }}
          title="Werkzeuge"
          style={toggleStyle(activeToolPanel !== null, '#06b6d4')}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          {showLabels && <span>Tools</span>}
        </button>
      </div>

      <Separator />

      {/* ═══ Zone 3: Task-Strip (flex:1, zentriert) ═══ */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        {tasks.length > 0 && (
          <div style={{
            display: 'flex',
            gap: `${Math.round(2 * scale)}px`,
            alignItems: 'center',
            padding: `${Math.round(3 * scale)}px ${Math.round(6 * scale)}px`,
            background: 'rgba(0,0,0,0.3)',
            borderRadius: `${Math.round(6 * scale)}px`,
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',        // Firefox
            msOverflowStyle: 'none' as any // IE/Edge
          }}>
            {tasks.map((task) => {
              const isActive = activeTask?.id === task.id
              const taskColor = task.markerColor || '#3b82f6'
              return (
                <button
                  key={task.id}
                  onClick={() => {
                    if (isActive) {
                      setActiveTask(null)
                      setSelectedGoal(null)
                    } else {
                      setActiveTask(task)
                      if (task.goals[0]) {
                        setSelectedGoal(task.goals[0])
                      }
                    }
                  }}
                  title={task.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: `${Math.round(4 * scale)}px`,
                    padding: `${Math.round(3 * scale)}px ${Math.round(8 * scale)}px`,
                    borderRadius: `${Math.round(4 * scale)}px`,
                    border: 'none',
                    borderLeft: isActive ? 'none' : `3px solid ${taskColor}`,
                    background: isActive ? taskColor : 'rgba(255,255,255,0.06)',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.75)',
                    fontSize: `${Math.round(12 * scale)}px`,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                    boxShadow: isActive ? `0 0 8px ${taskColor}40` : 'none'
                  }}
                >
                  {task.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* ═══ Zone 4: Recording ═══ */}
      <button
        onClick={() => {
          if (isRecording) {
            setShowStopRecConfirm(true)
          } else if (track.length > 0) {
            setShowUnsavedTrackWarning(true)
          } else {
            startRecording()
          }
        }}
        title={isRecording ? 'Aufzeichnung beenden' : 'Aufzeichnung starten'}
        style={toggleStyle(isRecording, '#ef4444')}
      >
        <span style={{
          width: Math.round(8 * scale),
          height: Math.round(8 * scale),
          borderRadius: isRecording ? '2px' : '50%',
          background: isRecording ? '#ef4444' : 'rgba(239,68,68,0.4)',
          animation: isRecording ? 'pulse 1.5s infinite' : 'none',
          flexShrink: 0
        }} />
        {showLabels && (
          <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.5px' }}>
            {isRecording ? formatElapsed(recElapsed) : 'REC'}
          </span>
        )}
      </button>

      <Separator />

      {/* ═══ Zone 5: Tool-Actions ═══ */}
      <div style={{ display: 'flex', gap: `${Math.round(2 * scale)}px`, flexShrink: 0 }}>
        {/* Team */}
        <button
          onClick={onTeamToggle}
          title="Live Team Tracking"
          style={{
            ...toggleStyle(teamOpen, teamSession ? '#22c55e' : '#3b82f6'),
            color: teamOpen ? '#3b82f6' : teamSession ? '#22c55e' : 'rgba(255,255,255,0.45)'
          }}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {showLabels && <span>Team</span>}
          {teamSession && teamMemberCount > 0 && <Badge count={teamMemberCount} color="#22c55e" />}
        </button>

        {/* Meisterschaften */}
        <button
          onClick={() => setShowChampionshipPanel(true)}
          title="Meisterschaften"
          style={toggleStyle(showChampionshipPanel, '#f59e0b')}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </svg>
          {showLabels && <span>MS</span>}
        </button>
      </div>

      <Separator />

      {/* ═══ Zone 6: Clear (isoliert, destruktiv) ═══ */}
      <button
        onClick={() => setShowClearConfirm(true)}
        title="Alle Fahrt-Daten loeschen"
        style={{
          ...toggleStyle(false, '#ef4444'),
          opacity: 0.7
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {showLabels && <span>Clear</span>}
      </button>

      <Separator />

      {/* ═══ Zone 7: BLS Connection Status ═══ */}
      <button
        onClick={() => setShowConnectionModal(true)}
        title={isConnected ? `BLS: ${deviceName || 'Verbunden'}` : 'BLS verbinden'}
        style={toggleStyle(isConnected, '#22c55e')}
      >
        <span style={{
          width: Math.round(8 * scale),
          height: Math.round(8 * scale),
          borderRadius: '50%',
          background: isConnected ? '#22c55e' : 'rgba(255,255,255,0.2)',
          boxShadow: isConnected ? '0 0 6px #22c55e' : 'none',
          flexShrink: 0
        }} />
        {showLabels && <span>BLS</span>}
      </button>

      <Separator />

      {/* ═══ Zone 8: User Menu + Settings ═══ */}
      <div style={{ display: 'flex', gap: `${Math.round(3 * scale)}px`, alignItems: 'center', flexShrink: 0 }}>
        {/* User Dropdown */}
        {authUser && (
          <button
            ref={userBtnRef}
            onClick={() => {
              if (!showUserMenu && userBtnRef.current) {
                const rect = userBtnRef.current.getBoundingClientRect()
                setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
              }
              setShowUserMenu(!showUserMenu)
            }}
            title={authUser.display_name || authUser.username}
            style={toggleStyle(showUserMenu, authUser.is_admin ? '#a855f7' : '#3b82f6')}
          >
            {/* Avatar */}
            <span style={{
              width: Math.round(iconSize * 1.2),
              height: Math.round(iconSize * 1.2),
              borderRadius: '50%',
              background: authUser.is_admin ? '#a855f7' : '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: `${Math.round(11 * scale)}px`,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0
            }}>
              {(authUser.display_name || authUser.username || '?')[0].toUpperCase()}
            </span>
            {showLabels && <span>{(authUser.display_name || authUser.username || '').split(' ')[0]}</span>}
          </button>
        )}

        {/* Settings */}
        <button
          onClick={() => setShowTaskSettings(true)}
          title="Einstellungen"
          style={toggleStyle(showTaskSettings, '#94a3b8')}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          {showLabels && <span style={{ fontSize: `${Math.round(11 * scale)}px` }}>Settings</span>}
        </button>
      </div>

      {/* ═══ Modals & Panels (unveraendert) ═══ */}
      {showConnectionModal && (
        <ConnectionModal onClose={() => setShowConnectionModal(false)} />
      )}

      <TaskSettingsPanel
        isOpen={showTaskSettings}
        onClose={() => setShowTaskSettings(false)}
      />

      <FlightWindsPanel
        isOpen={showWindsPanel}
        onClose={() => setShowWindsPanel(false)}
        selectedWindLayer={null}
        onSelectWindLayer={() => {}}
      />

      {showAdminPanel && authUser?.is_admin && (
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
      )}

      {showRegionDownload && authUser?.is_admin && (
        <RegionDownloadPanel onClose={() => setShowRegionDownload(false)} />
      )}

      {showChampionshipPanel && (
        <ChampionshipPanel onClose={() => setShowChampionshipPanel(false)} />
      )}

      {/* PZ Zeichnen Panel - erscheint wenn pzDrawMode aktiv */}
      {pzDrawMode && (
        <PZDrawPanel onClose={() => stopPzDrawMode()} />
      )}

      {/* Bestaetigung: Aufzeichnung beenden */}
      {showStopRecConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowStopRecConfirm(false)}>
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '24px',
              width: '360px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              textAlign: 'center'
            }}
            onClick={e => e.stopPropagation()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ marginBottom: '12px' }}>
              <circle cx="12" cy="12" r="10" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="#ef4444" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
              Aufzeichnung beenden?
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px', lineHeight: 1.5 }}>
              Die GPS-Aufzeichnung wird gestoppt. Der bisherige Track bleibt erhalten.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowStopRecConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => { stopRecording(); setShowStopRecConfirm(false) }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Aufzeichnung beenden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warnung: Ungespeicherter Track */}
      {showUnsavedTrackWarning && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowUnsavedTrackWarning(false)}>
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              padding: '24px',
              width: '400px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              textAlign: 'center'
            }}
            onClick={e => e.stopPropagation()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" style={{ marginBottom: '12px' }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
              Ungespeicherter Track vorhanden
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px', lineHeight: 1.5 }}>
              Es gibt einen Track mit <strong style={{ color: '#f59e0b' }}>{track.length} Punkten</strong>, der noch nicht gespeichert wurde.
              Wenn du eine neue Aufzeichnung startest, wird der aktuelle Track überschrieben.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowUnsavedTrackWarning(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  clearFlightData()
                  startRecording()
                  setShowUnsavedTrackWarning(false)
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#f59e0b',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Trotzdem starten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bestaetigung: Daten loeschen */}
      {showClearConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowClearConfirm(false)}>
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '24px',
              width: '400px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ marginBottom: '12px', display: 'block', margin: '0 auto 12px' }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px', textAlign: 'center' }}>
              Daten loeschen
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px', lineHeight: 1.5, textAlign: 'center' }}>
              Waehle aus, welche Daten geloescht werden sollen:
            </div>

            {/* Checkboxen für alle Kategorien */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              {/* Tasks */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearTasks ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearTasks ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearTasks}
                  onChange={e => setClearTasks(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearTasks ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Tasks
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {tasks.length}
                </span>
              </label>

              {/* Track */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearTrack ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearTrack ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearTrack}
                  onChange={e => setClearTrack(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearTrack ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Track
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {track.length} Punkte
                </span>
              </label>

              {/* Marker */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearMarkers ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearMarkers ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearMarkers}
                  onChange={e => setClearMarkers(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearMarkers ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Marker
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {markers.length}
                </span>
              </label>

              {/* Wind */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearWind ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearWind ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearWind}
                  onChange={e => setClearWind(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearWind ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Windschichten & Windlinien
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {windLayers.length} + {windLines.length}
                </span>
              </label>

              {/* Kurslinien */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearCourseLines ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearCourseLines ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearCourseLines}
                  onChange={e => setClearCourseLines(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearCourseLines ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Kurslinien
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {hdgCourseLines.length}
                </span>
              </label>

              {/* Scoring Areas */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: clearScoringAreas ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${clearScoringAreas ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}>
                <input
                  type="checkbox"
                  checked={clearScoringAreas}
                  onChange={e => setClearScoringAreas(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                />
                <span style={{ flex: 1, fontSize: '12px', color: clearScoringAreas ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  Scoring Areas
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                  {scoringAreas.length}
                </span>
              </label>

              {/* PZ - nur wenn vorhanden */}
              {prohibitedZones.length > 0 && (
                <div>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    background: clearPZAlso ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${clearPZAlso ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}>
                    <input
                      type="checkbox"
                      checked={clearPZAlso}
                      onChange={e => setClearPZAlso(e.target.checked)}
                      style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                    />
                    <span style={{ flex: 1, fontSize: '12px', color: clearPZAlso ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                      Sperrgebiete (PZ)
                    </span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                      {prohibitedZones.length}
                    </span>
                  </label>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '4px', marginLeft: '12px' }}>
                    ℹ️ Nur lokale Anzeige - bleiben in der Meisterschaft gespeichert
                  </div>
                </div>
              )}
            </div>

            {/* Alle auswählen / Keine auswählen */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                onClick={() => {
                  setClearTasks(true)
                  setClearTrack(true)
                  setClearMarkers(true)
                  setClearWind(true)
                  setClearCourseLines(true)
                  setClearScoringAreas(true)
                  setClearPZAlso(true)
                }}
                style={{
                  flex: 1,
                  padding: '6px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Alle auswaehlen
              </button>
              <button
                onClick={() => {
                  setClearTasks(false)
                  setClearTrack(false)
                  setClearMarkers(false)
                  setClearWind(false)
                  setClearCourseLines(false)
                  setClearScoringAreas(false)
                  setClearPZAlso(false)
                }}
                style={{
                  flex: 1,
                  padding: '6px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Keine auswaehlen
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  // Selektives Löschen basierend auf Checkboxen
                  if (clearTasks || clearTrack || clearMarkers) {
                    // Wenn Tasks, Track oder Marker gelöscht werden, nutze clearFlightData
                    // aber das löscht alles - wir müssen individuell löschen
                    // Temporäre Lösung: clearFlightData löscht alles außer was nicht ausgewählt ist
                    // Besser: Individuelle Actions
                    clearFlightData()
                  } else {
                    // Nur einzelne Kategorien löschen
                    if (clearMarkers) clearAllMarkers()
                    if (clearWind) {
                      clearWindLayers()
                      clearAllWindLines()
                    }
                    if (clearCourseLines) clearAllHdgCourseLines()
                    if (clearScoringAreas) clearAllScoringAreas()
                  }
                  if (clearPZAlso) clearProhibitedZones()
                  setShowClearConfirm(false)
                }}
                disabled={!clearTasks && !clearTrack && !clearMarkers && !clearWind && !clearCourseLines && !clearScoringAreas && !clearPZAlso}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: (!clearTasks && !clearTrack && !clearMarkers && !clearWind && !clearCourseLines && !clearScoringAreas && !clearPZAlso) ? 'rgba(239, 68, 68, 0.3)' : '#ef4444',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: (!clearTasks && !clearTrack && !clearMarkers && !clearWind && !clearCourseLines && !clearScoringAreas && !clearPZAlso) ? 'not-allowed' : 'pointer',
                  opacity: (!clearTasks && !clearTrack && !clearMarkers && !clearWind && !clearCourseLines && !clearScoringAreas && !clearPZAlso) ? 0.5 : 1
                }}
              >
                Ausgewaehlte loeschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HGT-Warnung */}
      {showHgtWarning && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }} onClick={() => setShowHgtWarning(false)}>
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              padding: '24px',
              width: '400px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              textAlign: 'center'
            }}
            onClick={e => e.stopPropagation()}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" style={{ marginBottom: '12px' }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
              Keine HGT-Hoehenmodelldatei
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '20px', lineHeight: 1.6 }}>
              Fuer den Startpunkt des Tracks ist keine HGT-Datei geladen.
              Die 3D-Darstellung wird ungenau sein - der Track koennte ueber oder unter dem Boden schweben.
              <br /><br />
              HGT-Dateien kannst du in der StatusBar ueber den <strong style={{ color: '#22c55e' }}>HGT</strong>-Button importieren.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowHgtWarning(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  setShowHgtWarning(false)
                  if (pendingViewerData) {
                    openViewer(pendingViewerData)
                    setPendingViewerData(null)
                  }
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#f59e0b',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Trotzdem oeffnen
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

    </header>

    {/* User Dropdown - position:fixed, ausserhalb header overflow:hidden */}
    {showUserMenu && authUser && (
      <div
        ref={userMenuRef}
        style={{
          position: 'fixed',
          top: `${menuPos.top}px`,
          right: `${menuPos.right}px`,
          minWidth: `${Math.round(200 * scale)}px`,
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: `${Math.round(8 * scale)}px`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          zIndex: 10001,
          padding: `${Math.round(4 * scale)}px 0`,
          overflow: 'hidden'
        }}
      >
        {/* User Name Header */}
        <div style={{
          padding: `${Math.round(10 * scale)}px ${Math.round(14 * scale)}px`,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontSize: `${Math.round(13 * scale)}px`,
          color: 'rgba(255,255,255,0.4)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {authUser.display_name || authUser.username}
        </div>

        {/* Admin */}
        {authUser.is_admin && (
          <>
            <button
              onClick={() => { setShowAdminPanel(true); setShowUserMenu(false) }}
              style={{ ...dropdownItem, color: '#a855f7' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Benutzer
            </button>
            <button
              onClick={() => { setShowRegionDownload(true); setShowUserMenu(false) }}
              style={{ ...dropdownItem, color: '#22c55e' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Region Download
            </button>
          </>
        )}

        {/* Update */}
        {updateAvailable && onShowUpdate && (
          <button
            onClick={() => { onShowUpdate(); setShowUserMenu(false) }}
            style={{ ...dropdownItem, color: '#3b82f6' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Update installieren
          </button>
        )}

        {/* Logout */}
        <button
          onClick={() => { logout(); setShowUserMenu(false) }}
          style={{ ...dropdownItem, color: '#ef4444' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    )}

    {/* Tools Dropdown - position:fixed, ausserhalb header overflow:hidden */}
    {showToolsDropdown && (
      <div
        ref={toolsDropdownRef}
        style={{
          position: 'fixed',
          top: `${toolsMenuPos.top}px`,
          left: `${toolsMenuPos.left}px`,
          minWidth: `${Math.round(180 * scale)}px`,
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: `${Math.round(8 * scale)}px`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          zIndex: 10001,
          padding: `${Math.round(4 * scale)}px 0`,
          overflow: 'hidden'
        }}
      >
        {/* Marker Drop */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'marker' ? null : 'marker'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'marker' ? '#ef4444' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Marker Drop
        </button>

        {/* Steigpunkt (FLY) */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'fly' ? null : 'fly'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'fly' ? '#22c55e' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          PDG/FON
        </button>

        {/* Landeprognose (LND) */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'lnd' ? null : 'lnd'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'lnd' ? '#f59e0b' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          Landeprognose
        </button>

        {/* Land Run (LRN) */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'lrn' ? null : 'lrn'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'lrn' ? '#3b82f6' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          Land Run
        </button>

        {/* APT (Altitude Profile) */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'apt' ? null : 'apt'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'apt' ? '#06b6d4' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Altitude Profile
        </button>
        {/* ANG (Angle Berechnung) */}
        <button
          onClick={() => { setActiveToolPanel(activeToolPanel === 'ang' ? null : 'ang'); setShowToolsDropdown(false) }}
          style={{ ...dropdownItem, color: activeToolPanel === 'ang' ? '#a855f7' : 'rgba(255,255,255,0.7)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width={Math.round(16 * scale)} height={Math.round(16 * scale)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 20 4 4 20 20" />
            <path d="M4 16 Q10 16 12 20" />
          </svg>
          ANG Berechnung
        </button>
      </div>
    )}
    </>
  )
}
