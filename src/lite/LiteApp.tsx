import React, { useState, useEffect } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { TeamJoin } from './components/TeamJoin'
import { TrackerMap } from './components/TrackerMap'
import { Header } from './components/Header'
import { PilotList } from './components/PilotList'
import { PilotTasksPanel } from './components/PilotTasksPanel'
import { useAuthStore } from './stores/authStore'
import { useTrackerStore } from './stores/trackerStore'

export function LiteApp() {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore()
  const { team, leaveTeam, selectedPilot, selectPilot } = useTrackerStore()
  const [showList, setShowList] = useState(false)
  const [showTasks, setShowTasks] = useState(false)

  // Show tasks panel when pilot is selected
  useEffect(() => {
    if (selectedPilot) {
      setShowTasks(true)
    }
  }, [selectedPilot])

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
        onLeaveTeam={leaveTeam}
        teamName={team.name}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <TrackerMap />

        {/* Pilot Tasks Panel (bottom sheet) */}
        {showTasks && selectedPilot && (
          <PilotTasksPanel onClose={() => {
            setShowTasks(false)
            selectPilot(null)
          }} />
        )}

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
    </div>
  )
}
