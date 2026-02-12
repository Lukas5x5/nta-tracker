import React, { useState } from 'react'
import { useTrackerStore } from '../stores/trackerStore'

interface TeamJoinProps {
  onJoined: () => void
}

export function TeamJoin({ onJoined }: TeamJoinProps) {
  const { joinTeam, isJoining, joinError } = useTrackerStore()
  const [code, setCode] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return

    const success = await joinTeam(code.toUpperCase())
    if (success) {
      onJoined()
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Nur Großbuchstaben und Zahlen erlauben, max 6 Zeichen
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setCode(value)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)'
    }}>
      {/* Logo */}
      <div style={{
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
        boxShadow: '0 8px 32px rgba(59, 130, 246, 0.3)'
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="8" r="5" />
          <path d="M12 13v8" />
          <path d="M9 18h6" />
        </svg>
      </div>

      <h1 style={{
        fontSize: 24,
        fontWeight: 700,
        marginBottom: 8,
        color: '#fff'
      }}>
        Team beitreten
      </h1>

      <p style={{
        fontSize: 14,
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 32,
        textAlign: 'center',
        maxWidth: 300
      }}>
        Gib den 6-stelligen Team-Code ein, um die Piloten live zu verfolgen
      </p>

      <form onSubmit={handleSubmit} style={{
        width: '100%',
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {/* Code Input */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8
        }}>
          <input
            type="text"
            value={code}
            onChange={handleCodeChange}
            placeholder="ABC123"
            maxLength={6}
            autoFocus
            style={{
              width: '100%',
              padding: '16px 20px',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 8,
              textAlign: 'center',
              background: 'rgba(255,255,255,0.05)',
              border: joinError ? '2px solid #ef4444' : '2px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#fff',
              outline: 'none',
              transition: 'all 0.2s'
            }}
            onFocus={e => {
              e.target.style.borderColor = '#3b82f6'
              e.target.style.background = 'rgba(59, 130, 246, 0.1)'
            }}
            onBlur={e => {
              e.target.style.borderColor = joinError ? '#ef4444' : 'rgba(255,255,255,0.1)'
              e.target.style.background = 'rgba(255,255,255,0.05)'
            }}
          />
        </div>

        {/* Error Message */}
        {joinError && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            color: '#ef4444',
            fontSize: 13,
            textAlign: 'center'
          }}>
            {joinError}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={code.length !== 6 || isJoining}
          style={{
            padding: '14px 24px',
            fontSize: 15,
            fontWeight: 600,
            background: code.length === 6
              ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
              : 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 10,
            color: code.length === 6 ? '#fff' : 'rgba(255,255,255,0.3)',
            cursor: code.length === 6 && !isJoining ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          {isJoining ? (
            <>
              <div style={{
                width: 18,
                height: 18,
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Verbinde...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Beitreten
            </>
          )}
        </button>
      </form>

      {/* Info */}
      <div style={{
        marginTop: 48,
        padding: '16px 20px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        maxWidth: 320,
        width: '100%'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            Der Team-Code wird vom Piloten in der NTA App erstellt und kann im Team-Panel gefunden werden.
          </div>
        </div>
      </div>
    </div>
  )
}
