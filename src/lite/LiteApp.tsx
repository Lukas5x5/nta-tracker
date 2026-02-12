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
  const { team, leaveTeam, joinTeam } = useTrackerStore()
  const [showList, setShowList] = useState(false)
  const [showChat, setShowChat] = useState(false)

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
        height: '100vh',
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
      height: '100vh',
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

      {/* Chat Overlay - fixed über allem (auch über Leaflet auf Mobile) */}
      {showChat && (
        <TeamChat onClose={() => setShowChat(false)} />
      )}
    </div>
  )
}
