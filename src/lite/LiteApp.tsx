import React, { useState, useEffect } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { TeamJoin } from './components/TeamJoin'
import { TrackerMap } from './components/TrackerMap'
import { Header } from './components/Header'
import { PilotList } from './components/PilotList'
import { TeamChat } from './components/TeamChat'
import { useAuthStore } from './stores/authStore'
import { useTrackerStore } from './stores/trackerStore'

export function LiteApp() {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore()
  const { team, leaveTeam, joinTeam, messages, unreadCount } = useTrackerStore()
  const [showList, setShowList] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [toast, setToast] = useState<{ callsign: string; message: string; color: string } | null>(null)
  const prevMsgCount = React.useRef(0)

  // Chat-Popup bei neuen Nachrichten (nur wenn Chat geschlossen)
  useEffect(() => {
    if (messages.length > prevMsgCount.current && !showChat) {
      const newest = messages[messages.length - 1]
      if (!newest.isMine) {
        setToast({ callsign: newest.callsign, message: newest.message, color: newest.color })
        setTimeout(() => setToast(null), 8000)
      }
    }
    prevMsgCount.current = messages.length
  }, [messages.length, showChat])

  // Unread zurücksetzen wenn Chat geöffnet wird
  useEffect(() => {
    if (showChat) useTrackerStore.setState({ unreadCount: 0 })
  }, [showChat])

  // Auto-Rejoin nach Refresh: gespeicherten Join-Code verwenden
  useEffect(() => {
    if (isAuthenticated && !team) {
      try {
        const savedCode = localStorage.getItem('nta-lite-join-code')
        if (savedCode) {
          joinTeam(savedCode)
        }
      } catch {}
    }
  }, [isAuthenticated])

  // Session prüfen beim Start und alle 30 Sekunden
  useEffect(() => {
    checkSession()
    const interval = setInterval(() => {
      checkSession()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Cleanup bei Logout
  useEffect(() => {
    if (!isAuthenticated) {
      leaveTeam()
    }
  }, [isAuthenticated])

  if (isLoading) {
    return (
      <div style={{
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '14px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40,
            height: 40,
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          Laden...
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  // Team Join Screen
  if (!team) {
    return <TeamJoin onJoined={() => {}} />
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      background: '#0f172a'
    }}>
      <Header
        onToggleList={() => setShowList(!showList)}
        showList={showList}
        onToggleChat={() => setShowChat(!showChat)}
        showChat={showChat}
        onLeaveTeam={leaveTeam}
        teamName={team.name}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <TrackerMap />

        {/* Pilot List Overlay (mobile) */}
        {showList && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.95)',
            zIndex: 1000,
            overflow: 'auto'
          }}>
            <PilotList onClose={() => setShowList(false)} />
          </div>
        )}
      </div>

      {/* Chat Overlay */}
      {showChat && (
        <TeamChat onClose={() => setShowChat(false)} />
      )}

      {/* Chat-Toast bei neuen Nachrichten */}
      {toast && !showChat && (
        <div
          onClick={() => { setToast(null); setShowChat(true) }}
          style={{
            position: 'fixed',
            top: '60px',
            left: '16px',
            right: '16px',
            maxWidth: '400px',
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            color: 'white',
            padding: '12px 16px',
            borderRadius: '12px',
            border: `2px solid ${toast.color}`,
            boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 15px ${toast.color}40`,
            zIndex: 10002,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'slideIn 0.3s ease-out'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={toast.color} strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '11px', color: toast.color }}>{toast.callsign}</div>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>{toast.message}</div>
          </div>
          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Klick zum Antworten</div>
        </div>
      )}
    </div>
  )
}
