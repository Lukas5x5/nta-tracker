import React, { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'

const APP_VERSION = '1.1.1'

export function LoginScreen() {
  const { login, activateLicense, bootstrapAdmin, checkIsEmpty, error, isLoading, clearError } = useAuthStore()

  // Lizenz-Eingabe (Standard-Ansicht)
  const [licenseKey, setLicenseKey] = useState('')
  const licenseRef = useRef<HTMLInputElement>(null)

  // Admin-Login (versteckt hinter Ctrl+Shift+A)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)

  // Bootstrap (Ersteinrichtung)
  const [bootstrapMode, setBootstrapMode] = useState(false)
  const [bootstrapDisplayName, setBootstrapDisplayName] = useState('')
  const [bootstrapChecked, setBootstrapChecked] = useState(false)

  // Status
  const [isOffline, setIsOffline] = useState(!navigator.onLine)


  // Pruefen ob app_users leer ist (Ersteinrichtung)
  useEffect(() => {
    checkIsEmpty().then(empty => {
      setBootstrapMode(empty)
      setBootstrapChecked(true)
    }).catch(() => {
      setBootstrapMode(false)
      setBootstrapChecked(true)
    })
  }, [])

  // Online/Offline Status überwachen
  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Ctrl+Shift+A für Admin-Login
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setShowAdminLogin(prev => !prev)
        if (error) clearError()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [error, clearError])

  // Autofocus
  useEffect(() => {
    if (!bootstrapChecked) return
    if (bootstrapMode || showAdminLogin) {
      usernameRef.current?.focus()
    } else {
      licenseRef.current?.focus()
    }
  }, [bootstrapChecked, showAdminLogin, bootstrapMode])

  // Error löschen bei Eingabe
  useEffect(() => {
    if (error) clearError()
  }, [licenseKey, username, password])

  // Lizenz-Eingabe formatieren (NTA-XXXX-XXXX-XXXX)
  const formatLicenseInput = (value: string): string => {
    // Nur erlaubte Zeichen behalten (Buchstaben + Ziffern)
    let clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    // NTA-Prefix entfernen falls vorhanden
    if (clean.startsWith('NTA')) clean = clean.substring(3)
    // Max 12 Zeichen (3 Gruppen à 4)
    clean = clean.substring(0, 12)
    if (clean.length === 0) return ''
    // In 4er-Gruppen aufteilen
    const parts: string[] = []
    for (let i = 0; i < clean.length; i += 4) {
      parts.push(clean.substring(i, i + 4))
    }
    return 'NTA-' + parts.join('-')
  }

  const handleLicenseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLicenseKey(formatLicenseInput(e.target.value))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (bootstrapMode) {
      if (!username.trim() || !password.trim()) return
      await bootstrapAdmin(username.trim(), password, bootstrapDisplayName.trim())
      return
    }

    if (showAdminLogin) {
      if (!username.trim() || !password.trim()) return
      await login(username.trim(), password)
    } else {
      if (!isLicenseComplete) return
      await activateLicense(licenseKey)
    }
  }

  // Prüfe ob 12 alphanumerische Zeichen nach NTA vorhanden sind
  const cleanKeyChars = licenseKey.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NTA/, '')
  const isLicenseComplete = cleanKeyChars.length >= 12

  if (!bootstrapChecked) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '16px'
      }}>
        Laden...
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px 18px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'all 0.2s'
  }

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'
    e.target.style.background = 'rgba(255,255,255,0.06)'
    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)'
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.1)'
    e.target.style.background = 'rgba(255,255,255,0.04)'
    e.target.style.boxShadow = 'none'
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden'
    }}>
      {/* ========== HEADER ========== */}
      <header style={{
        height: '44px',
        background: '#0f172a',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        flexShrink: 0,
        position: 'relative'
      }}>
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0, height: '1px',
          background: 'linear-gradient(90deg, rgba(239,68,68,0.3) 0%, rgba(239,68,68,0.08) 30%, transparent 60%)',
          pointerEvents: 'none'
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="nta-logo.png" alt="NTA" style={{ height: '24px', objectFit: 'contain' }} draggable={false} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '3px', textTransform: 'uppercase' }}>NTA</span>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '1.5px', textTransform: 'uppercase', marginLeft: '2px' }}>Navigation Tool Austria</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '3px 10px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px'
          }}>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.4)' }} />
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', fontWeight: 500 }}>v{APP_VERSION}</span>
          </div>
        </div>
      </header>

      {/* ========== MAIN CONTENT ========== */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ========== LINKE SEITE - Branding ========== */}
        <div style={{
          width: '48%', minWidth: '440px', background: '#0f172a',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden'
        }}>
          <img src="nta-logo.png" alt="National Team Austria" style={{
            height: '420px', objectFit: 'contain', marginBottom: '48px',
            filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.4))'
          }} draggable={false} />
          <div style={{
            width: '80px', height: '2px',
            background: 'linear-gradient(90deg, transparent, rgba(239,68,68,0.6), transparent)',
            marginBottom: '36px'
          }} />
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{ fontSize: '42px', fontWeight: 800, color: '#fff', letterSpacing: '10px', textTransform: 'uppercase', marginBottom: '10px' }}>NTA</div>
            <div style={{ fontSize: '16px', fontWeight: 400, color: 'rgba(255,255,255,0.45)', letterSpacing: '5px', textTransform: 'uppercase' }}>Navigation Tool</div>
            <div style={{ fontSize: '16px', fontWeight: 400, color: 'rgba(255,255,255,0.45)', letterSpacing: '5px', textTransform: 'uppercase' }}>Austria</div>
          </div>
          <div style={{ position: 'absolute', bottom: '32px', left: 0, right: 0, textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Developed by</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.5px' }}>Lukas Reinberger</div>
          </div>
          <div style={{
            position: 'absolute', top: '12%', right: '0px', bottom: '12%', width: '1px',
            background: 'linear-gradient(180deg, transparent 0%, rgba(239,68,68,0.3) 30%, rgba(59,130,246,0.3) 70%, transparent 100%)',
            pointerEvents: 'none', zIndex: 3
          }} />
        </div>

        {/* ========== RECHTE SEITE - Login ========== */}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', position: 'relative'
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)`,
            backgroundSize: '40px 40px', pointerEvents: 'none'
          }} />

          <form onSubmit={handleSubmit} style={{ width: '400px', position: 'relative', zIndex: 1 }}>
            {/* Titel */}
            <div style={{ marginBottom: '40px' }}>
              <div style={{ fontSize: '30px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
                {bootstrapMode ? 'Ersteinrichtung' : showAdminLogin ? 'Admin-Login' : 'Willkommen'}
              </div>
              <div style={{ fontSize: '16px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                {bootstrapMode
                  ? 'Erstelle den ersten Admin-Account um zu beginnen.'
                  : showAdminLogin
                    ? 'Melde dich als Administrator an.'
                    : 'Gib deinen Lizenzschlüssel ein um fortzufahren.'
                }
              </div>
            </div>

            {/* Offline-Hinweis */}
            {isOffline && !bootstrapMode && (
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: '12px', padding: '14px 18px', marginBottom: '28px',
                display: 'flex', alignItems: 'center', gap: '14px'
              }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f59e0b' }}>Offline-Modus</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '3px' }}>
                    {showAdminLogin
                      ? 'Anmeldung mit gespeicherten Daten möglich'
                      : 'Lizenzprüfung nur mit gespeicherten Daten möglich'
                    }
                  </div>
                </div>
              </div>
            )}


            {/* ========== BOOTSTRAP MODUS ========== */}
            {bootstrapMode ? (
              <>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Benutzername
                  </label>
                  <input ref={usernameRef} type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="Admin-Benutzername" autoComplete="username"
                    style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Passwort
                  </label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Passwort eingeben" autoComplete="new-password"
                    style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Anzeigename (optional)
                  </label>
                  <input type="text" value={bootstrapDisplayName} onChange={e => setBootstrapDisplayName(e.target.value)}
                    placeholder="z.B. Administrator"
                    style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>
              </>
            ) : showAdminLogin ? (
              /* ========== ADMIN LOGIN ========== */
              <>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Benutzername
                  </label>
                  <input ref={usernameRef} type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="Benutzername eingeben" autoComplete="username"
                    style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Passwort
                  </label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Passwort eingeben" autoComplete="current-password"
                    style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                </div>
                <div
                  onClick={() => { setShowAdminLogin(false); clearError() }}
                  style={{
                    fontSize: '12px', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', marginBottom: '24px',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Zurück zur Lizenz-Eingabe
                </div>
              </>
            ) : (
              /* ========== LIZENZ-EINGABE (Standard) ========== */
              <div style={{ marginBottom: '24px' }}>
                <label style={{
                  display: 'block', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)',
                  marginBottom: '10px', letterSpacing: '0.5px', textTransform: 'uppercase'
                }}>
                  Lizenzschlüssel
                </label>
                <input
                  ref={licenseRef}
                  type="text"
                  value={licenseKey}
                  onChange={handleLicenseChange}
                  placeholder="NTA-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    ...inputStyle,
                    fontFamily: 'monospace',
                    fontSize: '20px',
                    letterSpacing: '2px',
                    textAlign: 'center',
                    padding: '18px',
                    textTransform: 'uppercase'
                  }}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                />
                <div style={{
                  fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginTop: '8px', textAlign: 'center'
                }}>
                  Den Lizenzschlüssel erhältst du von deinem Administrator
                </div>
              </div>
            )}

            {/* Fehlermeldung */}
            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '12px', padding: '14px 18px', marginBottom: '24px',
                display: 'flex', alignItems: 'center', gap: '14px'
              }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || (bootstrapMode ? (!username.trim() || !password.trim()) : showAdminLogin ? (!username.trim() || !password.trim()) : !isLicenseComplete)}
              style={{
                width: '100%',
                padding: '16px',
                background: isLoading
                  ? 'rgba(59, 130, 246, 0.3)'
                  : (bootstrapMode || showAdminLogin
                      ? (!username.trim() || !password.trim())
                      : !isLicenseComplete)
                    ? 'rgba(59, 130, 246, 0.15)'
                    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '0.5px',
                boxShadow: (!isLoading && (bootstrapMode || showAdminLogin ? (username.trim() && password.trim()) : isLicenseComplete))
                  ? '0 4px 20px rgba(59, 130, 246, 0.3)'
                  : 'none'
              }}
            >
              {isLoading
                ? 'Wird geladen...'
                : bootstrapMode
                  ? 'Admin-Account erstellen'
                  : showAdminLogin
                    ? 'Anmelden'
                    : 'Lizenz aktivieren'
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
