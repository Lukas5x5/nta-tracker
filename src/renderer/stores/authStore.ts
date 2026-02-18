import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'
import type { AppUser, AppUserRow } from '../../shared/types'
import { loadProfile, startProfileSync, stopProfileSync, clearLocalFlightData } from '../services/profileSync'

// ============================================
// Password Hashing (Web Crypto API) - nur für Admin-Login
// ============================================

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateSalt(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================
// License Key Generation
// ============================================

const LICENSE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 28 Zeichen, kein O/0/I/1/L

function generateLicenseKey(): string {
  const segments: string[] = []
  for (let s = 0; s < 3; s++) {
    let segment = ''
    for (let i = 0; i < 4; i++) {
      const array = new Uint8Array(1)
      crypto.getRandomValues(array)
      segment += LICENSE_CHARS[array[0] % LICENSE_CHARS.length]
    }
    segments.push(segment)
  }
  return `NTA-${segments.join('-')}`
}

// ============================================
// Installation ID - Identifiziert diesen PC
// ============================================

const INSTALLATION_ID_KEY = 'nta-installation-id'

function getOrCreateInstallationId(): string {
  let installId = localStorage.getItem(INSTALLATION_ID_KEY)
  if (!installId) {
    installId = crypto.randomUUID()
    localStorage.setItem(INSTALLATION_ID_KEY, installId)
    console.log('[Auth] Neue Installation erkannt, ID erstellt:', installId.substring(0, 8))
  }
  return installId
}

// ============================================
// Offline Login Cache - für Admin-Login (Passwort-basiert)
// ============================================

const OFFLINE_CACHE_KEY = 'nta-offline-login-cache'

interface OfflineLoginCache {
  username: string
  password_hash: string
  salt: string
  user: AppUser
  cachedAt: number
}

function saveOfflineLoginCache(username: string, password_hash: string, salt: string, user: AppUser) {
  try {
    const cache: OfflineLoginCache = { username, password_hash, salt, user, cachedAt: Date.now() }
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(cache))
  } catch (e) {
    console.error('[Auth] Offline-Cache speichern fehlgeschlagen:', e)
  }
}

function getOfflineLoginCache(username: string): OfflineLoginCache | null {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_KEY)
    if (!raw) return null
    const cache: OfflineLoginCache = JSON.parse(raw)
    if (cache.username !== username) return null
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    if ((Date.now() - cache.cachedAt) > SEVEN_DAYS) return null
    return cache
  } catch {
    return null
  }
}

// ============================================
// License Cache - für Lizenz-basiertes Offline-Login
// ============================================

const LICENSE_CACHE_KEY = 'nta-license-cache'

interface LicenseCache {
  licenseKey: string
  installationId: string
  user: AppUser
  cachedAt: number
  lastOnlineCheck: number
}

function saveLicenseCache(licenseKey: string, installationId: string, user: AppUser, lastOnlineCheck: number) {
  try {
    const cache: LicenseCache = { licenseKey, installationId, user, cachedAt: Date.now(), lastOnlineCheck }
    localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify(cache))
  } catch (e) {
    console.error('[Auth] License-Cache speichern fehlgeschlagen:', e)
  }
}

function getLicenseCache(): LicenseCache | null {
  try {
    const raw = localStorage.getItem(LICENSE_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as LicenseCache
  } catch {
    return null
  }
}

function clearLicenseCache() {
  localStorage.removeItem(LICENSE_CACHE_KEY)
}

// ============================================
// License Heartbeat - Prüft alle 30 Min ob Lizenz noch gültig
// ============================================

let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null

function startLicenseHeartbeat(licenseKey: string, userId: string, installId: string) {
  stopLicenseHeartbeat()

  heartbeatIntervalId = setInterval(async () => {
    if (!navigator.onLine) return

    try {
      const { data } = await supabase
        .from('app_users')
        .select('bound_installation_id, is_active')
        .eq('license_key', licenseKey)
        .single()

      if (!data || !data.is_active || data.bound_installation_id !== installId) {
        // Lizenz wurde deaktiviert oder auf anderem PC aktiviert
        console.log('[Auth] Heartbeat: Lizenz nicht mehr gültig für diesen PC')
        clearLicenseCache()
        useAuthStore.setState({
          user: null, isAuthenticated: false, error: 'Lizenz auf anderem Gerät aktiviert',
          _licenseKey: null, _isLicenseUser: false
        })
        stopLicenseHeartbeat()
        return
      }

      // last_online_check aktualisieren
      await supabase.from('app_users')
        .update({ last_online_check: new Date().toISOString() })
        .eq('id', userId)

      const now = Date.now()
      useAuthStore.setState({ _lastOnlineCheck: now })

      // License Cache aktualisieren
      const cache = getLicenseCache()
      if (cache) {
        saveLicenseCache(cache.licenseKey, installId, cache.user, now)
      }
    } catch {
      // Netzwerkfehler - ignorieren, nächster Versuch
    }
  }, 2 * 60 * 1000) // 2 Minuten
}

function stopLicenseHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId)
    heartbeatIntervalId = null
  }
}

// ============================================
// Netzwerkfehler-Erkennung
// ============================================

function isNetworkError(error: any): boolean {
  if (!navigator.onLine) return true
  const msg = ((error?.message || '') + '').toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') ||
    msg.includes('err_') || msg.includes('abort') || msg.includes('socket') ||
    msg.includes('econnrefused') || msg.includes('enotfound') ||
    error?.code === 'NETWORK_ERROR'
}

// ============================================
// Auth Store
// ============================================

interface AuthState {
  user: AppUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  _hasHydrated: boolean
  _installationId: string | null
  _lastOnlineCheck: number | null
  _licenseKey: string | null
  _isLicenseUser: boolean

  activateLicense: (licenseKey: string) => Promise<boolean>
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
  createUser: (username: string, password: string, displayName: string, role?: 'pilot' | 'crew') => Promise<{ success: boolean; licenseKey?: string }>
  deactivateUser: (userId: string) => Promise<boolean>
  activateUser: (userId: string) => Promise<boolean>
  deleteUser: (userId: string) => Promise<boolean>
  changePassword: (userId: string, newPassword: string) => Promise<boolean>
  regenerateLicenseKey: (userId: string) => Promise<string | null>
  unbindLicense: (userId: string) => Promise<boolean>
  loadUsers: () => Promise<AppUser[]>
  checkIsEmpty: () => Promise<boolean>
  bootstrapAdmin: (username: string, password: string, displayName: string) => Promise<boolean>
  clearError: () => void
  setHasHydrated: (value: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      _hasHydrated: false,
      _installationId: null,
      _lastOnlineCheck: null,
      _licenseKey: null,
      _isLicenseUser: false,

      setHasHydrated: (value: boolean) => set({ _hasHydrated: value }),

      // ============================================
      // Lizenz-Aktivierung (für Piloten)
      // ============================================
      activateLicense: async (licenseKey: string) => {
        set({ isLoading: true, error: null })
        // Normalisiere Key ins Format NTA-XXXX-XXXX-XXXX
        let cleanChars = licenseKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (cleanChars.startsWith('NTA')) cleanChars = cleanChars.substring(3)
        const normalizedKey = cleanChars.length >= 12
          ? `NTA-${cleanChars.substring(0, 4)}-${cleanChars.substring(4, 8)}-${cleanChars.substring(8, 12)}`
          : licenseKey.trim().toUpperCase()

        try {
          const { data, error } = await supabase
            .from('app_users')
            .select('id, username, display_name, is_admin, is_active, role, created_at, license_key, bound_installation_id')
            .eq('license_key', normalizedKey)
            .eq('is_active', true)
            .single()

          if (error || !data) {
            const offline = !navigator.onLine || (error && isNetworkError(error))

            if (offline) {
              // Offline-Aktivierung mit Cache versuchen
              const cache = getLicenseCache()
              if (cache && cache.licenseKey === normalizedKey) {
                const installId = getOrCreateInstallationId()
                if (cache.installationId === installId) {
                  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
                  if ((Date.now() - cache.lastOnlineCheck) < FORTY_EIGHT_HOURS) {
                    set({
                      user: cache.user, isAuthenticated: true, isLoading: false, error: null,
                      _installationId: installId, _lastOnlineCheck: cache.lastOnlineCheck,
                      _licenseKey: normalizedKey, _isLicenseUser: true
                    })
                    startProfileSync(cache.user.id)
                    return true
                  }
                  set({ error: 'Bitte mit dem Internet verbinden für Lizenzprüfung', isLoading: false })
                  return false
                }
              }
              set({ error: 'Offline - Lizenzaktivierung nicht möglich', isLoading: false })
              return false
            }

            set({ error: 'Ungültiger Lizenzschlüssel', isLoading: false })
            return false
          }

          // Crew-Accounts dürfen sich nicht in der NTA App anmelden
          if (data.role === 'crew') {
            set({ error: 'Crew-Accounts können nur in der Lite-App verwendet werden', isLoading: false })
            return false
          }

          const installId = getOrCreateInstallationId()

          // Lizenz an diesen PC binden (alter PC wird automatisch entbunden)
          const { error: updateError } = await supabase
            .from('app_users')
            .update({ bound_installation_id: installId, last_online_check: new Date().toISOString() })
            .eq('id', data.id)

          if (updateError) {
            set({ error: `Fehler: ${updateError.message}`, isLoading: false })
            return false
          }

          const user: AppUser = {
            id: data.id,
            username: data.username,
            display_name: data.display_name,
            is_admin: data.is_admin,
            is_active: data.is_active,
            role: (data as any).role || 'pilot',
            created_at: data.created_at,
            license_key: data.license_key,
            bound_installation_id: installId
          }

          const now = Date.now()
          saveLicenseCache(normalizedKey, installId, user, now)

          set({
            user, isAuthenticated: true, isLoading: false, error: null,
            _installationId: installId, _lastOnlineCheck: now,
            _licenseKey: normalizedKey, _isLicenseUser: true
          })

          await loadProfile(user.id)
          startProfileSync(user.id)
          startLicenseHeartbeat(normalizedKey, user.id, installId)

          return true
        } catch (err) {
          console.error('[Auth] License activation error:', err)

          // Offline-Fallback
          if (!navigator.onLine) {
            const cache = getLicenseCache()
            if (cache && cache.licenseKey === normalizedKey) {
              const installId = getOrCreateInstallationId()
              if (cache.installationId === installId) {
                const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
                if ((Date.now() - cache.lastOnlineCheck) < FORTY_EIGHT_HOURS) {
                  set({
                    user: cache.user, isAuthenticated: true, isLoading: false, error: null,
                    _installationId: installId, _lastOnlineCheck: cache.lastOnlineCheck,
                    _licenseKey: normalizedKey, _isLicenseUser: true
                  })
                  startProfileSync(cache.user.id)
                  return true
                }
              }
            }
            set({ error: 'Bitte mit dem Internet verbinden für Lizenzprüfung', isLoading: false })
            return false
          }

          set({ error: 'Verbindungsfehler', isLoading: false })
          return false
        }
      },

      // ============================================
      // Admin-Login (Passwort-basiert)
      // ============================================
      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .eq('username', username)
            .eq('is_active', true)
            .single()

          if (error || !data) {
            const isOffline = !navigator.onLine || (error && isNetworkError(error))

            if (isOffline) {
              console.log('[Auth] Offline - versuche lokalen Login')
              const cache = getOfflineLoginCache(username)
              if (cache) {
                const hash = await hashPassword(password, cache.salt)
                if (hash === cache.password_hash) {
                  console.log('[Auth] Offline-Login erfolgreich für:', username)
                  const installId = getOrCreateInstallationId()
                  set({ user: cache.user, isAuthenticated: true, isLoading: false, error: null, _installationId: installId, _isLicenseUser: false })
                  startProfileSync(cache.user.id)
                  return true
                }
              }
              set({ error: 'Offline - Login nicht möglich (keine gespeicherten Daten)', isLoading: false })
              return false
            }

            set({ error: 'Benutzername oder Passwort falsch', isLoading: false })
            return false
          }

          const row = data as AppUserRow
          const hash = await hashPassword(password, row.salt)

          if (hash !== row.password_hash) {
            set({ error: 'Benutzername oder Passwort falsch', isLoading: false })
            return false
          }

          // Crew-Accounts dürfen sich nicht in der NTA App anmelden
          if (row.role === 'crew') {
            set({ error: 'Crew-Accounts können nur in der Lite-App verwendet werden', isLoading: false })
            return false
          }

          // Nicht-Admin-User müssen Lizenzschlüssel verwenden
          if (!row.is_admin) {
            set({ error: 'Bitte verwende deinen Lizenzschlüssel zum Anmelden', isLoading: false })
            return false
          }

          const user: AppUser = {
            id: row.id,
            username: row.username,
            display_name: row.display_name,
            is_admin: row.is_admin,
            is_active: row.is_active,
            role: (row as any).role || 'pilot',
            created_at: row.created_at
          }

          saveOfflineLoginCache(username, row.password_hash, row.salt, user)

          const installId = getOrCreateInstallationId()
          set({
            user, isAuthenticated: true, isLoading: false, error: null,
            _installationId: installId, _lastOnlineCheck: Date.now(),
            _isLicenseUser: false, _licenseKey: null
          })

          await loadProfile(user.id)
          startProfileSync(user.id)

          return true
        } catch (err) {
          console.error('[Auth] Login error:', err)

          if (!navigator.onLine) {
            console.log('[Auth] Netzwerkfehler - versuche Offline-Login')
            const cache = getOfflineLoginCache(username)
            if (cache) {
              const hash = await hashPassword(password, cache.salt)
              if (hash === cache.password_hash) {
                console.log('[Auth] Offline-Login erfolgreich für:', username)
                const installId = getOrCreateInstallationId()
                set({ user: cache.user, isAuthenticated: true, isLoading: false, error: null, _installationId: installId, _isLicenseUser: false })
                startProfileSync(cache.user.id)
                return true
              }
            }
            set({ error: 'Offline - Login nicht möglich (keine gespeicherten Daten)', isLoading: false })
            return false
          }

          set({ error: 'Verbindungsfehler', isLoading: false })
          return false
        }
      },

      // ============================================
      // Logout
      // ============================================
      logout: async () => {
        stopLicenseHeartbeat()
        await stopProfileSync()
        clearLocalFlightData()
        // License-Cache und Key bleiben erhalten für automatische Re-Aktivierung
        set({ user: null, isAuthenticated: false, error: null })
      },

      // ============================================
      // Session Check (beim App-Start)
      // ============================================
      checkSession: async () => {
        const waitForHydration = async (): Promise<void> => {
          const maxWait = 50
          let waited = 0
          while (!get()._hasHydrated && waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 20))
            waited++
          }
        }
        await waitForHydration()

        const { user, isAuthenticated, _lastOnlineCheck, _isLicenseUser, _licenseKey } = get()

        if (!user || !isAuthenticated) {
          // Lizenz-Key noch gespeichert? Auto-Re-Aktivierung
          if (_isLicenseUser && _licenseKey) {
            console.log('[Auth] Auto-Re-Aktivierung mit gespeichertem Lizenzschlüssel')
            const success = await get().activateLicense(_licenseKey)
            if (!success) {
              set({ isLoading: false })
            }
            return
          }
          console.log('[Auth] Keine gespeicherte Session gefunden')
          set({ isLoading: false, user: null, isAuthenticated: false })
          return
        }

        console.log('[Auth] Gespeicherte Session gefunden für:', user.username, _isLicenseUser ? '(Lizenz)' : '(Admin)')

        // ========== LIZENZ-USER ==========
        if (_isLicenseUser && _licenseKey) {
          const installId = getOrCreateInstallationId()
          const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000

          // Offline-Check
          if (!navigator.onLine) {
            const lastCheck = _lastOnlineCheck || 0
            if ((Date.now() - lastCheck) > FORTY_EIGHT_HOURS) {
              console.log('[Auth] Lizenz-User offline >48h, Login erforderlich')
              set({ user: null, isAuthenticated: false, isLoading: false, _licenseKey: null, _isLicenseUser: false })
              return
            }
            console.log('[Auth] Lizenz-User offline, Session beibehalten')
            startProfileSync(user.id)
            set({ isLoading: false })
            return
          }

          // Online-Validierung
          try {
            const { data, error } = await supabase
              .from('app_users')
              .select('id, is_active, bound_installation_id')
              .eq('license_key', _licenseKey)
              .single()

            if (error && isNetworkError(error)) {
              throw new Error('Network error: ' + error.message)
            }

            if (!data || !data.is_active) {
              console.log('[Auth] Lizenz deaktiviert oder nicht gefunden')
              clearLicenseCache()
              set({ user: null, isAuthenticated: false, isLoading: false, _licenseKey: null, _isLicenseUser: false })
              return
            }

            if (data.bound_installation_id !== installId) {
              console.log('[Auth] Lizenz auf anderem Gerät aktiviert')
              clearLicenseCache()
              set({
                user: null, isAuthenticated: false, isLoading: false,
                error: 'Lizenz auf anderem Gerät aktiviert',
                _licenseKey: null, _isLicenseUser: false
              })
              return
            }

            // Alles OK - last_online_check aktualisieren
            await supabase.from('app_users')
              .update({ last_online_check: new Date().toISOString() })
              .eq('id', data.id)

            const now = Date.now()
            saveLicenseCache(_licenseKey, installId, user, now)

            await loadProfile(user.id)
            startProfileSync(user.id)
            startLicenseHeartbeat(_licenseKey, user.id, installId)

            set({ isLoading: false, _lastOnlineCheck: now })
          } catch (err) {
            console.log('[Auth] Netzwerkfehler bei Lizenz-Validierung:', err)
            const lastCheck = _lastOnlineCheck || 0
            if ((Date.now() - lastCheck) > FORTY_EIGHT_HOURS) {
              console.log('[Auth] Offline >48h, Login erforderlich')
              set({ user: null, isAuthenticated: false, isLoading: false, _licenseKey: null, _isLicenseUser: false })
              return
            }
            startProfileSync(user.id)
            set({ isLoading: false })
          }
          return
        }

        // ========== ADMIN/PASSWORT-USER ==========
        if (!navigator.onLine) {
          console.log('[Auth] Admin offline - überspringe Supabase-Validierung')
          const OFFLINE_LIMIT_MS = 5 * 60 * 60 * 1000
          const lastCheck = _lastOnlineCheck || 0
          if ((Date.now() - lastCheck) > OFFLINE_LIMIT_MS) {
            console.log('[Auth] Offline zu lange (>5h), Login erforderlich')
            set({ user: null, isAuthenticated: false, isLoading: false, _lastOnlineCheck: null })
            return
          }
          startProfileSync(user.id)
          set({ isLoading: false })
          return
        }

        try {
          const { data, error } = await supabase
            .from('app_users')
            .select('id, is_active')
            .eq('id', user.id)
            .single()

          if (error && isNetworkError(error)) {
            throw new Error('Network error: ' + error.message)
          }

          if (error || !data || !data.is_active) {
            console.log('[Auth] User deaktiviert oder nicht gefunden, logout')
            set({ user: null, isAuthenticated: false, isLoading: false })
            return
          }

          console.log('[Auth] Session online validiert für:', user.username)
          await loadProfile(user.id)
          startProfileSync(user.id)
          set({ isLoading: false, _lastOnlineCheck: Date.now() })
        } catch (err) {
          console.log('[Auth] Netzwerkfehler bei Session-Validierung:', err)
          const OFFLINE_LIMIT_MS = 5 * 60 * 60 * 1000
          const lastCheck = _lastOnlineCheck || 0
          if ((Date.now() - lastCheck) > OFFLINE_LIMIT_MS) {
            console.log('[Auth] Offline zu lange (>5h), Login erforderlich')
            set({ user: null, isAuthenticated: false, isLoading: false, _lastOnlineCheck: null })
            return
          }
          startProfileSync(user.id)
          set({ isLoading: false })
        }
      },

      // ============================================
      // User Management (Admin-Funktionen)
      // ============================================
      createUser: async (username: string, password: string, displayName: string, role: 'pilot' | 'crew' = 'pilot') => {
        const { user } = get()
        if (!user?.is_admin) {
          set({ error: 'Keine Admin-Berechtigung' })
          return { success: false }
        }

        try {
          const salt = generateSalt()
          const password_hash = await hashPassword(password, salt)
          const licenseKey = generateLicenseKey()

          const { error } = await supabase
            .from('app_users')
            .insert({
              username,
              password_hash,
              salt,
              display_name: displayName || null,
              is_admin: false,
              is_active: true,
              role,
              license_key: licenseKey
            })

          if (error) {
            if (error.code === '23505') {
              set({ error: 'Benutzername bereits vergeben' })
            } else {
              set({ error: `Fehler: ${error.message}` })
            }
            return { success: false }
          }

          return { success: true, licenseKey }
        } catch (err) {
          console.error('[Auth] Create user error:', err)
          set({ error: 'Verbindungsfehler' })
          return { success: false }
        }
      },

      deactivateUser: async (userId: string) => {
        const { user } = get()
        if (!user?.is_admin) return false
        if (userId === user.id) {
          set({ error: 'Du kannst dich nicht selbst deaktivieren' })
          return false
        }

        try {
          const { error } = await supabase
            .from('app_users')
            .update({ is_active: false })
            .eq('id', userId)

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }
          return true
        } catch {
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      activateUser: async (userId: string) => {
        const { user } = get()
        if (!user?.is_admin) return false

        try {
          const { error } = await supabase
            .from('app_users')
            .update({ is_active: true })
            .eq('id', userId)

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }
          return true
        } catch {
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      deleteUser: async (userId: string) => {
        const { user } = get()
        if (!user?.is_admin) return false
        if (userId === user.id) {
          set({ error: 'Du kannst dich nicht selbst löschen' })
          return false
        }

        try {
          const { data, error } = await supabase
            .from('app_users')
            .delete()
            .eq('id', userId)
            .select()

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }
          if (!data || data.length === 0) {
            set({ error: 'Löschen fehlgeschlagen – keine Berechtigung' })
            return false
          }
          return true
        } catch {
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      changePassword: async (userId: string, newPassword: string) => {
        const { user } = get()
        if (!user?.is_admin) return false

        try {
          const salt = generateSalt()
          const password_hash = await hashPassword(newPassword, salt)

          const { error } = await supabase
            .from('app_users')
            .update({ password_hash, salt })
            .eq('id', userId)

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }
          return true
        } catch {
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      regenerateLicenseKey: async (userId: string) => {
        const { user } = get()
        if (!user?.is_admin) return null

        try {
          const newKey = generateLicenseKey()
          const { error } = await supabase
            .from('app_users')
            .update({ license_key: newKey, bound_installation_id: null })
            .eq('id', userId)

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return null
          }
          return newKey
        } catch {
          set({ error: 'Verbindungsfehler' })
          return null
        }
      },

      unbindLicense: async (userId: string) => {
        const { user } = get()
        if (!user?.is_admin) return false

        try {
          const { error } = await supabase
            .from('app_users')
            .update({ bound_installation_id: null })
            .eq('id', userId)

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }
          return true
        } catch {
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      loadUsers: async () => {
        try {
          const { data, error } = await supabase
            .from('app_users')
            .select('id, username, display_name, is_admin, is_active, role, created_at, license_key, bound_installation_id')
            .order('created_at', { ascending: true })

          if (error) {
            console.error('[Auth] Load users error:', error)
            return []
          }
          return (data || []) as AppUser[]
        } catch {
          return []
        }
      },

      checkIsEmpty: async () => {
        try {
          const { count, error } = await supabase
            .from('app_users')
            .select('*', { count: 'exact', head: true })

          if (error) return false
          return count === 0
        } catch {
          return false
        }
      },

      bootstrapAdmin: async (username: string, password: string, displayName: string) => {
        try {
          const isEmpty = await get().checkIsEmpty()
          if (!isEmpty) {
            set({ error: 'Es existieren bereits Benutzer' })
            return false
          }

          const salt = generateSalt()
          const password_hash = await hashPassword(password, salt)

          const { data, error } = await supabase
            .from('app_users')
            .insert({
              username,
              password_hash,
              salt,
              display_name: displayName || null,
              is_admin: true,
              is_active: true,
              role: 'pilot'
            })
            .select('id, username, display_name, is_admin, is_active, role, created_at')
            .single()

          if (error) {
            set({ error: `Fehler: ${error.message}` })
            return false
          }

          const adminUser = data as AppUser
          const installId = getOrCreateInstallationId()

          saveOfflineLoginCache(username, password_hash, salt, adminUser)

          set({
            user: adminUser,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            _installationId: installId,
            _lastOnlineCheck: Date.now(),
            _isLicenseUser: false,
            _licenseKey: null
          })

          await loadProfile(adminUser.id)
          startProfileSync(adminUser.id)

          return true
        } catch (err) {
          console.error('[Auth] Bootstrap error:', err)
          set({ error: 'Verbindungsfehler' })
          return false
        }
      },

      clearError: () => set({ error: null })
    }),
    {
      name: 'nta-auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        _installationId: state._installationId,
        _lastOnlineCheck: state._lastOnlineCheck,
        _licenseKey: state._licenseKey,
        _isLicenseUser: state._isLicenseUser
      }),
      onRehydrateStorage: () => (state, error) => {
        if (state) {
          const currentInstallId = getOrCreateInstallationId()
          const storedInstallId = state._installationId

          if (storedInstallId && storedInstallId !== currentInstallId) {
            console.log('[Auth] Session stammt von anderem PC, Login erforderlich')
            state.user = null
            state.isAuthenticated = false
            state._installationId = currentInstallId
            state._licenseKey = null
            state._isLicenseUser = false
            localStorage.removeItem('nta-flight-storage')
            localStorage.removeItem('nta-last-user-id')
            localStorage.removeItem('nta-profile-dirty')
          } else if (!storedInstallId && state.isAuthenticated) {
            console.log('[Auth] Upgrade: Installation ID hinzugefügt')
            state._installationId = currentInstallId
          } else {
            state._installationId = currentInstallId
          }

          console.log('[Auth] Storage rehydrated, isAuthenticated:', state.isAuthenticated, 'user:', state.user?.username, 'license:', state._isLicenseUser)
          state.setHasHydrated(true)
        }
      }
    }
  )
)
