import React from 'react'
import { useAuthStore } from '../stores/authStore'

interface HeaderProps {
  onToggleList: () => void
  showList: boolean
  onToggleChat: () => void
  showChat: boolean
  onLeaveTeam: () => void
  teamName: string
}

export function Header({ onToggleList, showList, onToggleChat, showChat, onLeaveTeam, teamName }: HeaderProps) {
  const { user, logout } = useAuthStore()
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 12px',
      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      flexShrink: 0,
      gap: 8
    }}>
      {/* Team Info (left) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          maxWidth: 180,
          overflow: 'hidden'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {teamName}
        </span>
      </div>

      {/* Actions (right) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Pilot List Toggle */}
        <button
          onClick={onToggleList}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: showList ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: showList ? '#3b82f6' : 'rgba(255,255,255,0.7)',
            cursor: 'pointer'
          }}
          title="Pilotenliste"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </button>

        {/* Chat Toggle */}
        <button
          onClick={onToggleChat}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: showChat ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: showChat ? '#22c55e' : 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            position: 'relative'
          }}
          title="Team Chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Leave Team */}
        <button
          onClick={onLeaveTeam}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer'
          }}
          title="Team verlassen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 8,
            color: '#ef4444',
            cursor: 'pointer'
          }}
          title={`Abmelden (${user?.display_name || user?.username})`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  )
}
