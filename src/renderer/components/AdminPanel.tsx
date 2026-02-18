import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import type { AppUser } from '../../shared/types'

interface AdminPanelProps {
  onClose: () => void
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const { loadUsers, createUser, deactivateUser, activateUser, deleteUser, changePassword, regenerateLicenseKey, unbindLicense, error, clearError, user: currentUser } = useAuthStore()

  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)

  // Neuer Benutzer Formular
  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'pilot' | 'crew'>('pilot')
  const [creating, setCreating] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Lizenzschlüssel / Credentials Dialog nach Erstellung
  const [createdLicenseKey, setCreatedLicenseKey] = useState<string | null>(null)
  const [createdUsername, setCreatedUsername] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)

  // Passwort zuruecksetzen (nur für Admins)
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  // Löschen Bestätigung
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Expanded user details
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)

  const refreshUsers = async () => {
    const data = await loadUsers()
    setUsers(data)
    setLoading(false)
  }

  useEffect(() => {
    refreshUsers()
  }, [])

  // Auto-clear success message
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 3000)
      return () => clearTimeout(t)
    }
  }, [successMsg])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim()) return
    // Crew braucht ein Passwort
    if (newRole === 'crew' && !newPassword.trim()) return
    setCreating(true)
    clearError()

    const password = newRole === 'crew' ? newPassword.trim() : crypto.randomUUID()
    const result = await createUser(newUsername.trim(), password, newDisplayName.trim(), newRole)
    if (result.success && result.licenseKey) {
      const savedUsername = newUsername.trim()
      const savedPassword = newRole === 'crew' ? password : null
      setNewUsername('')
      setNewDisplayName('')
      setNewPassword('')
      setNewRole('pilot')
      setShowNewForm(false)
      setCreatedLicenseKey(result.licenseKey)
      setCreatedUsername(savedUsername)
      setCreatedPassword(savedPassword)
      setCopiedKey(false)
      await refreshUsers()
    }
    setCreating(false)
  }

  const handleToggleActive = async (u: AppUser) => {
    clearError()
    const ok = u.is_active
      ? await deactivateUser(u.id)
      : await activateUser(u.id)
    if (ok) {
      setSuccessMsg(u.is_active ? 'Benutzer deaktiviert' : 'Benutzer aktiviert')
      await refreshUsers()
    }
  }

  const handleResetPassword = async (userId: string) => {
    if (!resetPassword.trim()) return
    clearError()
    const ok = await changePassword(userId, resetPassword)
    if (ok) {
      setResetUserId(null)
      setResetPassword('')
      setSuccessMsg('Passwort geändert')
    }
  }

  const handleRegenerateKey = async (userId: string) => {
    clearError()
    const newKey = await regenerateLicenseKey(userId)
    if (newKey) {
      const u = users.find(x => x.id === userId)
      setCreatedLicenseKey(newKey)
      setCreatedUsername(u?.username || '')
      setCopiedKey(false)
      await refreshUsers()
    }
  }

  const handleUnbindLicense = async (userId: string) => {
    clearError()
    const ok = await unbindLicense(userId)
    if (ok) {
      setSuccessMsg('PC-Bindung aufgehoben')
      await refreshUsers()
    }
  }

  const handleDeleteUser = async (userId: string) => {
    clearError()
    const ok = await deleteUser(userId)
    if (ok) {
      setConfirmDeleteId(null)
      setSuccessMsg('Benutzer gelöscht')
      await refreshUsers()
    }
  }

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = key
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box'
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '4px'
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }} onClick={onClose}>
      <div
        style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '24px',
          width: '520px',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
            Benutzerverwaltung
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              fontSize: '16px',
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        {/* Erfolgsmeldung */}
        {successMsg && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '16px',
            color: '#22c55e',
            fontSize: '12px',
            textAlign: 'center'
          }}>
            {successMsg}
          </div>
        )}

        {/* Fehlermeldung */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '16px',
            color: '#ef4444',
            fontSize: '12px',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* Benutzerliste */}
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
            Laden...
          </div>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            {users.map(u => (
              <div key={u.id} style={{ marginBottom: '6px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: expandedUserId === u.id ? '8px 8px 0 0' : '8px',
                  opacity: u.is_active ? 1 : 0.5,
                  cursor: u.id !== currentUser?.id ? 'pointer' : 'default'
                }} onClick={() => {
                  if (u.id !== currentUser?.id) {
                    setExpandedUserId(expandedUserId === u.id ? null : u.id)
                    setResetUserId(null)
                    setResetPassword('')
                  }
                }}>
                  {/* User Icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={u.is_admin ? '#a855f7' : u.role === 'crew' ? '#22c55e' : 'rgba(255,255,255,0.4)'} strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>

                  {/* User Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
                        {u.username}
                      </span>
                      {u.is_admin && (
                        <span style={{
                          fontSize: '10px',
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#a855f7',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Admin
                        </span>
                      )}
                      {u.role === 'crew' && (
                        <span style={{
                          fontSize: '10px',
                          background: 'rgba(34, 197, 94, 0.2)',
                          color: '#22c55e',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Crew
                        </span>
                      )}
                      {u.role === 'pilot' && !u.is_admin && (
                        <span style={{
                          fontSize: '10px',
                          background: 'rgba(59, 130, 246, 0.2)',
                          color: '#3b82f6',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Pilot
                        </span>
                      )}
                      {!u.is_active && (
                        <span style={{
                          fontSize: '10px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#ef4444',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Inaktiv
                        </span>
                      )}
                    </div>
                    {u.display_name && (
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                        {u.display_name}
                      </div>
                    )}
                    {/* License key preview for non-admin users */}
                    {!u.is_admin && u.license_key && (
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', marginTop: '2px' }}>
                        {u.license_key}
                        {u.bound_installation_id && (
                          <span style={{ marginLeft: '8px', color: 'rgba(59, 130, 246, 0.5)' }}>
                            PC: {u.bound_installation_id.substring(0, 8)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expand indicator */}
                  {u.id !== currentUser?.id && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"
                      style={{ transform: expandedUserId === u.id ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </div>

                {/* Expanded Actions */}
                {expandedUserId === u.id && u.id !== currentUser?.id && (
                  <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '0 0 8px 8px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {/* License actions for non-admin users */}
                    {!u.is_admin && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {u.license_key && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setCreatedLicenseKey(u.license_key!); setCreatedUsername(u.username); setCopiedKey(false) }}
                            title="Lizenzschlüssel anzeigen"
                            style={{
                              background: 'rgba(34, 197, 94, 0.1)',
                              border: '1px solid rgba(34, 197, 94, 0.2)',
                              color: '#22c55e',
                              cursor: 'pointer',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            Schlüssel anzeigen
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRegenerateKey(u.id) }}
                          title="Neuen Lizenzschlüssel generieren"
                          style={{
                            background: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            color: '#f59e0b',
                            cursor: 'pointer',
                            padding: '5px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          Neuer Schlüssel
                        </button>
                        {u.bound_installation_id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUnbindLicense(u.id) }}
                            title="PC-Bindung aufheben"
                            style={{
                              background: 'rgba(59, 130, 246, 0.1)',
                              border: '1px solid rgba(59, 130, 246, 0.2)',
                              color: '#3b82f6',
                              cursor: 'pointer',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 4v6h6" />
                              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            PC lösen
                          </button>
                        )}
                      </div>
                    )}

                    {/* Common actions */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {/* Passwort zurücksetzen (für Admin- und Crew-Benutzer) */}
                      {(u.is_admin || u.role === 'crew') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setResetUserId(resetUserId === u.id ? null : u.id); setResetPassword('') }}
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            padding: '5px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          Passwort ändern
                        </button>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(u) }}
                        style={{
                          background: u.is_active ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                          border: `1px solid ${u.is_active ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)'}`,
                          color: u.is_active ? '#ef4444' : '#22c55e',
                          cursor: 'pointer',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 500
                        }}
                      >
                        {u.is_active ? 'Deaktivieren' : 'Aktivieren'}
                      </button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(u.id) }}
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Löschen
                      </button>
                    </div>

                    {/* Passwort Reset Inline */}
                    {resetUserId === u.id && (
                      <div style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '8px 10px',
                        background: 'rgba(59, 130, 246, 0.05)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        borderRadius: '6px',
                        alignItems: 'center'
                      }}>
                        <input
                          type="password"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          placeholder="Neues Passwort"
                          style={{ ...inputStyle, flex: 1 }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleResetPassword(resetUserId)
                            if (e.key === 'Escape') { setResetUserId(null); setResetPassword('') }
                          }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResetPassword(resetUserId) }}
                          disabled={!resetPassword.trim()}
                          style={{
                            background: '#3b82f6',
                            border: 'none',
                            color: '#fff',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                            opacity: resetPassword.trim() ? 1 : 0.5
                          }}
                        >
                          OK
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setResetUserId(null); setResetPassword('') }}
                          style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: 'rgba(255,255,255,0.5)',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px'
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Neuer Benutzer */}
        {!showNewForm ? (
          <button
            onClick={() => { setShowNewForm(true); clearError() }}
            style={{
              width: '100%',
              padding: '10px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px dashed rgba(59, 130, 246, 0.3)',
              borderRadius: '8px',
              color: '#3b82f6',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            + Neuer Benutzer
          </button>
        ) : (
          <form onSubmit={handleCreateUser} style={{
            background: 'rgba(59, 130, 246, 0.05)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '8px',
            padding: '14px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6', marginBottom: '12px' }}>
              Neuer Benutzer
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={labelStyle}>Benutzername *</label>
              <input
                type="text"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="Benutzername"
                style={inputStyle}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={labelStyle}>Anzeigename (optional)</label>
              <input
                type="text"
                value={newDisplayName}
                onChange={e => setNewDisplayName(e.target.value)}
                placeholder="z.B. Pilot Max"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Rolle</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as 'pilot' | 'crew')}
                style={{
                  ...inputStyle,
                  cursor: 'pointer',
                  appearance: 'auto'
                }}
              >
                <option value="pilot">Pilot</option>
                <option value="crew">Crew</option>
              </select>
            </div>

            {/* Passwort-Feld nur bei Crew */}
            {newRole === 'crew' && (
              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Passwort *</label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Passwort für Lite-App Login"
                  style={inputStyle}
                />
              </div>
            )}

            <div style={{
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.15)',
              borderRadius: '6px',
              padding: '8px 10px',
              marginBottom: '14px',
              fontSize: '11px',
              color: 'rgba(245, 158, 11, 0.8)'
            }}>
              {newRole === 'crew'
                ? 'Benutzername und Passwort werden für den Lite-App Login benötigt.'
                : 'Ein Lizenzschlüssel wird automatisch generiert und nach der Erstellung angezeigt.'
              }
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={creating || !newUsername.trim() || (newRole === 'crew' && !newPassword.trim())}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: creating ? 'rgba(59, 130, 246, 0.3)' : '#3b82f6',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: creating ? 'wait' : 'pointer',
                  opacity: (!newUsername.trim() || (newRole === 'crew' && !newPassword.trim())) ? 0.5 : 1
                }}
              >
                {creating ? 'Erstelle...' : 'Benutzer erstellen'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewForm(false)
                  setNewUsername('')
                  setNewDisplayName('')
                  setNewPassword('')
                  setNewRole('pilot')
                  clearError()
                }}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {/* Lizenzschlüssel / Credentials Dialog */}
        {createdLicenseKey && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }} onClick={() => { setCreatedLicenseKey(null); setCreatedPassword(null) }}>
            <div style={{
              background: '#1e293b', borderRadius: '12px', padding: '24px',
              minWidth: '340px', maxWidth: '420px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              textAlign: 'center'
            }} onClick={e => e.stopPropagation()}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.15)', margin: '0 auto 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              {createdPassword ? (
                <>
                  {/* Crew: Zugangsdaten anzeigen */}
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>
                    Crew-Zugangsdaten
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
                    Zugangsdaten für die Lite-App:
                  </div>

                  <div style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    marginBottom: '16px',
                    textAlign: 'left'
                  }}>
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>Benutzername</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 700, color: '#fff', userSelect: 'all' }}>
                        {createdUsername}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '2px' }}>Passwort</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 700, color: '#fff', userSelect: 'all' }}>
                        {createdPassword}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      onClick={() => handleCopyKey(`Benutzername: ${createdUsername}\nPasswort: ${createdPassword}`)}
                      style={{
                        padding: '8px 20px',
                        background: copiedKey ? 'rgba(34, 197, 94, 0.2)' : '#3b82f6',
                        border: 'none', borderRadius: '8px',
                        color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        transition: 'background 0.2s'
                      }}
                    >
                      {copiedKey ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Kopiert!
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Kopieren
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => { setCreatedLicenseKey(null); setCreatedPassword(null) }}
                      style={{
                        padding: '8px 20px', background: 'rgba(255,255,255,0.1)',
                        border: 'none', borderRadius: '8px',
                        color: 'rgba(255,255,255,0.7)', fontSize: '12px', cursor: 'pointer'
                      }}
                    >
                      Schließen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Pilot: Lizenzschlüssel anzeigen */}
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>
                    Lizenzschlüssel
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px' }}>
                    Schlüssel für <strong style={{ color: '#22c55e' }}>{createdUsername}</strong>:
                  </div>

                  <div style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    marginBottom: '16px',
                    fontFamily: 'monospace',
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '1px',
                    userSelect: 'all'
                  }}>
                    {createdLicenseKey}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      onClick={() => handleCopyKey(createdLicenseKey)}
                      style={{
                        padding: '8px 20px',
                        background: copiedKey ? 'rgba(34, 197, 94, 0.2)' : '#3b82f6',
                        border: 'none', borderRadius: '8px',
                        color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        transition: 'background 0.2s'
                      }}
                    >
                      {copiedKey ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Kopiert!
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Kopieren
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setCreatedLicenseKey(null)}
                      style={{
                        padding: '8px 20px', background: 'rgba(255,255,255,0.1)',
                        border: 'none', borderRadius: '8px',
                        color: 'rgba(255,255,255,0.7)', fontSize: '12px', cursor: 'pointer'
                      }}
                    >
                      Schließen
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Löschen Bestätigungsdialog */}
        {confirmDeleteId && (() => {
          const delUser = users.find(u => u.id === confirmDeleteId)
          return (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.7)', zIndex: 10001,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }} onClick={() => setConfirmDeleteId(null)}>
              <div style={{
                background: '#1e293b', borderRadius: '12px', padding: '24px',
                minWidth: '300px', maxWidth: '380px',
                border: '1px solid rgba(239,68,68,0.3)',
                textAlign: 'center'
              }} onClick={e => e.stopPropagation()}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: 'rgba(239,68,68,0.15)', margin: '0 auto 12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>
                  Benutzer löschen?
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '18px' }}>
                  <strong style={{ color: '#ef4444' }}>{delUser?.username}</strong> wird unwiderruflich gelöscht.
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    style={{
                      padding: '8px 20px', background: 'rgba(255,255,255,0.1)',
                      border: 'none', borderRadius: '8px',
                      color: 'rgba(255,255,255,0.7)', fontSize: '12px', cursor: 'pointer'
                    }}
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={() => handleDeleteUser(confirmDeleteId)}
                    style={{
                      padding: '8px 20px', background: '#ef4444',
                      border: 'none', borderRadius: '8px',
                      color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
