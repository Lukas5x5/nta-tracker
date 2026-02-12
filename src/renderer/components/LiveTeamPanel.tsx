import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTeamStore } from '../stores/teamStore'
import { useFlightStore } from '../stores/flightStore'
import { useAuthStore } from '../stores/authStore'
import { usePanelDrag } from '../hooks/usePanelDrag'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { startPositionBroadcasting, stopPositionBroadcasting } from '../services/positionBroadcaster'
import { TeamConnectionStatus } from '../../shared/types'
import { GroundWindReports } from './GroundWindReports'

interface LiveTeamPanelProps {
  isOpen: boolean
  onClose: () => void
}

// Vordefinierte Schnellnachrichten
const QUICK_MESSAGES = [
  'Guter Startplatz gefunden',
  'Bin gelandet',
  'Brauche Hilfe',
  'Warte auf euch',
]

export function LiveTeamPanel({ isOpen, onClose }: LiveTeamPanelProps) {
  const {
    session, myMemberId, members, connectionStatus, error, queue,
    hiddenMembers, createTeam, joinTeam, leaveTeam,
    toggleMemberVisibility, sendMessage
  } = useTeamStore()

  const { settings } = useFlightStore()
  const authUser = useAuthStore(s => s.user)

  // Callsign ist der Anzeigename des eingeloggten Benutzers (nicht editierbar)
  const callsign = authUser?.display_name || authUser?.username || ''

  // UI State
  const [teamName, setTeamName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu')
  const [isLoading, setIsLoading] = useState(false)
  const [showJoinCode, setShowJoinCode] = useState(true)
  const [showQuickMessages, setShowQuickMessages] = useState(false)
  const [showWindReports, setShowWindReports] = useState(false)
  const [showCrew, setShowCrew] = useState(false)
  const [activeTab, setActiveTab] = useState<'pilots' | 'crew'>('pilots')
  const [unreadWindReports, setUnreadWindReports] = useState(0)

  // Chat State
  const [showChat, setShowChat] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [chatTarget, setChatTarget] = useState<string | null>(null) // null = All Chat
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const { messages } = useTeamStore()

  // Dragging
  const [position, setPosition] = useState({ x: 60, y: 80 })
  const panelRef = useRef<HTMLDivElement>(null)

  // Position-Change Handler für Drag
  const handlePositionChange = useCallback((pos: { x: number; y: number }) => {
    setPosition(pos)
  }, [])

  // Panel Drag Hook (Mouse + Touch)
  const { isDragging, handleMouseDown, handleTouchStart } = usePanelDrag({
    position,
    onPositionChange: handlePositionChange
  })

  // Messages
  const [sendingMsg, setSendingMsg] = useState(false)

  // Skalierung
  const scale = settings.teamPanelScale ?? 1

  // Position Broadcasting starten/stoppen wenn Session sich ändert
  useEffect(() => {
    if (session) {
      startPositionBroadcasting()
    } else {
      stopPositionBroadcasting()
    }
    return () => stopPositionBroadcasting()
  }, [session?.id])

  const handleSendMessage = async (msg: string, targetId?: string | null) => {
    setSendingMsg(true)
    await sendMessage(msg, targetId)
    setSendingMsg(false)
  }

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current && showChat) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [messages, showChat])

  // Ref für showWindReports damit der Realtime-Channel stabil bleibt
  const showWindReportsRef = useRef(showWindReports)
  showWindReportsRef.current = showWindReports

  // Wind Reports: Unread-Badge Realtime-Subscription (stabil, nur von session.id abhängig)
  useEffect(() => {
    if (!session) {
      setUnreadWindReports(0)
      return
    }

    const teamId = session.id
    const channel = supabase
      .channel(`wind-badge-${teamId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ground_wind_reports'
        },
        (payload) => {
          const record = payload.new as any
          if (record?.team_id !== teamId) return
          // Nur Badge erhöhen wenn Wind-Panel geschlossen ist
          if (!showWindReportsRef.current) {
            setUnreadWindReports(prev => prev + 1)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.id])

  // Unread-Counter zurücksetzen wenn Wind-Panel geöffnet wird
  useEffect(() => {
    if (showWindReports) {
      setUnreadWindReports(0)
    }
  }, [showWindReports])

  if (!isOpen) return null

  const handleCreate = async () => {
    if (!callsign.trim()) return
    setIsLoading(true)
    const code = await createTeam(callsign.trim(), teamName.trim() || undefined)
    setIsLoading(false)
    if (code) setMode('menu')
  }

  const handleJoin = async () => {
    if (!callsign.trim() || !joinCode.trim()) return
    setIsLoading(true)
    const success = await joinTeam(joinCode.trim(), callsign.trim())
    setIsLoading(false)
    if (success) setMode('menu')
  }

  const handleLeave = async () => {
    stopPositionBroadcasting()
    await leaveTeam()
    setMode('menu')
  }

  // Status-Badge Farbe
  const statusColor = {
    [TeamConnectionStatus.Connected]: '#22c55e',
    [TeamConnectionStatus.Connecting]: '#f59e0b',
    [TeamConnectionStatus.Syncing]: '#3b82f6',
    [TeamConnectionStatus.Offline]: '#ef4444',
    [TeamConnectionStatus.Error]: '#ef4444',
    [TeamConnectionStatus.Disconnected]: '#6b7280',
  }[connectionStatus]

  const statusText = {
    [TeamConnectionStatus.Connected]: 'Connected',
    [TeamConnectionStatus.Connecting]: 'Verbinden...',
    [TeamConnectionStatus.Syncing]: `Syncing (${queue.length})`,
    [TeamConnectionStatus.Offline]: `Offline${queue.length > 0 ? ` (${queue.length} queued)` : ''}`,
    [TeamConnectionStatus.Error]: 'Fehler',
    [TeamConnectionStatus.Disconnected]: 'Getrennt',
  }[connectionStatus]

  const configured = isSupabaseConfigured()

  return (
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000,
        width: `${280 * scale}px`,
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(12px)',
        borderRadius: `${12 * scale}px`,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        color: '#fff',
        fontSize: `${12 * scale}px`,
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${10 * scale}px ${14 * scale}px`,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        cursor: 'grab'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: `${8 * scale}px` }}>
          <svg width={16 * scale} height={16 * scale} viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: `${13 * scale}px` }}>Live Team</span>
          {session && (
            <span style={{
              background: statusColor,
              width: `${8 * scale}px`,
              height: `${8 * scale}px`,
              borderRadius: '50%',
              boxShadow: `0 0 6px ${statusColor}`
            }} />
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: `${16 * scale}px`,
            padding: `${2 * scale}px`
          }}
        >
          x
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: `${12 * scale}px ${14 * scale}px` }}>
        {!configured ? (
          /* Supabase nicht konfiguriert */
          <div style={{
            padding: `${12 * scale}px`,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: `${8 * scale}px`,
            fontSize: `${11 * scale}px`,
            color: 'rgba(255,255,255,0.8)',
            lineHeight: 1.5
          }}>
            <div style={{ fontWeight: 600, marginBottom: `${6 * scale}px`, color: '#ef4444' }}>
              Supabase nicht konfiguriert
            </div>
            <div>1. Erstelle ein Projekt auf supabase.com</div>
            <div>2. Führe docs/supabase-schema.sql aus</div>
            <div>3. Trage URL + Key in src/renderer/lib/supabase.ts ein</div>
          </div>
        ) : !session ? (
          /* Kein aktives Team */
          <>
            {mode === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: `${8 * scale}px` }}>
                {/* Callsign Anzeige (nicht editierbar - aus Einstellungen) */}
                <div>
                  <label style={{ fontSize: `${10 * scale}px`, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: `${4 * scale}px` }}>
                    Callsign / Pilotenname
                  </label>
                  {callsign.trim() ? (
                    <div style={{
                      padding: `${8 * scale}px ${10 * scale}px`,
                      background: 'rgba(59, 130, 246, 0.1)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      borderRadius: `${6 * scale}px`,
                      color: '#fff',
                      fontSize: `${13 * scale}px`,
                      fontWeight: 600
                    }}>
                      {callsign}
                    </div>
                  ) : (
                    <div style={{
                      padding: `${8 * scale}px ${10 * scale}px`,
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.2)',
                      borderRadius: `${6 * scale}px`,
                      color: '#f59e0b',
                      fontSize: `${11 * scale}px`
                    }}>
                      Bitte einloggen um Team-Funktion zu nutzen
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setMode('create')}
                  disabled={!callsign.trim()}
                  style={{
                    width: '100%',
                    padding: `${10 * scale}px`,
                    background: callsign.trim() ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.08)',
                    color: callsign.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    borderRadius: `${6 * scale}px`,
                    fontSize: `${12 * scale}px`,
                    fontWeight: 600,
                    cursor: callsign.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  Team erstellen
                </button>

                <button
                  onClick={() => setMode('join')}
                  disabled={!callsign.trim()}
                  style={{
                    width: '100%',
                    padding: `${10 * scale}px`,
                    background: callsign.trim() ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.08)',
                    color: callsign.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    borderRadius: `${6 * scale}px`,
                    fontSize: `${12 * scale}px`,
                    fontWeight: 600,
                    cursor: callsign.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  Team beitreten
                </button>
              </div>
            )}

            {mode === 'create' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: `${8 * scale}px` }}>
                <div>
                  <label style={{ fontSize: `${10 * scale}px`, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: `${4 * scale}px` }}>
                    Teamname (optional)
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="z.B. Team Austria"
                    maxLength={50}
                    style={{
                      width: '100%',
                      padding: `${8 * scale}px ${10 * scale}px`,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: `${6 * scale}px`,
                      color: '#fff',
                      fontSize: `${12 * scale}px`,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: `${6 * scale}px` }}>
                  <button
                    onClick={() => setMode('menu')}
                    style={{
                      flex: 1,
                      padding: `${8 * scale}px`,
                      background: 'rgba(255,255,255,0.08)',
                      color: 'rgba(255,255,255,0.7)',
                      border: 'none',
                      borderRadius: `${6 * scale}px`,
                      fontSize: `${11 * scale}px`,
                      cursor: 'pointer'
                    }}
                  >
                    Zurück
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={isLoading}
                    style={{
                      flex: 2,
                      padding: `${8 * scale}px`,
                      background: isLoading ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: `${6 * scale}px`,
                      fontSize: `${11 * scale}px`,
                      fontWeight: 600,
                      cursor: isLoading ? 'wait' : 'pointer'
                    }}
                  >
                    {isLoading ? 'Erstellen...' : 'Erstellen'}
                  </button>
                </div>
              </div>
            )}

            {mode === 'join' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: `${8 * scale}px` }}>
                <div>
                  <label style={{ fontSize: `${10 * scale}px`, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: `${4 * scale}px` }}>
                    Team-Code (6 Stellen)
                  </label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    maxLength={6}
                    style={{
                      width: '100%',
                      padding: `${10 * scale}px`,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: `${6 * scale}px`,
                      color: '#fff',
                      fontSize: `${18 * scale}px`,
                      fontFamily: 'monospace',
                      textAlign: 'center',
                      letterSpacing: `${6 * scale}px`,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: `${6 * scale}px` }}>
                  <button
                    onClick={() => setMode('menu')}
                    style={{
                      flex: 1,
                      padding: `${8 * scale}px`,
                      background: 'rgba(255,255,255,0.08)',
                      color: 'rgba(255,255,255,0.7)',
                      border: 'none',
                      borderRadius: `${6 * scale}px`,
                      fontSize: `${11 * scale}px`,
                      cursor: 'pointer'
                    }}
                  >
                    Zurück
                  </button>
                  <button
                    onClick={handleJoin}
                    disabled={isLoading || joinCode.length !== 6}
                    style={{
                      flex: 2,
                      padding: `${8 * scale}px`,
                      background: (isLoading || joinCode.length !== 6)
                        ? 'rgba(255,255,255,0.08)'
                        : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      color: (isLoading || joinCode.length !== 6) ? 'rgba(255,255,255,0.3)' : '#fff',
                      border: 'none',
                      borderRadius: `${6 * scale}px`,
                      fontSize: `${11 * scale}px`,
                      fontWeight: 600,
                      cursor: (isLoading || joinCode.length !== 6) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isLoading ? 'Beitreten...' : 'Beitreten'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div style={{
                marginTop: `${8 * scale}px`,
                padding: `${8 * scale}px`,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: `${6 * scale}px`,
                fontSize: `${10 * scale}px`,
                color: '#f87171'
              }}>
                {error}
              </div>
            )}
          </>
        ) : (
          /* Aktives Team */
          <>
            {/* Team Info - kompakter */}
            <div style={{
              padding: `${8 * scale}px ${10 * scale}px`,
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
              borderRadius: `${8 * scale}px`,
              marginBottom: `${8 * scale}px`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ fontWeight: 600, fontSize: `${12 * scale}px` }}>{session.name || 'Live Team'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: `${6 * scale}px` }}>
                {showJoinCode && (
                  <div style={{
                    background: 'rgba(34, 197, 94, 0.2)',
                    padding: `${4 * scale}px ${8 * scale}px`,
                    borderRadius: `${4 * scale}px`,
                    fontFamily: 'monospace',
                    fontSize: `${13 * scale}px`,
                    fontWeight: 700,
                    letterSpacing: `${1.5 * scale}px`,
                    color: '#22c55e'
                  }}>
                    {session.joinCode}
                  </div>
                )}
                <button
                  onClick={() => setShowJoinCode(!showJoinCode)}
                  title={showJoinCode ? 'Code ausblenden' : 'Code einblenden'}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: `${4 * scale}px`,
                    padding: `${4 * scale}px`,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <svg width={12 * scale} height={12 * scale} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                    {showJoinCode ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs: Piloten / Crew */}
            {(() => {
              // Debug: Rollen aller Members loggen
              console.log('[LiveTeamPanel] Members roles:', members.map(m => `${m.callsign}: role=${m.role}`))
              const pilotMembers = members.filter(m => (m.role || 'pilot') === 'pilot')
              const crewMembers = members.filter(m => m.role === 'crew')

              const renderMember = (member: typeof members[0]) => {
                const isMe = member.id === myMemberId
                const isHidden = hiddenMembers.has(member.id)
                return (
                  <div
                    key={member.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: `${8 * scale}px`,
                      padding: `${6 * scale}px ${8 * scale}px`,
                      background: isMe ? 'rgba(59, 130, 246, 0.1)' : isHidden ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)',
                      borderRadius: `${6 * scale}px`,
                      marginBottom: `${4 * scale}px`,
                      border: isMe ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                      opacity: isHidden ? 0.4 : 1
                    }}
                  >
                    {!isMe ? (
                      <button
                        onClick={() => toggleMemberVisibility(member.id)}
                        title={isHidden ? 'Einblenden' : 'Ausblenden'}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <svg width={14 * scale} height={14 * scale} viewBox="0 0 24 24" fill="none" stroke={isHidden ? '#6b7280' : member.color} strokeWidth="2">
                          {isHidden ? (
                            <>
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </>
                          ) : (
                            <>
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </>
                          )}
                        </svg>
                      </button>
                    ) : (
                      <span style={{
                        width: `${10 * scale}px`,
                        height: `${10 * scale}px`,
                        borderRadius: '50%',
                        background: member.color,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${member.color}`
                      }} />
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 600,
                        fontSize: `${11 * scale}px`,
                        color: 'white',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        opacity: member.isOnline ? 1 : 0.5
                      }}>
                        {member.callsign}
                        {isMe && <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}> (du)</span>}
                      </div>
                    </div>

                    <span style={{
                      width: `${6 * scale}px`,
                      height: `${6 * scale}px`,
                      borderRadius: '50%',
                      background: member.isOnline ? '#22c55e' : '#6b7280',
                      flexShrink: 0
                    }} />
                  </div>
                )
              }

              return (
                <div style={{ marginBottom: `${10 * scale}px` }}>
                  {/* Tab Buttons */}
                  <div style={{
                    display: 'flex',
                    gap: `${4 * scale}px`,
                    marginBottom: `${8 * scale}px`
                  }}>
                    <button
                      onClick={() => setActiveTab('pilots')}
                      style={{
                        flex: 1,
                        padding: `${6 * scale}px`,
                        background: activeTab === 'pilots' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                        border: activeTab === 'pilots' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: `${6 * scale}px`,
                        color: activeTab === 'pilots' ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                        fontSize: `${10 * scale}px`,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Piloten ({pilotMembers.length}/10)
                    </button>
                    <button
                      onClick={() => setActiveTab('crew')}
                      style={{
                        flex: 1,
                        padding: `${6 * scale}px`,
                        background: activeTab === 'crew' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
                        border: activeTab === 'crew' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: `${6 * scale}px`,
                        color: activeTab === 'crew' ? '#22c55e' : 'rgba(255,255,255,0.5)',
                        fontSize: `${10 * scale}px`,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Crew ({crewMembers.length}/10)
                    </button>
                  </div>

                  {/* Tab Content */}
                  {activeTab === 'pilots' && (
                    <>
                      {pilotMembers.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: `${10 * scale}px`, padding: `${8 * scale}px` }}>
                          Keine Piloten im Team
                        </div>
                      ) : pilotMembers.map(renderMember)}
                    </>
                  )}

                  {activeTab === 'crew' && (
                    <>
                      {crewMembers.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: `${10 * scale}px`, padding: `${8 * scale}px` }}>
                          Keine Crew im Team
                        </div>
                      ) : crewMembers.map(renderMember)}
                    </>
                  )}
                </div>
              )
            })()}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: `${6 * scale}px`, marginBottom: `${8 * scale}px` }}>
              {/* Chat Button */}
              <button
                onClick={() => { setShowChat(!showChat); setShowWindReports(false) }}
                style={{
                  flex: 1,
                  padding: `${8 * scale}px ${10 * scale}px`,
                  background: showChat ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: `${6 * scale}px`,
                  color: '#3b82f6',
                  fontSize: `${11 * scale}px`,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: `${4 * scale}px`
                }}
              >
                <svg width={14 * scale} height={14 * scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Chat
              </button>

              {/* Wind Reports Button */}
              <button
                onClick={() => { setShowWindReports(!showWindReports); setShowChat(false) }}
                title="Bodenwind-Meldungen"
                style={{
                  flex: 1,
                  padding: `${8 * scale}px ${10 * scale}px`,
                  background: unreadWindReports > 0
                    ? 'rgba(34, 197, 94, 0.3)'
                    : showWindReports ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.1)',
                  border: unreadWindReports > 0
                    ? '1px solid rgba(34, 197, 94, 0.6)'
                    : '1px solid rgba(34, 197, 94, 0.25)',
                  borderRadius: `${6 * scale}px`,
                  color: '#22c55e',
                  fontSize: `${11 * scale}px`,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: `${4 * scale}px`,
                  position: 'relative'
                }}
              >
                <svg width={14 * scale} height={14 * scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
                </svg>
                Wind
                {unreadWindReports > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: `${-4 * scale}px`,
                    right: `${-4 * scale}px`,
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: `${8 * scale}px`,
                    fontWeight: 700,
                    borderRadius: '50%',
                    width: `${16 * scale}px`,
                    height: `${16 * scale}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.5)'
                  }}>
                    {unreadWindReports}
                  </span>
                )}
              </button>
            </div>

            {/* Wind Reports Panel */}
            {showWindReports && (
              <div style={{ marginBottom: `${8 * scale}px` }}>
                <GroundWindReports scale={scale} onClose={() => setShowWindReports(false)} />
              </div>
            )}

            {/* Chat Panel */}
            {showChat && (
              <div style={{
                marginBottom: `${8 * scale}px`,
                background: 'rgba(0,0,0,0.2)',
                borderRadius: `${8 * scale}px`,
                border: '1px solid rgba(255,255,255,0.1)',
                overflow: 'hidden'
              }}>
                {/* Chat Target Selector */}
                <div style={{
                  display: 'flex',
                  gap: `${4 * scale}px`,
                  padding: `${6 * scale}px`,
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  flexWrap: 'wrap'
                }}>
                  <button
                    onClick={() => setChatTarget(null)}
                    style={{
                      padding: `${4 * scale}px ${8 * scale}px`,
                      background: chatTarget === null ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.05)',
                      border: chatTarget === null ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: `${4 * scale}px`,
                      color: chatTarget === null ? '#22c55e' : 'rgba(255,255,255,0.6)',
                      fontSize: `${9 * scale}px`,
                      cursor: 'pointer',
                      fontWeight: chatTarget === null ? 600 : 400
                    }}
                  >
                    Alle
                  </button>
                  {members.filter(m => m.id !== myMemberId).map(m => (
                    <button
                      key={m.id}
                      onClick={() => setChatTarget(m.id)}
                      style={{
                        padding: `${4 * scale}px ${8 * scale}px`,
                        background: chatTarget === m.id ? `${m.color}33` : 'rgba(255,255,255,0.05)',
                        border: chatTarget === m.id ? `1px solid ${m.color}80` : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: `${4 * scale}px`,
                        color: chatTarget === m.id ? m.color : 'rgba(255,255,255,0.6)',
                        fontSize: `${9 * scale}px`,
                        cursor: 'pointer',
                        fontWeight: chatTarget === m.id ? 600 : 400,
                        display: 'flex',
                        alignItems: 'center',
                        gap: `${4 * scale}px`
                      }}
                    >
                      <span style={{
                        width: `${6 * scale}px`,
                        height: `${6 * scale}px`,
                        borderRadius: '50%',
                        background: m.color
                      }} />
                      {m.callsign}
                    </button>
                  ))}
                </div>

                {/* Messages */}
                {(() => {
                  // Nachrichten filtern nach aktuellem Chat-Kanal
                  const filteredMessages = messages.filter(msg => {
                    if (chatTarget === null) {
                      // "Alle"-Kanal: nur Broadcast-Nachrichten (ohne target)
                      return !msg.targetMemberId
                    } else {
                      // Privat-Chat: Nachrichten zwischen mir und dem ausgewählten Piloten
                      const isFromMeToTarget = msg.isMine && msg.targetMemberId === chatTarget
                      const isFromTargetToMe = msg.memberId === chatTarget && (!msg.targetMemberId || msg.targetMemberId === myMemberId)
                      return isFromMeToTarget || isFromTargetToMe
                    }
                  })

                  return (
                <div
                  ref={chatContainerRef}
                  style={{
                    maxHeight: `${150 * scale}px`,
                    overflowY: 'auto',
                    padding: `${6 * scale}px`
                  }}
                >
                  {filteredMessages.length === 0 ? (
                    <div style={{
                      textAlign: 'center',
                      color: 'rgba(255,255,255,0.3)',
                      fontSize: `${10 * scale}px`,
                      padding: `${12 * scale}px`
                    }}>
                      Keine Nachrichten
                    </div>
                  ) : (
                    filteredMessages.map(msg => (
                      <div
                        key={msg.id}
                        style={{
                          marginBottom: `${6 * scale}px`,
                          padding: `${6 * scale}px ${8 * scale}px`,
                          background: msg.isMine ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)',
                          borderRadius: `${6 * scale}px`,
                          borderLeft: `3px solid ${msg.color}`
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: `${4 * scale}px`,
                          marginBottom: `${2 * scale}px`
                        }}>
                          <span style={{
                            fontSize: `${9 * scale}px`,
                            fontWeight: 600,
                            color: msg.color
                          }}>
                            {msg.isMine ? 'Du' : msg.callsign}
                          </span>
                          {msg.targetMemberId && (
                            <span style={{
                              fontSize: `${8 * scale}px`,
                              color: 'rgba(255,255,255,0.4)'
                            }}>
                              → {msg.targetCallsign || 'Privat'}
                            </span>
                          )}
                          <span style={{
                            fontSize: `${8 * scale}px`,
                            color: 'rgba(255,255,255,0.3)',
                            marginLeft: 'auto'
                          }}>
                            {msg.createdAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{
                          fontSize: `${10 * scale}px`,
                          color: 'rgba(255,255,255,0.9)'
                        }}>
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                  )
                })()}

                {/* Message Input */}
                <div style={{
                  display: 'flex',
                  gap: `${4 * scale}px`,
                  padding: `${6 * scale}px`,
                  borderTop: '1px solid rgba(255,255,255,0.1)'
                }}>
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && chatMessage.trim()) {
                        handleSendMessage(chatMessage.trim(), chatTarget)
                        setChatMessage('')
                      }
                    }}
                    placeholder={chatTarget ? `An ${members.find(m => m.id === chatTarget)?.callsign}...` : 'Nachricht an alle...'}
                    style={{
                      flex: 1,
                      padding: `${6 * scale}px ${8 * scale}px`,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: `${4 * scale}px`,
                      color: '#fff',
                      fontSize: `${10 * scale}px`,
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => {
                      if (chatMessage.trim()) {
                        handleSendMessage(chatMessage.trim(), chatTarget)
                        setChatMessage('')
                      }
                    }}
                    disabled={sendingMsg || !chatMessage.trim()}
                    style={{
                      padding: `${6 * scale}px ${10 * scale}px`,
                      background: chatMessage.trim() ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.05)',
                      border: 'none',
                      borderRadius: `${4 * scale}px`,
                      color: chatMessage.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                      fontSize: `${10 * scale}px`,
                      cursor: chatMessage.trim() ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Senden
                  </button>
                  {/* Quick Messages Toggle */}
                  <button
                    onClick={() => setShowQuickMessages(!showQuickMessages)}
                    style={{
                      padding: `${6 * scale}px`,
                      background: showQuickMessages ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: `${4 * scale}px`,
                      color: showQuickMessages ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Schnellnachrichten"
                  >
                    <svg width={12 * scale} height={12 * scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ transform: showQuickMessages ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                </div>

                {/* Quick Messages (ausklappbar) */}
                {showQuickMessages && (
                  <div style={{
                    display: 'flex',
                    gap: `${4 * scale}px`,
                    padding: `${6 * scale}px`,
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    flexWrap: 'wrap',
                    background: 'rgba(0,0,0,0.15)'
                  }}>
                    {QUICK_MESSAGES.map(msg => (
                      <button
                        key={msg}
                        onClick={() => { handleSendMessage(msg, chatTarget); setShowQuickMessages(false) }}
                        disabled={sendingMsg}
                        style={{
                          padding: `${4 * scale}px ${6 * scale}px`,
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.2)',
                          borderRadius: `${4 * scale}px`,
                          color: '#f59e0b',
                          fontSize: `${8 * scale}px`,
                          cursor: sendingMsg ? 'wait' : 'pointer'
                        }}
                      >
                        {msg}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Connection Status */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: `${6 * scale}px`,
              padding: `${6 * scale}px`,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: `${6 * scale}px`,
              marginBottom: `${10 * scale}px`
            }}>
              <span style={{
                width: `${6 * scale}px`,
                height: `${6 * scale}px`,
                borderRadius: '50%',
                background: statusColor
              }} />
              <span style={{ fontSize: `${10 * scale}px`, color: 'rgba(255,255,255,0.6)' }}>
                {statusText}
              </span>
            </div>

            {error && (
              <div style={{
                padding: `${6 * scale}px ${8 * scale}px`,
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: `${6 * scale}px`,
                fontSize: `${10 * scale}px`,
                color: '#f87171',
                marginBottom: `${10 * scale}px`
              }}>
                {error}
              </div>
            )}

            {/* Leave Button */}
            <button
              onClick={handleLeave}
              style={{
                width: '100%',
                padding: `${8 * scale}px`,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: `${6 * scale}px`,
                fontSize: `${11 * scale}px`,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Team verlassen
            </button>
          </>
        )}
      </div>
    </div>
  )
}
