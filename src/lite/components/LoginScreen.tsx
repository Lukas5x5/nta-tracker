import React, { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

export function LoginScreen() {
  const { login, error, isLoading, clearError } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    await login(username, password)
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
          <path d="M7 3c0 3 2 5 5 5s5-2 5-5" />
        </svg>
      </div>

      <h1 style={{
        fontSize: 24,
        fontWeight: 700,
        marginBottom: 8,
        background: 'linear-gradient(135deg, #fff, #94a3b8)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        NTA Live Tracker
      </h1>

      <p style={{
        fontSize: 14,
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 32
      }}>
        Verfolge Piloten in Echtzeit
      </p>

      <form onSubmit={handleSubmit} style={{
        width: '100%',
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {error && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            color: '#ef4444',
            fontSize: 13,
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <input
          ref={usernameRef}
          type="text"
          placeholder="Benutzername"
          value={username}
          onChange={e => { setUsername(e.target.value); clearError() }}
          style={{
            width: '100%',
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: '#fff',
            fontSize: 15,
            outline: 'none'
          }}
        />

        <input
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={e => { setPassword(e.target.value); clearError() }}
          style={{
            width: '100%',
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: '#fff',
            fontSize: 15,
            outline: 'none'
          }}
        />

        <button
          type="submit"
          disabled={isLoading || !username || !password}
          style={{
            width: '100%',
            padding: '14px 16px',
            background: isLoading ? 'rgba(59, 130, 246, 0.5)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: isLoading ? 'wait' : 'pointer',
            marginTop: 8
          }}
        >
          {isLoading ? 'Anmelden...' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
